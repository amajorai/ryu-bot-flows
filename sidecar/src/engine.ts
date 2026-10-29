/**
 * The Bot Flows conversation engine.
 *
 * Pure TypeScript: no Bun, Node, network, clock, or randomness of its own.
 * Everything effectful (`now`, `random`, the model, HTTP, knowledge, events)
 * is injected through `EngineDeps`, so a turn is deterministic given its deps.
 *
 * Traversal: blocks run in order within a group. A block with a matching
 * outgoing edge (by choice item, branch, or plain edge) jumps to the edge's
 * group; otherwise execution falls through to the next block. Running past
 * the last block of a group completes the conversation. Input blocks pause
 * the turn until the visitor replies.
 */
import { z } from "zod";
import {
	type Answer,
	type Block,
	type BlockOf,
	BOT_LIMITS,
	type BotMessage,
	type ConditionRule,
	DATE_PATTERN,
	DATE_TIME_PATTERN,
	type Edge,
	type EdgeBranch,
	type Flow,
	type Group,
	type InputBlock,
	type InputSpec,
	isInputBlock,
	type RedirectAction,
	type ReplyValue,
	type ResultLog,
	type SessionState,
} from "./contracts.ts";
import { renderTemplate, type TemplateEscape } from "./template.ts";

export interface AiRequest {
	maxChars: number;
	prompt: string;
	system: string;
}

export interface HttpRequestSpec {
	body: string | null;
	headers: Record<string, string>;
	method: string;
	timeoutMs: number;
	url: string;
}

export interface HttpResponseSpec {
	body: string;
	status: number;
}

export type EngineEvent =
	| { type: "conversation.completed"; state: SessionState }
	| {
			type: "handoff.requested";
			topic: string;
			summary: string;
			state: SessionState;
	  };

export interface EngineDeps {
	/** Completes a prompt with the owner's configured model. */
	ai?: (request: AiRequest) => Promise<string>;
	/** Spends one unit of the bot's daily AI budget; false when it is used up. */
	consumeAiTurn?: () => boolean;
	/** Best-effort event sink. Errors are swallowed. */
	emit?: (event: EngineEvent) => Promise<void> | void;
	/** Runs an `http_request` block (the SSRF guard lives behind this). */
	http?: (request: HttpRequestSpec) => Promise<HttpResponseSpec>;
	/** Returns knowledge snippets relevant to the query, best first. */
	knowledge?: (query: string) => string[];
	now: () => Date;
	/** Uniform random number in [0, 1). */
	random: () => number;
}

export interface Turn {
	done: boolean;
	input: InputSpec | null;
	messages: BotMessage[];
	redirect: RedirectAction | null;
	state: SessionState;
}

const DEFAULT_AI_FALLBACK =
	"Sorry, I can't answer that right now. Let's keep going.";
const DEFAULT_AI_SYSTEM =
	"You are a helpful assistant embedded in a website chat. Answer briefly and only from the provided context when it is given.";
const MAX_EVENTS = 500;
const MAX_VARIABLE_CHARS = 4000;

type StepResult =
	| { kind: "next" }
	| { kind: "edge"; edge: Edge | undefined }
	| { kind: "group"; groupId: string }
	| { kind: "stop" };

interface Cursor {
	blockIndex: number;
	groupId: string;
}

/** One turn's mutable context. */
class TurnContext {
	readonly messages: BotMessage[] = [];
	input: InputSpec | null = null;
	redirect: RedirectAction | null = null;
	private sequence = 0;
	readonly flow: Flow;
	readonly state: SessionState;
	readonly deps: EngineDeps;
	readonly groups: Map<string, Group>;
	readonly edges: Map<string, Edge>;
	readonly variableIdsByName: Map<string, string>;

