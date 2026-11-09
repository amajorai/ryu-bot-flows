/**
 * The hosted chat page: a server-rendered shell plus an inline vanilla-JS
 * client. Every piece of bot or visitor text reaches the DOM through
 * `textContent` (or `createTextNode`); the page never uses `innerHTML`.
 */
import { CHAT_SCRIPT } from "./chat-script.ts";
import type { Flow } from "./contracts.ts";
import { respondentErrorCopy } from "./respondent-errors.ts";
import {
	negotiateRespondentLocale,
	type RespondentLocale,
} from "./respondent-locale.ts";

export { CHAT_SCRIPT };

/** Where a page's language comes from: a negotiated locale or the header. */
export interface PageLanguage {
	/** The visitor's `Accept-Language` header (negotiated per request). */
	acceptLanguage?: string | null;
	/** The page language; defaults to negotiating `acceptLanguage`. */
	locale?: RespondentLocale;
}

function pageLocale(language: PageLanguage = {}): RespondentLocale {
	return language.locale ?? negotiateRespondentLocale(language.acceptLanguage);
}

/** The chat client's own chrome, in the visitor's language. */
function chatCopy(t: RespondentLocale) {
	return {
		chooseAtLeastOne: t.tl("Choose at least one option."),
		conversationEnded: t.tl("Conversation ended."),
		conversationExpired: t.tl("This conversation expired."),
		couldNotStart: t.tl("This bot couldn't start. Try again later."),
		embeddedContent: t.tl("Embedded content"),
		errors: respondentErrorCopy(t),
		openLink: t.tl("Open link"),
		send: t.tl("Send"),
		somethingWentWrong: t.tl("Something went wrong. Try again."),
		starsLabel: t.tl("{value} of {total} stars"),
		startNewConversation: t.tl("Start a new conversation"),
		startOver: t.tl("Start over"),
		tryAgain: t.tl("Try again"),
		typeYourAnswer: t.tl("Type your answer…"),
		typing: t.tl("{name} is typing"),
		video: t.tl("Video"),
		yourAnswer: t.tl("Your answer"),
	};
}

/**
 * Closed-page text Bot Flows itself writes (the default closed message and the
 * missing-bot notice) shows in the visitor's language; an owner's own closed
 * message stays exactly as written.
 */
function closedText(message: string, t: RespondentLocale): string {
	switch (message) {
		case "This bot doesn't exist.":
			return t.tl("This bot doesn't exist.");
		case "This bot isn't taking conversations right now.":
			return t.tl("This bot isn't taking conversations right now.");
		default:
			return message;
	}
}

interface RenderedPage {
	html: string;
	nonce: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** JSON that is safe inside a `<script type="application/json">` element. */
export function scriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll(" ", "\\u2028")
		.replaceAll(" ", "\\u2029");
}

function newNonce(): string {
	return crypto.randomUUID().replaceAll("-", "");
}

