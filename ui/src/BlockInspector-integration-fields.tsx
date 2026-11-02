import { Button, Input } from "@ryu/blocks/companion/controls";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import {
	type BlockOf,
	BOT_LIMITS,
	HTTP_METHODS,
} from "../../sidecar/src/contracts.ts";
import {
	clamp,
	type FieldProps,
	optional,
	TemplateHint,
	withOptional,
} from "./BlockInspector-shared.tsx";
import {
	NumberField,
	SelectField,
	SwitchField,
	TextAreaField,
	TextField,
	VariableSelect,
} from "./fields.tsx";

export function AiReplyFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"ai_reply">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"aiBilling",
					"Replies use this Ryu node's model access, so the node owner pays for them. Visitors can't change the model or these instructions."
				)}
			</p>
			<TextAreaField
				label={copy("instructions", "Instructions (system prompt)")}
				maxLength={4000}
				onChange={(instructions) => set({ ...block, instructions })}
				rows={4}
				value={block.instructions}
			/>
			<TextAreaField
				hint={<TemplateHint copy={copy} />}
				label={copy("promptTemplate", "Prompt")}
				maxLength={BOT_LIMITS.aiPromptChars}
				onChange={(promptTemplate) => set({ ...block, promptTemplate })}
				rows={3}
				value={block.promptTemplate}
			/>
			<SwitchField
				checked={block.useKnowledge}
				description={copy(
					"useKnowledgeHint",
					"Adds the most relevant Knowledge articles to the prompt."
				)}
				label={copy("useKnowledge", "Use knowledge articles")}
				onChange={(useKnowledge) => set({ ...block, useKnowledge })}
			/>
			<NumberField
				label={copy("maxChars", "Maximum reply length (characters)")}
				max={BOT_LIMITS.aiMaxChars}
				min={50}
				onChange={(value) =>
					set({
						...block,
						maxChars: Math.round(
							clamp(value ?? 800, 50, BOT_LIMITS.aiMaxChars)
						),
					})
				}
				value={block.maxChars}
			/>
			<VariableSelect
				allowNone
				flow={flow}
				label={copy("saveReplyTo", "Save reply to")}
				onChange={(saveTo) => set(withOptional(block, "saveTo", saveTo))}
				onCreate={() =>
					createVariable("ai_reply", (saveTo) => ({ ...block, saveTo }))
				}
				value={block.saveTo}
			/>
			<TextField
				hint={copy(
					"fallbackHint",
					"Shown when the model fails or the AI budget is used up."
				)}
				label={copy("fallbackMessage", "Fallback message")}
				maxLength={500}
				onChange={(value) =>
					set(withOptional(block, "fallbackMessage", optional(value)))
				}
				value={block.fallbackMessage ?? ""}
			/>
		</>
	);
}

