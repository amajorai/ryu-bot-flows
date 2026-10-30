import { Button, Input, Label } from "@ryu/blocks/companion/controls";
import type {
	BlockType,
	Flow,
	FlowIssue,
	Group,
} from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import { AddBlockMenu } from "./FlowEditor-add-block-menu.tsx";
import {
	BLOCK_LABELS,
	blockSummary,
	renameGroup,
	setStartGroup,
} from "./flow-model.ts";

export function GroupInspector({
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
