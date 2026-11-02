import { describe, expect, test } from "bun:test";
import { richTextTokens, safeHttpUrl } from "./rich-text.ts";

describe("richTextTokens", () => {
	test("bold, italic, links and line breaks", () => {
		expect(
			richTextTokens(
				"Hi **there** *you*\n[docs](https://example.com/a) or https://x.example/b."
			)
		).toEqual([
			{ kind: "text", text: "Hi " },
			{ kind: "strong", text: "there" },
			{ kind: "text", text: " " },
			{ kind: "em", text: "you" },
			{ kind: "break" },
			{ kind: "link", href: "https://example.com/a", text: "docs" },
			{ kind: "text", text: " or " },
			{
				kind: "link",
				href: "https://x.example/b",
				text: "https://x.example/b",
			},
			{ kind: "text", text: "." },
		]);
	});

	test("never produces markup or unsafe links", () => {
		const tokens = richTextTokens(
			"<img src=x onerror=alert(1)> [x](javascript:alert(1))"
		);
		expect(tokens).toEqual([
			{
				kind: "text",
				text: "<img src=x onerror=alert(1)> [x](javascript:alert(1))",
			},
		]);
		expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
		expect(safeHttpUrl("https://ok.example")).toBe("https://ok.example/");
	});
});
