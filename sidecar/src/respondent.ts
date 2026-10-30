/**
 * The hosted chat page: a server-rendered shell plus an inline vanilla-JS
 * client. Every piece of bot or visitor text reaches the DOM through
 * `textContent` (or `createTextNode`); the page never uses `innerHTML`.
 */
import type { Flow } from "./contracts.ts";

export const CHAT_SCRIPT = String.raw`
"use strict";
const config = JSON.parse(document.getElementById("bot-data").textContent || "{}");
const log = document.getElementById("messages");
const inputArea = document.getElementById("input-area");
const statusLine = document.getElementById("status-line");
const base = location.pathname.replace(/\/+$/, "");
let sessionId = null;
let pendingInput = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

function appendInline(parent, text) {
  let last = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    if (match[1] !== undefined) {
      parent.append(el("strong", "", match[1]));
    } else if (match[2] !== undefined) {
      parent.append(el("em", "", match[2]));
    } else {
      const href = safeHttpUrl(match[4] || match[5]);
      if (href) {
        const link = el("a", "", match[3] || match[5]);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else {
        parent.append(document.createTextNode(match[0]));
      }
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function appendRich(parent, text) {
  text.split("\n").forEach((line, index) => {
    if (index > 0) parent.append(document.createElement("br"));
    appendInline(parent, line);
  });
}

function scrollToEnd() {
  log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
}

function row(from) {
  const wrapper = el("div", "row " + from);
  if (from === "bot" && config.avatarUrl) {
    const avatar = el("img", "avatar");
    avatar.src = config.avatarUrl;
    avatar.alt = "";
    wrapper.append(avatar);
  }
  log.append(wrapper);
  return wrapper;
}

function bubble(from, text, extraClass) {
  const node = el("div", "bubble " + from + (extraClass ? " " + extraClass : ""));
  if (from === "visitor") node.textContent = text;
  else appendRich(node, text);
  row(from).append(node);
  scrollToEnd();
  return node;
}

async function typing() {
  if (!config.typingDelayMs) return;
  const indicator = el("div", "bubble bot typing");
  indicator.setAttribute("aria-label", config.botName + " is typing");
  indicator.append(el("span"), el("span"), el("span"));
  const wrapper = row("bot");
  wrapper.append(indicator);
  scrollToEnd();
  await sleep(config.typingDelayMs);
  wrapper.remove();
}

function frame(url, height, title) {
  const iframe = el("iframe", "media-frame");
  iframe.src = url;
  iframe.title = title;
  iframe.height = String(height);
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
  iframe.setAttribute("allow", "fullscreen; picture-in-picture");
  return iframe;
}

async function showMessage(message) {
  if (message.type === "wait") {
    await sleep(Math.min(30, message.seconds) * 1000);
    return;
  }
  await typing();
  if (message.type === "text") {
    bubble("bot", message.content, message.source === "system" ? "system" : message.source === "ai" ? "ai" : "");
    return;
  }
  const holder = el("div", "bubble bot media");
  const url = safeHttpUrl(message.url);
  if (!url) return;
  if (message.type === "image") {
    const image = el("img", "media-image");
    image.src = url;
    image.alt = message.alt || "";
    image.loading = "lazy";
    holder.append(image);
  } else if (message.type === "video") {
    if (message.embedUrl && safeHttpUrl(message.embedUrl)) {
      holder.append(frame(message.embedUrl, 220, "Video"));
    } else {
      const video = el("video", "media-video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      holder.append(video);
    }
  } else if (message.type === "embed") {
    holder.append(frame(url, message.height, "Embedded content"));
  }
  row("bot").append(holder);
  scrollToEnd();
}

function setStatus(text) {
  statusLine.textContent = text || "";
}

function clearInput() {
  inputArea.replaceChildren();
}

function restartButton(label) {
  clearInput();
  const button = el("button", "secondary", label);
  button.type = "button";
  button.addEventListener("click", () => {
    log.replaceChildren();
    start();
  });
  inputArea.append(button);
}

async function post(path, body) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { status: response.status, ok: response.ok, payload };
}

async function render(turn) {
  for (const message of turn.messages) await showMessage(message);
  if (turn.redirect) {
    const href = safeHttpUrl(turn.redirect.url);
    if (href && (turn.redirect.newTab || config.embed)) {
      const link = el("a", "link-button", "Open link");
      link.href = href;
      link.target = turn.redirect.newTab ? "_blank" : "_top";
      link.rel = "noopener noreferrer";
      row("bot").append(link);
      scrollToEnd();
    } else if (href) {
      location.assign(href);
      return;
    }
  }
  if (turn.done) {
    setStatus("Conversation ended.");
    restartButton("Start over");
    return;
  }
  if (turn.input) renderInput(turn.input);
}

async function send(value, label) {
  if (!sessionId) return;
  bubble("visitor", label);
  clearInput();
  setStatus("");
  const result = await post("/sessions/" + encodeURIComponent(sessionId) + "/reply", { value });
  if (result.status === 410) {
    bubble("bot", "This conversation expired.", "system");
    restartButton("Start a new conversation");
    return;
  }
  if (!result.ok) {
    const message = (result.payload.error && result.payload.error.message) || "Something went wrong. Try again.";
    bubble("bot", message, "system");
    if (result.status === 404) {
      clearInput();
      return;
    }
    if (pendingInput) renderInput(pendingInput);
    return;
  }
  await render(result.payload);
}

function textField(spec) {
  const form = el("form", "composer");
  const field = spec.type === "text_input" && spec.long ? el("textarea") : el("input");
  field.className = "field";
  field.setAttribute("aria-label", spec.placeholder || "Your answer");
  field.placeholder = spec.placeholder || "Type your answer…";
  field.required = true;
  field.maxLength = spec.type === "text_input" && spec.maxLength ? spec.maxLength : 4000;
  if (field.tagName === "INPUT") {
    field.type =
      spec.type === "number_input" ? "number" :
      spec.type === "email_input" ? "email" :
      spec.type === "phone_input" ? "tel" :
      spec.type === "url_input" ? "url" :
      spec.type === "date_input" ? (spec.withTime ? "datetime-local" : "date") : "text";
    if (spec.type === "number_input") {
      if (spec.min !== undefined) field.min = String(spec.min);
      if (spec.max !== undefined) field.max = String(spec.max);
      field.step = spec.step !== undefined ? String(spec.step) : "any";
    }
    if (spec.type === "date_input") {
      if (spec.min) field.min = spec.withTime ? spec.min + "T00:00" : spec.min;
      if (spec.max) field.max = spec.withTime ? spec.max + "T23:59" : spec.max;
    }
    if (spec.type === "email_input") field.autocomplete = "email";
    if (spec.type === "phone_input") field.autocomplete = "tel";
  } else {
    field.rows = 3;
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }
  const button = el("button", "primary", spec.buttonLabel || "Send");
  button.type = "submit";
  form.append(field, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = field.value.trim();
    if (!value) {
      field.focus();
      return;
    }
    send(value, value);
  });
  inputArea.append(form);
  field.focus({ preventScroll: true });
}

function choiceField(spec) {
  const group = el("div", "choices");
  group.setAttribute("role", "group");
  if (spec.multiple) {
    const selected = new Set();
    for (const item of spec.items) {
      const label = el("label", "choice check");
      const box = el("input");
      box.type = "checkbox";
      box.addEventListener("change", () => (box.checked ? selected.add(item.id) : selected.delete(item.id)));
      label.append(box, el("span", "", item.label));
      group.append(label);
    }
    const button = el("button", "primary", spec.buttonLabel || "Send");
    button.type = "button";
    button.addEventListener("click", () => {
      if (selected.size === 0) return setStatus("Choose at least one option.");
      const ids = spec.items.filter((item) => selected.has(item.id));
      send(ids.map((item) => item.id), ids.map((item) => item.label).join(", "));
    });
    inputArea.append(group, button);
    return;
  }
  for (const item of spec.items) {
    const button = el("button", "choice", item.label);
    button.type = "button";
    button.addEventListener("click", () => send(item.id, item.label));
    group.append(button);
  }
  inputArea.append(group);
}

function ratingField(spec) {
  const low = spec.scale === "nps" ? 0 : 1;
  const high = spec.scale === "nps" ? 10 : spec.length;
  const group = el("div", "rating " + spec.scale);
  group.setAttribute("role", "group");
  for (let value = low; value <= high; value += 1) {
    const text = spec.scale === "stars" ? "★".repeat(value) : String(value);
    const button = el("button", "choice rating-option", spec.scale === "stars" ? "★" : String(value));
    button.type = "button";
    button.setAttribute("aria-label", spec.scale === "stars" ? value + " of " + high + " stars" : String(value));
    button.addEventListener("click", () => send(String(value), text));
    group.append(button);
  }
  inputArea.append(group);
  if (spec.leftLabel || spec.rightLabel) {
    const legend = el("div", "rating-legend");
    legend.append(el("span", "", spec.leftLabel || ""), el("span", "", spec.rightLabel || ""));
    inputArea.append(legend);
  }
}

function renderInput(spec) {
  pendingInput = spec;
  clearInput();
  if (spec.type === "choice_input") choiceField(spec);
  else if (spec.type === "rating_input") ratingField(spec);
  else textField(spec);
  scrollToEnd();
}

async function start() {
  sessionId = null;
  pendingInput = null;
  setStatus("");
  clearInput();
  const hidden = {};
  for (const [key, value] of new URLSearchParams(location.search)) {
    if (key !== "embed" && Object.keys(hidden).length < 20) hidden[key.slice(0, 64)] = value.slice(0, 500);
  }
  const honeypot = document.getElementById("website");
  const result = await post("/sessions", { hidden, website: honeypot ? honeypot.value : "" });
  if (!result.ok) {
    bubble("bot", (result.payload.error && result.payload.error.message) || "This bot couldn't start. Try again later.", "system");
    restartButton("Try again");
    return;
  }
  sessionId = result.payload.sessionId;
  await render(result.payload);
}

document.title = config.botName;
start();
`;

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

