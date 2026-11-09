/**
 * `embed.js`: a dependency-free loader that embeds a published bot in another
 * site through an iframe to the hosted page (`?embed=1`). The host site must
 * be listed in the bot's allowed embed origins, which become the page's
 * `frame-ancestors`.
 *
 *   <script src="https://node.example/bots/support/embed.js"></script>
 *   <script>RyuBotFlows.init({ mode: "bubble" });</script>
 *
 * `init({ slug?, mode: "standard" | "popup" | "bubble", target?, hidden?,
 * height?, buttonColor?, title?, openLabel? })` returns
 * `{ open, close, toggle, destroy }`. The slug defaults to the one in the script
 * URL, and the base URL is derived from the script's own `src`, so no origin is
 * hard-coded. The panel and launcher names follow the visitor's
 * `navigator.languages` (see `embed.i18n.ts`) unless `title` / `openLabel` set
 * them, and the bubble sits at the inline end (left on a `dir="rtl"` page).
 */
import { embedLabelsLiteral } from "./embed.i18n.ts";

export const EMBED_SCRIPT = String.raw`(function () {
  "use strict";
  if (window.RyuBotFlows) return;
  var script = document.currentScript;
  var source = script && script.src ? new URL(script.src, location.href) : null;
  var match = source ? source.pathname.match(/^(.*)\/([a-z0-9][a-z0-9-]{1,46}[a-z0-9])\/embed\.js$/) : null;
  var base = match ? source.origin + match[1] : "";
  var defaultSlug = match ? match[2] : "";
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var LABELS = ${embedLabelsLiteral()};

  function labelsFor(tag) {
    if (Object.prototype.hasOwnProperty.call(LABELS, tag)) return LABELS[tag];
    try {
      var wanted = new Intl.Locale(tag).maximize();
      if (wanted.language === "en") return LABELS.en;
      for (var key in LABELS) {
        var official = new Intl.Locale(key).maximize();
        if (official.language === wanted.language && official.script === wanted.script) return LABELS[key];
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function visitorLabels() {
    var nav = window.navigator || {};
    var tags = nav.languages && nav.languages.length ? nav.languages : [nav.language || "en"];
    for (var i = 0; i < tags.length && i < 20; i++) {
      var found = labelsFor(String(tags[i] || ""));
      if (found) return found;
    }
    return LABELS.en;
  }

  function chatLabel(options) {
    return options.title || visitorLabels().chat;
  }

  function inlineEnd() {
    var root = document.documentElement;
    return root && String(root.dir || "").toLowerCase() === "rtl" ? "left" : "right";
  }

  function frameUrl(slug, hidden) {
    var url = new URL(base + "/" + encodeURIComponent(slug));
    url.searchParams.set("embed", "1");
    if (hidden && typeof hidden === "object") {
      Object.keys(hidden).slice(0, 20).forEach(function (key) {
        if (key !== "embed") url.searchParams.set(key, String(hidden[key]).slice(0, 500));
      });
    }
    return url.toString();
  }

  function createFrame(options) {
    var frame = document.createElement("iframe");
    frame.src = frameUrl(options.slug || defaultSlug, options.hidden);
    frame.title = chatLabel(options);
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.style.border = "0";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.display = "block";
    frame.style.colorScheme = "normal";
    return frame;
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target.nodeType === 1 ? target : null;
  }

  function panel(options, bubbleMode) {
    var container = document.createElement("div");
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", chatLabel(options));
    var style = container.style;
    style.position = "fixed";
    style.zIndex = "2147483646";
    style.background = "#fff";
    style.overflow = "hidden";
    style.boxShadow = "0 12px 40px rgba(0,0,0,.24)";
    style.display = "none";
    if (bubbleMode) {
      style[inlineEnd()] = "20px";
      style.bottom = "92px";
      style.width = "min(400px, calc(100vw - 40px))";
      style.height = "min(640px, calc(100vh - 120px))";
      style.borderRadius = "16px";
    } else {
      style.left = "50%";
      style.top = "50%";
      style.transform = "translate(-50%, -50%)";
      style.width = "min(480px, calc(100vw - 32px))";
      style.height = "min(680px, calc(100vh - 32px))";
      style.borderRadius = "16px";
    }
    return container;
  }

  function launcher(color, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    var style = button.style;
    style.position = "fixed";
    style[inlineEnd()] = "20px";
    style.bottom = "20px";
    style.width = "56px";
    style.height = "56px";
    style.border = "0";
    style.borderRadius = "50%";
    style.background = color;
    style.color = "#fff";
    style.cursor = "pointer";
    style.zIndex = "2147483647";
    style.boxShadow = "0 6px 20px rgba(0,0,0,.25)";
    style.display = "grid";
    style.placeItems = "center";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z");
    svg.appendChild(path);
    button.appendChild(svg);
    return button;
  }

  function init(options) {
    options = options || {};
    if (!base || !(options.slug || defaultSlug)) {
      throw new Error("RyuBotFlows: load embed.js from a bot link, e.g. /bots/<slug>/embed.js");
    }
    var mode = options.mode || "standard";
    var color = HEX.test(options.buttonColor || "") ? options.buttonColor : "#2563eb";
    if (mode === "standard") {
      var target = resolveTarget(options.target);
      if (!target) throw new Error("RyuBotFlows: standard mode needs a target element");
      var wrapper = document.createElement("div");
      wrapper.style.width = "100%";
      wrapper.style.height = (Number(options.height) > 0 ? Number(options.height) : 600) + "px";
      wrapper.appendChild(createFrame(options));
      target.appendChild(wrapper);
      return {
        open: function () {},
        close: function () {},
        toggle: function () {},
        destroy: function () { wrapper.remove(); },
      };
    }
    var container = panel(options, mode === "bubble");
    var backdrop = null;
    var frame = null;
    var button = null;
    var isOpen = false;
    function open() {
      if (!frame) {
        frame = createFrame(options);
        container.appendChild(frame);
      }
      if (backdrop) backdrop.style.display = "block";
      container.style.display = "block";
      isOpen = true;
      if (button) button.setAttribute("aria-expanded", "true");
    }
    function close() {
      container.style.display = "none";
      if (backdrop) backdrop.style.display = "none";
      isOpen = false;
      if (button) button.setAttribute("aria-expanded", "false");
    }
    function toggle() { isOpen ? close() : open(); }
    if (mode === "popup") {
      backdrop = document.createElement("div");
      backdrop.style.position = "fixed";
      backdrop.style.inset = "0";
      backdrop.style.background = "rgba(0,0,0,.4)";
      backdrop.style.zIndex = "2147483645";
      backdrop.style.display = "none";
      backdrop.addEventListener("click", close);
      document.body.appendChild(backdrop);
    } else {
      var openLabel = typeof options.openLabel === "string" && options.openLabel ? options.openLabel : visitorLabels().openChat;
      button = launcher(color, openLabel);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", toggle);
      document.body.appendChild(button);
    }
    document.body.appendChild(container);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen) close();
    });
    if (mode === "popup" && options.autoOpen !== false) open();
    return {
      open: open,
      close: close,
      toggle: toggle,
      destroy: function () {
        container.remove();
        if (backdrop) backdrop.remove();
        if (button) button.remove();
      },
    };
  }

  window.RyuBotFlows = { init: init };
})();
`;