export function HttpRequestFields({
	block,
	copy,
	createVariable,
	flow,
	set,
}: FieldProps<BlockOf<"http_request">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"httpSafety",
					"Requests run on this Ryu node over https only. Private and local network addresses are refused, redirects are not followed, and failures are logged without stopping the conversation."
				)}
			</p>
			<SelectField
				label={copy("method", "Method")}
				onChange={(value) => {
					const method = HTTP_METHODS.find((candidate) => candidate === value);
					if (method) {
						set({ ...block, method });
					}
				}}
				options={HTTP_METHODS.map((method) => ({
					value: method,
					label: method,
				}))}
				value={block.method}
			/>
			<TextField
				hint={<TemplateHint copy={copy} />}
				label={copy("url", "URL")}
				maxLength={BOT_LIMITS.urlLength}
				onChange={(url) => set({ ...block, url })}
				type="url"
				value={block.url}
			/>
			<fieldset className="grid gap-2">
				<legend className="mb-1 font-medium text-sm">
					{copy("headers", "Headers")}
				</legend>
				{block.headers.map((header, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: headers are positional
					<div className="flex items-center gap-2" key={index}>
						<Input
							aria-label={`${copy("headerName", "Header name")} ${index + 1}`}
							maxLength={100}
							onChange={(event) =>
								set({
									...block,
									headers: block.headers.map((item, itemIndex) =>
										itemIndex === index
											? { ...item, name: event.target.value }
											: item
									),
								})
							}
							value={header.name}
						/>
						<Input
							aria-label={`${copy("headerValue", "Header value")} ${index + 1}`}
							maxLength={2000}
							onChange={(event) =>
								set({
									...block,
									headers: block.headers.map((item, itemIndex) =>
										itemIndex === index
											? { ...item, value: event.target.value }
											: item
									),
								})
							}
							value={header.value}
						/>
						<Button
							aria-label={`${copy("removeHeader", "Remove header")} ${index + 1}`}
							onClick={() =>
								set({
									...block,
									headers: block.headers.filter(
										(_, itemIndex) => itemIndex !== index
									),
								})
							}
							size="icon-sm"
							variant="ghost"
						>
							×
						</Button>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={block.headers.length >= BOT_LIMITS.httpHeaders}
					onClick={() =>
						set({
							...block,
							headers: [...block.headers, { name: "X-Header", value: "" }],
						})
					}
					size="sm"
					variant="outline"
				>
					{copy("addHeader", "Add header")}
				</Button>
			</fieldset>
			{block.method === "GET" ? null : (
				<TextAreaField
					hint={copy(
						"bodyHint",
						"Variables inserted into the body are JSON-escaped."
					)}
					label={copy("body", "Body")}
					maxLength={20_000}
					onChange={(body) => set({ ...block, body })}
					rows={4}
					value={block.body}
				/>
			)}
			<fieldset className="grid gap-2">
				<legend className="mb-1 font-medium text-sm">
					{copy("responseMapping", "Save from the response")}
				</legend>
				{block.responseMapping.map((mapping, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: mappings are positional
					<div className="flex items-center gap-2" key={index}>
						<Input
							aria-label={`${copy("responsePath", "Response path")} ${index + 1}`}
							maxLength={200}
							onChange={(event) =>
								set({
									...block,
									responseMapping: block.responseMapping.map(
										(item, itemIndex) =>
											itemIndex === index
												? { ...item, path: event.target.value }
												: item
									),
								})
							}
							placeholder="data.items[0].id"
							value={mapping.path}
						/>
						<NativeSelect
							aria-label={`${copy("responseVariable", "Variable")} ${index + 1}`}
							className="w-40"
							onChange={(event) =>
								set({
									...block,
									responseMapping: block.responseMapping.map(
										(item, itemIndex) =>
											itemIndex === index
												? { ...item, variableId: event.target.value }
												: item
									),
								})
							}
							value={mapping.variableId}
						>
							{flow.variables.map((variable) => (
								<NativeSelectOption key={variable.id} value={variable.id}>
									{variable.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<Button
							aria-label={`${copy("removeMapping", "Remove mapping")} ${index + 1}`}
							onClick={() =>
								set({
									...block,
									responseMapping: block.responseMapping.filter(
										(_, itemIndex) => itemIndex !== index
									),
								})
							}
							size="icon-sm"
							variant="ghost"
						>
							×
						</Button>
					</div>
				))}
				<Button
					className="w-fit"
					disabled={block.responseMapping.length >= BOT_LIMITS.responseMappings}
					onClick={() => {
						const first = flow.variables[0];
						if (first) {
							set({
								...block,
								responseMapping: [
									...block.responseMapping,
									{ path: "id", variableId: first.id },
								],
							});
						} else {
							createVariable("response", (variableId) => ({
								...block,
								responseMapping: [
									...block.responseMapping,
									{ path: "id", variableId },
								],
							}));
						}
					}}
					size="sm"
					variant="outline"
				>
					{copy("addMapping", "Add mapping")}
				</Button>
			</fieldset>
			<NumberField
				label={copy("timeout", "Timeout (ms)")}
				max={BOT_LIMITS.httpTimeoutMs}
				min={500}
				onChange={(value) =>
					set({
						...block,
						timeoutMs: Math.round(
							clamp(value ?? 5000, 500, BOT_LIMITS.httpTimeoutMs)
						),
					})
				}
				step={500}
				value={block.timeoutMs}
			/>
		</>
	);
}

export function HandoffFields({
	block,
	copy,
	set,
}: FieldProps<BlockOf<"handoff">>) {
	return (
		<>
			<p className="rounded-md bg-muted p-3 text-muted-foreground text-xs">
				{copy(
					"handoffHint",
					"Published bots emit a handoff.requested event. Build a Workflow with an event trigger to open a ticket, notify a channel, or add a CRM contact."
				)}
			</p>
			<TextField
				hint={<TemplateHint copy={copy} />}
				label={copy("topic", "Topic")}
				maxLength={80}
				onChange={(topic) => set({ ...block, topic })}
				value={block.topic}
			/>
			<TextAreaField
				hint={<TemplateHint copy={copy} />}
				label={copy("summary", "Summary")}
				maxLength={2000}
				onChange={(summaryTemplate) => set({ ...block, summaryTemplate })}
				rows={3}
				value={block.summaryTemplate}
			/>
			<TextAreaField
				label={copy("visitorMessage", "Message to the visitor")}
				maxLength={2000}
				onChange={(message) => set({ ...block, message })}
				rows={2}
				value={block.message}
			/>
		</>
	);
}
