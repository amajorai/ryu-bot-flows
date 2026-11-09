/**
 * SSRF-safe fetch for `http_request` blocks.
 *
 * Owners template URLs with visitor input, so every request is checked:
 * https only, no credentials in the URL, no single-label or local-only host
 * names, every resolved address must be public (loopback, private, link-local,
 * CGNAT, ULA, multicast, documentation, and metadata ranges are refused),
 * redirects are never followed, and responses are capped at 256 KiB.
 *
 * Residual risk: the address is checked at resolve time and `fetch` resolves
 * again, so a hostile DNS server could rebind between the two lookups. The
 * redirect ban, https-only rule (a rebound target must present a valid
 * certificate for the name), and response cap keep that window narrow.
 */
import { lookup } from "node:dns/promises";
import { BOT_LIMITS } from "./contracts.ts";
import type { HttpRequestSpec, HttpResponseSpec } from "./engine.ts";

export class HttpGuardError extends Error {}

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) =>
	(await lookup(hostname, { all: true, verbatim: true })).map(
		(entry) => entry.address
	);

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIpv4(value: string): number | null {
	const match = IPV4_PATTERN.exec(value);
	if (!match) {
		return null;
	}
	let result = 0;
	for (const part of match.slice(1)) {
		const octet = Number(part);
		if (octet > 255) {
			return null;
		}
		result = result * 256 + octet;
	}
	return result;
}

export function parseIpv6(value: string): bigint | null {
	if (value.includes("%") || !value.includes(":")) {
		return null;
	}
	let text = value.toLowerCase();
	const groups: number[] = [];
	const lastColon = text.lastIndexOf(":");
	const tail = text.slice(lastColon + 1);
	if (tail.includes(".")) {
		const v4 = parseIpv4(tail);
		if (v4 === null) {
			return null;
		}
		text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xff_ff).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) {
		return null;
	}
	const parse = (part: string) =>
		part === ""
			? []
			: part
					.split(":")
					.map((piece) =>
						/^[0-9a-f]{1,4}$/.test(piece)
							? Number.parseInt(piece, 16)
							: Number.NaN
					);
	const head = parse(halves[0] ?? "");
	const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
	if (halves.length === 2) {
		const fill = 8 - head.length - rest.length;
		if (fill < 1) {
			return null;
		}
		groups.push(...head, ...new Array<number>(fill).fill(0), ...rest);
	} else {
		groups.push(...head);
	}
	if (groups.length !== 8 || groups.some((group) => Number.isNaN(group))) {
		return null;
	}
	return groups.reduce((total, group) => (total << 16n) | BigInt(group), 0n);
}

const BLOCKED_V4: [string, number][] = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
];

const BLOCKED_V6: [string, number][] = [
	["::", 96], // unspecified, loopback, IPv4-compatible
	["100::", 64], // discard
	["2001::", 23], // IETF protocol assignments (Teredo, ORCHID, …)
	["2001:db8::", 32], // documentation
	["fc00::", 7], // unique local, including fd00:ec2::254 metadata
	["fe80::", 10], // link-local
	["fec0::", 10], // site-local (deprecated)
	["ff00::", 8], // multicast
];

function inV4Range(address: number, [base, prefix]: [string, number]): boolean {
	const network = parseIpv4(base) ?? 0;
	const shift = 32 - prefix;
	return Math.floor(address / 2 ** shift) === Math.floor(network / 2 ** shift);
}

function inV6Range(address: bigint, [base, prefix]: [string, number]): boolean {
	const network = parseIpv6(base) ?? 0n;
	const shift = BigInt(128 - prefix);
	return address >> shift === network >> shift;
}

function embeddedV4(address: bigint): number | null {
	const prefix96 = address >> 32n;
	const low = Number(address & 0xff_ff_ff_ffn);
	// IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96.
	if (
		prefix96 === 0xff_ffn ||
		prefix96 === (parseIpv6("64:ff9b::") ?? 0n) >> 32n
	) {
		return low;
	}
	// 6to4 2002::/16 carries the IPv4 address in bits 16-48.
	if (address >> 112n === 0x20_02n) {
		return Number((address >> 80n) & 0xff_ff_ff_ffn);
	}
	return null;
}

