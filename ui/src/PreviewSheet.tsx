import {
	Badge,
	Button,
	Checkbox,
	Input,
	Label,
	Spinner,
	Textarea,
} from "@ryu/blocks/companion/controls";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@ryu/ui/components/sheet.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	InputSpec,
	PreviewTurn,
	ReplyValue,
} from "../../sidecar/src/contracts.ts";
import { botFlowsApi, errorMessage } from "./api.ts";
import type { Copy } from "./copy.ts";
import {
	type PreviewEntry as Entry,
	settleAnswer,
	withPendingAnswer,
} from "./preview-log.ts";
import { RichText } from "./RichText.tsx";
import { safeHttpUrl } from "./rich-text.ts";

/**
 * Runs the saved draft through the admin preview endpoints. Preview runs are
 * not counted in results and never emit events. The conversation renders the
 * same message types, mini-markdown, and inputs as the public chat page.
 */
export function PreviewSheet({
	botId,
	copy,
	open,
	prepare,
	onOpenChange,
}: {
	botId: string;
	copy: Copy;
	open: boolean;
	/** Saves the draft first when it has unsaved changes. */
	prepare: () => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
}) {
	const [entries, setEntries] = useState<Entry[]>([]);
	const [turn, setTurn] = useState<PreviewTurn | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	/** Bumps once per accepted turn; keys the answer input so a failed send keeps it. */
	const [step, setStep] = useState(0);
	const counter = useRef(0);
	const logRef = useRef<HTMLOListElement>(null);

	const nextId = () => {
		counter.current += 1;
		return `entry-${counter.current}`;
	};

	const absorb = useCallback((next: PreviewTurn) => {
		setTurn(next);
		setStep((current) => current + 1);
		setEntries((current) => {
			const added: Entry[] = next.messages.map((message) => {
				counter.current += 1;
				return { id: `entry-${counter.current}`, kind: "bot", message };
			});
			if (next.redirect) {
				counter.current += 1;
				added.push({
					id: `entry-${counter.current}`,
					kind: "redirect",
					url: next.redirect.url,
					newTab: next.redirect.newTab,
				});
			}
			return [...current, ...added];
		});
	}, []);

	const start = useCallback(async () => {
		setBusy(true);
		setError("");
		setEntries([]);
		setTurn(null);
		try {
			if (!(await prepare())) {
				setError(copy("previewNeedsSave", "Save the draft to preview it."));
				return;
			}
			absorb(await botFlowsApi.previewStart(botId));
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	}, [absorb, botId, copy, prepare]);

	useEffect(() => {
		if (open) {
			void start();
		}
		// Start once per opening; `start` changes identity with the draft.
		// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	}, [open]);

	useEffect(() => {
		const log = logRef.current;
		if (log && entries.length > 0) {
			log.scrollTop = log.scrollHeight;
		}
	}, [entries]);

	const send = async (value: ReplyValue, shown: string) => {
		if (!turn) {
			return;
		}
		setBusy(true);
		setError("");
		const answerId = nextId();
		setEntries((current) => withPendingAnswer(current, answerId, shown));
		try {
			const next = await botFlowsApi.previewReply(turn.sessionId, value);
			setEntries((current) => settleAnswer(current, answerId, true));
			absorb(next);
		} catch (cause) {
			setEntries((current) => settleAnswer(current, answerId, false));
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent className="w-full sm:max-w-md" side="right">
				<SheetHeader>
					<SheetTitle>{copy("preview", "Preview")}</SheetTitle>
					<SheetDescription>
						{copy(
							"previewDescription",
							"Runs the saved draft. Preview conversations aren't counted in results and don't trigger handoff events."
						)}
					</SheetDescription>
				</SheetHeader>
				<div
					className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4"
					data-testid="preview"
				>
					<ol
						aria-label={copy("previewConversation", "Preview conversation")}
						aria-live="polite"
						className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto"
						ref={logRef}
					>
						{entries.map((entry) => (
							<PreviewEntry copy={copy} entry={entry} key={entry.id} />
						))}
						{busy ? (
							<li
								className="flex items-center gap-2 text-muted-foreground text-xs"
								role="status"
							>
								<Spinner className="size-3.5" />
								{copy("botTyping", "Bot is responding…")}
							</li>
						) : null}
					</ol>
					{error ? (
						<p className="text-sm text-status-destructive" role="alert">
							{error}
						</p>
					) : null}
					{turn && !turn.done && turn.input ? (
						<PreviewInput
							busy={busy}
							copy={copy}
							input={turn.input}
							key={`${turn.sessionId}:${step}`}
							onSend={(value, shown) => void send(value, shown)}
						/>
					) : null}
					{turn?.done ? (
						<p
							className="text-center text-muted-foreground text-xs"
							role="status"
						>
							{copy("previewEnded", "The conversation ended.")}
						</p>
					) : null}
					{turn ? <PreviewState copy={copy} turn={turn} /> : null}
					<Button
						disabled={busy}
						onClick={() => void start()}
						variant="outline"
					>
						{copy("restart", "Restart preview")}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function PreviewEntry({ copy, entry }: { copy: Copy; entry: Entry }) {
	if (entry.kind === "visitor") {
		return (
			<li
				aria-busy={entry.pending ? true : undefined}
				className={cn(
					"ms-10 justify-self-end whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-primary px-3 py-2 text-primary-foreground text-sm",
					entry.pending && "opacity-60"
				)}
			>
				{entry.text}
			</li>
		);
	}
	if (entry.kind === "redirect") {
		const href = safeHttpUrl(entry.url);
		return (
			<li className="me-10 justify-self-start text-sm">
				{href ? (
					<a
						className="text-primary underline underline-offset-2"
						href={href}
						rel="noopener noreferrer"
						target="_blank"
					>
						{entry.newTab
							? copy("openLink", "Open link")
							: copy("redirectsTo", "Redirects to")}{" "}
						{href}
					</a>
				) : (
					<span className="text-status-destructive">
						{copy("badRedirect", "Invalid redirect URL")}
					</span>
				)}
			</li>
		);
	}
	const { message } = entry;
	const bubble =
		"me-10 justify-self-start rounded-2xl rounded-es-sm bg-muted px-3 py-2 text-sm";
	switch (message.type) {
		case "text":
			return (
				<li className={cn(bubble, "whitespace-normal break-words")}>
					{message.source === "ai" ? (
						<Badge className="mb-1" variant="outline">
							AI
						</Badge>
					) : null}
					<div>
						<RichText text={message.content} />
					</div>
				</li>
			);
		case "image": {
			const href = safeHttpUrl(message.url);
			return (
				<li className={bubble}>
					{href ? (
						<img
							alt={message.alt}
							className="max-h-48 rounded-lg"
							height={192}
							src={href}
							width={256}
						/>
					) : (
						copy("imageUnavailable", "Image unavailable")
					)}
				</li>
			);
		}
		case "video":
		case "embed": {
			const href = safeHttpUrl(message.url);
			return (
				<li className={bubble}>
					<span className="text-muted-foreground text-xs">
						{message.type === "video"
							? copy("video", "Video")
							: copy("embedContent", "Embedded content")}
					</span>{" "}
					{href ? (
						<a
							className="underline underline-offset-2"
							href={href}
							rel="noopener noreferrer"
							target="_blank"
						>
							{href}
						</a>
					) : null}
				</li>
			);
		}
		case "wait":
			return (
				<li className="justify-self-center text-muted-foreground text-xs">
					{copy("pauses", "Pauses")} {message.seconds}s
				</li>
			);
		default:
			return null;
	}
}

function PreviewInput({
	busy,
	copy,
	input,
	onSend,
}: {
	busy: boolean;
	copy: Copy;
	input: InputSpec;
	onSend: (value: ReplyValue, shown: string) => void;
}) {
	const [value, setValue] = useState("");
	const [chosen, setChosen] = useState<string[]>([]);
	const label = input.buttonLabel || copy("send", "Send");
	if (input.type === "choice_input") {
		if (!input.multiple) {
			return (
				<div className="flex flex-wrap gap-2" data-testid="preview-choices">
					{input.items.map((item) => (
						<Button
							disabled={busy}
							key={item.id}
							onClick={() => onSend(item.id, item.label)}
							size="sm"
							variant="outline"
						>
							{item.label}
						</Button>
					))}
				</div>
			);
		}
		return (
			<div className="grid gap-2">
				{input.items.map((item) => (
					<div className="flex items-center gap-2" key={item.id}>
						<Checkbox
							checked={chosen.includes(item.id)}
							id={`preview-choice-${item.id}`}
							onCheckedChange={(checked) =>
								setChosen((current) =>
									checked
										? [...current, item.id]
										: current.filter((id) => id !== item.id)
								)
							}
						/>
						<Label htmlFor={`preview-choice-${item.id}`}>{item.label}</Label>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={busy || chosen.length === 0}
					onClick={() =>
						onSend(
							chosen,
							input.items
								.filter((item) => chosen.includes(item.id))
								.map((item) => item.label)
								.join(", ")
						)
					}
					size="sm"
				>
					{label}
				</Button>
			</div>
		);
	}
	if (input.type === "rating_input") {
		const values =
			input.scale === "nps"
				? Array.from({ length: 11 }, (_, index) => index)
				: Array.from({ length: input.length }, (_, index) => index + 1);
		return (
			<div className="grid gap-1">
				<div
					aria-label={copy("rating", "Rating")}
					className="flex flex-wrap gap-1"
					role="group"
				>
					{values.map((score) => (
						<Button
							className="min-w-9"
							disabled={busy}
							key={score}
							onClick={() =>
								onSend(
									String(score),
									input.scale === "stars" ? "★".repeat(score) : String(score)
								)
							}
							size="sm"
							variant="outline"
						>
							{input.scale === "stars" ? `${score}★` : score}
						</Button>
					))}
				</div>
				{input.leftLabel || input.rightLabel ? (
					<div className="flex justify-between text-muted-foreground text-xs">
						<span>{input.leftLabel}</span>
						<span>{input.rightLabel}</span>
					</div>
				) : null}
			</div>
		);
	}
	const type = INPUT_TYPES[input.type] ?? "text";
	const submit = () => {
		const trimmed = value.trim();
		if (trimmed) {
			onSend(trimmed, trimmed);
		}
	};
	return (
		<form
			className="flex items-end gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<Label className="sr-only" htmlFor="preview-answer">
				{copy("yourAnswer", "Your answer")}
			</Label>
			{input.type === "text_input" && input.long ? (
				<Textarea
					className="min-h-16 flex-1"
					disabled={busy}
					id="preview-answer"
					onChange={(event) => setValue(event.target.value)}
					placeholder={input.placeholder}
					value={value}
				/>
			) : (
				<Input
					autoComplete="off"
					className="flex-1"
					disabled={busy}
					id="preview-answer"
					onChange={(event) => setValue(event.target.value)}
					placeholder={input.placeholder}
					type={
						input.type === "date_input" && input.withTime
							? "datetime-local"
							: type
					}
					value={value}
				/>
			)}
			<Button disabled={busy || !value.trim()} type="submit">
				{label}
			</Button>
		</form>
	);
}

const INPUT_TYPES: Partial<Record<InputSpec["type"], string>> = {
	text_input: "text",
	number_input: "number",
	email_input: "email",
	phone_input: "tel",
	url_input: "url",
	date_input: "date",
};

function PreviewState({ copy, turn }: { copy: Copy; turn: PreviewTurn }) {
	const variables = Object.entries(turn.variables);
	if (
		variables.length === 0 &&
		turn.logs.length === 0 &&
		turn.handoffs.length === 0
	) {
		return null;
	}
	return (
		<details className="rounded-lg border border-border p-2 text-xs">
			<summary className="cursor-pointer font-medium">
				{copy("previewState", "Variables and logs")}
			</summary>
			<dl className="mt-2 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-2 gap-y-1">
				{variables.map(([name, value]) => (
					<div className="contents" key={name}>
						<dt className="truncate font-mono text-muted-foreground">{name}</dt>
						<dd className="break-words">{value}</dd>
					</div>
				))}
			</dl>
			{turn.handoffs.map((handoff) => (
				<p className="mt-2" key={`${handoff.blockId}:${handoff.at}`}>
					{copy("handoffTo", "Handoff")}: {handoff.topic}
				</p>
			))}
			{turn.logs.map((log) => (
				<p
					className={
						log.level === "error"
							? "mt-1 text-status-destructive"
							: "mt-1 text-muted-foreground"
					}
					key={`${log.blockId}:${log.at}:${log.message}`}
				>
					{log.kind}: {log.message}
				</p>
			))}
		</details>
	);
}
