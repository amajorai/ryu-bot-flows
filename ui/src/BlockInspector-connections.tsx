import { Label } from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import type { ReactNode } from "react";
import type { Block, Flow } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import {
	blockHandles,
	connect,
	type EdgeSource,
	edgeFrom,
	handleId,
	removeEdge,
} from "./flow-model.ts";

const CONTINUE = "";

/** Keyboard-reachable alternative to dragging: pick each handle's target group. */
export function ConnectionFields({
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
	const tl = useLiteralMessages();
	return (
		<div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2">
			<Label className="truncate text-xs">{label}</Label>
			<NativeSelect
				aria-label={
					typeof label === "string"
						? tl("{label}: next step", { label })
						: "Next step"
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
