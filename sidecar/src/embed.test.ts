import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
	EMBED_SOURCES,
	embedLabels,
	embedLabelsLiteral,
} from "./embed.i18n.ts";
import { EMBED_SCRIPT } from "./embed.ts";

/** A minimal element: attributes, a style bag and children. */
class FakeElement {
	readonly attributes = new Map<string, string>();
	readonly children: FakeElement[] = [];
	readonly style: Record<string, string> = {};
	readonly tagName: string;
	readonly nodeType = 1;
	dir = "";
	title = "";
	src = "";
	type = "";
	loading = "";
	referrerPolicy = "";

	constructor(tagName: string) {
		this.tagName = tagName;
	}

	addEventListener(): void {
		// Events are not exercised.
	}

	appendChild(child: FakeElement): FakeElement {
		this.children.push(child);
		return child;
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	remove(): void {
		// Removal is not exercised.
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}
}

interface EmbedApi {
	init(options: Record<string, unknown>): unknown;
}

/** Run the loader against a fake page and return the body's children. */
function runEmbed(
	languages: readonly string[],
	options: Record<string, unknown>,
	dir = ""
): FakeElement[] {
	const body = new FakeElement("body");
	const documentElement = new FakeElement("html");
	documentElement.dir = dir;
	const fakeDocument = {
		body,
		createElement: (tag: string) => new FakeElement(tag),
		createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
		currentScript: { src: "https://node.example/bots/support/embed.js" },
		documentElement,
		addEventListener: () => undefined,
		querySelector: () => null,
	};
	const fakeWindow: { navigator: unknown; RyuBotFlows?: EmbedApi } = {
		navigator: { language: languages[0] ?? "en", languages },
	};
	runInNewContext(EMBED_SCRIPT, {
		document: fakeDocument,
		location: { href: "https://host.example/" },
		URL,
		window: fakeWindow,
	});
	fakeWindow.RyuBotFlows?.init(options);
	return body.children;
}

const CATALOG_DIR = join(import.meta.dir, "../../../../packages/i18n/locales");

describe("embed.js accessible names", () => {
	it("names the launcher and panel in the visitor's language", () => {
		const [button, panel] = runEmbed(["ja-JP", "en"], { mode: "bubble" });
		const ja = embedLabels().ja;
		expect(ja?.chat).toBe("チャット");
		expect(button?.getAttribute("aria-label")).toBe(ja?.openChat ?? "");
		expect(panel?.getAttribute("aria-label")).toBe("チャット");
	});

	it("keeps English for English or unknown visitors and honours overrides", () => {
		const [button, panel] = runEmbed(["xx", "en-GB", "ja"], {
			mode: "bubble",
		});
		expect(button?.getAttribute("aria-label")).toBe("Open chat");
		expect(panel?.getAttribute("aria-label")).toBe("Chat");
		const [custom, titled] = runEmbed(["ja"], {
			mode: "bubble",
			openLabel: "Ask us",
			title: "Support",
		});
		expect(custom?.getAttribute("aria-label")).toBe("Ask us");
		expect(titled?.getAttribute("aria-label")).toBe("Support");
	});

	it("anchors the bubble to the left on a right-to-left page", () => {
		const [button, panel] = runEmbed(["ar"], { mode: "bubble" }, "rtl");
		expect(button?.style.left).toBe("20px");
		expect(button?.style.right).toBeUndefined();
		expect(panel?.style.left).toBe("20px");
		expect(panel?.getAttribute("aria-label")).toBe("الدردشة");
		const [ltrButton] = runEmbed(["en"], { mode: "bubble" });
		expect(ltrButton?.style.right).toBe("20px");
		expect(ltrButton?.style.left).toBeUndefined();
	});
});

describe("embed.js label map", () => {
	it("matches the official catalogs for every shipped locale", () => {
		for (const [locale, labels] of Object.entries(embedLabels())) {
			const catalog = JSON.parse(
				readFileSync(join(CATALOG_DIR, `${locale}.json`), "utf8")
			) as Record<string, string>;
			expect(labels.chat).toBe(catalog[EMBED_SOURCES.chat] || "Chat");
			expect(labels.openChat).toBe(
				catalog[EMBED_SOURCES.openChat] || "Open chat"
			);
		}
	});

	it("falls back to English per label and keeps the literal inert", () => {
		expect(
			embedLabels({ fr: { Chat: "Discussion" }, de: { Other: "x" } })
		).toEqual({ fr: { chat: "Discussion", openChat: "Open chat" } });
		const literal = embedLabelsLiteral({
			xx: { chat: "</script>", openChat: "Open" },
		});
		expect(literal).not.toContain("<");
		expect(JSON.parse(literal).xx.chat).toBe("</script>");
		expect(JSON.parse(literal).en).toEqual(EMBED_SOURCES);
	});
});
