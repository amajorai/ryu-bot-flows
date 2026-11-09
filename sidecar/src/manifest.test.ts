import { expect, test } from "bun:test";
import { z } from "zod";
import { BOT_LIMITS } from "./contracts.ts";
import { createBotFlowsHandler } from "./server.ts";
import { BotFlowsStore } from "./store.ts";

const manifest = await Bun.file(
	new URL("../../manifest.json", import.meta.url)
).json();

const routes = z
	.array(
		z.object({
			auth: z.string().optional(),
			method: z.string(),
			path: z.string(),
			permission: z.string().optional(),
		})
	)
	.parse(manifest.sidecars[0].http.routes);

test("Bot Flows manifest declares the sidecar, grants, and events", () => {
	expect(manifest.id).toBe("@ryu/bot-flows");
	expect(manifest.sidecars).toHaveLength(1);
	const [sidecar] = manifest.sidecars;
	expect(sidecar.process.command).toBe("ryu-bot-flows");
	expect(sidecar.process.port_env).toBe("RYU_BOT_FLOWS_PORT");
	expect(sidecar.port).toBe(8028);
	expect(sidecar.http.mount).toBe("/api/bot-flows");
	expect(sidecar.http.public_mount).toBe("/bots");
	expect(sidecar.host_api.grants).toEqual(["hook:side-model"]);
	expect(manifest.permission_grants).toEqual([
		"app:http",
		"hook:side-model",
		"assistant:context",
	]);
	expect(
		manifest.contributes.hook_events.map((event: { id: string }) => event.id)
	).toEqual([
		"@ryu/bot-flows#conversation.completed",
		"@ryu/bot-flows#handoff.requested",
	]);
});

test("only the hosted page, embed script, and conversation routes are public", () => {
	expect(routes.filter((route) => route.auth === "public")).toEqual([
		{ path: "/:slug", method: "GET", auth: "public" },
		{ path: "/:slug/embed.js", method: "GET", auth: "public" },
		{ path: "/:slug/sessions", method: "POST", auth: "public" },
		{
			path: "/:slug/sessions/:sessionId/reply",
			method: "POST",
			auth: "public",
		},
	]);
	for (const route of routes.filter(
		(candidate) => candidate.auth !== "public"
	)) {
		expect([route.path, route.permission?.startsWith("bot-flows.")]).toEqual([
			route.path,
			true,
		]);
		const manage = route.method !== "GET";
		expect([route.method, route.path, route.permission]).toEqual([
			route.method,
			route.path,
			manage ? "bot-flows.manage" : "bot-flows.view",
		]);
	}
});

test("the sidecar serves exactly the manifest routes", () => {
	const store = new BotFlowsStore(":memory:");
	try {
		const handler = createBotFlowsHandler({ store, token: "t" });
		const key = (route: { method: string; path: string }) =>
			`${route.method} ${route.path}`;
		expect(handler.routes.map(key).sort()).toEqual(routes.map(key).sort());
	} finally {
		store.close();
	}
});

test("the contracts' body limit is the one Core enforces for every route", () => {
	// Core's ext-proxy refuses any body over `http.max_body_bytes` (public and
	// admin routes alike) before the sidecar sees it.
	expect(manifest.sidecars[0].http.max_body_bytes).toBe(
		BOT_LIMITS.maxBodyBytes
	);
	expect(BOT_LIMITS.publicBodyBytes).toBeLessThan(BOT_LIMITS.maxBodyBytes);
});
