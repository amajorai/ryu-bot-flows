import { afterEach, describe, expect, test } from "bun:test";
import { formatMessage, type MessageValuesInput } from "@ryu/i18n/core";
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

// An A/B test block's split reads in the locale's percent format. It was a
// hand-built `${a}% / ${b}%`, which kept the English sign and spacing in
// every locale.

const block: Block = { id: "b_ab", type: "ab_test", percentA: 60 };

const flow: Flow = {
	version: 1,
	variables: [],
	groups: [
		{ id: "g_start", title: "", position: { x: 0, y: 0 }, blocks: [block] },
	],
	edges: [],
	startGroupId: "g_start",
	theme: DEFAULT_THEME,
	settings: DEFAULT_SETTINGS,
};

function runtimeFor(locale: string, direction: "ltr" | "rtl") {
	return {
		direction,
		locale,
		translate(id: string, values?: MessageValuesInput, fallback?: string) {
			return formatMessage(fallback ?? id, values, locale);
		},
	};
}

function percent(locale: string, ratio: number): string {
	return new Intl.NumberFormat(locale, { style: "percent" }).format(ratio);
}

let active: ReturnType<typeof runtimeFor> | null = null;

function inLocale(locale: string, direction: "ltr" | "rtl" = "ltr"): void {
	active = runtimeFor(locale, direction);
	registerActiveI18nRuntime(active);
}

afterEach(() => {
	if (active) {
		unregisterActiveI18nRuntime(active);
		active = null;
	}
});

describe("blockSummary A/B split", () => {
	test("spaces the percent sign in German", () => {
		inLocale("de");
		expect(blockSummary(flow, block)).toBe("60 % / 40 %");
	});

	test("uses the Arabic percent format", () => {
		inLocale("ar", "rtl");
		const text = blockSummary(flow, block);
		expect(text).toBe(`${percent("ar", 0.6)} / ${percent("ar", 0.4)}`);
		expect(text).not.toBe("60% / 40%");
	});

	test("keeps the English split", () => {
		expect(blockSummary(flow, block)).toBe("60% / 40%");
	});

	test("routes the separator through one catalog message", () => {
		inLocale("ar", "rtl");
		const mirrored = (source: string, values?: MessageValuesInput) =>
			formatMessage(
				source === "{a} / {b}" ? "{b} \\ {a}" : source,
				values,
				"ar"
			);
		expect(blockSummary(flow, block, mirrored)).toBe(
			`${percent("ar", 0.4)} \\ ${percent("ar", 0.6)}`
		);
	});
});
