/**
 * Visitor-facing text the chat server sends in English: public API error
 * codes and the two engine defaults (the AI fallback and the default
 * invalid-reply message). The chat page shows each in the visitor's language.
 *
 * Error codes map to fixed sentences, so the client prefers `codes[code]`
 * over the server's English message. A `closed` error carries the owner's
 * closed message, which stays as written unless it is the Bot Flows default
 * (`messages`). Engine defaults are translated only while the bubble still
 * carries the exact English default; text an owner wrote stays as written.
 */
import { type BotMessage, DEFAULT_SETTINGS } from "./contracts.ts";
import type { RespondentLocale } from "./respondent-locale.ts";

/** Must match `DEFAULT_AI_FALLBACK` in `engine.ts` (a test pins them together). */
export const DEFAULT_AI_FALLBACK_TEXT =
	"Sorry, I can't answer that right now. Let's keep going.";

/** The chat client's `copy.errors`: localized text by error code and by message. */
export interface RespondentErrorCopy {
	codes: Record<string, string>;
	messages: Record<string, string>;
}

export function respondentErrorCopy(t: RespondentLocale): RespondentErrorCopy {
	return {
		codes: {
			busy: t.tl("Still working on your last message."),
			completed: t.tl("This conversation has ended."),
			expired: t.tl("This conversation expired."),
			not_found: t.tl("This bot doesn't exist."),
			quota: t.tl("This bot isn't accepting new conversations right now."),
			rate_limited: t.tl(
				"Too many messages right now. Please wait a few minutes."
			),
			too_large: t.tl("This message is too long."),
		},
		messages: {
			"Bot not found.": t.tl("This bot doesn't exist."),
			"This bot isn't taking conversations right now.": t.tl(
				"This bot isn't taking conversations right now."
			),
		},
	};
}

/** The engine's English default for `text`, translated, or null when `text` is not one. */
function engineDefault(text: string, t: RespondentLocale): string | null {
	if (text === DEFAULT_AI_FALLBACK_TEXT) {
		return t.tl("Sorry, I can't answer that right now. Let's keep going.");
	}
	if (text === DEFAULT_SETTINGS.invalidReplyMessage) {
		return t.tl("That doesn't look right. Please try again.");
	}
	return null;
}

/** Bot messages with any unchanged engine default shown in the visitor's language. */
export function localizeEngineDefaults(
	messages: readonly BotMessage[],
	t: RespondentLocale
): BotMessage[] {
	return messages.map((message) => {
		if (message.type !== "text" || message.source !== "system") {
			return message;
		}
		const localized = engineDefault(message.content, t);
		return localized === null ? message : { ...message, content: localized };
	});
}
