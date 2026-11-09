/** Variable operations for the Bot Flows canvas model. */
import {
	type Block,
	BOT_LIMITS,
	type Flow,
	VARIABLE_NAME_PATTERN,
	type Variable,
} from "../../sidecar/src/contracts.ts";
import { type IdFactory, randomId } from "./flow-model-handles.ts";

/** A variable name that is valid and unused, derived from `base`. */
export function uniqueVariableName(flow: Flow, base: string): string {
	const cleaned =
		base
			.normalize("NFKD")
			.replace(/[^A-Za-z0-9_]+/g, "_")
			.replace(/^[^A-Za-z_]+/, "")
			.replace(/_+$/g, "")
			.slice(0, 56) || "variable";
	const taken = new Set(flow.variables.map((variable) => variable.name));
	if (!taken.has(cleaned)) {
		return cleaned;
	}
	for (let index = 2; ; index++) {
		const candidate = `${cleaned}_${index}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

export function addVariable(
	flow: Flow,
	name: string,
	newId: IdFactory = randomId
): { flow: Flow; variableId: string } {
	if (flow.variables.length >= BOT_LIMITS.variables) {
		return { flow, variableId: "" };
	}
	const variable: Variable = {
		id: newId("v"),
		name: uniqueVariableName(flow, name),
	};
	return {
		flow: { ...flow, variables: [...flow.variables, variable] },
		variableId: variable.id,
	};
}

export function isValidVariableName(name: string): boolean {
	return VARIABLE_NAME_PATTERN.test(name);
}

export function updateVariable(
	flow: Flow,
	variableId: string,
	patch: Partial<Pick<Variable, "name" | "hidden">>
): Flow {
	return {
		...flow,
		variables: flow.variables.map((variable) => {
			if (variable.id !== variableId) {
				return variable;
			}
			const { hidden, ...rest }: Variable = { ...variable, ...patch };
			return hidden ? { ...rest, hidden } : rest;
		}),
	};
}

/** Rewrites `{{from}}` tokens (any inner spacing) to `{{to}}`. */
function renameTokens(template: string, from: string, to: string): string {
	return template.replace(
		new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, "g"),
		`{{${to}}}`
	);
}

/** Applies `rewrite` to every template field a block renders (see `blockTemplates`). */
function rewriteBlockTemplates(
	block: Block,
	rewrite: (template: string) => string
): Block {
	switch (block.type) {
		case "text":
			return { ...block, content: rewrite(block.content) };
		case "redirect":
			return { ...block, url: rewrite(block.url) };
		case "set_variable":
			return block.value === undefined
				? block
				: { ...block, value: rewrite(block.value) };
		case "condition":
			return {
				...block,
				rules: block.rules.map((rule) =>
					rule.value === undefined
						? rule
						: { ...rule, value: rewrite(rule.value) }
				),
			};
		case "ai_reply":
			return {
				...block,
				promptTemplate: rewrite(block.promptTemplate),
				instructions: rewrite(block.instructions),
			};
		case "http_request":
			return {
				...block,
				url: rewrite(block.url),
				body: rewrite(block.body),
				headers: block.headers.map((header) => ({
					...header,
					value: rewrite(header.value),
				})),
			};
		case "handoff":
			return {
				...block,
				summaryTemplate: rewrite(block.summaryTemplate),
				message: rewrite(block.message),
				topic: rewrite(block.topic),
			};
		default:
			return block;
	}
}

/**
 * Renames a variable and rewrites every `{{oldName}}` template that referenced
 * it, so a rename never leaves messages with an unfilled token. Invalid or
 * taken names leave the flow unchanged.
 */
export function renameVariable(
	flow: Flow,
	variableId: string,
	name: string
): Flow {
	const variable = flow.variables.find(
		(candidate) => candidate.id === variableId
	);
	if (
		!variable ||
		variable.name === name ||
		!isValidVariableName(name) ||
		flow.variables.some(
			(candidate) => candidate.id !== variableId && candidate.name === name
		)
	) {
		return flow;
	}
	const from = variable.name;
	const rewrite = (template: string) => renameTokens(template, from, name);
	return {
		...updateVariable(flow, variableId, { name }),
		groups: flow.groups.map((group) => ({
			...group,
			blocks: group.blocks.map((block) =>
				rewriteBlockTemplates(block, rewrite)
			),
		})),
	};
}

/** How many blocks read or write a variable (by id or `{{name}}`). */
export function variableUsage(flow: Flow, variableId: string): number {
	const variable = flow.variables.find(
		(candidate) => candidate.id === variableId
	);
	if (!variable) {
		return 0;
	}
	const token = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`);
	let count = 0;
	for (const group of flow.groups) {
		for (const block of group.blocks) {
			const serialized = JSON.stringify(block);
			if (serialized.includes(`"${variableId}"`) || token.test(serialized)) {
				count++;
			}
		}
	}
	return count;
}

/** Removes a variable. Blocks that used it are reported by validation. */
export function deleteVariable(flow: Flow, variableId: string): Flow {
	return {
		...flow,
		variables: flow.variables.filter((variable) => variable.id !== variableId),
	};
}
