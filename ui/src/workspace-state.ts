/**
 * Pure state rules for the bot workspace: what an in-flight save may replace,
 * the body a save sends, and which recovery a failed request offers.
 */
import type { BotDocument, Flow } from "../../sidecar/src/contracts.ts";
import { BotFlowsRequestError, bodyTooLarge } from "./api.ts";

export interface Draft {
	flow: Flow;
	name: string;
	slug: string;
}

export function draftOf(bot: BotDocument): Draft {
	return { flow: bot.flow, name: bot.name, slug: bot.slug };
}

export function sameDraft(left: Draft, right: Draft): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The draft to show once a save or publish of `sent` resolved with `next`.
 * Edits made while the request was in flight are kept (the draft then still
 * differs from the new saved version); otherwise the server copy replaces it.
 */
export function reconcileDraft(
	current: Draft,
	sent: Draft,
	next: BotDocument
): Draft {
	return current === sent || sameDraft(current, sent) ? draftOf(next) : current;
}

/** The PUT body that saves `draft` over `saved`. */
export function saveBody(draft: Draft, saved: BotDocument) {
	return {
		revision: saved.revision,
		flow: draft.flow,
		...(draft.name === saved.name ? {} : { name: draft.name }),
		...(draft.slug === saved.slug ? {} : { slug: draft.slug }),
	};
}

/** True when saving `draft` would exceed the largest body Core accepts. */
export function draftTooLarge(draft: Draft, saved: BotDocument): boolean {
	return bodyTooLarge(saveBody(draft, saved));
}

/**
 * The recovery a failed workspace request offers: reload only for a stale
 * revision (reloading cannot fix anything else), the Settings link field for a
 * taken slug, and nothing otherwise.
 */
export type Remedy = "reload" | "settings" | null;

export function remedyFor(cause: unknown): Remedy {
	if (!(cause instanceof BotFlowsRequestError)) {
		return null;
	}
	if (cause.code === "slug_taken") {
		return "settings";
	}
	return cause.code === "conflict" ? "reload" : null;
}
