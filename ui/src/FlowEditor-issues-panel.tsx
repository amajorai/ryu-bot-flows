import { Button } from "@ryu/blocks/companion/controls";
import type { ReactNode } from "react";
import type { Flow, FlowIssue } from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import { BLOCK_LABELS, findBlock, type IssueIndex } from "./flow-model.ts";

export function IssuesPanel({
	copy,
	flow,
	issues,
	open,
	onFocus,
	onToggle,
}: {
	copy: Copy;
	flow: Flow;
	issues: IssueIndex;
	open: boolean;
	onFocus: (issue: FlowIssue) => void;
	onToggle: () => void;
}) {
	const describe = (issue: FlowIssue): ReactNode => {
		if (issue.blockId) {
			const located = findBlock(flow, issue.blockId);
			if (located) {
				return `${located.group.title || copy("untitledGroup", "Untitled group")} · ${BLOCK_LABELS[located.block.type]}`;
			}
		}
		if (issue.groupId) {
			return (
				flow.groups.find((group) => group.id === issue.groupId)?.title ?? ""
			);
		}
		return copy("bot", "Bot");
	};
	if (issues.all.length === 0) {
		return (
			<p
				className="rounded-lg border border-border bg-card/95 px-3 py-1.5 text-status-success text-xs shadow-sm"
				data-testid="validation-summary"
				role="status"
			>
				{copy("noIssues", "No problems found")}
			</p>
		);
	}
	return (
		<div className="grid max-w-[min(22rem,calc(100vw-2rem))] justify-items-end gap-2">
			{open ? (
				<ul
					aria-label={copy("problems", "Problems")}
					className="grid max-h-64 w-full gap-1 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-sm"
				>
					{issues.all.map((issue, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: issues may repeat a message
						<li key={index}>
							<button
								className="grid w-full gap-0.5 rounded-md border-0 bg-transparent px-2 py-1 text-start text-xs hover:bg-muted"
								data-slot="issue-row"
								onClick={() => onFocus(issue)}
								type="button"
							>
								<span className="text-muted-foreground">{describe(issue)}</span>
								<span
									className={
										issue.severity === "error"
											? "text-status-destructive"
											: "text-status-warning"
									}
								>
									{issue.message}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
			<Button
				aria-expanded={open}
				data-testid="validation-summary"
				onClick={onToggle}
				size="sm"
				variant="outline"
			>
				{issues.errors > 0 ? (
					<span className="text-status-destructive">
						{issues.errors}{" "}
						{issues.errors === 1
							? copy("error", "error")
							: copy("errors", "errors")}
					</span>
				) : null}
				{issues.warnings > 0 ? (
					<span className="text-status-warning">
						{issues.warnings}{" "}
						{issues.warnings === 1
							? copy("warning", "warning")
							: copy("warnings", "warnings")}
					</span>
				) : null}
			</Button>
		</div>
	);
}
