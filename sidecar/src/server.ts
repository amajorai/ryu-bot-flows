import { isIP } from "node:net";
import { bearerOk } from "@ryu/sidecar-runtime";
import { z } from "zod";
import {
	BOT_LIMITS,
	createBotSchema,
	type Flow,
	type PreviewTurn,
	type PublicTurn,
	publishBotSchema,
	putKnowledgeSchema,
	replySchema,
	startSessionSchema,
	updateBotSchema,
} from "./contracts.ts";
import { toCsv } from "./csv.ts";
import { EMBED_SCRIPT } from "./embed.ts";
import { type EngineDeps, reply, startSession, type Turn } from "./engine.ts";
import {
	type BotHost,
	completedPayload,
	handoffPayload,
	UNHOSTED,
} from "./host.ts";
import { createGuardedHttp } from "./http-guard.ts";
import { knowledgeSnippets } from "./knowledge.ts";
import { renderChatPage, renderClosedPage } from "./respondent.ts";
import {
	BotFlowsError,
	type BotFlowsStore,
	type PublishedBot,
	randomId,
	type StoredSession,
} from "./store.ts";
import { listTemplates } from "./templates.ts";

export const API_PREFIX = "/api/bot-flows";

export const RATE_LIMITS = {
	windowMs: 10 * 60 * 1000,
	startsPerVisitor: 20,
	repliesPerVisitor: 120,
	startsPerBot: 600,
	repliesPerBot: 6000,
	viewsPerVisitor: 30,
} as const;

export interface BotFlowsServerOptions {
	host?: BotHost;
	/** Overrides the SSRF-guarded fetch used by `http_request` blocks. */
	http?: EngineDeps["http"];
	now?: () => Date;
	port?: number;
	random?: () => number;
	rateLimits?: Partial<Record<keyof typeof RATE_LIMITS, number>>;
	store: BotFlowsStore;
	token: string | null;
}

interface RouteContext {
	params: Record<string, string>;
	peer: string | undefined;
	request: Request;
	url: URL;
}

type RouteHandler = (context: RouteContext) => Promise<Response> | Response;

interface RouteDefinition {
	handler: RouteHandler;
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The manifest path relative to the sidecar mount. */
	path: string;
}

const PARAM_PATTERNS: Record<string, string> = {
	slug: "([a-z0-9][a-z0-9-]{1,46}[a-z0-9])",
	id: "([A-Za-z0-9_-]{1,80})",
	resultId: "([A-Za-z0-9_-]{1,80})",
	sessionId: "([A-Za-z0-9_-]{1,80})",
};

const SECURITY_HEADERS = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
} as const;

function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: { "cache-control": "no-store", ...SECURITY_HEADERS },
	});
}

function errorResponse(error: BotFlowsError): Response {
	return json(
		{
			error: {
				code: error.code,
				message: error.message,
				...(Array.isArray(error.details) ? { issues: error.details } : {}),
			},
		},
		error.status
	);
}

function toBotFlowsError(cause: unknown): BotFlowsError {
	if (cause instanceof BotFlowsError) {
		return cause;
	}
	if (cause instanceof z.ZodError) {
		const issue = cause.issues[0];
		const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
		return new BotFlowsError(
			"invalid_input",
			`${issue?.message ?? "The request is invalid."}${where}`
		);
	}
	if (cause instanceof Error) {
		return new BotFlowsError("operation_failed", cause.message);
	}
	return new BotFlowsError(
		"operation_failed",
		"The Bot Flows operation failed.",
		500
	);
}

async function readBody(request: Request, limit: number): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) {
		return "";
	}
	let size = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		size += chunk.value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new BotFlowsError(
				"too_large",
				"Request exceeds the size limit.",
				413
			);
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

async function readJson<T>(
	request: Request,
	schema: z.ZodType<T>,
	options: { limit?: number; optional?: boolean } = {}
): Promise<T> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	const length = request.headers.get("content-length");
	if (options.optional && (!request.body || length === "0") && !contentType) {
		return schema.parse({});
	}
	if (!contentType.includes("application/json")) {
		throw new BotFlowsError("invalid_input", "JSON body required.", 415);
	}
	const text = await readBody(
		request,
		options.limit ?? BOT_LIMITS.maxBodyBytes
	);
	if (options.optional && text.trim() === "") {
		return schema.parse({});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new BotFlowsError("invalid_input", "Request body is not valid JSON.");
	}
	return schema.parse(parsed);
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);

