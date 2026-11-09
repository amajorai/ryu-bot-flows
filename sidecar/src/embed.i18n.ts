/**
 * The accessible names `embed.js` gives its launcher and chat panel.
 *
 * The loader runs on a third-party host page, where neither the DOM localizer
 * nor the server's `Accept-Language` negotiation reaches, so it carries an
 * inline map of these two labels for every official locale and picks one from
 * `navigator.language` in the visitor's browser. The map is built from
 * `respondent-catalog.generated.json`, the official catalog slice this sidecar
 * already ships (`scripts/sync-respondent-catalogs.mjs` reads the `tl()`
 * sources below, and its `--check` keeps the slice in step with
 * `packages/i18n/locales`). A locale whose catalog lacks a label falls back to
 * English for that label.
 */
import catalogs from "./respondent-catalog.generated.json" with {
	type: "json",
};

/** Marks a catalog source for the extractors; the loader translates at runtime. */
const tl = (source: string): string => source;

/** The English sources of the loader's two accessible names. */
export const EMBED_SOURCES = {
	chat: tl("Chat"),
	openChat: tl("Open chat"),
} as const;

export interface EmbedLabels {
	/** The panel and iframe name (`options.title` overrides it). */
	readonly chat: string;
	/** The bubble launcher's name (`options.openLabel` overrides it). */
	readonly openChat: string;
}

const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> =
	catalogs;

/** `{ locale: labels }` for every locale whose catalog translates either label. */
export function embedLabels(
	catalogsByLocale: Readonly<
		Record<string, Readonly<Record<string, string>>>
	> = CATALOGS
): Record<string, EmbedLabels> {
	const labels: Record<string, EmbedLabels> = {};
	for (const [locale, messages] of Object.entries(catalogsByLocale)) {
		const chat = messages[EMBED_SOURCES.chat];
		const openChat = messages[EMBED_SOURCES.openChat];
		if (chat || openChat) {
			labels[locale] = {
				chat: chat || EMBED_SOURCES.chat,
				openChat: openChat || EMBED_SOURCES.openChat,
			};
		}
	}
	return labels;
}

/**
 * The label map as a JavaScript literal for the loader. `<` is escaped so the
 * text stays inert even if a host inlines the loader in a `<script>` element.
 */
export function embedLabelsLiteral(
	labels: Record<string, EmbedLabels> = embedLabels()
): string {
	return JSON.stringify({ en: EMBED_SOURCES, ...labels }).replaceAll(
		"<",
		"\\u003c"
	);
}
