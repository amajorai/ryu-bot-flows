import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
	Spinner,
	Textarea,
} from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import { useEffect, useState } from "react";
import { blockCount, type Flow } from "../../sidecar/src/contracts.ts";
import { GENERATE_DESCRIPTION_LIMIT, generateFlow } from "./ai-generate.ts";
import type { Copy } from "./copy.ts";

/**
 * The single-purpose "Generate flow from description" action. The generated
 * flow is shown as a summary first and replaces the draft only when the owner
 * confirms; an invalid reply is reported and nothing is applied.
 */
export function GenerateFlowDialog({
	copy,
	current,
	open,
	onApply,
	onOpenChange,
}: {
	copy: Copy;
	current: Flow;
	open: boolean;
	onApply: (flow: Flow) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const tl = useLiteralMessages();
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [candidate, setCandidate] = useState<Flow | null>(null);

	useEffect(() => {
		if (open) {
			setError("");
			setCandidate(null);
		}
	}, [open]);

	const run = async () => {
		setBusy(true);
		setError("");
		setCandidate(null);
		try {
			const result = await generateFlow(description, current, tl);
			if (result.ok) {
				setCandidate(result.flow);
			} else {
				setError(result.message);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{copy("generateTitle", "Generate flow from a description")}
					</DialogTitle>
					<DialogDescription>
						{copy(
							"generateDescription",
							"Describe what the bot should ask and do. The result replaces the draft's groups, blocks, and variables after you review it; theme and settings stay as they are."
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-1.5">
					<Label htmlFor="generate-description">
						{copy("describeBot", "Description")}
					</Label>
					<Textarea
						disabled={busy}
						id="generate-description"
						maxLength={GENERATE_DESCRIPTION_LIMIT}
						onChange={(event) => {
							setDescription(event.target.value);
							setCandidate(null);
						}}
						placeholder={copy(
							"describePlaceholder",
							"Qualify leads for our design agency: ask for name, email, budget, and timeline, then offer a call for budgets over $10k."
						)}
						rows={5}
						value={description}
					/>
				</div>
				{error ? (
					<p className="text-sm text-status-destructive" role="alert">
						{error} {copy("nothingApplied", "Nothing was changed.")}
					</p>
				) : null}
				{candidate ? (
					<p className="rounded-md bg-muted p-3 text-sm" role="status">
						{copy("generatedSummary", "Generated a valid flow with")}{" "}
						{candidate.groups.length} {copy("groupsShort", "groups")},{" "}
						{blockCount(candidate)} {copy("blocksShort", "blocks")},{" "}
						{candidate.variables.length} {copy("variablesShort", "variables")}.
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
					{candidate ? (
						<Button
							onClick={() => {
								onApply(candidate);
								onOpenChange(false);
							}}
						>
							{copy("replaceDraft", "Replace draft")}
						</Button>
					) : (
						<Button
							disabled={busy || description.trim().length < 10}
							onClick={() => void run()}
						>
							{busy ? <Spinner className="size-4" /> : null}
							{copy("generate", "Generate flow")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