	constructor(flow: Flow, state: SessionState, deps: EngineDeps) {
		this.flow = flow;
		this.state = state;
		this.deps = deps;
		this.groups = new Map(flow.groups.map((group) => [group.id, group]));
		this.edges = new Map(flow.edges.map((edge) => [edgeKey(edge.from), edge]));
		this.variableIdsByName = new Map(
			flow.variables.map((variable) => [variable.name, variable.id])
		);
	}

	at(): string {
		return this.deps.now().toISOString();
	}

	messageId(blockId: string): string {
		this.sequence += 1;
		return `${blockId}:${this.state.turns}:${this.sequence}`;
	}

	render(template: string, escaping: TemplateEscape = "none"): string {
		return renderTemplate(
			template,
			(name) => {
				const id = this.variableIdsByName.get(name);
				return id ? this.state.variables[id] : undefined;
			},
			escaping
		);
	}

	setVariable(variableId: string | undefined, value: string | null): void {
		if (!variableId) {
			return;
		}
		if (value === null) {
			delete this.state.variables[variableId];
			return;
		}
		this.state.variables[variableId] = value.slice(0, MAX_VARIABLE_CHARS);
	}

	botText(
		blockId: string,
		content: string,
		source: "bot" | "ai" | "system" = "bot"
	): void {
		if (!content.trim()) {
			return;
		}
		this.messages.push({
			type: "text",
			id: this.messageId(blockId),
			content,
			source,
		});
		this.transcript("bot", content, blockId);
	}

	transcript(from: "bot" | "visitor", text: string, blockId?: string): void {
		this.state.transcript.push({ from, text, at: this.at(), blockId });
		if (this.state.transcript.length > BOT_LIMITS.transcriptEntries) {
			this.state.transcript.splice(
				0,
				this.state.transcript.length - BOT_LIMITS.transcriptEntries
			);
		}
	}

	log(
		blockId: string,
		kind: ResultLog["kind"],
		level: ResultLog["level"],
		message: string
	): void {
		this.state.logs.push({
			blockId,
			kind,
			level,
			message: message.slice(0, 500),
			at: this.at(),
		});
		if (this.state.logs.length > BOT_LIMITS.logEntries) {
			this.state.logs.splice(0, this.state.logs.length - BOT_LIMITS.logEntries);
		}
	}

	event(blockId: string, type: "reached" | "answered"): void {
		// Events are deduplicated for analytics; the position is not, so a
		// flow that loops still reports where the visitor actually is.
		this.state.lastBlockId = blockId;
		const seen = this.state.events.some(
			(entry) => entry.blockId === blockId && entry.type === type
		);
		if (!seen && this.state.events.length < MAX_EVENTS) {
			this.state.events.push({ blockId, type, at: this.at() });
		}
	}

	edge(
		blockId: string,
		itemId?: string,
		branch?: EdgeBranch
	): Edge | undefined {
		return this.edges.get(edgeKey({ blockId, itemId, branch }));
	}

	async emit(event: EngineEvent): Promise<void> {
		try {
			await this.deps.emit?.(event);
		} catch {
			// Events are best-effort; the conversation never fails because of them.
		}
	}

	toTurn(): Turn {
		return {
			messages: this.messages,
			input: this.input,
			redirect: this.redirect,
			done: this.state.done,
			state: this.state,
		};
	}
}

function edgeKey(from: Edge["from"]): string {
	return `${from.blockId}|${from.itemId ?? ""}|${from.branch ?? ""}`;
}

/** Strips owner-only fields from an input block before it reaches a visitor. */
export function toInputSpec(block: InputBlock): InputSpec {
	const { saveTo: _saveTo, retryMessage: _retryMessage, ...spec } = block;
	return spec;
}

