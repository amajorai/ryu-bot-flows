import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Spinner,
} from "@ryu/blocks/companion/controls";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useEffect, useState } from "react";
import type {
	BotDocument,
	BotTemplate,
	BotTemplateId,
} from "../../sidecar/src/contracts.ts";
import { botFlowsApi, errorMessage } from "./api.ts";
import type { Copy } from "./copy.ts";

export function CreateBotDialog({
	copy,
	open,
	templates,
	templatesError,
	onCreated,
	onOpenChange,
	onRetryTemplates,
}: {
	copy: Copy;
	open: boolean;
	templates: BotTemplate[];
	templatesError: string;
	onCreated: (bot: BotDocument) => void;
	onOpenChange: (open: boolean) => void;
	onRetryTemplates: () => void;
}) {
	const [name, setName] = useState("");
	const [nameTouched, setNameTouched] = useState(false);
	const [templateId, setTemplateId] = useState<BotTemplateId>("blank");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (open) {
			setName("");
			setNameTouched(false);
			setTemplateId("blank");
			setError("");
		}
	}, [open]);

	const ordered = [...templates].sort((left, right) => {
		if (left.id === "blank") {
			return -1;
		}
		return right.id === "blank" ? 1 : 0;
	});
	const selected = templates.find((template) => template.id === templateId);
	const effectiveName =
		name.trim() || (selected && selected.id !== "blank" ? selected.name : "");

	const choose = (template: BotTemplate) => {
		setTemplateId(template.id);
		setError("");
		if (!nameTouched) {
			setName(template.id === "blank" ? "" : template.name);
		}
	};

	const create = async () => {
		setBusy(true);
		setError("");
		try {
			const bot = await botFlowsApi.create({
				name: effectiveName || "Untitled bot",
				templateId,
			});
			onCreated(bot);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{copy("newBot", "New bot")}</DialogTitle>
					<DialogDescription>
						{copy(
							"createDescription",
							"Pick a preconfigured flow to edit, or start from a blank bot."
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-1.5">
					<Label htmlFor="new-bot-name">{copy("botName", "Bot name")}</Label>
					<Input
						id="new-bot-name"
						maxLength={120}
						onChange={(event) => {
							setName(event.target.value);
							setNameTouched(true);
						}}
						placeholder={copy("botNamePlaceholder", "Support assistant")}
						value={name}
					/>
				</div>
				<fieldset className="grid gap-2">
					<legend className="mb-2 font-medium text-sm">
						{copy("startFrom", "Start from")}
					</legend>
					{templatesError ? (
						<div
							className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm"
							role="alert"
						>
							<span>{templatesError}</span>
							<Button onClick={onRetryTemplates} size="sm" variant="outline">
								{copy("retry", "Retry")}
							</Button>
						</div>
					) : null}
					{templates.length === 0 && !templatesError ? (
						<p
							className="flex items-center gap-2 text-muted-foreground text-sm"
							role="status"
						>
							<Spinner className="size-4" />
							{copy("loadingTemplates", "Loading templates…")}
						</p>
					) : null}
					<div
						className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
						data-testid="template-gallery"
					>
						{ordered.map((template) => (
							<button
								aria-pressed={template.id === templateId}
								className={cn(
									"flex min-h-28 flex-col items-start gap-1.5 rounded-lg border border-border bg-card p-3 text-start transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
									template.id === templateId &&
										"border-primary bg-primary/5 ring-1 ring-primary"
								)}
								data-slot="template-card"
								key={template.id}
								onClick={() => choose(template)}
								type="button"
							>
								<span className="flex w-full items-center justify-between gap-2">
									<span className="font-medium text-sm">{template.name}</span>
									<Badge variant="outline">{template.category}</Badge>
								</span>
								<span className="line-clamp-3 text-muted-foreground text-xs">
									{template.description}
								</span>
								<span className="mt-auto font-mono text-muted-foreground text-xs tabular-nums">
									{template.blockCount} {copy("blocksShort", "blocks")} ·{" "}
									{template.groupCount} {copy("groupsShort", "groups")}
								</span>
							</button>
						))}
					</div>
				</fieldset>
				{error ? (
					<p className="text-sm text-status-destructive" role="alert">
						{error}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={busy}
						onClick={() => onOpenChange(false)}
						variant="outline"
					>
						{copy("cancel", "Cancel")}
					</Button>
					<Button
						disabled={busy || templates.length === 0}
						onClick={() => void create()}
					>
						{busy ? <Spinner className="size-4" /> : null}
						{copy("createBot", "Create bot")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
