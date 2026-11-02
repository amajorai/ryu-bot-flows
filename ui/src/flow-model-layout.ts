/** Display-only layout helpers for the Bot Flows canvas. */
import type { Flow } from "../../sidecar/src/contracts.ts";

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
