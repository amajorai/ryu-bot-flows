import { createContext, useContext } from "react";
import type { BlockType, Flow } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import type { IssueIndex } from "./flow-model.ts";

export type Selection =
	| { id: string; kind: "block" }
	| { id: string; kind: "edge" }
	| { id: string; kind: "group" }
	| null;

export const TARGET_HANDLE = "in";

export interface EditorContextValue {
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	onAddBlock: (groupId: string, type: BlockType) => void;
	onSelect: (selection: Selection) => void;
	selection: Selection;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
	const value = useContext(EditorContext);
	if (!value) {
		throw new Error("Bot Flows canvas nodes must render inside the editor.");
	}
	return value;
}

export interface FlowEditorProps {
	aiAvailable: boolean;
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	onChange: (flow: Flow) => void;
	onGenerate: () => void;
}
