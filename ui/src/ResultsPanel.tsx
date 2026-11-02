import { RyuAppEmpty, RyuAppSection } from "@ryu/blocks/companion/app-ui";
import { Badge, Button, Spinner } from "@ryu/blocks/companion/controls";
import { useI18n } from "@ryu/i18n/react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@ryu/ui/components/sheet.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ryu/ui/components/table.tsx";
import { formatDateTime } from "@ryu/ui/lib/timezone.ts";
import { useCallback, useEffect, useState } from "react";
import type {
	BotAnalytics,
	ResultDetail,
	ResultPage,
} from "../../sidecar/src/contracts.ts";
import { botFlowsApi, errorMessage, exportCsv, safeFilename } from "./api.ts";
import type { Copy } from "./copy.ts";
import { RichText } from "./RichText.tsx";
import { Stat } from "./Stat.tsx";

export function ResultsPanel({
	botId,
	botName,
	copy,
}: {
	botId: string;
	botName: string;
	copy: Copy;
}) {
	const { formatNumber } = useI18n();
	const [analytics, setAnalytics] = useState<BotAnalytics | null>(null);
	const [page, setPage] = useState<ResultPage | null>(null);
	const [loading, setLoading] = useState(true);
	const [moreLoading, setMoreLoading] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [exporting, setExporting] = useState(false);
	const [detailId, setDetailId] = useState<string | null>(null);
	const [detail, setDetail] = useState<ResultDetail | null>(null);
	const [detailError, setDetailError] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const [nextAnalytics, nextPage] = await Promise.all([
				botFlowsApi.analytics(botId),
				botFlowsApi.results(botId),
			]);
			setAnalytics(nextAnalytics);
			setPage(nextPage);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [botId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!detailId) {
			setDetail(null);
			return;
		}
		let active = true;
		setDetail(null);
		setDetailError("");
		botFlowsApi
			.result(botId, detailId)
			.then((next) => {
				if (active) {
					setDetail(next);
				}
			})
			.catch((cause: unknown) => {
				if (active) {
					setDetailError(errorMessage(cause));
				}
			});
		return () => {
			active = false;
		};
	}, [botId, detailId]);

	const loadMore = async () => {
		if (!page?.nextCursor) {
			return;
		}
		setMoreLoading(true);
		setError("");
		try {
			const next = await botFlowsApi.results(botId, page.nextCursor);
			setPage((current) => ({
				items: [...(current?.items ?? []), ...next.items],
				nextCursor: next.nextCursor,
			}));
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setMoreLoading(false);
		}
	};

	const download = async () => {
		setExporting(true);
		setError("");
		setNotice("");
		try {
			const table = await botFlowsApi.exportTable(botId);
			const objectUrl = URL.createObjectURL(
				new Blob([exportCsv(table)], { type: "text/csv;charset=utf-8" })
			);
			const link = document.createElement("a");
			link.href = objectUrl;
			link.download = `${safeFilename(botName)}-results.csv`;
			link.click();
			URL.revokeObjectURL(objectUrl);
			setNotice(copy("exported", "Results exported."));
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setExporting(false);
		}
	};

	if (loading && !analytics) {
		return (
			<p
				className="flex items-center gap-2 text-muted-foreground text-sm"
				role="status"
			>
				<Spinner className="size-4" />
				{copy("loadingResults", "Loading results…")}
			</p>
		);
	}
	if (!(analytics && page)) {
		return (
			<RyuAppEmpty
				actions={
					<Button onClick={() => void load()}>{copy("retry", "Retry")}</Button>
				}
				description={
					error || copy("resultsUnavailable", "Results could not be loaded.")
				}
				title={copy("resultsError", "Couldn't load results")}
			/>
		);
	}
	const inputs = analytics.blocks.filter(
		(block) => block.reached > 0 || block.answered > 0
	);
	return (
		<div
			className="mx-auto grid w-full max-w-5xl gap-6"
			data-testid="results-panel"
		>
			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button
					disabled={loading}
					onClick={() => void load()}
					size="sm"
					variant="ghost"
				>
					{copy("refresh", "Refresh")}
				</Button>
				<Button
					disabled={exporting || page.items.length === 0}
					onClick={() => void download()}
					size="sm"
					variant="outline"
				>
					{exporting ? <Spinner className="size-4" /> : null}
					{copy("exportCsv", "Export CSV")}
				</Button>
			</div>
			{error ? (
				<p className="text-sm text-status-destructive" role="alert">
					{error}
				</p>
			) : null}
			{notice ? (
				<p className="text-sm text-status-success" role="status">
					{notice}
				</p>
			) : null}
			<RyuAppSection title={copy("summary", "Summary")}>
				<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
					<Stat
						label={copy("views", "Views")}
						value={formatNumber(analytics.views)}
					/>
					<Stat
						label={copy("started", "Started")}
						value={formatNumber(analytics.started)}
					/>
					<Stat
						label={copy("completed", "Completed")}
						value={formatNumber(analytics.completed)}
					/>
					<Stat
						label={copy("completionRate", "Completion rate")}
						value={`${formatNumber(Math.round(analytics.completionRate * 100))}%`}
					/>
					<Stat
						label={copy("handoffs", "Handoffs")}
						value={formatNumber(analytics.handoffs)}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					{copy(
						"previewExcluded",
						"Preview runs from the builder are not counted."
					)}
				</p>
			</RyuAppSection>
			<RyuAppSection title={copy("dropOff", "Drop-off by question")}>
				{inputs.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{copy(
							"noDropOff",
							"Drop-off appears once visitors reach the bot's questions."
						)}
					</p>
				) : (
					<ol className="grid gap-2" data-testid="drop-off">
						{inputs.map((block) => {
							const percent = Math.round(block.dropOff * 100);
							return (
								<li
									className="grid gap-1 rounded-lg border border-border p-3"
									key={block.blockId}
								>
									<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
										<span className="min-w-0 truncate">
											<span className="text-muted-foreground">
												{block.groupTitle} ·{" "}
											</span>
											{block.label}
										</span>
										<span className="font-mono text-muted-foreground text-xs tabular-nums">
											{formatNumber(block.answered)}/
											{formatNumber(block.reached)}{" "}
											{copy("answered", "answered")} · {percent}%{" "}
											{copy("dropped", "dropped")}
										</span>
									</div>
									<div
										aria-hidden="true"
										className="h-1.5 overflow-hidden rounded-full bg-muted"
									>
										<div
											className="h-full rounded-full bg-destructive/70"
											style={{ width: `${percent}%` }}
										/>
									</div>
								</li>
							);
						})}
					</ol>
				)}
			</RyuAppSection>
			<RyuAppSection title={copy("conversations", "Conversations")}>
				{page.items.length === 0 ? (
					<RyuAppEmpty
						description={copy(
							"noResultsDescription",
							"Publish the bot and share its link. Each conversation appears here with its answers."
						)}
						title={copy("noResults", "No conversations yet")}
					/>
				) : (
					<div className="overflow-x-auto rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{copy("startedAt", "Started")}</TableHead>
									<TableHead>{copy("status", "Status")}</TableHead>
									<TableHead>{copy("answers", "Answers")}</TableHead>
									<TableHead className="hidden md:table-cell">
										{copy("preview", "Preview")}
									</TableHead>
									<TableHead>
										<span className="sr-only">
											{copy("actions", "Actions")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{page.items.map((item) => (
									<TableRow key={item.id}>
										<TableCell className="whitespace-nowrap">
											{formatDateTime(item.startedAt)}
										</TableCell>
										<TableCell>
											<Badge
												variant={item.completedAt ? "secondary" : "outline"}
											>
												{item.completedAt
													? copy("completedBadge", "Completed")
													: copy("inProgress", "Incomplete")}
											</Badge>
											{item.handoffCount > 0 ? (
												<Badge className="ms-1" variant="outline">
													{copy("handoffBadge", "Handoff")}
												</Badge>
											) : null}
										</TableCell>
										<TableCell className="font-mono tabular-nums">
											{formatNumber(item.answerCount)}
										</TableCell>
										<TableCell className="hidden max-w-80 truncate text-muted-foreground md:table-cell">
											{item.preview}
										</TableCell>
										<TableCell className="text-end">
											<Button
												onClick={() => setDetailId(item.id)}
												size="sm"
												variant="ghost"
											>
												{copy("view", "View")}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
				{page.nextCursor ? (
					<Button
						className="w-fit"
						disabled={moreLoading}
						onClick={() => void loadMore()}
						variant="outline"
					>
						{moreLoading ? <Spinner className="size-4" /> : null}
						{copy("loadMore", "Load more")}
					</Button>
				) : null}
			</RyuAppSection>
			<Sheet
				onOpenChange={(open) => !open && setDetailId(null)}
				open={detailId !== null}
			>
				<SheetContent
					className="w-full overflow-y-auto sm:max-w-lg"
					side="right"
				>
					<SheetHeader>
						<SheetTitle>{copy("conversation", "Conversation")}</SheetTitle>
						<SheetDescription>
							{detail
								? formatDateTime(detail.startedAt)
								: copy("loading", "Loading…")}
						</SheetDescription>
					</SheetHeader>
					<div className="grid gap-5 px-4 pb-6" data-testid="result-detail">
						{detailError ? (
							<p className="text-sm text-status-destructive" role="alert">
								{detailError}
							</p>
						) : null}
						{detail ? <ResultDetailView copy={copy} detail={detail} /> : null}
						{detail || detailError ? null : <Spinner className="size-4" />}
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

function ResultDetailView({
	copy,
	detail,
}: {
	copy: Copy;
	detail: ResultDetail;
}) {
	const variables = Object.entries(detail.variables);
	return (
		<>
			<section className="grid gap-2">
				<h3 className="font-medium text-sm">
					{copy("transcript", "Transcript")}
				</h3>
				<ol className="grid gap-2">
					{detail.transcript.map((entry, index) => (
						<li
							className={
								entry.from === "visitor"
									? "ms-8 justify-self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground text-sm"
									: "me-8 justify-self-start rounded-lg bg-muted px-3 py-2 text-sm"
							}
							// biome-ignore lint/suspicious/noArrayIndexKey: transcript entries are append-only
							key={index}
						>
							<span className="sr-only">
								{entry.from === "visitor"
									? copy("visitorSaid", "Visitor:")
									: copy("botSaid", "Bot:")}{" "}
							</span>
							<RichText text={entry.text} />
						</li>
					))}
				</ol>
			</section>
			{detail.handoffs.length > 0 ? (
				<section className="grid gap-2">
					<h3 className="font-medium text-sm">
						{copy("handoffs", "Handoffs")}
					</h3>
					{detail.handoffs.map((handoff) => (
						<div
							className="rounded-lg border border-border p-3 text-sm"
							key={`${handoff.blockId}:${handoff.at}`}
						>
							<Badge variant="outline">{handoff.topic}</Badge>
							<p className="mt-1 whitespace-pre-wrap">{handoff.summary}</p>
						</div>
					))}
				</section>
			) : null}
			<section className="grid gap-2">
				<h3 className="font-medium text-sm">
					{copy("variables", "Variables")}
				</h3>
				{variables.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{copy("noValues", "No values saved.")}
					</p>
				) : (
					<dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
						{variables.map(([name, value]) => (
							<div className="contents" key={name}>
								<dt className="truncate font-mono text-muted-foreground text-xs">
									{name}
								</dt>
								<dd className="break-words">{value}</dd>
							</div>
						))}
					</dl>
				)}
			</section>
			{detail.logs.length > 0 ? (
				<section className="grid gap-2">
					<h3 className="font-medium text-sm">{copy("logs", "Logs")}</h3>
					<ul className="grid gap-1">
						{detail.logs.map((log, index) => (
							<li
								className={
									log.level === "error"
										? "text-status-destructive text-xs"
										: "text-muted-foreground text-xs"
								}
								// biome-ignore lint/suspicious/noArrayIndexKey: logs are append-only
								key={index}
							>
								{log.kind}: {log.message}
							</li>
						))}
					</ul>
				</section>
			) : null}
		</>
	);
}
