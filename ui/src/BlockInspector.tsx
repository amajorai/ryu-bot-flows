import { Badge, Button } from "@ryu/blocks/companion/controls";
import {
	type Block,
	type BlockOf,
	BOT_LIMITS,
	type Flow,
	type FlowIssue,
	isInputBlock,
} from "../../sidecar/src/contracts.ts";
import { ConnectionFields } from "./BlockInspector-connections.tsx";
import {
	ChoiceFields,
	DateInputFields,
	InputCommonFields,
	NumberInputFields,
	RatingFields,
	TextInputFields,
} from "./BlockInspector-input-fields.tsx";
import {
	AiReplyFields,
	HandoffFields,
	HttpRequestFields,
} from "./BlockInspector-integration-fields.tsx";
import {
	ConditionFields,
	JumpFields,
	RedirectFields,
	SetVariableFields,
} from "./BlockInspector-logic-fields.tsx";
import {
	clamp,
	type FieldProps,
	TemplateHint,
} from "./BlockInspector-shared.tsx";
import type { Copy } from "./copy.ts";
import {
	NumberField,
	SelectField,
	TextAreaField,
	TextField,
} from "./fields.tsx";
import {
	addVariable,
	BLOCK_LABELS,
	findBlock,
	moveBlock,
	moveBlockToGroup,
	updateBlock,
} from "./flow-model.ts";

interface InspectorProps {
	block: Block;
	copy: Copy;
	flow: Flow;
	issues: FlowIssue[];
	onDelete: () => void;
	onFlowChange: (flow: Flow) => void;
}

