import type { Block, Flow } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";

export interface FieldProps<T extends Block = Block> {
	block: T;
	copy: Copy;
	createVariable: (hint: string, apply: (variableId: string) => Block) => void;
	flow: Flow;
	set: (block: Block) => void;
}

export function TemplateHint({ copy }: { copy: Copy }) {
	return (
		<>{copy("templateHint", "Use {{variable}} to insert a saved answer.")}</>
	);
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function optional(value: string): string | undefined {
	return value === "" ? undefined : value;
}

/** Copies `block` with `key` set, or removed when `value` is undefined. */
export function withOptional<T extends Block, K extends keyof T>(
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
