import { useI18n } from "@ryu/i18n/react";
import { useCallback } from "react";

/** App-owned UI copy through the shared i18n runtime, with English fallbacks. */
export type Copy = (key: string, fallback: string) => string;

export function useCopy(): Copy {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback: string) => t(`botFlows.${key}`, {}, fallback),
		[t]
	);
}
