/**
 * Pure flow-editing operations for the Bot Flows canvas.
 *
 * Every function takes a Flow and returns a new Flow (never mutating its
 * input), so the editor can keep undo-free, React-friendly state and the
 * operations can be unit tested without a DOM. The Flow model itself and its
 * validator are owned by the sidecar's `contracts.ts`.
 */
import {
	type Block,
	type BlockType,
	BOT_LIMITS,
	type Edge,
	type EdgeBranch,
	type Flow,
	type FlowIssue,
	type Group,
	isInputBlock,
	VARIABLE_NAME_PATTERN,
	type Variable,
	validateFlow,
} from "../../sidecar/src/contracts.ts";

export type IdFactory = (prefix: string) => string;

const ID_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A short random id that matches the contracts' `ID_PATTERN`. */
export const randomId: IdFactory = (prefix) => {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	let suffix = "";
	for (const byte of bytes) {
		suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
	}
	return `${prefix}_${suffix}`;
};

// ---------------------------------------------------------------------------
// Handles: where an edge leaves a block
// ---------------------------------------------------------------------------

export interface EdgeSource {
	blockId: string;
	branch?: EdgeBranch;
	itemId?: string;
}

export interface BlockHandle {
	/** Short visible label next to the handle, e.g. a choice label or "true". */
	label: string | null;
	source: EdgeSource;
}

const HANDLE_PREFIX = "out";

/** Encodes an edge source as a React Flow handle id. Ids never contain ":". */
export function handleId(source: EdgeSource): string {
	if (source.itemId) {
		return `${HANDLE_PREFIX}:${source.blockId}:item:${source.itemId}`;
	}
	if (source.branch) {
		return `${HANDLE_PREFIX}:${source.blockId}:branch:${source.branch}`;
	}
	return `${HANDLE_PREFIX}:${source.blockId}`;
}

const BRANCHES = new Set<string>(["true", "false", "a", "b", "default"]);

function isBranch(value: string): value is EdgeBranch {
	return BRANCHES.has(value);
}

/** The inverse of `handleId`, or null for anything else. */
export function parseHandleId(
	value: string | null | undefined
): EdgeSource | null {
	if (!value) {
		return null;
	}
	const parts = value.split(":");
	if (parts[0] !== HANDLE_PREFIX || !parts[1]) {
		return null;
	}
	const blockId = parts[1];
	if (parts.length === 2) {
		return { blockId };
	}
	if (parts.length === 4 && parts[2] === "item" && parts[3]) {
		return { blockId, itemId: parts[3] };
	}
	if (
		parts.length === 4 &&
		parts[2] === "branch" &&
		parts[3] &&
		isBranch(parts[3])
	) {
		return { blockId, branch: parts[3] };
	}
	return null;
}

/**
 * The handles a block exposes. Single choice gets one per item plus a
 * fallback `default`; conditions and A/B tests get their two branches; jumps
 * have none (they name their target group); every other block has one plain
 * handle, which jumps when connected and otherwise falls through.
 */
export function blockHandles(block: Block): BlockHandle[] {
	switch (block.type) {
		case "choice_input":
			if (block.multiple) {
				return [{ label: null, source: { blockId: block.id } }];
			}
			return [
				...block.items.map((item) => ({
					label: item.label,
					source: { blockId: block.id, itemId: item.id },
				})),
				{
					label: "Default",
					source: { blockId: block.id, branch: "default" as const },
				},
			];
		case "condition":
			return [
				{ label: "True", source: { blockId: block.id, branch: "true" } },
				{ label: "False", source: { blockId: block.id, branch: "false" } },
			];
		case "ab_test":
			return [
				{
					label: `A · ${block.percentA}%`,
					source: { blockId: block.id, branch: "a" },
				},
				{
					label: `B · ${100 - block.percentA}%`,
					source: { blockId: block.id, branch: "b" },
				},
			];
		case "jump":
			return [];
		default:
			return [{ label: null, source: { blockId: block.id } }];
	}
}