/** Starts a conversation and runs it until the first input or the end. */
export async function startSession(
	flow: Flow,
	hidden: Record<string, string>,
	deps: EngineDeps,
	resultId: string
): Promise<Turn> {
	const startedAt = deps.now().toISOString();
	const state: SessionState = {
		version: 1,
		resultId,
		pending: null,
		variables: {},
		answers: [],
		transcript: [],
		logs: [],
		handoffs: [],
		events: [],
		lastBlockId: null,
		aiTurns: 0,
		turns: 0,
		done: false,
		startedAt,
		completedAt: null,
	};
	for (const variable of flow.variables) {
		const value = variable.hidden ? hidden[variable.name] : undefined;
		if (typeof value === "string" && value.trim()) {
			state.variables[variable.id] = value
				.trim()
				.slice(0, BOT_LIMITS.hiddenValueLength);
		}
	}
	const context = new TurnContext(flow, state, deps);
	await run(context, { groupId: flow.startGroupId, blockIndex: 0 });
	return context.toTurn();
}

/** Applies a visitor reply to the pending input and runs to the next input. */
export async function reply(
	flow: Flow,
	previous: SessionState,
	value: ReplyValue,
	deps: EngineDeps
): Promise<Turn> {
	const state = structuredClone(previous);
	const context = new TurnContext(flow, state, deps);
	if (state.done) {
		return context.toTurn();
	}
	state.turns += 1;
	if (state.turns > BOT_LIMITS.turnsPerSession) {
		context.log("engine", "engine", "error", "Turn limit reached.");
		await complete(context);
		return context.toTurn();
	}
	const pending = state.pending;
	const group = pending ? context.groups.get(pending.groupId) : undefined;
	const block = pending ? group?.blocks[pending.blockIndex] : undefined;
	if (!(pending && block && isInputBlock(block))) {
		await complete(context);
		return context.toTurn();
	}
	const parsed = validateInput(block, value);
	if (!parsed.ok) {
		context.transcript("visitor", displayReply(value), block.id);
		context.botText(
			block.id,
			block.retryMessage?.trim() || flow.settings.invalidReplyMessage,
			"system"
		);
		context.input = toInputSpec(block);
		return context.toTurn();
	}
	const answer: Answer = {
		blockId: block.id,
		variableId: block.saveTo,
		label: parsed.label,
		value: parsed.value,
		at: context.at(),
	};
	state.answers.push(answer);
	context.transcript("visitor", parsed.label, block.id);
	context.event(block.id, "answered");
	context.setVariable(block.saveTo, parsed.value);
	state.pending = null;
	const next = inputEdge(context, block, parsed.itemId);
	await run(
		context,
		next ?? { ...pending, blockIndex: pending.blockIndex + 1 }
	);
	return context.toTurn();
}

function inputEdge(
	context: TurnContext,
	block: InputBlock,
	itemId: string | undefined
): Cursor | null {
	let edge: Edge | undefined;
	if (block.type === "choice_input" && !block.multiple) {
		edge =
			(itemId ? context.edge(block.id, itemId) : undefined) ??
			context.edge(block.id, undefined, "default");
	}
	edge ??= context.edge(block.id);
	return edge ? { groupId: edge.to.groupId, blockIndex: 0 } : null;
}

function displayReply(value: ReplyValue): string {
	return (Array.isArray(value) ? value.join(", ") : value).slice(
		0,
		BOT_LIMITS.answerLength
	);
}

async function complete(context: TurnContext): Promise<void> {
	if (context.state.done) {
		return;
	}
	context.state.done = true;
	context.state.pending = null;
	context.state.completedAt = context.at();
	context.input = null;
	await context.emit({
		type: "conversation.completed",
		state: context.state,
	});
}

