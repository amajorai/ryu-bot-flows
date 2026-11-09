import { describe, expect, it } from "bun:test";
import { renderChatPage, renderClosedPage } from "./respondent.ts";
import catalogs from "./respondent-catalog.generated.json" with {
	type: "json",
};
import { negotiateRespondentLocale } from "./respondent-locale.ts";
import { templateFlow } from "./templates.ts";

const arabic = (catalogs as Record<string, Record<string, string>>).ar ?? {};
const english = negotiateRespondentLocale(null, null);

function botConfig(html: string): { copy: Record<string, string> } {
	const match = html.match(
		/<script id="bot-data" type="application\/json" nonce="[^"]+">([^<]*)<\/script>/
	);
	if (!match?.[1]) {
		throw new Error("The chat page has no bot-data script.");
	}
	return JSON.parse(match[1]);
}

describe("chat page language", () => {
	it("renders right-to-left Arabic chrome for an Arabic visitor", () => {
		const { html } = renderChatPage({
			acceptLanguage: "ar,en;q=0.8",
			botName: "Helper",
			embed: false,
			flow: templateFlow("blank"),
		});
		expect(html).toContain('<html lang="ar" dir="rtl">');
		const startOver = arabic["Start over"];
		expect(startOver).toBeDefined();
		expect(startOver).not.toBe("Start over");
		const { copy } = botConfig(html);
		expect(copy.startOver).toBe(startOver as string);
		expect(copy.send).toBe(arabic.Send as string);
	});

	it("falls back to English without a usable header or owner locale", () => {
		const { html } = renderChatPage({
			botName: "Helper",
			embed: true,
			flow: templateFlow("blank"),
			locale: english,
		});
		expect(html).toContain('<html lang="en" dir="ltr">');
		const { copy } = botConfig(html);
		expect(copy.startOver).toBe("Start over");
		expect(copy.starsLabel).toBe("{value} of {total} stars");
	});

	it("translates Bot Flows' own closed notices but not an owner's message", () => {
		const missing = renderClosedPage("This bot doesn't exist.", {
			acceptLanguage: "ar",
		}).html;
		expect(missing).toContain('dir="rtl"');
		expect(missing).toContain(
			arabic["This bot doesn't exist."]?.replaceAll("'", "&#39;") ?? "-"
		);
		const owner = renderClosedPage("Back on Monday.", {
			acceptLanguage: "ar",
		}).html;
		expect(owner).toContain("<p>Back on Monday.</p>");
	});
});
