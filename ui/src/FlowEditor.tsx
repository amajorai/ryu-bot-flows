// The Bot Flows canvas: groups are React Flow nodes listing their blocks, with
// a source handle on every block, choice item, and branch, and one target
// handle per group. React Flow only renders the graph; every edit goes through
// the pure operations in `flow-model.ts`, and controls are shared Ryu
// primitives.
import { ReactFlowProvider } from "@xyflow/react";
import { FlowCanvas } from "./FlowEditor-canvas.tsx";
import type { FlowEditorProps } from "./FlowEditor-context.tsx";

export { AddBlockMenu } from "./FlowEditor-add-block-menu.tsx";
export type { FlowEditorProps, Selection } from "./FlowEditor-context.tsx";

export function FlowEditor(props: FlowEditorProps) {
	return (
		<ReactFlowProvider>
			<FlowCanvas {...props} />
		</ReactFlowProvider>
	);
}
