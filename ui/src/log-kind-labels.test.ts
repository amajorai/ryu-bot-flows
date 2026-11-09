import { describe, expect, test } from "bun:test";
import { formatMessage, type MessageValuesInput } from "@ryu/i18n/core";
// The provider registers its runtime here; a test registers a stand-in.
import {
	registerActiveI18nRuntime,
	unregisterActiveI18nRuntime,
} from "../../../../packages/i18n/src/active-locale.ts";
import { logKindLabel } from "./log-kind-labels.ts";

// Stand-in rows for the catalog rows the extractor adds for the labels: a
// run-log row reads its step in the person's language, not the wire token.
const CATALOGS: Record<string, Record<string, string>> = {
	ar: { "AI reply": "رد الذكاء الاصطناعي", Engine: "المحرك" },
	de: { "HTTP request": "HTTP-Anfrage", Redirect: "Weiterleitung" },
	ja: { "AI reply": "AI の返信", Media: "メディア" },
};

function runtimeFor(locale: string) {
	return {
		direction: locale === "ar" ? ("rtl" as const) : ("ltr" as const),
		locale,
		translate(_id: string, values?: MessageValuesInput, fallback = "") {
			return formatMessage(
				CATALOGS[locale]?.[fallback] ?? fallback,
				values,
				locale
			);
		},
	};
}

/** Run `read` with `locale`'s stand-in runtime active. */
function inLocale<T>(locale: string, read: () => T): T {
	const runtime = runtimeFor(locale);
	registerActiveI18nRuntime(runtime);
	try {
		return read();
	} finally {
		unregisterActiveI18nRuntime(runtime);
	}
}

describe("run-log kind labels", () => {
	test("every engine token reads as a step label, not the wire token", () => {
		expect(logKindLabel("engine")).toBe("Engine");
		expect(logKindLabel("ai")).toBe("AI reply");
		expect(logKindLabel("http")).toBe("HTTP request");
		expect(logKindLabel("redirect")).toBe("Redirect");
		expect(logKindLabel("media")).toBe("Media");
	});

	test("the label is translated in ja, ar and de", () => {
		expect(inLocale("ja", () => logKindLabel("ai"))).toBe("AI の返信");
		expect(inLocale("ja", () => logKindLabel("media"))).toBe("メディア");
		expect(inLocale("ar", () => logKindLabel("ai"))).toBe(
			"رد الذكاء الاصطناعي"
		);
		expect(inLocale("ar", () => logKindLabel("engine"))).toBe("المحرك");
		expect(inLocale("de", () => logKindLabel("http"))).toBe("HTTP-Anfrage");
		expect(inLocale("de", () => logKindLabel("redirect"))).toBe(
			"Weiterleitung"
		);
	});
});