/** True when the literal address must never be fetched. */
export function isBlockedAddress(value: string): boolean {
	const v4 = parseIpv4(value);
	if (v4 !== null) {
		return BLOCKED_V4.some((range) => inV4Range(v4, range));
	}
	const v6 = parseIpv6(value.replace(/^\[|\]$/g, ""));
	if (v6 === null) {
		return true;
	}
	const mapped = embeddedV4(v6);
	if (mapped !== null) {
		return BLOCKED_V4.some((range) => inV4Range(mapped, range));
	}
	return BLOCKED_V6.some((range) => inV6Range(v6, range));
}

const BLOCKED_HOST_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".home.arpa",
	".lan",
	".intranet",
];

function assertPublicHostname(hostname: string): void {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (
		host === "localhost" ||
		!host.includes(".") ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
	) {
		throw new HttpGuardError("Requests to local host names are not allowed.");
	}
}

const DROPPED_HEADERS = new Set([
	"host",
	"connection",
	"content-length",
	"transfer-encoding",
	"upgrade",
	"te",
	"trailer",
	"keep-alive",
	"proxy-authorization",
	"proxy-connection",
]);

/** Validates the URL and every resolved address. Returns the parsed URL. */
export async function assertSafeUrl(
	rawUrl: string,
	resolver: Resolver = systemResolver
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new HttpGuardError("The request URL is not valid.");
	}
	if (url.protocol !== "https:") {
		throw new HttpGuardError("Only https:// requests are allowed.");
	}
	if (url.username || url.password) {
		throw new HttpGuardError("Credentials in the URL are not allowed.");
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const isLiteral =
		parseIpv4(hostname) !== null || parseIpv6(hostname) !== null;
	if (!isLiteral) {
		assertPublicHostname(hostname);
	}
	let addresses: string[];
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		addresses = isLiteral
			? [hostname]
			: await Promise.race([
					resolver(hostname),
					new Promise<string[]>((_resolve, reject) => {
						timer = setTimeout(() => reject(new Error("timeout")), 3000);
					}),
				]);
	} catch {
		throw new HttpGuardError("The request host could not be resolved.");
	} finally {
		clearTimeout(timer);
	}
	if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
		throw new HttpGuardError(
			"Requests to private, local, or reserved addresses are not allowed."
		);
	}
	return url;
}

async function readCapped(response: Response, limit: number): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) {
		return "";
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		size += chunk.value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new HttpGuardError("The response is larger than 256 KiB.");
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

export interface GuardedFetchOptions {
	fetchImpl?: typeof fetch;
	resolver?: Resolver;
}

/** Creates the engine's `http` dependency. */
export function createGuardedHttp(options: GuardedFetchOptions = {}) {
	const doFetch = options.fetchImpl ?? fetch;
	return async (request: HttpRequestSpec): Promise<HttpResponseSpec> => {
		const url = await assertSafeUrl(request.url, options.resolver);
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (!DROPPED_HEADERS.has(name.toLowerCase())) {
				headers.set(name, value);
			}
		}
		headers.set("user-agent", "RyuBotFlows/0.1");
		let response: Response;
		try {
			response = await doFetch(url, {
				method: request.method,
				headers,
				body: request.body,
				redirect: "manual",
				signal: AbortSignal.timeout(
					Math.min(request.timeoutMs, BOT_LIMITS.httpTimeoutMs)
				),
			});
		} catch (cause) {
			if (cause instanceof Error && cause.name === "TimeoutError") {
				throw new HttpGuardError("The request timed out.");
			}
			throw new HttpGuardError("The request failed.");
		}
		if (response.status >= 300 && response.status < 400) {
			await response.body?.cancel();
			throw new HttpGuardError("Redirects are not followed.");
		}
		return {
			status: response.status,
			body: await readCapped(response, BOT_LIMITS.httpResponseBytes),
		};
	};
}
