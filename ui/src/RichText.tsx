import { Fragment } from "react";
import { richTextTokens } from "./rich-text.ts";

/** Renders bot message mini-markdown as React text nodes (never as HTML). */
export function RichText({ text }: { text: string }) {
	return (
		<>
			{richTextTokens(text).map((token, index) => {
				const key = `${index}:${token.kind}`;
				switch (token.kind) {
					case "strong":
						return <strong key={key}>{token.text}</strong>;
					case "em":
						return <em key={key}>{token.text}</em>;
					case "link":
						return (
							<a
								className="underline underline-offset-2"
								href={token.href}
								key={key}
								rel="noopener noreferrer"
								target="_blank"
							>
								{token.text}
							</a>
						);
					case "break":
						return <br key={key} />;
					default:
						return <Fragment key={key}>{token.text}</Fragment>;
				}
			})}
		</>
	);
}
