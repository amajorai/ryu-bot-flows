/**
 * Canvas summaries and inline validation for the Bot Flows canvas model.
 *
 * A summary is the one line a block shows on the canvas. Its copy goes through
 * the active locale: each condition rule is one whole ICU message so a
 * translator can reorder the variable, operator and value, the combinator is
 * the locale's list conjunction or disjunction, and a wait reads in the
 * locale's short second unit.
 */
import { activeLocale, translate } from "@ryu/i18n/core";
import { formatDurationUnit } from "@ryu/i18n/format-intl";
import { formatPercent } from "@ryu/i18n/format-percent";
import {
	type Block,
	type BlockOf,
	type Flow,
	type FlowIssue,
	isInputBlock,
	validateFlow,
} from "../../sidecar/src/contracts.ts";
import { BLOCK_LABELS } from "./flow-model-blocks.ts";
import { groupOfBlock } from "./flow-model-handles.ts";

/** The translator a summary formats its copy with (`translate` by default). */
export type SummaryTranslate = typeof translate;

function variableName(
	flow: Flow,
	variableId: string | undefined,
	tl: SummaryTranslate
): string {
	if (!variableId) {
		return "";
	}
	return (
		flow.variables.find((variable) => variable.id === variableId)?.name ??
		tl("missing variable")
	);
}

/** Wraps a value in FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE. */
function isolateBidi(value: string): string {
	return `\u2068${value}\u2069`;
}

function clip(value: string, max = 60): string {
	const single = value.replace(/\s+/g, " ").trim();
	return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** Drops the mini-markdown markers so canvas summaries read as plain text. */
export function plainText(value: string): string {
	return value
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/\*([^*\n]+)\*/g, "$1");
}

function setVariableSummary(
	flow: Flow,
	block: BlockOf<"set_variable">,
	tl: SummaryTranslate
): string {
	const name = variableName(flow, block.variableId, tl);
	if (block.op === "set" || block.op === "append") {
		return clip(
			`${name} ${block.op === "set" ? "=" : "+="} ${block.value ?? ""}`
		);
	}
	return tl(
		"{name} · {op, select, increment {increment} clear {clear} now {current date and time} random_id {random id} result_id {result id} transcript {conversation transcript} other {{op}}}",
		{ name, op: block.op }
	);
}

function conditionSummary(
	flow: Flow,
	block: BlockOf<"condition">,
	tl: SummaryTranslate
): string {
	const rules = block.rules.map((rule) =>
		tl(
			"{variable} {operator, select, equals {equals {value}} not_equals {does not equal {value}} contains {contains {value}} not_contains {does not contain {value}} greater_than {is greater than {value}} less_than {is less than {value}} is_set {is set} is_empty {is empty} starts_with {starts with {value}} ends_with {ends with {value}} other {{operator} {value}}}",
			{
				operator: rule.operator,
				value: rule.value ?? "",
				variable: variableName(flow, rule.variableId, tl),
			}
		).trim()
	);
	const list = new Intl.ListFormat(activeLocale(), {
		type: block.combinator === "or" ? "disjunction" : "conjunction",
	});
	return clip(list.format(rules));
}

/**
 * One line describing a block on the canvas, in the active locale. Pass
 * `tl` to format the copy with another translator.
 */
export function blockSummary(
	flow: Flow,
	block: Block,
	tl: SummaryTranslate = translate
): string {
	switch (block.type) {
		case "text":
			return clip(plainText(block.content));
		case "image":
		case "video":
		case "embed":
			return clip(block.url);
		case "set_variable":
			return setVariableSummary(flow, block, tl);
		case "condition":
			return conditionSummary(flow, block, tl);
		case "redirect":
			return clip(block.url);
		case "jump":
			return tl("→ {group}", {
				group:
					flow.groups.find((group) => group.id === block.groupId)?.title ||
					tl("missing group"),
			});
		case "wait":
			return formatDurationUnit(
				block.seconds,
				"second",
				Number.isInteger(block.seconds) ? 0 : 1
			);
		case "ab_test":
			return tl("{a} / {b}", {
				a: formatPercent(block.percentA / 100),
				b: formatPercent((100 - block.percentA) / 100),
			});
		case "ai_reply":
			return clip(block.promptTemplate);
		case "http_request":
			return clip(`${block.method} ${block.url}`);
		case "handoff":
			return clip(tl("Topic: {topic}", { topic: block.topic }));
		default: {
			const label = block.placeholder ?? tl(BLOCK_LABELS[block.type]);
			if (!(isInputBlock(block) && block.saveTo)) {
				return clip(label);
			}
			// One whole message, so the RTL catalogs mirror the arrow. Each value
			// is a bidi isolate: a Latin label beside a Latin variable would
			// otherwise pull the arrow into a left-to-right run under dir="rtl".
			return clip(
				tl("{label} → {variable}", {
					label: isolateBidi(label),
					variable: isolateBidi(variableName(flow, block.saveTo, tl)),
				})
			);
		}
	}
}

export interface IssueIndex {
	all: FlowIssue[];
	byBlock: Map<string, FlowIssue[]>;
	byEdge: Map<string, FlowIssue[]>;
	byGroup: Map<string, FlowIssue[]>;
	errors: number;
	warnings: number;
}

function push(map: Map<string, FlowIssue[]>, key: string, issue: FlowIssue) {
	const list = map.get(key);
	if (list) {
		list.push(issue);
	} else {
		map.set(key, [issue]);
	}
}

/** Runs the shared validator and indexes issues for inline display. */
export function indexIssues(flow: Flow): IssueIndex {
	const all = validateFlow(flow);
	const index: IssueIndex = {
		all,
		byBlock: new Map(),
		byEdge: new Map(),
		byGroup: new Map(),
		errors: 0,
		warnings: 0,
	};
	for (const issue of all) {
		if (issue.severity === "error") {
			index.errors++;
		} else {
			index.warnings++;
		}
		if (issue.edgeId) {
			push(index.byEdge, issue.edgeId, issue);
		}
		if (issue.blockId) {
			push(index.byBlock, issue.blockId, issue);
			const group = groupOfBlock(flow, issue.blockId);
			if (group) {
				push(index.byGroup, group.id, issue);
			}
		} else if (issue.groupId) {
			push(index.byGroup, issue.groupId, issue);
		}
	}
	return index;
}
