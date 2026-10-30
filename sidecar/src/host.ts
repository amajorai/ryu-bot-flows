/**
 * Calls back into Core's extension-host API with the sidecar's minted
 * credential: `model.complete` for AI replies (grant `hook:side-model`) and the
 * `events.emit` kernel capability for the manifest-declared hook events.
 * Both are unavailable when the sidecar runs without Core.
 */
import {
	createSidecarHostClient,
	type SidecarEnvironment,
	type SidecarHostValue,
} from "@ryu/sidecar-runtime";
import type { Flow, SessionState } from "./contracts.ts";
import type { AiRequest } from "./engine.ts";

export const PLUGIN_ID = "@ryu/bot-flows";
export const MAX_EVENT_PAYLOAD_BYTES = 60 * 1024;

export type BotEventName = "conversation.completed" | "handoff.requested";

export interface BotHost {
	readonly aiAvailable: boolean;
	complete(request: AiRequest): Promise<string>;
	/** Best-effort: never throws. */
	emit(event: BotEventName, payload: Record<string, unknown>): Promise<void>;
}

/** A host that has no AI and drops events (standalone runs and tests). */
export const UNHOSTED: BotHost = {
	aiAvailable: false,
	complete: () => Promise.reject(new Error("AI replies need Ryu.")),
	emit: () => Promise.resolve(),
};

export function createBotHost(
	env: SidecarEnvironment,
	token: string,
	fetchImpl?: typeof fetch
): BotHost {
	const corePort = Number(env.RYU_CORE_PORT);
	if (!(Number.isInteger(corePort) && corePort > 0 && corePort < 65_536)) {
		return UNHOSTED;
	}
	const client = createSidecarHostClient({
		corePort,
		pluginId: PLUGIN_ID,
		token,
		fetchImpl,
	});
	return {
		aiAvailable: true,
		async complete(request) {
			const result = await client.call("model.complete", {
				prompt: request.prompt,
				system: request.system,
			});
			if (typeof result !== "string") {
				throw new Error("The model returned an unexpected response.");
			}
			return result.slice(0, request.maxChars);
		},
		async emit(event, payload) {
			try {
				await client.capability("events.emit", {
					event: `${PLUGIN_ID}#${event}`,
					payload: toJson(fitPayload(payload)),
				});
			} catch {
				// Events are best-effort; a missing workflow never breaks a chat.
			}
		},
	};
}

function toJson(value: unknown): SidecarHostValue {
	return JSON.parse(JSON.stringify(value)) as SidecarHostValue;
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Drops the oldest transcript entries, then trims long values, to fit 64 KiB. */
export function fitPayload(
	payload: Record<string, unknown>
): Record<string, unknown> {
	const fitted = structuredClone(payload);
	const transcript = Array.isArray(fitted.transcript)
		? fitted.transcript
		: null;
	while (
		transcript &&
		transcript.length > 0 &&
		byteLength(fitted) > MAX_EVENT_PAYLOAD_BYTES
	) {
		transcript.shift();
	}
	if (byteLength(fitted) > MAX_EVENT_PAYLOAD_BYTES) {
		const variables = fitted.variables as Record<string, string> | undefined;
		for (const key of Object.keys(variables ?? {})) {
			if (variables) {
				variables[key] = String(variables[key]).slice(0, 200);
			}
		}
		fitted.answers = [];
		if (typeof fitted.summary === "string") {
			fitted.summary = fitted.summary.slice(0, 2000);
		}
	}
	return fitted;
}

export interface BotIdentity {
	id: string;
	name: string;
	slug: string;
}

export function variablesByName(
	flow: Flow,
	state: SessionState
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const variable of flow.variables) {
		const value = state.variables[variable.id];
		if (value !== undefined) {
			values[variable.name] = value;
		}
	}
	return values;
}

function eventAnswers(flow: Flow, state: SessionState) {
	const names = new Map(
		flow.variables.map((variable) => [variable.id, variable.name])
	);
	return state.answers.map((answer) => ({
		block_id: answer.blockId,
		variable: answer.variableId ? (names.get(answer.variableId) ?? null) : null,
		label: answer.label,
		value: answer.value,
	}));
}

export function completedPayload(
	bot: BotIdentity,
	flow: Flow,
	state: SessionState
): Record<string, unknown> {
	return {
		bot_id: bot.id,
		bot_slug: bot.slug,
		bot_name: bot.name,
		result_id: state.resultId,
		variables: variablesByName(flow, state),
		answers: eventAnswers(flow, state),
		completed_at: state.completedAt ?? new Date().toISOString(),
	};
}

export function handoffPayload(
	bot: BotIdentity,
	flow: Flow,
	state: SessionState,
	handoff: { topic: string; summary: string },
	requestedAt: string
): Record<string, unknown> {
	return {
		bot_id: bot.id,
		bot_slug: bot.slug,
		bot_name: bot.name,
		result_id: state.resultId,
		topic: handoff.topic,
		summary: handoff.summary,
		variables: variablesByName(flow, state),
		transcript: state.transcript.map((entry) => ({
			from: entry.from,
			text: entry.text,
		})),
		requested_at: requestedAt,
	};
}
