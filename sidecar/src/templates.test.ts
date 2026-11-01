import { describe, expect, it } from "bun:test";
import {
	BOT_TEMPLATE_IDS,
	type Flow,
	flowSchema,
	type InputSpec,
	validateFlow,
} from "./contracts.ts";
import { startSession } from "./engine.ts";
import { listTemplates, templateFlow } from "./templates.ts";
import { autoAnswer, testDeps, texts, walk } from "./test-fixtures.ts";

const aiDeps = () =>
	testDeps({
		ai: ({ prompt }) =>
			Promise.resolve(`Suggested answer for ${prompt.slice(0, 20)}`),
		knowledge: () => ["Refunds take 5 days."],
		http: () => Promise.resolve({ status: 200, body: "{}" }),
	});

/** Answers by choice label when a script names one, otherwise automatically. */
function scripted(labels: string[]) {
	const queue = [...labels];
	return (input: InputSpec) => {
		if (input.type === "choice_input") {
			const wanted = queue[0];
			const item = input.items.find((candidate) => candidate.label === wanted);
			if (item) {
				queue.shift();
				return item.id;
			}
		}
		return autoAnswer(input);
	};
}

describe("templates", () => {
	it("lists every template id once", () => {
		expect(listTemplates().map((template) => template.id)).toEqual([
			...BOT_TEMPLATE_IDS,
		]);
	});

	for (const id of BOT_TEMPLATE_IDS) {
		it(`${id} validates and walks to completion`, async () => {
			const flow = templateFlow(id);
			expect(flowSchema.parse(flow)).toEqual(flow);
			expect(
				validateFlow(flow).filter((issue) => issue.severity === "error")
			).toEqual([]);
			expect(
				validateFlow(flow).filter((issue) =>
					issue.message.includes("isn't a variable")
				)
			).toEqual([]);
			const deps = aiDeps();
			const first = await startSession(flow, {}, deps, `r_${id}`);
			const turns = await walk(flow, first, deps);
			expect(turns.at(-1)?.done).toBe(true);
			expect(deps.events.at(-1)?.type).toBe("conversation.completed");
		});
	}

	it("returns independent copies", () => {
		const first = templateFlow("blank");
		first.groups[0]?.blocks.splice(0);
		expect(templateFlow("blank").groups[0]?.blocks).toHaveLength(1);
	});
});

async function run(
	flow: Flow,
	labels: string[],
	hidden: Record<string, string> = {}
) {
	const deps = aiDeps();
	const first = await startSession(flow, hidden, deps, "r_path");
	const turns = await walk(flow, first, deps, scripted(labels));
	return { deps, turns, last: turns.at(-1), all: turns.flatMap(texts) };
}

