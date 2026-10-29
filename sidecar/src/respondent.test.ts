import { describe, expect, it } from "bun:test";
import { EMBED_SCRIPT } from "./embed.ts";
import {
	CHAT_SCRIPT,
	escapeHtml,
	renderChatPage,
	renderClosedPage,
	scriptJson,
} from "./respondent.ts";
import { templateFlow } from "./templates.ts";

describe("respondent page", () => {
	it("ships syntactically valid client scripts that never use innerHTML", () => {
		expect(() => new Function(CHAT_SCRIPT)).not.toThrow();
		expect(() => new Function(EMBED_SCRIPT)).not.toThrow();
		expect(CHAT_SCRIPT).not.toContain("innerHTML");
		expect(EMBED_SCRIPT).not.toContain("innerHTML");
	});

	it("escapes text for HTML and script-embedded JSON", () => {
		expect(escapeHtml(`<a href="x">'&`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&#39;&amp;"
		);
		expect(scriptJson({ v: "</script>\u2028&" })).toBe(
			'{"v":"\\u003c/script\\u003e\\u2028\\u0026"}'
		);
	});

	it("uses one nonce for the inline style and scripts and drops unsafe avatars", () => {
		const flow = templateFlow("blank");
		flow.theme.avatarUrl = "http://insecure.example/a.png";
		flow.theme.accent = "#123456";
		const { html, nonce } = renderChatPage({
			botName: "Bot",
			embed: false,
			flow,
		});
		expect(html.match(new RegExp(`nonce="${nonce}"`, "g"))).toHaveLength(3);
		expect(html).toContain("--accent: #123456");
		expect(html).toContain('"avatarUrl":null');
		expect(html).toContain("Made with Ryu Bot Flows");
	});

	it("escapes the closed message", () => {
		const { html } = renderClosedPage("<b>closed</b>");
		expect(html).toContain("&lt;b&gt;closed&lt;/b&gt;");
		expect(html).not.toContain("<script");
	});
});
