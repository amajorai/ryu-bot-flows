import { describe, expect, it } from "bun:test";
import { type Block, BOT_LIMITS, type InputBlock } from "./contracts.ts";
import {
	readJsonPath,
	reply,
	startSession,
	validateInput,
	videoEmbedUrl,
} from "./engine.ts";
import { edge, FIXED_NOW, testDeps, testFlow, texts } from "./test-fixtures.ts";

const ask = (block: InputBlock) =>
	testFlow({
		variables: ["answer"],
		groups: [
			{
				id: "start",
				blocks: [
					{ ...block, saveTo: "answer" } as Block,
					{ id: "bye", type: "text", content: "Got {{answer}}" },
				],
			},
		],
	});

describe("bubbles", () => {
	it("renders text with variables, media with https only, and waits", async () => {
		const flow = testFlow({
			variables: [{ id: "name", name: "name", hidden: true }],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "t1", type: "text", content: "Hi **{{name}}** {{missing}}" },
						{
							id: "img",
							type: "image",
							url: "https://example.com/a.png",
							alt: "A",
						},
						{
							id: "bad",
							type: "image",
							url: "http://example.com/a.png",
							alt: "insecure",
						},
						{
							id: "yt",
							type: "video",
							url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
						},
						{ id: "file", type: "video", url: "https://example.com/clip.mp4" },
						{
							id: "emb",
							type: "embed",
							url: "https://example.com/widget",
							height: 300,
						},
						{ id: "w", type: "wait", seconds: 2 },
					],
				},
			],
		});
		const deps = testDeps();
		const turn = await startSession(
			flow,
			{ name: "Ada", other: "ignored" },
			deps,
			"r1"
		);
		expect(turn.messages.map((message) => message.type)).toEqual([
			"text",
			"image",
			"video",
			"video",
			"embed",
			"wait",
		]);
		expect(texts(turn)).toEqual(["Hi **Ada** "]);
		const videos = turn.messages.filter((message) => message.type === "video");
		expect(
			videos.map((video) => video.type === "video" && video.embedUrl)
		).toEqual(["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", null]);
		expect(turn.state.logs.map((log) => log.blockId)).toEqual(["bad"]);
		expect(turn.done).toBe(true);
		expect(turn.state.completedAt).toBe(FIXED_NOW.toISOString());
		expect(deps.events.map((event) => event.type)).toEqual([
			"conversation.completed",
		]);
	});

	it("maps video hosts to players", () => {
		expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
		);
		expect(videoEmbedUrl("https://vimeo.com/76979871")).toBe(
			"https://player.vimeo.com/video/76979871"
		);
		expect(videoEmbedUrl("https://example.com/v.mp4")).toBeNull();
	});

	it("only prefills variables marked hidden", async () => {
		const flow = testFlow({
			variables: [{ id: "utm", name: "utm", hidden: true }, "secret"],
			groups: [
				{
					id: "start",
					blocks: [{ id: "t", type: "text", content: "{{utm}}/{{secret}}" }],
				},
			],
		});
		const turn = await startSession(
			flow,
			{ utm: "ads", secret: "nope" },
			testDeps(),
			"r"
		);
		expect(texts(turn)).toEqual(["ads/"]);
	});
});

