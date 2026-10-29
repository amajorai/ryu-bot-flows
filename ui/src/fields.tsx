// Small labelled-field adapters over the shared Ryu controls, so the block
// inspector and settings forms stay declarative. They add no styling of their
// own beyond layout.
import { Input, Label, Switch, Textarea } from "@ryu/blocks/companion/controls";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { type ReactNode, useId } from "react";
import type { Flow } from "../../sidecar/src/contracts.ts";

export function Field({
	children,
	hint,
	htmlFor,
	label,
}: {
	children: ReactNode;
	hint?: ReactNode;
	htmlFor: string;
	label: ReactNode;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
		</div>
	);
}

export function TextField({
	hint,
	label,
	maxLength,
	onChange,
	placeholder,
	type = "text",
	value,
}: {
	hint?: ReactNode;
	label: string;
	maxLength?: number;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: "text" | "url" | "email";
	value: string;
}) {
	const id = useId();
	return (
		<Field hint={hint} htmlFor={id} label={label}>
			<Input
				id={id}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				type={type}
				value={value}
			/>
		</Field>
	);
}

export function TextAreaField({
	hint,
	label,
	maxLength,
	onChange,
	placeholder,
	rows = 3,
	value,
}: {
	hint?: ReactNode;
	label: string;
	maxLength?: number;
	onChange: (value: string) => void;
	placeholder?: string;
	rows?: number;
	value: string;
}) {
	const id = useId();
	return (
		<Field hint={hint} htmlFor={id} label={label}>
			<Textarea
				id={id}
				maxLength={maxLength}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				rows={rows}
				value={value}
			/>
		</Field>
	);
}

/** A number input whose empty state maps to `undefined`. */
export function NumberField({
	hint,
	label,
	max,
	min,
	onChange,
	step,
	value,
}: {
	hint?: ReactNode;
	label: string;
	max?: number;
	min?: number;
	onChange: (value: number | undefined) => void;
	step?: number;
	value: number | undefined;
}) {
	const id = useId();
	return (
		<Field hint={hint} htmlFor={id} label={label}>
			<Input
				id={id}
				inputMode="decimal"
				max={max}
				min={min}
				onChange={(event) => {
					const raw = event.target.value.trim();
					if (raw === "") {
						onChange(undefined);
						return;
					}
					const parsed = Number(raw);
					if (Number.isFinite(parsed)) {
						onChange(parsed);
					}
				}}
				step={step}
				type="number"
				value={value ?? ""}
			/>
		</Field>
	);
}

export function SwitchField({
	checked,
	description,
	label,
	onChange,
}: {
	checked: boolean;
	description?: ReactNode;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="grid gap-0.5">
				<Label htmlFor={id}>{label}</Label>
				{description ? (
					<p className="text-muted-foreground text-xs">{description}</p>
				) : null}
			</div>
			<Switch checked={checked} id={id} onCheckedChange={onChange} />
		</div>
	);
}

export interface SelectOption {
	label: string;
	value: string;
}

export function SelectField({
	hint,
	label,
	onChange,
	options,
	value,
}: {
	hint?: ReactNode;
	label: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	value: string;
}) {
	const id = useId();
	return (
		<Field hint={hint} htmlFor={id} label={label}>
			<NativeSelect
				className="w-full"
				id={id}
				onChange={(event) => onChange(event.target.value)}
				value={value}
			>
				{options.map((option) => (
					<NativeSelectOption key={option.value} value={option.value}>
						{option.label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</Field>
	);
}

export const NEW_VARIABLE = "__new__";
export const NO_VARIABLE = "";

/**
 * Picks a variable by id. "New variable" asks the caller to create one (the
 * caller returns nothing; the new id arrives through the next flow).
 */
export function VariableSelect({
	allowNone = false,
	flow,
	hint,
	label,
	onChange,
	onCreate,
	value,
}: {
	allowNone?: boolean;
	flow: Flow;
	hint?: ReactNode;
	label: string;
	onChange: (variableId: string | undefined) => void;
	onCreate: () => void;
	value: string | undefined;
}) {
	const known = value ? flow.variables.some((item) => item.id === value) : true;
	const options: SelectOption[] = [
		...(allowNone || !value
			? [{ value: NO_VARIABLE, label: "Don't save" }]
			: []),
		...(known || !value ? [] : [{ value, label: "Missing variable" }]),
		...flow.variables.map((variable) => ({
			value: variable.id,
			label: variable.name,
		})),
		{ value: NEW_VARIABLE, label: "+ New variable" },
	];
	return (
		<SelectField
			hint={hint}
			label={label}
			onChange={(next) => {
				if (next === NEW_VARIABLE) {
					onCreate();
					return;
				}
				onChange(next === NO_VARIABLE ? undefined : next);
			}}
			options={options}
			value={value ?? NO_VARIABLE}
		/>
	);
}
