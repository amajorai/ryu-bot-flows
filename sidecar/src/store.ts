import { Database } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
	type Answer,
	answerSchema,
	BOT_LIMITS,
	type BotAnalytics,
	type BotDocument,
	type BotListItem,
	blockCount,
	blockEventSchema,
	type CreateBotBody,
	createBotSchema,
	type ExportTable,
	type Flow,
	flowErrors,
	flowSchema,
	handoffRecordSchema,
	isInputBlock,
	type KnowledgeArticle,
	type KnowledgeDocument,
	knowledgeArticleSchema,
	type PutKnowledgeBody,
	putKnowledgeSchema,
	RESERVED_SLUGS,
	type ResultDetail,
	type ResultPage,
	type ResultSummary,
	resultLogSchema,
	type SessionState,
	SLUG_PATTERN,
	sessionStateSchema,
	transcriptEntrySchema,
	type UpdateBotBody,
	updateBotSchema,
} from "./contracts.ts";
import { variablesByName } from "./host.ts";
import { templateFlow } from "./templates.ts";

/**
 * SQL predicate: a result a visitor actually answered. Only these count toward
 * the result quotas, and only these outlive their session (see `purgeExpired`).
 */
const ENGAGED_RESULT = "answers_json<>'[]'";

/**
 * A slug collision. It has its own code and its own status (422, not the 409
 * of a stale revision): reloading the bot cannot fix it, so the editor must
 * not offer that remedy, and the Ryu host bridge forwards only the status to
 * the frame, so the status alone has to tell the two apart.
 */
function slugTakenError(): BotFlowsError {
	return new BotFlowsError("slug_taken", "This link is already in use.", 422);
}

export class BotFlowsError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 400,
		readonly details?: unknown
	) {
		super(message);
	}
}

const botRowSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	status: z.enum(["draft", "published"]),
	draft_json: z.string(),
	published_json: z.string().nullable(),
	published_hash: z.string().nullable(),
	published_at: z.string().nullable(),
	revision: z.number().int(),
	created_at: z.string(),
	updated_at: z.string(),
});
type BotRow = z.infer<typeof botRowSchema>;

const sessionRowSchema = z.object({
	id: z.string(),
	bot_id: z.string(),
	is_preview: z.number().int(),
	flow_hash: z.string(),
	state_json: z.string(),
	expires_at: z.string(),
});

const resultRowSchema = z.object({
	id: z.string(),
	bot_id: z.string(),
	started_at: z.string(),
	updated_at: z.string(),
	completed_at: z.string().nullable(),
	last_block_id: z.string().nullable(),
	answers_json: z.string(),
	variables_json: z.string(),
	transcript_json: z.string(),
	handoffs_json: z.string(),
	logs_json: z.string(),
	events_json: z.string(),
});
type ResultRow = z.infer<typeof resultRowSchema>;

const countSchema = z.object({ count: z.number().int() });
const cursorSchema = z.object({ startedAt: z.string(), id: z.string() });

export interface PublishedBot {
	flow: Flow;
	hash: string;
	id: string;
	name: string;
	slug: string;
}

export type PublicLookup =
	| { kind: "published"; bot: PublishedBot }
	| { kind: "closed"; message: string; allowedEmbedOrigins: string[] }
	| { kind: "missing" };

export interface StoredSession {
	botId: string;
	expiresAt: string;
	flowHash: string;
	id: string;
	isPreview: boolean;
	state: SessionState;
}

export function flowHash(flow: Flow): string {
	return createHash("sha256")
		.update(JSON.stringify(flow))
		.digest("hex")
		.slice(0, 32);
}

/** 128-bit random, url-safe identifier. */
export function randomId(prefix = ""): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `${prefix}${Buffer.from(bytes).toString("base64url")}`;
}

function slugify(name: string): string {
	const base = name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
	return base.length >= 3 ? base : `bot-${base || "new"}`.replace(/-+$/g, "");
}

function parseJson<T>(schema: z.ZodType<T>, value: string): T {
	return schema.parse(JSON.parse(value));
}