describe("input validation", () => {
	const cases: [InputBlock, string[], (string | string[])[]][] = [
		[
			{ id: "i", type: "text_input", minLength: 3, maxLength: 5 },
			["abc", "  hello "],
			["", "ab", "toolong"],
		],
		[
			{ id: "i", type: "number_input", min: 1, max: 10, step: 0.5 },
			["1", "9.5", " 10 "],
			["0", "11", "1.25", "abc", ""],
		],
		[
			{ id: "i", type: "email_input" },
			["ada@example.com"],
			["ada@", "not an email"],
		],
		[
			{ id: "i", type: "phone_input" },
			["+1 (555) 010-0000", "0201234567"],
			["12", "call me", "+1234567890123456789"],
		],
		[
			{ id: "i", type: "url_input" },
			["https://example.com/x", "example.com"],
			["javascript:alert(1)", "ftp://example.com", "nope"],
		],
		[
			{ id: "i", type: "date_input", min: "2026-01-01", max: "2026-12-31" },
			["2026-02-28"],
			["2026-02-30", "2025-12-31", "2027-01-01", "02/03/2026"],
		],
		[
			{ id: "i", type: "date_input", withTime: true },
			["2026-05-01T09:30"],
			["2026-05-01", "2026-05-01T25:00"],
		],
		[
			{ id: "i", type: "rating_input", scale: "nps", length: 10 },
			["0", "10"],
			["11", "-1", "4.5"],
		],
		[
			{ id: "i", type: "rating_input", scale: "stars", length: 5 },
			["1", "5"],
			["0", "6"],
		],
		[
			{ id: "i", type: "rating_input", scale: "numbers", length: 3 },
			["3"],
			["4"],
		],
		[
			{
				id: "i",
				type: "choice_input",
				items: [
					{ id: "a", label: "Apple" },
					{ id: "b", label: "Banana" },
				],
			},
			["a", "Banana"],
			["c", "", ["a", "b"]],
		],
		[
			{
				id: "i",
				type: "choice_input",
				multiple: true,
				items: [
					{ id: "a", label: "Apple" },
					{ id: "b", label: "Banana" },
				],
			},
			["a"],
			[[], ["a", "a"], ["a", "zzz"]],
		],
	];
	for (const [block, valid, invalid] of cases) {
		it(`accepts and rejects ${block.type}${"scale" in block ? `/${block.scale}` : ""}${"withTime" in block ? "/time" : ""}`, () => {
			for (const value of valid) {
				expect(validateInput(block, value).ok).toBe(true);
			}
			for (const value of invalid) {
				expect(validateInput(block, value).ok).toBe(false);
			}
		});
	}
	it("accepts multiple choices and records labels and values", () => {
		const block: InputBlock = {
			id: "i",
			type: "choice_input",
			multiple: true,
			items: [
				{ id: "a", label: "Apple", value: "apple" },
				{ id: "b", label: "Banana" },
			],
		};
		expect(validateInput(block, ["a", "b"])).toEqual({
			ok: true,
			label: "Apple, Banana",
			value: "apple, Banana",
			itemId: undefined,
		});
	});

	it("re-prompts with the retry message and keeps the state", async () => {
		const flow = ask({
			id: "email",
			type: "email_input",
			retryMessage: "Try a real email",
		});
		const deps = testDeps();
		const first = await startSession(flow, {}, deps, "r");
		expect(first.input?.type).toBe("email_input");
		expect(first.input).not.toHaveProperty("saveTo");
		const bad = await reply(flow, first.state, "nope", deps);
		expect(texts(bad)).toEqual(["Try a real email"]);
		expect(bad.input?.id).toBe("email");
		expect(bad.state.answers).toHaveLength(0);
		const fallback = await reply(
			ask({ id: "n", type: "number_input" }),
			(
				await startSession(
					ask({ id: "n", type: "number_input" }),
					{},
					deps,
					"r2"
				)
			).state,
			"x",
			deps
		);
		expect(texts(fallback)).toEqual([flow.settings.invalidReplyMessage]);
		const good = await reply(flow, bad.state, "ada@example.com", deps);
		expect(texts(good)).toEqual(["Got ada@example.com"]);
		expect(good.state.answers).toEqual([
			{
				blockId: "email",
				variableId: "answer",
				label: "ada@example.com",
				value: "ada@example.com",
				at: FIXED_NOW.toISOString(),
			},
		]);
		expect(
			good.state.events
				.filter((event) => event.blockId === "email")
				.map((event) => event.type)
		).toEqual(["reached", "answered"]);
		expect(good.done).toBe(true);
	});
});

