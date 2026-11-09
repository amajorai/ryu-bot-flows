/** Shared helpers for the sidecar's bun tests (not part of the binary). */
import {
	type Block,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Edge,
	type Flow,
	type InputSpec,
	type ReplyValue,
	type Settings,
	type Variable,
} from "./contracts.ts";
import {
	type EngineDeps,
	type EngineEvent,
	reply,
	type Turn,
} from "./engine.ts";

export const FIXED_NOW = new Date("2026-10-19T12:00:00.000Z");

export function testFlow(input: {
	edges?: Edge[];
	groups: { blocks: Block[]; id: string; title?: string }[];
	settings?: Partial<Settings>;
	variables?: (string | Variable)[];
}): Flow {
	return {
		version: 1,
		variables: (input.variables ?? []).map((variable) =>
			typeof variable === "string" ? { id: variable, name: variable } : variable
		),
		groups: input.groups.map((group, index) => ({
			id: group.id,
			title: group.title ?? group.id,
			position: { x: index * 300, y: 0 },
			blocks: group.blocks,
		})),
		edges: input.edges ?? [],
		startGroupId: input.groups[0]?.id ?? "start",
		theme: { ...DEFAULT_THEME },
		settings: { ...DEFAULT_SETTINGS, ...input.settings },
	};
}

export function edge(
	id: string,
	blockId: string,
	groupId: string,
	handle: { itemId?: string; branch?: Edge["from"]["branch"] } = {}
): Edge {
	return { id, from: { blockId, ...handle }, to: { groupId } };
}

export interface TestDeps extends EngineDeps {
	events: EngineEvent[];
}

export function testDeps(overrides: Partial<EngineDeps> = {}): TestDeps {
	const events: EngineEvent[] = [];
	return {
		now: () => FIXED_NOW,
		random: () => 0.25,
		emit: (event) => {
			events.push(event);
		},
		events,
		...overrides,
	};
}

/** A valid answer for any input, preferring the first choice. */
export function autoAnswer(input: InputSpec): ReplyValue {
	switch (input.type) {
		case "text_input":
			return "A test answer"
				.slice(0, input.maxLength ?? 4000)
				.padEnd(input.minLength ?? 0, "x");
		case "number_input":
			return String(input.min ?? 1);
		case "email_input":
			return "ada@example.com";
		case "phone_input":
			return "+1 555 010 0000";
		case "url_input":
			return "https://example.com/page";
		case "date_input":
			return input.withTime ? "2026-11-02T10:30" : "2026-11-02";
		case "rating_input":
			return input.scale === "nps" ? "10" : String(input.length);
		case "choice_input":
			return input.multiple
				? [input.items[0]?.id ?? ""]
				: (input.items[0]?.id ?? "");
		default:
			return "";
	}
}

/** Replies with `answer` (or the auto answer) until the conversation ends. */
export async function walk(
	flow: Flow,
	first: Turn,
	deps: EngineDeps,
	answer: (input: InputSpec, turn: number) => ReplyValue = autoAnswer,
	maxTurns = 100
): Promise<Turn[]> {
	const turns = [first];
	let current = first;
	for (let index = 0; index < maxTurns && !current.done; index += 1) {
		if (!current.input) {
			throw new Error("A conversation stopped without an input or an end.");
		}
		current = await reply(
			flow,
			current.state,
			answer(current.input, index),
			deps
		);
		turns.push(current);
	}
	return turns;
}

export function texts(turn: Turn): string[] {
	return turn.messages.flatMap((message) =>
		message.type === "text" ? [message.content] : []
	);
}
