import { Badge } from "@ryu/blocks/companion/controls";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
} from "@xyflow/react";
import type { Flow, FlowIssue, Group } from "../../sidecar/src/contracts.ts";
import { AddBlockMenu } from "./FlowEditor-add-block-menu.tsx";
import { TARGET_HANDLE, useEditor } from "./FlowEditor-context.tsx";
import {
	BLOCK_LABELS,
	blockHandles,
	blockSummary,
	handleId,
} from "./flow-model.ts";

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
export interface GroupNodeData extends Record<string, unknown> {
	group: Group;
}
export type GroupNode = Node<GroupNodeData, "botGroup">;

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

export const GROUP_WIDTH = 288;
export const NODE_TYPES: NodeTypes = { botGroup: BotGroupNode };
export const PRO_OPTIONS = { hideAttribution: true };
export const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

export function toNodes(flow: Flow, previous: GroupNode[]): GroupNode[] {
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