function sameSource(left: EdgeSource, right: EdgeSource): boolean {
	return (
		left.blockId === right.blockId &&
		(left.itemId ?? "") === (right.itemId ?? "") &&
		(left.branch ?? "") === (right.branch ?? "")
	);
}

export function edgeFrom(flow: Flow, source: EdgeSource): Edge | undefined {
	return flow.edges.find((edge) => sameSource(edge.from, source));
}

export function groupOfBlock(flow: Flow, blockId: string): Group | undefined {
	return flow.groups.find((group) =>
		group.blocks.some((block) => block.id === blockId)
	);
}

export function findBlock(
	flow: Flow,
	blockId: string
): { block: Block; group: Group; index: number } | null {
	for (const group of flow.groups) {
		const index = group.blocks.findIndex((block) => block.id === blockId);
		const block = group.blocks[index];
		if (block) {
			return { block, group, index };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** Connects a handle to a group, replacing whatever that handle pointed at. */
export function connect(
	flow: Flow,
	source: EdgeSource,
	groupId: string,
	newId: IdFactory = randomId
): Flow {
	const located = findBlock(flow, source.blockId);
	if (!located) {
		return flow;
	}
	if (!flow.groups.some((group) => group.id === groupId)) {
		return flow;
	}
	const allowed = blockHandles(located.block).some((handle) =>
		sameSource(handle.source, source)
	);
	if (!allowed) {
		return flow;
	}
	const from: Edge["from"] = { blockId: source.blockId };
	if (source.itemId) {
		from.itemId = source.itemId;
	}
	if (source.branch) {
		from.branch = source.branch;
	}
	const kept = flow.edges.filter((edge) => !sameSource(edge.from, source));
	if (kept.length >= BOT_LIMITS.edges) {
		return flow;
	}
	return {
		...flow,
		edges: [...kept, { id: newId("e"), from, to: { groupId } }],
	};
}

export function removeEdge(flow: Flow, edgeId: string): Flow {
	return { ...flow, edges: flow.edges.filter((edge) => edge.id !== edgeId) };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function addGroup(
	flow: Flow,
	position: { x: number; y: number },
	title: string,
	newId: IdFactory = randomId
): { flow: Flow; groupId: string } {
	if (flow.groups.length >= BOT_LIMITS.groups) {
		return { flow, groupId: "" };
	}
	const groupId = newId("g");
	return {
		flow: {
			...flow,
			groups: [...flow.groups, { id: groupId, title, position, blocks: [] }],
		},
		groupId,
	};
}

export function renameGroup(flow: Flow, groupId: string, title: string): Flow {
	return {
		...flow,
		groups: flow.groups.map((group) =>
			group.id === groupId
				? { ...group, title: title.slice(0, BOT_LIMITS.nameLength) }
				: group
		),
	};
}

export function moveGroup(
	flow: Flow,
	groupId: string,
	position: { x: number; y: number }
): Flow {
	return {
		...flow,
		groups: flow.groups.map((group) =>
			group.id === groupId
				? {
						...group,
						position: { x: Math.round(position.x), y: Math.round(position.y) },
					}
				: group
		),
	};
}

/** Jump blocks in other groups that point at `groupId`. */
export function jumpsTo(flow: Flow, groupId: string): Block[] {
	return flow.groups.flatMap((group) =>
		group.id === groupId
			? []
			: group.blocks.filter(
					(block) => block.type === "jump" && block.groupId === groupId
				)
	);
}

/**
 * Deletes a group (never the start group), its blocks, their edges, every
 * edge into it, and the Jump blocks elsewhere that pointed at it.
 */
export function deleteGroup(flow: Flow, groupId: string): Flow {
	if (groupId === flow.startGroupId) {
		return flow;
	}
	const group = flow.groups.find((candidate) => candidate.id === groupId);
	if (!group) {
		return flow;
	}
	const removed = new Set([
		...group.blocks.map((block) => block.id),
		...jumpsTo(flow, groupId).map((block) => block.id),
	]);
	return {
		...flow,
		groups: flow.groups
			.filter((candidate) => candidate.id !== groupId)
			.map((candidate) => {
				const blocks = candidate.blocks.filter(
					(block) => !removed.has(block.id)
				);
				return blocks.length === candidate.blocks.length
					? candidate
					: { ...candidate, blocks };
			}),
		edges: flow.edges.filter(
			(edge) => !(removed.has(edge.from.blockId) || edge.to.groupId === groupId)
		),
	};
}

export function setStartGroup(flow: Flow, groupId: string): Flow {
	return flow.groups.some((group) => group.id === groupId)
		? { ...flow, startGroupId: groupId }
		: flow;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const BLOCK_LABELS: Record<BlockType, string> = {
	text: "Text",
	image: "Image",
	video: "Video",
	embed: "Embed",
	text_input: "Text input",
	number_input: "Number",
	email_input: "Email",
	phone_input: "Phone",
	url_input: "Website",
	date_input: "Date",
	rating_input: "Rating",
	choice_input: "Buttons",
	set_variable: "Set variable",
	condition: "Condition",
	redirect: "Redirect",
	jump: "Jump",
	wait: "Wait",
	ab_test: "A/B test",
	ai_reply: "AI reply",
	http_request: "HTTP request",
	handoff: "Handoff",
};

/** Variable name suggested for a new input's `saveTo`. */
const INPUT_VARIABLE_HINTS: Partial<Record<BlockType, string>> = {
	text_input: "answer",
	number_input: "number",
	email_input: "email",
	phone_input: "phone",
	url_input: "website",
	date_input: "date",
	rating_input: "rating",
	choice_input: "choice",
};

/**
 * Builds a new block with sensible defaults. Inputs get a fresh variable to
 * save into; logic blocks that need a variable reuse the first one, or create
 * one when the bot has none.
 */
export function createBlock(
	flow: Flow,
	type: BlockType,
	targetGroupId: string,
	newId: IdFactory = randomId
): { block: Block; flow: Flow } {
	const id = newId("b");
	const needVariable = (hint: string): { flow: Flow; variableId: string } => {
		const first = flow.variables[0];
		if (first) {
			return { flow, variableId: first.id };
		}
		return addVariable(flow, hint, newId);
	};
	const saveTarget = (): { flow: Flow; saveTo?: string } => {
		const hint = INPUT_VARIABLE_HINTS[type];
		if (!hint) {
			return { flow };
		}
		const created = addVariable(flow, hint, newId);
		return created.variableId
			? { flow: created.flow, saveTo: created.variableId }
			: { flow };
	};
	switch (type) {
		case "text":
			return { flow, block: { id, type, content: "New message" } };
		case "image":
			return { flow, block: { id, type, url: "https://", alt: "" } };
		case "video":
			return { flow, block: { id, type, url: "https://" } };
		case "embed":
			return { flow, block: { id, type, url: "https://", height: 400 } };
		case "set_variable": {
			const target = needVariable("score");
			return {
				flow: target.flow,
				block: {
					id,
					type,
					variableId: target.variableId,
					op: "set",
					value: "",
				},
			};
		}
		case "condition": {
			const target = needVariable("answer");
			return {
				flow: target.flow,
				block: {
					id,
					type,
					combinator: "and",
					rules: [
						{ variableId: target.variableId, operator: "equals", value: "" },
					],
				},
			};
		}
		case "redirect":
			return {
				flow,
				block: { id, type, url: "https://example.com", newTab: true },
			};
		case "jump": {
			const other =
				flow.groups.find((group) => group.id !== targetGroupId) ??
				flow.groups[0];
			return { flow, block: { id, type, groupId: other?.id ?? targetGroupId } };
		}
		case "wait":
			return { flow, block: { id, type, seconds: 1 } };
		case "ab_test":
			return { flow, block: { id, type, percentA: 50 } };
		case "ai_reply":
			return {
				flow,
				block: {
					id,
					type,
					instructions:
						"You are a friendly assistant for this website. Answer briefly and only from the knowledge provided.",
					promptTemplate: "{{question}}",
					useKnowledge: true,
					maxChars: 800,
				},
			};
		case "http_request":
			return {
				flow,
				block: {
					id,
					type,
					method: "POST",
					url: "https://",
					headers: [],
					body: "",
					responseMapping: [],
					timeoutMs: 5000,
				},
			};
		case "handoff":
			return {
				flow,
				block: {
					id,
					type,
					topic: "support",
					summaryTemplate: "",
					message: "Thanks! Someone from our team will follow up soon.",
				},
			};
		default: {
			const target = saveTarget();
			return {
				flow: target.flow,
				block: inputBlock(type, id, target.saveTo, newId),
			};
		}
	}
}

function inputBlock(
	type: BlockType,
	id: string,
	saveTo: string | undefined,
	newId: IdFactory
): Block {
	const common = saveTo ? { id, saveTo } : { id };
	switch (type) {
		case "number_input":
			return { ...common, type: "number_input" };
		case "email_input":
			return { ...common, type: "email_input", placeholder: "you@example.com" };
		case "phone_input":
			return { ...common, type: "phone_input" };
		case "url_input":
			return { ...common, type: "url_input", placeholder: "https://" };
		case "date_input":
			return { ...common, type: "date_input" };
		case "rating_input":
			return { ...common, type: "rating_input", scale: "stars", length: 5 };
		case "choice_input":
			return {
				...common,
				type: "choice_input",
				items: [
					{ id: newId("i"), label: "Yes" },
					{ id: newId("i"), label: "No" },
				],
			};
		default:
			return {
				...common,
				type: "text_input",
				placeholder: "Type your answer…",
			};
	}
}

export function addBlock(
	flow: Flow,
	groupId: string,
	type: BlockType,
	newId: IdFactory = randomId
): { blockId: string; flow: Flow } {
	const group = flow.groups.find((candidate) => candidate.id === groupId);
	if (!group || group.blocks.length >= BOT_LIMITS.blocksPerGroup) {
		return { flow, blockId: "" };
	}
	const created = createBlock(flow, type, groupId, newId);
	return {
		blockId: created.block.id,
		flow: {
			...created.flow,
			groups: created.flow.groups.map((candidate) =>
				candidate.id === groupId
					? { ...candidate, blocks: [...candidate.blocks, created.block] }
					: candidate
			),
		},
	};
}

/**
 * Replaces a block (same id). Edges whose handle disappeared, such as a
 * deleted choice item or a single choice switched to multiple, are removed.
 */
export function updateBlock(flow: Flow, block: Block): Flow {
	const groups = flow.groups.map((group) => ({
		...group,
		blocks: group.blocks.map((candidate) =>
			candidate.id === block.id ? block : candidate
		),
	}));
	const handles = blockHandles(block);
	const edges = flow.edges.filter(
		(edge) =>
			edge.from.blockId !== block.id ||
			handles.some((handle) => sameSource(handle.source, edge.from))
	);
	return { ...flow, groups, edges };
}

export function deleteBlock(flow: Flow, blockId: string): Flow {
	return {
		...flow,
		groups: flow.groups.map((group) => ({
			...group,
			blocks: group.blocks.filter((block) => block.id !== blockId),
		})),
		edges: flow.edges.filter((edge) => edge.from.blockId !== blockId),
	};
}

export function moveBlock(
	flow: Flow,
	blockId: string,
	direction: -1 | 1
): Flow {
	return {
		...flow,
		groups: flow.groups.map((group) => {
			const index = group.blocks.findIndex((block) => block.id === blockId);
			const target = index + direction;
			if (index < 0 || target < 0 || target >= group.blocks.length) {
				return group;
			}
			const blocks = [...group.blocks];
			const [moved] = blocks.splice(index, 1);
			if (moved) {
				blocks.splice(target, 0, moved);
			}
			return { ...group, blocks };
		}),
	};
}

/** Moves a block to the end of another group, keeping its edges. */
export function moveBlockToGroup(
	flow: Flow,
	blockId: string,
	groupId: string
): Flow {
	const located = findBlock(flow, blockId);
	const target = flow.groups.find((group) => group.id === groupId);
	if (
		!(located && target) ||
		located.group.id === groupId ||
		target.blocks.length >= BOT_LIMITS.blocksPerGroup
	) {
		return flow;
	}
	return {
		...flow,
		groups: flow.groups.map((group) => {
			if (group.id === located.group.id) {
				return {
					...group,
					blocks: group.blocks.filter((block) => block.id !== blockId),
				};
			}
			if (group.id === groupId) {
				return { ...group, blocks: [...group.blocks, located.block] };
			}
			return group;
		}),
	};
}

// ---------------------------------------------------------------------------
// Summaries and validation
// ---------------------------------------------------------------------------

function variableName(flow: Flow, variableId: string | undefined): string {
	if (!variableId) {
		return "";
	}
	return (
		flow.variables.find((variable) => variable.id === variableId)?.name ??
		"missing variable"
	);
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

/** One line describing a block on the canvas. */
export function blockSummary(flow: Flow, block: Block): string {
	switch (block.type) {
		case "text":
			return clip(plainText(block.content));
		case "image":
		case "video":
		case "embed":
			return clip(block.url);
		case "set_variable": {
			const name = variableName(flow, block.variableId);
			return block.op === "set" || block.op === "append"
				? clip(
						`${name} ${block.op === "set" ? "=" : "+="} ${block.value ?? ""}`
					)
				: `${name} · ${block.op.replace("_", " ")}`;
		}
		case "condition":
			return clip(
				block.rules
					.map((rule) =>
						`${variableName(flow, rule.variableId)} ${rule.operator.replaceAll("_", " ")} ${rule.value ?? ""}`.trim()
					)
					.join(` ${block.combinator} `)
			);
		case "redirect":
			return clip(block.url);
		case "jump":
			return `→ ${flow.groups.find((group) => group.id === block.groupId)?.title || "missing group"}`;
		case "wait":
			return `${block.seconds}s`;
		case "ab_test":
			return `${block.percentA}% / ${100 - block.percentA}%`;
		case "ai_reply":
			return clip(block.promptTemplate);
		case "http_request":
			return clip(`${block.method} ${block.url}`);
		case "handoff":
			return clip(`Topic: ${block.topic}`);
		default: {
			const saved = isInputBlock(block) && block.saveTo;
			const target = saved ? ` → ${variableName(flow, block.saveTo)}` : "";
			return clip(`${block.placeholder ?? BLOCK_LABELS[block.type]}${target}`);
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

export interface LayoutBox {
	height: number;
	id: string;
	/** A box being dragged keeps its position and only pushes others. */
	pinned?: boolean;
	width: number;
	x: number;
	y: number;
}

const LAYOUT_GAP = 24;

/**
 * Display-only layout: pushes groups down so none overlaps another group in
 * the same column once their rendered heights are known. Stored positions are
 * unchanged until the owner drags a group.
 */
export function resolveOverlaps(boxes: LayoutBox[]): Map<string, number> {
	const placed: LayoutBox[] = [];
	const result = new Map<string, number>();
	const ordered = [...boxes].sort(
		(left, right) =>
			Number(right.pinned === true) - Number(left.pinned === true) ||
			left.y - right.y ||
			left.x - right.x
	);
	for (const box of ordered) {
		let y = box.y;
		if (!box.pinned) {
			let moved = true;
			while (moved) {
				moved = false;
				for (const other of placed) {
					const sameColumn =
						box.x < other.x + other.width && other.x < box.x + box.width;
					const overlaps =
						y < other.y + other.height + LAYOUT_GAP &&
						other.y < y + box.height + LAYOUT_GAP;
					if (sameColumn && overlaps) {
						y = other.y + other.height + LAYOUT_GAP;
						moved = true;
					}
				}
			}
		}
		placed.push({ ...box, y });
		result.set(box.id, y);
	}
	return result;
}

/** A position to the right of the existing groups for a new group. */
export function nextGroupPosition(flow: Flow): { x: number; y: number } {
	if (flow.groups.length === 0) {
		return { x: 0, y: 0 };
	}
	const rightmost = Math.max(...flow.groups.map((group) => group.position.x));
	const top = Math.min(...flow.groups.map((group) => group.position.y));
	return { x: rightmost + 340, y: top };
}