/** The one bucket every caller without a usable address shares. */
export const ANONYMOUS_VISITOR = "anonymous";

function usableAddress(value: string | undefined): value is string {
	return Boolean(
		value &&
			isIP(value) !== 0 &&
			!LOOPBACK.test(value) &&
			!UNSPECIFIED.has(value)
	);
}

/**
 * The visitor key for per-visitor rate limits. A direct non-loopback peer is
 * used as is. Core reaches the sidecar over loopback and forwards request
 * headers verbatim, so then the right-most `X-Forwarded-For` hop is used when
 * it is a plain, non-loopback IP address. Anything else (no header, a host
 * name, garbage, loopback) maps to one shared `anonymous` bucket, so leaving
 * the header out never escapes the per-visitor limits.
 *
 * Core neither strips nor appends `X-Forwarded-For`, so when Core's port is
 * reachable without a proxy that overwrites it, a caller can still pick its
 * own key and rotate it. Per-visitor limits are fairness only; the per-bot
 * caps and the engaged-result quota are the bound (see the README).
 */
export function visitorKey(peer: string | undefined, headers: Headers): string {
	if (peer && !LOOPBACK.test(peer)) {
		return peer;
	}
	const forwarded = headers
		.get("x-forwarded-for")
		?.split(",")
		.map((hop) => hop.trim())
		.filter(Boolean)
		.at(-1);
	return usableAddress(forwarded) ? forwarded : ANONYMOUS_VISITOR;
}

function frameAncestors(origins: string[]): string {
	return origins.length > 0 ? `'self' ${origins.join(" ")}` : "'none'";
}

function htmlResponse(
	html: string,
	nonce: string,
	origins: string[],
	status = 200
): Response {
	const headers: Record<string, string> = {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			`style-src 'nonce-${nonce}'`,
			"img-src https: data:",
			"media-src https:",
			"frame-src https:",
			"connect-src 'self'",
			"form-action 'none'",
			"base-uri 'none'",
			`frame-ancestors ${frameAncestors(origins)}`,
		].join("; "),
		...SECURITY_HEADERS,
	};
	if (origins.length === 0) {
		headers["x-frame-options"] = "DENY";
	}
	return new Response(html, { status, headers });
}

function closedResponse(message: string, origins: string[]): Response {
	const page = renderClosedPage(message);
	return htmlResponse(page.html, page.nonce, origins, 404);
}

function secureRandom(): number {
	const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
	return value / 2 ** 32;
}

