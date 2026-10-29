import {
	RyuAppEmpty,
	RyuAppList,
	RyuAppListItem,
	RyuAppMain,
	RyuAppSection,
	RyuAppToolbar,
} from "@ryu/blocks/companion/app-ui";
import { Badge, Button, Spinner } from "@ryu/blocks/companion/controls";
import { useI18n } from "@ryu/i18n/react";
import { formatDateTime } from "@ryu/ui/lib/timezone.ts";
import { useCallback, useEffect, useState } from "react";
import type {
	BotDocument,
	BotListItem,
	BotTemplate,
} from "../../sidecar/src/contracts.ts";
import { botFlowsApi, errorMessage } from "./api.ts";
import { BotWorkspace } from "./BotWorkspace.tsx";
import { CreateBotDialog } from "./CreateBotDialog.tsx";
import { type Copy, useCopy } from "./copy.ts";
import { Stat } from "./Stat.tsx";

export function BotFlowsApp() {
	const copy = useCopy();
	const { formatNumber } = useI18n();
	const [items, setItems] = useState<BotListItem[]>([]);
	const [templates, setTemplates] = useState<BotTemplate[]>([]);
	const [templatesError, setTemplatesError] = useState("");
	const [loading, setLoading] = useState(true);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState("");
	const [openBot, setOpenBot] = useState<BotDocument | null>(null);
	const [opening, setOpening] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [notice, setNotice] = useState("");

	const reload = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setItems(await botFlowsApi.list());
			setLoaded(true);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	const loadTemplates = useCallback(async () => {
		setTemplatesError("");
		try {
			setTemplates(await botFlowsApi.templates());
		} catch (cause) {
			setTemplatesError(errorMessage(cause));
		}
	}, []);

	useEffect(() => {
		void reload();
		void loadTemplates();
	}, [reload, loadTemplates]);

	const open = async (item: BotListItem) => {
		setOpening(item.id);
		setError("");
		setNotice("");
		try {
			setOpenBot(await botFlowsApi.detail(item.id));
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setOpening(null);
		}
	};

	const closeWorkspace = (message = "") => {
		setOpenBot(null);
		setNotice(message);
		void reload();
	};

	if (openBot) {
		return (
			<BotWorkspace
				initial={openBot}
				key={openBot.id}
				onClose={closeWorkspace}
				onOpenBot={(next) => setOpenBot(next)}
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="bot-flows-app">
			<RyuAppToolbar
				actions={
					<Button
						disabled={!loaded}
						onClick={() => {
							setCreateOpen(true);
							if (templates.length === 0) {
								void loadTemplates();
							}
						}}
					>
						{copy("newBot", "New bot")}
					</Button>
				}
				title={copy("title", "Bot Flows")}
			/>
			<RyuAppMain>
				{error ? (
					<div
						className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm"
						role="alert"
					>
						<span>{error}</span>
						<Button
							disabled={loading}
							onClick={() => void reload()}
							variant="outline"
						>
							{copy("retry", "Retry")}
						</Button>
					</div>
				) : null}
				{notice ? (
					<p className="text-sm text-status-success" role="status">
						{notice}
					</p>
				) : null}
				<BotListBody
					copy={copy}
					formatNumber={formatNumber}
					items={items}
					loaded={loaded}
					loading={loading}
					onCreate={() => setCreateOpen(true)}
					onOpen={(item) => void open(item)}
					onRetry={() => void reload()}
					opening={opening}
				/>
			</RyuAppMain>
			<CreateBotDialog
				copy={copy}
				onCreated={(bot) => {
					setCreateOpen(false);
					setOpenBot(bot);
				}}
				onOpenChange={setCreateOpen}
				onRetryTemplates={() => void loadTemplates()}
				open={createOpen}
				templates={templates}
				templatesError={templatesError}
			/>
		</div>
	);
}

function BotListBody({
	copy,
	formatNumber,
	items,
	loaded,
	loading,
	opening,
	onCreate,
	onOpen,
	onRetry,
}: {
	copy: Copy;
	formatNumber: (value: number) => string;
	items: BotListItem[];
	loaded: boolean;
	loading: boolean;
	opening: string | null;
	onCreate: () => void;
	onOpen: (item: BotListItem) => void;
	onRetry: () => void;
}) {
	if (loading && !loaded) {
		return (
			<p
				className="flex items-center gap-2 text-muted-foreground text-sm"
				role="status"
			>
				<Spinner className="size-4" />
				{copy("connecting", "Connecting to Bot Flows…")}
			</p>
		);
	}
	if (!loaded) {
		return (
			<RyuAppEmpty
				actions={<Button onClick={onRetry}>{copy("retry", "Retry")}</Button>}
				description={copy(
					"serviceUnavailable",
					"The Bot Flows service is unavailable. Retry when the Ryu node is ready."
				)}
				title={copy("unavailable", "Bot Flows could not connect")}
			/>
		);
	}
	if (items.length === 0) {
		return (
			<RyuAppEmpty
				actions={
					<Button onClick={onCreate}>
						{copy("createFirst", "Create your first bot")}
					</Button>
				}
				description={copy(
					"emptyDescription",
					"Start from a support, lead capture, survey, or intake template, then share the bot's link or embed it on your site."
				)}
				title={copy("emptyTitle", "No bots yet")}
			/>
		);
	}
	const published = items.filter((item) => item.status === "published").length;
	const conversations = items.reduce((sum, item) => sum + item.resultCount, 0);
	const completed = items.reduce((sum, item) => sum + item.completedCount, 0);
	return (
		<>
			<RyuAppSection title={copy("overview", "Overview")}>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Stat
						label={copy("bots", "Bots")}
						value={formatNumber(items.length)}
					/>
					<Stat
						label={copy("publishedCount", "Published")}
						value={formatNumber(published)}
					/>
					<Stat
						label={copy("conversations", "Conversations")}
						value={formatNumber(conversations)}
					/>
					<Stat
						label={copy("completed", "Completed")}
						value={formatNumber(completed)}
					/>
				</div>
			</RyuAppSection>
			<RyuAppSection title={copy("allBots", "All bots")}>
				<RyuAppList aria-label={copy("allBots", "All bots")}>
					{items.map((item) => (
						<RyuAppListItem
							accessories={
								<span className="flex items-center gap-3">
									{opening === item.id ? <Spinner className="size-4" /> : null}
									<span className="hidden font-mono text-muted-foreground text-xs tabular-nums sm:inline">
										{formatNumber(item.resultCount)}{" "}
										{copy("resultsShort", "results")}
									</span>
									<Badge
										variant={
											item.status === "published" ? "secondary" : "outline"
										}
									>
										{item.status === "published"
											? copy("published", "Published")
											: copy("draft", "Draft")}
									</Badge>
								</span>
							}
							disabled={opening !== null}
							key={item.id}
							onClick={() => onOpen(item)}
							subtitle={`/bots/${item.slug} · ${formatNumber(item.blockCount)} ${copy("blocksShort", "blocks")} · ${copy("updated", "Updated")} ${formatDateTime(item.updatedAt)}`}
							title={item.name}
						/>
					))}
				</RyuAppList>
			</RyuAppSection>
		</>
	);
}
