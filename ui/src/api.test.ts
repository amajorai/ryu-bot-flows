import { afterEach, describe, expect, test } from "bun:test";
import {
	BODY_TOO_LARGE_MESSAGE,
	BOT_LIMITS,
	type Flow,
	flowErrors,
} from "../../sidecar/src/contracts.ts";
import { listTemplates } from "../../sidecar/src/templates.ts";
import {
	BotFlowsRequestError,
	BRIDGE_UNAVAILABLE,
	botFlowsApi,
	bridgeStatus,
	embedSnippet,
	exportCsv,
	normalizeEmbedOrigin,
	safeFilename,
	shareLocationForBot,
} from "./api.ts";

interface Call {
	body?: unknown;
	method?: string;
	path: string;
}

const originalRyu = globalThis.window;

function installBridge(
	respond: (call: Call) => unknown,
	extra: Record<string, unknown> = {}
): Call[] {
	const calls: Call[] = [];
	const request = async (call: Call) => {
		calls.push(call);
		return respond(call);
	};
	(globalThis as { window?: unknown }).window = {
		ryu: { app: { request }, ...extra },
	};
	return calls;
}

afterEach(() => {
	(globalThis as { window?: unknown }).window = originalRyu;
});

const botDocument = {
	id: "bot_1",
	slug: "support",
	name: "Support",
	status: "draft",
	flow: listTemplates()[0]?.flow,
	revision: 3,
	publishedAt: null,
	hasUnpublishedChanges: false,
	createdAt: "2026-10-19T10:00:00.000Z",
	updatedAt: "2026-10-19T10:00:00.000Z",
};

describe("bridge requests", () => {
	test("fails clearly outside Ryu", async () => {
		(globalThis as { window?: unknown }).window = {};
		await expect(botFlowsApi.list()).rejects.toThrow(BRIDGE_UNAVAILABLE);
	});

	test("sends mount-relative paths, methods and bodies", async () => {
		const calls = installBridge(() => botDocument);
		await botFlowsApi.save("bot 1", { revision: 3, name: "New name" });
		await botFlowsApi.setPublished("bot_1", true);
		await botFlowsApi.setPublished("bot_1", true, {
			flow: botDocument.flow as Flow,
			revision: 3,
		});
		await botFlowsApi.setPublished("bot_1", false);
		expect(calls).toEqual([
			{
				path: "/admin/bots/bot%201",
				method: "PUT",
				body: { revision: 3, name: "New name" },
			},
			{ path: "/admin/bots/bot_1/publish", method: "POST" },
			{
				path: "/admin/bots/bot_1/publish",
				method: "POST",
				body: { revision: 3 },
			},
			{ path: "/admin/bots/bot_1/unpublish", method: "POST" },
		]);
	});

	test("paginates results and exports JSON for client-side CSV", async () => {
		const calls = installBridge((call) =>
			call.path.includes("/export")
				? { columns: ["a"], rows: [["=1+1"]] }
				: { items: [], nextCursor: null }
		);
		await botFlowsApi.results("bot_1", "abc/=");
		const table = await botFlowsApi.exportTable("bot_1");
		expect(calls.map((call) => call.path)).toEqual([
			"/admin/bots/bot_1/results?limit=25&cursor=abc%2F%3D",
			"/admin/bots/bot_1/export?format=json",
		]);
		expect(exportCsv(table)).toBe('"a"\r\n"\'=1+1"\r\n');
	});

	test("preview start omits empty hidden values", async () => {
		const calls = installBridge(() => ({
			sessionId: "s",
			messages: [],
			input: null,
			redirect: null,
			done: true,
			expiresAt: "2026-10-20T10:00:00.000Z",
			resultId: "r",
			variables: {},
			logs: [],
			handoffs: [],
		}));
		const turn = await botFlowsApi.previewStart("bot_1");
		await botFlowsApi.previewReply("s/1", ["a", "b"]);
		expect(turn.done).toBe(true);
		expect(calls).toEqual([
			{ path: "/admin/bots/bot_1/preview", method: "POST", body: {} },
			{
				path: "/admin/preview/s%2F1/reply",
				method: "POST",
				body: { value: ["a", "b"] },
			},
		]);
	});

	test("maps sidecar error bodies, returned or thrown, with flow issues", async () => {
		const body = {
			error: {
				code: "invalid_flow",
				message: "Fix the flow before publishing.",
				issues: [{ blockId: "b", message: "Broken", severity: "error" }],
			},
		};
		installBridge(() => body);
		const returned = await botFlowsApi
			.setPublished("bot_1", true)
			.catch((error: unknown) => error);
		expect(returned).toBeInstanceOf(BotFlowsRequestError);
		expect((returned as BotFlowsRequestError).issues).toHaveLength(1);

		installBridge(() => {
			throw Object.assign(new Error("409"), {
				body: { error: { code: "conflict", message: "Changed elsewhere." } },
			});
		});
		const thrown = await botFlowsApi
			.save("bot_1", { revision: 1 })
			.catch((error: unknown) => error);
		expect((thrown as BotFlowsRequestError).code).toBe("conflict");
		expect((thrown as Error).message).toBe("Changed elsewhere.");
	});

	// The real host bridge (Desktop ApiError -> toRpcError -> frame bootstrap)
	// rejects with only "<proxy path> failed: <status>" and a generic code.
	function hostRejection(status: number): Error {
		return Object.assign(
			new Error(`/api/ext/@ryu/bot-flows/admin/bots/bot_1 failed: ${status}`),
			{ code: "server_error" }
		);
	}

	test("maps the real bridge's bare status rejections to sidecar codes", async () => {
		installBridge(() => {
			throw hostRejection(409);
		});
		const conflict = await botFlowsApi
			.save("bot_1", { revision: 1 })
			.catch((error: unknown) => error);
		expect(conflict).toBeInstanceOf(BotFlowsRequestError);
		expect((conflict as BotFlowsRequestError).code).toBe("conflict");
		expect((conflict as BotFlowsRequestError).status).toBe(409);
		expect((conflict as Error).message).not.toContain("/api/ext");

		installBridge(() => {
			throw hostRejection(422);
		});
		const slug = await botFlowsApi
			.save("bot_1", { revision: 1, slug: "taken" })
			.catch((error: unknown) => error);
		expect((slug as BotFlowsRequestError).code).toBe("slug_taken");
		expect((slug as Error).message).toBe("This link is already in use.");
	});

	test("a bare 400 from publish lists the flow's own errors", async () => {
		const broken = {
			...(botDocument.flow as Flow),
			startGroupId: "missing_group",
		};
		expect(flowErrors(broken).length).toBeGreaterThan(0);
		installBridge(() => {
			throw hostRejection(400);
		});
		const error = (await botFlowsApi
			.setPublished("bot_1", true, { flow: broken, revision: 2 })
			.catch((cause: unknown) => cause)) as BotFlowsRequestError;
		expect(error.issues).toEqual(flowErrors(broken));
		expect(error.message).toBe(flowErrors(broken)[0]?.message ?? "");
		expect(bridgeStatus(new Error("offline"))).toBeNull();
	});

	test("refuses an oversized body before it reaches the bridge", async () => {
		const calls = installBridge(() => botDocument);
		const error = await botFlowsApi
			.saveKnowledge("bot_1", [
				{ title: "Big", body: "x".repeat(BOT_LIMITS.maxBodyBytes + 1) },
			])
			.catch((cause: unknown) => cause);
		expect((error as BotFlowsRequestError).code).toBe("too_large");
		expect((error as Error).message).toBe(BODY_TOO_LARGE_MESSAGE);
		expect(calls).toEqual([]);
	});

	test("rejects responses that do not match the contract", async () => {
		installBridge(() => ({ unexpected: true }));
		await expect(botFlowsApi.detail("bot_1")).rejects.toThrow(
			"unexpected response"
		);
	});
});

