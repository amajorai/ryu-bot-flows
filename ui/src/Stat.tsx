/** One summary figure (count, rate) in a small card. */
export function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-border bg-card p-3">
			<p className="font-medium font-mono text-xl tabular-nums">{value}</p>
			<p className="mt-0.5 text-muted-foreground text-xs">{label}</p>
		</div>
	);
}
