import { RyuAppEmpty, RyuAppSection } from "@ryu/blocks/companion/app-ui";
import {
	Button,
	Input,
	Label,
	Spinner,
	Textarea,
} from "@ryu/blocks/companion/controls";
import { formatDateTime } from "@ryu/ui/lib/timezone.ts";
import { BOT_LIMITS } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import type { KnowledgeDrafts } from "./knowledge-drafts.ts";

/**
 * The Knowledge tab. Its drafts live in the workspace (`useKnowledgeDrafts`),
 * so switching tabs never discards them.
 */
export function KnowledgePanel({
	canEdit,
	copy,
	state,
}: {
	canEdit: boolean;
	copy: Copy;
	state: KnowledgeDrafts;
}) {
	const {
		articles,
		busy,
		changed,
		error,
		load,
		loaded,
		loading,
		notice,
		problem,
		updatedAt,
	} = state;

	return (
		<div
			className="mx-auto grid w-full max-w-3xl gap-4"
			data-testid="knowledge-panel"
		>
			<RyuAppSection title={copy("knowledge", "Knowledge")}>
				<p className="text-muted-foreground text-sm">
					{copy(
						"knowledgeDescription",
						"AI reply blocks with “Use knowledge articles” turned on answer from these articles. They are stored with the bot on this node, so anonymous visitors never reach your Spaces or other private data. Edit them here to change what the bot knows."
					)}
				</p>
				{updatedAt ? (
					<p className="text-muted-foreground text-xs">
						{copy("lastSaved", "Last saved")} {formatDateTime(updatedAt)}
					</p>
				) : null}
			</RyuAppSection>
			{error ? (
				<div
					className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm"
					role="alert"
				>
					<span>{error}</span>
					{loaded ? null : (
						<Button onClick={() => void load()} size="sm" variant="outline">
							{copy("retry", "Retry")}
						</Button>
					)}
				</div>
			) : null}
			{notice ? (
				<p className="text-sm text-status-success" role="status">
					{notice}
				</p>
			) : null}
			{loading ? (
				<p
					className="flex items-center gap-2 text-muted-foreground text-sm"
					role="status"
				>
					<Spinner className="size-4" />
					{copy("loadingKnowledge", "Loading knowledge…")}
				</p>
			) : null}
			{loaded && articles.length === 0 ? (
				<RyuAppEmpty
					description={copy(
						"noArticlesDescription",
						"Add short articles such as pricing, opening hours, or return policies."
					)}
					title={copy("noArticles", "No knowledge articles")}
				/>
			) : null}
			{loaded
				? articles.map((article, index) => (
						<div
							className="grid gap-3 rounded-lg border border-border bg-card p-4"
							key={article.key}
						>
							<div className="grid gap-1.5">
								<Label htmlFor={`article-title-${article.key}`}>
									{copy("articleTitle", "Title")} {index + 1}
								</Label>
								<Input
									disabled={!canEdit}
									id={`article-title-${article.key}`}
									maxLength={BOT_LIMITS.knowledgeTitle}
									onChange={(event) =>
										state.update(article.key, { title: event.target.value })
									}
									value={article.title}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor={`article-body-${article.key}`}>
									{copy("articleBody", "Content")}
								</Label>
								<Textarea
									disabled={!canEdit}
									id={`article-body-${article.key}`}
									maxLength={BOT_LIMITS.knowledgeBody}
									onChange={(event) =>
										state.update(article.key, { body: event.target.value })
									}
									rows={5}
									value={article.body}
								/>
								<p className="text-end font-mono text-muted-foreground text-xs tabular-nums">
									{article.body.length.toLocaleString()} /{" "}
									{BOT_LIMITS.knowledgeBody.toLocaleString()}
								</p>
							</div>
							<Button
								className="w-fit"
								disabled={!canEdit}
								onClick={() => state.remove(article.key)}
								size="sm"
								variant="ghost"
							>
								{copy("removeArticle", "Remove article")}
							</Button>
						</div>
					))
				: null}
			{loaded ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						disabled={
							!canEdit || articles.length >= BOT_LIMITS.knowledgeArticles
						}
						onClick={state.add}
						variant="outline"
					>
						{copy("addArticle", "Add article")}
					</Button>
					<Button
						disabled={!canEdit || busy || !changed || problem !== null}
						onClick={() => void state.save()}
					>
						{busy ? <Spinner className="size-4" /> : null}
						{copy("saveKnowledge", "Save knowledge")}
					</Button>
					{problem ? (
						<span className="text-status-warning text-xs" role="alert">
							{problem}
						</span>
					) : null}
					{changed && !problem ? (
						<span className="text-muted-foreground text-xs">
							{copy("knowledgeUnsaved", "Unsaved knowledge changes")}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}
