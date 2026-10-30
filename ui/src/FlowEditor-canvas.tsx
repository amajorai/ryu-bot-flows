import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import {
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type EdgeChange,
	type Edge as FlowEdge,
	MarkerType,
	type NodeChange,
	Panel,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlockType, FlowIssue } from "../../sidecar/src/contracts.ts";
import { BlockInspector } from "./BlockInspector.tsx";
import { explicitDeletions, inspectorFitPadding } from "./canvas.ts";
import {
	EditorContext,
	type EditorContextValue,
	type FlowEditorProps,
	type Selection,
	TARGET_HANDLE,
} from "./FlowEditor-context.tsx";
import { GroupInspector } from "./FlowEditor-group-inspector.tsx";
import {
	FIT_VIEW_OPTIONS,
	GROUP_WIDTH,
	type GroupNode,
	NODE_TYPES,
	PRO_OPTIONS,
	toNodes,
} from "./FlowEditor-group-node.tsx";
import { IssuesPanel } from "./FlowEditor-issues-panel.tsx";
import {
	addBlock,
	addGroup,
	connect,
	deleteBlock,
	deleteGroup,
	findBlock,
	handleId,
	jumpsTo,
	moveGroup,
	nextGroupPosition,
	parseHandleId,
	removeEdge,
	resolveOverlaps,
} from "./flow-model.ts";
import { VariablesDialog } from "./VariablesDialog.tsx";

