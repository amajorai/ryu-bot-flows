import { Button, Input } from "@ryu/blocks/companion/controls";
import {
	type BlockOf,
	BOT_LIMITS,
	type InputBlock,
	RATING_SCALES,
} from "../../sidecar/src/contracts.ts";
import {
	clamp,
	type FieldProps,
	optional,
	withOptional,
} from "./BlockInspector-shared.tsx";
import {
	NumberField,
	SelectField,
	SwitchField,
	TextField,
	VariableSelect,
} from "./fields.tsx";
import { BLOCK_LABELS, randomId } from "./flow-model.ts";

export function InputCommonFields({
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

export function TextInputFields({
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

export function NumberInputFields({
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

export function DateInputFields({
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

export function RatingFields({
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

export function ChoiceFields({
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
