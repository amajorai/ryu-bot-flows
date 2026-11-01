/**
 * The Preview conversation log. A visitor answer is shown as pending while the
 * reply is in flight and removed again when the sidecar does not accept it, so
 * the transcript never shows a message the bot never received.
 */
import type { BotMessage } from "../../sidecar/src/contracts.ts";

export type PreviewEntry =
	| { id: string; kind: "bot"; message: BotMessage }
	| { id: string; kind: "visitor"; pending?: boolean; text: string }
	| { id: string; kind: "redirect"; newTab: boolean; url: string };

export function withPendingAnswer(
	entries: PreviewEntry[],
	id: string,
	text: string
): PreviewEntry[] {
	return [...entries, { id, kind: "visitor", pending: true, text }];
}

/** Marks the pending answer as delivered (`ok`) or removes it. */
export function settleAnswer(
	entries: PreviewEntry[],
	id: string,
	ok: boolean
): PreviewEntry[] {
	if (!ok) {
		return entries.filter((entry) => entry.id !== id);
	}
	return entries.map((entry) =>
		entry.id === id && entry.kind === "visitor"
			? { id: entry.id, kind: "visitor", text: entry.text }
			: entry
	);
}
