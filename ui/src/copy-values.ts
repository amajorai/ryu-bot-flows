import { useI18n } from "@ryu/i18n/react";
import { useCallback } from "react";

/** ICU values for a whole-message copy string. */
export type CopyValues = Record<string, number | string>;

/**
 * `copy()` with ICU values, so a label that carries a name, a count or an
 * ordinal is one translatable message instead of pieces glued together, e.g.
 * `copyWith("usedBy", "Used by {count, plural, one {# block} other {# blocks}}", { count })`.
 */
export type CopyWith = (
	key: string,
	fallback: string,
	values: CopyValues
) => string;

export function useCopyWith(): CopyWith {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback: string, values: CopyValues) =>
			t(`botFlows.${key}`, values, fallback),
		[t]
	);
}