async function run(context: TurnContext, start: Cursor): Promise<void> {
	let cursor: Cursor = start;
	let steps = 0;
	while (true) {
		const group = context.groups.get(cursor.groupId);
		const block = group?.blocks[cursor.blockIndex];
		if (!block) {
			await complete(context);
			return;
		}
		if (isInputBlock(block)) {
			context.event(block.id, "reached");
			context.state.pending = { ...cursor };
			context.input = toInputSpec(block);
			return;
		}
		steps += 1;
		if (steps > BOT_LIMITS.stepsPerTurn) {
			context.log(
				block.id,
				"engine",
				"error",
				"Stopped a loop: too many steps without a question."
			);
			await complete(context);
			return;
		}
		context.event(block.id, "reached");
		const result = await executeBlock(context, block);
		if (result.kind === "stop") {
			await complete(context);
			return;
		}
		if (result.kind === "group") {
			cursor = { groupId: result.groupId, blockIndex: 0 };
		} else if (result.kind === "edge" && result.edge) {
			cursor = { groupId: result.edge.to.groupId, blockIndex: 0 };
		} else {
			const plain = result.kind === "next" ? context.edge(block.id) : undefined;
			cursor = plain
				? { groupId: plain.to.groupId, blockIndex: 0 }
				: { ...cursor, blockIndex: cursor.blockIndex + 1 };
		}
	}
}

function executeBlock(
	context: TurnContext,
	block: Exclude<Block, InputBlock>
): Promise<StepResult> | StepResult {
	switch (block.type) {
		case "text":
			context.botText(block.id, context.render(block.content));
			return { kind: "next" };
		case "image":
		case "video":
		case "embed":
			mediaMessage(context, block);
			return { kind: "next" };
		case "set_variable":
			setVariable(context, block);
			return { kind: "next" };
		case "condition": {
			const branch = evaluateCondition(context, block) ? "true" : "false";
			return { kind: "edge", edge: context.edge(block.id, undefined, branch) };
		}
		case "ab_test": {
			const branch = context.deps.random() * 100 < block.percentA ? "a" : "b";
			return { kind: "edge", edge: context.edge(block.id, undefined, branch) };
		}
		case "redirect":
			return redirect(context, block);
		case "jump":
			return { kind: "group", groupId: block.groupId };
		case "wait":
			if (block.seconds > 0) {
				context.messages.push({
					type: "wait",
					id: context.messageId(block.id),
					seconds: Math.min(block.seconds, BOT_LIMITS.waitSeconds),
				});
			}
			return { kind: "next" };
		case "ai_reply":
			return aiReply(context, block);
		case "http_request":
			return httpRequest(context, block);
		case "handoff":
			return handoff(context, block);
		default:
			return { kind: "next" };
	}
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function isHttps(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Maps YouTube/Vimeo page URLs to their player URLs; null for other URLs. */
export function videoEmbedUrl(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
	let youtubeId: string | null = null;
	if (host === "youtu.be") {
		youtubeId = url.pathname.slice(1).split("/")[0] ?? null;
	} else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		const parts = url.pathname.split("/").filter(Boolean);
		youtubeId =
			url.searchParams.get("v") ??
			(parts[0] === "embed" || parts[0] === "shorts"
				? (parts[1] ?? null)
				: null);
	}
	if (youtubeId && YOUTUBE_ID.test(youtubeId)) {
		return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
	}
	if (host === "vimeo.com" || host === "player.vimeo.com") {
		const id = url.pathname.split("/").find((part) => /^\d{1,12}$/.test(part));
		if (id) {
			return `https://player.vimeo.com/video/${id}`;
		}
	}
	return null;
}

function mediaMessage(
	context: TurnContext,
	block: BlockOf<"image"> | BlockOf<"video"> | BlockOf<"embed">
): void {
	if (!isHttps(block.url)) {
		context.log(
			block.id,
			"media",
			"error",
			"Skipped media without an https URL."
		);
		return;
	}
	const id = context.messageId(block.id);
	if (block.type === "image") {
		context.messages.push({
			type: "image",
			id,
			url: block.url,
			alt: block.alt,
		});
		context.transcript("bot", `[image] ${block.alt || block.url}`, block.id);
	} else if (block.type === "video") {
		context.messages.push({
			type: "video",
			id,
			url: block.url,
			embedUrl: videoEmbedUrl(block.url),
		});
		context.transcript("bot", `[video] ${block.url}`, block.id);
	} else {
		context.messages.push({
			type: "embed",
			id,
			url: block.url,
			height: block.height,
		});
		context.transcript("bot", `[embed] ${block.url}`, block.id);
	}
}

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

function randomToken(context: TurnContext, length = 12): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let token = "";
	for (let index = 0; index < length; index += 1) {
		token +=
			alphabet[Math.floor(context.deps.random() * alphabet.length)] ?? "0";
	}
	return token;
}

