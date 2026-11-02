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
	BOT_LIMITS,
	type Edge,
	type Flow,
} from "../../sidecar/src/contracts.ts";
import {
	blockHandles,
	type EdgeSource,
	findBlock,
	type IdFactory,
	randomId,
	sameSource,
} from "./flow-model-handles.ts";

// ---------------------------------------------------------------------------
// Edges

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

// The rest of the model lives in sibling modules; re-exported here so imports
// of `./flow-model.ts` stay stable.
export {
	addBlock,
	BLOCK_LABELS,
	createBlock,
	deleteBlock,
	moveBlock,
	moveBlockToGroup,
	updateBlock,
} from "./flow-model-blocks.ts";
export {
	type BlockHandle,
	blockHandles,
	type EdgeSource,
	edgeFrom,
	findBlock,
	groupOfBlock,
	handleId,
	type IdFactory,
	parseHandleId,
	randomId,
} from "./flow-model-handles.ts";
export {
	type LayoutBox,
	nextGroupPosition,
	resolveOverlaps,
} from "./flow-model-layout.ts";
export {
	blockSummary,
	type IssueIndex,
	indexIssues,
	plainText,
} from "./flow-model-summary.ts";
export {
	addVariable,
	deleteVariable,
	isValidVariableName,
	renameVariable,
	uniqueVariableName,
	updateVariable,
	variableUsage,
} from "./flow-model-variables.ts";