describe("branching", () => {
	const choiceFlow = (withDefault: boolean) =>
		testFlow({
			variables: ["pick"],
			groups: [
				{
					id: "start",
					blocks: [
						{
							id: "c",
							type: "choice_input",
							saveTo: "pick",
							items: [
								{ id: "a", label: "A" },
								{ id: "b", label: "B" },
								{ id: "c2", label: "C" },
							],
						},
						{ id: "fall", type: "text", content: "fell through" },
					],
				},
				{ id: "ga", blocks: [{ id: "ta", type: "text", content: "went A" }] },
				{
					id: "gd",
					blocks: [{ id: "td", type: "text", content: "went default" }],
				},
			],
			edges: [
				edge("e1", "c", "ga", { itemId: "a" }),
				...(withDefault ? [edge("e2", "c", "gd", { branch: "default" })] : []),
			],
		});

	it("follows item edges, then the default edge, then falls through", async () => {
		const deps = testDeps();
		for (const [withDefault, answer, expected] of [
			[true, "a", "went A"],
			[true, "b", "went default"],
			[false, "b", "fell through"],
		] as const) {
			const flow = choiceFlow(withDefault);
			const first = await startSession(flow, {}, deps, "r");
			const turn = await reply(flow, first.state, answer, deps);
			expect(texts(turn)).toEqual([expected]);
		}
	});

	it("routes condition true/false branches with and/or rules", async () => {
		const flow = (combinator: "and" | "or") =>
			testFlow({
				variables: ["n", "s"],
				groups: [
					{
						id: "start",
						blocks: [
							{ id: "n_in", type: "number_input", saveTo: "n" },
							{
								id: "set_s",
								type: "set_variable",
								variableId: "s",
								op: "set",
								value: "Hello World",
							},
							{
								id: "cond",
								type: "condition",
								combinator,
								rules: [
									{ variableId: "n", operator: "greater_than", value: "5" },
									{ variableId: "s", operator: "starts_with", value: "hello" },
								],
							},
						],
					},
					{ id: "yes", blocks: [{ id: "ty", type: "text", content: "yes" }] },
					{ id: "no", blocks: [{ id: "tn", type: "text", content: "no" }] },
				],
				edges: [
					edge("e1", "cond", "yes", { branch: "true" }),
					edge("e2", "cond", "no", { branch: "false" }),
				],
			});
		const deps = testDeps();
		for (const [combinator, value, expected] of [
			["and", "6", "yes"],
			["and", "3", "no"],
			["or", "3", "yes"],
		] as const) {
			const built = flow(combinator);
			const first = await startSession(built, {}, deps, "r");
			expect(texts(await reply(built, first.state, value, deps))).toEqual([
				expected,
			]);
		}
	});

	it("evaluates every condition operator", async () => {
		const operators: [string, string | undefined, boolean][] = [
			["equals", "ABC", true],
			["not_equals", "abc", false],
			["contains", "b", true],
			["not_contains", "z", true],
			["greater_than", "1", false],
			["less_than", "1", false],
			["is_set", undefined, true],
			["is_empty", undefined, false],
			["starts_with", "a", true],
			["ends_with", "c", true],
		];
		for (const [operator, value, expected] of operators) {
			const flow = testFlow({
				variables: ["v"],
				groups: [
					{
						id: "start",
						blocks: [
							{
								id: "s",
								type: "set_variable",
								variableId: "v",
								op: "set",
								value: "abc",
							},
							{
								id: "cond",
								type: "condition",
								combinator: "and",
								rules: [
									{
										variableId: "v",
										operator: operator as "equals",
										...(value === undefined ? {} : { value }),
									},
								],
							},
							{ id: "f", type: "text", content: "false" },
						],
					},
					{ id: "t", blocks: [{ id: "tt", type: "text", content: "true" }] },
				],
				edges: [edge("e", "cond", "t", { branch: "true" })],
			});
			const turn = await startSession(flow, {}, testDeps(), "r");
			expect([operator, texts(turn)[0]]).toEqual([operator, String(expected)]);
		}
	});

	it("splits A/B tests with the injected random source", async () => {
		const flow = testFlow({
			groups: [
				{ id: "start", blocks: [{ id: "ab", type: "ab_test", percentA: 30 }] },
				{ id: "a", blocks: [{ id: "ta", type: "text", content: "A" }] },
				{ id: "b", blocks: [{ id: "tb", type: "text", content: "B" }] },
			],
			edges: [
				edge("e1", "ab", "a", { branch: "a" }),
				edge("e2", "ab", "b", { branch: "b" }),
			],
		});
		expect(
			texts(await startSession(flow, {}, testDeps({ random: () => 0.1 }), "r"))
		).toEqual(["A"]);
		expect(
			texts(await startSession(flow, {}, testDeps({ random: () => 0.5 }), "r"))
		).toEqual(["B"]);
	});

	it("jumps between groups and follows plain edges", async () => {
		const flow = testFlow({
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "t1", type: "text", content: "one" },
						{ id: "skipped", type: "text", content: "skipped" },
					],
				},
				{
					id: "two",
					blocks: [
						{ id: "j", type: "jump", groupId: "three" },
						{ id: "never", type: "text", content: "never" },
					],
				},
				{ id: "three", blocks: [{ id: "t3", type: "text", content: "three" }] },
			],
			edges: [edge("e", "t1", "two")],
		});
		expect(texts(await startSession(flow, {}, testDeps(), "r"))).toEqual([
			"one",
			"three",
		]);
	});

	it("stops loops without inputs and ends the conversation", async () => {
		const flow = testFlow({
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "t", type: "text", content: "loop" },
						{ id: "j", type: "jump", groupId: "start" },
					],
				},
			],
		});
		const turn = await startSession(flow, {}, testDeps(), "r");
		expect(turn.done).toBe(true);
		expect(turn.messages.length).toBeLessThanOrEqual(BOT_LIMITS.stepsPerTurn);
		expect(turn.state.logs.at(-1)?.kind).toBe("engine");
	});

	it("caps the number of turns per session", async () => {
		const flow = ask({ id: "q", type: "text_input" });
		const deps = testDeps();
		const first = await startSession(flow, {}, deps, "r");
		const exhausted = await reply(
			flow,
			{ ...first.state, turns: BOT_LIMITS.turnsPerSession },
			"hi",
			deps
		);
		expect(exhausted.done).toBe(true);
		expect(exhausted.state.answers).toHaveLength(0);
	});
});

