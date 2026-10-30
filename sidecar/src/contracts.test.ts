import { describe, expect, it } from "bun:test";
import {
	createBotSchema,
	flowSchema,
	settingsSchema,
	updateBotSchema,
	validateFlow,
} from "./contracts.ts";
import {
	chunkArticles,
	knowledgeSnippets,
	searchKnowledge,
} from "./knowledge.ts";
import { renderTemplate, templateVariableNames } from "./template.ts";
import { edge, testFlow } from "./test-fixtures.ts";

describe("flow validation", () => {
	it("reports dangling references as errors and soft problems as warnings", () => {
		const flow = testFlow({
			variables: ["known"],
			groups: [
				{
					id: "start",
					blocks: [
						{ id: "t", type: "text", content: "Hi {{unknown}}" },
						{ id: "q", type: "text_input" },
						{
							id: "c",
							type: "choice_input",
							saveTo: "gone",
							items: [{ id: "a", label: "A" }],
						},
						{ id: "j", type: "jump", groupId: "nowhere" },
						{
							id: "img",
							type: "image",
							url: "http://insecure.example/x.png",
							alt: "",
						},
						{
							id: "http",
							type: "http_request",
							method: "GET",
							url: "http://api.example",
							headers: [],
							body: "",
							responseMapping: [],
							timeoutMs: 1000,
						},
					],
				},
				{ id: "island", blocks: [] },
			],
			edges: [
				edge("e1", "missing-block", "start"),
				edge("e2", "c", "missing-group", { itemId: "a" }),
				edge("e3", "c", "start", { itemId: "zzz" }),
				edge("e4", "t", "start", { branch: "true" }),
			],
		});
		const issues = validateFlow(flow);
		const errors = issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message);
		expect(errors).toEqual(
			expect.arrayContaining([
				"This connection starts at a block that no longer exists.",
				"This connection points to a group that no longer exists.",
				"This connection starts at a choice item that no longer exists.",
				'A text block has no "true" branch.',
				"This block uses a variable that no longer exists.",
				"This jump points to a group that no longer exists.",
				"Media blocks need an https:// URL.",
				"HTTP requests must use an https:// URL.",
			])
		);
		const warnings = issues
			.filter((issue) => issue.severity === "warning")
			.map((issue) => issue.message);
		expect(warnings).toEqual(
			expect.arrayContaining([
				"{{unknown}} isn't a variable in this bot.",
				"This answer isn't saved to a variable. It still appears in results.",
				"Nothing leads to this group.",
				"This group has no blocks.",
			])
		);
	});

	it("rejects unknown fields, bad ids, and non-https embed origins", () => {
		const flow = testFlow({ groups: [{ id: "start", blocks: [] }] });
		expect(flowSchema.safeParse({ ...flow, extra: true }).success).toBe(false);
		expect(
			flowSchema.safeParse({ ...flow, startGroupId: "has space" }).success
		).toBe(false);
		expect(
			settingsSchema.safeParse({
				...flow.settings,
				allowedEmbedOrigins: ["http://example.com"],
			}).success
		).toBe(false);
		expect(
			settingsSchema.safeParse({
				...flow.settings,
				allowedEmbedOrigins: ["https://example.com/path"],
			}).success
		).toBe(false);
		expect(
			settingsSchema.safeParse({
				...flow.settings,
				allowedEmbedOrigins: ["https://example.com; script-src *"],
			}).success
		).toBe(false);
		expect(
			settingsSchema.parse({
				...flow.settings,
				allowedEmbedOrigins: ["https://example.com"],
			}).allowedEmbedOrigins
		).toEqual(["https://example.com"]);
	});

	it("validates create and update bodies", () => {
		expect(
			createBotSchema.safeParse({ name: "Bot", templateId: "nps-survey" })
				.success
		).toBe(true);
		expect(
			createBotSchema.safeParse({ name: "Bot", slug: "admin" }).success
		).toBe(false);
		expect(
			createBotSchema.safeParse({ name: "Bot", slug: "Has Spaces" }).success
		).toBe(false);
		expect(
			createBotSchema.safeParse({
				name: "Bot",
				templateId: "blank",
				flow: testFlow({ groups: [{ id: "s", blocks: [] }] }),
			}).success
		).toBe(false);
		expect(updateBotSchema.safeParse({ name: "x" }).success).toBe(false);
	});
});

describe("templates", () => {
	it("renders variables with escaping and lists names", () => {
		const lookup = (name: string) => ({ a: 'x "y" & z' })[name];
		expect(renderTemplate("{{ a }}-{{b}}", lookup)).toBe('x "y" & z-');
		expect(renderTemplate("?q={{a}}", lookup, "url")).toBe(
			"?q=x%20%22y%22%20%26%20z"
		);
		expect(renderTemplate('{"v":"{{a}}"}', lookup, "json")).toBe(
			'{"v":"x \\"y\\" & z"}'
		);
		expect(templateVariableNames("{{a}} {{ b }} {{a}} {{1bad}}")).toEqual([
			"a",
			"b",
		]);
	});
});

describe("knowledge", () => {
	const articles = [
		{
			id: "refunds",
			title: "Refund policy",
			body: "Refunds are issued within 5 business days.\n\nContact billing for help.",
		},
		{
			id: "shipping",
			title: "Shipping",
			body: "We ship worldwide. Orders leave the warehouse in 2 days.",
		},
	];

	it("ranks the most relevant article first", () => {
		const matches = searchKnowledge(
			chunkArticles(articles),
			"How long do refunds take?"
		);
		expect(matches[0]?.articleId).toBe("refunds");
		expect(searchKnowledge(chunkArticles(articles), "the and of")).toEqual([]);
		expect(knowledgeSnippets(articles, "shipping worldwide", 1)[0]).toStartWith(
			"Shipping\n"
		);
	});

	it("splits long articles into chunks", () => {
		const long = [{ id: "a", title: "Long", body: "word ".repeat(1000) }];
		expect(chunkArticles(long).length).toBeGreaterThan(4);
	});
});