describe("template paths", () => {
	it("support triage hands unresolved issues to support with an AI suggestion", async () => {
		const { deps, all, last } = await run(templateFlow("support-triage"), [
			"Billing",
			"No",
		]);
		expect(all.some((text) => text.startsWith("Suggested answer"))).toBe(true);
		const handoff = deps.events.find(
			(event) => event.type === "handoff.requested"
		);
		expect(handoff?.type === "handoff.requested" && handoff.topic).toBe(
			"support"
		);
		expect(last?.state.handoffs[0]?.summary).toContain(
			"Billing issue from ada@example.com"
		);
	});

	it("lead capture scores a hot lead, redirects to booking, and carries UTM values", async () => {
		const { deps, turns } = await run(
			templateFlow("lead-capture"),
			["200+", "Over $10k", "This month"],
			{
				utm_source: "newsletter",
				utm_campaign: "fall",
			}
		);
		expect(
			turns.some((turn) =>
				turn.redirect?.url.startsWith("https://example.com/book-a-call")
			)
		).toBe(true);
		const handoff = deps.events.find(
			(event) => event.type === "handoff.requested"
		);
		expect(handoff?.type === "handoff.requested" && handoff.summary).toContain(
			"score 5"
		);
		expect(handoff?.type === "handoff.requested" && handoff.summary).toContain(
			"newsletter / fall"
		);
	});

	it("lead capture sends a cold lead to resources", async () => {
		const { all, turns } = await run(templateFlow("lead-capture"), [
			"1-10",
			"Under $1k",
			"Just exploring",
		]);
		expect(all).toContain(
			"Thanks! We'll send a few resources that fit where you are today."
		);
		expect(turns.every((turn) => turn.redirect === null)).toBe(true);
	});

	it("NPS routes detractors and collects a follow-up email", async () => {
		const flow = templateFlow("nps-survey");
		const deps = aiDeps();
		const first = await startSession(flow, { user_id: "u_1" }, deps, "r");
		const turns = await walk(flow, first, deps, (input) => {
			if (input.type === "rating_input") {
				return "3";
			}
			if (input.type === "choice_input") {
				return input.items.find((item) => item.label === "Yes")?.id ?? "";
			}
			return autoAnswer(input);
		});
		const all = turns.flatMap(texts);
		expect(all).toContain("Sorry to hear that. What went wrong?");
		expect(turns.at(-1)?.state.variables.v_email).toBe("ada@example.com");
		expect(turns.at(-1)?.state.variables.v_user_id).toBe("u_1");
	});

	it("appointment edit jumps back to the service question", async () => {
		const { all, deps } = await run(templateFlow("appointment-request"), [
			"Consultation",
			"Morning",
			"Edit",
			"Follow-up visit",
		]);
		expect(
			all.filter((text) => text === "Which service would you like to book?")
		).toHaveLength(2);
		const handoff = deps.events.find(
			(event) => event.type === "handoff.requested"
		);
		expect(handoff?.type === "handoff.requested" && handoff.summary).toContain(
			"Follow-up visit"
		);
	});

	it("product quiz recommends the plan with the highest score", async () => {
		const { turns } = await run(templateFlow("product-quiz"), [
			"A whole company",
			"Advanced controls",
			"We need it now",
		]);
		expect(
			turns.some(
				(turn) => turn.redirect?.url === "https://example.com/plans/pro"
			)
		).toBe(true);
		const team = await run(templateFlow("product-quiz"), [
			"A small team",
			"Collaboration",
			"Just trying it out",
		]);
		expect(
			team.turns.some(
				(turn) => turn.redirect?.url === "https://example.com/plans/team"
			)
		).toBe(true);
	});

	it("bug report references the result id and prefilled app details", async () => {
		const { deps, all } = await run(templateFlow("bug-report"), [], {
			app_version: "1.2.3",
			os: "macOS",
		});
		expect(all.some((text) => text.includes("Your reference is r_path"))).toBe(
			true
		);
		const handoff = deps.events.find(
			(event) => event.type === "handoff.requested"
		);
		expect(handoff?.type === "handoff.requested" && handoff.summary).toContain(
			"Version 1.2.3 on macOS"
		);
	});

	it("contact form routes the handoff by the chosen topic", async () => {
		const { deps } = await run(templateFlow("contact-form"), ["Partnership"]);
		const handoff = deps.events.find(
			(event) => event.type === "handoff.requested"
		);
		expect(handoff?.type === "handoff.requested" && handoff.topic).toBe(
			"partnership"
		);
	});

	it("AI FAQ loops for another question, then hands off to a person", async () => {
		const { deps, last } = await run(templateFlow("ai-faq"), [
			"I have another question",
			"Talk to a person",
		]);
		expect(last?.state.aiTurns).toBe(2);
		expect(
			deps.events.some((event) => event.type === "handoff.requested")
		).toBe(true);
	});

	it("onboarding offers the docs or a call", async () => {
		const { turns } = await run(templateFlow("onboarding"), [
			"Build a bot",
			"No thanks",
		]);
		expect(
			turns.some((turn) => turn.redirect?.url === "https://example.com/docs")
		).toBe(true);
		const call = await run(templateFlow("onboarding"), [
			"Understand my data",
			"Yes please",
		]);
		expect(
			call.deps.events.some((event) => event.type === "handoff.requested")
		).toBe(true);
	});
});
