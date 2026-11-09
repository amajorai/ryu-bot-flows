import { afterEach, describe, expect, it } from "bun:test";
import { CHAT_SCRIPT } from "./chat-script.ts";
import {
	type BotDocument,
	type BotMessage,
	DEFAULT_SETTINGS,
	type PublicTurn,
} from "./contracts.ts";
import { startSession } from "./engine.ts";
import { renderChatPage } from "./respondent.ts";
import {
	DEFAULT_AI_FALLBACK_TEXT,
	localizeEngineDefaults,
	respondentErrorCopy,
} from "./respondent-errors.ts";
import {
	type RespondentLocale,
	respondentLocale,
} from "./respondent-locale.ts";
import { createBotFlowsHandler } from "./server.ts";
import { BotFlowsStore } from "./store.ts";
import { templateFlow } from "./templates.ts";
import { testDeps, testFlow, texts } from "./test-fixtures.ts";

const marked: RespondentLocale = {
	dir: "ltr",
	locale: "xx",
	tl: (source) => `«${source}»`,
};

const system = (content: string, source: "bot" | "system" = "system") =>
	({ type: "text", id: "m", content, source }) satisfies BotMessage;

describe("respondent error copy", () => {
	it("translates every public error code", () => {
		const { codes, messages } = respondentErrorCopy(marked);
		for (const code of [
			"busy",
			"completed",
			"expired",
			"not_found",
			"quota",
			"rate_limited",
			"too_large",
		]) {
			expect(codes[code]).toMatch(/^«.+»$/u);
		}
		expect(messages["Bot not found."]).toBe("«This bot doesn't exist.»");
	});

	it("ships German error copy to a German visitor's chat page", () => {
		const { html } = renderChatPage({
			acceptLanguage: "de-DE,de;q=0.9",
			botName: "Helper",
			embed: false,
			flow: templateFlow("blank"),
		});
		const config = JSON.parse(
			html.match(/<script id="bot-data"[^>]*>([^<]*)<\/script>/u)?.[1] ?? "{}"
		);
		const { codes } = config.copy.errors;
		for (const code of ["busy", "completed", "quota", "rate_limited"]) {
			expect(typeof codes[code]).toBe("string");
		}
		expect(codes.rate_limited).not.toBe(
			"Too many messages right now. Please wait a few minutes."
		);
		expect(codes.busy).not.toBe("Still working on your last message.");
	});
});

describe("engine defaults", () => {
	it("pins the AI fallback to the engine's own default", async () => {
		const flow = testFlow({
			variables: ["out"],
			groups: [
				{
					id: "start",
					blocks: [
						{
							id: "ai",
							type: "ai_reply",
							instructions: "",
							promptTemplate: "hi",
							saveTo: "out",
							useKnowledge: false,
							maxChars: 200,
						},
					],
				},
			],
		});
		const turn = await startSession(flow, {}, testDeps(), "r");
		expect(texts(turn)).toEqual([DEFAULT_AI_FALLBACK_TEXT]);
	});

	it("translates unchanged defaults and keeps owner text as written", () => {
		const localized = localizeEngineDefaults(
			[
				system(DEFAULT_AI_FALLBACK_TEXT),
				system(DEFAULT_SETTINGS.invalidReplyMessage),
				system("Please try that again, friend."),
				system(DEFAULT_AI_FALLBACK_TEXT, "bot"),
			],
			marked
		);
		expect(
			localized.map((message) =>
				message.type === "text" ? message.content : ""
			)
		).toEqual([
			`«${DEFAULT_AI_FALLBACK_TEXT}»`,
			`«${DEFAULT_SETTINGS.invalidReplyMessage}»`,
			"Please try that again, friend.",
			DEFAULT_AI_FALLBACK_TEXT,
		]);
	});
});

describe("public replies", () => {
	const stores: BotFlowsStore[] = [];
	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
	});

	async function invalidReply(acceptLanguage: string): Promise<string[]> {
		const store = new BotFlowsStore(":memory:");
		stores.push(store);
		const handler = createBotFlowsHandler({ store, token: "t" });
		const call = (path: string, json: unknown, auth = false) =>
			handler(
				new Request(`http://bots.test/api/bot-flows${path}`, {
					method: "POST",
					body: JSON.stringify(json),
					headers: {
						"accept-language": acceptLanguage,
						"content-type": "application/json",
						...(auth ? { authorization: "Bearer t" } : {}),
					},
				})
			);
		const flow = testFlow({
			variables: ["n"],
			groups: [
				{
					id: "start",
					blocks: [{ id: "ask", type: "number_input", saveTo: "n" }],
				},
			],
		});
		const bot = (await (
			await call("/admin/bots", { name: "Count", flow }, true)
		).json()) as BotDocument;
		await call(`/admin/bots/${bot.id}/publish`, {}, true);
		const started = (await (
			await call(`/${bot.slug}/sessions`, {})
		).json()) as PublicTurn;
		const replied = (await (
			await call(`/${bot.slug}/sessions/${started.sessionId}/reply`, {
				value: "not a number",
			})
		).json()) as PublicTurn;
		return replied.messages.flatMap((message) =>
			message.type === "text" ? [message.content] : []
		);
	}

	it("renders the default invalid-reply message in the visitor's language", async () => {
		expect(await invalidReply("en")).toEqual([
			DEFAULT_SETTINGS.invalidReplyMessage,
		]);
		expect(await invalidReply("de")).toEqual([
			respondentLocale("de").tl(DEFAULT_SETTINGS.invalidReplyMessage),
		]);
	});
});

