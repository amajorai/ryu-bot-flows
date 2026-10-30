import { afterEach, describe, expect, it } from "bun:test";
import {
	BOT_LIMITS,
	type BotDocument,
	jsonBodyBytes,
	type PreviewTurn,
	type PublicTurn,
	putKnowledgeSchema,
} from "./contracts.ts";
import type { BotHost } from "./host.ts";
import {
	ANONYMOUS_VISITOR,
	type BotFlowsServerOptions,
	createBotFlowsHandler,
	visitorKey,
} from "./server.ts";
import { BotFlowsStore } from "./store.ts";
import { autoAnswer, FIXED_NOW } from "./test-fixtures.ts";

const TOKEN = "bot-flows-test-token";
const ORIGIN = "http://bots.test";
const stores: BotFlowsStore[] = [];

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});

function start(options: Partial<BotFlowsServerOptions> = {}) {
	const store = new BotFlowsStore(":memory:");
	stores.push(store);
	const emitted: { event: string; payload: Record<string, unknown> }[] = [];
	const host: BotHost = {
		aiAvailable: true,
		complete: () => Promise.resolve("An AI answer"),
		emit: (event, payload) => {
			emitted.push({ event, payload });
			return Promise.resolve();
		},
	};
	const handler = createBotFlowsHandler({
		store,
		token: TOKEN,
		host,
		http: () => Promise.resolve({ status: 200, body: "{}" }),
		...options,
	});
	return { emitted, handler, store };
}

function request(
	path: string,
	init: RequestInit & { json?: unknown } = {}
): Request {
	const { json, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (json !== undefined) {
		headers.set("content-type", "application/json");
	}
	return new Request(new URL(path, ORIGIN), {
		...rest,
		headers,
		body: json === undefined ? rest.body : JSON.stringify(json),
	});
}

const admin = (path: string, init: RequestInit & { json?: unknown } = {}) =>
	request(`/api/bot-flows${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${TOKEN}`,
			...(init.headers as Record<string, string>),
		},
	});

async function createPublished(
	handler: ReturnType<typeof start>["handler"],
	body: Record<string, unknown> = {
		name: "Contact",
		templateId: "contact-form",
	}
): Promise<BotDocument> {
	const created = await handler(
		admin("/admin/bots", { method: "POST", json: body })
	);
	if (created.status !== 201) {
		throw new Error(`create failed: ${created.status}`);
	}
	const bot = (await created.json()) as BotDocument;
	const published = await handler(
		admin(`/admin/bots/${bot.id}/publish`, { method: "POST" })
	);
	if (published.status !== 200) {
		throw new Error(`publish failed: ${published.status}`);
	}
	return (await published.json()) as BotDocument;
}

async function converse(
	handler: ReturnType<typeof start>["handler"],
	slug: string,
	headers: Record<string, string> = {}
) {
	const started = await handler(
		request(`/api/bot-flows/${slug}/sessions`, {
			method: "POST",
			json: {},
			headers,
		})
	);
	if (started.status !== 201) {
		throw new Error(`start failed: ${started.status}`);
	}
	let turn = (await started.json()) as PublicTurn;
	const sessionId = turn.sessionId;
	while (!turn.done && turn.input) {
		const response = await handler(
			request(`/api/bot-flows/${slug}/sessions/${sessionId}/reply`, {
				method: "POST",
				json: { value: autoAnswer(turn.input) },
				headers,
			})
		);
		if (response.status !== 200) {
			throw new Error(`reply failed: ${response.status}`);
		}
		turn = (await response.json()) as PublicTurn;
	}
	return { sessionId, turn };
}

