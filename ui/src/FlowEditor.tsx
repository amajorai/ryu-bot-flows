// The Bot Flows canvas: groups are React Flow nodes listing their blocks, with
// a source handle on every block, choice item, and branch, and one target
// handle per group. React Flow only renders the graph; every edit goes through
// the pure operations in `flow-model.ts`, and controls are shared Ryu
// primitives.
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Label,
} from "@ryu/blocks/companion/controls";
import {
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type EdgeChange,
	type Edge as FlowEdge,
	Handle,
	MarkerType,
	type Node,
	type NodeChange,
	type NodeProps,
	type NodeTypes,
	Panel,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	BLOCK_CATEGORIES,
	type BlockType,
	type Flow,
	type FlowIssue,
	type Group,
} from "../../sidecar/src/contracts.ts";
import { BlockInspector } from "./BlockInspector.tsx";
import { explicitDeletions, inspectorFitPadding } from "./canvas.ts";
import type { Copy } from "./copy.ts";
import {
	addBlock,
	addGroup,
	BLOCK_LABELS,
	blockHandles,
	blockSummary,
	connect,
	deleteBlock,
	deleteGroup,
	findBlock,
	handleId,
	type IssueIndex,
	jumpsTo,
	moveGroup,
	nextGroupPosition,
	parseHandleId,
	removeEdge,
	renameGroup,
	resolveOverlaps,
	setStartGroup,
} from "./flow-model.ts";
import { VariablesDialog } from "./VariablesDialog.tsx";

export type Selection =
	| { id: string; kind: "block" }
	| { id: string; kind: "edge" }
	| { id: string; kind: "group" }
	| null;

const TARGET_HANDLE = "in";

interface EditorContextValue {
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	onAddBlock: (groupId: string, type: BlockType) => void;
	onSelect: (selection: Selection) => void;
	selection: Selection;
}

const EditorContext = createContext<EditorContextValue | null>(null);

function useEditor(): EditorContextValue {
	const value = useContext(EditorContext);
	if (!value) {
		throw new Error("Bot Flows canvas nodes must render inside the editor.");
	}
	return value;
}

const CATEGORY_LABELS: Record<keyof typeof BLOCK_CATEGORIES, string> = {
	bubbles: "Bubbles",
	inputs: "Inputs",
	logic: "Logic",
	integrations: "Integrations",
};

