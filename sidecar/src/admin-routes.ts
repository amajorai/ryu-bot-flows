/**
 * The Companion's authenticated `/admin/*` routes (and `/status`). The
 * public visitor routes stay in `server.ts`.
 */
import type { z } from "zod";
import {
	BOT_LIMITS,
	createBotSchema,
	type Flow,
	type PreviewTurn,
	publishBotSchema,
	putKnowledgeSchema,
	replySchema,
	startSessionSchema,
	updateBotSchema,
} from "./contracts.ts";
import { toCsv } from "./csv.ts";
import type { Turn } from "./engine.ts";
import type { BotHost } from "./host.ts";
import {
	json,
	type RouteContext,
	type RouteDefinition,
	readJson,
	SECURITY_HEADERS,
} from "./server-http.ts";
import {
	BotFlowsError,
	type BotFlowsStore,
	type PublishedBot,
	type StoredSession,
} from "./store.ts";
import { listTemplates } from "./templates.ts";

export interface AdminRouteDeps {
	advance(
		session: StoredSession,
		value: z.infer<typeof replySchema>["value"]
	): Promise<{ flow: Flow; turn: Turn }>;
	begin(
		bot: PublishedBot,
		hidden: Record<string, string>,
		preview: boolean
	): Promise<{ session: StoredSession; turn: Turn }>;
	host: BotHost;
	now: () => Date;
	previewTurn(session: StoredSession, turn: Turn, flow: Flow): PreviewTurn;
	store: BotFlowsStore;
}

function botId(context: RouteContext): string {
	return context.params.id ?? "";
}

export function adminRoutes({
	advance,
	begin,
	host,
	now,
	previewTurn,
	store,
}: AdminRouteDeps): RouteDefinition[] {
	return [
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
	];
}
