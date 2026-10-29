/**
 * Bridge request helpers for the Bot Flows Companion.
 *
 * Every admin call goes through the host's `window.ryu.app.request` (grant
 * `app:http`), which forwards a path relative to the sidecar mount
 * (`/api/bot-flows`) and enforces the manifest route permissions. Responses
 * are validated with the sidecar's own zod contracts before the UI uses them.
 */
import { z } from "zod";
import {
	BODY_TOO_LARGE_MESSAGE,
	BOT_LIMITS,
	type BotAnalytics,
	type BotDocument,
	type BotFlowsAdminRequestBody,
	type BotListItem,
	type BotStatus,
	type BotTemplate,
	type BotTemplateId,
	botAnalyticsSchema,
	botDeleteResponseSchema,
	botDocumentSchema,
	botErrorResponseSchema,
	botListItemSchema,
	botStatusSchema,
	botTemplateSchema,
	type ExportTable,
	exportTableSchema,
	type Flow,
	type FlowIssue,
	flowErrors,
	jsonBodyBytes,
	type KnowledgeDocument,
	knowledgeDocumentSchema,
	type PreviewTurn,
	previewTurnSchema,
	type ReplyValue,
	type ResultDetail,
	type ResultPage,
	resultDetailSchema,
	resultPageSchema,
} from "../../sidecar/src/contracts.ts";
import { toCsv } from "../../sidecar/src/csv.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A sidecar error with its machine code and any flow issues it reported. */
export class BotFlowsRequestError extends Error {
	readonly code: string;
	readonly issues: FlowIssue[];
	/** The HTTP status when the bridge reported one. */
	readonly status: number | null;

	constructor(
		code: string,
		message: string,
		issues: FlowIssue[] = [],
		status: number | null = null
	) {
		super(message);
		this.name = "BotFlowsRequestError";
		this.code = code;
		this.issues = issues;
		this.status = status;
	}
}

export const BRIDGE_UNAVAILABLE =
	"Open Bot Flows in Ryu to connect to its service.";

/**
 * The machine code the sidecar uses for each status it returns. The Ryu host
 * bridge does not forward a failed response's body to the frame: it rejects
 * with `"<proxy path> failed: <status>"` (Desktop `ApiError` through
 * `toRpcError`), so the status is all that reliably crosses it.
 */
const STATUS_CODES: Record<number, string> = {
	400: "invalid_input",
	404: "not_found",
	409: "conflict",
	410: "expired",
	413: "too_large",
	415: "invalid_input",
	422: "slug_taken",
	429: "quota",
};

const STATUS_MESSAGES: Record<string, string> = {
	invalid_input:
		"Bot Flows rejected the request. Check the highlighted fields.",
	not_found: "This bot no longer exists on this node.",
	conflict:
		"This bot changed since you opened it. Reload it to see the latest version.",
	expired: "This conversation expired. Start a new one.",
	too_large: BODY_TOO_LARGE_MESSAGE,
	slug_taken: "This link is already in use.",
	quota:
		"A limit was reached. Wait a moment, or remove something, and try again.",
	unavailable: "The Bot Flows service is not responding. Try again shortly.",
};

/** Per-request wording and recovery for statuses the bridge reports bare. */
export interface StatusContext {
	/** Issues to attach when the sidecar rejects the content (400). */
	issues?: () => FlowIssue[];
	/** Message overrides by machine code. */
	messages?: Partial<Record<string, string>>;
}

const BRIDGE_STATUS = /\bfailed: (\d{3})\s*$/;

/** The HTTP status in a host bridge rejection, or null. */
export function bridgeStatus(cause: unknown): number | null {
	const status =
		typeof cause === "object" && cause !== null && "status" in cause
			? (cause as { status: unknown }).status
			: undefined;
	if (typeof status === "number" && status >= 400 && status < 600) {
		return status;
	}
	const message = cause instanceof Error ? cause.message : "";
	const match = BRIDGE_STATUS.exec(message);
	return match?.[1] ? Number(match[1]) : null;
}

function codeForStatus(status: number): string {
	if (status >= 500) {
		return "unavailable";
	}
	return STATUS_CODES[status] ?? "operation_failed";
}

/** Turns whatever the bridge threw into a BotFlowsRequestError when possible. */
export function asRequestError(
	cause: unknown,
	context: StatusContext = {}
): Error {
	if (cause instanceof BotFlowsRequestError) {
		return cause;
	}
	const status = bridgeStatus(cause);
	// A host that forwards the sidecar body keeps its exact code and issues.
	const body =
		typeof cause === "object" && cause !== null && "body" in cause
			? (cause as { body: unknown }).body
			: cause;
	const parsed = botErrorResponseSchema.safeParse(body);
	if (parsed.success) {
		return new BotFlowsRequestError(
			parsed.data.error.code,
			parsed.data.error.message,
			parsed.data.error.issues ?? [],
			status
		);
	}
	if (status !== null) {
		const code = codeForStatus(status);
		const issues = status === 400 ? (context.issues?.() ?? []) : [];
		const message =
			context.messages?.[code] ??
			issues.find((issue) => issue.severity === "error")?.message ??
			STATUS_MESSAGES[code] ??
			"The Bot Flows request failed.";
		return new BotFlowsRequestError(code, message, issues, status);
	}
	return cause instanceof Error
		? cause
		: new Error("The Bot Flows request failed.");
}

