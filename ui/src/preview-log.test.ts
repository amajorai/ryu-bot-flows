import { describe, expect, test } from "bun:test";
import {
	type PreviewEntry,
	settleAnswer,
	withPendingAnswer,
} from "./preview-log.ts";

const greeting: PreviewEntry = {
	id: "entry-1",
	kind: "bot",
	message: { type: "text", id: "m_1", content: "Hi!", source: "bot" },
};

describe("preview answers", () => {
	test("a failed reply leaves no visitor bubble behind", () => {
		const pending = withPendingAnswer([greeting], "entry-2", "My answer");
		expect(pending.at(-1)).toEqual({
			id: "entry-2",
			kind: "visitor",
			pending: true,
			text: "My answer",
		});
		expect(settleAnswer(pending, "entry-2", false)).toEqual([greeting]);
	});

	test("an accepted reply becomes a normal visitor bubble", () => {
		const pending = withPendingAnswer([greeting], "entry-2", "My answer");
		expect(settleAnswer(pending, "entry-2", true)).toEqual([
			greeting,
			{ id: "entry-2", kind: "visitor", text: "My answer" },
		]);
	});
});
