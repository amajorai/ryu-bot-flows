import { useAppAssistant } from "@ryu/app-host/assistant-client";
import { RyuAppMain, RyuAppToolbar } from "@ryu/blocks/companion/app-ui";
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Spinner,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@ryu/ui/components/tabs.tsx";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	BODY_TOO_LARGE_MESSAGE,
	type BotDocument,
	type Flow,
	type FlowIssue,
} from "../../sidecar/src/contracts.ts";
import { modelAvailable } from "./ai-generate.ts";
import { BotFlowsRequestError, botFlowsApi, errorMessage } from "./api.ts";
import { buildBotContext, buildBotSurface } from "./assistant.ts";
import { useCopy } from "./copy.ts";
import { FlowEditor } from "./FlowEditor.tsx";
import { indexIssues } from "./flow-model.ts";
import { GenerateFlowDialog } from "./GenerateFlowDialog.tsx";
import { KnowledgePanel } from "./KnowledgePanel.tsx";
import { useKnowledgeDrafts } from "./knowledge-drafts.ts";
import { PreviewSheet } from "./PreviewSheet.tsx";
import { ResultsPanel } from "./ResultsPanel.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { SharePanel } from "./SharePanel.tsx";
import {
	type Draft,
	draftOf,
	draftTooLarge,
	type Remedy,
	reconcileDraft,
	remedyFor,
	sameDraft,
	saveBody,
} from "./workspace-state.ts";

const TABS = ["flow", "settings", "knowledge", "share", "results"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: unknown): value is Tab {
	return TABS.some((tab) => tab === value);
}

