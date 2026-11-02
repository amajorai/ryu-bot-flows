/**
 * Bot Flows' HTTP plumbing: route types, JSON and HTML responses, bounded
 * body reads, and the per-visitor rate-limit key.
 */
import { isIP } from "node:net";
import { z } from "zod";
import { BOT_LIMITS } from "./contracts.ts";
import { renderClosedPage } from "./respondent.ts";
import { BotFlowsError } from "./store.ts";

export interface RouteContext {
	params: Record<string, string>;
	peer: string | undefined;
	request: Request;
	url: URL;
}

export type RouteHandler = (
	context: RouteContext
) => Promise<Response> | Response;

export interface RouteDefinition {
	handler: RouteHandler;
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The manifest path relative to the sidecar mount. */
	path: string;
}

export const PARAM_PATTERNS: Record<string, string> = {
	slug: "([a-z0-9][a-z0-9-]{1,46}[a-z0-9])",
	id: "([A-Za-z0-9_-]{1,80})",
	resultId: "([A-Za-z0-9_-]{1,80})",
	sessionId: "([A-Za-z0-9_-]{1,80})",
};

export const SECURITY_HEADERS = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
} as const;

export function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: { "cache-control": "no-store", ...SECURITY_HEADERS },
	});
}

export function errorResponse(error: BotFlowsError): Response {
	return json(
		{
			error: {
				code: error.code,
				message: error.message,
				...(Array.isArray(error.details) ? { issues: error.details } : {}),
			},
		},
		error.status
	);
}

export function toBotFlowsError(cause: unknown): BotFlowsError {
	if (cause instanceof BotFlowsError) {
		return cause;
	}
	if (cause instanceof z.ZodError) {
		const issue = cause.issues[0];
		const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
		return new BotFlowsError(
			"invalid_input",
			`${issue?.message ?? "The request is invalid."}${where}`
		);
	}
	if (cause instanceof Error) {
		return new BotFlowsError("operation_failed", cause.message);
	}
	return new BotFlowsError(
		"operation_failed",
		"The Bot Flows operation failed.",
		500
	);
}

async function readBody(request: Request, limit: number): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) {
		return "";
	}
	let size = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		size += chunk.value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new BotFlowsError(
				"too_large",
				"Request exceeds the size limit.",
				413
			);
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

export async function readJson<T>(
	request: Request,
	schema: z.ZodType<T>,
	options: { limit?: number; optional?: boolean } = {}
): Promise<T> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	const length = request.headers.get("content-length");
	if (options.optional && (!request.body || length === "0") && !contentType) {
		return schema.parse({});
	}
	if (!contentType.includes("application/json")) {
		throw new BotFlowsError("invalid_input", "JSON body required.", 415);
	}
	const text = await readBody(
		request,
		options.limit ?? BOT_LIMITS.maxBodyBytes
	);
	if (options.optional && text.trim() === "") {
		return schema.parse({});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new BotFlowsError("invalid_input", "Request body is not valid JSON.");
	}
	return schema.parse(parsed);
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);

/** The one bucket every caller without a usable address shares. */
export const ANONYMOUS_VISITOR = "anonymous";

function usableAddress(value: string | undefined): value is string {
	return Boolean(
		value &&
			isIP(value) !== 0 &&
			!LOOPBACK.test(value) &&
			!UNSPECIFIED.has(value)
	);
}

/**
 * The visitor key for per-visitor rate limits. A direct non-loopback peer is
 * used as is. Core reaches the sidecar over loopback and forwards request
 * headers verbatim, so then the right-most `X-Forwarded-For` hop is used when
 * it is a plain, non-loopback IP address. Anything else (no header, a host
 * name, garbage, loopback) maps to one shared `anonymous` bucket, so leaving
 * the header out never escapes the per-visitor limits.
 *
 * Core neither strips nor appends `X-Forwarded-For`, so when Core's port is
 * reachable without a proxy that overwrites it, a caller can still pick its
 * own key and rotate it. Per-visitor limits are fairness only; the per-bot
 * caps and the engaged-result quota are the bound (see the README).
 */
export function visitorKey(peer: string | undefined, headers: Headers): string {
	if (peer && !LOOPBACK.test(peer)) {
		return peer;
	}
	const forwarded = headers
		.get("x-forwarded-for")
		?.split(",")
		.map((hop) => hop.trim())
		.filter(Boolean)
		.at(-1);
	return usableAddress(forwarded) ? forwarded : ANONYMOUS_VISITOR;
}

function frameAncestors(origins: string[]): string {
	return origins.length > 0 ? `'self' ${origins.join(" ")}` : "'none'";
}

export function htmlResponse(
	html: string,
	nonce: string,
	origins: string[],
	status = 200
): Response {
	const headers: Record<string, string> = {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			`style-src 'nonce-${nonce}'`,
			"img-src https: data:",
			"media-src https:",
			"frame-src https:",
			"connect-src 'self'",
			"form-action 'none'",
			"base-uri 'none'",
			`frame-ancestors ${frameAncestors(origins)}`,
		].join("; "),
		...SECURITY_HEADERS,
		vary: "Accept-Language",
	};
	if (origins.length === 0) {
		headers["x-frame-options"] = "DENY";
	}
	return new Response(html, { status, headers });
}

export function closedResponse(
	message: string,
	origins: string[],
	acceptLanguage: string | null
): Response {
	const page = renderClosedPage(message, { acceptLanguage });
	return htmlResponse(page.html, page.nonce, origins, 404);
}