function transcriptText(context: TurnContext): string {
	const text = context.state.transcript
		.map(
			(entry) => `${entry.from === "bot" ? "Bot" : "Visitor"}: ${entry.text}`
		)
		.join("\n");
	return text.length > MAX_VARIABLE_CHARS
		? text.slice(text.length - MAX_VARIABLE_CHARS)
		: text;
}

function toNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : null;
}

function setVariable(
	context: TurnContext,
	block: BlockOf<"set_variable">
): void {
	const current = context.state.variables[block.variableId] ?? "";
	const value = context.render(block.value ?? "");
	switch (block.op) {
		case "set":
			context.setVariable(block.variableId, value);
			break;
		case "append":
			context.setVariable(
				block.variableId,
				current ? `${current}, ${value}` : value
			);
			break;
		case "increment": {
			const base = toNumber(current) ?? 0;
			const step = toNumber(value) ?? 1;
			context.setVariable(block.variableId, String(base + step));
			break;
		}
		case "clear":
			context.setVariable(block.variableId, null);
			break;
		case "now":
			context.setVariable(block.variableId, context.at());
			break;
		case "random_id":
			context.setVariable(block.variableId, randomToken(context));
			break;
		case "result_id":
			context.setVariable(block.variableId, context.state.resultId);
			break;
		case "transcript":
			context.setVariable(block.variableId, transcriptText(context));
			break;
		default:
			break;
	}
}

function isIsoDate(value: string): boolean {
	return DATE_PATTERN.test(value) || DATE_TIME_PATTERN.test(value);
}

function evaluateRule(context: TurnContext, rule: ConditionRule): boolean {
	const left = context.state.variables[rule.variableId] ?? "";
	const right = context.render(rule.value ?? "");
	const leftText = left.trim().toLowerCase();
	const rightText = right.trim().toLowerCase();
	const leftNumber = toNumber(left);
	const rightNumber = toNumber(right);
	const numeric = leftNumber !== null && rightNumber !== null;
	// ISO dates (and date-times) order correctly as strings.
	const dates = isIsoDate(left.trim()) && isIsoDate(right.trim());
	switch (rule.operator) {
		case "equals":
			return numeric ? leftNumber === rightNumber : leftText === rightText;
		case "not_equals":
			return numeric ? leftNumber !== rightNumber : leftText !== rightText;
		case "contains":
			return leftText.includes(rightText);
		case "not_contains":
			return !leftText.includes(rightText);
		case "greater_than":
			if (dates) {
				return left.trim() > right.trim();
			}
			return numeric && (leftNumber as number) > (rightNumber as number);
		case "less_than":
			if (dates) {
				return left.trim() < right.trim();
			}
			return numeric && (leftNumber as number) < (rightNumber as number);
		case "is_set":
			return leftText !== "";
		case "is_empty":
			return leftText === "";
		case "starts_with":
			return leftText.startsWith(rightText);
		case "ends_with":
			return leftText.endsWith(rightText);
		default:
			return false;
	}
}

function evaluateCondition(
	context: TurnContext,
	block: BlockOf<"condition">
): boolean {
	return block.combinator === "and"
		? block.rules.every((rule) => evaluateRule(context, rule))
		: block.rules.some((rule) => evaluateRule(context, rule));
}