/** The grouped "Add block" menu (Bubbles / Inputs / Logic / Integrations). */
export function AddBlockMenu({
	copy,
	disabled,
	label,
	onAdd,
	size = "sm",
	variant = "outline",
}: {
	copy: Copy;
	disabled?: boolean;
	label: string;
	onAdd: (type: BlockType) => void;
	size?: "sm" | "xs";
	variant?: "outline" | "ghost";
}) {
	const categories = Object.keys(
		BLOCK_CATEGORIES
	) as (keyof typeof BLOCK_CATEGORIES)[];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				render={<Button className="nodrag" size={size} variant={variant} />}
			>
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="max-h-96 w-56 overflow-y-auto"
			>
				{categories.map((category, index) => (
					<DropdownMenuGroup key={category}>
						{index > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuLabel>
							{copy(`category.${category}`, CATEGORY_LABELS[category])}
						</DropdownMenuLabel>
						{BLOCK_CATEGORIES[category].map((type) => (
							<DropdownMenuItem key={type} onClick={() => onAdd(type)}>
								{BLOCK_LABELS[type]}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function issueTone(
	issues: FlowIssue[] | undefined
): "error" | "warning" | null {
	if (!issues || issues.length === 0) {
		return null;
	}
	return issues.some((issue) => issue.severity === "error")
		? "error"
		: "warning";
}

function IssueDot({ issues }: { issues: FlowIssue[] | undefined }) {
	const tone = issueTone(issues);
	if (!tone) {
		return null;
	}
	return (
		<span
			className={cn(
				"inline-block size-2 shrink-0 rounded-full",
				tone === "error" ? "bg-destructive" : "bg-warning"
			)}
			title={issues?.map((issue) => issue.message).join("\n")}
		>
			<span className="sr-only">
				{tone === "error" ? "Has errors" : "Has warnings"}
			</span>
		</span>
	);
}

interface GroupNodeData extends Record<string, unknown> {
	group: Group;
}
type GroupNode = Node<GroupNodeData, "botGroup">;

function BotGroupNode({ data, selected }: NodeProps<GroupNode>) {
	const { copy, flow, issues, onAddBlock, onSelect, selection } = useEditor();
	const { group } = data;
	const isStart = group.id === flow.startGroupId;
	const groupIssues = issues.byGroup.get(group.id);
	const groupOnlyIssues = groupIssues?.filter((issue) => !issue.blockId);
	return (
		<div
			className={cn(
				"w-72 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
				(selected ||
					(selection?.kind === "group" && selection.id === group.id)) &&
					"ring-2 ring-primary"
			)}
			data-testid={`group-${group.id}`}
		>
			<div className="relative flex items-center gap-2 border-border border-b px-3 py-2">
				<Handle
					aria-label={copy("groupInput", "Connect to this group")}
					id={TARGET_HANDLE}
					position={Position.Left}
					type="target"
				/>
				<button
					className="nodrag flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-start"
					data-slot="group-title"
					onClick={() => onSelect({ kind: "group", id: group.id })}
					type="button"
				>
					<span className="truncate font-heading font-medium text-sm">
						{group.title || copy("untitledGroup", "Untitled group")}
					</span>
					<IssueDot issues={groupOnlyIssues} />
				</button>
				{isStart ? (
					<Badge variant="secondary">{copy("start", "Start")}</Badge>
				) : null}
			</div>
			<ol className="grid gap-1 p-2">
				{group.blocks.map((block) => {
					const handles = blockHandles(block);
					const plain = handles.length === 1 && handles[0]?.label === null;
					const selectedBlock =
						selection?.kind === "block" && selection.id === block.id;
					return (
						<li
							className={cn(
								"relative rounded-lg border border-transparent bg-muted/50",
								selectedBlock && "border-primary bg-primary/5"
							)}
							key={block.id}
						>
							<button
								aria-current={selectedBlock ? "true" : undefined}
								className="nodrag grid w-full gap-0.5 border-0 bg-transparent px-2.5 py-1.5 text-start"
								data-slot="block-row"
								data-testid={`block-${block.id}`}
								onClick={() => onSelect({ kind: "block", id: block.id })}
								type="button"
							>
								<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
									{BLOCK_LABELS[block.type]}
									<IssueDot issues={issues.byBlock.get(block.id)} />
								</span>
								<span className="line-clamp-2 break-words text-xs">
									{blockSummary(flow, block)}
								</span>
							</button>
							{plain && handles[0] ? (
								<Handle
									id={handleId(handles[0].source)}
									position={Position.Right}
									type="source"
								/>
							) : null}
							{plain ? null : (
								<ul className="grid gap-1 px-2.5 pb-1.5">
									{handles.map((handle) => (
										<li
											className="relative rounded-md border border-border bg-background px-2 py-1 text-xs"
											key={handleId(handle.source)}
										>
											<span className="block truncate pe-2">
												{handle.label}
											</span>
											<Handle
												id={handleId(handle.source)}
												position={Position.Right}
												style={{ right: -15 }}
												type="source"
											/>
										</li>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ol>
			<div className="px-2 pb-2">
				<AddBlockMenu
					copy={copy}
					label={copy("addBlockShort", "+ Add block")}
					onAdd={(type) => onAddBlock(group.id, type)}
					size="xs"
					variant="ghost"
				/>
			</div>
		</div>
	);
}

const GROUP_WIDTH = 288;
const NODE_TYPES: NodeTypes = { botGroup: BotGroupNode };
const PRO_OPTIONS = { hideAttribution: true };
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

function toNodes(flow: Flow, previous: GroupNode[]): GroupNode[] {
	const byId = new Map(previous.map((node) => [node.id, node]));
	return flow.groups.map((group) => {
		const existing = byId.get(group.id);
		const position =
			existing?.dragging === true ? existing.position : group.position;
		return {
			...existing,
			id: group.id,
			type: "botGroup",
			position,
			data: { group },
			dragHandle: undefined,
			// Groups are deleted only through the inspector's confirmation.
			deletable: false,
		};
	});
}

export interface FlowEditorProps {
	aiAvailable: boolean;
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	onChange: (flow: Flow) => void;
	onGenerate: () => void;
}

export function FlowEditor(props: FlowEditorProps) {
	return (
		<ReactFlowProvider>
			<FlowCanvas {...props} />
		</ReactFlowProvider>
	);
}

function FlowCanvas({
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
						ariaLabel: `Connection to ${flow.groups.find((group) => group.id === edge.to.groupId)?.title ?? "group"}`,
					},
				];
			}),
		[flow, issues, selection]
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

function GroupInspector({
	copy,
	flow,
	group,
	issues,
	onAddBlock,
	onChange,
	onDelete,
	onSelectBlock,
}: {
	copy: Copy;
	flow: Flow;
	group: Group;
	issues: FlowIssue[];
	onAddBlock: (type: BlockType) => void;
	onChange: (flow: Flow) => void;
	onDelete: () => void;
	onSelectBlock: (id: string) => void;
}) {
	const isStart = group.id === flow.startGroupId;
	return (
		<div className="grid gap-4" data-testid="group-inspector">
			<div className="grid gap-1.5">
				<Label htmlFor="group-title">{copy("groupTitle", "Group name")}</Label>
				<Input
					id="group-title"
					maxLength={120}
					onChange={(event) =>
						onChange(renameGroup(flow, group.id, event.target.value))
					}
					value={group.title}
				/>
			</div>
			{issues.length > 0 ? (
				<ul className="grid gap-1">
					{issues.map((issue) => (
						<li
							className={
								issue.severity === "error"
									? "text-status-destructive text-xs"
									: "text-status-warning text-xs"
							}
							key={`${issue.blockId ?? ""}:${issue.message}`}
						>
							{issue.message}
						</li>
					))}
				</ul>
			) : null}
			<div className="grid gap-1">
				<p className="font-medium text-sm">{copy("blocks", "Blocks")}</p>
				{group.blocks.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						{copy("emptyGroup", "This group has no blocks yet.")}
					</p>
				) : (
					<ol className="grid gap-1">
						{group.blocks.map((block) => (
							<li key={block.id}>
								<Button
									className="h-auto w-full justify-start py-1.5 text-start"
									onClick={() => onSelectBlock(block.id)}
									size="sm"
									variant="ghost"
								>
									<span className="text-muted-foreground">
										{BLOCK_LABELS[block.type]}
									</span>
									<span className="truncate">{blockSummary(flow, block)}</span>
								</Button>
							</li>
						))}
					</ol>
				)}
				<AddBlockMenu
					copy={copy}
					label={copy("addBlock", "Add block")}
					onAdd={onAddBlock}
				/>
			</div>
			<div className="flex flex-wrap gap-2 border-border border-t pt-4">
				<Button
					disabled={isStart}
					onClick={() => onChange(setStartGroup(flow, group.id))}
					size="sm"
					variant="outline"
				>
					{isStart
						? copy("isStart", "Start group")
						: copy("makeStart", "Make start group")}
				</Button>
				<Button
					disabled={isStart}
					onClick={onDelete}
					size="sm"
					variant="destructive"
				>
					{copy("deleteGroup", "Delete group")}
				</Button>
			</div>
			{isStart ? (
				<p className="text-muted-foreground text-xs">
					{copy(
						"startHint",
						"Conversations begin here. Make another group the start before deleting this one."
					)}
				</p>
			) : null}
		</div>
	);
}

function IssuesPanel({
	copy,
	flow,
	issues,
	open,
	onFocus,
	onToggle,
}: {
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	open: boolean;
	onFocus: (issue: FlowIssue) => void;
	onToggle: () => void;
}) {
	const describe = (issue: FlowIssue): ReactNode => {
		if (issue.blockId) {
			const located = findBlock(flow, issue.blockId);
			if (located) {
				return `${located.group.title || copy("untitledGroup", "Untitled group")} · ${BLOCK_LABELS[located.block.type]}`;
			}
		}
		if (issue.groupId) {
			return (
				flow.groups.find((group) => group.id === issue.groupId)?.title ?? ""
			);
		}
		return copy("bot", "Bot");
	};
	if (issues.all.length === 0) {
		return (
			<p
				className="rounded-lg border border-border bg-card/95 px-3 py-1.5 text-status-success text-xs shadow-sm"
				data-testid="validation-summary"
				role="status"
			>
				{copy("noIssues", "No problems found")}
			</p>
		);
	}
	return (
		<div className="grid max-w-[min(22rem,calc(100vw-2rem))] justify-items-end gap-2">
			{open ? (
				<ul
					aria-label={copy("problems", "Problems")}
					className="grid max-h-64 w-full gap-1 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-sm"
				>
					{issues.all.map((issue, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: issues may repeat a message
						<li key={index}>
							<button
								className="grid w-full gap-0.5 rounded-md border-0 bg-transparent px-2 py-1 text-start text-xs hover:bg-muted"
								data-slot="issue-row"
								onClick={() => onFocus(issue)}
								type="button"
							>
								<span className="text-muted-foreground">{describe(issue)}</span>
								<span
									className={
										issue.severity === "error"
											? "text-status-destructive"
											: "text-status-warning"
									}
								>
									{issue.message}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
			<Button
				aria-expanded={open}
				data-testid="validation-summary"
				onClick={onToggle}
				size="sm"
				variant="outline"
			>
				{issues.errors > 0 ? (
					<span className="text-status-destructive">
						{issues.errors}{" "}
						{issues.errors === 1
							? copy("error", "error")
							: copy("errors", "errors")}
					</span>
				) : null}
				{issues.warnings > 0 ? (
					<span className="text-status-warning">
						{issues.warnings}{" "}
						{issues.warnings === 1
							? copy("warning", "warning")
							: copy("warnings", "warnings")}
					</span>
				) : null}
			</Button>
		</div>
	);
}