/** The chat page's own `errorText`, run against the copy a visitor's page carries. */
function pageErrorText(acceptLanguage: string) {
	const { html } = renderChatPage({
		acceptLanguage,
		botName: "Helper",
		embed: false,
		flow: templateFlow("blank"),
	});
	const config = JSON.parse(
		html.match(/<script id="bot-data"[^>]*>([^<]*)<\/script>/u)?.[1] ?? "{}"
	);
	const source = CHAT_SCRIPT.match(
		/function errorText\(payload, fallback\) \{[\s\S]*?\n\}/u
	)?.[0];
	if (!source) {
		throw new Error("errorText is missing from the chat script");
	}
	const errorText = new Function("copy", `${source}\nreturn errorText;`)(
		config.copy
	) as (payload: unknown, fallback: string) => string;
	return (payload: unknown) =>
		errorText(payload, config.copy.somethingWentWrong);
}

describe("chat page error text (end to end)", () => {
	const stores: BotFlowsStore[] = [];
	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
	});

	/** Real public error payloads: rate limited, closed (default), unknown bot, bad input. */
	async function serverErrors() {
		const store = new BotFlowsStore(":memory:");
		stores.push(store);
		const handler = createBotFlowsHandler({
			rateLimits: { startsPerVisitor: 2 },
			store,
			token: "t",
		});
		const call = (path: string, json: unknown, auth = false) =>
			handler(
				new Request(`http://bots.test/api/bot-flows${path}`, {
					method: "POST",
					body: JSON.stringify(json),
					headers: {
						"content-type": "application/json",
						...(auth ? { authorization: "Bearer t" } : {}),
					},
				})
			).then((response) => response.json());
		const bot = (await call(
			"/admin/bots",
			{ name: "Closed", templateId: "contact-form" },
			true
		)) as BotDocument;
		if (!bot.slug) {
			throw new Error("creating the test bot failed");
		}
		return {
			// In call order: two starts use up the visitor's limit, the third is refused.
			closed: await call(`/${bot.slug}/sessions`, {}),
			missing: await call("/no-such-bot/sessions", {}),
			invalid: await call(`/${bot.slug}/sessions/nope/reply`, { value: 7 }),
			limited: await call(`/${bot.slug}/sessions`, {}),
		};
	}

	it("shows ja, ar and de visitors their own language, never the server English", async () => {
		const errors = await serverErrors();
		expect(errors.limited.error.code).toBe("rate_limited");
		expect(errors.closed.error.code).toBe("closed");
		expect(errors.invalid.error.code).toBe("invalid_input");
		for (const locale of ["ja", "ar", "de"]) {
			const t = respondentLocale(locale);
			const text = pageErrorText(locale);
			const limited = text(errors.limited);
			expect(limited).toBe(
				t.tl("Too many messages right now. Please wait a few minutes.")
			);
			expect(limited).not.toBe(errors.limited.error.message);
			expect(text(errors.closed)).toBe(
				t.tl("This bot isn't taking conversations right now.")
			);
			expect(text(errors.closed)).not.toBe(errors.closed.error.message);
			expect(text(errors.missing)).toBe(t.tl("This bot doesn't exist."));
			expect(text(errors.missing)).not.toBe("This bot doesn't exist.");
			expect(text(errors.invalid)).toBe(
				t.tl("Something went wrong. Try again.")
			);
		}
	});

	it("keeps English unchanged and an owner's closed message as written", () => {
		const text = pageErrorText("en");
		expect(text({ error: { code: "rate_limited", message: "x" } })).toBe(
			"Too many messages right now. Please wait a few minutes."
		);
		const owner = { error: { code: "closed", message: "Back on Monday." } };
		expect(text(owner)).toBe("Back on Monday.");
		expect(pageErrorText("ja")(owner)).toBe("Back on Monday.");
		expect(text({})).toBe("Something went wrong. Try again.");
	});
});