function httpsOrNull(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

function baseStyles(accent: string, mode: Flow["theme"]["mode"]): string {
	const light =
		"--bg:#f6f6f3;--panel:#ffffff;--text:#1f201d;--muted:#6b6c66;--border:#e3e3de;--bot:#f0f0ec;--system:#fff6e5;";
	const dark =
		"--bg:#141513;--panel:#1c1d1a;--text:#ecece8;--muted:#a3a49d;--border:#2f302c;--bot:#262723;--system:#3a3020;";
	const scheme =
		mode === "dark"
			? `:root{color-scheme:dark;${dark}}`
			: mode === "light"
				? `:root{color-scheme:light;${light}}`
				: `:root{color-scheme:light dark;${light}}@media (prefers-color-scheme: dark){:root{${dark}}}`;
	return `${scheme}
    :root { --accent: ${accent}; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); }`;
}

export function renderChatPage(
	input: {
		botName: string;
		embed: boolean;
		flow: Flow;
	} & PageLanguage
): RenderedPage {
	const t = pageLocale(input);
	const nonce = newNonce();
	const { theme } = input.flow;
	const accent = HEX_COLOR.test(theme.accent) ? theme.accent : "#2563eb";
	const config = {
		botName: theme.botName || input.botName,
		avatarUrl: httpsOrNull(theme.avatarUrl),
		typingDelayMs: theme.typingDelayMs,
		embed: input.embed,
		copy: chatCopy(t),
	};
	const title = escapeHtml(config.botName);
	const html = `<!doctype html>
<html lang="${t.locale}" dir="${t.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <style nonce="${nonce}">
    ${baseStyles(accent, theme.mode)}
    .shell { height: 100%; display: flex; justify-content: center; padding: ${input.embed ? "0" : "32px 16px"}; }
    .chat { display: flex; flex-direction: column; width: min(100%, 720px); height: 100%; background: var(--panel); border: ${input.embed ? "0" : "1px solid var(--border)"}; border-radius: ${input.embed ? "0" : "16px"}; overflow: hidden; }
    header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
    header .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex: none; }
    header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #messages { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; gap: 8px; align-items: flex-end; }
    .row.visitor { justify-content: flex-end; }
    .avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex: none; }
    .bubble { max-width: min(80%, 520px); padding: 10px 14px; border-radius: 16px; line-height: 1.5; font-size: 15px; overflow-wrap: anywhere; }
    .bubble.bot { background: var(--bot); border-end-start-radius: 6px; }
    .bubble.bot.system { background: var(--system); }
    .bubble.visitor { background: var(--accent); color: #fff; border-end-end-radius: 6px; }
    .bubble a { color: inherit; text-decoration: underline; }
    .bubble.media { padding: 6px; width: min(80%, 420px); }
    .media-image, .media-video { display: block; width: 100%; border-radius: 10px; }
    .media-frame { display: block; width: 100%; border: 0; border-radius: 10px; background: #000; }
    .typing { display: inline-flex; gap: 4px; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1s infinite ease-in-out; }
    .typing span:nth-child(2) { animation-delay: .15s; } .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    #input-area { padding: 12px 14px; border-top: 1px solid var(--border); display: grid; gap: 8px; }
    #input-area:empty { display: none; }
    .composer { display: flex; gap: 8px; align-items: flex-end; }
    .field { flex: 1; min-height: 44px; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: var(--panel); color: var(--text); font: inherit; resize: none; }
    button, .link-button { min-height: 40px; border-radius: 12px; padding: 8px 14px; font: inherit; font-weight: 550; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .primary, .link-button { border: 0; background: var(--accent); color: #fff; }
    .secondary { border: 1px solid var(--border); background: var(--panel); color: var(--text); justify-self: start; }
    .choices, .rating { display: flex; flex-wrap: wrap; gap: 8px; }
    .choice { border: 1px solid var(--accent); background: transparent; color: var(--text); }
    .choice:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
    .choice.check { display: inline-flex; gap: 8px; align-items: center; min-height: 40px; padding: 8px 12px; border-radius: 12px; }
    .rating-option { min-width: 40px; padding: 8px; }
    .rating.stars .rating-option { color: var(--accent); }
    .rating-legend { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
    :focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
    .status { min-height: 18px; margin: 0; padding: 0 18px 10px; color: var(--muted); font-size: 12px; }
    .honeypot { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .attribution { text-align: center; color: var(--muted); font-size: 11px; padding: 0 0 10px; margin: 0; }
    @media (max-width: 540px) { .shell { padding: 0; } .chat { border: 0; border-radius: 0; } .bubble { max-width: 88%; } }
    @media (prefers-reduced-motion: reduce) { .typing span { animation: none; } }
  </style>
</head>
<body>
  <div class="shell">
    <main class="chat">
      <header><span class="dot" aria-hidden="true"></span><h1>${title}</h1></header>
      <div id="messages" role="log" aria-live="polite" aria-label="${escapeHtml(t.tl("Conversation"))}"></div>
      <p class="status" id="status-line" role="status"></p>
      <div id="input-area"></div>
      <label class="honeypot" aria-hidden="true">${escapeHtml(t.tl("Leave this field empty"))}<input id="website" name="website" tabindex="-1" autocomplete="off"></label>
      ${input.embed ? "" : `<p class="attribution">${escapeHtml(t.tl("Made with Ryu Bot Flows"))}</p>`}
    </main>
  </div>
  <script id="bot-data" type="application/json" nonce="${nonce}">${scriptJson(config)}</script>
  <script nonce="${nonce}">${CHAT_SCRIPT}</script>
</body>
</html>`;
	return { html, nonce };
}

export function renderClosedPage(
	message: string,
	language: PageLanguage = {}
): RenderedPage {
	const t = pageLocale(language);
	const nonce = newNonce();
	const html = `<!doctype html>
<html lang="${t.locale}" dir="${t.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(t.tl("Conversation closed"))}</title>
  <style nonce="${nonce}">
    ${baseStyles("#2563eb", "auto")}
    main { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; text-align: center; }
    p { max-width: 420px; margin: 0; color: var(--muted); line-height: 1.6; }
  </style>
</head>
<body><main><p>${escapeHtml(closedText(message, t))}</p></main></body>
</html>`;
	return { html, nonce };
}
