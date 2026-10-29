import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOT_LIMITS, type Flow } from "./contracts.ts";
import { reply, startSession } from "./engine.ts";
import { BotFlowsError, BotFlowsStore } from "./store.ts";
import { FIXED_NOW, testDeps } from "./test-fixtures.ts";

const stores: BotFlowsStore[] = [];
const directories: string[] = [];

function openStore(path = ":memory:"): BotFlowsStore {
	const store = new BotFlowsStore(path);
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

async function startStoredSession(
	store: BotFlowsStore,
	slug: string,
	sessionId: string,
	at = FIXED_NOW
) {
	const lookup = store.lookupPublic(slug);
	if (lookup.kind !== "published") {
		throw new Error("bot is not published");
	}
	const turn = await startSession(
		lookup.bot.flow,
		{},
		testDeps({ now: () => at }),
		`r_${sessionId}`
	);
	return store.createSession({
		botId: lookup.bot.id,
		flow: lookup.bot.flow,
		flowHash: lookup.bot.hash,
		isPreview: false,
		sessionId,
		state: turn.state,
		now: at,
	});
}

function editedFlow(flow: Flow, content: string): Flow {
	const next = structuredClone(flow);
	const first = next.groups[0]?.blocks[0];
	if (first?.type === "text") {
		first.content = content;
	}
	return next;
}

/** Inserts `count` public results directly (fast quota fixtures). */
function insertResults(
	store: BotFlowsStore,
	botId: string,
	count: number,
	options: { answered: boolean; prefix: string; startedAt?: Date }
): void {
	const insert = store.db.query(
		`INSERT INTO results (id, bot_id, is_preview, started_at, updated_at, completed_at, last_block_id,
		 answers_json, variables_json, transcript_json, handoffs_json, logs_json, events_json)
		 VALUES (?, ?, 0, ?, ?, NULL, NULL, ?, '{}', '[]', '[]', '[]', '[]')`
	);
	const at = (options.startedAt ?? FIXED_NOW).toISOString();
	const answers = options.answered
		? JSON.stringify([{ blockId: "b", variable: "v", value: "x", at }])
		: "[]";
	store.db.transaction(() => {
		for (let index = 0; index < count; index += 1) {
			insert.run(`${options.prefix}${index}`, botId, at, at, answers);
		}
	})();
}

describe("BotFlowsStore", () => {
	it("creates bots from templates with unique slugs and guards revisions", () => {
		const store = openStore();
		const first = store.create({
			name: "Support Bot",
			templateId: "support-triage",
		});
		const second = store.create({ name: "Support Bot" });
		expect(first.slug).toBe("support-bot");
		expect(second.slug).not.toBe(first.slug);
		expect(second.slug).toStartWith("support-bot-");
		expect(first.flow.groups.length).toBeGreaterThan(3);
		expect(() => store.create({ name: "Taken", slug: "support-bot" })).toThrow(
			"already in use"
		);

		const saved = store.update(first.id, { revision: 0, name: "Renamed" });
		expect(saved.revision).toBe(1);
		expect(saved.name).toBe("Renamed");
		try {
			store.update(first.id, { revision: 0, name: "Stale" });
			throw new Error("expected a conflict");
		} catch (cause) {
			expect(cause).toBeInstanceOf(BotFlowsError);
			expect((cause as BotFlowsError).status).toBe(409);
		}
		expect(store.list().map((bot) => bot.id)).toContain(first.id);
	});

	it("pins sessions to the snapshot they started with across republishes", async () => {
		const store = openStore();
		const bot = store.create({ name: "Pinned", templateId: "blank" });
		expect(store.lookupPublic(bot.slug).kind).toBe("closed");
		store.publish(bot.id);
		const session = await startStoredSession(store, bot.slug, "s_old");
		const oldFlow = store.snapshot(bot.id, session.flowHash);
		expect(oldFlow?.groups[0]?.blocks[0]).toMatchObject({
			content: "Hi there! How can I help you today?",
		});

		const draft = store.update(bot.id, {
			revision: 0,
			flow: editedFlow(bot.flow, "New greeting"),
		});
		expect(draft.hasUnpublishedChanges).toBe(true);
		const republished = store.publish(bot.id);
		expect(republished.hasUnpublishedChanges).toBe(false);
		const lookup = store.lookupPublic(bot.slug);
		expect(lookup.kind === "published" && lookup.bot.hash).not.toBe(
			session.flowHash
		);
		expect(store.snapshot(bot.id, session.flowHash)).toEqual(oldFlow);
		expect(store.getSession("s_old")?.flowHash).toBe(session.flowHash);

		store.unpublish(bot.id);
		expect(store.lookupPublic(bot.slug)).toEqual({
			kind: "closed",
			message: bot.flow.settings.closedMessage,
			allowedEmbedOrigins: [],
		});
		expect(store.lookupPublic("no-such-bot").kind).toBe("missing");
	});

	it("refuses to publish a flow with errors", () => {
		const store = openStore();
		const bot = store.create({ name: "Broken" });
		const flow = structuredClone(bot.flow);
		flow.startGroupId = "missing";
		store.update(bot.id, { revision: 0, flow });
		expect(() => store.publish(bot.id)).toThrow("Fix this before publishing");
	});

	it("paginates results newest first with a cursor and hides previews", async () => {
		const store = openStore();
		const bot = store.create({ name: "Paged", templateId: "contact-form" });
		store.publish(bot.id);
		for (let index = 0; index < 5; index += 1) {
			await startStoredSession(
				store,
				bot.slug,
				`s_${index}`,
				new Date(FIXED_NOW.getTime() + index * 1000)
			);
		}
		const preview = store.draftSnapshot(bot.id);
		store.createSession({
			botId: bot.id,
			flow: preview.flow,
			flowHash: preview.hash,
			isPreview: true,
			sessionId: "s_preview",
			state: (await startSession(preview.flow, {}, testDeps(), "r_preview"))
				.state,
		});
		const first = store.results(bot.id, null, 2);
		expect(first.items.map((item) => item.id)).toEqual(["r_s_4", "r_s_3"]);
		const second = store.results(bot.id, first.nextCursor, 2);
		expect(second.items.map((item) => item.id)).toEqual(["r_s_2", "r_s_1"]);
		const third = store.results(bot.id, second.nextCursor, 2);
		expect(third.items.map((item) => item.id)).toEqual(["r_s_0"]);
		expect(third.nextCursor).toBeNull();
		expect(() => store.results(bot.id, "not-a-cursor")).toThrow("cursor");
		expect(() => store.result(bot.id, "r_preview")).toThrow("not found");
		expect(store.result(bot.id, "r_s_0").transcript[0]?.from).toBe("bot");
		expect(store.list()[0]?.resultCount).toBe(5);
	});

	it("expires sessions after 24 hours and drops unused snapshots", async () => {
		const store = openStore();
		const bot = store.create({ name: "Expiring" });
		store.publish(bot.id);
		const session = await startStoredSession(store, bot.slug, "s_ttl");
		expect(Date.parse(session.expiresAt) - FIXED_NOW.getTime()).toBe(
			BOT_LIMITS.sessionTtlMs
		);
		store.update(bot.id, { revision: 0, flow: editedFlow(bot.flow, "v2") });
		store.publish(bot.id);
		store.purgeExpired(new Date(FIXED_NOW.getTime() + 1000));
		expect(store.getSession("s_ttl")).not.toBeNull();
		expect(store.snapshot(bot.id, session.flowHash)).not.toBeNull();
		store.purgeExpired(
			new Date(FIXED_NOW.getTime() + BOT_LIMITS.sessionTtlMs + 1)
		);
		expect(store.getSession("s_ttl")).toBeNull();
		expect(store.snapshot(bot.id, session.flowHash)).toBeNull();
		const current = store.lookupPublic(bot.slug);
		expect(
			current.kind === "published" && store.snapshot(bot.id, current.bot.hash)
		).toBeTruthy();
	});

	it("counts rate buckets and daily AI budgets", () => {
		const store = openStore();
		const bot = store.create({ name: "Limits" });
		expect([1, 2, 3].map(() => store.hit("k", 2, 60_000, FIXED_NOW))).toEqual([
			true,
			true,
			false,
		]);
		expect(
			store.hit("k", 2, 60_000, new Date(FIXED_NOW.getTime() + 60_000))
		).toBe(true);
		expect([1, 2].map(() => store.consumeAiTurn(bot.id, 1, FIXED_NOW))).toEqual(
			[true, false]
		);
		expect(
			store.consumeAiTurn(bot.id, 1, new Date("2026-10-20T00:00:01Z"))
		).toBe(true);
	});

	it("replaces knowledge, copies it on duplicate, and cascades deletes", () => {
		const store = openStore();
		const bot = store.create({ name: "Knowledge" });
		const saved = store.putKnowledge(bot.id, {
			articles: [{ title: "Refunds", body: "Five days." }],
		});
		expect(saved.articles[0]?.id).toStartWith("kb_");
		const copy = store.duplicate(bot.id);
		expect(copy.name).toBe("Knowledge (copy)");
		expect(store.getKnowledge(copy.id).articles).toEqual(saved.articles);
		store.delete(bot.id);
		expect(() => store.get(bot.id)).toThrow("not found");
		expect(() => store.delete(bot.id)).toThrow("not found");
		expect(store.getKnowledge(copy.id).articles).toHaveLength(1);
	});

	it("persists to a private file and reopens", () => {
		const directory = mkdtempSync(join(tmpdir(), "bot-flows-store-"));
		directories.push(directory);
		const path = join(directory, "nested", "bot-flows.sqlite");
		const store = openStore(path);
		const bot = store.create({ name: "Durable" });
		expect(statSync(path).mode & 0o777).toBe(0o600);
		store.close();
		stores.splice(stores.indexOf(store), 1);
		const reopened = openStore(path);
		expect(reopened.get(bot.id).name).toBe("Durable");
	});

	it("counts only answered results toward the quota and purges unanswered ones", () => {
		const store = openStore();
		const bot = store.create({ name: "Quota", templateId: "contact-form" });
		store.publish(bot.id);
		insertResults(store, bot.id, BOT_LIMITS.resultsPerBot, {
			answered: false,
			prefix: "r_empty_",
		});
		// Empty starts alone never lock real visitors out.
		expect(() => store.assertCanStart(bot.id)).not.toThrow();
		insertResults(store, bot.id, BOT_LIMITS.resultsPerBot, {
			answered: true,
			prefix: "r_real_",
		});
		expect(() => store.assertCanStart(bot.id)).toThrow("accepting new");
		store.purgeExpired(
			new Date(FIXED_NOW.getTime() + BOT_LIMITS.sessionTtlMs + 1)
		);
		const remaining = store.db
			.query(
				"SELECT COUNT(*) AS count, SUM(answers_json='[]') AS empty FROM results WHERE bot_id=?"
			)
			.get(bot.id) as { count: number; empty: number };
		expect(remaining).toEqual({
			count: BOT_LIMITS.resultsPerBot,
			empty: 0,
		});
	});

	it("keeps an unanswered result while its session can still be answered", async () => {
		const store = openStore();
		const bot = store.create({ name: "Live", templateId: "contact-form" });
		store.publish(bot.id);
		const session = await startStoredSession(store, bot.slug, "s_live");
		store.purgeExpired(new Date(FIXED_NOW.getTime() + 60_000));
		expect(store.result(bot.id, session.state.resultId).id).toBe(
			session.state.resultId
		);
	});

	it("stores a started conversation even past the quota", async () => {
		const store = openStore();
		const bot = store.create({ name: "Full", templateId: "contact-form" });
		store.publish(bot.id);
		insertResults(store, bot.id, BOT_LIMITS.resultsPerBot, {
			answered: true,
			prefix: "r_full_",
		});
		// The route checks the quota before running the engine; once the start
		// ran (and may have spent AI budget or emitted events) it is kept.
		const session = await startStoredSession(store, bot.slug, "s_over");
		expect(store.getSession(session.id)).not.toBeNull();
	});

	it("deletes one result or all of a bot's results", async () => {
		const store = openStore();
		const bot = store.create({ name: "Clean", templateId: "contact-form" });
		store.publish(bot.id);
		const one = await startStoredSession(store, bot.slug, "s_a");
		await startStoredSession(store, bot.slug, "s_b");
		expect(store.deleteResult(bot.id, one.state.resultId)).toBe(true);
		expect(store.deleteResult(bot.id, one.state.resultId)).toBe(false);
		expect(store.clearResults(bot.id)).toBe(1);
		expect(store.results(bot.id, null).items).toEqual([]);
		expect(() => store.clearResults("bot_missing")).toThrow("not found");
	});

	it("refuses to publish a draft revision the caller has not seen", () => {
		const store = openStore();
		const bot = store.create({ name: "Revisions" });
		store.update(bot.id, { revision: 0, name: "Newer" });
		expect(() => store.publish(bot.id, FIXED_NOW, 0)).toThrow("changed");
		expect(store.publish(bot.id, FIXED_NOW, 1).status).toBe("published");
		expect(store.publish(bot.id).status).toBe("published");
	});

	it("reports a taken slug with its own code and a 422, not a 409", () => {
		const store = openStore();
		store.create({ name: "First", slug: "taken-link" });
		try {
			store.create({ name: "Second", slug: "taken-link" });
			throw new Error("expected slug_taken");
		} catch (cause) {
			expect(cause).toBeInstanceOf(BotFlowsError);
			expect((cause as BotFlowsError).code).toBe("slug_taken");
			// The host bridge forwards only the status, so it must differ from
			// the 409 of a stale revision (which the editor offers to reload).
			expect((cause as BotFlowsError).status).toBe(422);
		}
	});

	it("records the current block of a looping flow as last_block_id", async () => {
		const store = openStore();
		const bot = store.create({ name: "Loop" });
		const flow = structuredClone(bot.flow);
		const [group] = flow.groups;
		if (!group) {
			throw new Error("blank flow has a group");
		}
		flow.variables = [{ id: "v_a", name: "a" }];
		group.blocks = [
			{ id: "b_one", type: "text_input", saveTo: "v_a" },
			{ id: "b_two", type: "text_input", saveTo: "v_a" },
			{ id: "b_loop", type: "jump", groupId: group.id },
		];
		flow.edges = [];
		store.update(bot.id, { revision: 0, flow });
		store.publish(bot.id);
		const session = await startStoredSession(store, bot.slug, "s_loop");
		let state = session.state;
		const published = store.snapshot(bot.id, session.flowHash);
		if (!published) {
			throw new Error("snapshot missing");
		}
		for (const answer of ["1", "2", "3"]) {
			state = (await reply(published, state, answer, testDeps())).state;
			store.saveSession(session.id, state, published, FIXED_NOW);
		}
		expect(store.results(bot.id, null).items[0]?.lastBlockId).toBe("b_two");
	});
});