export class BotFlowsStore {
	readonly db: Database;

	constructor(path: string) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		}
		this.db = new Database(path, { create: true });
		if (path !== ":memory:") {
			chmodSync(path, 0o600);
		}
		this.db.exec(`
			PRAGMA journal_mode=WAL;
			PRAGMA foreign_keys=ON;
			CREATE TABLE IF NOT EXISTS bots (
				id TEXT PRIMARY KEY,
				slug TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
				draft_json TEXT NOT NULL,
				published_json TEXT,
				published_hash TEXT,
				published_at TEXT,
				revision INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS snapshots (
				bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
				hash TEXT NOT NULL,
				flow_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (bot_id, hash)
			);
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
				is_preview INTEGER NOT NULL,
				flow_hash TEXT NOT NULL,
				state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
			CREATE TABLE IF NOT EXISTS results (
				id TEXT PRIMARY KEY,
				bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
				is_preview INTEGER NOT NULL,
				started_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				last_block_id TEXT,
				answers_json TEXT NOT NULL,
				variables_json TEXT NOT NULL,
				transcript_json TEXT NOT NULL,
				handoffs_json TEXT NOT NULL,
				logs_json TEXT NOT NULL,
				events_json TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS results_bot_started
				ON results(bot_id, is_preview, started_at DESC, id DESC);
			CREATE TABLE IF NOT EXISTS rate_buckets (
				key TEXT NOT NULL,
				window_start INTEGER NOT NULL,
				count INTEGER NOT NULL,
				PRIMARY KEY (key, window_start)
			);
			CREATE TABLE IF NOT EXISTS ai_usage (
				bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
				day TEXT NOT NULL,
				count INTEGER NOT NULL,
				PRIMARY KEY (bot_id, day)
			);
			CREATE TABLE IF NOT EXISTS views (
				bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
				day TEXT NOT NULL,
				count INTEGER NOT NULL,
				PRIMARY KEY (bot_id, day)
			);
			CREATE TABLE IF NOT EXISTS knowledge (
				bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
				articles_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			PRAGMA user_version=1;
		`);
	}

	close(): void {
		this.db.close();
	}

	// -------------------------------------------------------------------------
	// Bots
	// -------------------------------------------------------------------------

	private row(id: string): BotRow {
		const row = botRowSchema
			.nullable()
			.parse(this.db.query("SELECT * FROM bots WHERE id=?").get(id));
		if (!row) {
			throw new BotFlowsError("not_found", "Bot not found.", 404);
		}
		return row;
	}

	private toDocument(row: BotRow): BotDocument {
		const flow = parseJson(flowSchema, row.draft_json);
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			status: row.status,
			flow,
			revision: row.revision,
			publishedAt: row.published_at,
			hasUnpublishedChanges:
				row.status === "published" && row.published_hash !== flowHash(flow),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	list(): BotListItem[] {
		const rows = z
			.array(botRowSchema)
			.parse(
				this.db.query("SELECT * FROM bots ORDER BY updated_at DESC, id").all()
			);
		const counts = z
			.array(
				z.object({
					bot_id: z.string(),
					total: z.number().int(),
					completed: z.number().int(),
				})
			)
			.parse(
				this.db
					.query(
						`SELECT bot_id, COUNT(*) AS total, COUNT(completed_at) AS completed
						 FROM results WHERE is_preview=0 GROUP BY bot_id`
					)
					.all()
			);
		const byBot = new Map(counts.map((entry) => [entry.bot_id, entry]));
		return rows.map((row) => {
			const { flow, ...document } = this.toDocument(row);
			return {
				...document,
				blockCount: blockCount(flow),
				resultCount: byBot.get(row.id)?.total ?? 0,
				completedCount: byBot.get(row.id)?.completed ?? 0,
			};
		});
	}

	counts(): { bots: number; published: number } {
		const bots = countSchema.parse(
			this.db.query("SELECT COUNT(*) AS count FROM bots").get()
		);
		const published = countSchema.parse(
			this.db
				.query("SELECT COUNT(*) AS count FROM bots WHERE status='published'")
				.get()
		);
		return { bots: bots.count, published: published.count };
	}

	get(id: string): BotDocument {
		return this.toDocument(this.row(id));
	}

	private slugTaken(slug: string, exceptId?: string): boolean {
		const row = this.db.query("SELECT id FROM bots WHERE slug=?").get(slug) as {
			id: string;
		} | null;
		return Boolean(row && row.id !== exceptId);
	}

	private availableSlug(name: string): string {
		const base = slugify(name);
		if (
			!(
				this.slugTaken(base) ||
				(RESERVED_SLUGS as readonly string[]).includes(base)
			) &&
			SLUG_PATTERN.test(base)
		) {
			return base;
		}
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const candidate = `${base.slice(0, 40)}-${randomId()
				.slice(0, 5)
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "x")}`;
			if (SLUG_PATTERN.test(candidate) && !this.slugTaken(candidate)) {
				return candidate;
			}
		}
		throw new BotFlowsError(
			"conflict",
			"Could not find a free link for this bot.",
			409
		);
	}

	create(input: CreateBotBody, now = new Date()): BotDocument {
		const parsed = createBotSchema.parse(input);
		if (this.counts().bots >= BOT_LIMITS.bots) {
			throw new BotFlowsError("quota", "Bot limit reached.", 429);
		}
		const flow = parsed.flow ?? templateFlow(parsed.templateId ?? "blank");
		if (parsed.slug && this.slugTaken(parsed.slug)) {
			throw slugTakenError();
		}
		const slug = parsed.slug ?? this.availableSlug(parsed.name);
		const id = randomId("bot_");
		const at = now.toISOString();
		this.db
			.query(
				`INSERT INTO bots (id, slug, name, status, draft_json, revision, created_at, updated_at)
				 VALUES (?, ?, ?, 'draft', ?, 0, ?, ?)`
			)
			.run(id, slug, parsed.name, JSON.stringify(flow), at, at);
		return this.get(id);
	}

	update(id: string, input: UpdateBotBody, now = new Date()): BotDocument {
		const parsed = updateBotSchema.parse(input);
		return this.db.transaction(() => {
			const row = this.row(id);
			if (row.revision !== parsed.revision) {
				throw new BotFlowsError(
					"conflict",
					"This bot changed since you opened it. Reload it before saving.",
					409
				);
			}
			if (parsed.slug && this.slugTaken(parsed.slug, id)) {
				throw slugTakenError();
			}
			this.db
				.query(
					"UPDATE bots SET name=?, slug=?, draft_json=?, revision=revision+1, updated_at=? WHERE id=?"
				)
				.run(
					parsed.name ?? row.name,
					parsed.slug ?? row.slug,
					parsed.flow ? JSON.stringify(parsed.flow) : row.draft_json,
					now.toISOString(),
					id
				);
			return this.get(id);
		})();
	}

	private putSnapshot(botId: string, flow: Flow, now: Date): string {
		const hash = flowHash(flow);
		this.db
			.query(
				`INSERT INTO snapshots (bot_id, hash, flow_json, created_at) VALUES (?, ?, ?, ?)
				 ON CONFLICT(bot_id, hash) DO NOTHING`
			)
			.run(botId, hash, JSON.stringify(flow), now.toISOString());
		return hash;
	}

	/**
	 * Snapshots the draft; new public sessions use it, live ones keep theirs.
	 * With `expectedRevision`, refuses to publish a draft the caller has not seen.
	 */
	publish(
		id: string,
		now = new Date(),
		expectedRevision?: number
	): BotDocument {
		return this.db.transaction(() => {
			const document = this.get(id);
			if (
				expectedRevision !== undefined &&
				document.revision !== expectedRevision
			) {
				throw new BotFlowsError(
					"conflict",
					"This bot changed since you opened it. Reload it before publishing.",
					409
				);
			}
			const errors = flowErrors(document.flow);
			if (errors.length > 0) {
				throw new BotFlowsError(
					"invalid_flow",
					`Fix this before publishing: ${errors[0]?.message ?? "the flow is invalid."}`,
					400,
					errors
				);
			}
			const hash = this.putSnapshot(id, document.flow, now);
			const at = now.toISOString();
			this.db
				.query(
					`UPDATE bots SET status='published', published_json=?, published_hash=?,
					 published_at=?, updated_at=? WHERE id=?`
				)
				.run(JSON.stringify(document.flow), hash, at, at, id);
			return this.get(id);
		})();
	}

	unpublish(id: string, now = new Date()): BotDocument {
		this.row(id);
		this.db
			.query(
				`UPDATE bots SET status='draft', published_json=NULL, published_hash=NULL,
				 published_at=NULL, updated_at=? WHERE id=?`
			)
			.run(now.toISOString(), id);
		return this.get(id);
	}

	duplicate(id: string, now = new Date()): BotDocument {
		const source = this.get(id);
		const copy = this.create(
			{
				name: `${source.name} (copy)`.slice(0, BOT_LIMITS.nameLength),
				flow: source.flow,
			},
			now
		);
		const knowledge = this.getKnowledge(id);
		if (knowledge.articles.length > 0) {
			this.putKnowledge(copy.id, { articles: knowledge.articles }, now);
		}
		return copy;
	}

	delete(id: string): void {
		const result = this.db.query("DELETE FROM bots WHERE id=?").run(id);
		if (result.changes === 0) {
			throw new BotFlowsError("not_found", "Bot not found.", 404);
		}
	}

	/** Resolves a public slug to its published snapshot, or why it is closed. */
	lookupPublic(slug: string): PublicLookup {
		const row = botRowSchema
			.nullable()
			.parse(this.db.query("SELECT * FROM bots WHERE slug=?").get(slug));
		if (!row) {
			return { kind: "missing" };
		}
		if (
			row.status !== "published" ||
			!row.published_json ||
			!row.published_hash
		) {
			const draft = flowSchema.safeParse(JSON.parse(row.draft_json));
			return {
				kind: "closed",
				message: draft.success
					? draft.data.settings.closedMessage
					: "This bot isn't taking conversations right now.",
				allowedEmbedOrigins: draft.success
					? draft.data.settings.allowedEmbedOrigins
					: [],
			};
		}
		return {
			kind: "published",
			bot: {
				id: row.id,
				slug: row.slug,
				name: row.name,
				hash: row.published_hash,
				flow: parseJson(flowSchema, row.published_json),
			},
		};
	}

	/** Snapshots the current draft for a preview session. */
	draftSnapshot(id: string, now = new Date()): PublishedBot {
		const row = this.row(id);
		const flow = parseJson(flowSchema, row.draft_json);
		const hash = this.putSnapshot(id, flow, now);
		return { id: row.id, slug: row.slug, name: row.name, hash, flow };
	}

	snapshot(botId: string, hash: string): Flow | null {
		const row = z
			.object({ flow_json: z.string() })
			.nullable()
			.parse(
				this.db
					.query("SELECT flow_json FROM snapshots WHERE bot_id=? AND hash=?")
					.get(botId, hash)
			);
		return row ? parseJson(flowSchema, row.flow_json) : null;
	}

	identity(botId: string): { id: string; name: string; slug: string } {
		const row = this.row(botId);
		return { id: row.id, name: row.name, slug: row.slug };
	}

	// -------------------------------------------------------------------------
	// Sessions and results
	// -------------------------------------------------------------------------

	/**
	 * Throws when the bot (or the node) holds too many conversations. Only
	 * results with at least one answer count: an unanswered start costs an
	 * anonymous caller nothing, so it must not be able to fill the quota (and
	 * `purgeExpired` drops those once their session ends).
	 */
	assertCanStart(botId: string): void {
		const forBot = countSchema.parse(
			this.db
				.query(
					`SELECT COUNT(*) AS count FROM results WHERE bot_id=? AND is_preview=0 AND ${ENGAGED_RESULT}`
				)
				.get(botId)
		);
		const total = countSchema.parse(
			this.db
				.query(
					`SELECT COUNT(*) AS count FROM results WHERE is_preview=0 AND ${ENGAGED_RESULT}`
				)
				.get()
		);
		if (
			forBot.count >= BOT_LIMITS.resultsPerBot ||
			total.count >= BOT_LIMITS.resultsTotal
		) {
			throw new BotFlowsError(
				"quota",
				"This bot isn't accepting new conversations right now.",
				429
			);
		}
	}

	/**
	 * Stores a new session and its result. Public starts check `assertCanStart`
	 * before running the engine, so this never refuses a conversation whose
	 * start already ran (and may have spent AI budget or emitted events); the
	 * quota is therefore soft by at most the starts in flight at once.
	 */
	createSession(input: {
		botId: string;
		flow: Flow;
		flowHash: string;
		isPreview: boolean;
		now?: Date;
		sessionId: string;
		state: SessionState;
	}): StoredSession {
		const now = input.now ?? new Date();
		return this.db.transaction(() => {
			const at = now.toISOString();
			const expiresAt = new Date(
				now.getTime() + BOT_LIMITS.sessionTtlMs
			).toISOString();
			this.db
				.query(
					`INSERT INTO sessions (id, bot_id, is_preview, flow_hash, state_json, created_at, updated_at, expires_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.run(
					input.sessionId,
					input.botId,
					input.isPreview ? 1 : 0,
					input.flowHash,
					JSON.stringify(input.state),
					at,
					at,
					expiresAt
				);
			this.db
				.query(
					`INSERT INTO results (id, bot_id, is_preview, started_at, updated_at, completed_at, last_block_id,
					 answers_json, variables_json, transcript_json, handoffs_json, logs_json, events_json)
					 VALUES (?, ?, ?, ?, ?, NULL, NULL, '[]', '{}', '[]', '[]', '[]', '[]')`
				)
				.run(
					input.state.resultId,
					input.botId,
					input.isPreview ? 1 : 0,
					at,
					at
				);
			this.writeResult(input.state, input.flow, now);
			return {
				id: input.sessionId,
				botId: input.botId,
				isPreview: input.isPreview,
				flowHash: input.flowHash,
				state: input.state,
				expiresAt,
			};
		})();
	}

	getSession(id: string): StoredSession | null {
		const row = sessionRowSchema
			.nullable()
			.parse(this.db.query("SELECT * FROM sessions WHERE id=?").get(id));
		if (!row) {
			return null;
		}
		return {
			id: row.id,
			botId: row.bot_id,
			isPreview: row.is_preview === 1,
			flowHash: row.flow_hash,
			state: parseJson(sessionStateSchema, row.state_json),
			expiresAt: row.expires_at,
		};
	}

	saveSession(
		id: string,
		state: SessionState,
		flow: Flow,
		now = new Date()
	): void {
		this.db.transaction(() => {
			this.db
				.query("UPDATE sessions SET state_json=?, updated_at=? WHERE id=?")
				.run(JSON.stringify(state), now.toISOString(), id);
			this.writeResult(state, flow, now);
		})();
	}

	private writeResult(state: SessionState, flow: Flow, now: Date): void {
		this.db
			.query(
				`UPDATE results SET updated_at=?, completed_at=?, last_block_id=?, answers_json=?,
				 variables_json=?, transcript_json=?, handoffs_json=?, logs_json=?, events_json=? WHERE id=?`
			)
			.run(
				now.toISOString(),
				state.completedAt,
				state.lastBlockId ?? state.events.at(-1)?.blockId ?? null,
				JSON.stringify(state.answers),
				JSON.stringify(variablesByName(flow, state)),
				JSON.stringify(state.transcript),
				JSON.stringify(state.handoffs),
				JSON.stringify(state.logs),
				JSON.stringify(state.events),
				state.resultId
			);
	}

	private toSummary(row: ResultRow): ResultSummary {
		const answers = parseJson(z.array(answerSchema), row.answers_json);
		return {
			id: row.id,
			startedAt: row.started_at,
			updatedAt: row.updated_at,
			completedAt: row.completed_at,
			lastBlockId: row.last_block_id,
			answerCount: answers.length,
			handoffCount: parseJson(z.array(handoffRecordSchema), row.handoffs_json)
				.length,
			preview: answerPreview(answers),
		};
	}

	results(
		botId: string,
		cursor: string | null,
		requestedLimit: number = BOT_LIMITS.resultsPage
	): ResultPage {
		this.row(botId);
		const limit = Math.max(
			1,
			Math.min(BOT_LIMITS.resultsPage, Math.floor(requestedLimit))
		);
		const decoded = cursor ? decodeCursor(cursor) : null;
		const rows = z.array(resultRowSchema).parse(
			decoded
				? this.db
						.query(
							`SELECT * FROM results WHERE bot_id=? AND is_preview=0
							 AND (started_at<? OR (started_at=? AND id<?))
							 ORDER BY started_at DESC, id DESC LIMIT ?`
						)
						.all(
							botId,
							decoded.startedAt,
							decoded.startedAt,
							decoded.id,
							limit + 1
						)
				: this.db
						.query(
							`SELECT * FROM results WHERE bot_id=? AND is_preview=0
							 ORDER BY started_at DESC, id DESC LIMIT ?`
						)
						.all(botId, limit + 1)
		);
		const items = rows.slice(0, limit).map((row) => this.toSummary(row));
		const last = items.at(-1);
		return {
			items,
			nextCursor:
				rows.length > limit && last
					? Buffer.from(
							JSON.stringify({ startedAt: last.startedAt, id: last.id })
						).toString("base64url")
					: null,
		};
	}

	result(botId: string, resultId: string): ResultDetail {
		const row = resultRowSchema
			.nullable()
			.parse(
				this.db
					.query(
						"SELECT * FROM results WHERE id=? AND bot_id=? AND is_preview=0"
					)
					.get(resultId, botId)
			);
		if (!row) {
			throw new BotFlowsError("not_found", "Result not found.", 404);
		}
		const { preview: _preview, ...summary } = this.toSummary(row);
		return {
			...summary,
			botId: row.bot_id,
			answers: parseJson(z.array(answerSchema), row.answers_json),
			variables: parseJson(
				z.record(z.string(), z.string()),
				row.variables_json
			),
			transcript: parseJson(
				z.array(transcriptEntrySchema),
				row.transcript_json
			),
			handoffs: parseJson(z.array(handoffRecordSchema), row.handoffs_json),
			logs: parseJson(z.array(resultLogSchema), row.logs_json),
		};
	}

	private allResults(botId: string): ResultRow[] {
		return z
			.array(resultRowSchema)
			.parse(
				this.db
					.query(
						"SELECT * FROM results WHERE bot_id=? AND is_preview=0 ORDER BY started_at ASC, id ASC"
					)
					.all(botId)
			);
	}

	exportTable(botId: string): ExportTable {
		const document = this.get(botId);
		const names = document.flow.variables.map((variable) => variable.name);
		const rows = this.allResults(botId).map((row) => {
			const variables = parseJson(
				z.record(z.string(), z.string()),
				row.variables_json
			);
			const handoffs = parseJson(
				z.array(handoffRecordSchema),
				row.handoffs_json
			);
			return [
				row.id,
				row.started_at,
				row.completed_at ?? "",
				...names.map((name) => variables[name] ?? ""),
				handoffs.map((handoff) => handoff.topic).join("; "),
				row.last_block_id ?? "",
			];
		});
		return {
			columns: [
				"result_id",
				"started_at",
				"completed_at",
				...names,
				"handoff_topics",
				"last_block_id",
			],
			rows,
		};
	}

	analytics(botId: string): BotAnalytics {
		const row = this.row(botId);
		const flow = parseJson(flowSchema, row.published_json ?? row.draft_json);
		const views = countSchema.parse(
			this.db
				.query(
					"SELECT COALESCE(SUM(count), 0) AS count FROM views WHERE bot_id=?"
				)
				.get(botId)
		).count;
		const results = this.allResults(botId);
		const reached = new Map<string, number>();
		const answered = new Map<string, number>();
		let engaged = 0;
		let completed = 0;
		let handoffs = 0;
		for (const result of results) {
			const events = parseJson(z.array(blockEventSchema), result.events_json);
			for (const event of events) {
				const counter = event.type === "reached" ? reached : answered;
				counter.set(event.blockId, (counter.get(event.blockId) ?? 0) + 1);
			}
			if (events.some((event) => event.type === "answered")) {
				engaged += 1;
			}
			if (result.completed_at) {
				completed += 1;
			}
			handoffs += parseJson(
				z.array(handoffRecordSchema),
				result.handoffs_json
			).length;
		}
		const blocks = flow.groups.flatMap((group) =>
			group.blocks.filter(isInputBlock).map((block) => {
				const reachedCount = reached.get(block.id) ?? 0;
				const answeredCount = answered.get(block.id) ?? 0;
				return {
					blockId: block.id,
					groupId: group.id,
					groupTitle: group.title,
					type: block.type,
					label: inputLabel(group.blocks, block.id),
					reached: reachedCount,
					answered: answeredCount,
					dropOff:
						reachedCount > 0
							? Math.max(0, (reachedCount - answeredCount) / reachedCount)
							: 0,
				};
			})
		);
		return {
			views,
			started: results.length,
			engaged,
			completed,
			completionRate: results.length > 0 ? completed / results.length : 0,
			handoffs,
			blocks,
		};
	}

	recordView(botId: string, now = new Date()): void {
		this.db
			.query(
				`INSERT INTO views (bot_id, day, count) VALUES (?, ?, 1)
				 ON CONFLICT(bot_id, day) DO UPDATE SET count=count+1`
			)
			.run(botId, now.toISOString().slice(0, 10));
	}

	// -------------------------------------------------------------------------
	// Budgets and rate limits
	// -------------------------------------------------------------------------

	/** Spends one daily AI reply for the bot; false when the budget is used up. */
	consumeAiTurn(botId: string, perDay: number, now = new Date()): boolean {
		return this.db.transaction(() => {
			const day = now.toISOString().slice(0, 10);
			const used = countSchema
				.nullable()
				.parse(
					this.db
						.query("SELECT count FROM ai_usage WHERE bot_id=? AND day=?")
						.get(botId, day)
				);
			if ((used?.count ?? 0) >= perDay) {
				return false;
			}
			this.db
				.query(
					`INSERT INTO ai_usage (bot_id, day, count) VALUES (?, ?, 1)
					 ON CONFLICT(bot_id, day) DO UPDATE SET count=count+1`
				)
				.run(botId, day);
			return true;
		})();
	}

	/** Fixed-window counter; returns false once `limit` hits land in the window. */
	hit(key: string, limit: number, windowMs: number, now = new Date()): boolean {
		return this.db.transaction(() => {
			const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
			const used = countSchema
				.nullable()
				.parse(
					this.db
						.query(
							"SELECT count FROM rate_buckets WHERE key=? AND window_start=?"
						)
						.get(key, windowStart)
				);
			if ((used?.count ?? 0) >= limit) {
				return false;
			}
			this.db
				.query(
					`INSERT INTO rate_buckets (key, window_start, count) VALUES (?, ?, 1)
					 ON CONFLICT(key, window_start) DO UPDATE SET count=count+1`
				)
				.run(key, windowStart);
			return true;
		})();
	}

	/** Deletes one stored conversation; false when it does not exist. */
	deleteResult(botId: string, resultId: string): boolean {
		this.row(botId);
		return (
			this.db
				.query("DELETE FROM results WHERE id=? AND bot_id=? AND is_preview=0")
				.run(resultId, botId).changes > 0
		);
	}

	/** Deletes every stored conversation of a bot; returns how many. */
	clearResults(botId: string): number {
		this.row(botId);
		return this.db
			.query("DELETE FROM results WHERE bot_id=? AND is_preview=0")
			.run(botId).changes;
	}

	/**
	 * Drops expired sessions, preview results, stale buckets, unused snapshots,
	 * and public results nobody answered once their session has ended. An
	 * unanswered start costs an anonymous caller one request, so keeping it
	 * would let starts alone fill the node; the trade-off is that analytics
	 * (`started`, completions of flows with no input) only cover a day of them.
	 */
	purgeExpired(now = new Date()): void {
		const at = now.toISOString();
		const dayAgo = new Date(now.getTime() - BOT_LIMITS.sessionTtlMs);
		this.db.transaction(() => {
			this.db.query("DELETE FROM sessions WHERE expires_at<=?").run(at);
			this.db
				.query("DELETE FROM results WHERE is_preview=1 AND started_at<=?")
				.run(dayAgo.toISOString());
			// Sessions live `sessionTtlMs` from their start, so a result started
			// that long ago has no session left that could still answer it.
			this.db
				.query(
					`DELETE FROM results WHERE is_preview=0 AND NOT (${ENGAGED_RESULT}) AND started_at<=?`
				)
				.run(dayAgo.toISOString());
			this.db
				.query("DELETE FROM rate_buckets WHERE window_start<?")
				.run(dayAgo.getTime());
			this.db
				.query(
					`DELETE FROM snapshots WHERE NOT EXISTS (
						SELECT 1 FROM sessions WHERE sessions.bot_id=snapshots.bot_id AND sessions.flow_hash=snapshots.hash
					) AND NOT EXISTS (
						SELECT 1 FROM bots WHERE bots.id=snapshots.bot_id AND bots.published_hash=snapshots.hash
					)`
				)
				.run();
		})();
	}

	// -------------------------------------------------------------------------
	// Knowledge
	// -------------------------------------------------------------------------

	getKnowledge(botId: string): KnowledgeDocument {
		this.row(botId);
		const row = z
			.object({ articles_json: z.string(), updated_at: z.string() })
			.nullable()
			.parse(
				this.db
					.query(
						"SELECT articles_json, updated_at FROM knowledge WHERE bot_id=?"
					)
					.get(botId)
			);
		return row
			? {
					articles: parseJson(
						z.array(knowledgeArticleSchema),
						row.articles_json
					),
					updatedAt: row.updated_at,
				}
			: { articles: [], updatedAt: null };
	}

	putKnowledge(
		botId: string,
		input: PutKnowledgeBody,
		now = new Date()
	): KnowledgeDocument {
		const parsed = putKnowledgeSchema.parse(input);
		this.row(botId);
		const seen = new Set<string>();
		const articles: KnowledgeArticle[] = parsed.articles.map((article) => {
			let id = article.id ?? randomId("kb_").slice(0, 24);
			if (seen.has(id)) {
				id = randomId("kb_").slice(0, 24);
			}
			seen.add(id);
			return { id, title: article.title, body: article.body };
		});
		this.db
			.query(
				`INSERT INTO knowledge (bot_id, articles_json, updated_at) VALUES (?, ?, ?)
				 ON CONFLICT(bot_id) DO UPDATE SET articles_json=excluded.articles_json, updated_at=excluded.updated_at`
			)
			.run(botId, JSON.stringify(articles), now.toISOString());
		return { articles, updatedAt: now.toISOString() };
	}
}

function answerPreview(answers: Answer[]): string {
	const text = answers
		.slice(0, 3)
		.map((answer) => answer.label)
		.join(" · ");
	return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** The text bubble right before an input usually holds its question. */
function inputLabel(
	blocks: Flow["groups"][number]["blocks"],
	blockId: string
): string {
	const index = blocks.findIndex((block) => block.id === blockId);
	const previous = index > 0 ? blocks[index - 1] : undefined;
	const block = blocks[index];
	if (previous?.type === "text") {
		return previous.content.slice(0, 120);
	}
	return block && "placeholder" in block && block.placeholder
		? block.placeholder
		: (block?.type ?? blockId);
}

function decodeCursor(cursor: string): { id: string; startedAt: string } {
	try {
		return cursorSchema.parse(
			JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
		);
	} catch {
		throw new BotFlowsError("invalid_cursor", "Results cursor is invalid.");
	}
}
