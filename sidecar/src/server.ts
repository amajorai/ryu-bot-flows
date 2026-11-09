import { bearerOk } from "@ryu/sidecar-runtime";
import type { z } from "zod";
import { adminRoutes } from "./admin-routes.ts";
import {
	BOT_LIMITS,
	type Flow,
	type PreviewTurn,
	type PublicTurn,
	replySchema,
	startSessionSchema,
} from "./contracts.ts";
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
import { renderChatPage } from "./respondent.ts";
import { localizeEngineDefaults } from "./respondent-errors.ts";
import {
	negotiateRespondentLocale,
	type RespondentLocale,
} from "./respondent-locale.ts";
import {
	closedResponse,
	errorResponse,
	htmlResponse,
	json,
	PARAM_PATTERNS,
	type RouteDefinition,
	readJson,
	toBotFlowsError,
	visitorKey,
} from "./server-http.ts";
import {
	BotFlowsError,
	type BotFlowsStore,
	type PublishedBot,
	randomId,
	type StoredSession,
} from "./store.ts";

export { ANONYMOUS_VISITOR, visitorKey } from "./server-http.ts";

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

/** The language public chat replies render engine defaults in. */
function visitorLocale(request: Request): RespondentLocale {
	return negotiateRespondentLocale(request.headers.get("accept-language"));
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

	function publicTurn(
		session: StoredSession,
		turn: Turn,
		visitor?: RespondentLocale
	): PublicTurn {
		return {
			sessionId: session.id,
			messages: visitor
				? localizeEngineDefaults(turn.messages, visitor)
				: turn.messages,
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

	const routes: RouteDefinition[] = [
		...adminRoutes({ store, host, now, begin, advance, previewTurn }),
		{
			method: "GET",
			path: "/:slug",
			handler: ({ params, url, peer, request }) => {
				const lookup = store.lookupPublic(params.slug ?? "");
				if (lookup.kind === "missing") {
					return closedResponse(
						"This bot doesn't exist.",
						[],
						request.headers.get("accept-language")
					);
				}
				if (lookup.kind === "closed") {
					return closedResponse(
						lookup.message,
						lookup.allowedEmbedOrigins,
						request.headers.get("accept-language")
					);
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
					acceptLanguage: request.headers.get("accept-language"),
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
				return json(publicTurn(session, turn, visitorLocale(request)), 201);
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
				return json(publicTurn(session, turn, visitorLocale(request)));
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
