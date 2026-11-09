import { describe, expect, test } from "bun:test";
import { BOT_LIMITS, type BotDocument } from "../../sidecar/src/contracts.ts";
import { listTemplates } from "../../sidecar/src/templates.ts";
import { asRequestError, BotFlowsRequestError } from "./api.ts";
import { renameGroup } from "./flow-model.ts";
import {
	draftOf,
	draftTooLarge,
	reconcileDraft,
	remedyFor,
	saveBody,
} from "./workspace-state.ts";

const flow = listTemplates()[0]?.flow;
if (!flow) {
	throw new Error("missing template");
}

function document(revision: number, name = "Support"): BotDocument {
	return {
		id: "bot_1",
		slug: "support",
		name,
		status: "draft",
		flow,
		revision,
		publishedAt: null,
		hasUnpublishedChanges: false,
		createdAt: "2026-10-19T10:00:00.000Z",
		updatedAt: "2026-10-19T10:00:00.000Z",
	};
}

describe("in-flight saves", () => {
	test("edits made while a save was in flight survive its response", () => {
		const saved = document(3);
		const sent = draftOf(saved);
		const groupId = flow.groups[0]?.id ?? "";
		const typedDuringSave = {
			...sent,
			flow: renameGroup(sent.flow, groupId, "Typed while saving"),
		};
		const response = document(4);
		expect(reconcileDraft(typedDuringSave, sent, response)).toBe(
			typedDuringSave
		);
	});

	test("without later edits the server copy replaces the draft", () => {
		const sent = { ...draftOf(document(3)), name: "Renamed" };
		const response = document(4, "Renamed");
		expect(reconcileDraft(sent, sent, response)).toEqual(draftOf(response));
	});

	test("the save body carries the revision and only changed fields", () => {
		const saved = document(7);
		expect(saveBody({ ...draftOf(saved), name: "New" }, saved)).toEqual({
			revision: 7,
			flow,
			name: "New",
		});
	});

	test("an oversized draft is caught before saving", () => {
		const saved = document(1);
		const huge = {
			...draftOf(saved),
			flow: {
				...flow,
				groups: flow.groups.map((group) => ({
					...group,
					title: "x".repeat(BOT_LIMITS.maxBodyBytes),
				})),
			},
		};
		expect(draftTooLarge(draftOf(saved), saved)).toBe(false);
		expect(draftTooLarge(huge, saved)).toBe(true);
	});
});

describe("error remedies", () => {
	test("only a stale revision offers reload; a taken slug points to Settings", () => {
		expect(remedyFor(new BotFlowsRequestError("conflict", "stale"))).toBe(
			"reload"
		);
		expect(remedyFor(new BotFlowsRequestError("slug_taken", "in use"))).toBe(
			"settings"
		);
		expect(remedyFor(new BotFlowsRequestError("invalid_flow", "x"))).toBeNull();
		expect(remedyFor(new Error("offline"))).toBeNull();
	});

	test("a bare bridge 422 is a taken slug, not a reload", () => {
		const error = asRequestError(
			new Error("/api/ext/@ryu/bot-flows/admin/bots/bot_1 failed: 422")
		);
		expect(remedyFor(error)).toBe("settings");
		expect(error.message).toBe("This link is already in use.");
	});
});
