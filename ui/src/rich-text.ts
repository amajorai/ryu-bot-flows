/**
 * The bot message mini-markdown, tokenized the same way the public chat page
 * renders it: **bold**, *italic*, [label](https://…) and bare http(s) links.
 * Tokens are rendered as React text nodes, so author or visitor text is never
 * interpreted as HTML.
 */

export type RichToken =
	| { kind: "text"; text: string }
	| { kind: "strong"; text: string }
	| { kind: "em"; text: string }
	| { href: string; kind: "link"; text: string }
	| { kind: "break" };

const INLINE =
	/\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

export function safeHttpUrl(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

function inlineTokens(line: string): RichToken[] {
	const tokens: RichToken[] = [];
	let last = 0;
	for (const match of line.matchAll(INLINE)) {
		const index = match.index ?? 0;
		if (index > last) {
			tokens.push({ kind: "text", text: line.slice(last, index) });
		}
		if (match[1] !== undefined) {
			tokens.push({ kind: "strong", text: match[1] });
		} else if (match[2] === undefined) {
			const href = safeHttpUrl(match[4] ?? match[5] ?? "");
			tokens.push(
				href
					? { kind: "link", href, text: match[3] ?? match[5] ?? href }
					: { kind: "text", text: match[0] }
			);
		} else {
			tokens.push({ kind: "em", text: match[2] });
		}
		last = index + match[0].length;
	}
	if (last < line.length) {
		tokens.push({ kind: "text", text: line.slice(last) });
	}
	return tokens;
}

export function richTextTokens(text: string): RichToken[] {
	const tokens: RichToken[] = [];
	text.split("\n").forEach((line, index) => {
		if (index > 0) {
			tokens.push({ kind: "break" });
		}
		tokens.push(...inlineTokens(line));
	});
	return tokens;
}
