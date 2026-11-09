/**
 * The hosted chat page's inline vanilla-JS client. Every piece of bot or
 * visitor text reaches the DOM through `textContent` (or `createTextNode`);
 * the page never uses `innerHTML`. Its own chrome comes from `config.copy`,
 * which `respondent.ts` fills in the visitor's language.
 */
export const CHAT_SCRIPT = String.raw`
"use strict";
const config = JSON.parse(document.getElementById("bot-data").textContent || "{}");
const copy = config.copy || {};
const fill = (message, values) => message.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
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
  indicator.setAttribute("aria-label", fill(copy.typing, { name: config.botName }));
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
      holder.append(frame(message.embedUrl, 220, copy.video));
    } else {
      const video = el("video", "media-video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      holder.append(video);
    }
  } else if (message.type === "embed") {
    holder.append(frame(url, message.height, copy.embeddedContent));
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

function errorText(payload, fallback) {
  const error = payload.error;
  const errors = copy.errors || { codes: {}, messages: {} };
  const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
  if (!error) return fallback;
  if (has(errors.codes, error.code)) return errors.codes[error.code];
  if (has(errors.messages, error.message)) return errors.messages[error.message];
  return error.code === "closed" && error.message ? error.message : fallback;
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
      const link = el("a", "link-button", copy.openLink);
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
    setStatus(copy.conversationEnded);
    restartButton(copy.startOver);
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
    bubble("bot", copy.conversationExpired, "system");
    restartButton(copy.startNewConversation);
    return;
  }
  if (!result.ok) {
    bubble("bot", errorText(result.payload, copy.somethingWentWrong), "system");
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
  field.setAttribute("aria-label", spec.placeholder || copy.yourAnswer);
  field.placeholder = spec.placeholder || copy.typeYourAnswer;
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
  const button = el("button", "primary", spec.buttonLabel || copy.send);
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
    const button = el("button", "primary", spec.buttonLabel || copy.send);
    button.type = "button";
    button.addEventListener("click", () => {
      if (selected.size === 0) return setStatus(copy.chooseAtLeastOne);
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
    button.setAttribute("aria-label", spec.scale === "stars" ? fill(copy.starsLabel, { value, total: high }) : String(value));
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
    bubble("bot", errorText(result.payload, copy.couldNotStart), "system");
    restartButton(copy.tryAgain);
    return;
  }
  sessionId = result.payload.sessionId;
  await render(result.payload);
}

document.title = config.botName;
start();
`;
