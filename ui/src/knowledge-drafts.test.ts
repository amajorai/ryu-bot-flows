import { describe, expect, test } from "bun:test";
import {
	BODY_TOO_LARGE_MESSAGE,
	BOT_LIMITS,
} from "../../sidecar/src/contracts.ts";
import {
	type ArticleDraft,
	draftsOf,
	knowledgeBody,
	knowledgeChanged,
	knowledgeProblem,
} from "./knowledge-drafts.ts";

const saved = draftsOf({
	articles: [{ id: "k_1", title: "Hours", body: "9 to 5" }],
	updatedAt: null,
});

describe("knowledge drafts", () => {
	test("edits and new articles count as unsaved changes", () => {
		expect(knowledgeChanged(saved, saved)).toBe(false);
		const added: ArticleDraft[] = [
			...saved,
			{ key: "k_new", title: "Returns", body: "30 days" },
		];
		expect(knowledgeChanged(added, saved)).toBe(true);
	});

	test("the body keeps saved ids and trims text", () => {
		expect(
			knowledgeBody([
				{ key: "k_1", savedId: "k_1", title: " Hours ", body: " 9 to 5 " },
				{ key: "local", title: "New", body: "Text" },
			])
		).toEqual({
			articles: [
				{ id: "k_1", title: "Hours", body: "9 to 5" },
				{ title: "New", body: "Text" },
			],
		});
	});

	test("empty, over-long and oversized drafts are reported inline", () => {
		expect(knowledgeProblem(saved)).toBeNull();
		expect(knowledgeProblem([{ key: "a", title: "", body: "text" }])).toContain(
			"title and content"
		);
		expect(
			knowledgeProblem([
				{
					key: "a",
					title: "T",
					body: "x".repeat(BOT_LIMITS.knowledgeBody + 1),
				},
			])
		).toContain("characters");
		const near = "é".repeat(BOT_LIMITS.knowledgeBody);
		const many = Array.from({ length: 50 }, (_, index) => ({
			key: `k${index}`,
			title: "T",
			body: near,
		}));
		expect(knowledgeProblem(many)).toBe(BODY_TOO_LARGE_MESSAGE);
	});
});
