/**
 * Pure canvas policies for the Bot Flows editor, kept out of the React Flow
 * component so they can be unit tested without a DOM.
 */
import type { FitViewOptions } from "@xyflow/react";

type Padding = NonNullable<FitViewOptions["padding"]>;

/** Tailwind's `sm` and `lg` breakpoints, which the inspector layout uses. */
export const SM_BREAKPOINT = 640;
export const LG_BREAKPOINT = 1024;
/** The inspector's width from `sm` to `lg` (`sm:w-96`). */
export const INSPECTOR_WIDTH = 384;

/**
 * What the Delete/Backspace key may remove: only edges the user explicitly
 * selected. Groups are deleted through the inspector (with a confirmation),
 * so a selected group never takes its connections with it.
 */
export function explicitDeletions<TNode, TEdge extends { selected?: boolean }>({
	edges,
}: {
	edges: TEdge[];
	nodes: TNode[];
}): {
	edges: TEdge[];
	nodes: TNode[];
} {
	return { nodes: [], edges: edges.filter((edge) => edge.selected === true) };
}

/**
 * `fitView` padding that keeps the focused group in the part of the canvas
 * the inspector leaves visible. From `lg` the inspector sits beside the
 * canvas; from `sm` it overlays the right 384px; below `sm` it is a bottom
 * sheet covering the lower 60%.
 */
export function inspectorFitPadding(
	viewportWidth: number,
	inspectorOpen: boolean
): Padding {
	if (!inspectorOpen || viewportWidth >= LG_BREAKPOINT) {
		return 0.2;
	}
	if (viewportWidth >= SM_BREAKPOINT) {
		return {
			top: "10%",
			bottom: "10%",
			left: "5%",
			right: `${INSPECTOR_WIDTH + 24}px`,
		};
	}
	return { top: "5%", bottom: "62%", x: "5%" };
}
