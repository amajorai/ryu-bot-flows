/** Ids, edge handles, and block lookup for the Bot Flows canvas model. */
import type {
	Block,
	Edge,
	EdgeBranch,
	Flow,
	Group,
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

export function sameSource(left: EdgeSource, right: EdgeSource): boolean {
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