describe("admin API", () => {
	it("requires the Core bearer on admin routes and status", async () => {
		const { handler } = start();
		expect((await handler(request("/api/bot-flows/status"))).status).toBe(401);
		expect((await handler(request("/api/bot-flows/admin/bots"))).status).toBe(
			401
		);
		expect(
			(
				await handler(
					request("/api/bot-flows/admin/bots", {
						headers: { authorization: "Bearer wrong" },
					})
				)
			).status
		).toBe(401);
		const status = await handler(admin("/status"));
		expect(await status.json()).toEqual({
			status: "ready",
			botCount: 0,
			publishedCount: 0,
			aiAvailable: true,
		});
		expect((await handler(request("/health"))).status).toBe(200);
		const templates = await handler(admin("/admin/templates"));
		expect(((await templates.json()) as unknown[]).length).toBe(10);
		expect(
			(await handler(admin("/admin/bots", { method: "PATCH" }))).status
		).toBe(405);
		expect((await handler(admin("/admin/bots/x/nope"))).status).toBe(404);
	});

	it("saves drafts with optimistic revisions and reports publish issues", async () => {
		const { handler } = start();
		const created = (await (
			await handler(
				admin("/admin/bots", { method: "POST", json: { name: "Draft" } })
			)
		).json()) as BotDocument;
		const flow = structuredClone(created.flow);
		flow.edges.push({
			id: "bad",
			from: { blockId: "nope" },
			to: { groupId: "g_start" },
		});
		const saved = await handler(
			admin(`/admin/bots/${created.id}`, {
				method: "PUT",
				json: { revision: 0, flow },
			})
		);
		expect(saved.status).toBe(200);
		const stale = await handler(
			admin(`/admin/bots/${created.id}`, {
				method: "PUT",
				json: { revision: 0, name: "x" },
			})
		);
		expect(stale.status).toBe(409);
		const publish = await handler(
			admin(`/admin/bots/${created.id}/publish`, { method: "POST" })
		);
		expect(publish.status).toBe(400);
		const error = (await publish.json()) as {
			error: { code: string; issues: unknown[] };
		};
		expect(error.error.code).toBe("invalid_flow");
		expect(error.error.issues.length).toBeGreaterThan(0);
		const notJson = await handler(
			admin("/admin/bots", { method: "POST", body: "name=x" })
		);
		expect(notJson.status).toBe(415);
	});

	it("previews the draft without emitting events", async () => {
		const { handler, emitted } = start();
		const bot = (await (
			await handler(
				admin("/admin/bots", {
					method: "POST",
					json: { name: "Preview", templateId: "ai-faq" },
				})
			)
		).json()) as BotDocument;
		const started = await handler(
			admin(`/admin/bots/${bot.id}/preview`, { method: "POST" })
		);
		expect(started.status).toBe(201);
		let turn = (await started.json()) as PreviewTurn;
		expect(turn.input?.type).toBe("text_input");
		const replied = await handler(
			admin(`/admin/preview/${turn.sessionId}/reply`, {
				method: "POST",
				json: { value: "How do refunds work?" },
			})
		);
		turn = (await replied.json()) as PreviewTurn;
		expect(
			turn.messages.some(
				(message) =>
					message.type === "text" && message.content === "An AI answer"
			)
		).toBe(true);
		expect(turn.variables.question).toBe("How do refunds work?");
		expect(turn.logs.some((log) => log.kind === "ai")).toBe(true);
		expect(emitted).toEqual([]);
		expect((await handler(admin(`/admin/bots/${bot.id}/results`))).status).toBe(
			200
		);
		expect(
			(
				(await (
					await handler(admin(`/admin/bots/${bot.id}/results`))
				).json()) as { items: unknown[] }
			).items
		).toEqual([]);
	});
});

