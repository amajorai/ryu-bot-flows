import { describe, expect, it } from "bun:test";
import {
	assertSafeUrl,
	createGuardedHttp,
	HttpGuardError,
	isBlockedAddress,
	parseIpv6,
	type Resolver,
} from "./http-guard.ts";

const publicResolver: Resolver = () => Promise.resolve(["93.184.215.14"]);
const resolverFor =
	(addresses: string[]): Resolver =>
	() =>
		Promise.resolve(addresses);

const request = (url: string) => ({
	method: "GET",
	url,
	headers: {},
	body: null,
	timeoutMs: 1000,
});

describe("address classification", () => {
	it("blocks loopback, private, link-local, CGNAT, metadata, and reserved IPv4", () => {
		for (const address of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
			"198.18.0.1",
		]) {
			expect([address, isBlockedAddress(address)]).toEqual([address, true]);
		}
		for (const address of [
			"93.184.215.14",
			"8.8.8.8",
			"172.32.0.1",
			"100.128.0.1",
		]) {
			expect([address, isBlockedAddress(address)]).toEqual([address, false]);
		}
	});

	it("blocks IPv6 loopback, ULA, link-local, multicast, and embedded private IPv4", () => {
		for (const address of [
			"::1",
			"::",
			"fc00::1",
			"fd00:ec2::254",
			"fe80::1",
			"ff02::1",
			"::ffff:127.0.0.1",
			"::ffff:a9fe:a9fe",
			"64:ff9b::10.0.0.1",
			"2002:c0a8:0101::1",
			"2001:db8::1",
			"[::1]",
			"not-an-ip",
		]) {
			expect([address, isBlockedAddress(address)]).toEqual([address, true]);
		}
		for (const address of [
			"2606:4700:4700::1111",
			"2001:4860:4860::8888",
			"::ffff:8.8.8.8",
		]) {
			expect([address, isBlockedAddress(address)]).toEqual([address, false]);
		}
		expect(parseIpv6("1::2::3")).toBeNull();
		expect(parseIpv6("fe80::1%eth0")).toBeNull();
	});
});

describe("assertSafeUrl", () => {
	it("requires https and rejects credentials and local names", async () => {
		await expect(
			assertSafeUrl("http://example.com", publicResolver)
		).rejects.toThrow("https");
		await expect(
			assertSafeUrl("https://user:pw@example.com", publicResolver)
		).rejects.toThrow("Credentials");
		await expect(
			assertSafeUrl("https://localhost/x", publicResolver)
		).rejects.toThrow("local host");
		await expect(
			assertSafeUrl("https://intranet/x", publicResolver)
		).rejects.toThrow("local host");
		await expect(
			assertSafeUrl("https://metadata.google.internal/x", publicResolver)
		).rejects.toThrow("local host");
		await expect(assertSafeUrl("not a url", publicResolver)).rejects.toThrow(
			HttpGuardError
		);
		expect(
			(await assertSafeUrl("https://api.example.com/x", publicResolver))
				.hostname
		).toBe("api.example.com");
	});

	it("rejects literal and resolved private addresses", async () => {
		await expect(
			assertSafeUrl("https://127.0.0.1/", publicResolver)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://2130706433/", publicResolver)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://[::1]/", publicResolver)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://[fd00::1]/", publicResolver)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://169.254.169.254/latest/meta-data", publicResolver)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl(
				"https://rebind.example.com/",
				resolverFor(["93.184.215.14", "10.0.0.5"])
			)
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://nothing.example.com/", resolverFor([]))
		).rejects.toThrow("private");
		await expect(
			assertSafeUrl("https://broken.example.com/", () =>
				Promise.reject(new Error("ENOTFOUND"))
			)
		).rejects.toThrow("resolved");
	});
});

describe("createGuardedHttp", () => {
	it("does not follow redirects", async () => {
		let redirectMode: RequestRedirect | undefined;
		const http = createGuardedHttp({
			resolver: publicResolver,
			fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
				redirectMode = init?.redirect;
				return Promise.resolve(Response.redirect("http://127.0.0.1/", 302));
			}) as typeof fetch,
		});
		await expect(http(request("https://api.example.com/"))).rejects.toThrow(
			"Redirects"
		);
		expect(redirectMode).toBe("manual");
	});

	it("caps response size and strips hop-by-hop headers", async () => {
		let sentHeaders: Headers | undefined;
		const http = createGuardedHttp({
			resolver: publicResolver,
			fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
				sentHeaders = new Headers(init?.headers);
				return Promise.resolve(new Response("x".repeat(300_000)));
			}) as typeof fetch,
		});
		await expect(
			http({
				...request("https://api.example.com/"),
				headers: { Host: "evil", "x-ok": "1" },
			})
		).rejects.toThrow("256 KiB");
		expect(sentHeaders?.get("host")).toBeNull();
		expect(sentHeaders?.get("x-ok")).toBe("1");

		const small = createGuardedHttp({
			resolver: publicResolver,
			fetchImpl: (() =>
				Promise.resolve(
					new Response('{"ok":true}', { status: 201 })
				)) as unknown as typeof fetch,
		});
		expect(await small(request("https://api.example.com/"))).toEqual({
			status: 201,
			body: '{"ok":true}',
		});
	});

	it("never fetches a blocked URL", async () => {
		let called = false;
		const http = createGuardedHttp({
			resolver: resolverFor(["192.168.0.10"]),
			fetchImpl: (() => {
				called = true;
				return Promise.resolve(new Response("secret"));
			}) as unknown as typeof fetch,
		});
		await expect(
			http(request("https://router.example.com/admin"))
		).rejects.toThrow("private");
		expect(called).toBe(false);
	});
});