export function BotWorkspace({
	initial,
	onClose,
	onOpenBot,
}: {
	initial: BotDocument;
	onClose: (notice?: string) => void;
	onOpenBot: (bot: BotDocument) => void;
}) {
	const copy = useCopy();
	const tl = useLiteralMessages();
	const [saved, setSaved] = useState<BotDocument>(initial);
	const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
	const [tab, setTab] = useState<Tab>("flow");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [errorIssues, setErrorIssues] = useState<FlowIssue[]>([]);
	const [remedy, setRemedy] = useState<Remedy>(null);
	const [leaveOpen, setLeaveOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [previewOpen, setPreviewOpen] = useState(false);
	const [generateOpen, setGenerateOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [aiAvailable, setAiAvailable] = useState(false);

	useEffect(() => {
		setAiAvailable(modelAvailable());
	}, []);

	const changed = useMemo(
		() => !sameDraft(draft, draftOf(saved)),
		[draft, saved]
	);
	const knowledge = useKnowledgeDrafts(
		saved.id,
		copy("knowledgeSaved", "Knowledge saved. Published bots use it right away.")
	);
	const dirty = changed || knowledge.changed;
	const tooLarge = useMemo(() => draftTooLarge(draft, saved), [draft, saved]);

	// Warn before the frame unloads with unsaved flow or knowledge edits.
	useEffect(() => {
		if (!dirty) {
			return;
		}
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	const issues = useMemo(() => indexIssues(draft.flow), [draft.flow]);

	// Publish the open bot to the global Ask Ryu assistant (no app chat pane).
	const assistantFlow = useDeferredValue(draft.flow);
	const assistantContext = useMemo(
		() =>
			buildBotContext(
				{
					id: saved.id,
					name: draft.name,
					slug: draft.slug,
					status: saved.status,
				},
				assistantFlow
			),
		[assistantFlow, draft.name, draft.slug, saved.id, saved.status]
	);
	const assistantSurface = useMemo(
		() => buildBotSurface({ id: saved.id, name: draft.name }, tl),
		[saved.id, draft.name, tl]
	);
	useAppAssistant({ context: assistantContext, surface: assistantSurface });

	const fail = (cause: unknown) => {
		setError(errorMessage(cause));
		if (cause instanceof BotFlowsRequestError) {
			setErrorIssues(
				cause.issues.filter((issue) => issue.severity === "error")
			);
		} else {
			setErrorIssues([]);
		}
		setRemedy(remedyFor(cause));
	};

	const begin = () => {
		setBusy(true);
		setError("");
		setErrorIssues([]);
		setRemedy(null);
		setNotice("");
	};

	/** Applies a server copy without discarding edits made while it was in flight. */
	const settle = useCallback((sent: Draft, next: BotDocument) => {
		setSaved(next);
		setDraft((current) => reconcileDraft(current, sent, next));
	}, []);

	const persist = useCallback(async (): Promise<BotDocument> => {
		const sent = draft;
		const next = await botFlowsApi.save(saved.id, saveBody(sent, saved));
		settle(sent, next);
		return next;
	}, [draft, saved, settle]);

	const save = async () => {
		begin();
		try {
			const next = await persist();
			setNotice(
				next.status === "published"
					? copy("savedNotLive", "Draft saved. Publish to update the live bot.")
					: copy("saved", "Draft saved.")
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	};

	const prepareForPreview = useCallback(async () => {
		if (!changed) {
			return true;
		}
		try {
			await persist();
			return true;
		} catch (cause) {
			fail(cause);
			return false;
		}
	}, [changed, persist]);

	const publish = async () => {
		begin();
		try {
			// Publish exactly the revision on screen: the sidecar refuses any
			// other with `conflict`, so a newer draft saved elsewhere is never
			// published unreviewed.
			const base = changed ? await persist() : saved;
			const next = await botFlowsApi.setPublished(base.id, true, {
				flow: base.flow,
				revision: base.revision,
			});
			settle(draftOf(base), next);
			setNotice(
				copy(
					"publishedNotice",
					"Published. The public link now runs this version."
				)
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	};

	const unpublish = async () => {
		begin();
		try {
			const next = await botFlowsApi.setPublished(saved.id, false);
			setSaved(next);
			setNotice(
				copy(
					"unpublishedNotice",
					"Unpublished. The public link shows the closed message."
				)
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	};

	const leave = () => {
		if (dirty) {
			setLeaveOpen(true);
			return;
		}
		onClose();
	};

	const saveAndLeave = async () => {
		begin();
		try {
			if (changed) {
				await persist();
			}
			if (knowledge.changed && !(await knowledge.save())) {
				setError(
					copy("knowledgeNotSaved", "The knowledge articles weren't saved.")
				);
				setTab("knowledge");
				setLeaveOpen(false);
				return;
			}
			setLeaveOpen(false);
			onClose();
		} catch (cause) {
			fail(cause);
			setLeaveOpen(false);
		} finally {
			setBusy(false);
		}
	};

	const reloadLatest = async () => {
		begin();
		try {
			const next = await botFlowsApi.detail(saved.id);
			setSaved(next);
			setDraft(draftOf(next));
			setNotice(copy("reloaded", "Loaded the latest saved version."));
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	};

	const duplicate = async () => {
		begin();
		try {
			if (changed) {
				await persist();
			}
			onOpenBot(await botFlowsApi.duplicate(saved.id));
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		begin();
		try {
			await botFlowsApi.delete(saved.id);
			setDeleteOpen(false);
			onClose(copy("deleted", "Bot and its results deleted."));
		} catch (cause) {
			fail(cause);
			setBusy(false);
		}
	};

	const setFlow = useCallback((flow: Flow) => {
		setDraft((current) => ({ ...current, flow }));
	}, []);

	const published = saved.status === "published";
	const pendingLive = published && (changed || saved.hasUnpublishedChanges);

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="bot-workspace">
			<RyuAppToolbar
				actions={
					<>
						<Button
							disabled={busy}
							onClick={() => setPreviewOpen(true)}
							variant="outline"
						>
							{copy("preview", "Preview")}
						</Button>
						<Button
							disabled={busy || !changed || tooLarge}
							onClick={() => void save()}
							variant="outline"
						>
							{busy ? <Spinner className="size-4" /> : null}
							{copy("saveDraft", "Save draft")}
						</Button>
						<Button
							disabled={
								busy ||
								tooLarge ||
								issues.errors > 0 ||
								(published && !pendingLive)
							}
							onClick={() => void publish()}
							title={
								issues.errors > 0
									? copy(
											"fixBeforePublish",
											"Fix the flow's errors before publishing."
										)
									: undefined
							}
						>
							{published
								? copy("publishChanges", "Publish changes")
								: copy("publish", "Publish")}
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
								aria-label={copy("moreActions", "More actions")}
								disabled={busy}
								render={<Button size="icon" variant="ghost" />}
							>
								⋯
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{published ? (
									<DropdownMenuItem onClick={() => void unpublish()}>
										{copy("unpublish", "Unpublish")}
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem onClick={() => void duplicate()}>
									{copy("duplicate", "Duplicate")}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => setDeleteOpen(true)}
									variant="destructive"
								>
									{copy("deleteBot", "Delete bot")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Button
						aria-label={copy("allBots", "All bots")}
						className="shrink-0"
						onClick={leave}
						size="sm"
						variant="ghost"
					>
						←
						<span className="hidden sm:inline">
							{copy("allBots", "All bots")}
						</span>
					</Button>
					<h1 className="min-w-16 truncate font-heading font-medium text-base">
						{draft.name}
					</h1>
					<Badge
						className="shrink-0"
						variant={published ? "secondary" : "outline"}
					>
						{published
							? copy("published", "Published")
							: copy("draft", "Draft")}
					</Badge>
					{dirty ? (
						<span className="hidden text-muted-foreground text-xs sm:inline">
							{copy("unsaved", "Unsaved changes")}
						</span>
					) : null}
					{!changed && pendingLive ? (
						<span className="hidden text-muted-foreground text-xs sm:inline">
							{copy("notLive", "Draft differs from the live bot")}
						</span>
					) : null}
				</div>
			</RyuAppToolbar>
			{tooLarge ? (
				<div className="px-[var(--ryu-app-gutter)] pt-2">
					<p
						className="rounded-lg border border-destructive/30 p-3 text-sm"
						role="alert"
					>
						{BODY_TOO_LARGE_MESSAGE}
					</p>
				</div>
			) : null}
			{error || notice ? (
				<div className="px-[var(--ryu-app-gutter)] pt-2">
					{error ? (
						<div
							className="grid gap-1 rounded-lg border border-destructive/30 p-3 text-sm"
							role="alert"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span>{error}</span>
								{remedy === "reload" ? (
									<Button
										onClick={() => void reloadLatest()}
										size="sm"
										variant="outline"
									>
										{copy("reloadLatest", "Discard my edits and reload")}
									</Button>
								) : null}
								{remedy === "settings" ? (
									<Button
										onClick={() => setTab("settings")}
										size="sm"
										variant="outline"
									>
										{copy("changeLink", "Change the public link")}
									</Button>
								) : null}
							</div>
							{errorIssues.slice(0, 5).map((issue) => (
								<span
									className="text-status-destructive text-xs"
									key={`${issue.blockId ?? issue.groupId ?? ""}:${issue.message}`}
								>
									{issue.message}
								</span>
							))}
						</div>
					) : null}
					{notice ? (
						<p className="text-sm text-status-success" role="status">
							{notice}
						</p>
					) : null}
				</div>
			) : null}
			<Tabs
				className="flex min-h-0 flex-1 flex-col gap-0"
				onValueChange={(value) => {
					if (isTab(value)) {
						setTab(value);
					}
				}}
				value={tab}
			>
				<div className="border-border border-b px-[var(--ryu-app-gutter)]">
					<TabsList
						aria-label={copy("botSections", "Bot sections")}
						className="w-full justify-start overflow-x-auto"
						manageLayout={false}
						persistLayout={false}
					>
						<TabsTrigger value="flow">
							{copy("tabFlow", "Flow")}
							{issues.errors > 0 ? (
								<span className="ms-1 font-mono text-status-destructive text-xs tabular-nums">
									{issues.errors}
								</span>
							) : null}
						</TabsTrigger>
						<TabsTrigger value="settings">
							{copy("tabSettings", "Theme & settings")}
						</TabsTrigger>
						<TabsTrigger value="knowledge">
							{copy("tabKnowledge", "Knowledge")}
							{knowledge.changed ? (
								<span
									aria-label={copy("unsaved", "Unsaved changes")}
									className="ms-1 inline-block size-1.5 rounded-full bg-primary"
									role="img"
								/>
							) : null}
						</TabsTrigger>
						<TabsTrigger value="share">{copy("tabShare", "Share")}</TabsTrigger>
						<TabsTrigger value="results">
							{copy("tabResults", "Results")}
						</TabsTrigger>
					</TabsList>
				</div>
				<TabsContent className="min-h-0 flex-1" value="flow">
					<FlowEditor
						aiAvailable={aiAvailable}
						copy={copy}
						flow={draft.flow}
						issues={issues}
						onChange={setFlow}
						onGenerate={() => setGenerateOpen(true)}
					/>
				</TabsContent>
				<TabsContent
					className="min-h-0 flex-1 overflow-y-auto"
					value="settings"
				>
					<RyuAppMain>
						<SettingsPanel
							copy={copy}
							flow={draft.flow}
							name={draft.name}
							onFlowChange={setFlow}
							onNameChange={(name) =>
								setDraft((current) => ({ ...current, name }))
							}
							onSlugChange={(slug) =>
								setDraft((current) => ({ ...current, slug }))
							}
							slug={draft.slug}
						/>
					</RyuAppMain>
				</TabsContent>
				<TabsContent
					className="min-h-0 flex-1 overflow-y-auto"
					value="knowledge"
				>
					<RyuAppMain>
						<KnowledgePanel canEdit copy={copy} state={knowledge} />
					</RyuAppMain>
				</TabsContent>
				<TabsContent className="min-h-0 flex-1 overflow-y-auto" value="share">
					<RyuAppMain>
						<SharePanel
							copy={copy}
							flow={draft.flow}
							onFlowChange={setFlow}
							published={published}
							slug={saved.slug}
						/>
					</RyuAppMain>
				</TabsContent>
				<TabsContent className="min-h-0 flex-1 overflow-y-auto" value="results">
					<RyuAppMain>
						<ResultsPanel botId={saved.id} botName={saved.name} copy={copy} />
					</RyuAppMain>
				</TabsContent>
			</Tabs>
			<PreviewSheet
				botId={saved.id}
				copy={copy}
				onOpenChange={setPreviewOpen}
				open={previewOpen}
				prepare={prepareForPreview}
			/>
			<GenerateFlowDialog
				copy={copy}
				current={draft.flow}
				onApply={setFlow}
				onOpenChange={setGenerateOpen}
				open={generateOpen}
			/>
			<Dialog onOpenChange={setLeaveOpen} open={leaveOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{copy("leaveTitle", "Save changes before leaving?")}
						</DialogTitle>
						<DialogDescription>
							{copy(
								"leaveDescription",
								"This bot has unsaved changes. Save them, or discard them and return to all bots."
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={busy}
							onClick={() => setLeaveOpen(false)}
							variant="outline"
						>
							{copy("cancel", "Cancel")}
						</Button>
						<Button
							disabled={busy}
							onClick={() => {
								setLeaveOpen(false);
								onClose();
							}}
							variant="destructive"
						>
							{copy("discardChanges", "Discard changes")}
						</Button>
						<Button
							disabled={
								busy ||
								tooLarge ||
								(knowledge.changed && knowledge.problem !== null)
							}
							onClick={() => void saveAndLeave()}
						>
							{busy ? <Spinner className="size-4" /> : null}
							{copy("saveAndLeave", "Save and leave")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{copy("deleteBotTitle", "Delete bot?")}</DialogTitle>
						<DialogDescription>
							{copy(
								"deleteBotDescription",
								"This permanently deletes the bot, its knowledge, and every conversation stored with it on this Ryu node. Its public link stops working."
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={busy}
							onClick={() => setDeleteOpen(false)}
							variant="outline"
						>
							{copy("cancel", "Cancel")}
						</Button>
						<Button
							disabled={busy}
							onClick={() => void remove()}
							variant="destructive"
						>
							{copy("deleteBot", "Delete bot")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