/** True when `body` is larger than any Bot Flows route (and Core) accepts. */
export function bodyTooLarge(body: unknown): boolean {
	return jsonBodyBytes(body) > BOT_LIMITS.maxBodyBytes;
}

export async function botFlowsRequest<T>(
	schema: z.ZodType<T>,
	path: string,
	method: HttpMethod = "GET",
	body?: BotFlowsAdminRequestBody,
	context?: StatusContext
): Promise<T> {
	const request = window.ryu?.app?.request;
	if (!request) {
		throw new Error(BRIDGE_UNAVAILABLE);
	}
	// Core's ext-proxy refuses an oversized body before the sidecar sees it.
	if (body !== undefined && bodyTooLarge(body)) {
		throw new BotFlowsRequestError("too_large", BODY_TOO_LARGE_MESSAGE);
	}
	let result: unknown;
	try {
		result = await request(
			body === undefined ? { path, method } : { path, method, body }
		);
	} catch (cause) {
		throw asRequestError(cause, context);
	}
	const error = botErrorResponseSchema.safeParse(result);
	if (error.success) {
		throw new BotFlowsRequestError(
			error.data.error.code,
			error.data.error.message,
			error.data.error.issues ?? []
		);
	}
	const parsed = schema.safeParse(result);
	if (!parsed.success) {
		throw new Error(
			"Bot Flows returned an unexpected response. Update the app and try again."
		);
	}
	return parsed.data;
}

const bot = (id: string) => `/admin/bots/${encodeURIComponent(id)}`;

export interface BotFlowsApi {
	analytics(id: string): Promise<BotAnalytics>;
	create(input: {
		flow?: Flow;
		name: string;
		templateId?: BotTemplateId;
	}): Promise<BotDocument>;
	delete(id: string): Promise<{ deleted: true }>;
	detail(id: string): Promise<BotDocument>;
	duplicate(id: string): Promise<BotDocument>;
	exportTable(id: string): Promise<ExportTable>;
	knowledge(id: string): Promise<KnowledgeDocument>;
	list(): Promise<BotListItem[]>;
	previewReply(sessionId: string, value: ReplyValue): Promise<PreviewTurn>;
	previewStart(
		id: string,
		hidden?: Record<string, string>
	): Promise<PreviewTurn>;
	result(id: string, resultId: string): Promise<ResultDetail>;
	results(id: string, cursor?: string | null): Promise<ResultPage>;
	save(
		id: string,
		input: { flow?: Flow; name?: string; revision: number; slug?: string }
	): Promise<BotDocument>;
	saveKnowledge(
		id: string,
		articles: { body: string; id?: string; title: string }[]
	): Promise<KnowledgeDocument>;
	/**
	 * Publishing sends the revision the user reviewed; the sidecar refuses a
	 * newer draft with `conflict`, and a 400 reports the flow's own errors.
	 */
	setPublished(
		id: string,
		published: boolean,
		reviewed?: { flow: Flow; revision: number }
	): Promise<BotDocument>;
	status(): Promise<BotStatus>;
	templates(): Promise<BotTemplate[]>;
}

export const RESULTS_PAGE_SIZE = 25;