function redirect(
	context: TurnContext,
	block: BlockOf<"redirect">
): StepResult {
	const url = context.render(block.url.trim(), "url");
	let parsed: URL | null = null;
	try {
		parsed = new URL(url);
	} catch {
		parsed = null;
	}
	if (
		!(parsed && (parsed.protocol === "https:" || parsed.protocol === "http:"))
	) {
		context.log(
			block.id,
			"redirect",
			"error",
			"Skipped a redirect without an http(s) URL."
		);
		return { kind: "next" };
	}
	context.redirect = { url: parsed.href, newTab: block.newTab };
	context.transcript("bot", `[redirect] ${parsed.href}`, block.id);
	// A same-tab redirect navigates away, so the conversation ends here.
	return block.newTab ? { kind: "next" } : { kind: "stop" };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

async function aiReply(
	context: TurnContext,
	block: BlockOf<"ai_reply">
): Promise<StepResult> {
	const fallback = () => {
		// A failed turn must never leave an earlier turn's answer in the
		// variable, or later templates pair it with the new question.
		context.setVariable(block.saveTo, null);
		context.botText(
			block.id,
			block.fallbackMessage?.trim() || DEFAULT_AI_FALLBACK,
			"system"
		);
		return { kind: "next" } as const;
	};
	const { settings } = context.flow;
	if (!context.deps.ai) {
		context.log(
			block.id,
			"ai",
			"error",
			"AI replies are unavailable on this node."
		);
		return fallback();
	}
	if (context.state.aiTurns >= settings.aiTurnsPerConversation) {
		context.log(
			block.id,
			"ai",
			"error",
			"This conversation used its AI reply budget."
		);
		return fallback();
	}
	if (context.deps.consumeAiTurn && !context.deps.consumeAiTurn()) {
		context.log(
			block.id,
			"ai",
			"error",
			"This bot used its daily AI reply budget."
		);
		return fallback();
	}
	context.state.aiTurns += 1;
	const question = context.render(block.promptTemplate);
	const snippets =
		block.useKnowledge && context.deps.knowledge
			? context.deps.knowledge(question)
			: [];
	const knowledge = snippets.length
		? `\n\nKnowledge base excerpts (answer from these when relevant; say you don't know otherwise):\n${snippets
				.map((snippet, index) => `[${index + 1}] ${snippet}`)
				.join("\n\n")}`
		: "";
	const prompt = `${question}${knowledge}`.slice(0, BOT_LIMITS.aiPromptChars);
	try {
		const output = (
			await context.deps.ai({
				system: block.instructions.trim() || DEFAULT_AI_SYSTEM,
				prompt,
				maxChars: block.maxChars,
			})
		)
			.trim()
			.slice(0, block.maxChars);
		if (!output) {
			context.log(
				block.id,
				"ai",
				"error",
				"The model returned an empty reply."
			);
			return fallback();
		}
		context.botText(block.id, output, "ai");
		context.setVariable(block.saveTo, output);
		context.log(block.id, "ai", "info", `AI reply (${output.length} chars).`);
		return { kind: "next" };
	} catch (cause) {
		context.log(
			block.id,
			"ai",
			"error",
			cause instanceof Error ? cause.message : "The model call failed."
		);
		return fallback();
	}
}

const pathTokenPattern = /[^.[\]]+|\[(\d+)\]|\["([^"\]]*)"\]/g;