/** Edits one block. Every change is applied as a whole-flow update. */
export function BlockInspector({
	block,
	copy,
	flow,
	issues,
	onDelete,
	onFlowChange,
}: InspectorProps) {
	const located = findBlock(flow, block.id);
	const set = (next: Block) => onFlowChange(updateBlock(flow, next));
	/** Creates a variable and stores its id on the block through `apply`. */
	const createVariable = (
		hint: string,
		apply: (variableId: string) => Block
	) => {
		const created = addVariable(flow, hint);
		if (created.variableId) {
			onFlowChange(updateBlock(created.flow, apply(created.variableId)));
		}
	};
	const position = located ? located.index : -1;
	const groupSize = located?.group.blocks.length ?? 0;
	return (
		<div className="grid gap-4" data-testid="block-inspector">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Badge variant="outline">{BLOCK_LABELS[block.type]}</Badge>
					<span className="text-muted-foreground text-xs">
						{copy("inGroup", "in")}{" "}
						{located?.group.title || copy("untitledGroup", "Untitled group")}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<Button
						aria-label={copy("moveUp", "Move block up")}
						disabled={position <= 0}
						onClick={() => onFlowChange(moveBlock(flow, block.id, -1))}
						size="icon-sm"
						variant="ghost"
					>
						↑
					</Button>
					<Button
						aria-label={copy("moveDown", "Move block down")}
						disabled={position < 0 || position >= groupSize - 1}
						onClick={() => onFlowChange(moveBlock(flow, block.id, 1))}
						size="icon-sm"
						variant="ghost"
					>
						↓
					</Button>
					<Button onClick={onDelete} size="sm" variant="ghost">
						{copy("deleteBlock", "Delete")}
					</Button>
				</div>
			</div>
			{issues.length > 0 ? (
				<ul
					aria-label={copy("blockIssues", "Problems with this block")}
					className="grid gap-1"
				>
					{issues.map((issue) => (
						<li
							className={
								issue.severity === "error"
									? "text-status-destructive text-xs"
									: "text-status-warning text-xs"
							}
							key={`${issue.severity}:${issue.message}:${issue.edgeId ?? ""}`}
						>
							{issue.severity === "error" ? "● " : "○ "}
							{issue.message}
						</li>
					))}
				</ul>
			) : null}
			<BlockFields
				block={block}
				copy={copy}
				createVariable={createVariable}
				flow={flow}
				set={set}
			/>
			{isInputBlock(block) ? (
				<InputCommonFields
					block={block}
					copy={copy}
					createVariable={createVariable}
					flow={flow}
					set={set}
				/>
			) : null}
			<ConnectionFields
				block={block}
				copy={copy}
				flow={flow}
				onFlowChange={onFlowChange}
			/>
			{flow.groups.length > 1 && located ? (
				<SelectField
					hint={copy(
						"moveToGroupHint",
						"Moves the block to the end of that group."
					)}
					label={copy("moveToGroup", "Group")}
					onChange={(groupId) =>
						onFlowChange(moveBlockToGroup(flow, block.id, groupId))
					}
					options={flow.groups.map((group) => ({
						value: group.id,
						label: group.title || copy("untitledGroup", "Untitled group"),
					}))}
					value={located.group.id}
				/>
			) : null}
		</div>
	);
}
function BlockFields(props: FieldProps) {
	const { block } = props;
	switch (block.type) {
		case "text":
			return <TextBubbleFields {...props} block={block} />;
		case "image":
		case "video":
		case "embed":
			return <MediaFields {...props} block={block} />;
		case "text_input":
			return <TextInputFields {...props} block={block} />;
		case "number_input":
			return <NumberInputFields {...props} block={block} />;
		case "date_input":
			return <DateInputFields {...props} block={block} />;
		case "rating_input":
			return <RatingFields {...props} block={block} />;
		case "choice_input":
			return <ChoiceFields {...props} block={block} />;
		case "set_variable":
			return <SetVariableFields {...props} block={block} />;
		case "condition":
			return <ConditionFields {...props} block={block} />;
		case "redirect":
			return <RedirectFields {...props} block={block} />;
		case "jump":
			return <JumpFields {...props} block={block} />;
		case "wait":
			return (
				<NumberField
					hint={props.copy(
						"waitHint",
						"The visitor's chat pauses before the next message (0–30 seconds)."
					)}
					label={props.copy("waitSeconds", "Seconds")}
					max={BOT_LIMITS.waitSeconds}
					min={0}
					onChange={(value) =>
						props.set({
							...block,
							seconds: clamp(value ?? 0, 0, BOT_LIMITS.waitSeconds),
						})
					}
					value={block.seconds}
				/>
			);
		case "ab_test":
			return (
				<NumberField
					hint={props.copy(
						"abHint",
						"Visitors are split at random between the A and B branches."
					)}
					label={props.copy("percentA", "Share sent to A (%)")}
					max={100}
					min={0}
					onChange={(value) =>
						props.set({
							...block,
							percentA: Math.round(clamp(value ?? 50, 0, 100)),
						})
					}
					value={block.percentA}
				/>
			);
		case "ai_reply":
			return <AiReplyFields {...props} block={block} />;
		case "http_request":
			return <HttpRequestFields {...props} block={block} />;
		case "handoff":
			return <HandoffFields {...props} block={block} />;
		default:
			return null;
	}
}
function TextBubbleFields({ block, copy, set }: FieldProps<BlockOf<"text">>) {
	return (
		<TextAreaField
			hint={
				<>
					<TemplateHint copy={copy} />{" "}
					{copy(
						"markdownHint",
						"**bold**, *italic* and [links](https://…) are supported."
					)}
				</>
			}
			label={copy("message", "Message")}
			maxLength={BOT_LIMITS.textLength}
			onChange={(content) => set({ ...block, content })}
			rows={4}
			value={block.content}
		/>
	);
}

function MediaFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"image"> | BlockOf<"video"> | BlockOf<"embed">>) {
	return (
		<>
			<TextField
				hint={
					block.type === "video"
						? copy(
								"videoHint",
								"YouTube and Vimeo links are embedded; other https links play as a video file."
							)
						: copy("httpsHint", "Must be an https:// URL.")
				}
				label={copy("url", "URL")}
				maxLength={BOT_LIMITS.urlLength}
				onChange={(url) => set({ ...block, url })}
				type="url"
				value={block.url}
			/>
			{block.type === "image" ? (
				<TextField
					label={copy("altText", "Alt text")}
					maxLength={300}
					onChange={(alt) => set({ ...block, alt })}
					value={block.alt}
				/>
			) : null}
			{block.type === "embed" ? (
				<NumberField
					label={copy("height", "Height (px)")}
					max={1200}
					min={120}
					onChange={(value) =>
						set({
							...block,
							height: Math.round(clamp(value ?? 400, 120, 1200)),
						})
					}
					value={block.height}
				/>
			) : null}
		</>
	);
}