describe("public runtime", () => {
	it("serves the published bot, records results, and emits events", async () => {
		const { handler, emitted } = start();
		const bot = await createPublished(handler);
		const page = await handler(request(`/api/bot-flows/${bot.slug}`));
		expect(page.status).toBe(200);
		const csp = page.headers.get("content-security-policy") ?? "";
		expect(csp).toMatch(/script-src 'nonce-[a-f0-9]{32}'/);
		expect(csp).toMatch(/style-src 'nonce-[a-f0-9]{32}'/);
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("connect-src 'self'");
		expect(page.headers.get("x-frame-options")).toBe("DENY");
		const html = await page.text();
		const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(csp)?.[1];
		expect(html).toContain(`<script nonce="${nonce}">`);
		expect(html).not.toContain("innerHTML");

		const { turn } = await converse(handler, bot.slug);
		expect(turn.done).toBe(true);
		expect(emitted.map((entry) => entry.event)).toEqual([
			"handoff.requested",
			"conversation.completed",
		]);
		expect(emitted[0]?.payload).toMatchObject({
			bot_id: bot.id,
			bot_slug: bot.slug,
			topic: "sales",
		});
		expect(emitted[1]?.payload).toMatchObject({
			variables: { email: "ada@example.com" },
		});

		const results = (await (
			await handler(admin(`/admin/bots/${bot.id}/results`))
		).json()) as {
			items: { id: string; completedAt: string | null }[];
		};
		expect(results.items).toHaveLength(1);
		expect(results.items[0]?.completedAt).not.toBeNull();
		const detail = await handler(
			admin(`/admin/bots/${bot.id}/results/${results.items[0]?.id}`)
		);
		expect(
			((await detail.json()) as { handoffs: unknown[] }).handoffs
		).toHaveLength(1);
		const analytics = (await (
			await handler(admin(`/admin/bots/${bot.id}/analytics`))
		).json()) as {
			views: number;
			started: number;
			completed: number;
			blocks: { reached: number; answered: number }[];
		};
		expect(analytics).toMatchObject({ views: 1, started: 1, completed: 1 });
		expect(
			analytics.blocks.every(
				(block) => block.reached === 1 && block.answered === 1
			)
		).toBe(true);
	});

	it("allows framing only by configured origins", async () => {
		const { handler } = start();
		const bot = await createPublished(handler, { name: "Embeddable" });
		const embedNone = await handler(
			request(`/api/bot-flows/${bot.slug}?embed=1`)
		);
		expect(embedNone.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'none'"
		);
		const flow = structuredClone(bot.flow);
		flow.settings.allowedEmbedOrigins = ["https://shop.example.com"];
		await handler(
			admin(`/admin/bots/${bot.id}`, {
				method: "PUT",
				json: { revision: bot.revision, flow },
			})
		);
		await handler(admin(`/admin/bots/${bot.id}/publish`, { method: "POST" }));
		const embed = await handler(request(`/api/bot-flows/${bot.slug}?embed=1`));
		expect(embed.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'self' https://shop.example.com"
		);
		expect(embed.headers.get("x-frame-options")).toBeNull();
		expect(await embed.text()).not.toContain("Made with Ryu Bot Flows");
	});

	it("shows the closed page for unpublished and unknown bots", async () => {
		const { handler } = start();
		const bot = await createPublished(handler);
		const { sessionId } = await (async () => {
			const response = await handler(
				request(`/api/bot-flows/${bot.slug}/sessions`, {
					method: "POST",
					json: {},
				})
			);
			return (await response.json()) as PublicTurn;
		})();
		await handler(admin(`/admin/bots/${bot.id}/unpublish`, { method: "POST" }));
		const page = await handler(request(`/api/bot-flows/${bot.slug}`));
		expect(page.status).toBe(404);
		expect(await page.text()).toContain(
			bot.flow.settings.closedMessage.replaceAll("'", "&#39;")
		);
		const startClosed = await handler(
			request(`/api/bot-flows/${bot.slug}/sessions`, {
				method: "POST",
				json: {},
			})
		);
		expect(startClosed.status).toBe(404);
		expect(
			((await startClosed.json()) as { error: { code: string } }).error.code
		).toBe("closed");
		const replyClosed = await handler(
			request(`/api/bot-flows/${bot.slug}/sessions/${sessionId}/reply`, {
				method: "POST",
				json: { value: "x" },
			})
		);
		expect(replyClosed.status).toBe(404);
		expect((await handler(request("/api/bot-flows/unknown-bot"))).status).toBe(
			404
		);
	});

	it("rejects replies for another bot, expired sessions, and finished conversations", async () => {
		let now = FIXED_NOW;
		const { handler } = start({ now: () => now });
		const first = await createPublished(handler);
		const second = await createPublished(handler, {
			name: "Other",
			templateId: "blank",
		});
		const started = (await (
			await handler(
				request(`/api/bot-flows/${first.slug}/sessions`, {
					method: "POST",
					json: {},
				})
			)
		).json()) as PublicTurn;
		const wrongBot = await handler(
			request(
				`/api/bot-flows/${second.slug}/sessions/${started.sessionId}/reply`,
				{ method: "POST", json: { value: "Ada" } }
			)
		);
		expect(wrongBot.status).toBe(410);
		const unknown = await handler(
			request(`/api/bot-flows/${first.slug}/sessions/s_does_not_exist/reply`, {
				method: "POST",
				json: { value: "Ada" },
			})
		);
		expect(unknown.status).toBe(410);
		now = new Date(FIXED_NOW.getTime() + 25 * 60 * 60 * 1000);
		const expired = await handler(
			request(
				`/api/bot-flows/${first.slug}/sessions/${started.sessionId}/reply`,
				{ method: "POST", json: { value: "Ada" } }
			)
		);
		expect(expired.status).toBe(410);
		now = FIXED_NOW;
		const { sessionId } = await converse(handler, first.slug);
		const finished = await handler(
			request(`/api/bot-flows/${first.slug}/sessions/${sessionId}/reply`, {
				method: "POST",
				json: { value: "Ada" },
			})
		);
		expect(finished.status).toBe(409);
	});

	it("rate-limits starts per visitor and per bot", async () => {
		const { handler } = start({
			rateLimits: { startsPerVisitor: 2, startsPerBot: 3 },
		});
		const bot = await createPublished(handler);
		const startFrom = (ip: string) =>
			handler(
				request(`/api/bot-flows/${bot.slug}/sessions`, {
					method: "POST",
					json: {},
					headers: { "x-forwarded-for": `198.51.100.9, ${ip}` },
				})
			);
		expect((await startFrom("203.0.113.1")).status).toBe(201);
		expect((await startFrom("203.0.113.1")).status).toBe(201);
		const limited = await startFrom("203.0.113.1");
		expect(limited.status).toBe(429);
		expect(
			((await limited.json()) as { error: { code: string } }).error.code
		).toBe("rate_limited");
		expect((await startFrom("203.0.113.2")).status).toBe(201);
		expect((await startFrom("203.0.113.3")).status).toBe(429);
	});

	it("rate-limits replies per visitor", async () => {
		const { handler } = start({ rateLimits: { repliesPerVisitor: 1 } });
		const bot = await createPublished(handler);
		const headers = { "x-forwarded-for": "203.0.113.50" };
		const started = (await (
			await handler(
				request(`/api/bot-flows/${bot.slug}/sessions`, {
					method: "POST",
					json: {},
					headers,
				})
			)
		).json()) as PublicTurn;
		const reply = () =>
			handler(
				request(
					`/api/bot-flows/${bot.slug}/sessions/${started.sessionId}/reply`,
					{
						method: "POST",
						json: { value: "Ada" },
						headers,
					}
				)
			);
		expect((await reply()).status).toBe(200);
		expect((await reply()).status).toBe(429);
	});

	it("silently drops honeypot starts", async () => {
		const { handler, store } = start();
		const bot = await createPublished(handler);
		const response = await handler(
			request(`/api/bot-flows/${bot.slug}/sessions`, {
				method: "POST",
				json: { website: "spam.example" },
			})
		);
		expect(response.status).toBe(201);
		const turn = (await response.json()) as PublicTurn;
		expect(turn).toMatchObject({ done: true, messages: [], input: null });
		expect(store.results(bot.id, null).items).toEqual([]);
		const notJson = await handler(
			request(`/api/bot-flows/${bot.slug}/sessions`, {
				method: "POST",
				body: "x",
			})
		);
		expect(notJson.status).toBe(415);
		const tooBig = await handler(
			request(`/api/bot-flows/${bot.slug}/sessions`, {
				method: "POST",
				json: { hidden: { a: "x".repeat(9000) } },
			})
		);
		expect(tooBig.status).toBe(413);
	});

	it("serves embed.js as cacheable JavaScript", async () => {
		const { handler } = start();
		const bot = await createPublished(handler);
		const script = await handler(
			request(`/api/bot-flows/${bot.slug}/embed.js`)
		);
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toBe(
			"text/javascript; charset=utf-8"
		);
		expect(script.headers.get("cache-control")).toBe("public, max-age=300");
		expect(await script.text()).toContain(
			"window.RyuBotFlows = { init: init }"
		);
		expect(
			(await handler(request("/api/bot-flows/missing-bot/embed.js"))).status
		).toBe(404);
	});

	it("escapes hostile bot names in the hosted page", async () => {
		const { handler } = start();
		const hostile =
			"</script><script>alert(1)</script><img src=x onerror=alert(2)>";
		const created = (await (
			await handler(
				admin("/admin/bots", { method: "POST", json: { name: "Hostile" } })
			)
		).json()) as BotDocument;
		const flow = structuredClone(created.flow);
		flow.theme.botName = hostile;
		flow.theme.avatarUrl = "javascript:alert(3)";
		await handler(
			admin(`/admin/bots/${created.id}`, {
				method: "PUT",
				json: { revision: 0, flow },
			})
		);
		await handler(
			admin(`/admin/bots/${created.id}/publish`, { method: "POST" })
		);
		const html = await (
			await handler(request(`/api/bot-flows/${created.slug}`))
		).text();
		expect(html).not.toContain("<script>alert(1)");
		expect(html).not.toContain("<img src=x");
		expect(html).not.toContain("javascript:alert(3)");
		expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)");
		expect(html).toContain("\\u003c/script\\u003e");
	});

	it("exports CSV with spreadsheet formulas neutralized", async () => {
		const { handler } = start();
		const bot = await createPublished(handler);
		const started = (await (
			await handler(
				request(`/api/bot-flows/${bot.slug}/sessions`, {
					method: "POST",
					json: {},
				})
			)
		).json()) as PublicTurn;
		await handler(
			request(
				`/api/bot-flows/${bot.slug}/sessions/${started.sessionId}/reply`,
				{
					method: "POST",
					json: { value: '=HYPERLINK("https://evil.example","x")' },
				}
			)
		);
		const csv = await handler(admin(`/admin/bots/${bot.id}/export`));
		expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		const text = await csv.text();
		expect(text.split("\r\n")[0]).toBe(
			'"result_id","started_at","completed_at","name","email","topic","message","handoff_topics","last_block_id"'
		);
		expect(text).toContain('"\'=HYPERLINK(""https://evil.example"",""x"")"');
		const table = (await (
			await handler(admin(`/admin/bots/${bot.id}/export?format=json`))
		).json()) as {
			rows: string[][];
		};
		expect(table.rows[0]?.[3]).toBe('=HYPERLINK("https://evil.example","x")');
	});
});

