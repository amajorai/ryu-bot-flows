import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	formatMessage,
	type MessageValuesInput,
	messageIdForLiteral,
} from "@ryu/i18n/core";
// The provider registers its runtime here; a test registers a stand-in.
import {
	registerActiveI18nRuntime,
	unregisterActiveI18nRuntime,
} from "../../../../packages/i18n/src/active-locale.ts";
import {
	type Block,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Flow,
} from "../../sidecar/src/contracts.ts";
import { blockSummary } from "./flow-model-summary.ts";

const CONDITION =
	"{variable} {operator, select, equals {equals {value}} not_equals {does not equal {value}} contains {contains {value}} not_contains {does not contain {value}} greater_than {is greater than {value}} less_than {is less than {value}} is_set {is set} is_empty {is empty} starts_with {starts with {value}} ends_with {ends with {value}} other {{operator} {value}}}";
const SET_OP =
	"{name} · {op, select, increment {increment} clear {clear} now {current date and time} random_id {random id} result_id {result id} transcript {conversation transcript} other {{op}}}";

/** A German stand-in catalog for the summary's messages. */
const GERMAN = new Map<string, string>([
	[
		messageIdForLiteral(CONDITION),
		"{variable} {operator, select, equals {ist gleich {value}} not_equals {ist nicht gleich {value}} greater_than {ist größer als {value}} is_set {ist gesetzt} other {{operator} {value}}}",
	],
	[
		messageIdForLiteral(SET_OP),
		"{name} · {op, select, increment {erhöhen} clear {leeren} other {{op}}}",
	],
	[messageIdForLiteral("missing group"), "fehlende Gruppe"],
	[messageIdForLiteral("missing variable"), "fehlende Variable"],
]);

const germanRuntime = {
	direction: "ltr" as const,
	locale: "de",
	translate(id: string, values?: MessageValuesInput, fallback?: string) {
		return formatMessage(GERMAN.get(id) ?? fallback ?? id, values, "de");
	},
};

beforeEach(() => registerActiveI18nRuntime(germanRuntime));
afterEach(() => unregisterActiveI18nRuntime(germanRuntime));

function flowWith(blocks: Block[]): Flow {
	return {
		version: 1,
		variables: [
			{ id: "v_email", name: "email" },
			{ id: "v_age", name: "age" },
		],
		groups: [{ id: "g_start", title: "", position: { x: 0, y: 0 }, blocks }],
		edges: [],
		startGroupId: "g_start",
		theme: DEFAULT_THEME,
		settings: DEFAULT_SETTINGS,
	};
}

function summary(block: Block): string {
	return blockSummary(flowWith([block]), block);
}

describe("blockSummary in German", () => {
	test("phrases each condition rule as a whole message and joins with und/oder", () => {
		const rules = [
			{ variableId: "v_email", operator: "not_equals", value: "a@b.de" },
			{ variableId: "v_age", operator: "greater_than", value: "3" },
		] as const;
		expect(
			summary({
				id: "b_and",
				type: "condition",
				combinator: "and",
				rules: [...rules],
			})
		).toBe("email ist nicht gleich a@b.de und age ist größer als 3");
		expect(
			summary({
				id: "b_or",
				type: "condition",
				combinator: "or",
				rules: [...rules],
			})
		).toBe("email ist nicht gleich a@b.de oder age ist größer als 3");
	});

	test("omits the value of a unary operator", () => {
		expect(
			summary({
				id: "b_set",
				type: "condition",
				combinator: "and",
				rules: [{ variableId: "v_email", operator: "is_set" }],
			})
		).toBe("email ist gesetzt");
	});

	test("labels a set-variable operation instead of printing its id", () => {
		expect(
			summary({
				id: "b_inc",
				type: "set_variable",
				variableId: "v_age",
				op: "increment",
			})
		).toBe("age · erhöhen");
		expect(
			summary({
				id: "b_set",
				type: "set_variable",
				variableId: "v_age",
				op: "set",
				value: "4",
			})
		).toBe("age = 4");
	});

	test("formats a wait in the locale's short second unit", () => {
		expect(summary({ id: "b_wait", type: "wait", seconds: 5 })).toBe("5 Sek.");
	});

	test("translates the missing group and missing variable fallbacks", () => {
		expect(summary({ id: "b_jump", type: "jump", groupId: "g_gone" })).toBe(
			"→ fehlende Gruppe"
		);
		expect(
			summary({
				id: "b_clear",
				type: "set_variable",
				variableId: "v_gone",
				op: "clear",
			})
		).toBe("fehlende Variable · leeren");
	});
});

describe("blockSummary in English", () => {
	beforeEach(() => unregisterActiveI18nRuntime(germanRuntime));

	test("keeps the English canvas lines", () => {
		const block: Block = {
			id: "b_cond",
			type: "condition",
			combinator: "or",
			rules: [
				{ variableId: "v_email", operator: "not_equals", value: "x" },
				{ variableId: "v_age", operator: "is_empty" },
			],
		};
		expect(summary(block)).toBe("email does not equal x or age is empty");
		expect(summary({ id: "b_wait", type: "wait", seconds: 5 })).toBe("5s");
	});
});
