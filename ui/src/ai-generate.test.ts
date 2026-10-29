import { describe, expect, test } from "bun:test";
import { listTemplates } from "../../sidecar/src/templates.ts";
import {
	buildGeneratePrompt,
	extractJsonObject,
	GENERATE_DESCRIPTION_LIMIT,
	parseGeneratedFlow,
} from "./ai-generate.ts";

const [first, second] = listTemplates();
if (!(first && second)) {
	throw new Error("templates are required");
}
const current = first.flow;
const generated = {
	variables: second.flow.variables,
	groups: second.flow.groups,
	edges: second.flow.edges,
	startGroupId: second.flow.startGroupId,
};

describe("extractJsonObject", () => {
	test("reads fenced and prose-wrapped replies", () => {
		expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
		expect(extractJsonObject('Here you go: {"a":{"b":2}} enjoy')).toBe(
			'{"a":{"b":2}}'
		);
		expect(extractJsonObject("no json")).toBeNull();
	});
});

describe("parseGeneratedFlow", () => {
	test("accepts a valid flow and keeps the current theme and settings", () => {
		const result = parseGeneratedFlow(JSON.stringify(generated), current);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.flow.groups).toEqual(second.flow.groups);
			expect(result.flow.theme).toEqual(current.theme);
			expect(result.flow.settings).toEqual(current.settings);
		}
	});

	test("lays out groups that came without positions", () => {
		const withoutPositions = {
			...generated,
			groups: generated.groups.map(
				({ position: _position, ...group }) => group
			),
		};
		const result = parseGeneratedFlow(
			JSON.stringify(withoutPositions),
			current
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.flow.groups[1]?.position).toEqual({ x: 340, y: 0 });
		}
	});

	test("rejects malformed JSON, schema violations and invalid graphs whole", () => {
		expect(parseGeneratedFlow("{not json}", current)).toEqual({
			ok: false,
			message: "The model returned malformed JSON.",
		});
		const badBlock = parseGeneratedFlow(
			JSON.stringify({
				...generated,
				groups: [
					{
						id: "g",
						title: "G",
						blocks: [{ id: "x", type: "script", code: "alert(1)" }],
					},
				],
				startGroupId: "g",
			}),
			current
		);
		expect(badBlock.ok).toBe(false);
		const dangling = parseGeneratedFlow(
			JSON.stringify({
				...generated,
				edges: [
					...generated.edges,
					{
						id: "e_bad",
						from: { blockId: "nope" },
						to: { groupId: "nowhere" },
					},
				],
			}),
			current
		);
		expect(dangling.ok).toBe(false);
		if (!dangling.ok) {
			expect(dangling.message).toContain("problem");
		}
	});

	test("the prompt bounds the description and marks it untrusted", () => {
		const prompt = buildGeneratePrompt(
			"x".repeat(GENERATE_DESCRIPTION_LIMIT + 50)
		);
		expect(prompt).toContain("untrusted");
		expect(prompt.match(/x+/g)?.at(-1)?.length).toBe(
			GENERATE_DESCRIPTION_LIMIT
		);
	});
});
