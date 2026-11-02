import { RyuAppSection } from "@ryu/blocks/companion/app-ui";
import { Input, Label } from "@ryu/blocks/companion/controls";
import { useEffect, useId, useState } from "react";
import {
	BOT_LIMITS,
	type Flow,
	type Settings,
	type Theme,
} from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import {
	NumberField,
	SelectField,
	TextAreaField,
	TextField,
} from "./fields.tsx";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function SettingsPanel({
	copy,
	flow,
	name,
	slug,
	onFlowChange,
	onNameChange,
	onSlugChange,
}: {
	copy: Copy;
	flow: Flow;
	name: string;
	slug: string;
	onFlowChange: (flow: Flow) => void;
	onNameChange: (name: string) => void;
	onSlugChange: (slug: string) => void;
}) {
	const colorId = useId();
	const [accentDraft, setAccentDraft] = useState(flow.theme.accent);
	useEffect(() => {
		setAccentDraft((current) =>
			current.toLowerCase() === flow.theme.accent.toLowerCase()
				? current
				: flow.theme.accent
		);
	}, [flow.theme.accent]);
	const setTheme = (patch: Partial<Theme>) =>
		onFlowChange({ ...flow, theme: { ...flow.theme, ...patch } });
	const setSettings = (patch: Partial<Settings>) =>
		onFlowChange({ ...flow, settings: { ...flow.settings, ...patch } });
	const avatar = flow.theme.avatarUrl ?? "";
	return (
		<div
			className="mx-auto grid w-full max-w-2xl gap-6"
			data-testid="settings-panel"
		>
			<RyuAppSection title={copy("botSection", "Bot")}>
				<div className="grid gap-4">
					<TextField
						label={copy("botName", "Bot name")}
						maxLength={BOT_LIMITS.nameLength}
						onChange={onNameChange}
						value={name}
					/>
					<TextField
						hint={copy(
							"slugHint",
							"3–48 lowercase letters, digits, or hyphens. Changing it breaks links and embeds that use the old address."
						)}
						label={copy("publicLink", "Public link")}
						maxLength={48}
						onChange={(value) => onSlugChange(value.toLowerCase())}
						value={slug}
					/>
				</div>
			</RyuAppSection>
			<RyuAppSection title={copy("appearance", "Appearance")}>
				<div className="grid gap-4">
					<TextField
						hint={copy("displayNameHint", "Shown above the bot's messages.")}
						label={copy("displayName", "Display name")}
						maxLength={80}
						onChange={(botName) => setTheme({ botName })}
						value={flow.theme.botName}
					/>
					<div className="grid gap-1.5">
						<Label htmlFor={colorId}>{copy("accent", "Accent color")}</Label>
						<div className="flex items-center gap-2">
							<Input
								aria-label={copy("accentPicker", "Pick accent color")}
								className="h-9 w-14 p-1"
								onChange={(event) => setTheme({ accent: event.target.value })}
								type="color"
								value={
									HEX.test(flow.theme.accent) ? flow.theme.accent : "#2563eb"
								}
							/>
							<Input
								aria-invalid={HEX.test(accentDraft) ? undefined : true}
								className="max-w-32 font-mono"
								id={colorId}
								maxLength={7}
								onChange={(event) => {
									const value = event.target.value.trim();
									setAccentDraft(value);
									if (HEX.test(value)) {
										setTheme({ accent: value });
									}
								}}
								placeholder="#2563eb"
								value={accentDraft}
							/>
						</div>
					</div>
					<TextField
						hint={
							avatar && !avatar.startsWith("https://")
								? copy(
										"avatarHttps",
										"Avatars must use an https:// URL to be shown."
									)
								: copy(
										"avatarHint",
										"Optional square image shown next to the bot's messages."
									)
						}
						label={copy("avatarUrl", "Avatar URL")}
						maxLength={BOT_LIMITS.urlLength}
						onChange={(value) => {
							const { avatarUrl: _previous, ...rest } = flow.theme;
							onFlowChange({
								...flow,
								theme: value ? { ...rest, avatarUrl: value } : rest,
							});
						}}
						type="url"
						value={avatar}
					/>
					<SelectField
						label={copy("colorMode", "Color mode")}
						onChange={(mode) =>
							setTheme({
								mode: mode === "light" || mode === "dark" ? mode : "auto",
							})
						}
						options={[
							{
								value: "auto",
								label: copy("modeAuto", "Match the visitor's device"),
							},
							{ value: "light", label: copy("modeLight", "Light") },
							{ value: "dark", label: copy("modeDark", "Dark") },
						]}
						value={flow.theme.mode}
					/>
					<NumberField
						hint={copy(
							"typingHint",
							"A short typing indicator before each bot message (0–1500 ms)."
						)}
						label={copy("typingDelay", "Typing delay (ms)")}
						max={1500}
						min={0}
						onChange={(value) =>
							setTheme({
								typingDelayMs: Math.round(
									Math.min(1500, Math.max(0, value ?? 0))
								),
							})
						}
						step={100}
						value={flow.theme.typingDelayMs}
					/>
				</div>
			</RyuAppSection>
			<RyuAppSection title={copy("behaviour", "Conversation")}>
				<div className="grid gap-4">
					<TextAreaField
						label={copy("invalidReply", "Invalid answer message")}
						maxLength={500}
						onChange={(invalidReplyMessage) =>
							setSettings({ invalidReplyMessage })
						}
						rows={2}
						value={flow.settings.invalidReplyMessage}
					/>
					<TextAreaField
						hint={copy(
							"closedHint",
							"Shown on the public link while the bot is unpublished."
						)}
						label={copy("closedMessage", "Closed message")}
						maxLength={500}
						onChange={(closedMessage) => setSettings({ closedMessage })}
						rows={2}
						value={flow.settings.closedMessage}
					/>
				</div>
			</RyuAppSection>
			<RyuAppSection title={copy("aiBudget", "AI budget")}>
				<p className="text-muted-foreground text-sm">
					{copy(
						"aiBudgetDescription",
						"AI reply blocks use this node's models, billed to the node owner. When a limit is reached, the block shows its fallback message and the conversation continues."
					)}
				</p>
				<div className="grid gap-4 sm:grid-cols-2">
					<NumberField
						label={copy("aiPerConversation", "AI replies per conversation")}
						max={20}
						min={0}
						onChange={(value) =>
							setSettings({
								aiTurnsPerConversation: Math.round(
									Math.min(20, Math.max(0, value ?? 0))
								),
							})
						}
						value={flow.settings.aiTurnsPerConversation}
					/>
					<NumberField
						label={copy("aiPerDay", "AI replies per day")}
						max={5000}
						min={0}
						onChange={(value) =>
							setSettings({
								aiTurnsPerDay: Math.round(
									Math.min(5000, Math.max(0, value ?? 0))
								),
							})
						}
						value={flow.settings.aiTurnsPerDay}
					/>
				</div>
			</RyuAppSection>
		</div>
	);
}