export function renderChatPage(input: {
	botName: string;
	embed: boolean;
	flow: Flow;
}): RenderedPage {
	const nonce = newNonce();
	const { theme } = input.flow;
	const accent = HEX_COLOR.test(theme.accent) ? theme.accent : "#2563eb";
	const config = {
		botName: theme.botName || input.botName,
		avatarUrl: httpsOrNull(theme.avatarUrl),
		typingDelayMs: theme.typingDelayMs,
		embed: input.embed,
	};
	const title = escapeHtml(config.botName);
	const html = `<!doctype html>
<html lang="en">
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
    .bubble.bot { background: var(--bot); border-bottom-left-radius: 6px; }
    .bubble.bot.system { background: var(--system); }
    .bubble.visitor { background: var(--accent); color: #fff; border-bottom-right-radius: 6px; }
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
      <div id="messages" role="log" aria-live="polite" aria-label="Conversation"></div>
      <p class="status" id="status-line" role="status"></p>
      <div id="input-area"></div>
      <label class="honeypot" aria-hidden="true">Leave this field empty<input id="website" name="website" tabindex="-1" autocomplete="off"></label>
      ${input.embed ? "" : '<p class="attribution">Made with Ryu Bot Flows</p>'}
    </main>
  </div>
  <script id="bot-data" type="application/json" nonce="${nonce}">${scriptJson(config)}</script>
  <script nonce="${nonce}">${CHAT_SCRIPT}</script>
</body>
</html>`;
	return { html, nonce };
}

export function renderClosedPage(message: string): RenderedPage {
	const nonce = newNonce();
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Conversation closed</title>
  <style nonce="${nonce}">
    ${baseStyles("#2563eb", "auto")}
    main { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; text-align: center; }
    p { max-width: 420px; margin: 0; color: var(--muted); line-height: 1.6; }
  </style>
</head>
<body><main><p>${escapeHtml(message)}</p></main></body>
</html>`;
	return { html, nonce };
}