export function createBotFlowsHandler(options: BotFlowsServerOptions) {
	const { store } = options;
	const host = options.host ?? UNHOSTED;
	const http = options.http ?? createGuardedHttp();
	const now = options.now ?? (() => new Date());
	const random = options.random ?? secureRandom;
	const limits = { ...RATE_LIMITS, ...options.rateLimits };
	const busySessions = new Set<string>();

	function limit(key: string, max: number): void {
		if (!store.hit(key, max, limits.windowMs, now())) {
			throw new BotFlowsError(
				"rate_limited",
				"Too many messages right now. Please wait a few minutes.",
				429
			);
		}
	}

	function engineDeps(
		bot: PublishedBot,
		flow: Flow,
		preview: boolean
	): EngineDeps {
		return {
			now,
			random,
			http,
			ai: host.aiAvailable ? (request) => host.complete(request) : undefined,
			consumeAiTurn: preview
				? undefined
				: () => store.consumeAiTurn(bot.id, flow.settings.aiTurnsPerDay, now()),
			knowledge: (query) =>
				knowledgeSnippets(store.getKnowledge(bot.id).articles, query),
			emit: preview
				? undefined
				: async (event) => {
						if (event.type === "conversation.completed") {
							await host.emit(
								"conversation.completed",
								completedPayload(bot, flow, event.state)
							);
						} else {
							await host.emit(
								"handoff.requested",
								handoffPayload(
									bot,
									flow,
									event.state,
									event,
									now().toISOString()
								)
							);
						}
					},
		};
	}

	function publicTurn(session: StoredSession, turn: Turn): PublicTurn {
		return {
			sessionId: session.id,
			messages: turn.messages,
			input: turn.input,
			redirect: turn.redirect,
			done: turn.done,
			expiresAt: session.expiresAt,
		};
	}

	function previewTurn(
		session: StoredSession,
		turn: Turn,
		flow: Flow
	): PreviewTurn {
		const variables: Record<string, string> = {};
		for (const variable of flow.variables) {
			const value = turn.state.variables[variable.id];
			if (value !== undefined) {
				variables[variable.name] = value;
			}
		}
		return {
			...publicTurn(session, turn),
			resultId: turn.state.resultId,
			variables,
			logs: turn.state.logs,
			handoffs: turn.state.handoffs,
		};
	}

	async function begin(
		bot: PublishedBot,
		hidden: Record<string, string>,
		preview: boolean
	) {
		const sessionId = randomId("s_");
		const turn = await startSession(
			bot.flow,
			hidden,
			engineDeps(bot, bot.flow, preview),
			randomId("r_")
		);
		const session = store.createSession({
			botId: bot.id,
			flow: bot.flow,
			flowHash: bot.hash,
			isPreview: preview,
			sessionId,
			state: turn.state,
			now: now(),
		});
		return { session, turn };
	}

	async function advance(
		session: StoredSession,
		value: z.infer<typeof replySchema>["value"]
	) {
		if (Date.parse(session.expiresAt) <= now().getTime()) {
			throw new BotFlowsError(
				"expired",
				"This conversation expired. Start a new one.",
				410
			);
		}
		if (session.state.done) {
			throw new BotFlowsError("completed", "This conversation has ended.", 409);
		}
		const flow = store.snapshot(session.botId, session.flowHash);
		if (!flow) {
			throw new BotFlowsError(
				"expired",
				"This conversation expired. Start a new one.",
				410
			);
		}
		if (busySessions.has(session.id)) {
			throw new BotFlowsError(
				"busy",
				"Still working on your last message.",
				409
			);
		}
		busySessions.add(session.id);
		try {
			const identity = store.identity(session.botId);
			const bot: PublishedBot = { ...identity, flow, hash: session.flowHash };
			const turn = await reply(
				flow,
				session.state,
				value,
				engineDeps(bot, flow, session.isPreview)
			);
			store.saveSession(session.id, turn.state, flow, now());
			return { flow, turn };
		} finally {
			busySessions.delete(session.id);
		}
	}

	function botId(context: RouteContext): string {
		return context.params.id ?? "";
	}

	const routes: RouteDefinition[] = [
		{
			method: "GET",
			path: "/status",
			handler: () => {
				const counts = store.counts();
				return json({
					status: "ready",
					botCount: counts.bots,
					publishedCount: counts.published,
					aiAvailable: host.aiAvailable,
				});
			},
		},
		{
			method: "GET",
			path: "/admin/templates",
			handler: () => json(listTemplates()),
		},
		{ method: "GET", path: "/admin/bots", handler: () => json(store.list()) },
		{
			method: "POST",
			path: "/admin/bots",
			handler: async ({ request }) =>
				json(
					store.create(await readJson(request, createBotSchema), now()),
					201
				),
		},
		{
			method: "GET",
			path: "/admin/bots/:id",
			handler: (context) => json(store.get(botId(context))),
		},
		{
			method: "PUT",
			path: "/admin/bots/:id",
			handler: async (context) =>
				json(
					store.update(
						botId(context),
						await readJson(context.request, updateBotSchema),
						now()
					)
				),
		},
		{
			method: "DELETE",
			path: "/admin/bots/:id",
			handler: (context) => {
				store.delete(botId(context));
				return json({ deleted: true });
			},
		},
		{
			method: "POST",
			path: "/admin/bots/:id/publish",
			handler: async (context) => {
				const body = await readJson(context.request, publishBotSchema, {
					optional: true,
				});
				return json(store.publish(botId(context), now(), body.revision));
			},
		},
		{
			method: "POST",
			path: "/admin/bots/:id/unpublish",
			handler: (context) => json(store.unpublish(botId(context), now())),
		},
		{
			method: "POST",
			path: "/admin/bots/:id/duplicate",
			handler: (context) => json(store.duplicate(botId(context), now()), 201),
		},
		{
			method: "POST",
			path: "/admin/bots/:id/preview",
			handler: async (context) => {
				const body = await readJson(context.request, startSessionSchema, {
					optional: true,
					limit: BOT_LIMITS.publicBodyBytes,
				});
				const bot = store.draftSnapshot(botId(context), now());
				const { session, turn } = await begin(bot, body.hidden ?? {}, true);
				return json(previewTurn(session, turn, bot.flow), 201);
			},
		},
		{
			method: "POST",
			path: "/admin/preview/:sessionId/reply",
			handler: async (context) => {
				const body = await readJson(context.request, replySchema, {
					limit: BOT_LIMITS.publicBodyBytes,
				});
				const session = store.getSession(context.params.sessionId ?? "");
				if (!session?.isPreview) {
					throw new BotFlowsError(
						"not_found",
						"Preview session not found.",
						404
					);
				}
				const { flow, turn } = await advance(session, body.value);
				return json(previewTurn(session, turn, flow));
			},
		},
		{
			method: "GET",
			path: "/admin/bots/:id/results",
			handler: ({ params, url }) => {
				const requested = url.searchParams.has("limit")
					? Number(url.searchParams.get("limit"))
					: BOT_LIMITS.resultsPage;
				if (!Number.isInteger(requested) || requested < 1) {
					throw new BotFlowsError(
						"invalid_input",
						"Results limit must be a positive integer."
					);
				}
				return json(
					store.results(
						params.id ?? "",
						url.searchParams.get("cursor"),
						requested
					)
				);
			},
		},
		{
			method: "DELETE",
			path: "/admin/bots/:id/results",
			handler: (context) =>
				json({ deleted: store.clearResults(botId(context)) }),
		},
		{
			method: "GET",
			path: "/admin/bots/:id/results/:resultId",
			handler: ({ params }) =>
				json(store.result(params.id ?? "", params.resultId ?? "")),
		},
		{
			method: "DELETE",
			path: "/admin/bots/:id/results/:resultId",
			handler: ({ params }) => {
				if (!store.deleteResult(params.id ?? "", params.resultId ?? "")) {
					throw new BotFlowsError("not_found", "Result not found.", 404);
				}
				return json({ deleted: true });
			},
		},
		{
			method: "GET",
			path: "/admin/bots/:id/analytics",
			handler: (context) => json(store.analytics(botId(context))),
		},
		{
			method: "GET",
			path: "/admin/bots/:id/export",
			handler: (context) => {
				const table = store.exportTable(botId(context));
				if (context.url.searchParams.get("format") === "json") {
					return json(table);
				}
				const { slug } = store.get(botId(context));
				return new Response(toCsv(table), {
					headers: {
						"content-type": "text/csv; charset=utf-8",
						"content-disposition": `attachment; filename="${slug}-results.csv"`,
						"cache-control": "no-store",
						...SECURITY_HEADERS,
					},
				});
			},
		},
		{
			method: "GET",
			path: "/admin/bots/:id/knowledge",
			handler: (context) => json(store.getKnowledge(botId(context))),
		},
		{
			method: "PUT",
			path: "/admin/bots/:id/knowledge",
			handler: async (context) =>
				json(
					store.putKnowledge(
						botId(context),
						await readJson(context.request, putKnowledgeSchema),
						now()
					)
				),
		},
		{
			method: "GET",
			path: "/:slug",
			handler: ({ params, url, peer, request }) => {
				const lookup = store.lookupPublic(params.slug ?? "");
				if (lookup.kind === "missing") {
					return closedResponse("This bot doesn't exist.", []);
				}
				if (lookup.kind === "closed") {
					return closedResponse(lookup.message, lookup.allowedEmbedOrigins);
				}
				const visitor = visitorKey(peer, request.headers);
				if (
					store.hit(
						`view:${visitor}:${lookup.bot.id}`,
						limits.viewsPerVisitor,
						limits.windowMs,
						now()
					)
				) {
					store.recordView(lookup.bot.id, now());
				}
				const page = renderChatPage({
					botName: lookup.bot.name,
					flow: lookup.bot.flow,
					embed: url.searchParams.get("embed") === "1",
				});
				return htmlResponse(
					page.html,
					page.nonce,
					lookup.bot.flow.settings.allowedEmbedOrigins
				);
			},
		},
		{
			method: "GET",
			path: "/:slug/embed.js",
			handler: ({ params }) => {
				if (store.lookupPublic(params.slug ?? "").kind === "missing") {
					throw new BotFlowsError("not_found", "Bot not found.", 404);
				}
				return new Response(EMBED_SCRIPT, {
					headers: {
						"content-type": "text/javascript; charset=utf-8",
						"cache-control": "public, max-age=300",
						"cross-origin-resource-policy": "cross-origin",
						"x-content-type-options": "nosniff",
					},
				});
			},
		},
		{
			method: "POST",
			path: "/:slug/sessions",
			handler: async ({ params, peer, request }) => {
				const slug = params.slug ?? "";
				const visitor = visitorKey(peer, request.headers);
				limit(`start:visitor:${visitor}`, limits.startsPerVisitor);
				limit(`start:slug:${slug}`, limits.startsPerBot);
				const body = await readJson(request, startSessionSchema, {
					limit: BOT_LIMITS.publicBodyBytes,
				});
				const lookup = store.lookupPublic(slug);
				if (lookup.kind !== "published") {
					throw new BotFlowsError(
						"closed",
						lookup.kind === "closed" ? lookup.message : "Bot not found.",
						404
					);
				}
				if (body.website?.trim()) {
					// Honeypot: look like a finished conversation and store nothing.
					return json(
						{
							sessionId: randomId("s_"),
							messages: [],
							input: null,
							redirect: null,
							done: true,
							expiresAt: now().toISOString(),
						} satisfies PublicTurn,
						201
					);
				}
				store.assertCanStart(lookup.bot.id);
				const { session, turn } = await begin(
					lookup.bot,
					body.hidden ?? {},
					false
				);
				return json(publicTurn(session, turn), 201);
			},
		},
		{
			method: "POST",
			path: "/:slug/sessions/:sessionId/reply",
			handler: async ({ params, peer, request }) => {
				const slug = params.slug ?? "";
				const visitor = visitorKey(peer, request.headers);
				limit(`reply:visitor:${visitor}`, limits.repliesPerVisitor);
				limit(`reply:slug:${slug}`, limits.repliesPerBot);
				const body = await readJson(request, replySchema, {
					limit: BOT_LIMITS.publicBodyBytes,
				});
				const lookup = store.lookupPublic(slug);
				if (lookup.kind !== "published") {
					throw new BotFlowsError(
						"closed",
						lookup.kind === "closed" ? lookup.message : "Bot not found.",
						404
					);
				}
				const session = store.getSession(params.sessionId ?? "");
				if (!session || session.isPreview || session.botId !== lookup.bot.id) {
					throw new BotFlowsError(
						"expired",
						"This conversation expired. Start a new one.",
						410
					);
				}
				const { turn } = await advance(session, body.value);
				return json(publicTurn(session, turn));
			},
		},
	];

	const compiled = routes.map((route) => {
		const names: string[] = [];
		const pattern = route.path
			.split("/")
			.map((segment) => {
				if (!segment.startsWith(":")) {
					return segment.replaceAll(".", "\\.");
				}
				const name = segment.slice(1);
				names.push(name);
				return PARAM_PATTERNS[name] ?? "([^/]+)";
			})
			.join("/");
		return { ...route, names, regex: new RegExp(`^${API_PREFIX}${pattern}$`) };
	});

	const handler = async (
		request: Request,
		peer?: string
	): Promise<Response> => {
		const url = new URL(request.url);
		const path = url.pathname;
		if (path === "/health" && request.method === "GET") {
			return json({ status: "ok" });
		}
		if (
			(path.startsWith(`${API_PREFIX}/admin/`) ||
				path === `${API_PREFIX}/status`) &&
			!bearerOk(
				request.headers.get("authorization") ?? undefined,
				options.token
			)
		) {
			return errorResponse(
				new BotFlowsError(
					"unauthorized",
					"Ryu has not approved this app request.",
					401
				)
			);
		}
		try {
			let pathMatched = false;
			for (const route of compiled) {
				const match = route.regex.exec(path);
				if (!match) {
					continue;
				}
				pathMatched = true;
				if (route.method !== request.method) {
					continue;
				}
				const params: Record<string, string> = {};
				route.names.forEach((name, index) => {
					params[name] = decodeURIComponent(match[index + 1] ?? "");
				});
				return await route.handler({ params, peer, request, url });
			}
			return errorResponse(
				pathMatched
					? new BotFlowsError("method_not_allowed", "Method not allowed.", 405)
					: new BotFlowsError("not_found", "Resource not found.", 404)
			);
		} catch (cause) {
			return errorResponse(toBotFlowsError(cause));
		}
	};
	/** The served routes (manifest form), checked against manifest.json in tests. */
	const routeList = routes.map(({ method, path }) => ({ method, path }));
	return Object.assign(handler, { routes: routeList });
}

export function createBotFlowsServer(options: BotFlowsServerOptions) {
	if (!options.token) {
		throw new Error("Bot Flows requires its Core-minted extension token");
	}
	const handler = createBotFlowsHandler(options);
	return Bun.serve({
		hostname: "127.0.0.1",
		port: options.port ?? 0,
		fetch: (request, server) =>
			handler(request, server.requestIP(request)?.address),
	});
}
