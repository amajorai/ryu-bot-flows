/** Block operations for the Bot Flows canvas model. */
import {
	type Block,
	type BlockType,
	BOT_LIMITS,
	type Flow,
} from "../../sidecar/src/contracts.ts";
import {
	blockHandles,
	findBlock,
	type IdFactory,
	randomId,
	sameSource,
} from "./flow-model-handles.ts";
import { addVariable } from "./flow-model-variables.ts";

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
