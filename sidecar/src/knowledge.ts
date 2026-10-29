/**
 * Local knowledge retrieval for AI reply blocks.
 *
 * Owners snapshot articles into the sidecar because anonymous visitors cannot
 * search the owner's Spaces. Retrieval is a small BM25 ranking over
 * paragraph-sized chunks; nothing leaves the node.
 */
import type { KnowledgeArticle } from "./contracts.ts";

const CHUNK_CHARS = 900;
const K1 = 1.2;
const B = 0.75;
const STOPWORDS = new Set(
	"a an and are as at be but by can do does for from how i if in is it its me my of on or our so that the their them then there these this to us was we what when where which who why will with you your".split(
		" "
	)
);

export interface KnowledgeChunk {
	articleId: string;
	text: string;
	title: string;
	tokens: string[];
}

export interface KnowledgeMatch {
	articleId: string;
	score: number;
	text: string;
	title: string;
}

export function tokenize(value: string): string[] {
	return (
		value
			.toLowerCase()
			.normalize("NFKD")
			.match(/[\p{L}\p{N}]+/gu) ?? []
	)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token))
		.map((token) =>
			token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token
		);
}

/** Splits an article into paragraph-aligned chunks of about 900 characters. */
export function chunkArticles(articles: KnowledgeArticle[]): KnowledgeChunk[] {
	const chunks: KnowledgeChunk[] = [];
	for (const article of articles) {
		let current = "";
		const flush = () => {
			const text = current.trim();
			if (text) {
				chunks.push({
					articleId: article.id,
					title: article.title,
					text,
					tokens: tokenize(`${article.title} ${text}`),
				});
			}
			current = "";
		};
		for (const paragraph of article.body.split(/\n\s*\n/)) {
			for (let offset = 0; offset < paragraph.length; offset += CHUNK_CHARS) {
				const piece = paragraph.slice(offset, offset + CHUNK_CHARS);
				if (current.length + piece.length > CHUNK_CHARS) {
					flush();
				}
				current += `${piece}\n\n`;
			}
		}
		flush();
	}
	return chunks;
}

/** Ranks chunks against the query with BM25 and returns the top `limit`. */
export function searchKnowledge(
	chunks: KnowledgeChunk[],
	query: string,
	limit = 3
): KnowledgeMatch[] {
	const terms = [...new Set(tokenize(query))];
	if (terms.length === 0 || chunks.length === 0) {
		return [];
	}
	const averageLength =
		chunks.reduce((total, chunk) => total + chunk.tokens.length, 0) /
		chunks.length;
	const documentFrequency = new Map<string, number>();
	for (const term of terms) {
		documentFrequency.set(
			term,
			chunks.filter((chunk) => chunk.tokens.includes(term)).length
		);
	}
	const scored: KnowledgeMatch[] = [];
	for (const chunk of chunks) {
		let score = 0;
		for (const term of terms) {
			const frequency = chunk.tokens.filter((token) => token === term).length;
			if (frequency === 0) {
				continue;
			}
			const df = documentFrequency.get(term) ?? 0;
			const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
			score +=
				(idf * frequency * (K1 + 1)) /
				(frequency +
					K1 * (1 - B + (B * chunk.tokens.length) / (averageLength || 1)));
		}
		if (score > 0) {
			scored.push({
				articleId: chunk.articleId,
				title: chunk.title,
				text: chunk.text,
				score,
			});
		}
	}
	return scored.sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Formats matches as prompt snippets. */
export function knowledgeSnippets(
	articles: KnowledgeArticle[],
	query: string,
	limit = 3
): string[] {
	return searchKnowledge(chunkArticles(articles), query, limit).map(
		(match) => `${match.title}\n${match.text}`
	);
}