describe("logic blocks", () => {
	it("applies every set_variable operation", async () => {
		const flow = testFlow({
			variables: ["a", "b", "c", "d", "e", "f", "g"],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "intro", type: "text", content: "Hello" },
						{
							id: "s1",
							type: "set_variable",
							variableId: "a",
							op: "set",
							value: "x",
						},
						{
							id: "s2",
							type: "set_variable",
							variableId: "a",
							op: "append",
							value: "y",
						},
						{
							id: "s3",
							type: "set_variable",
							variableId: "b",
							op: "increment",
						},
						{
							id: "s4",
							type: "set_variable",
							variableId: "b",
							op: "increment",
							value: "2.5",
						},
						{ id: "s5", type: "set_variable", variableId: "c", op: "now" },
						{
							id: "s6",
							type: "set_variable",
							variableId: "d",
							op: "random_id",
						},
						{
							id: "s7",
							type: "set_variable",
							variableId: "e",
							op: "result_id",
						},
						{
							id: "s8",
							type: "set_variable",
							variableId: "f",
							op: "transcript",
						},
						{
							id: "s9",
							type: "set_variable",
							variableId: "g",
							op: "set",
							value: "temp",
						},
						{ id: "s10", type: "set_variable", variableId: "g", op: "clear" },
					],
				},
			],
		});
		const turn = await startSession(
			flow,
			{},
			testDeps({ random: () => 0 }),
			"res_1"
		);
		expect(turn.state.variables).toEqual({
			a: "x, y",
			b: "3.5",
			c: FIXED_NOW.toISOString(),
			d: "aaaaaaaaaaaa",
			e: "res_1",
			f: "Bot: Hello",
		});
	});

	it("redirects: new-tab redirects continue, same-tab redirects end", async () => {
		const flow = (newTab: boolean) =>
			testFlow({
				variables: [{ id: "q", name: "q", hidden: true }],
				groups: [
					{
						id: "start",
						blocks: [
							{
								id: "r",
								type: "redirect",
								url: "https://example.com/s?q={{q}}",
								newTab,
							},
							{ id: "after", type: "text", content: "after" },
						],
					},
				],
			});
		const newTab = await startSession(
			flow(true),
			{ q: "a b&c" },
			testDeps(),
			"r"
		);
		expect(newTab.redirect).toEqual({
			url: "https://example.com/s?q=a%20b%26c",
			newTab: true,
		});
		expect(texts(newTab)).toEqual(["after"]);
		const sameTab = await startSession(flow(false), {}, testDeps(), "r");
		expect(sameTab.redirect?.newTab).toBe(false);
		expect(texts(sameTab)).toEqual([]);
		expect(sameTab.done).toBe(true);
		const unsafe = await startSession(
			testFlow({
				groups: [
					{
						id: "start",
						blocks: [
							{
								id: "r",
								type: "redirect",
								url: "javascript:alert(1)",
								newTab: false,
							},
						],
					},
				],
			}),
			{},
			testDeps(),
			"r"
		);
		expect(unsafe.redirect).toBeNull();
		expect(unsafe.state.logs[0]?.kind).toBe("redirect");
	});

	it("emits wait messages capped at 30 seconds and skips zero waits", async () => {
		const flow = testFlow({
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "w0", type: "wait", seconds: 0 },
						{ id: "w", type: "wait", seconds: 30 },
					],
				},
			],
		});
		const turn = await startSession(flow, {}, testDeps(), "r");
		expect(turn.messages).toEqual([{ type: "wait", id: "w:0:1", seconds: 30 }]);
	});
});

