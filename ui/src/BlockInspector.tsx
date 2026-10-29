import { Badge, Button, Input, Label } from "@ryu/blocks/companion/controls";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import type { ReactNode } from "react";
import {
	type Block,
	type BlockOf,
	BOT_LIMITS,
	CONDITION_OPERATORS,
	type Flow,
	type FlowIssue,
	HTTP_METHODS,
	type InputBlock,
	isInputBlock,
	RATING_SCALES,
	SET_VARIABLE_OPS,
} from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import {
	NumberField,
	SelectField,
	SwitchField,
	TextAreaField,
	TextField,
	VariableSelect,
} from "./fields.tsx";
import {
	addVariable,
	BLOCK_LABELS,
	blockHandles,
	connect,
	type EdgeSource,
	edgeFrom,
	findBlock,
	handleId,
	moveBlock,
	moveBlockToGroup,
	randomId,
	removeEdge,
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

interface FieldProps<T extends Block = Block> {
	block: T;
	copy: Copy;
	createVariable: (hint: string, apply: (variableId: string) => Block) => void;
	flow: Flow;
	set: (block: Block) => void;
}

function TemplateHint({ copy }: { copy: Copy }) {
	return (
		<>{copy("templateHint", "Use {{variable}} to insert a saved answer.")}</>
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function optional(value: string): string | undefined {
	return value === "" ? undefined : value;
}

/** Copies `block` with `key` set, or removed when `value` is undefined. */
function withOptional<T extends Block, K extends keyof T>(
	block: T,
	key: K,
	value: T[K] | undefined
): T {
	const next = { ...block };
	if (value === undefined) {
		delete next[key];
	} else {
		next[key] = value;
	}
	return next;
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

function InputCommonFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<InputBlock>) {
	return (
		<div className="grid gap-4 border-border border-t pt-4">
			<VariableSelect
				allowNone
				flow={flow}
				hint={copy(
					"saveToHint",
					"The answer is always kept in results; saving it lets later blocks use it."
				)}
				label={copy("saveTo", "Save answer to")}
				onChange={(saveTo) => set(withOptional(block, "saveTo", saveTo))}
				onCreate={() =>
					createVariable(BLOCK_LABELS[block.type].toLowerCase(), (saveTo) => ({
						...block,
						saveTo,
					}))
				}
				value={block.saveTo}
			/>
			{block.type === "choice_input" || block.type === "rating_input" ? null : (
				<TextField
					label={copy("placeholder", "Placeholder")}
					maxLength={200}
					onChange={(value) =>
						set(withOptional(block, "placeholder", optional(value)))
					}
					value={block.placeholder ?? ""}
				/>
			)}
			<TextField
				label={copy("buttonLabel", "Button label")}
				maxLength={60}
				onChange={(value) =>
					set(withOptional(block, "buttonLabel", optional(value)))
				}
				placeholder={copy("sendDefault", "Send")}
				value={block.buttonLabel ?? ""}
			/>
			<TextField
				hint={copy(
					"retryHint",
					"Shown when the answer is invalid. Defaults to the bot's invalid-reply message."
				)}
				label={copy("retryMessage", "Retry message")}
				maxLength={500}
				onChange={(value) =>
					set(withOptional(block, "retryMessage", optional(value)))
				}
				value={block.retryMessage ?? ""}
			/>
		</div>
	);
}

function TextInputFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"text_input">>) {
	return (
		<>
			<SwitchField
				checked={block.long === true}
				label={copy("longAnswer", "Long answer")}
				onChange={(long) =>
					set(withOptional(block, "long", long ? true : undefined))
				}
			/>
			<div className="grid grid-cols-2 gap-3">
				<NumberField
					label={copy("minLength", "Min length")}
					min={0}
					onChange={(value) =>
						set(
							withOptional(
								block,
								"minLength",
								value === undefined
									? undefined
									: Math.round(clamp(value, 0, BOT_LIMITS.answerLength))
							)
						)
					}
					value={block.minLength}
				/>
				<NumberField
					label={copy("maxLength", "Max length")}
					min={1}
					onChange={(value) =>
						set(
							withOptional(
								block,
								"maxLength",
								value === undefined
									? undefined
									: Math.round(clamp(value, 1, BOT_LIMITS.answerLength))
							)
						)
					}
					value={block.maxLength}
				/>
			</div>
		</>
	);
}

function NumberInputFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"number_input">>) {
	return (
		<div className="grid grid-cols-3 gap-3">
			<NumberField
				label={copy("min", "Min")}
				onChange={(value) => set(withOptional(block, "min", value))}
				value={block.min}
			/>
			<NumberField
				label={copy("max", "Max")}
				onChange={(value) => set(withOptional(block, "max", value))}
				value={block.max}
			/>
			<NumberField
				label={copy("step", "Step")}
				min={0}
				onChange={(value) =>
					set(
						withOptional(
							block,
							"step",
							value !== undefined && value > 0 ? value : undefined
						)
					)
				}
				value={block.step}
			/>
		</div>
	);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function DateInputFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"date_input">>) {
	return (
		<>
			<SwitchField
				checked={block.withTime === true}
				label={copy("withTime", "Ask for a time too")}
				onChange={(withTime) =>
					set(withOptional(block, "withTime", withTime ? true : undefined))
				}
			/>
			<div className="grid grid-cols-2 gap-3">
				<TextField
					hint="YYYY-MM-DD"
					label={copy("earliest", "Earliest date")}
					maxLength={10}
					onChange={(value) =>
						set(
							withOptional(block, "min", DATE.test(value) ? value : undefined)
						)
					}
					value={block.min ?? ""}
				/>
				<TextField
					hint="YYYY-MM-DD"
					label={copy("latest", "Latest date")}
					maxLength={10}
					onChange={(value) =>
						set(
							withOptional(block, "max", DATE.test(value) ? value : undefined)
						)
					}
					value={block.max ?? ""}
				/>
			</div>
		</>
	);
}

function RatingFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"rating_input">>) {
	return (
		<>
			<SelectField
				label={copy("scale", "Scale")}
				onChange={(scale) => {
					const parsed = RATING_SCALES.find((candidate) => candidate === scale);
					if (parsed) {
						set({ ...block, scale: parsed });
					}
				}}
				options={[
					{ value: "stars", label: copy("stars", "Stars") },
					{ value: "numbers", label: copy("numbers", "Numbers") },
					{ value: "nps", label: copy("nps", "NPS (0–10)") },
				]}
				value={block.scale}
			/>
			{block.scale === "nps" ? null : (
				<NumberField
					label={copy("length", "Number of options")}
					max={10}
					min={3}
					onChange={(value) =>
						set({ ...block, length: Math.round(clamp(value ?? 5, 3, 10)) })
					}
					value={block.length}
				/>
			)}
			<div className="grid grid-cols-2 gap-3">
				<TextField
					label={copy("leftLabel", "Low label")}
					maxLength={60}
					onChange={(value) =>
						set(withOptional(block, "leftLabel", optional(value)))
					}
					value={block.leftLabel ?? ""}
				/>
				<TextField
					label={copy("rightLabel", "High label")}
					maxLength={60}
					onChange={(value) =>
						set(withOptional(block, "rightLabel", optional(value)))
					}
					value={block.rightLabel ?? ""}
				/>
			</div>
		</>
	);
}

function ChoiceFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"choice_input">>) {
	const updateItem = (
		index: number,
		patch: { label?: string; value?: string }
	) =>
		set({
			...block,
			items: block.items.map((item, itemIndex) => {
				if (itemIndex !== index) {
					return item;
				}
				const { value, ...rest } = { ...item, ...patch };
				return value ? { ...rest, value } : rest;
			}),
		});
	return (
		<>
			<SwitchField
				checked={block.multiple === true}
				description={copy(
					"multipleHint",
					"Multiple choice uses one connection for every answer."
				)}
				label={copy("multiple", "Allow several answers")}
				onChange={(multiple) =>
					set(withOptional(block, "multiple", multiple ? true : undefined))
				}
			/>
			<fieldset className="grid gap-2">
				<legend className="mb-1 font-medium text-sm">
					{copy("buttons", "Buttons")}
				</legend>
				{block.items.map((item, index) => (
					<div className="flex items-center gap-2" key={item.id}>
						<Input
							aria-label={`${copy("buttonText", "Button text")} ${index + 1}`}
							maxLength={120}
							onChange={(event) =>
								updateItem(index, { label: event.target.value })
							}
							value={item.label}
						/>
						<Input
							aria-label={`${copy("savedValue", "Saved value")} ${index + 1}`}
							className="max-w-28"
							maxLength={500}
							onChange={(event) =>
								updateItem(index, { value: event.target.value })
							}
							placeholder={copy("valueOptional", "Value")}
							value={item.value ?? ""}
						/>
						<Button
							aria-label={`${copy("removeButton", "Remove button")} ${index + 1}`}
							disabled={block.items.length <= 1}
							onClick={() =>
								set({
									...block,
									items: block.items.filter(
										(_, itemIndex) => itemIndex !== index
									),
								})
							}
							size="icon-sm"
							variant="ghost"
						>
							×
						</Button>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={block.items.length >= BOT_LIMITS.choiceItems}
					onClick={() =>
						set({
							...block,
							items: [
								...block.items,
								{
									id: randomId("i"),
									label: `Option ${block.items.length + 1}`,
								},
							],
						})
					}
					size="sm"
					variant="outline"
				>
					{copy("addButton", "Add button")}
				</Button>
			</fieldset>
		</>
	);
}

function SetVariableFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"set_variable">>) {
	const needsValue =
		block.op === "set" || block.op === "append" || block.op === "increment";
	return (
		<>
			<VariableSelect
				flow={flow}
				label={copy("variable", "Variable")}
				onChange={(variableId) => variableId && set({ ...block, variableId })}
				onCreate={() =>
					createVariable("value", (variableId) => ({ ...block, variableId }))
				}
				value={block.variableId}
			/>
			<SelectField
				label={copy("operation", "Operation")}
				onChange={(op) => {
					const parsed = SET_VARIABLE_OPS.find((candidate) => candidate === op);
					if (parsed) {
						set({ ...block, op: parsed });
					}
				}}
				options={SET_VARIABLE_OPS.map((op) => ({
					value: op,
					label: OP_LABELS[op],
				}))}
				value={block.op}
			/>
			{needsValue ? (
				<TextField
					hint={
						block.op === "increment" ? (
							copy(
								"incrementHint",
								"A number to add (use a negative number to subtract)."
							)
						) : (
							<TemplateHint copy={copy} />
						)
					}
					label={copy("value", "Value")}
					maxLength={2000}
					onChange={(value) => set(withOptional(block, "value", value))}
					value={block.value ?? ""}
				/>
			) : null}
		</>
	);
}

const OP_LABELS: Record<(typeof SET_VARIABLE_OPS)[number], string> = {
	set: "Set to",
	append: "Append",
	increment: "Increment by",
	clear: "Clear",
	now: "Current date and time",
	random_id: "Random id",
	result_id: "Result id",
	transcript: "Conversation transcript",
};

const OPERATOR_LABELS: Record<(typeof CONDITION_OPERATORS)[number], string> = {
	equals: "equals",
	not_equals: "does not equal",
	contains: "contains",
	not_contains: "does not contain",
	greater_than: "is greater than",
	less_than: "is less than",
	is_set: "is set",
	is_empty: "is empty",
	starts_with: "starts with",
	ends_with: "ends with",
};

function ConditionFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"condition">>) {
	const updateRule = (
		index: number,
		patch: Partial<BlockOf<"condition">["rules"][number]>
	) =>
		set({
			...block,
			rules: block.rules.map((rule, ruleIndex) =>
				ruleIndex === index ? { ...rule, ...patch } : rule
			),
		});
	return (
		<>
			<SelectField
				label={copy("match", "Match")}
				onChange={(value) =>
					set({ ...block, combinator: value === "or" ? "or" : "and" })
				}
				options={[
					{ value: "and", label: copy("matchAll", "All rules (and)") },
					{ value: "or", label: copy("matchAny", "Any rule (or)") },
				]}
				value={block.combinator}
			/>
			{block.rules.map((rule, index) => (
				<fieldset
					className="grid gap-3 rounded-lg border border-border p-3"
					// Rules have no ids; their order is their identity while editing.
					// biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
					key={index}
				>
					<legend className="px-1 text-muted-foreground text-xs">
						{copy("rule", "Rule")} {index + 1}
					</legend>
					<VariableSelect
						flow={flow}
						label={copy("variable", "Variable")}
						onChange={(variableId) =>
							variableId && updateRule(index, { variableId })
						}
						onCreate={() =>
							createVariable("answer", (variableId) => ({
								...block,
								rules: block.rules.map((item, ruleIndex) =>
									ruleIndex === index ? { ...item, variableId } : item
								),
							}))
						}
						value={rule.variableId}
					/>
					<SelectField
						label={copy("operator", "Operator")}
						onChange={(value) => {
							const operator = CONDITION_OPERATORS.find(
								(candidate) => candidate === value
							);
							if (operator) {
								updateRule(index, { operator });
							}
						}}
						options={CONDITION_OPERATORS.map((operator) => ({
							value: operator,
							label: OPERATOR_LABELS[operator],
						}))}
						value={rule.operator}
					/>
					{rule.operator === "is_set" || rule.operator === "is_empty" ? null : (
						<TextField
							label={copy("compareTo", "Compare to")}
							maxLength={500}
							onChange={(value) => updateRule(index, { value })}
							value={rule.value ?? ""}
						/>
					)}
					{block.rules.length > 1 ? (
						<Button
							className="w-fit"
							onClick={() =>
								set({
									...block,
									rules: block.rules.filter(
										(_, ruleIndex) => ruleIndex !== index
									),
								})
							}
							size="sm"
							variant="ghost"
						>
							{copy("removeRule", "Remove rule")}
						</Button>
					) : null}
				</fieldset>
			))}
			<Button
				className="w-fit"
				disabled={
					block.rules.length >= BOT_LIMITS.conditionRules ||
					flow.variables.length === 0
				}
				onClick={() => {
					const first = flow.variables[0];
					if (first) {
						set({
							...block,
							rules: [
								...block.rules,
								{ variableId: first.id, operator: "equals", value: "" },
							],
						});
					}
				}}
				size="sm"
				variant="outline"
			>
				{copy("addRule", "Add rule")}
			</Button>
		</>
	);
}

function RedirectFields({ block, copy, set }: FieldProps<BlockOf<"redirect">>) {
	return (
		<>
			<TextField
				hint={<TemplateHint copy={copy} />}
				label={copy("url", "URL")}
				maxLength={BOT_LIMITS.urlLength}
				onChange={(url) => set({ ...block, url })}
				type="url"
				value={block.url}
			/>
			<SwitchField
				checked={block.newTab}
				description={copy(
					"newTabHint",
					"A new tab shows an Open link button and the chat continues. The same tab ends the conversation."
				)}
				label={copy("newTab", "Open in a new tab")}
				onChange={(newTab) => set({ ...block, newTab })}
			/>
		</>
	);
}

function JumpFields({ block, copy, flow, set }: FieldProps<BlockOf<"jump">>) {
	const known = flow.groups.some((group) => group.id === block.groupId);
	return (
		<SelectField
			label={copy("jumpTo", "Jump to group")}
			onChange={(groupId) => set({ ...block, groupId })}
			options={[
				...(known
					? []
					: [
							{
								value: block.groupId,
								label: copy("missingGroup", "Missing group"),
							},
						]),
				...flow.groups.map((group) => ({
					value: group.id,
					label: group.title || copy("untitledGroup", "Untitled group"),
				})),
			]}
			value={block.groupId}
		/>
	);
}

function AiReplyFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"ai_reply">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"aiBilling",
					"Replies use this Ryu node's model access, so the node owner pays for them. Visitors can't change the model or these instructions."
				)}
			</p>
			<TextAreaField
				label={copy("instructions", "Instructions (system prompt)")}
				maxLength={4000}
				onChange={(instructions) => set({ ...block, instructions })}
				rows={4}
				value={block.instructions}
			/>
			<TextAreaField
				hint={<TemplateHint copy={copy} />}
				label={copy("promptTemplate", "Prompt")}
				maxLength={BOT_LIMITS.aiPromptChars}
				onChange={(promptTemplate) => set({ ...block, promptTemplate })}
				rows={3}
				value={block.promptTemplate}
			/>
			<SwitchField
				checked={block.useKnowledge}
				description={copy(
					"useKnowledgeHint",
					"Adds the most relevant Knowledge articles to the prompt."
				)}
				label={copy("useKnowledge", "Use knowledge articles")}
				onChange={(useKnowledge) => set({ ...block, useKnowledge })}
			/>
			<NumberField
				label={copy("maxChars", "Maximum reply length (characters)")}
				max={BOT_LIMITS.aiMaxChars}
				min={50}
				onChange={(value) =>
					set({
						...block,
						maxChars: Math.round(
							clamp(value ?? 800, 50, BOT_LIMITS.aiMaxChars)
						),
					})
				}
				value={block.maxChars}
			/>
			<VariableSelect
				allowNone
				flow={flow}
				label={copy("saveReplyTo", "Save reply to")}
				onChange={(saveTo) => set(withOptional(block, "saveTo", saveTo))}
				onCreate={() =>
					createVariable("ai_reply", (saveTo) => ({ ...block, saveTo }))
				}
				value={block.saveTo}
			/>
			<TextField
				hint={copy(
					"fallbackHint",
					"Shown when the model fails or the AI budget is used up."
				)}
				label={copy("fallbackMessage", "Fallback message")}
				maxLength={500}
				onChange={(value) =>
					set(withOptional(block, "fallbackMessage", optional(value)))
				}
				value={block.fallbackMessage ?? ""}
			/>
		</>
	);
}

function HttpRequestFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"http_request">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"httpSafety",
					"Requests run on this Ryu node over https only. Private and local network addresses are refused, redirects are not followed, and failures are logged without stopping the conversation."
				)}
			</p>
			<SelectField
				label={copy("method", "Method")}
				onChange={(value) => {
					const method = HTTP_METHODS.find((candidate) => candidate === value);
					if (method) {
						set({ ...block, method });
					}
				}}
				options={HTTP_METHODS.map((method) => ({
					value: method,
					label: method,
				}))}
				value={block.method}
			/>
			<TextField
				hint={<TemplateHint copy={copy} />}
				label={copy("url", "URL")}
				maxLength={BOT_LIMITS.urlLength}
				onChange={(url) => set({ ...block, url })}
				type="url"
				value={block.url}
			/>
			<fieldset className="grid gap-2">
				<legend className="mb-1 font-medium text-sm">
					{copy("headers", "Headers")}
				</legend>
				{block.headers.map((header, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: headers are positional
					<div className="flex items-center gap-2" key={index}>
						<Input
							aria-label={`${copy("headerName", "Header name")} ${index + 1}`}
							maxLength={100}
							onChange={(event) =>
								set({
									...block,
									headers: block.headers.map((item, itemIndex) =>
										itemIndex === index
											? { ...item, name: event.target.value }
											: item
									),
								})
							}
							value={header.name}
						/>
						<Input
							aria-label={`${copy("headerValue", "Header value")} ${index + 1}`}
							maxLength={2000}
							onChange={(event) =>
								set({
									...block,
									headers: block.headers.map((item, itemIndex) =>
										itemIndex === index
											? { ...item, value: event.target.value }
											: item
									),
								})
							}
							value={header.value}
						/>
						<Button
							aria-label={`${copy("removeHeader", "Remove header")} ${index + 1}`}
							onClick={() =>
								set({
									...block,
									headers: block.headers.filter(
										(_, itemIndex) => itemIndex !== index
									),
								})
							}
							size="icon-sm"
							variant="ghost"
						>
							×
						</Button>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={block.headers.length >= BOT_LIMITS.httpHeaders}
					onClick={() =>
						set({
							...block,
							headers: [...block.headers, { name: "X-Header", value: "" }],
						})
					}
					size="sm"
					variant="outline"
				>
					{copy("addHeader", "Add header")}
				</Button>
			</fieldset>
			{block.method === "GET" ? null : (
				<TextAreaField
					hint={copy(
						"bodyHint",
						"Variables inserted into the body are JSON-escaped."
					)}
					label={copy("body", "Body")}
					maxLength={20_000}
					onChange={(body) => set({ ...block, body })}
					rows={4}
					value={block.body}
				/>
			)}
			<fieldset className="grid gap-2">
				<legend className="mb-1 font-medium text-sm">
					{copy("responseMapping", "Save from the response")}
				</legend>
				{block.responseMapping.map((mapping, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: mappings are positional
					<div className="flex items-center gap-2" key={index}>
						<Input
							aria-label={`${copy("responsePath", "Response path")} ${index + 1}`}
							maxLength={200}
							onChange={(event) =>
								set({
									...block,
									responseMapping: block.responseMapping.map(
										(item, itemIndex) =>
											itemIndex === index
												? { ...item, path: event.target.value }
												: item
									),
								})
							}
							placeholder="data.items[0].id"
							value={mapping.path}
						/>
						<NativeSelect
							aria-label={`${copy("responseVariable", "Variable")} ${index + 1}`}
							className="w-40"
							onChange={(event) =>
								set({
									...block,
									responseMapping: block.responseMapping.map(
										(item, itemIndex) =>
											itemIndex === index
												? { ...item, variableId: event.target.value }
												: item
									),
								})
							}
							value={mapping.variableId}
						>
							{flow.variables.map((variable) => (
								<NativeSelectOption key={variable.id} value={variable.id}>
									{variable.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<Button
							aria-label={`${copy("removeMapping", "Remove mapping")} ${index + 1}`}
							onClick={() =>
								set({
									...block,
									responseMapping: block.responseMapping.filter(
										(_, itemIndex) => itemIndex !== index
									),
								})
							}
							size="icon-sm"
							variant="ghost"
						>
							×
						</Button>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={block.responseMapping.length >= BOT_LIMITS.responseMappings}
					onClick={() => {
						const first = flow.variables[0];
						if (first) {
							set({
								...block,
								responseMapping: [
									...block.responseMapping,
									{ path: "id", variableId: first.id },
								],
							});
						} else {
							createVariable("response", (variableId) => ({
								...block,
								responseMapping: [
									...block.responseMapping,
									{ path: "id", variableId },
								],
							}));
						}
					}}
					size="sm"
					variant="outline"
				>
					{copy("addMapping", "Add mapping")}
				</Button>
			</fieldset>
			<NumberField
				label={copy("timeout", "Timeout (ms)")}
				max={BOT_LIMITS.httpTimeoutMs}
				min={500}
				onChange={(value) =>
					set({
						...block,
						timeoutMs: Math.round(
							clamp(value ?? 5000, 500, BOT_LIMITS.httpTimeoutMs)
						),
					})
				}
				step={500}
				value={block.timeoutMs}
			/>
		</>
	);
}

function HandoffFields({ block, copy, set }: FieldProps<BlockOf<"handoff">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"handoffHint",
					"Published bots emit a handoff.requested event. Build a Workflow with an event trigger to open a ticket, notify a channel, or add a CRM contact."
				)}
			</p>
			<TextField
				hint={<TemplateHint copy={copy} />}
				label={copy("topic", "Topic")}
				maxLength={80}
				onChange={(topic) => set({ ...block, topic })}
				value={block.topic}
			/>
			<TextAreaField
				hint={<TemplateHint copy={copy} />}
				label={copy("summary", "Summary")}
				maxLength={2000}
				onChange={(summaryTemplate) => set({ ...block, summaryTemplate })}
				rows={3}
				value={block.summaryTemplate}
			/>
			<TextAreaField
				label={copy("visitorMessage", "Message to the visitor")}
				maxLength={2000}
				onChange={(message) => set({ ...block, message })}
				rows={2}
				value={block.message}
			/>
		</>
	);
}

const CONTINUE = "";

/** Keyboard-reachable alternative to dragging: pick each handle's target group. */
function ConnectionFields({
	block,
	copy,
	flow,
	onFlowChange,
}: {
	block: Block;
	copy: Copy;
	flow: Flow;
	onFlowChange: (flow: Flow) => void;
}) {
	const handles = blockHandles(block);
	if (handles.length === 0) {
		return null;
	}
	const choose = (source: EdgeSource, groupId: string) => {
		const existing = edgeFrom(flow, source);
		if (groupId === CONTINUE) {
			if (existing) {
				onFlowChange(removeEdge(flow, existing.id));
			}
			return;
		}
		onFlowChange(connect(flow, source, groupId));
	};
	const options = [
		{ value: CONTINUE, label: copy("noConnection", "Continue in this group") },
		...flow.groups.map((group) => ({
			value: group.id,
			label: `→ ${group.title || copy("untitledGroup", "Untitled group")}`,
		})),
	];
	return (
		<fieldset className="grid gap-3 border-border border-t pt-4">
			<legend className="mb-1 font-medium text-sm">
				{copy("connections", "Next step")}
			</legend>
			{handles.map((handle) => (
				<ConnectionRow
					key={handleId(handle.source)}
					label={handle.label ?? copy("afterBlock", "After this block")}
					onChange={(groupId) => choose(handle.source, groupId)}
					options={options}
					value={edgeFrom(flow, handle.source)?.to.groupId ?? CONTINUE}
				/>
			))}
		</fieldset>
	);
}

function ConnectionRow({
	label,
	onChange,
	options,
	value,
}: {
	label: ReactNode;
	onChange: (value: string) => void;
	options: { label: string; value: string }[];
	value: string;
}) {
	return (
		<div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2">
			<Label className="truncate text-xs">{label}</Label>
			<NativeSelect
				aria-label={
					typeof label === "string" ? `${label}: next step` : "Next step"
				}
				className="w-full"
				onChange={(event) => onChange(event.target.value)}
				size="sm"
				value={value}
			>
				{options.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</div>
	);
}
