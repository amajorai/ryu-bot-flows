import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@ryu/i18n/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Flow,
} from "../../sidecar/src/contracts.ts";
import { ChoiceFields } from "./BlockInspector-input-fields.tsx";
import { ConditionFields } from "./BlockInspector-logic-fields.tsx";
import type { Copy } from "./copy.ts";
import { IssuesPanel } from "./FlowEditor-issues-panel.tsx";

// Japanese rows standing in for the bot-flows catalog rows the extractor adds
// for these whole messages: the count and its noun come from one translation.
const JA = {
	"Button text {number}": "ボタンのテキスト {number}",
	"Remove button {number}": "ボタン {number} を削除",
	"Rule {number}": "ルール {number}",
	"Used by {count, plural, one {# block} other {# blocks}}":
		"{count, plural, other {# 個のブロックで使用中}}",
	"{count, plural, one {# error} other {# errors}}":
		"{count, plural, other {エラー # 件}}",
};

// Base UI dialogs portal into a live document, which a static render has
// none of; render the dialog parts inline so the body copy is observable.
const controls = await import("@ryu/blocks/companion/controls");
const Inline = ({ children }: { children?: ReactNode }) =>
	createElement("div", null, children);
mock.module("@ryu/blocks/companion/controls", () => ({
	...controls,
	Dialog: Inline,
	DialogContent: Inline,
	DialogDescription: Inline,
	DialogFooter: Inline,
	DialogHeader: Inline,
	DialogTitle: Inline,
}));
const { VariablesDialog } = await import("./VariablesDialog.tsx");

const copy: Copy = (_key, fallback) => fallback;
const noop = () => undefined;

function inLocale(locale: string, element: ReactElement): string {
	return renderToStaticMarkup(
		<I18nProvider
			initialLocale={locale}
			manageDocument={false}
			overlays={{ ja: JA }}
		>
			{element}
		</I18nProvider>
	);
}

function flowWithVariable(blocks: number): Flow {
	return {
		edges: [],
		groups: [
			{
				blocks: Array.from({ length: blocks }, (_, index) => ({
					content: "Hi {{name}}",
					id: `text_${index}`,
					type: "text" as const,
				})),
				id: "start",
				position: { x: 0, y: 0 },
				title: "Start",
			},
		],
		settings: DEFAULT_SETTINGS,
		startGroupId: "start",
		theme: DEFAULT_THEME,
		variables: [{ id: "var_name", name: "name" }],
		version: 1,
	};
}

function variables(locale: string, blocks: number): string {
	return inLocale(
		locale,
		createElement(VariablesDialog, {
			copy,
			flow: flowWithVariable(blocks),
			onChange: noop,
			onOpenChange: noop,
			open: true,
		})
	);
}

describe("Bot Flows whole-message copy", () => {
	test("variable usage is one plural message in each locale", () => {
		expect(variables("en", 1)).toContain("Used by 1 block<");
		expect(variables("en", 3)).toContain("Used by 3 blocks<");
		const japanese = variables("ja", 3);
		expect(japanese).toContain("3 個のブロックで使用中");
		expect(japanese).not.toContain("Used by");
	});

	test("numbered choice buttons carry the number inside the translation", () => {
		const html = inLocale(
			"ja",
			createElement(ChoiceFields, {
				block: {
					id: "choice",
					items: [
						{ id: "a", label: "Yes" },
						{ id: "b", label: "No" },
					],
					type: "choice_input",
				},
				copy,
				createVariable: noop,
				flow: flowWithVariable(1),
				set: noop,
			})
		);
		expect(html).toContain('aria-label="ボタンのテキスト 2"');
		expect(html).toContain('aria-label="ボタン 1 を削除"');
		expect(html).not.toContain("Button text");
	});

	test("the problems toggle counts errors through one plural message", () => {
		const html = inLocale(
			"ja",
			createElement(IssuesPanel, {
				copy,
				flow: flowWithVariable(1),
				issues: {
					all: [{ message: "Add a block.", severity: "error" }],
					byBlock: new Map(),
					byEdge: new Map(),
					byGroup: new Map(),
					errors: 2,
					warnings: 0,
				},
				onFocus: noop,
				onToggle: noop,
				open: false,
			})
		);
		expect(html).toContain("エラー 2 件");
		expect(html).not.toContain("errors");
	});

	test("condition rules are numbered inside the translated legend", () => {
		const html = inLocale(
			"ja",
			createElement(ConditionFields, {
				block: {
					combinator: "and",
					id: "check",
					rules: [
						{ operator: "is_set", variableId: "var_name" },
						{ operator: "is_set", variableId: "var_name" },
					],
					type: "condition",
				},
				copy,
				createVariable: noop,
				flow: flowWithVariable(1),
				set: noop,
			})
		);
		expect(html).toContain(">ルール 2<");
		expect(html).not.toContain("Rule 2");
	});
});