/** Reads `a.b[0].c` / `a["b c"]` from parsed JSON without prototype access. */
export function readJsonPath(value: unknown, path: string): unknown {
	let current: unknown = value;
	for (const match of path.matchAll(pathTokenPattern)) {
		const key = match[1] ?? match[2] ?? match[0];
		if (Array.isArray(current)) {
			const index = Number(key);
			current = Number.isInteger(index) ? current[index] : undefined;
		} else if (
			current !== null &&
			typeof current === "object" &&
			Object.hasOwn(current, key)
		) {
			current = (current as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return current;
}

function stringifyMapped(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

async function httpRequest(
	context: TurnContext,
	block: BlockOf<"http_request">
): Promise<StepResult> {
	if (!context.deps.http) {
		context.log(block.id, "http", "error", "HTTP requests are unavailable.");
		return { kind: "next" };
	}
	const rawBody = block.body.trim();
	const looksJson = rawBody.startsWith("{") || rawBody.startsWith("[");
	const headers: Record<string, string> = {};
	for (const header of block.headers) {
		headers[header.name] = context.render(header.value).replace(/[\r\n]/g, " ");
	}
	const request: HttpRequestSpec = {
		method: block.method,
		url: context.render(block.url.trim(), "url"),
		headers,
		body:
			block.method === "GET" || !rawBody
				? null
				: context.render(rawBody, looksJson ? "json" : "none"),
		timeoutMs: Math.min(block.timeoutMs, BOT_LIMITS.httpTimeoutMs),
	};
	const hasContentType = Object.keys(headers).some(
		(name) => name.toLowerCase() === "content-type"
	);
	if (looksJson && request.body && !hasContentType) {
		headers["content-type"] = "application/json";
	}
	try {
		const response = await context.deps.http(request);
		if (response.status < 200 || response.status >= 300) {
			context.log(
				block.id,
				"http",
				"error",
				`Request returned HTTP ${response.status}.`
			);
			return { kind: "next" };
		}
		if (block.responseMapping.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(response.body);
			} catch {
				context.log(
					block.id,
					"http",
					"error",
					"The response is not JSON, so nothing was mapped."
				);
				return { kind: "next" };
			}
			for (const mapping of block.responseMapping) {
				const mapped = stringifyMapped(readJsonPath(parsed, mapping.path));
				if (mapped !== null) {
					context.setVariable(mapping.variableId, mapped);
				}
			}
		}
		context.log(
			block.id,
			"http",
			"info",
			`Request returned HTTP ${response.status}.`
		);
	} catch (cause) {
		context.log(
			block.id,
			"http",
			"error",
			cause instanceof Error ? cause.message : "The request failed."
		);
	}
	return { kind: "next" };
}

async function handoff(
	context: TurnContext,
	block: BlockOf<"handoff">
): Promise<StepResult> {
	const summary = context.render(block.summaryTemplate).trim().slice(0, 2000);
	const topic = context.render(block.topic).trim().slice(0, 80) || "general";
	context.state.handoffs.push({
		blockId: block.id,
		topic,
		summary,
		at: context.at(),
	});
	await context.emit({
		type: "handoff.requested",
		topic,
		summary,
		state: context.state,
	});
	context.botText(block.id, context.render(block.message));
	return { kind: "next" };
}

// ---------------------------------------------------------------------------
// Input validation (server-side authority)
// ---------------------------------------------------------------------------

type ParsedInput =
	| { ok: true; label: string; value: string; itemId?: string }
	| { ok: false };

const INVALID: ParsedInput = { ok: false };
const emailSchema = z.email();
const PHONE_PATTERN = /^\+?[0-9\s().-]{6,24}$/;

function isRealDate(value: string): boolean {
	const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
	return (
		!Number.isNaN(date.getTime()) &&
		date.toISOString().slice(0, 10) === value.slice(0, 10)
	);
}

function plain(value: string): ParsedInput {
	return { ok: true, label: value, value };
}

function validateText(block: BlockOf<"text_input">, text: string): ParsedInput {
	const max = block.maxLength ?? BOT_LIMITS.answerLength;
	if (text.length < Math.max(1, block.minLength ?? 1) || text.length > max) {
		return INVALID;
	}
	return plain(text);
}

function validateNumber(
	block: BlockOf<"number_input">,
	text: string
): ParsedInput {
	const number = toNumber(text);
	if (number === null) {
		return INVALID;
	}
	if (
		(block.min !== undefined && number < block.min) ||
		(block.max !== undefined && number > block.max)
	) {
		return INVALID;
	}
	if (block.step !== undefined) {
		const steps = (number - (block.min ?? 0)) / block.step;
		if (Math.abs(steps - Math.round(steps)) > 1e-9) {
			return INVALID;
		}
	}
	return plain(String(number));
}

/** `scheme://…`, or `scheme:…` that is not a `host:port` (e.g. `mailto:`). */
const explicitScheme = /^[a-z][a-z0-9+.-]*:(?:\/\/|(?!\d))/i;

function validateUrl(text: string): ParsedInput {
	const candidate = explicitScheme.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(candidate);
		if (
			!(
				(url.protocol === "https:" || url.protocol === "http:") &&
				url.hostname.includes(".")
			)
		) {
			return INVALID;
		}
		return plain(url.href);
	} catch {
		return INVALID;
	}
}

function validateDate(block: BlockOf<"date_input">, text: string): ParsedInput {
	const pattern = block.withTime ? DATE_TIME_PATTERN : DATE_PATTERN;
	if (!(pattern.test(text) && isRealDate(text))) {
		return INVALID;
	}
	if (block.withTime) {
		const [hours, minutes] = text.slice(11).split(":").map(Number);
		if ((hours ?? 99) > 23 || (minutes ?? 99) > 59) {
			return INVALID;
		}
	}
	const day = text.slice(0, 10);
	if ((block.min && day < block.min) || (block.max && day > block.max)) {
		return INVALID;
	}
	return plain(text);
}

function validateRating(
	block: BlockOf<"rating_input">,
	text: string
): ParsedInput {
	const number = toNumber(text);
	const [low, high] = block.scale === "nps" ? [0, 10] : [1, block.length];
	if (
		number === null ||
		!Number.isInteger(number) ||
		number < low ||
		number > high
	) {
		return INVALID;
	}
	return plain(String(number));
}

function validateChoice(
	block: BlockOf<"choice_input">,
	value: ReplyValue
): ParsedInput {
	const requested = Array.isArray(value) ? value : [value];
	const find = (key: string) =>
		block.items.find((item) => item.id === key) ??
		block.items.find(
			(item) => item.label.toLowerCase() === key.trim().toLowerCase()
		);
	const items = requested.map(find);
	if (
		items.length === 0 ||
		items.some((item) => !item) ||
		(!block.multiple && items.length !== 1)
	) {
		return INVALID;
	}
	const chosen = items.filter((item) => item !== undefined);
	if (new Set(chosen.map((item) => item.id)).size !== chosen.length) {
		return INVALID;
	}
	return {
		ok: true,
		label: chosen.map((item) => item.label).join(", "),
		value: chosen.map((item) => item.value ?? item.label).join(", "),
		itemId: block.multiple ? undefined : chosen[0]?.id,
	};
}

/** Validates a reply against its input block. Every input is required. */
export function validateInput(
	block: InputBlock,
	value: ReplyValue
): ParsedInput {
	if (block.type === "choice_input") {
		return validateChoice(block, value);
	}
	if (typeof value !== "string") {
		return INVALID;
	}
	const text = value.trim();
	if (!text || text.length > BOT_LIMITS.answerLength) {
		return INVALID;
	}
	switch (block.type) {
		case "text_input":
			return validateText(block, text);
		case "number_input":
			return validateNumber(block, text);
		case "email_input":
			return emailSchema.safeParse(text).success ? plain(text) : INVALID;
		case "phone_input": {
			const digits = text.replace(/\D/g, "").length;
			return PHONE_PATTERN.test(text) && digits >= 6 && digits <= 15
				? plain(text)
				: INVALID;
		}
		case "url_input":
			return validateUrl(text);
		case "date_input":
			return validateDate(block, text);
		case "rating_input":
			return validateRating(block, text);
		default:
			return INVALID;
	}
}
