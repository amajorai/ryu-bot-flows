import { describe, expect, test } from "bun:test";
import {
	formatMessage,
	type MessageValuesInput,
	messageIdForLiteral,
} from "@ryu/i18n/core";
import {
	type Block,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Flow,
} from "../../sidecar/src/contracts.ts";
import { blockSummary } from "./flow-model-summary.ts";

// An Arabic stand-in catalog: the RTL catalogs mirror each arrow (→ becomes ←),
// which only reaches the canvas when the arrow sits inside the message.
const ARABIC = new Map<string, string>([
	[messageIdForLiteral("→ {group}"), "← {group}"],
	[messageIdForLiteral("{label} → {variable}"), "{label} ← {variable}"],
	[messageIdForLiteral("Text input"), "إدخال نص"],
	[messageIdForLiteral("missing group"), "مجموعة مفقودة"],
]);

function arabic(source: string, values?: MessageValuesInput): string {
	return formatMessage(
		ARABIC.get(messageIdForLiteral(source)) ?? source,
		values,
		"ar"
	);
}

const flow: Flow = {
	version: 1,
	variables: [{ id: "v_email", name: "email" }],
	groups: [
		{ id: "g_start", title: "", position: { x: 0, y: 0 }, blocks: [] },
		{ id: "g_end", title: "النهاية", position: { x: 0, y: 0 }, blocks: [] },
	],
	edges: [],
	startGroupId: "g_start",
	theme: DEFAULT_THEME,
	settings: DEFAULT_SETTINGS,
};

function summary(block: Block): string {
	return blockSummary(flow, block, arabic);
}

describe("blockSummary arrows in Arabic", () => {
	test("a jump points back toward the reading direction", () => {
		expect(summary({ id: "b_jump", type: "jump", groupId: "g_end" })).toBe(
			"← النهاية"
		);
		expect(summary({ id: "b_gone", type: "jump", groupId: "g_gone" })).toBe(
			"← مجموعة مفقودة"
		);
	});

	test("an input saved to a variable mirrors its arrow", () => {
		expect(
			summary({
				id: "b_text",
				type: "text_input",
				saveTo: "v_email",
			} as Block)
		).toBe("\u2068إدخال نص\u2069 ← \u2068email\u2069");
	});

	test("a Latin placeholder and variable stay isolated around the arrow", () => {
		// Unisolated, "Your email ← email" would form one left-to-right run under
		// dir="rtl", and the mirrored arrow would point back at the label.
		expect(
			summary({
				id: "b_text",
				type: "text_input",
				placeholder: "Your email",
				saveTo: "v_email",
			} as Block)
		).toBe("\u2068Your email\u2069 ← \u2068email\u2069");
	});

	test("an unsaved input shows only its label", () => {
		expect(summary({ id: "b_text", type: "text_input" } as Block)).toBe(
			"إدخال نص"
		);
	});
});
