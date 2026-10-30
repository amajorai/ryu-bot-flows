import { RyuAppSection } from "@ryu/blocks/companion/app-ui";
import { Button, Input, Label, Spinner } from "@ryu/blocks/companion/controls";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@ryu/ui/components/tabs.tsx";
import { useEffect, useState } from "react";
import type { Flow } from "../../sidecar/src/contracts.ts";
import {
	type EmbedMode,
	embedSnippet,
	normalizeEmbedOrigin,
	type ShareLocation,
	shareLocationForBot,
} from "./api.ts";
import type { Copy } from "./copy.ts";

const MODES: { description: string; key: EmbedMode; label: string }[] = [
	{
		key: "standard",
		label: "Standard",
		description: "Shows the chat inside a container on your page.",
	},
	{
		key: "popup",
		label: "Popup",
		description:
			"Opens the chat in a centered window when the page loads; call open() to show it later.",
	},
	{
		key: "bubble",
		label: "Bubble",
		description: "Adds a floating chat button to the corner of every page.",
	},
];

function isEmbedMode(value: unknown): value is EmbedMode {
	return value === "standard" || value === "popup" || value === "bubble";
}

export function SharePanel({
	copy,
	flow,
	published,
	slug,
	onFlowChange,
}: {
	copy: Copy;
	flow: Flow;
	published: boolean;
	slug: string;
	onFlowChange: (flow: Flow) => void;
}) {
	const [share, setShare] = useState<ShareLocation | null>(null);
	const [mode, setMode] = useState<EmbedMode>("bubble");
	const [notice, setNotice] = useState("");
	const [originDraft, setOriginDraft] = useState("");
	const [originError, setOriginError] = useState("");

	useEffect(() => {
		let active = true;
		setShare(null);
		void shareLocationForBot(slug).then((next) => {
			if (active) {
				setShare(next);
			}
		});
		return () => {
			active = false;
		};
	}, [slug]);

	const base = share?.url ?? share?.path ?? "";
	const hiddenNames = flow.variables
		.filter((variable) => variable.hidden)
		.map((variable) => variable.name);

	const copyText = async (value: string, done: string) => {
		setNotice("");
		if (!navigator.clipboard?.writeText) {
			setNotice(copy("copyManually", "Select the text and copy it."));
			return;
		}
		try {
			await navigator.clipboard.writeText(value);
			setNotice(done);
		} catch {
			setNotice(copy("copyManually", "Select the text and copy it."));
		}
	};

	const origins = flow.settings.allowedEmbedOrigins;
	const setOrigins = (allowedEmbedOrigins: string[]) =>
		onFlowChange({
			...flow,
			settings: { ...flow.settings, allowedEmbedOrigins },
		});

	const addOrigin = () => {
		const origin = normalizeEmbedOrigin(originDraft);
		if (!origin) {
			setOriginError(
				copy(
					"originInvalid",
					"Enter an https origin such as https://example.com, without a path."
				)
			);
			return;
		}
		if (origins.includes(origin)) {
			setOriginError(copy("originDuplicate", "That site is already allowed."));
			return;
		}
		if (origins.length >= 20) {
			setOriginError(copy("originLimit", "You can allow up to 20 sites."));
			return;
		}
		setOrigins([...origins, origin]);
		setOriginDraft("");
		setOriginError("");
	};

	return (
		<div
			className="mx-auto grid w-full max-w-3xl gap-6"
			data-testid="share-panel"
		>
			<RyuAppSection title={copy("publicLinkTitle", "Public link")}>
				<p className="text-muted-foreground text-sm">
					{published
						? copy(
								"sharePublished",
								"Anyone with the link can chat with the published version of this bot."
							)
						: copy(
								"shareDraft",
								"Publish the bot to open its link. Until then, the link shows the closed message."
							)}
				</p>
				<div className="flex flex-wrap gap-2">
					<Label className="sr-only" htmlFor="bot-share-link">
						{copy("publicLinkTitle", "Public link")}
					</Label>
					<Input
						className="min-w-0 flex-1 font-mono text-xs"
						id="bot-share-link"
						readOnly
						value={share ? base : copy("loadingLink", "Loading link…")}
					/>
					<Button
						disabled={!share}
						onClick={() =>
							void copyText(base, copy("linkCopied", "Link copied."))
						}
					>
						{copy("copyLink", "Copy link")}
					</Button>
					{share?.url && published ? (
						<a
							className="inline-flex items-center px-2 text-primary text-sm underline underline-offset-4"
							href={share.url}
							rel="noopener"
							target="_blank"
						>
							{copy("openBot", "Open")}
						</a>
					) : null}
				</div>
				{share && !share.url ? (
					<p className="text-muted-foreground text-xs">
						{copy(
							"noOrigin",
							"No reachable web address is configured for this node. Combine the path with your Ryu node's address."
						)}
					</p>
				) : null}
				{hiddenNames.length > 0 ? (
					<p className="text-muted-foreground text-xs">
						{copy(
							"prefillHint",
							"Prefill variables by adding them to the link, for example"
						)}{" "}
						<code className="font-mono">
							?{hiddenNames.map((name) => `${name}=…`).join("&")}
						</code>
					</p>
				) : null}
			</RyuAppSection>
			<RyuAppSection title={copy("embed", "Embed on a website")}>
				<Tabs
					onValueChange={(value) => {
						if (isEmbedMode(value)) {
							setMode(value);
						}
					}}
					value={mode}
				>
					<TabsList
						aria-label={copy("embedModes", "Embed modes")}
						manageLayout={false}
						persistLayout={false}
					>
						{MODES.map((item) => (
							<TabsTrigger key={item.key} value={item.key}>
								{copy(`mode.${item.key}`, item.label)}
							</TabsTrigger>
						))}
					</TabsList>
					{MODES.map((item) => {
						const snippet = share
							? embedSnippet(item.key, base, slug, hiddenNames)
							: "";
						return (
							<TabsContent
								className="grid gap-2 pt-2"
								key={item.key}
								value={item.key}
							>
								<p className="text-muted-foreground text-sm">
									{copy(`mode.${item.key}.description`, item.description)}
								</p>
								<pre
									aria-label={`${item.label} ${copy("snippet", "snippet")}`}
									className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted p-3 font-mono text-xs"
									data-testid={`snippet-${item.key}`}
								>
									{share ? snippet : <Spinner className="size-4" />}
								</pre>
								<Button
									className="w-fit"
									disabled={!share}
									onClick={() =>
										void copyText(
											snippet,
											copy("snippetCopied", "Snippet copied.")
										)
									}
									variant="outline"
								>
									{copy("copySnippet", "Copy snippet")}
								</Button>
							</TabsContent>
						);
					})}
				</Tabs>
			</RyuAppSection>
			<RyuAppSection title={copy("allowedOrigins", "Allowed websites")}>
				<p className="text-muted-foreground text-sm">
					{copy(
						"allowedOriginsDescription",
						"Only these sites can embed the bot. Other sites are blocked from framing it. Save and publish to apply changes."
					)}
				</p>
				{origins.length === 0 ? (
					<p className="rounded-md bg-muted p-3 text-muted-foreground text-sm">
						{copy(
							"noOrigins",
							"No sites are allowed yet, so embeds are blocked. The public link still works."
						)}
					</p>
				) : (
					<ul className="grid gap-1" data-testid="allowed-origins">
						{origins.map((origin) => (
							<li
								className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
								key={origin}
							>
								<span className="truncate font-mono text-xs">{origin}</span>
								<Button
									aria-label={`${copy("removeOrigin", "Remove")} ${origin}`}
									onClick={() =>
										setOrigins(origins.filter((item) => item !== origin))
									}
									size="sm"
									variant="ghost"
								>
									{copy("removeOrigin", "Remove")}
								</Button>
							</li>
						))}
					</ul>
				)}
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						addOrigin();
					}}
				>
					<div className="grid min-w-0 flex-1 gap-1.5">
						<Label htmlFor="new-embed-origin">
							{copy("addOriginLabel", "Website origin")}
						</Label>
						<Input
							aria-invalid={originError ? true : undefined}
							id="new-embed-origin"
							onChange={(event) => {
								setOriginDraft(event.target.value);
								setOriginError("");
							}}
							placeholder="https://example.com"
							type="url"
							value={originDraft}
						/>
					</div>
					<Button
						disabled={!originDraft.trim()}
						type="submit"
						variant="outline"
					>
						{copy("allow", "Allow")}
					</Button>
				</form>
				{originError ? (
					<p className="text-status-destructive text-xs" role="alert">
						{originError}
					</p>
				) : null}
			</RyuAppSection>
			{notice ? (
				<p className="text-sm text-status-success" role="status">
					{notice}
				</p>
			) : null}
		</div>
	);
}
