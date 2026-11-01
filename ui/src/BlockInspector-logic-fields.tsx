import { Button } from "@ryu/blocks/companion/controls";
import {
	type BlockOf,
	BOT_LIMITS,
	CONDITION_OPERATORS,
	SET_VARIABLE_OPS,
} from "../../sidecar/src/contracts.ts";
import {
	type FieldProps,
	TemplateHint,
	withOptional,
} from "./BlockInspector-shared.tsx";
import {
	SelectField,
	SwitchField,
	TextField,
	VariableSelect,
} from "./fields.tsx";

export function SetVariableFields({
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

export function ConditionFields({
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

export function RedirectFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"redirect">>) {
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

export function JumpFields({
	block,
	copy,
	flow,
	set,
}: FieldProps<BlockOf<"jump">>) {
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