describe("share links and snippets", () => {
	test("prefers the active reachable http origin", async () => {
		installBridge(() => null, {
			node: {
				shareOrigins: async () => [
					{ origin: "https://mesh.example", reachable: true, source: "mesh" },
					{ origin: "ftp://bad.example", reachable: true, source: "active" },
					{ origin: "https://node.example", reachable: true, source: "active" },
				],
			},
		});
		expect(await shareLocationForBot("support")).toEqual({
			path: "/bots/support",
			url: "https://node.example/bots/support",
		});
	});

	test("falls back to the path without a reachable origin", async () => {
		installBridge(() => null, {
			node: {
				shareOrigins: async () => {
					throw new Error("offline");
				},
			},
		});
		expect(await shareLocationForBot("support")).toEqual({
			path: "/bots/support",
			url: null,
		});
	});

	test("builds the three embed modes with escaped values", () => {
		const base = "https://node.example/bots/support";
		expect(embedSnippet("standard", base, "support")).toBe(
			'<div id="ryu-bot-support" style="height: 600px"></div>\n<script src="https://node.example/bots/support/embed.js"></script>\n<script>\n  RyuBotFlows.init({ mode: "standard", target: "#ryu-bot-support" });\n</script>'
		);
		expect(
			embedSnippet("bubble", base, "support", ["utm_source", "user_id"])
		).toBe(
			'<script src="https://node.example/bots/support/embed.js"></script>\n<script>\n  RyuBotFlows.init({ mode: "bubble", hidden: { utm_source: "", user_id: "" } });\n</script>'
		);
		const popup = embedSnippet("popup", 'https://x.example/"><script>', "a-b");
		expect(popup).toContain("&quot;&gt;&lt;script&gt;/embed.js");
		expect(popup).toContain('mode: "popup"');
	});

	test("normalizes allowed embed origins", () => {
		expect(normalizeEmbedOrigin(" https://Example.com/ ")).toBe(
			"https://example.com"
		);
		expect(normalizeEmbedOrigin("https://example.com:8443")).toBe(
			"https://example.com:8443"
		);
		expect(normalizeEmbedOrigin("http://example.com")).toBeNull();
		expect(normalizeEmbedOrigin("https://example.com/path")).toBeNull();
		expect(normalizeEmbedOrigin("not a url")).toBeNull();
		expect(normalizeEmbedOrigin("")).toBeNull();
	});

	test("safe filenames", () => {
		expect(safeFilename("Support bot / EU")).toBe("Support-bot-EU");
		expect(safeFilename("???")).toBe("bot");
	});
});