describe("integrations", () => {
	const aiFlow = (settings = {}) =>
		testFlow({
			settings,
			variables: ["q", "out"],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "q_in", type: "text_input", saveTo: "q" },
						{
							id: "ai",
							type: "ai_reply",
							instructions: "Be brief.",
							promptTemplate: "Q: {{q}}",
							saveTo: "out",
							useKnowledge: true,
							maxChars: 50,
							fallbackMessage: "Fallback here",
						},
						{ id: "again", type: "jump", groupId: "start" },
					],
				},
			],
		});

	it("calls the model with owner instructions, knowledge, and caps", async () => {
		const calls: { prompt: string; system: string }[] = [];
		const deps = testDeps({
			ai: (request) => {
				calls.push(request);
				return Promise.resolve(`  ${"x".repeat(80)}  `);
			},
			knowledge: (query) => [`About ${query}`],
		});
		const flow = aiFlow();
		const first = await startSession(flow, {}, deps, "r");
		const turn = await reply(flow, first.state, "refunds", deps);
		expect(calls[0]?.system).toBe("Be brief.");
		expect(calls[0]?.prompt).toContain("Q: refunds");
		expect(calls[0]?.prompt).toContain("About Q: refunds");
		const message = turn.messages[0];
		expect(message?.type === "text" && message.source).toBe("ai");
		expect(turn.state.variables.out).toBe("x".repeat(50));
		expect(turn.state.aiTurns).toBe(1);
	});

	it("falls back on failure, conversation budget, and daily budget", async () => {
		const failing = testDeps({
			ai: () => Promise.reject(new Error("model down")),
		});
		const flow = aiFlow({ aiTurnsPerConversation: 1 });
		const first = await startSession(flow, {}, failing, "r");
		const failed = await reply(flow, first.state, "hi", failing);
		expect(texts(failed)).toEqual(["Fallback here"]);
		expect(failed.state.logs.at(-1)?.message).toBe("model down");
		expect(failed.input?.id).toBe("q_in");

		const working = testDeps({ ai: () => Promise.resolve("ok") });
		const overBudget = await reply(flow, failed.state, "again", working);
		expect(texts(overBudget)).toEqual(["Fallback here"]);
		expect(overBudget.state.logs.at(-1)?.message).toContain("conversation");

		const daily = testDeps({
			ai: () => Promise.resolve("ok"),
			consumeAiTurn: () => false,
		});
		const fresh = await startSession(aiFlow(), {}, daily, "r");
		const dailyTurn = await reply(aiFlow(), fresh.state, "hi", daily);
		expect(texts(dailyTurn)).toEqual(["Fallback here"]);
		expect(dailyTurn.state.logs.at(-1)?.message).toContain("daily");

		const unavailable = testDeps();
		const none = await reply(
			aiFlow(),
			(await startSession(aiFlow(), {}, unavailable, "r")).state,
			"hi",
			unavailable
		);
		expect(texts(none)).toEqual(["Fallback here"]);
	});

	const httpFlow = testFlow({
		variables: ["email", "plan", "count", "missing"],
		groups: [
			{
				id: "start",
				blocks: [
					{ id: "e", type: "text_input", saveTo: "email" },
					{
						id: "http",
						type: "http_request",
						method: "POST",
						url: "https://api.example.com/users?e={{email}}",
						headers: [{ name: "x-token", value: "abc" }],
						body: '{"email":"{{email}}"}',
						responseMapping: [
							{ path: "data.plan", variableId: "plan" },
							{ path: "data.items[1].n", variableId: "count" },
							{ path: "__proto__.polluted", variableId: "missing" },
						],
						timeoutMs: 20_000,
					},
					{ id: "t", type: "text", content: "plan={{plan}} count={{count}}" },
				],
			},
		],
	});

	it("templates requests safely and maps JSON responses", async () => {
		const requests: unknown[] = [];
		const deps = testDeps({
			http: (request) => {
				requests.push(request);
				return Promise.resolve({
					status: 200,
					body: JSON.stringify({
						data: { plan: "pro", items: [{ n: 1 }, { n: 2 }] },
					}),
				});
			},
		});
		const first = await startSession(httpFlow, {}, deps, "r");
		const turn = await reply(httpFlow, first.state, 'a"b@example.com', deps);
		expect(requests[0]).toEqual({
			method: "POST",
			url: "https://api.example.com/users?e=a%22b%40example.com",
			headers: { "x-token": "abc", "content-type": "application/json" },
			body: '{"email":"a\\"b@example.com"}',
			timeoutMs: 10_000,
		});
		expect(texts(turn)).toEqual(["plan=pro count=2"]);
		expect(turn.state.variables.missing).toBeUndefined();
		expect(readJsonPath({ a: { "b c": [5] } }, 'a["b c"][0]')).toBe(5);
	});

	it("logs failed requests and continues", async () => {
		for (const http of [
			() => Promise.reject(new Error("blocked address")),
			() => Promise.resolve({ status: 500, body: "" }),
			() => Promise.resolve({ status: 200, body: "<html>" }),
		]) {
			const deps = testDeps({ http });
			const first = await startSession(httpFlow, {}, deps, "r");
			const turn = await reply(httpFlow, first.state, "ada@example.com", deps);
			expect(texts(turn)).toEqual(["plan= count="]);
			expect(turn.state.logs.at(-1)?.level).toBe("error");
			expect(turn.done).toBe(true);
		}
	});

	it("records handoffs and emits handoff.requested", async () => {
		const flow = testFlow({
			variables: ["topic"],
			groups: [
				{
					id: "start",
					blocks: [
						{
							id: "c",
							type: "choice_input",
							saveTo: "topic",
							items: [{ id: "s", label: "Sales", value: "sales" }],
						},
						{
							id: "h",
							type: "handoff",
							topic: "{{topic}}",
							summaryTemplate: "Lead about {{topic}}",
							message: "Passing you to {{topic}}",
						},
					],
				},
			],
		});
		const deps = testDeps();
		const first = await startSession(flow, {}, deps, "r");
		const turn = await reply(flow, first.state, "s", deps);
		expect(turn.state.handoffs).toEqual([
			{
				blockId: "h",
				topic: "sales",
				summary: "Lead about sales",
				at: FIXED_NOW.toISOString(),
			},
		]);
		expect(texts(turn)).toEqual(["Passing you to sales"]);
		expect(deps.events.map((event) => event.type)).toEqual([
			"handoff.requested",
			"conversation.completed",
		]);
		const handoff = deps.events[0];
		expect(handoff?.type === "handoff.requested" && handoff.topic).toBe(
			"sales"
		);
	});

	it("never fails a turn because an event sink throws", async () => {
		const flow = testFlow({
			groups: [
				{ id: "start", blocks: [{ id: "t", type: "text", content: "hi" }] },
			],
		});
		const turn = await startSession(
			flow,
			{},
			testDeps({ emit: () => Promise.reject(new Error("down")) }),
			"r"
		);
		expect(turn.done).toBe(true);
	});
});