export function FlowCanvas({
	aiAvailable,
	copy,
	flow,
	issues,
	onChange,
	onGenerate,
}: FlowEditorProps) {
	const [selection, setSelection] = useState<Selection>(null);
	const [nodes, setNodes] = useState<GroupNode[]>(() => toNodes(flow, []));
	const [variablesOpen, setVariablesOpen] = useState(false);
	const [issuesOpen, setIssuesOpen] = useState(false);
	const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(
		null
	);
	const reactFlow = useReactFlow();
	const tl = useLiteralMessages();

	useEffect(() => {
		setNodes((previous) => toNodes(flow, previous));
	}, [flow]);

	// Drop a selection whose target was removed (undo of a delete, a generated flow).
	useEffect(() => {
		if (!selection) {
			return;
		}
		const exists =
			(selection.kind === "block" && findBlock(flow, selection.id)) ||
			(selection.kind === "group" &&
				flow.groups.some((group) => group.id === selection.id)) ||
			(selection.kind === "edge" &&
				flow.edges.some((edge) => edge.id === selection.id));
		if (!exists) {
			setSelection(null);
		}
	}, [flow, selection]);

	// Groups render taller than their stored spacing (templates use a fixed
	// grid), so lay them out without overlaps once their heights are measured.
	const displayNodes = useMemo(() => {
		const offsets = resolveOverlaps(
			nodes.map((node) => ({
				id: node.id,
				x: node.position.x,
				y: node.position.y,
				width: node.measured?.width ?? GROUP_WIDTH,
				height: node.measured?.height ?? 0,
				pinned: node.dragging === true,
			}))
		);
		return nodes.map((node) => {
			const y = offsets.get(node.id) ?? node.position.y;
			return y === node.position.y
				? node
				: { ...node, position: { x: node.position.x, y } };
		});
	}, [nodes]);

	const edges = useMemo<FlowEdge[]>(
		() =>
			flow.edges.flatMap((edge) => {
				const source = findBlock(flow, edge.from.blockId)?.group.id;
				if (!source) {
					return [];
				}
				const broken = issues.byEdge.has(edge.id);
				const selected = selection?.kind === "edge" && selection.id === edge.id;
				return [
					{
						id: edge.id,
						source,
						sourceHandle: handleId(edge.from),
						target: edge.to.groupId,
						targetHandle: TARGET_HANDLE,
						type: "smoothstep",
						selected,
						markerEnd: { type: MarkerType.ArrowClosed },
						style: broken ? { stroke: "var(--destructive)" } : undefined,
						ariaLabel: tl("Connection to {title}", {
							title:
								flow.groups.find((group) => group.id === edge.to.groupId)
									?.title ?? "group",
						}),
					},
				];
			}),
		[flow, issues, selection, tl]
	);

	const onNodesChange = useCallback((changes: NodeChange<GroupNode>[]) => {
		// Deleting groups goes through the inspector (with confirmation);
		// a finished drag is committed by onNodeDragStop.
		const allowed = changes.filter((change) => change.type !== "remove");
		setNodes((previous) => applyNodeChanges(allowed, previous));
	}, []);

	const onBeforeDelete = useCallback(
		(elements: { edges: FlowEdge[]; nodes: GroupNode[] }) =>
			Promise.resolve(explicitDeletions(elements)),
		[]
	);

	const onNodeDragStop = useCallback(
		(_event: unknown, node: GroupNode) => {
			onChange(moveGroup(flow, node.id, node.position));
		},
		[flow, onChange]
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			let next = flow;
			for (const change of changes) {
				if (change.type === "remove") {
					next = removeEdge(next, change.id);
				} else if (change.type === "select" && change.selected) {
					setSelection({ kind: "edge", id: change.id });
				}
			}
			if (next !== flow) {
				onChange(next);
			}
		},
		[flow, onChange]
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			const source = parseHandleId(connection.sourceHandle);
			if (source && connection.target) {
				onChange(connect(flow, source, connection.target));
			}
		},
		[flow, onChange]
	);

	const isValidConnection = useCallback(
		(connection: Connection | FlowEdge) =>
			parseHandleId(connection.sourceHandle) !== null &&
			connection.targetHandle === TARGET_HANDLE,
		[]
	);

	const select = useCallback((next: Selection) => setSelection(next), []);

	const onAddBlock = useCallback(
		(groupId: string, type: BlockType) => {
			const result = addBlock(flow, groupId, type);
			if (result.blockId) {
				onChange(result.flow);
				setSelection({ kind: "block", id: result.blockId });
			}
		},
		[flow, onChange]
	);

	const addNewGroup = () => {
		const position = nextGroupPosition(flow);
		const result = addGroup(
			flow,
			position,
			`${copy("group", "Group")} ${flow.groups.length + 1}`
		);
		if (result.groupId) {
			onChange(result.flow);
			setSelection({ kind: "group", id: result.groupId });
			const groupId = result.groupId;
			requestAnimationFrame(() => focusGroup(groupId));
		}
	};

	/** Centers a group in the canvas area the inspector leaves visible. */
	const focusGroup = (groupId: string) => {
		void reactFlow.fitView({
			nodes: [{ id: groupId }],
			maxZoom: FIT_VIEW_OPTIONS.maxZoom,
			padding: inspectorFitPadding(window.innerWidth, true),
			duration: 200,
		});
	};

	const focusIssue = (issue: FlowIssue) => {
		if (issue.edgeId) {
			setSelection({ kind: "edge", id: issue.edgeId });
		} else if (issue.blockId) {
			setSelection({ kind: "block", id: issue.blockId });
		} else if (issue.groupId) {
			setSelection({ kind: "group", id: issue.groupId });
		}
		const groupId = issue.blockId
			? findBlock(flow, issue.blockId)?.group.id
			: issue.groupId;
		if (groupId) {
			focusGroup(groupId);
		}
	};

	const context = useMemo<EditorContextValue>(
		() => ({ copy, flow, issues, onAddBlock, onSelect: select, selection }),
		[copy, flow, issues, onAddBlock, select, selection]
	);

	const confirmJumps = confirmDeleteGroup
		? jumpsTo(flow, confirmDeleteGroup).length
		: 0;
	const selectedBlock =
		selection?.kind === "block" ? findBlock(flow, selection.id) : null;
	const selectedGroup =
		selection?.kind === "group"
			? flow.groups.find((group) => group.id === selection.id)
			: undefined;
	const selectedEdge =
		selection?.kind === "edge"
			? flow.edges.find((edge) => edge.id === selection.id)
			: undefined;

	return (
		<EditorContext.Provider value={context}>
			<div className="relative flex h-full min-h-0 w-full" data-bot-canvas="">
				<div
					className="relative min-h-0 min-w-0 flex-1"
					data-testid="flow-canvas"
				>
					<ReactFlow
						deleteKeyCode={["Backspace", "Delete"]}
						edges={edges}
						fitView
						fitViewOptions={FIT_VIEW_OPTIONS}
						isValidConnection={isValidConnection}
						minZoom={0.2}
						nodes={displayNodes}
						nodeTypes={NODE_TYPES}
						onBeforeDelete={onBeforeDelete}
						onConnect={onConnect}
						onEdgesChange={onEdgesChange}
						onNodeDragStop={onNodeDragStop}
						onNodesChange={onNodesChange}
						onPaneClick={() => setSelection(null)}
						proOptions={PRO_OPTIONS}
					>
						<Background gap={20} size={1} />
						<Controls position="bottom-left" showInteractive={false} />
						<Panel position="top-left">
							<div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
								<Button onClick={addNewGroup} size="sm" variant="ghost">
									{copy("addGroup", "Add group")}
								</Button>
								<Button
									onClick={() => setVariablesOpen(true)}
									size="sm"
									variant="ghost"
								>
									{copy("variables", "Variables")}
									<span className="font-mono text-muted-foreground text-xs tabular-nums">
										{flow.variables.length}
									</span>
								</Button>
								<Button
									disabled={!aiAvailable}
									onClick={onGenerate}
									size="sm"
									title={
										aiAvailable
											? undefined
											: copy(
													"aiUnavailable",
													"AI models aren't available to this app here."
												)
									}
									variant="ghost"
								>
									{copy("generate", "Generate flow")}
								</Button>
							</div>
						</Panel>
						<Panel position="bottom-right">
							<IssuesPanel
								copy={copy}
								flow={flow}
								issues={issues}
								onFocus={focusIssue}
								onToggle={() => setIssuesOpen((open) => !open)}
								open={issuesOpen}
							/>
						</Panel>
					</ReactFlow>
				</div>
				{selection ? (
					<aside
						aria-label={copy("inspector", "Inspector")}
						className="absolute inset-x-0 bottom-0 z-10 h-[60%] overflow-y-auto border-border border-t bg-background p-4 shadow-lg sm:inset-x-auto sm:inset-y-0 sm:end-0 sm:h-auto sm:w-96 sm:border-s sm:border-t-0 lg:static lg:shadow-none"
						data-testid="inspector"
					>
						<div className="mb-3 flex items-center justify-between gap-2">
							<h2 className="font-heading font-medium text-sm">
								{selectedBlock
									? copy("blockSettings", "Block")
									: selectedGroup
										? copy("groupSettings", "Group")
										: copy("connection", "Connection")}
							</h2>
							<Button
								onClick={() => setSelection(null)}
								size="sm"
								variant="ghost"
							>
								{copy("close", "Close")}
							</Button>
						</div>
						{selectedBlock ? (
							<BlockInspector
								block={selectedBlock.block}
								copy={copy}
								flow={flow}
								issues={issues.byBlock.get(selectedBlock.block.id) ?? []}
								onDelete={() => {
									onChange(deleteBlock(flow, selectedBlock.block.id));
									setSelection({ kind: "group", id: selectedBlock.group.id });
								}}
								onFlowChange={onChange}
							/>
						) : null}
						{selectedGroup ? (
							<GroupInspector
								copy={copy}
								flow={flow}
								group={selectedGroup}
								issues={issues.byGroup.get(selectedGroup.id) ?? []}
								onAddBlock={(type) => onAddBlock(selectedGroup.id, type)}
								onChange={onChange}
								onDelete={() => setConfirmDeleteGroup(selectedGroup.id)}
								onSelectBlock={(id) => setSelection({ kind: "block", id })}
							/>
						) : null}
						{selectedEdge ? (
							<div className="grid gap-3">
								<p className="text-sm">
									{copy("connectsTo", "Goes to")}{" "}
									<strong>
										{flow.groups.find(
											(group) => group.id === selectedEdge.to.groupId
										)?.title ?? copy("missingGroup", "Missing group")}
									</strong>
								</p>
								{(issues.byEdge.get(selectedEdge.id) ?? []).map((issue) => (
									<p
										className="text-status-destructive text-xs"
										key={issue.message}
									>
										{issue.message}
									</p>
								))}
								<Button
									className="w-fit"
									onClick={() => {
										onChange(removeEdge(flow, selectedEdge.id));
										setSelection(null);
									}}
									size="sm"
									variant="destructive"
								>
									{copy("deleteConnection", "Delete connection")}
								</Button>
							</div>
						) : null}
					</aside>
				) : null}
			</div>
			<VariablesDialog
				copy={copy}
				flow={flow}
				onChange={onChange}
				onOpenChange={setVariablesOpen}
				open={variablesOpen}
			/>
			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setConfirmDeleteGroup(null);
					}
				}}
				open={confirmDeleteGroup !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{copy("deleteGroupTitle", "Delete group?")}
						</DialogTitle>
						<DialogDescription>
							{copy(
								"deleteGroupDescription",
								"The group, its blocks, and every connection to or from it are removed from the draft."
							)}
							{confirmJumps > 0
								? ` ${confirmJumps} ${
										confirmJumps === 1
											? copy(
													"deleteGroupJumpOne",
													"Jump block elsewhere points to it and is removed too."
												)
											: copy(
													"deleteGroupJumps",
													"Jump blocks elsewhere point to it and are removed too."
												)
									}`
								: null}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setConfirmDeleteGroup(null)}
							variant="outline"
						>
							{copy("cancel", "Cancel")}
						</Button>
						<Button
							onClick={() => {
								if (confirmDeleteGroup) {
									onChange(deleteGroup(flow, confirmDeleteGroup));
								}
								setConfirmDeleteGroup(null);
								setSelection(null);
							}}
							variant="destructive"
						>
							{copy("deleteGroup", "Delete group")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</EditorContext.Provider>
	);
}