export const botFlowsApi: BotFlowsApi = {
	status: () => botFlowsRequest(botStatusSchema, "/status"),
	templates: () =>
		botFlowsRequest(z.array(botTemplateSchema), "/admin/templates"),
	list: () => botFlowsRequest(z.array(botListItemSchema), "/admin/bots"),
	detail: (id) => botFlowsRequest(botDocumentSchema, bot(id)),
	create: (input) =>
		botFlowsRequest(botDocumentSchema, "/admin/bots", "POST", input),
	save: (id, input) =>
		botFlowsRequest(botDocumentSchema, bot(id), "PUT", input, {
			issues: () => (input.flow ? flowErrors(input.flow) : []),
			messages: {
				conflict:
					"This bot was saved elsewhere since you opened it. Reload it to continue.",
			},
		}),
	delete: (id) => botFlowsRequest(botDeleteResponseSchema, bot(id), "DELETE"),
	duplicate: (id) =>
		botFlowsRequest(botDocumentSchema, `${bot(id)}/duplicate`, "POST"),
	setPublished: (id, published, reviewed) =>
		botFlowsRequest(
			botDocumentSchema,
			`${bot(id)}/${published ? "publish" : "unpublish"}`,
			"POST",
			published && reviewed ? { revision: reviewed.revision } : undefined,
			{
				issues: () => (reviewed ? flowErrors(reviewed.flow) : []),
				messages: {
					conflict:
						"This bot changed since you opened it. Reload it before publishing.",
				},
			}
		),
	previewStart: (id, hidden) =>
		botFlowsRequest(
			previewTurnSchema,
			`${bot(id)}/preview`,
			"POST",
			hidden && Object.keys(hidden).length > 0 ? { hidden } : {}
		),
	previewReply: (sessionId, value) =>
		botFlowsRequest(
			previewTurnSchema,
			`/admin/preview/${encodeURIComponent(sessionId)}/reply`,
			"POST",
			{ value },
			{
				messages: {
					conflict:
						"The bot is still answering, or this preview ended. Restart the preview if it stays stuck.",
					expired: "This preview expired. Restart it.",
					invalid_input: "That answer wasn't accepted. Check it and try again.",
				},
			}
		),
	results: (id, cursor) => {
		const query = new URLSearchParams({ limit: String(RESULTS_PAGE_SIZE) });
		if (cursor) {
			query.set("cursor", cursor);
		}
		return botFlowsRequest(resultPageSchema, `${bot(id)}/results?${query}`);
	},
	result: (id, resultId) =>
		botFlowsRequest(
			resultDetailSchema,
			`${bot(id)}/results/${encodeURIComponent(resultId)}`
		),
	analytics: (id) =>
		botFlowsRequest(botAnalyticsSchema, `${bot(id)}/analytics`),
	exportTable: (id) =>
		botFlowsRequest(exportTableSchema, `${bot(id)}/export?format=json`),
	knowledge: (id) =>
		botFlowsRequest(knowledgeDocumentSchema, `${bot(id)}/knowledge`),
	saveKnowledge: (id, articles) =>
		botFlowsRequest(
			knowledgeDocumentSchema,
			`${bot(id)}/knowledge`,
			"PUT",
			{ articles },
			{
				messages: {
					invalid_input:
						"Every article needs a title and content within the size limits.",
				},
			}
		),
};

/** CSV text for an export table, with the sidecar's formula-injection guard. */
export function exportCsv(table: ExportTable): string {
	return toCsv(table);
}

// ---------------------------------------------------------------------------
// Share links and embed snippets
// ---------------------------------------------------------------------------

export const PUBLIC_MOUNT = "/bots";

export interface ShareLocation {
	/** The node-relative public path, e.g. `/bots/support`. */
	path: string;
	/** An absolute URL when the node reports a reachable web origin. */
	url: string | null;
}

type ShareOriginSource = "active" | "lan" | "mesh";

function isHttpOrigin(value: string): boolean {
	try {
		const protocol = new URL(value).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

function shareOriginRank(source: ShareOriginSource): number {
	if (source === "active") {
		return 0;
	}
	return source === "lan" ? 1 : 2;
}

export function publicPath(slug: string): string {
	return `${PUBLIC_MOUNT}/${encodeURIComponent(slug)}`;
}

/** Resolves the bot's public link from the node's reachable share origins. */
export async function shareLocationForBot(
	slug: string
): Promise<ShareLocation> {
	const path = publicPath(slug);
	try {
		const origins = await window.ryu?.node?.shareOrigins();
		const origin = (origins ?? [])
			.filter(
				(candidate) => candidate.reachable && isHttpOrigin(candidate.origin)
			)
			.sort(
				(left, right) =>
					shareOriginRank(left.source) - shareOriginRank(right.source)
			)[0];
		return {
			path,
			url: origin ? new URL(path, origin.origin).toString() : null,
		};
	} catch {
		return { path, url: null };
	}
}

export type EmbedMode = "standard" | "popup" | "bubble";

/** JS string literal that is also safe inside an HTML `<script>` element. */
function scriptLiteral(value: string): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026");
}

function htmlAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * The copy-paste snippet for one embed mode. `base` is the absolute bot URL
 * (or the node-relative path when no origin is known). Hidden variable names
 * are listed as empty prefill values the site owner can fill in.
 */
export function embedSnippet(
	mode: EmbedMode,
	base: string,
	slug: string,
	hiddenNames: string[] = []
): string {
	const script = `<script src="${htmlAttribute(`${base}/embed.js`)}"></script>`;
	const options: string[] = [`mode: ${scriptLiteral(mode)}`];
	const targetId = `ryu-bot-${slug}`;
	if (mode === "standard") {
		options.push(`target: ${scriptLiteral(`#${targetId}`)}`);
	}
	if (hiddenNames.length > 0) {
		const entries = hiddenNames
			.map((name) => `${name}: ${scriptLiteral("")}`)
			.join(", ");
		options.push(`hidden: { ${entries} }`);
	}
	const init = `<script>\n  RyuBotFlows.init({ ${options.join(", ")} });\n</script>`;
	if (mode === "standard") {
		return `<div id="${htmlAttribute(targetId)}" style="height: 600px"></div>\n${script}\n${init}`;
	}
	return `${script}\n${init}`;
}

/** Normalizes one allowed-origin entry, or returns null when it is invalid. */
export function normalizeEmbedOrigin(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "https:") {
			return null;
		}
		if (url.pathname !== "/" || url.search || url.hash || url.username) {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
}

export function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: "The Bot Flows request failed.";
}

export function safeFilename(value: string): string {
	return (
		value
			.normalize("NFKD")
			.replace(/[^a-zA-Z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "bot"
	);
}