describe("review regressions", () => {
	it("clears an ai_reply variable when a later turn falls back", async () => {
		let answer: Promise<string> = Promise.resolve("First answer");
		const deps = testDeps({ ai: () => answer });
		const flow = testFlow({
			variables: ["q", "out"],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "q_in", type: "text_input", saveTo: "q" },
						{
							id: "ai",
							type: "ai_reply",
							instructions: "",
							promptTemplate: "{{q}}",
							saveTo: "out",
							useKnowledge: false,
							maxChars: 200,
							fallbackMessage: "Sorry",
						},
						{ id: "summary", type: "text", content: "{{q}} -> [{{out}}]" },
						{ id: "again", type: "jump", groupId: "start" },
					],
				},
			],
		});
		const first = await startSession(flow, {}, deps, "r");
		const answered = await reply(flow, first.state, "one", deps);
		expect(texts(answered)).toContain("one -> [First answer]");
		answer = Promise.reject(new Error("model down"));
		const failed = await reply(flow, answered.state, "two", deps);
		expect(texts(failed)).toEqual(["Sorry", "two -> []"]);
		expect(failed.state.variables.out).toBeUndefined();
	});

	it("keeps an owner Content-Type header whatever its case", async () => {
		const requests: { headers: Record<string, string> }[] = [];
		const deps = testDeps({
			http: (request) => {
				requests.push(request);
				return Promise.resolve({ status: 200, body: "{}" });
			},
		});
		const flow = testFlow({
			groups: [
				{
					id: "start",
					blocks: [
						{
							id: "http",
							type: "http_request",
							method: "POST",
							url: "https://api.example.com/hook",
							headers: [
								{
									name: "Content-Type",
									value: "application/vnd.api+json",
								},
							],
							body: '{"a":1}',
							responseMapping: [],
							timeoutMs: 5000,
						},
					],
				},
			],
		});
		await startSession(flow, {}, deps, "r");
		expect(requests[0]?.headers).toEqual({
			"Content-Type": "application/vnd.api+json",
		});
	});

	it("orders ISO dates and date-times in greater_than / less_than", async () => {
		const flow = (operator: "greater_than" | "less_than", value: string) =>
			testFlow({
				variables: ["d"],
				groups: [
					{
						id: "start",
						blocks: [
							{ id: "d_in", type: "date_input", saveTo: "d", withTime: true },
							{
								id: "cond",
								type: "condition",
								combinator: "and",
								rules: [{ variableId: "d", operator, value }],
							},
						],
					},
					{ id: "yes", blocks: [{ id: "ty", type: "text", content: "yes" }] },
					{ id: "no", blocks: [{ id: "tn", type: "text", content: "no" }] },
				],
				edges: [
					edge("e1", "cond", "yes", { branch: "true" }),
					edge("e2", "cond", "no", { branch: "false" }),
				],
			});
		const deps = testDeps();
		for (const [operator, value, expected] of [
			["greater_than", "2026-11-02", "yes"],
			["greater_than", "2026-11-03T14:31", "no"],
			["less_than", "2026-11-03T14:31", "yes"],
			["less_than", "2026-11-03", "no"],
		] as const) {
			const built = flow(operator, value);
			const first = await startSession(built, {}, deps, "r");
			expect(
				texts(await reply(built, first.state, "2026-11-03T14:30", deps))
			).toEqual([expected]);
		}
	});

	it("accepts a host:port URL typed without a scheme", () => {
		const block: InputBlock = { id: "i", type: "url_input" };
		expect(validateInput(block, "example.com:8080/x")).toMatchObject({
			ok: true,
		});
		expect(validateInput(block, "https://example.com:8443")).toMatchObject({
			ok: true,
		});
		expect(validateInput(block, "javascript:alert(1)")).toMatchObject({
			ok: false,
		});
		expect(validateInput(block, "mailto:ada@example.com")).toMatchObject({
			ok: false,
		});
	});

	it("tracks the current block in a looping flow", async () => {
		const flow = testFlow({
			variables: ["a", "b"],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "first", type: "text_input", saveTo: "a" },
						{ id: "second", type: "text_input", saveTo: "b" },
						{ id: "loop", type: "jump", groupId: "start" },
					],
				},
			],
		});
		const deps = testDeps();
		const first = await startSession(flow, {}, deps, "r");
		const one = await reply(flow, first.state, "1", deps);
		const two = await reply(flow, one.state, "2", deps);
		expect(two.state.lastBlockId).toBe("first");
		const three = await reply(flow, two.state, "3", deps);
		expect(three.state.lastBlockId).toBe("second");
		expect(three.state.events.at(-1)?.blockId).not.toBe("second");
	});
});