describe("visitorKey", () => {
	it("uses the peer, else the right-most forwarded hop from loopback", () => {
		expect(
			visitorKey("203.0.113.7", new Headers({ "x-forwarded-for": "1.1.1.1" }))
		).toBe("203.0.113.7");
		expect(
			visitorKey(
				"127.0.0.1",
				new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.8" })
			)
		).toBe("203.0.113.8");
		expect(
			visitorKey("127.0.0.1", new Headers({ "x-forwarded-for": "2001:db8::1" }))
		).toBe("2001:db8::1");
	});

	it("maps a missing or unusable forwarded hop to one anonymous bucket", () => {
		for (const forwarded of [
			undefined,
			"not an ip",
			"127.0.0.1",
			"999.1.1.1",
			"::",
			"example.com",
		]) {
			const headers = new Headers(
				forwarded ? { "x-forwarded-for": forwarded } : {}
			);
			expect(visitorKey("127.0.0.1", headers)).toBe(ANONYMOUS_VISITOR);
			expect(visitorKey(undefined, headers)).toBe(ANONYMOUS_VISITOR);
		}
	});
});

describe("review regressions", () => {
	it("answers a slug collision with 422, distinct from a stale-revision 409", async () => {
		const { handler } = start();
		const first = await handler(
			admin("/admin/bots", {
				method: "POST",
				json: { name: "First", slug: "taken-link" },
			})
		);
		expect(first.status).toBe(201);
		const second = await handler(
			admin("/admin/bots", {
				method: "POST",
				json: { name: "Second", slug: "taken-link" },
			})
		);
		// Over the Ryu host bridge only this status reaches the editor.
		expect(second.status).toBe(422);
		const body = (await second.json()) as { error: { code: string } };
		expect(body.error.code).toBe("slug_taken");
	});

	it("rate-limits callers without X-Forwarded-For as one visitor", async () => {
		const { handler } = start({ rateLimits: { startsPerVisitor: 2 } });
		const bot = await createPublished(handler);
		const startAnonymously = () =>
			handler(
				request(`/api/bot-flows/${bot.slug}/sessions`, {
					method: "POST",
					json: {},
				})
			);
		expect((await startAnonymously()).status).toBe(201);
		expect((await startAnonymously()).status).toBe(201);
		expect((await startAnonymously()).status).toBe(429);
	});

	it("does not let unanswered starts fill the result quota", async () => {
		const { handler, store } = start({
			rateLimits: { startsPerVisitor: 10_000, startsPerBot: 10_000 },
		});
		const bot = await createPublished(handler);
		store.db
			.query(
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
				 INSERT INTO results (id, bot_id, is_preview, started_at, updated_at, completed_at, last_block_id,
				 answers_json, variables_json, transcript_json, handoffs_json, logs_json, events_json)
				 SELECT 'r_empty_' || i, ?, 0, ?, ?, NULL, NULL, '[]', '{}', '[]', '[]', '[]', '[]' FROM n`
			)
			.run(
				BOT_LIMITS.resultsPerBot,
				bot.id,
				FIXED_NOW.toISOString(),
				FIXED_NOW.toISOString()
			);
		const { turn } = await converse(handler, bot.slug);
		expect(turn.done).toBe(true);
	});

	it("never discards a start that already ran when the quota fills concurrently", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { handler, store, emitted } = start({
			host: {
				aiAvailable: true,
				complete: async () => {
					await gate;
					return "Hello";
				},
				emit: (event, payload) => {
					emitted.push({ event, payload });
					return Promise.resolve();
				},
			},
		});
		const created = (await (
			await handler(
				admin("/admin/bots", { method: "POST", json: { name: "Concurrent" } })
			)
		).json()) as BotDocument;
		const flow = structuredClone(created.flow);
		const [group] = flow.groups;
		if (!group) {
			throw new Error("blank flow has a group");
		}
		group.blocks = [
			{
				id: "b_ai",
				type: "ai_reply",
				instructions: "",
				promptTemplate: "Greet",
				useKnowledge: false,
				maxChars: 200,
			},
			{
				id: "b_handoff",
				type: "handoff",
				topic: "sales",
				summaryTemplate: "New visitor",
				message: "",
			},
		];
		flow.edges = [];
		flow.variables = [];
		const saved = await handler(
			admin(`/admin/bots/${created.id}`, {
				method: "PUT",
				json: { revision: 0, flow },
			})
		);
		expect(saved.status).toBe(200);
		const published = await handler(
			admin(`/admin/bots/${created.id}/publish`, { method: "POST" })
		);
		expect(published.status).toBe(200);
		store.db
			.query(
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
				 INSERT INTO results (id, bot_id, is_preview, started_at, updated_at, completed_at, last_block_id,
				 answers_json, variables_json, transcript_json, handoffs_json, logs_json, events_json)
				 SELECT 'r_full_' || i, ?, 0, ?, ?, NULL, NULL, '[{"blockId":"b","value":"x"}]', '{}', '[]', '[]', '[]', '[]' FROM n`
			)
			.run(
				BOT_LIMITS.resultsPerBot - 1,
				created.id,
				FIXED_NOW.toISOString(),
				FIXED_NOW.toISOString()
			);
		const startOne = (ip: string) =>
			handler(
				request(`/api/bot-flows/${created.slug}/sessions`, {
					method: "POST",
					json: {},
					headers: { "x-forwarded-for": ip },
				})
			);
		const pending = [startOne("203.0.113.1"), startOne("203.0.113.2")];
		release();
		const statuses = (await Promise.all(pending)).map(
			(response) => response.status
		);
		expect(statuses).toEqual([201, 201]);
		const handoffs = emitted.filter(
			(entry) => entry.event === "handoff.requested"
		);
		expect(handoffs).toHaveLength(2);
		for (const handoff of handoffs) {
			const resultId = String(handoff.payload.result_id);
			expect(store.result(created.id, resultId).id).toBe(resultId);
		}
		// Once the quota is reached, a start is refused before the engine runs.
		store.db
			.query("UPDATE results SET answers_json=? WHERE bot_id=?")
			.run('[{"blockId":"b","value":"x"}]', created.id);
		const before = emitted.length;
		const refused = await startOne("203.0.113.3");
		expect(refused.status).toBe(429);
		expect(emitted.length).toBe(before);
	});

	it("publishes only the revision the editor saw", async () => {
		const { handler } = start();
		const created = (await (
			await handler(
				admin("/admin/bots", { method: "POST", json: { name: "Seen" } })
			)
		).json()) as BotDocument;
		await handler(
			admin(`/admin/bots/${created.id}`, {
				method: "PUT",
				json: { revision: 0, name: "Changed elsewhere" },
			})
		);
		const stale = await handler(
			admin(`/admin/bots/${created.id}/publish`, {
				method: "POST",
				json: { revision: 0 },
			})
		);
		expect(stale.status).toBe(409);
		expect(
			((await stale.json()) as { error: { code: string } }).error.code
		).toBe("conflict");
		const fresh = await handler(
			admin(`/admin/bots/${created.id}/publish`, {
				method: "POST",
				json: { revision: 1 },
			})
		);
		expect(fresh.status).toBe(200);
	});

	it("deletes results through the owner routes", async () => {
		const { handler } = start();
		const bot = await createPublished(handler);
		await converse(handler, bot.slug);
		await converse(handler, bot.slug);
		const list = async () =>
			(
				(await (
					await handler(admin(`/admin/bots/${bot.id}/results`))
				).json()) as { items: { id: string }[] }
			).items;
		const [first] = await list();
		const removed = await handler(
			admin(`/admin/bots/${bot.id}/results/${first?.id}`, { method: "DELETE" })
		);
		expect(removed.status).toBe(200);
		expect(
			(
				await handler(
					admin(`/admin/bots/${bot.id}/results/${first?.id}`, {
						method: "DELETE",
					})
				)
			).status
		).toBe(404);
		const cleared = await handler(
			admin(`/admin/bots/${bot.id}/results`, { method: "DELETE" })
		);
		expect(await cleared.json()).toEqual({ deleted: 1 });
		expect(await list()).toEqual([]);
	});

	it("accepts knowledge up to the manifest body limit and refuses more", async () => {
		const { handler } = start();
		const created = (await (
			await handler(
				admin("/admin/bots", { method: "POST", json: { name: "Docs" } })
			)
		).json()) as BotDocument;
		const articles = Array.from(
			{ length: BOT_LIMITS.knowledgeArticles },
			(_, index) => ({
				title: `Article ${index}`,
				body: "x".repeat(BOT_LIMITS.knowledgeBody),
			})
		);
		expect(jsonBodyBytes({ articles })).toBeLessThanOrEqual(
			BOT_LIMITS.maxBodyBytes
		);
		const full = await handler(
			admin(`/admin/bots/${created.id}/knowledge`, {
				method: "PUT",
				json: { articles },
			})
		);
		expect(full.status).toBe(200);
		const wide = articles.map((article) => ({
			...article,
			body: "\u00e9".repeat(BOT_LIMITS.knowledgeBody),
		}));
		expect(
			putKnowledgeSchema.safeParse({ articles: wide.slice(0, 30) }).success
		).toBe(false);
		const tooLarge = await handler(
			admin(`/admin/bots/${created.id}/knowledge`, {
				method: "PUT",
				json: { articles: wide },
			})
		);
		expect(tooLarge.status).toBe(413);
	});
});
