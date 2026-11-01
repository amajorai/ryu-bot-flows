/**
 * Knowledge article drafts, owned by the bot workspace (not the Knowledge tab)
 * so unsaved edits survive tab switches and count toward the workspace's
 * unsaved-changes guard.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	BODY_TOO_LARGE_MESSAGE,
	BOT_LIMITS,
	type KnowledgeDocument,
} from "../../sidecar/src/contracts.ts";
import { bodyTooLarge, botFlowsApi, errorMessage } from "./api.ts";
import { randomId } from "./flow-model.ts";

export interface ArticleDraft {
	body: string;
	/** Local key; sent as the article id once the sidecar assigned one. */
	key: string;
	savedId?: string;
	title: string;
}

export function draftsOf(document: KnowledgeDocument): ArticleDraft[] {
	return document.articles.map((article) => ({
		key: article.id,
		savedId: article.id,
		title: article.title,
		body: article.body,
	}));
}

function comparable(articles: ArticleDraft[]): string {
	return JSON.stringify(articles.map(({ title, body }) => ({ title, body })));
}

export function knowledgeChanged(
	articles: ArticleDraft[],
	saved: ArticleDraft[]
): boolean {
	return comparable(articles) !== comparable(saved);
}

/** The request body a save sends. */
export function knowledgeBody(articles: ArticleDraft[]) {
	return {
		articles: articles.map((article) => ({
			...(article.savedId ? { id: article.savedId } : {}),
			title: article.title.trim(),
			body: article.body.trim(),
		})),
	};
}

/** Why the drafts cannot be saved as they are, or null. */
export function knowledgeProblem(articles: ArticleDraft[]): string | null {
	if (
		articles.some((article) => !(article.title.trim() && article.body.trim()))
	) {
		return "Every article needs a title and content.";
	}
	if (
		articles.some(
			(article) =>
				article.title.trim().length > BOT_LIMITS.knowledgeTitle ||
				article.body.trim().length > BOT_LIMITS.knowledgeBody
		)
	) {
		return `Titles fit in ${BOT_LIMITS.knowledgeTitle} characters and content in ${BOT_LIMITS.knowledgeBody.toLocaleString()}.`;
	}
	if (bodyTooLarge(knowledgeBody(articles))) {
		return BODY_TOO_LARGE_MESSAGE;
	}
	return null;
}

export interface KnowledgeDrafts {
	add(): void;
	articles: ArticleDraft[];
	busy: boolean;
	changed: boolean;
	error: string;
	load(): Promise<void>;
	loaded: boolean;
	loading: boolean;
	notice: string;
	problem: string | null;
	remove(key: string): void;
	/** Saves the drafts; resolves false when the save failed. */
	save(): Promise<boolean>;
	update(key: string, patch: Partial<ArticleDraft>): void;
	updatedAt: string | null;
}

export function useKnowledgeDrafts(
	botId: string,
	savedNotice: string
): KnowledgeDrafts {
	const [articles, setArticles] = useState<ArticleDraft[]>([]);
	const [saved, setSaved] = useState<ArticleDraft[]>([]);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	const apply = useCallback((document: KnowledgeDocument) => {
		const drafts = draftsOf(document);
		setArticles(drafts);
		setSaved(drafts);
		setUpdatedAt(document.updatedAt);
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			apply(await botFlowsApi.knowledge(botId));
			setLoaded(true);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [apply, botId]);

	useEffect(() => {
		void load();
	}, [load]);

	const changed = useMemo(
		() => knowledgeChanged(articles, saved),
		[articles, saved]
	);
	const problem = useMemo(() => knowledgeProblem(articles), [articles]);

	const save = useCallback(async () => {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			apply(
				await botFlowsApi.saveKnowledge(botId, knowledgeBody(articles).articles)
			);
			setNotice(savedNotice);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			setBusy(false);
		}
	}, [apply, articles, botId, savedNotice]);

	const update = useCallback(
		(key: string, patch: Partial<ArticleDraft>) =>
			setArticles((current) =>
				current.map((article) =>
					article.key === key ? { ...article, ...patch } : article
				)
			),
		[]
	);

	const add = useCallback(
		() =>
			setArticles((current) => [
				...current,
				{ key: randomId("k"), title: "", body: "" },
			]),
		[]
	);

	const remove = useCallback(
		(key: string) =>
			setArticles((current) => current.filter((item) => item.key !== key)),
		[]
	);

	return {
		add,
		articles,
		busy,
		changed,
		error,
		load,
		loaded,
		loading,
		notice,
		problem,
		remove,
		save,
		update,
		updatedAt,
	};
}
