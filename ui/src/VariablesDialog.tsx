import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Switch,
} from "@ryu/blocks/companion/controls";
import { useEffect, useState } from "react";
import { BOT_LIMITS, type Flow } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import {
	addVariable,
	deleteVariable,
	isValidVariableName,
	renameVariable,
	updateVariable,
	variableUsage,
} from "./flow-model.ts";

/** Lists, renames, adds, deletes, and marks prefillable variables. */
export function VariablesDialog({
	copy,
	flow,
	open,
	onChange,
	onOpenChange,
}: {
	copy: Copy;
	flow: Flow;
	open: boolean;
	onChange: (flow: Flow) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const [newName, setNewName] = useState("");
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	useEffect(() => {
		if (open) {
			setNewName("");
			setDrafts({});
		}
	}, [open]);

	const nameError = (id: string, name: string): string | null => {
		if (!isValidVariableName(name)) {
			return copy(
				"variableNameRule",
				"Start with a letter or _, then use letters, digits, or _."
			);
		}
		if (
			flow.variables.some(
				(variable) => variable.id !== id && variable.name === name
			)
		) {
			return copy(
				"variableNameTaken",
				"Another variable already has this name."
			);
		}
		return null;
	};

	/**
	 * Renames commit on blur, Enter, or closing the dialog (never per keystroke,
	 * so a half-typed name never captures other `{{tokens}}`), and rewrite every
	 * `{{oldName}}` template in the same change.
	 */
	const commit = (variableId: string) => {
		const draft = drafts[variableId];
		setDrafts((current) => {
			const next = { ...current };
			delete next[variableId];
			return next;
		});
		if (draft !== undefined && !nameError(variableId, draft)) {
			onChange(renameVariable(flow, variableId, draft));
		}
	};

	const close = (nextOpen: boolean) => {
		if (!nextOpen) {
			let next = flow;
			for (const [variableId, draft] of Object.entries(drafts)) {
				next = renameVariable(next, variableId, draft);
			}
			if (next !== flow) {
				onChange(next);
			}
		}
		onOpenChange(nextOpen);
	};

	const add = () => {
		const name = newName.trim();
		if (!name) {
			return;
		}
		const result = addVariable(flow, name);
		if (result.variableId) {
			onChange(result.flow);
			setNewName("");
		}
	};

	return (
		<Dialog onOpenChange={close} open={open}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{copy("variables", "Variables")}</DialogTitle>
					<DialogDescription>
						{copy(
							"variablesDescription",
							"Variables hold answers and values. Insert them into messages with {{name}}. Prefilled variables can be set from the link or embed snippet, for example ?utm_source=newsletter."
						)}
					</DialogDescription>
				</DialogHeader>
				{flow.variables.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{copy("noVariables", "This bot has no variables yet.")}
					</p>
				) : (
					<ul className="grid gap-3" data-testid="variables-list">
						{flow.variables.map((variable) => {
							const draft = drafts[variable.id] ?? variable.name;
							const error =
								draft === variable.name ? null : nameError(variable.id, draft);
							const usage = variableUsage(flow, variable.id);
							return (
								<li
									className="grid gap-2 rounded-lg border border-border p-3"
									key={variable.id}
								>
									<div className="flex items-end gap-2">
										<div className="grid min-w-0 flex-1 gap-1.5">
											<Label htmlFor={`variable-${variable.id}`}>
												{copy("name", "Name")}
											</Label>
											<Input
												aria-invalid={error ? true : undefined}
												id={`variable-${variable.id}`}
												maxLength={64}
												onBlur={() => commit(variable.id)}
												onChange={(event) => {
													const value = event.target.value;
													setDrafts((current) => ({
														...current,
														[variable.id]: value,
													}));
												}}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														event.preventDefault();
														commit(variable.id);
													}
												}}
												value={draft}
											/>
										</div>
										<Button
											aria-label={`${copy("deleteVariable", "Delete variable")} ${variable.name}`}
											onClick={() =>
												onChange(deleteVariable(flow, variable.id))
											}
											size="sm"
											variant="ghost"
										>
											{copy("delete", "Delete")}
										</Button>
									</div>
									{error ? (
										<p className="text-status-destructive text-xs">{error}</p>
									) : null}
									{!error && draft !== variable.name && usage > 0 ? (
										<p className="text-muted-foreground text-xs">
											{copy(
												"renameRewrites",
												"Renaming also updates the {{name}} references in this bot."
											)}
										</p>
									) : null}
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<Switch
												aria-label={`${copy("prefill", "Prefill from link or embed")}: ${variable.name}`}
												checked={variable.hidden === true}
												id={`variable-hidden-${variable.id}`}
												onCheckedChange={(checked) =>
													onChange(
														updateVariable(flow, variable.id, {
															hidden: checked,
														})
													)
												}
											/>
											<Label htmlFor={`variable-hidden-${variable.id}`}>
												{copy("prefill", "Prefill from link or embed")}
											</Label>
										</div>
										<span className="text-muted-foreground text-xs">
											{usage === 0
												? copy("unused", "Not used yet")
												: `${copy("usedBy", "Used by")} ${usage} ${usage === 1 ? copy("blockOne", "block") : copy("blocksShort", "blocks")}`}
										</span>
									</div>
								</li>
							);
						})}
					</ul>
				)}
				<form
					className="flex items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						add();
					}}
				>
					<div className="grid flex-1 gap-1.5">
						<Label htmlFor="new-variable-name">
							{copy("newVariable", "New variable")}
						</Label>
						<Input
							id="new-variable-name"
							maxLength={64}
							onChange={(event) => setNewName(event.target.value)}
							placeholder="first_name"
							value={newName}
						/>
					</div>
					<Button
						disabled={
							!newName.trim() || flow.variables.length >= BOT_LIMITS.variables
						}
						type="submit"
						variant="outline"
					>
						{copy("add", "Add")}
					</Button>
				</form>
				<DialogFooter>
					<Button onClick={() => close(false)}>{copy("done", "Done")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
