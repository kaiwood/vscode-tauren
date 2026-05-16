"use strict";
(() => {
  // src/webview/codeHighlighting.ts
  var maxHighlightCodeLength = 2e5;
  var maxCachedHighlights = 150;
  var highlightedElements = /* @__PURE__ */ new Map();
  var pendingHighlights = /* @__PURE__ */ new Map();
  var highlightHtmlCache = /* @__PURE__ */ new Map();
  var postMessage;
  var nextHighlightRequestId = 1;
  function configureCodeHighlighting(post) {
    postMessage = post;
  }
  function requestCodeHighlight(element, code, language, options = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const themeId = getActiveThemeId();
    if (!postMessage || !code || code.length > maxHighlightCodeLength || !normalizedLanguage) {
      return false;
    }
    const existing = highlightedElements.get(element);
    if (!options.force && existing?.code === code && existing.language === normalizedLanguage && existing.themeId === themeId) {
      return true;
    }
    const cacheKey = getHighlightCacheKey(code, normalizedLanguage, themeId);
    const cached = highlightHtmlCache.get(cacheKey);
    if (cached) {
      applyCachedHighlight(element, code, normalizedLanguage, themeId, cached);
      return true;
    }
    const id = `highlight-${nextHighlightRequestId++}`;
    const info = {
      code,
      language: normalizedLanguage,
      themeId,
      requestId: id
    };
    highlightedElements.set(element, info);
    pendingHighlights.set(id, info);
    element.dataset.shikiHighlightId = id;
    element.classList.add("tau-shiki-pending");
    postMessage({
      type: "highlightCode",
      id,
      code,
      language: normalizedLanguage,
      themeId
    });
    return true;
  }
  function requestCodeHighlightsIn(root) {
    const elements = Array.from(root.querySelectorAll("pre code, pre[data-shiki-language]"));
    for (const codeElement of elements) {
      if (!(codeElement instanceof HTMLElement)) {
        continue;
      }
      requestCodeHighlight(codeElement, codeElement.textContent ?? "", getCodeElementLanguage(codeElement));
    }
  }
  function watchCodeHighlightThemeChanges() {
    let activeThemeId = getActiveThemeId();
    const refreshIfThemeChanged = () => {
      const nextThemeId = getActiveThemeId();
      if (nextThemeId === activeThemeId) {
        return;
      }
      activeThemeId = nextThemeId;
      refreshConnectedHighlights();
    };
    new MutationObserver(refreshIfThemeChanged).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-vscode-theme-id"]
    });
  }
  function handleCodeHighlightMessage(message) {
    if (!isRecord(message) || typeof message.type !== "string") {
      return false;
    }
    if (message.type === "highlightCodeResult") {
      applyCodeHighlightResult(message);
      return true;
    }
    if (message.type === "codeThemeChanged") {
      refreshConnectedHighlights();
      return true;
    }
    return false;
  }
  function applyCodeHighlightResult(message) {
    if (typeof message.id !== "string") {
      return;
    }
    const info = pendingHighlights.get(message.id);
    pendingHighlights.delete(message.id);
    if (!info) {
      return;
    }
    const sanitizedHtml = sanitizeHighlightHtml(message.html);
    if (sanitizedHtml) {
      rememberHighlightHtml(getHighlightCacheKey(info.code, info.language, info.themeId), sanitizedHtml);
    }
    const entry = findHighlightByRequestId(message.id);
    if (!entry) {
      return;
    }
    const [element] = entry;
    if (!element.isConnected || element.dataset.shikiHighlightId !== info.requestId) {
      highlightedElements.delete(element);
      return;
    }
    element.classList.remove("tau-shiki-pending");
    if (!sanitizedHtml) {
      return;
    }
    element.innerHTML = sanitizedHtml;
  }
  function refreshConnectedHighlights() {
    for (const [element, info] of Array.from(highlightedElements.entries())) {
      if (!element.isConnected) {
        highlightedElements.delete(element);
        continue;
      }
      element.textContent = info.code;
      requestCodeHighlight(element, info.code, info.language, { force: true });
    }
  }
  function applyCachedHighlight(element, code, language, themeId, cached) {
    highlightedElements.set(element, {
      code,
      language,
      themeId,
      requestId: ""
    });
    delete element.dataset.shikiHighlightId;
    element.classList.remove("tau-shiki-pending");
    element.innerHTML = cached.html;
  }
  function sanitizeHighlightHtml(value) {
    if (typeof value !== "string" || value.length === 0 || !window.DOMPurify) {
      return void 0;
    }
    return window.DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["style"]
    });
  }
  function rememberHighlightHtml(cacheKey, html) {
    if (highlightHtmlCache.has(cacheKey)) {
      highlightHtmlCache.delete(cacheKey);
    }
    highlightHtmlCache.set(cacheKey, { html });
    if (highlightHtmlCache.size <= maxCachedHighlights) {
      return;
    }
    const oldestKey = highlightHtmlCache.keys().next().value;
    if (typeof oldestKey === "string") {
      highlightHtmlCache.delete(oldestKey);
    }
  }
  function getHighlightCacheKey(code, language, themeId) {
    return `${themeId}\0${language}\0${code}`;
  }
  function findHighlightByRequestId(requestId) {
    for (const entry of highlightedElements.entries()) {
      if (entry[1].requestId === requestId) {
        return entry;
      }
    }
    return void 0;
  }
  function getCodeElementLanguage(codeElement) {
    if (codeElement.dataset.shikiLanguage) {
      return codeElement.dataset.shikiLanguage;
    }
    for (const className of Array.from(codeElement.classList)) {
      const match = className.match(/^language-(.+)$/);
      if (match) {
        return match[1];
      }
    }
    return void 0;
  }
  function getActiveThemeId() {
    return document.body.getAttribute("data-vscode-theme-id") || "";
  }
  function normalizeLanguage(language) {
    const normalized = language?.trim().toLowerCase();
    if (!normalized) {
      return void 0;
    }
    const aliases = {
      cjs: "javascript",
      js: "javascript",
      jsx: "javascriptreact",
      mjs: "javascript",
      shell: "shellscript",
      sh: "shellscript",
      ts: "typescript",
      tsx: "typescriptreact",
      yml: "yaml"
    };
    return aliases[normalized] || normalized;
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  // src/webview/dom.ts
  function getWebviewDom() {
    return {
      viewElement: queryRequired(".pi-view"),
      toolbarTitleElement: queryRequired(".pi-toolbar__title"),
      toolbarTitleTextElement: queryRequired(".pi-toolbar__title-text"),
      sessionNameInputElement: queryRequired(".pi-toolbar__title-input"),
      sessionToggleButton: queryRequired(".pi-toolbar__sessions"),
      sessionMenuWrapElement: queryRequired(".pi-toolbar__menu-wrap"),
      sessionMenuButton: queryRequired(".pi-toolbar__menu-button"),
      sessionMenuElement: queryRequired(".pi-toolbar__menu"),
      sessionMenuItemElements: queryAll(".pi-toolbar__menu-item"),
      toastElement: queryRequired(".pi-toast"),
      messagesElement: queryRequired(".messages"),
      sessionsElement: queryRequired(".sessions"),
      form: queryRequired(".composer"),
      textarea: queryRequired("textarea"),
      slashMenuElement: queryRequired(".composer__slash-menu"),
      contextBadgesElement: queryRequired(".composer__context-badges"),
      busySubmitElement: queryRequired(".composer__busy-submit"),
      diffSummaryElement: queryRequired(".composer__diff-summary"),
      diffAddedElement: queryRequired(".composer__diff-added"),
      diffRemovedElement: queryRequired(".composer__diff-removed"),
      streamingBehaviorButtonElements: queryAll(".composer__mode-button"),
      newSessionButton: queryRequired(".composer__add"),
      contextElement: queryRequired(".composer__context"),
      contextValueElement: queryRequired(".composer__context-value"),
      contextTooltipElement: queryRequired(".composer__context-tooltip"),
      modelElement: queryRequired(".composer__model"),
      modelMenuElement: queryRequired(".composer__model-menu"),
      modelSelectElement: queryRequired(".composer__model-select"),
      thinkingSelectElement: queryRequired(".composer__thinking-select"),
      submitButton: queryRequired(".composer__submit")
    };
  }
  function queryRequired(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Missing required webview element: ${selector}`);
    }
    return element;
  }
  function queryAll(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  // src/webview/markdown.ts
  var markdownRenderer = window.markdownit ? window.markdownit({
    html: false,
    linkify: true,
    breaks: false
  }) : void 0;
  function renderMarkdownInto(element, text, options = {}) {
    if (!markdownRenderer || !window.DOMPurify) {
      element.textContent = text;
      animateNewVisibleText(element, options.animateFromText);
      return;
    }
    element.classList.add("message__body--markdown");
    const rendered = markdownRenderer.render(text);
    element.innerHTML = window.DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true }
    });
    linkifyFileReferences(element);
    requestCodeHighlightsIn(element);
    animateNewVisibleText(element, options.animateFromText);
  }
  function renderHighlightedCodeInto(element, code, filePath) {
    const language = getPathLanguageHint(filePath);
    if (!language) {
      return false;
    }
    element.dataset.shikiLanguage = language;
    element.textContent = code;
    return requestCodeHighlight(element, code, language);
  }
  function linkifyFileReferences(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => shouldLinkifyTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    for (const node of nodes) {
      replaceFileReferences(node);
    }
  }
  function shouldLinkifyTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) {
      return false;
    }
    return !parent.closest("a, pre, kbd, samp");
  }
  function replaceFileReferences(node) {
    const text = node.textContent ?? "";
    const pattern = /((?:\.{1,2}\/|\/|[A-Za-z0-9_-]+\/)[^\s`"'<>()[\]{}]+?\.[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)(?::(\d+)(?::(\d+))?)?/g;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;
    let match;
    while (match = pattern.exec(text)) {
      const before = text.slice(lastIndex, match.index);
      if (!isSafeFileReferenceBoundary(before, text, pattern.lastIndex)) {
        continue;
      }
      const parsed = parseFileReferenceMatch(match[0], match[1], match[2], match[3]);
      if (!parsed) {
        continue;
      }
      if (match.index > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      fragment.append(createFileReferenceLink(parsed));
      changed = true;
      lastIndex = match.index + parsed.linkText.length;
      pattern.lastIndex = lastIndex;
    }
    if (!changed) {
      return;
    }
    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  }
  function isSafeFileReferenceBoundary(before, text, endIndex) {
    const previous = before.charAt(before.length - 1);
    const next = text.charAt(endIndex);
    return !/[A-Za-z0-9_@:\/.-]/.test(previous) && !/[A-Za-z0-9_\/-]/.test(next);
  }
  function parseFileReferenceMatch(fullMatch, pathMatch, lineMatch, columnMatch) {
    const trailing = pathMatch.match(/[.,;:!?]+$/)?.[0] ?? "";
    const filePath = trailing ? pathMatch.slice(0, -trailing.length) : pathMatch;
    if (!filePath || filePath.endsWith("/")) {
      return void 0;
    }
    const line = lineMatch ? Number(lineMatch) : void 0;
    const column = columnMatch ? Number(columnMatch) : void 0;
    if (line !== void 0 && (!Number.isInteger(line) || line < 1) || column !== void 0 && (!Number.isInteger(column) || column < 1)) {
      return void 0;
    }
    return {
      path: filePath,
      ...line ? { line } : {},
      ...column ? { column } : {},
      linkText: fullMatch.slice(0, fullMatch.length - trailing.length)
    };
  }
  function createFileReferenceLink(reference) {
    const link = document.createElement("a");
    link.href = "#";
    link.className = "tau-file-link";
    link.textContent = reference.linkText;
    link.dataset.filePath = reference.path;
    if (reference.line) {
      link.dataset.line = String(reference.line);
    }
    if (reference.column) {
      link.dataset.column = String(reference.column);
    }
    return link;
  }
  function animateNewVisibleText(root, previousVisibleText) {
    if (previousVisibleText === void 0) {
      return;
    }
    const nextVisibleText = root.textContent ?? "";
    const startOffset = getCommonPrefixLength(previousVisibleText, nextVisibleText);
    if (startOffset >= nextVisibleText.length || previousVisibleText.length > 0 && startOffset === 0) {
      return;
    }
    wrapVisibleTextRange(root, startOffset, nextVisibleText.length);
  }
  function getCommonPrefixLength(left, right) {
    const limit = Math.min(left.length, right.length);
    let index = 0;
    while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
      index += 1;
    }
    return index;
  }
  function wrapVisibleTextRange(root, rangeStart, rangeEnd) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let visibleOffset = 0;
    let current = walker.nextNode();
    while (current) {
      const node = current;
      const textLength = node.textContent?.length ?? 0;
      const nodeStart = visibleOffset;
      const nodeEnd = nodeStart + textLength;
      if (nodeEnd > rangeStart && nodeStart < rangeEnd && !shouldSkipStreamingTextNode(node)) {
        ranges.push({
          node,
          start: Math.max(0, rangeStart - nodeStart),
          end: Math.min(textLength, rangeEnd - nodeStart)
        });
      }
      visibleOffset = nodeEnd;
      current = walker.nextNode();
    }
    let wordIndex = 0;
    for (const range of ranges) {
      wordIndex = wrapTextNodeRange(range.node, range.start, range.end, wordIndex);
    }
  }
  function shouldSkipStreamingTextNode(node) {
    const parent = node.parentElement;
    return !parent || Boolean(parent.closest("a, code, pre, kbd, samp, svg, math, annotation"));
  }
  function wrapTextNodeRange(node, start, end, initialWordIndex) {
    const text = node.textContent ?? "";
    if (start >= end) {
      return initialWordIndex;
    }
    const fragment = document.createDocumentFragment();
    let wordIndex = initialWordIndex;
    if (start > 0) {
      fragment.append(document.createTextNode(text.slice(0, start)));
    }
    wordIndex = appendAnimatedText(fragment, text.slice(start, end), wordIndex);
    if (end < text.length) {
      fragment.append(document.createTextNode(text.slice(end)));
    }
    node.replaceWith(fragment);
    return wordIndex;
  }
  function appendAnimatedText(fragment, text, initialWordIndex) {
    const tokens = text.match(/\s+|\S+/g) ?? [];
    let wordIndex = initialWordIndex;
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        fragment.append(document.createTextNode(token));
        continue;
      }
      const span = document.createElement("span");
      span.className = "tau-stream-word";
      span.textContent = token;
      if (wordIndex > 0) {
        span.style.animationDelay = Math.min(wordIndex * 16, 120) + "ms";
      }
      fragment.append(span);
      wordIndex += 1;
    }
    return wordIndex;
  }
  function getPathLanguageHint(filePath) {
    const basename = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    if (basename === "dockerfile") {
      return "dockerfile";
    }
    if (basename === "makefile") {
      return "makefile";
    }
    const extensionMatch = basename.match(/\.([a-z0-9]+)$/);
    return extensionMatch?.[1] ?? "";
  }

  // src/webview/renderMessages.ts
  var activityExpansion = /* @__PURE__ */ new Map();
  function createMessageElement(message, showRole, messageIndex, options = {}) {
    const article = document.createElement("article");
    article.className = `message message--${message.role}${message.error ? " message--error" : ""}${message.variant === "thinking" ? " message--thinking" : ""}`;
    const body = document.createElement("div");
    body.className = "message__body";
    if (message.role === "assistant" && !message.error) {
      renderMarkdownInto(body, message.text || "", options);
    } else {
      body.textContent = message.text || "";
    }
    if (showRole) {
      const role = document.createElement("div");
      role.className = "message__role";
      role.textContent = roleLabel(message.role);
      article.append(role);
    }
    const activities = Array.isArray(message.activities) ? message.activities : [];
    const hasBody = Boolean(message.text || message.error || activities.length === 0);
    if (message.role !== "assistant") {
      article.append(body);
      return article;
    }
    if (activities.length > 0) {
      article.append(createActivityListElement(activities, options));
    }
    if (hasBody) {
      if (activities.length > 0) {
        body.classList.add("message__body--after-activities");
      }
      article.append(body);
    }
    if (canCopyAssistantMessage(message) && typeof messageIndex === "number") {
      article.append(createCopyButtonElement(messageIndex));
    }
    return article;
  }
  function updateMessageBodyElement(article, message, options = {}) {
    const body = getDirectMessageBodyElement(article);
    if (!body) {
      return false;
    }
    body.className = "message__body";
    if (message.role === "assistant" && Array.isArray(message.activities) && message.activities.length > 0) {
      body.classList.add("message__body--after-activities");
    }
    if (message.role === "assistant" && !message.error) {
      renderMarkdownInto(body, message.text || "", options);
    } else {
      body.textContent = message.text || "";
    }
    return true;
  }
  function getDirectMessageBodyElement(article) {
    for (const child of Array.from(article.children)) {
      if (child instanceof HTMLElement && child.classList.contains("message__body")) {
        return child;
      }
    }
    return void 0;
  }
  function canCopyAssistantMessage(message) {
    return message.role === "assistant" && !message.error && message.variant !== "thinking" && Boolean(message.text);
  }
  function createCopyButtonElement(messageIndex) {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    const button = document.createElement("button");
    button.className = "message__copy";
    button.type = "button";
    button.title = "Copy response";
    button.setAttribute("aria-label", "Copy response");
    button.dataset.copyMessageIndex = String(messageIndex);
    button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 1.75A1.75 1.75 0 0 1 6.75 0h6.5A1.75 1.75 0 0 1 15 1.75v6.5A1.75 1.75 0 0 1 13.25 10h-1.5v1.25A1.75 1.75 0 0 1 10 13H3.75A1.75 1.75 0 0 1 2 11.25v-6.5A1.75 1.75 0 0 1 3.75 3H5V1.75Zm1.75-.25a.25.25 0 0 0-.25.25V3H10a1.75 1.75 0 0 1 1.75 1.75V8.5h1.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5ZM3.75 4.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H10a.25.25 0 0 0 .25-.25v-6.5A.25.25 0 0 0 10 4.5H3.75Z"/></svg>';
    actions.append(button);
    return actions;
  }
  function createActivityListElement(activities, options) {
    const list = document.createElement("div");
    list.className = "activity-list";
    for (const activity of activities) {
      list.append(createActivityElement(activity, options));
    }
    return list;
  }
  function createActivityElement(activity, options) {
    const details = document.createElement("details");
    details.className = `activity activity--${activity.kind || "rpc"} activity--${activity.status || "info"}`;
    const activityId = typeof activity.id === "string" ? activity.id : "";
    const savedOpenState = activityExpansion.get(activityId);
    details.open = typeof savedOpenState === "boolean" ? savedOpenState : activity.status === "running" || shouldKeepActivityOpen(activity);
    details.addEventListener("toggle", () => {
      if (activityId) {
        activityExpansion.set(activityId, details.open);
      }
    });
    const summary = document.createElement("summary");
    summary.className = "activity__summary";
    const title = document.createElement("span");
    title.className = "activity__title";
    title.textContent = typeof activity.title === "string" ? activity.title : "Activity";
    const status = document.createElement("span");
    status.className = "activity__status";
    status.textContent = activityStatusLabel(activity.status);
    summary.append(title, status);
    if (typeof activity.summary === "string" && activity.summary.length > 0) {
      const description = document.createElement("span");
      description.className = "activity__description";
      description.textContent = activity.summary;
      summary.append(description);
    }
    details.append(summary);
    if (typeof activity.body === "string" && activity.body.length > 0) {
      const body = document.createElement(activity.code ? "pre" : "div");
      body.className = `activity__body${activity.code ? " activity__body--code" : " activity__body--markdown"}`;
      if (activity.code) {
        if (options.outputColors === false || !renderReadActivityCodeInto(body, activity)) {
          renderAnsiTextInto(body, activity.body, options.outputColors !== false);
        }
      } else {
        renderMarkdownInto(body, activity.body);
      }
      details.append(body);
    }
    return details;
  }
  function renderReadActivityCodeInto(element, activity) {
    if (activity.kind !== "tool_execution" || typeof activity.title !== "string" || typeof activity.body !== "string") {
      return false;
    }
    const filePath = parseReadActivityPath(activity.title);
    if (!filePath || containsAnsiEscape(activity.body)) {
      return false;
    }
    return renderHighlightedCodeInto(element, activity.body, filePath);
  }
  function parseReadActivityPath(title) {
    const match = title.match(/^read\s+(.+?)(?::\d+(?:-\d+)?)?$/);
    return match?.[1];
  }
  function containsAnsiEscape(value) {
    return /\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/.test(value);
  }
  function stripAnsiSequences(value) {
    return value.replace(/\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/g, "");
  }
  function renderAnsiTextInto(element, value, outputColors) {
    element.replaceChildren();
    if (!outputColors) {
      element.textContent = stripAnsiSequences(value);
      return;
    }
    const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
    let style = {};
    let index = 0;
    let match;
    while ((match = csiPattern.exec(value)) !== null) {
      appendAnsiText(element, value.slice(index, match.index), style);
      if (match[3] === "m") {
        style = applyAnsiSgr(match[1], style);
      }
      index = match.index + match[0].length;
    }
    appendAnsiText(element, value.slice(index), style);
  }
  function appendAnsiText(element, value, style) {
    if (!value) {
      return;
    }
    if (isEmptyAnsiStyle(style)) {
      element.append(document.createTextNode(value));
      return;
    }
    const span = document.createElement("span");
    span.textContent = value;
    applyAnsiStyle(span, style);
    element.append(span);
  }
  function applyAnsiSgr(parameters, current) {
    const codes = parseAnsiCodes(parameters);
    let next = { ...current };
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      if (code === 0) {
        next = {};
      } else if (code === 1) {
        next.bold = true;
        next.dim = false;
      } else if (code === 2) {
        next.dim = true;
        next.bold = false;
      } else if (code === 22) {
        delete next.bold;
        delete next.dim;
      } else if (code === 3) {
        next.italic = true;
      } else if (code === 23) {
        delete next.italic;
      } else if (code === 4) {
        next.underline = true;
      } else if (code === 24) {
        delete next.underline;
      } else if (code === 7) {
        next.inverse = true;
      } else if (code === 27) {
        delete next.inverse;
      } else if (code === 9) {
        next.strikethrough = true;
      } else if (code === 29) {
        delete next.strikethrough;
      } else if (code === 39) {
        delete next.foreground;
      } else if (code === 49) {
        delete next.background;
      } else if (isBasicAnsiForeground(code)) {
        next.foreground = ansiBasicColor(code - 30, false);
      } else if (isBrightAnsiForeground(code)) {
        next.foreground = ansiBasicColor(code - 90, true);
      } else if (isBasicAnsiBackground(code)) {
        next.background = ansiBasicColor(code - 40, false);
      } else if (isBrightAnsiBackground(code)) {
        next.background = ansiBasicColor(code - 100, true);
      } else if ((code === 38 || code === 48) && codes[index + 1] === 5 && codes[index + 2] !== void 0) {
        const color = ansi256Color(codes[index + 2]);
        if (color) {
          if (code === 38) {
            next.foreground = color;
          } else {
            next.background = color;
          }
        }
        index += 2;
      } else if ((code === 38 || code === 48) && codes[index + 1] === 2 && codes[index + 2] !== void 0 && codes[index + 3] !== void 0 && codes[index + 4] !== void 0) {
        const color = ansiRgbColor(
          clampColor(codes[index + 2]),
          clampColor(codes[index + 3]),
          clampColor(codes[index + 4])
        );
        if (code === 38) {
          next.foreground = color;
        } else {
          next.background = color;
        }
        index += 4;
      }
    }
    return next;
  }
  function parseAnsiCodes(parameters) {
    if (!parameters || parameters === "?") {
      return [0];
    }
    return parameters.split(";").map((part) => part === "" ? 0 : Number(part)).filter((part) => Number.isInteger(part));
  }
  function applyAnsiStyle(element, style) {
    const foreground = style.inverse ? style.background : style.foreground;
    const background = style.inverse ? style.foreground : style.background;
    if (foreground) {
      element.style.color = foreground;
    } else if (style.inverse && background) {
      element.style.color = "var(--tau-code-background, var(--vscode-sideBar-background))";
    }
    if (background) {
      element.style.backgroundColor = background;
    } else if (style.inverse && foreground) {
      element.style.backgroundColor = foreground;
    }
    if (style.bold) {
      element.style.fontWeight = "700";
    }
    if (style.dim) {
      element.style.opacity = "0.72";
    }
    if (style.italic) {
      element.style.fontStyle = "italic";
    }
    const textDecoration = [
      style.underline ? "underline" : "",
      style.strikethrough ? "line-through" : ""
    ].filter(Boolean).join(" ");
    if (textDecoration) {
      element.style.textDecoration = textDecoration;
    }
  }
  function isEmptyAnsiStyle(style) {
    return !style.foreground && !style.background && !style.bold && !style.dim && !style.italic && !style.underline && !style.inverse && !style.strikethrough;
  }
  function isBasicAnsiForeground(code) {
    return code >= 30 && code <= 37;
  }
  function isBrightAnsiForeground(code) {
    return code >= 90 && code <= 97;
  }
  function isBasicAnsiBackground(code) {
    return code >= 40 && code <= 47;
  }
  function isBrightAnsiBackground(code) {
    return code >= 100 && code <= 107;
  }
  var ANSI_COLOR_NAMES = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  var ANSI_BRIGHT_COLOR_NAMES = ["BrightBlack", "BrightRed", "BrightGreen", "BrightYellow", "BrightBlue", "BrightMagenta", "BrightCyan", "BrightWhite"];
  var ANSI_COLOR_FALLBACK_VARIABLES = [
    "--tau-ansi-black-fallback",
    "--tau-ansi-red-fallback",
    "--tau-ansi-green-fallback",
    "--tau-ansi-yellow-fallback",
    "--tau-ansi-blue-fallback",
    "--tau-ansi-magenta-fallback",
    "--tau-ansi-cyan-fallback",
    "--tau-ansi-white-fallback"
  ];
  var ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES = [
    "--tau-ansi-bright-black-fallback",
    "--tau-ansi-bright-red-fallback",
    "--tau-ansi-bright-green-fallback",
    "--tau-ansi-bright-yellow-fallback",
    "--tau-ansi-bright-blue-fallback",
    "--tau-ansi-bright-magenta-fallback",
    "--tau-ansi-bright-cyan-fallback",
    "--tau-ansi-bright-white-fallback"
  ];
  var ANSI_COLOR_FALLBACKS = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
  var ANSI_BRIGHT_COLOR_FALLBACKS = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"];
  function ansiBasicColor(index, bright) {
    const names = bright ? ANSI_BRIGHT_COLOR_NAMES : ANSI_COLOR_NAMES;
    const fallbackVariables = bright ? ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES : ANSI_COLOR_FALLBACK_VARIABLES;
    const fallbacks = bright ? ANSI_BRIGHT_COLOR_FALLBACKS : ANSI_COLOR_FALLBACKS;
    const fallbackVariable = fallbackVariables[index] ?? "--tau-ansi-white-fallback";
    const fallback = fallbacks[index] ?? "#e5e5e5";
    return `var(--vscode-terminal-ansi${names[index] ?? "White"}, var(${fallbackVariable}, ${fallback}))`;
  }
  function ansi256Color(value) {
    if (value < 0 || value > 255) {
      return void 0;
    }
    if (value < 8) {
      return ansiBasicColor(value, false);
    }
    if (value < 16) {
      return ansiBasicColor(value - 8, true);
    }
    if (value >= 232) {
      const level = 8 + (value - 232) * 10;
      return `rgb(${level}, ${level}, ${level})`;
    }
    const offset = value - 16;
    const red = Math.floor(offset / 36);
    const green = Math.floor(offset % 36 / 6);
    const blue = offset % 6;
    const terminalColor = ansiCubeTerminalColor(red, green, blue);
    if (terminalColor) {
      return terminalColor;
    }
    return `rgb(${ansi256Channel(red)}, ${ansi256Channel(green)}, ${ansi256Channel(blue)})`;
  }
  function ansiCubeTerminalColor(red, green, blue) {
    if (red === 0 && green === 0 && blue === 0) {
      return ansiBasicColor(0, false);
    }
    if (red > 0 && green === 0 && blue === 0) {
      return ansiBasicColor(1, red >= 5);
    }
    if (red === 0 && green > 0 && blue === 0) {
      return ansiBasicColor(2, green >= 5);
    }
    if (red > 0 && green > 0 && blue === 0 && Math.abs(red - green) <= 1) {
      return ansiBasicColor(3, red >= 5 || green >= 5);
    }
    if (red === 0 && green === 0 && blue > 0) {
      return ansiBasicColor(4, blue >= 5);
    }
    if (red > 0 && green === 0 && blue > 0 && Math.abs(red - blue) <= 1) {
      return ansiBasicColor(5, red >= 5 || blue >= 5);
    }
    if (red === 0 && green > 0 && blue > 0 && Math.abs(green - blue) <= 1) {
      return ansiBasicColor(6, green >= 5 || blue >= 5);
    }
    if (red === green && green === blue) {
      if (red >= 5) {
        return ansiBasicColor(7, true);
      }
      if (red >= 3) {
        return ansiBasicColor(7, false);
      }
      return ansiBasicColor(0, true);
    }
    return void 0;
  }
  function ansi256Channel(value) {
    return value === 0 ? 0 : 55 + value * 40;
  }
  function ansiRgbColor(red, green, blue) {
    const terminalColor = ansiRgbTerminalColor(red, green, blue);
    if (terminalColor) {
      return terminalColor;
    }
    return `rgb(${red}, ${green}, ${blue})`;
  }
  function ansiRgbTerminalColor(red, green, blue) {
    const low = 32;
    const high = 128;
    const bright = 220;
    if (red <= low && green <= low && blue <= low) {
      return ansiBasicColor(0, false);
    }
    if (red >= high && green <= low && blue <= low) {
      return ansiBasicColor(1, red >= bright);
    }
    if (red <= low && green >= high && blue <= low) {
      return ansiBasicColor(2, green >= bright);
    }
    if (red >= high && green >= high && blue <= low && Math.abs(red - green) <= 80) {
      return ansiBasicColor(3, red >= bright || green >= bright);
    }
    if (red <= low && green <= low && blue >= high) {
      return ansiBasicColor(4, blue >= bright);
    }
    if (red >= high && green <= low && blue >= high && Math.abs(red - blue) <= 80) {
      return ansiBasicColor(5, red >= bright || blue >= bright);
    }
    if (red <= low && green >= high && blue >= high && Math.abs(green - blue) <= 80) {
      return ansiBasicColor(6, green >= bright || blue >= bright);
    }
    if (Math.abs(red - green) <= 16 && Math.abs(green - blue) <= 16) {
      if (red >= 220) {
        return ansiBasicColor(7, true);
      }
      if (red >= 160) {
        return ansiBasicColor(7, false);
      }
      if (red >= 80) {
        return ansiBasicColor(0, true);
      }
    }
    return void 0;
  }
  function clampColor(value) {
    return Math.max(0, Math.min(255, value));
  }
  function shouldKeepActivityOpen(activity) {
    return typeof activity.body === "string" && activity.body.length > 0;
  }
  function roleLabel(role) {
    if (role === "user") {
      return "You";
    }
    if (role === "assistant") {
      return "Pi";
    }
    return "System";
  }
  function activityStatusLabel(status) {
    if (status === "running") {
      return "Running";
    }
    if (status === "completed") {
      return "Done";
    }
    if (status === "error") {
      return "Error";
    }
    return "Info";
  }

  // src/webview/sessionFormat.ts
  function getSessionDisplayName(session) {
    const name = sanitizeSessionTitle(session.name);
    const firstMessage = sanitizeSessionTitle(session.firstMessage);
    return name || firstMessage || shortenPath(session.cwd) || "Untitled session";
  }
  function buildSessionTreePrefix(session) {
    const depth = Number(session.depth) || 0;
    if (depth <= 0) {
      return "";
    }
    const ancestors = Array.isArray(session.ancestorContinues) ? session.ancestorContinues : [];
    const parts = ancestors.map((continues) => continues ? "\u2502  " : "   ");
    parts.push(session.isLast ? "\u2514\u2500 " : "\u251C\u2500 ");
    return parts.join("");
  }
  function formatSessionMeta(session) {
    const count = typeof session.messageCount === "number" ? session.messageCount : 0;
    const age = formatRelativeTime(session.modified);
    const cwd = shortenPath(session.cwd);
    const countLabel = count === 1 ? "1 message" : count + " messages";
    return [countLabel, age, cwd].filter(Boolean).join(" \xB7 ");
  }
  function shortenPath(path) {
    if (typeof path !== "string" || path.length === 0) {
      return "";
    }
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
  }
  function sanitizeSessionTitle(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/<\/?[A-Za-z][^>\n]*(?:>|$)/g, "").replace(/\s+/g, " ").trim();
  }
  function formatRelativeTime(value) {
    if (typeof value !== "string" || value.length === 0) {
      return "";
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return "";
    }
    const diffMs = Date.now() - timestamp;
    const absMs = Math.abs(diffMs);
    const minute = 60 * 1e3;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (absMs < minute) {
      return "just now";
    }
    if (absMs < hour) {
      const minutes = Math.max(1, Math.round(absMs / minute));
      return minutes + "m ago";
    }
    if (absMs < day) {
      const hours = Math.round(absMs / hour);
      return hours + "h ago";
    }
    if (absMs < 7 * day) {
      const days = Math.round(absMs / day);
      return days + "d ago";
    }
    return new Date(timestamp).toLocaleDateString(void 0, {
      month: "short",
      day: "numeric"
    });
  }

  // src/webview/sessionItemCommands.ts
  var sessionItemMenuCommands = ["rename", "fork", "clone", "compact", "export", "delete", "showChanges"];
  var sessionItemCommandIcons = {
    rename: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4.1 11.9L5.45 11.6L11.15 5.9C11.55 5.5 11.55 4.85 11.15 4.45L10.9 4.2C10.5 3.8 9.85 3.8 9.45 4.2L3.75 9.9L3.45 11.25C3.37 11.65 3.7 11.98 4.1 11.9Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.85 4.8L10.55 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
    showChanges: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3.5H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 8H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 12.5H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5.5 2.25V4.75M10.5 6.75V9.25M7.5 11.25V13.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    fork: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><path d="M5.5 4.25V8.5C5.5 10.16 6.84 11.5 8.5 11.5H10.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 4.25V14.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M10.25 8.5L13.25 11.5L10.25 14.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.5" cy="4.25" r="1.55" fill="currentColor"/><circle cx="5.5" cy="14.75" r="1.55" fill="currentColor"/></svg>',
    clone: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><rect x="4.25" y="6.25" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.35"/><path d="M7.25 4.25H13.25C14.08 4.25 14.75 4.92 14.75 5.75V11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    compact: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3.5H3.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 3.5H12.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12.5H3.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 12.5H12.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.3 5.3L7.05 7.05M10.7 5.3L8.95 7.05M5.3 10.7L7.05 8.95M10.7 10.7L8.95 8.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    export: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3.5V10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M5.6 5.9L8 3.5L10.4 5.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.5V11.6C4 12.1 4.4 12.5 4.9 12.5H11.1C11.6 12.5 12 12.1 12 11.6V9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>',
    delete: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M6 2h4l1 1h3v1H2V3h3l1-1Zm-2 3h8l-.6 9.2A2 2 0 0 1 9.4 16H6.6a2 2 0 0 1-2-1.8L4 5Zm2 1v8h1V6H6Zm3 0v8h1V6H9Z"/></svg>'
  };
  function parseSessionItemCommand(command) {
    return command === "rename" || command === "showChanges" || command === "fork" || command === "clone" || command === "compact" || command === "export" || command === "delete" ? command : void 0;
  }
  function getSessionItemCommandLabel(command) {
    switch (command) {
      case "rename":
        return "Rename session";
      case "showChanges":
        return "Show changes";
      case "fork":
        return "Fork session";
      case "clone":
        return "Clone session";
      case "compact":
        return "Compact session";
      case "export":
        return "Export as HTML";
      case "delete":
        return "Move session to trash";
    }
  }
  function getSessionItemCommandIcon(command) {
    return sessionItemCommandIcons[command];
  }

  // src/webview/state.ts
  var initialWebviewState = {
    messages: [],
    busy: false,
    modelLabel: "",
    modelProvider: "",
    modelId: "",
    modelReasoning: false,
    thinkingLevel: "",
    modelOptions: [],
    contextUsageLabel: "",
    contextUsageTitle: "",
    contextUsageLevel: "",
    metadataRefreshing: false,
    workspaceDiffStats: { addedLines: 0, removedLines: 0 },
    slashCommands: [],
    slashCommandsRefreshing: false,
    outputColors: true,
    promptContext: [],
    composerText: "",
    composerTextRevision: 0,
    viewMode: "chat",
    sessions: [],
    sessionsRefreshing: false,
    sessionsError: "",
    currentSessionFile: "",
    currentSessionName: "",
    treeItems: [],
    treeRefreshing: false,
    treeError: "",
    sessionLoading: false
  };
  function parseWebviewStateMessage(data) {
    const record = isRecord2(data) ? data : {};
    return {
      messages: Array.isArray(record.messages) ? record.messages : [],
      busy: Boolean(record.busy),
      modelLabel: typeof record.modelLabel === "string" ? record.modelLabel : "",
      modelProvider: typeof record.modelProvider === "string" ? record.modelProvider : "",
      modelId: typeof record.modelId === "string" ? record.modelId : "",
      modelReasoning: Boolean(record.modelReasoning),
      thinkingLevel: typeof record.thinkingLevel === "string" ? record.thinkingLevel : "",
      modelOptions: Array.isArray(record.modelOptions) ? record.modelOptions : [],
      contextUsageLabel: typeof record.contextUsageLabel === "string" ? record.contextUsageLabel : "",
      contextUsageTitle: typeof record.contextUsageTitle === "string" ? record.contextUsageTitle : "",
      contextUsageLevel: typeof record.contextUsageLevel === "string" ? record.contextUsageLevel : "",
      metadataRefreshing: Boolean(record.metadataRefreshing),
      workspaceDiffStats: parseWorkspaceDiffStats(record.workspaceDiffStats),
      slashCommands: Array.isArray(record.slashCommands) ? record.slashCommands : [],
      slashCommandsRefreshing: Boolean(record.slashCommandsRefreshing),
      outputColors: typeof record.outputColors === "boolean" ? record.outputColors : true,
      promptContext: Array.isArray(record.promptContext) ? record.promptContext : [],
      composerText: typeof record.composerText === "string" ? record.composerText : "",
      composerTextRevision: typeof record.composerTextRevision === "number" ? record.composerTextRevision : 0,
      viewMode: record.viewMode === "sessions" || record.viewMode === "tree" ? record.viewMode : "chat",
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
      sessionsRefreshing: Boolean(record.sessionsRefreshing),
      sessionsError: typeof record.sessionsError === "string" ? record.sessionsError : "",
      currentSessionFile: typeof record.currentSessionFile === "string" ? record.currentSessionFile : "",
      currentSessionName: typeof record.currentSessionName === "string" ? record.currentSessionName : "",
      treeItems: Array.isArray(record.treeItems) ? record.treeItems : [],
      treeRefreshing: Boolean(record.treeRefreshing),
      treeError: typeof record.treeError === "string" ? record.treeError : "",
      sessionLoading: Boolean(record.sessionLoading)
    };
  }
  function parseWorkspaceDiffStats(value) {
    if (!isRecord2(value)) {
      return { addedLines: 0, removedLines: 0 };
    }
    return {
      addedLines: normalizeDiffLineCount(value.addedLines),
      removedLines: normalizeDiffLineCount(value.removedLines)
    };
  }
  function normalizeDiffLineCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null;
  }

  // src/slashCommands.ts
  var localSlashCommandDefinitions = [
    { name: "model", description: "Select model", source: "builtin", supported: true },
    { name: "name", description: "Set or clear session name", source: "builtin", supported: true },
    { name: "session", description: "Show session info and stats", source: "builtin", supported: true },
    { name: "compact", description: "Manually compact context", source: "builtin", supported: true },
    { name: "copy", description: "Copy last Pi response", source: "builtin", supported: true },
    { name: "export", description: "Export session to HTML", source: "builtin", supported: true },
    { name: "new", description: "Start a new session", source: "builtin", supported: true },
    { name: "settings", description: "Terminal-only: use VS Code settings instead", source: "unsupported", supported: false },
    { name: "scoped-models", description: "Terminal-only: scoped model cycling is not supported here yet", source: "unsupported", supported: false },
    { name: "import", description: "Terminal-only: session import is not supported here yet", source: "unsupported", supported: false },
    { name: "share", description: "Not supported here yet", source: "unsupported", supported: false },
    { name: "changelog", description: "Not supported here yet", source: "unsupported", supported: false },
    { name: "hotkeys", description: "Terminal-only: use VS Code keybindings instead", source: "unsupported", supported: false },
    { name: "fork", description: "Fork from a previous user message", source: "builtin", supported: true },
    { name: "clone", description: "Duplicate the current session", source: "builtin", supported: true },
    { name: "tree", description: "Navigate session tree", source: "builtin", supported: true },
    { name: "login", description: "Terminal-only: run pi in a terminal to authenticate", source: "unsupported", supported: false },
    { name: "logout", description: "Terminal-only: run pi in a terminal to manage auth", source: "unsupported", supported: false },
    { name: "resume", description: "Resume a different session", source: "builtin", supported: true },
    { name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", source: "builtin", supported: true },
    { name: "quit", description: "Not supported here", source: "unsupported", supported: false }
  ];
  var builtinSlashCommandNames = new Set(localSlashCommandDefinitions.map((command) => command.name));
  var supportedBuiltinSlashCommandNames = new Set(
    localSlashCommandDefinitions.filter((command) => command.supported).map((command) => command.name)
  );
  var localSlashCommands = localSlashCommandDefinitions.map(({ supported: _supported, ...command }) => command);
  var localSlashMenuCommands = localSlashCommandDefinitions.filter((command) => command.supported).map(({ supported: _supported, ...command }) => command);

  // src/webview/constants.ts
  var localSlashCommands2 = localSlashMenuCommands.map((command) => ({ ...command }));
  var messagesBottomThreshold = 4;
  var maxTextareaHeight = 180;
  var minTextareaHeight = 22;

  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  configureCodeHighlighting((message) => vscode.postMessage(message));
  watchCodeHighlightThemeChanges();
  var {
    viewElement,
    toolbarTitleElement,
    toolbarTitleTextElement,
    sessionNameInputElement,
    sessionToggleButton,
    sessionMenuWrapElement,
    sessionMenuButton,
    sessionMenuElement,
    sessionMenuItemElements,
    toastElement,
    messagesElement,
    sessionsElement,
    form,
    textarea,
    slashMenuElement,
    contextBadgesElement,
    busySubmitElement,
    diffSummaryElement,
    diffAddedElement,
    diffRemovedElement,
    streamingBehaviorButtonElements,
    newSessionButton,
    contextElement,
    contextValueElement,
    contextTooltipElement,
    modelElement,
    modelMenuElement,
    modelSelectElement,
    thinkingSelectElement,
    submitButton
  } = getWebviewDom();
  var messagesContentElement = document.createElement("div");
  messagesContentElement.className = "messages__content";
  var busyStatusElement = document.createElement("div");
  busyStatusElement.className = "status";
  busyStatusElement.hidden = true;
  var busyStatusSpinnerElement = document.createElement("span");
  busyStatusSpinnerElement.className = "status__spinner";
  busyStatusSpinnerElement.setAttribute("aria-hidden", "true");
  var busyStatusTextElement = document.createElement("span");
  busyStatusElement.append(busyStatusSpinnerElement, busyStatusTextElement);
  messagesContentElement.replaceChildren(...Array.from(messagesElement.childNodes));
  messagesElement.append(messagesContentElement, busyStatusElement);
  var isMac = navigator.platform.toUpperCase().includes("MAC");
  var state = { ...initialWebviewState };
  var appliedComposerTextRevision = 0;
  var slashMenuOpen = false;
  var slashMenuActiveIndex = 0;
  var slashMenuItems = [];
  var slashMenuQuery = "";
  var slashMenuDismissedQuery;
  var slashCommandsRefreshRequested = false;
  var streamingBehavior = "steer";
  var busySubmitHideTimeout;
  var toastHideTimeout;
  var sessionListSelectedIndex = 0;
  var treeListSelectedIndex = 0;
  var sessionPointerHoverEnabled = false;
  var openSessionListMenuIndex;
  var openSessionListMenuCommandIndex = 0;
  var sessionListNameEditPath;
  var sessionListNameEditInitialValue = "";
  var sessionNameEditing = false;
  var sessionNameEditInitialValue = "";
  var addedDiffCounter = createDiffCounter(diffAddedElement, "+");
  var removedDiffCounter = createDiffCounter(diffRemovedElement, "-");
  var renderedMessageViews = [];
  window.addEventListener("message", (event) => {
    if (handleCodeHighlightMessage(event.data)) {
      return;
    }
    if (event.data?.type === "focusInput") {
      focusPromptInput();
      return;
    }
    if (event.data?.type === "toast") {
      showToast(typeof event.data.message === "string" ? event.data.message : "Done.");
      return;
    }
    if (event.data?.type !== "state") {
      return;
    }
    const previousViewMode = state.viewMode;
    const previousCurrentSessionFile = state.currentSessionFile;
    const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
    const previousTreeCount = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    state = parseWebviewStateMessage(event.data);
    const wasListView = previousViewMode === "sessions" || previousViewMode === "tree";
    const isListView = state.viewMode === "sessions" || state.viewMode === "tree";
    if (!wasListView && isListView) {
      disableSessionPointerHover();
    }
    if (state.viewMode === "sessions" && (previousViewMode !== "sessions" || previousCurrentSessionFile !== state.currentSessionFile || previousSessionCount === 0)) {
      selectCurrentSession();
    }
    if (state.viewMode === "tree" && (previousViewMode !== "tree" || previousTreeCount === 0)) {
      selectCurrentTreeEntry();
    }
    if (sessionListNameEditPath && !state.sessions.some((session) => session.path === sessionListNameEditPath)) {
      stopSessionListNameEdit();
    }
    render();
    applyComposerTextFromState();
    if (wasListView && state.viewMode === "chat") {
      scheduleMessagesToBottom();
      focusPromptInput();
    }
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) {
      return;
    }
    closeSlashMenu();
    cancelSessionNameEdit();
    vscode.postMessage(state.busy ? { type: "submit", text, streamingBehavior } : { type: "submit", text });
    textarea.value = "";
    syncComposer({ preserveBottom: true });
    focusPromptInput();
  });
  submitButton?.addEventListener("click", (event) => {
    if (!isStopSubmitMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: "abort" });
    focusPromptInput();
  });
  for (const button of streamingBehaviorButtonElements) {
    button.addEventListener("click", () => {
      const nextBehavior = button.getAttribute("data-streaming-behavior");
      if (nextBehavior === "steer" || nextBehavior === "followUp") {
        streamingBehavior = nextBehavior;
        syncComposer({ preserveBottom: true });
        focusPromptInput();
      }
    });
  }
  newSessionButton?.addEventListener("click", startNewSession);
  diffSummaryElement?.addEventListener("click", showCurrentChanges);
  messagesElement?.addEventListener("click", handleMessageClick);
  sessionToggleButton?.addEventListener("click", toggleSessionView);
  toolbarTitleElement?.addEventListener("dblclick", startSessionNameEdit);
  sessionMenuButton?.addEventListener("click", toggleSessionCommandMenu);
  for (const item of sessionMenuItemElements) {
    item.addEventListener("click", () => runSessionMenuCommand(item.getAttribute("data-session-command")));
    item.addEventListener("pointerenter", () => setSessionMenuItemHover(item, true));
    item.addEventListener("pointerleave", () => setSessionMenuItemHover(item, false));
    item.addEventListener("focus", () => setSessionMenuItemHover(item, true));
    item.addEventListener("blur", () => setSessionMenuItemHover(item, false));
  }
  sessionNameInputElement?.addEventListener("blur", () => cancelSessionNameEdit());
  sessionsElement?.addEventListener("keydown", handleSessionListKeydown);
  sessionsElement?.addEventListener("pointermove", enableSessionPointerHover);
  sessionsElement?.addEventListener("click", (event) => {
    const target = eventTargetElement(event);
    const sessionMenuButton2 = target?.closest(".sessions__menu-button");
    if (sessionMenuButton2) {
      event.preventDefault();
      event.stopPropagation();
      const item2 = sessionMenuButton2.closest(".sessions__item");
      const index2 = Number(item2?.getAttribute("data-index"));
      toggleSessionItemMenu(index2);
      return;
    }
    const sessionMenuItem = target?.closest(".sessions__menu-item");
    if (sessionMenuItem) {
      event.preventDefault();
      event.stopPropagation();
      const item2 = sessionMenuItem.closest(".sessions__item");
      const index2 = Number(item2?.getAttribute("data-index"));
      runSessionItemMenuCommand(index2, sessionMenuItem.getAttribute("data-session-command"));
      return;
    }
    const item = target?.closest(".sessions__item");
    if (!item) {
      closeSessionItemMenus();
      return;
    }
    closeSessionItemMenus();
    const index = Number(item.getAttribute("data-index"));
    state.viewMode === "tree" ? selectTreeIndex(index) : selectSessionIndex(index);
  });
  modelElement?.addEventListener("click", toggleModelMenu);
  modelSelectElement?.addEventListener("change", selectModel);
  thinkingSelectElement?.addEventListener("change", selectThinkingLevel);
  window.addEventListener("click", (event) => {
    const target = eventTargetNode(event);
    if (modelMenuElement?.hasAttribute("open")) {
      if (!modelMenuElement.contains(target) && !modelElement?.contains(target)) {
        closeModelMenu();
      }
    }
    if (!sessionMenuWrapElement.contains(target)) {
      closeSessionCommandMenu();
    }
    if (!target || !(target instanceof Node) || !sessionsElement.contains(target) || !eventTargetElement(event)?.closest(".sessions__menu-wrap")) {
      closeSessionItemMenus();
    }
    if (slashMenuOpen) {
      if (!slashMenuElement?.contains(target) && target !== textarea) {
        closeSlashMenu();
      }
    }
  });
  window.addEventListener("keydown", (event) => {
    if (sessionNameEditing && event.target === sessionNameInputElement) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        commitSessionNameEdit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelSessionNameEdit({ focusPrompt: true });
        return;
      }
      return;
    }
    const sessionListNameInput = eventTargetElement(event)?.closest(".sessions__name-input");
    if (sessionListNameInput instanceof HTMLInputElement) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        commitSessionListNameEdit(sessionListNameInput.value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelSessionListNameEdit({ focusList: true });
        return;
      }
      event.stopPropagation();
      return;
    }
    if ((state.viewMode === "sessions" || state.viewMode === "tree") && handleSessionListKeydown(event)) {
      return;
    }
    if (event.key === "Escape" && handleChatEscape(event)) {
      return;
    }
    if (handleChatPageScroll(event)) {
      return;
    }
    if (!isNewSessionShortcut(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startNewSession();
  }, true);
  textarea?.addEventListener("keydown", (event) => {
    if (handleSlashMenuKeydown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });
  textarea?.addEventListener("input", () => {
    slashMenuDismissedQuery = void 0;
    syncComposer({ preserveBottom: true });
    syncSlashMenu();
  });
  textarea?.addEventListener("click", syncSlashMenu);
  textarea?.addEventListener("blur", closeSlashMenu);
  textarea?.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      syncSlashMenu();
    }
  });
  slashMenuElement?.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  slashMenuElement?.addEventListener("click", (event) => {
    const item = eventTargetElement(event)?.closest(".composer__slash-item");
    if (!item) {
      return;
    }
    const index = Number(item.getAttribute("data-index"));
    const command = slashMenuItems[index];
    if (command) {
      acceptSlashCommand(command);
    }
  });
  contextBadgesElement?.addEventListener("mousedown", (event) => {
    if (eventTargetElement(event)?.closest(".composer__context-remove")) {
      event.preventDefault();
    }
  });
  contextBadgesElement?.addEventListener("click", (event) => {
    const removeButton = eventTargetElement(event)?.closest(".composer__context-remove");
    if (!removeButton) {
      return;
    }
    const id = removeButton.getAttribute("data-context-id");
    if (!id) {
      return;
    }
    vscode.postMessage({ type: "removePromptContext", id });
    focusPromptInput();
  });
  function showCurrentChanges() {
    vscode.postMessage({ type: "showCurrentChanges" });
    focusPromptInput();
  }
  function showToast(message) {
    if (!toastElement) {
      return;
    }
    if (toastHideTimeout) {
      clearTimeout(toastHideTimeout);
    }
    toastElement.textContent = message;
    toastElement.hidden = false;
    toastElement.classList.add("pi-toast--visible");
    toastHideTimeout = setTimeout(() => {
      toastElement.classList.remove("pi-toast--visible");
      toastElement.hidden = true;
      toastHideTimeout = void 0;
    }, 2500);
  }
  function render() {
    const isListView = state.viewMode === "sessions" || state.viewMode === "tree";
    const shouldStickToBottom = !isListView && isMessagesAtBottom();
    if (state.viewMode !== "sessions") {
      openSessionListMenuIndex = void 0;
      openSessionListMenuCommandIndex = 0;
      stopSessionListNameEdit();
    }
    viewElement.classList.toggle("pi-view--list", isListView);
    viewElement.classList.toggle("pi-view--chat", !isListView);
    messagesElement.hidden = false;
    sessionsElement.hidden = false;
    messagesElement.setAttribute("aria-hidden", isListView ? "true" : "false");
    sessionsElement.setAttribute("aria-hidden", isListView ? "false" : "true");
    messagesElement.inert = isListView;
    sessionsElement.inert = !isListView;
    sessionsElement.tabIndex = isListView ? 0 : -1;
    form.classList.toggle("composer--list-hidden", isListView);
    form.setAttribute("aria-hidden", isListView ? "true" : "false");
    form.inert = isListView;
    const toolbarTitle = state.viewMode === "sessions" ? "Sessions" : state.viewMode === "tree" ? "Session tree" : getCurrentSessionTitle();
    if ((isListView || state.busy) && sessionNameEditing) {
      cancelSessionNameEdit();
    }
    toolbarTitleTextElement.textContent = toolbarTitle;
    toolbarTitleElement.title = toolbarTitle;
    toolbarTitleElement.classList.toggle("pi-toolbar__title--editing", sessionNameEditing);
    toolbarTitleTextElement.hidden = sessionNameEditing;
    sessionNameInputElement.hidden = !sessionNameEditing;
    sessionMenuWrapElement.hidden = isListView;
    sessionMenuButton.disabled = state.busy || sessionNameEditing;
    syncSessionCommandMenuItems();
    if (isListView || state.busy || sessionNameEditing) {
      closeSessionCommandMenu();
    }
    sessionToggleButton.title = isListView ? "Back to chat" : "Show sessions";
    sessionToggleButton.setAttribute("aria-label", sessionToggleButton.title);
    sessionToggleButton.classList.toggle("pi-toolbar__sessions--back", isListView);
    if (isListView) {
      busyStatusElement.hidden = true;
      state.viewMode === "tree" ? renderTree() : renderSessions();
      closeSlashMenu();
      closeModelMenu();
      closeSessionCommandMenu();
      cancelSessionNameEdit();
      if (!sessionListNameEditPath) {
        requestAnimationFrame(() => sessionsElement?.focus({ preventScroll: true }));
      }
      return;
    }
    renderMessageList();
    syncBusyStatus();
    syncModelLabel();
    syncPromptContextBadges();
    syncComposer();
    syncSlashMenu();
    if (shouldStickToBottom) {
      scrollMessagesToBottom();
    }
  }
  function renderMessageList() {
    if (state.messages.length === 0) {
      renderedMessageViews = [];
      messagesContentElement.replaceChildren(createEmptyStateElement());
      return;
    }
    if (messagesContentElement.querySelector(".empty-state")) {
      messagesContentElement.replaceChildren();
    }
    let previousMessageRole;
    for (const [index, message] of state.messages.entries()) {
      const showRole = message.role !== previousMessageRole;
      const view = renderMessageAtIndex(index, message, showRole);
      const currentNode = messagesContentElement.children[index];
      if (currentNode !== view.element) {
        messagesContentElement.insertBefore(view.element, currentNode ?? null);
      }
      previousMessageRole = message.role;
    }
    for (let index = renderedMessageViews.length - 1; index >= state.messages.length; index -= 1) {
      renderedMessageViews[index]?.element.remove();
    }
    renderedMessageViews.length = state.messages.length;
    requestCodeHighlightsIn(messagesContentElement);
  }
  function createEmptyStateElement() {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    if (!state.sessionLoading) {
      empty.textContent = "Ask Pi about this workspace.";
      return empty;
    }
    empty.classList.add("empty-state--loading");
    const spinner = document.createElement("span");
    spinner.className = "status__spinner";
    spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = "Loading session\u2026";
    empty.append(spinner, text);
    return empty;
  }
  function renderMessageAtIndex(index, message, showRole) {
    const existingView = renderedMessageViews[index];
    const activitiesSignature = getActivitiesSignature(message);
    const copyable = canCopyAssistantMessage2(message);
    const animateFromText = getStreamingAnimationStartText(existingView, message, index);
    if (existingView && canReuseMessageElement(existingView, message, showRole, activitiesSignature, copyable)) {
      if ((existingView.message.text || "") !== (message.text || "")) {
        updateMessageBodyElement(
          existingView.element,
          message,
          {
            ...animateFromText === void 0 ? {} : { animateFromText },
            outputColors: state.outputColors
          }
        );
      }
      existingView.message = message;
      existingView.showRole = showRole;
      existingView.activitiesSignature = activitiesSignature;
      existingView.copyable = copyable;
      return existingView;
    }
    const nextView = {
      element: createMessageElement(
        message,
        showRole,
        index,
        {
          ...animateFromText === void 0 ? {} : { animateFromText },
          outputColors: state.outputColors
        }
      ),
      message,
      showRole,
      activitiesSignature,
      copyable
    };
    existingView?.element.replaceWith(nextView.element);
    renderedMessageViews[index] = nextView;
    return nextView;
  }
  function canReuseMessageElement(view, message, showRole, activitiesSignature, copyable) {
    return view.message.role === message.role && Boolean(view.message.error) === Boolean(message.error) && (view.message.variant || "") === (message.variant || "") && view.showRole === showRole && view.activitiesSignature === activitiesSignature && view.copyable === copyable;
  }
  function getStreamingAnimationStartText(existingView, message, index) {
    if (!existingView || !shouldAnimateStreamingAppend(existingView.message, message, index)) {
      return void 0;
    }
    return getMessageBodyVisibleText(existingView.element);
  }
  function shouldAnimateStreamingAppend(previous, next, index) {
    const previousText = previous.text || "";
    const nextText = next.text || "";
    return state.busy && index === state.messages.length - 1 && previous.role === "assistant" && next.role === "assistant" && !previous.error && !next.error && previous.variant !== "thinking" && next.variant !== "thinking" && nextText.length > previousText.length && nextText.startsWith(previousText);
  }
  function getMessageBodyVisibleText(article) {
    for (const child of Array.from(article.children)) {
      if (child instanceof HTMLElement && child.classList.contains("message__body")) {
        return child.textContent ?? "";
      }
    }
    return "";
  }
  function canCopyAssistantMessage2(message) {
    return message.role === "assistant" && !message.error && message.variant !== "thinking" && Boolean(message.text);
  }
  function getActivitiesSignature(message) {
    if (!Array.isArray(message.activities) || message.activities.length === 0) {
      return "";
    }
    return JSON.stringify({ outputColors: state.outputColors, activities: message.activities });
  }
  function renderSessions() {
    sessionsElement.replaceChildren();
    sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex);
    const header = document.createElement("div");
    header.className = "sessions__header";
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    if (openSessionListMenuIndex !== void 0 && openSessionListMenuIndex >= count) {
      openSessionListMenuIndex = void 0;
    }
    header.textContent = state.sessionsRefreshing ? "Loading sessions..." : count === 1 ? "1 session" : count + " sessions";
    sessionsElement.append(header);
    if (state.sessionsError) {
      const error = document.createElement("div");
      error.className = "sessions__error";
      error.textContent = state.sessionsError;
      sessionsElement.append(error);
    }
    if (state.sessionsRefreshing && count === 0) {
      sessionsElement.append(createSessionEmptyElement("Loading sessions..."));
      return;
    }
    if (count === 0) {
      sessionsElement.append(createSessionEmptyElement("No sessions found for this workspace."));
      return;
    }
    for (let index = 0; index < state.sessions.length; index += 1) {
      sessionsElement.append(createSessionItemElement(state.sessions[index], index));
    }
    if (sessionListNameEditPath) {
      requestAnimationFrame(focusSessionListNameInput);
    }
  }
  function createSessionEmptyElement(text) {
    const empty = document.createElement("div");
    empty.className = "sessions__empty";
    empty.textContent = text;
    return empty;
  }
  function createSessionItemElement(session, index) {
    const item = document.createElement("div");
    item.id = "session-" + index;
    item.className = "sessions__item" + (index === sessionListSelectedIndex ? " sessions__item--active" : "") + (session.current ? " sessions__item--current" : "") + (session.liveStatus ? " sessions__item--" + session.liveStatus : "") + (session.unread ? " sessions__item--unread" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === sessionListSelectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    const prefix = document.createElement("span");
    prefix.className = "sessions__prefix";
    prefix.textContent = (session.liveStatus === "running" ? "\u25CF " : "") + buildSessionTreePrefix(session);
    item.append(prefix);
    const title = document.createElement("span");
    title.className = "sessions__title";
    if (sessionListNameEditPath === session.path) {
      title.append(createSessionListNameInput(session));
    } else {
      const titleText = document.createElement("span");
      titleText.className = "sessions__title-text";
      titleText.textContent = getSessionDisplayName(session);
      title.append(titleText);
    }
    item.append(title);
    const meta = document.createElement("span");
    meta.className = "sessions__meta";
    meta.textContent = formatSessionMeta(session);
    item.append(meta);
    if (session.cwd) {
      const cwd = document.createElement("span");
      cwd.className = "sessions__cwd";
      cwd.textContent = shortenPath(session.cwd);
      item.append(cwd);
    }
    item.append(createSessionItemMenuElement(session, index));
    return item;
  }
  function createSessionListNameInput(session) {
    const input = document.createElement("input");
    input.className = "sessions__name-input";
    input.type = "text";
    input.value = sessionListNameEditInitialValue;
    input.placeholder = getSessionDisplayName(session);
    input.setAttribute("aria-label", "Session name");
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("blur", () => cancelSessionListNameEdit());
    return input;
  }
  function createSessionItemMenuElement(session, index) {
    const wrap = document.createElement("span");
    wrap.className = "sessions__menu-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sessions__menu-button";
    button.title = "Session commands";
    button.setAttribute("aria-label", "Session commands");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", openSessionListMenuIndex === index ? "true" : "false");
    button.disabled = !canRunSessionItemCommand(session);
    button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg>';
    wrap.append(button);
    const menu = document.createElement("span");
    menu.className = "sessions__menu";
    menu.setAttribute("role", "menu");
    menu.hidden = openSessionListMenuIndex !== index;
    for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
      const command = sessionItemMenuCommands[commandIndex];
      if (command === "showChanges") {
        const separator = document.createElement("span");
        separator.className = "pi-toolbar__menu-separator";
        separator.setAttribute("role", "separator");
        menu.append(separator);
      }
      menu.append(createSessionItemMenuButton(command, session, commandIndex));
    }
    wrap.append(menu);
    return wrap;
  }
  function createSessionItemMenuButton(command, session, commandIndex) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pi-toolbar__menu-item sessions__menu-item";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-session-command", command);
    button.setAttribute("data-session-command-index", String(commandIndex));
    button.disabled = !canRunSessionItemCommand(session, command);
    button.innerHTML = '<span class="pi-toolbar__menu-label">' + getSessionItemCommandLabel(command) + "</span>" + getSessionItemCommandIcon(command);
    button.addEventListener("pointerenter", () => {
      openSessionListMenuCommandIndex = commandIndex;
      setSessionMenuItemHover(button, true);
    });
    button.addEventListener("pointerleave", () => setSessionMenuItemHover(button, false));
    button.addEventListener("focus", () => {
      openSessionListMenuCommandIndex = commandIndex;
      setSessionMenuItemHover(button, true);
    });
    button.addEventListener("blur", () => setSessionMenuItemHover(button, false));
    return button;
  }
  function renderTree() {
    sessionsElement.replaceChildren();
    treeListSelectedIndex = clampTreeIndex(treeListSelectedIndex);
    const header = document.createElement("div");
    header.className = "sessions__header";
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    header.textContent = state.treeRefreshing ? "Loading session tree..." : count === 1 ? "1 tree entry" : count + " tree entries";
    sessionsElement.append(header);
    if (state.treeError) {
      const error = document.createElement("div");
      error.className = "sessions__error";
      error.textContent = state.treeError;
      sessionsElement.append(error);
    }
    if (state.treeRefreshing && count === 0) {
      sessionsElement.append(createSessionEmptyElement("Loading session tree..."));
      return;
    }
    if (count === 0) {
      sessionsElement.append(createSessionEmptyElement("No persisted tree entries found for this session."));
      return;
    }
    for (let index = 0; index < state.treeItems.length; index += 1) {
      sessionsElement.append(createTreeItemElement(state.treeItems[index], index));
    }
  }
  function createTreeItemElement(treeItem, index) {
    const item = document.createElement("button");
    item.type = "button";
    item.id = "tree-" + index;
    item.className = "sessions__item" + (index === treeListSelectedIndex ? " sessions__item--active" : "") + (treeItem.current ? " sessions__item--current" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === treeListSelectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    item.disabled = state.busy || state.treeRefreshing;
    const title = document.createElement("span");
    title.className = "sessions__title";
    title.textContent = treeItem.role + ": " + (treeItem.text || "(empty)");
    item.append(title);
    return item;
  }
  function getCurrentSessionTitle() {
    const session = getCurrentSession();
    if (session) {
      return getSessionDisplayName(session);
    }
    if (state.currentSessionName) {
      return state.currentSessionName;
    }
    if (state.currentSessionFile) {
      return "Current session";
    }
    return state.messages.length === 0 ? "New session" : "Current session";
  }
  function getCurrentSession() {
    if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
      return void 0;
    }
    return (state.currentSessionFile ? state.sessions.find((session) => session.path === state.currentSessionFile) : void 0) ?? state.sessions.find((session) => session.current);
  }
  function handleChatEscape(event) {
    const hadSlashMenu = slashMenuOpen;
    const hadModelMenu = modelMenuElement?.hasAttribute("open") ?? false;
    const hadSessionCommandMenu = !sessionMenuElement.hidden;
    const wasSessionNameEditing = sessionNameEditing;
    if (hadSlashMenu) {
      dismissSlashMenu();
    }
    if (hadModelMenu) {
      closeModelMenu();
    }
    if (hadSessionCommandMenu) {
      closeSessionCommandMenu();
    }
    if (wasSessionNameEditing) {
      cancelSessionNameEdit();
    }
    if (hadSlashMenu || hadModelMenu || hadSessionCommandMenu || wasSessionNameEditing) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (state.viewMode === "chat") {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "showSessions" });
      return true;
    }
    return false;
  }
  function handleSessionListKeydown(event) {
    if (state.viewMode !== "sessions" && state.viewMode !== "tree") {
      return false;
    }
    if (openSessionListMenuIndex !== void 0 && handleSessionItemMenuKeydown(event)) {
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "hideSessions" });
      focusPromptInput();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      closeSessionItemMenus();
      state.viewMode === "tree" ? moveTreeSelection(1) : moveSessionSelection(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      closeSessionItemMenus();
      state.viewMode === "tree" ? moveTreeSelection(-1) : moveSessionSelection(-1);
      return true;
    }
    if (state.viewMode === "sessions" && event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      openSessionItemMenu(sessionListSelectedIndex, { focusMenu: true });
      return true;
    }
    if (state.viewMode === "sessions" && handleSessionListCommandKey(event)) {
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      state.viewMode === "tree" ? selectTreeIndex(treeListSelectedIndex) : selectSessionIndex(sessionListSelectedIndex);
      return true;
    }
    if (state.viewMode === "sessions" && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopPropagation();
      deleteSessionIndex(sessionListSelectedIndex);
      return true;
    }
    return false;
  }
  function enableSessionPointerHover() {
    if (sessionPointerHoverEnabled) {
      return;
    }
    sessionPointerHoverEnabled = true;
    sessionsElement.classList.add("sessions--pointer-hover");
  }
  function disableSessionPointerHover() {
    sessionPointerHoverEnabled = false;
    sessionsElement.classList.remove("sessions--pointer-hover");
  }
  function moveSessionSelection(delta) {
    if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
      return;
    }
    sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex + delta);
    renderSessions();
    document.getElementById("session-" + sessionListSelectedIndex)?.scrollIntoView({ block: "nearest" });
  }
  function selectSessionIndex(index) {
    const session = Array.isArray(state.sessions) ? state.sessions[index] : void 0;
    if (!session?.path) {
      return;
    }
    selectSessionByPath(session.path);
  }
  function selectSessionByPath(sessionPath) {
    if (!sessionPath) {
      return;
    }
    vscode.postMessage({ type: "selectSession", sessionPath });
  }
  function deleteSessionIndex(index) {
    const session = Array.isArray(state.sessions) ? state.sessions[index] : void 0;
    if (!session?.path || !canDeleteSession(session)) {
      return;
    }
    vscode.postMessage({ type: "deleteSession", sessionPath: session.path });
  }
  function toggleSessionItemMenu(index) {
    if (openSessionListMenuIndex === index) {
      closeSessionItemMenus();
      return;
    }
    openSessionItemMenu(index, { focusMenu: true });
  }
  function openSessionItemMenu(index, options = {}) {
    if (!Number.isInteger(index) || index < 0 || state.viewMode !== "sessions") {
      return;
    }
    const session = Array.isArray(state.sessions) ? state.sessions[index] : void 0;
    if (!session || !canRunSessionItemCommand(session)) {
      return;
    }
    sessionListSelectedIndex = clampSessionIndex(index);
    openSessionListMenuIndex = sessionListSelectedIndex;
    openSessionListMenuCommandIndex = getFirstEnabledSessionItemMenuCommandIndex(session);
    renderSessions();
    document.getElementById("session-" + sessionListSelectedIndex)?.scrollIntoView({ block: "nearest" });
    if (options.focusMenu) {
      requestAnimationFrame(() => focusSessionItemMenuCommand(openSessionListMenuIndex, openSessionListMenuCommandIndex));
    }
  }
  function closeSessionItemMenus() {
    if (openSessionListMenuIndex === void 0) {
      return;
    }
    openSessionListMenuIndex = void 0;
    openSessionListMenuCommandIndex = 0;
    for (const menu of sessionsElement.querySelectorAll(".sessions__menu")) {
      menu.hidden = true;
    }
    for (const button of sessionsElement.querySelectorAll(".sessions__menu-button")) {
      button.setAttribute("aria-expanded", "false");
    }
  }
  function handleSessionItemMenuKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSessionItemMenus();
      sessionsElement.focus({ preventScroll: true });
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveSessionItemMenuSelection(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSessionItemMenuSelection(-1);
      return true;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const focusedCommand = eventTargetElement(event)?.closest(".sessions__menu-item")?.getAttribute("data-session-command");
      runOpenSessionItemMenuCommand(focusedCommand ?? sessionItemMenuCommands[openSessionListMenuCommandIndex]);
      return true;
    }
    return false;
  }
  function moveSessionItemMenuSelection(delta) {
    if (openSessionListMenuIndex === void 0) {
      return;
    }
    const session = Array.isArray(state.sessions) ? state.sessions[openSessionListMenuIndex] : void 0;
    const enabledIndexes = getEnabledSessionItemMenuCommandIndexes(session);
    if (enabledIndexes.length === 0) {
      return;
    }
    const currentPosition = enabledIndexes.indexOf(openSessionListMenuCommandIndex);
    const nextPosition = currentPosition >= 0 ? (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length : delta > 0 ? 0 : enabledIndexes.length - 1;
    openSessionListMenuCommandIndex = enabledIndexes[nextPosition];
    focusSessionItemMenuCommand(openSessionListMenuIndex, openSessionListMenuCommandIndex);
  }
  function focusSessionItemMenuCommand(sessionIndex, commandIndex) {
    if (sessionIndex === void 0) {
      return;
    }
    const item = document.getElementById("session-" + sessionIndex);
    const commandButton = item?.querySelector('.sessions__menu-item[data-session-command-index="' + commandIndex + '"]:not(:disabled)') ?? item?.querySelector(".sessions__menu-item:not(:disabled)");
    commandButton?.focus({ preventScroll: true });
  }
  function runOpenSessionItemMenuCommand(command) {
    if (openSessionListMenuIndex === void 0) {
      return;
    }
    runSessionItemMenuCommand(openSessionListMenuIndex, typeof command === "string" ? command : null);
  }
  function getFirstEnabledSessionItemMenuCommandIndex(session) {
    return getEnabledSessionItemMenuCommandIndexes(session)[0] ?? 0;
  }
  function getEnabledSessionItemMenuCommandIndexes(session) {
    if (!session) {
      return [];
    }
    const indexes = [];
    for (let index = 0; index < sessionItemMenuCommands.length; index += 1) {
      if (canRunSessionItemCommand(session, sessionItemMenuCommands[index])) {
        indexes.push(index);
      }
    }
    return indexes;
  }
  function runSessionItemMenuCommand(index, command) {
    const parsedCommand = parseSessionItemCommand(command);
    const session = Array.isArray(state.sessions) ? state.sessions[index] : void 0;
    if (!parsedCommand || !session?.path || !canRunSessionItemCommand(session, parsedCommand)) {
      return;
    }
    closeSessionItemMenus();
    if (parsedCommand === "delete") {
      vscode.postMessage({ type: "deleteSession", sessionPath: session.path });
      return;
    }
    if (parsedCommand === "rename") {
      startSessionListNameEdit(index);
      return;
    }
    vscode.postMessage({ type: "sessionItemCommand", sessionPath: session.path, command: parsedCommand });
  }
  function startSessionListNameEdit(index) {
    const session = Array.isArray(state.sessions) ? state.sessions[index] : void 0;
    if (!session?.path || !canRunSessionItemCommand(session, "rename")) {
      return;
    }
    sessionListSelectedIndex = clampSessionIndex(index);
    sessionListNameEditPath = session.path;
    sessionListNameEditInitialValue = session.name?.trim() ?? "";
    closeSessionItemMenus();
    renderSessions();
  }
  function commitSessionListNameEdit(name) {
    const sessionPath = sessionListNameEditPath;
    if (!sessionPath) {
      return;
    }
    const nextName = name.trim();
    const previousName = sessionListNameEditInitialValue.trim();
    stopSessionListNameEdit();
    renderSessions();
    if (nextName === previousName) {
      return;
    }
    vscode.postMessage({ type: "setSessionItemName", sessionPath, name: nextName });
  }
  function cancelSessionListNameEdit(options = {}) {
    if (!sessionListNameEditPath) {
      return;
    }
    stopSessionListNameEdit();
    renderSessions();
    if (options.focusList) {
      requestAnimationFrame(() => sessionsElement.focus({ preventScroll: true }));
    }
  }
  function stopSessionListNameEdit() {
    sessionListNameEditPath = void 0;
    sessionListNameEditInitialValue = "";
  }
  function focusSessionListNameInput() {
    const input = sessionsElement.querySelector(".sessions__name-input");
    input?.focus({ preventScroll: true });
    input?.select();
  }
  function handleSessionListCommandKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const command = getSessionListCommandForKey(event.key);
    if (!command) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    runSessionItemMenuCommand(sessionListSelectedIndex, command);
    return true;
  }
  function getSessionListCommandForKey(key) {
    switch (key.toLowerCase()) {
      case "r":
        return "rename";
      case "f":
        return "fork";
      case "c":
        return "clone";
      case "z":
        return "compact";
      case "e":
        return "export";
      default:
        return void 0;
    }
  }
  function canRunSessionItemCommand(session, command) {
    if (command === "delete") {
      return canDeleteSession(session);
    }
    return session.liveStatus !== "running" && !(session.current && state.busy);
  }
  function canDeleteSession(session) {
    return session.liveStatus !== "running" && !(session.current && state.busy);
  }
  function clampSessionIndex(index) {
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    if (count === 0) {
      return 0;
    }
    return Math.max(0, Math.min(index, count - 1));
  }
  function moveTreeSelection(delta) {
    if (!Array.isArray(state.treeItems) || state.treeItems.length === 0) {
      return;
    }
    treeListSelectedIndex = clampTreeIndex(treeListSelectedIndex + delta);
    renderTree();
    document.getElementById("tree-" + treeListSelectedIndex)?.scrollIntoView({ block: "nearest" });
  }
  function selectTreeIndex(index) {
    const treeItem = Array.isArray(state.treeItems) ? state.treeItems[index] : void 0;
    if (!treeItem?.entryId || state.busy || state.treeRefreshing) {
      return;
    }
    vscode.postMessage({ type: "selectTreeEntry", entryId: treeItem.entryId });
  }
  function handleChatPageScroll(event) {
    if (state.viewMode !== "chat" || event.key !== "PageUp" && event.key !== "PageDown") {
      return false;
    }
    if (event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }
    const target = eventTargetElement(event);
    if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "PageUp" ? -1 : 1;
    const amount = event.ctrlKey ? getTranscriptLineScrollAmount() : Math.max(80, Math.floor(messagesElement.clientHeight * 0.85));
    messagesElement.scrollBy({ top: direction * amount, behavior: "auto" });
    return true;
  }
  function getTranscriptLineScrollAmount() {
    return parseCssPixelValue(getComputedStyle(messagesContentElement).lineHeight) || parseCssPixelValue(getComputedStyle(messagesElement).lineHeight) || 20;
  }
  function clampTreeIndex(index) {
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    if (count === 0) {
      return 0;
    }
    return Math.max(0, Math.min(index, count - 1));
  }
  function selectCurrentTreeEntry() {
    const currentIndex = Array.isArray(state.treeItems) ? state.treeItems.findIndex((item) => item.current) : -1;
    treeListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
  }
  function selectCurrentSession() {
    const currentIndex = Array.isArray(state.sessions) ? state.sessions.findIndex((session) => session.current || session.path === state.currentSessionFile) : -1;
    sessionListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
  }
  function startSessionNameEdit(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (state.viewMode === "sessions" || state.viewMode === "tree" || state.busy) {
      return;
    }
    closeSlashMenu();
    closeModelMenu();
    closeSessionCommandMenu();
    const initialName = getCurrentSessionName();
    sessionNameEditing = true;
    sessionNameEditInitialValue = initialName;
    sessionNameInputElement.value = initialName;
    sessionNameInputElement.placeholder = initialName ? "" : getCurrentSessionTitle();
    syncSessionNameEditor();
    requestAnimationFrame(() => {
      sessionNameInputElement.focus({ preventScroll: true });
      sessionNameInputElement.select();
    });
  }
  function commitSessionNameEdit() {
    if (!sessionNameEditing) {
      return;
    }
    const nextName = sessionNameInputElement.value.trim();
    const previousName = sessionNameEditInitialValue;
    stopSessionNameEdit();
    if (nextName !== previousName) {
      vscode.postMessage({ type: "setSessionName", name: nextName });
    }
    focusPromptInput();
  }
  function cancelSessionNameEdit(options = {}) {
    if (!sessionNameEditing) {
      return;
    }
    stopSessionNameEdit();
    if (options.focusPrompt) {
      focusPromptInput();
    }
  }
  function stopSessionNameEdit() {
    sessionNameEditing = false;
    sessionNameEditInitialValue = "";
    sessionNameInputElement.value = "";
    sessionNameInputElement.placeholder = "";
    syncSessionNameEditor();
  }
  function syncSessionNameEditor() {
    toolbarTitleElement.classList.toggle("pi-toolbar__title--editing", sessionNameEditing);
    toolbarTitleTextElement.hidden = sessionNameEditing;
    sessionNameInputElement.hidden = !sessionNameEditing;
    sessionMenuButton.disabled = state.busy || sessionNameEditing;
  }
  function toggleSessionCommandMenu(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (state.viewMode === "sessions" || state.viewMode === "tree" || state.busy || sessionNameEditing) {
      return;
    }
    closeSlashMenu();
    closeModelMenu();
    const isOpen = !sessionMenuElement.hidden;
    sessionMenuElement.hidden = isOpen;
    sessionMenuButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
  }
  function closeSessionCommandMenu() {
    sessionMenuElement.hidden = true;
    sessionMenuButton.setAttribute("aria-expanded", "false");
    for (const item of sessionMenuItemElements) {
      setSessionMenuItemHover(item, false);
    }
  }
  function syncSessionCommandMenuItems() {
    for (const item of sessionMenuItemElements) {
      const command = item.getAttribute("data-session-command");
      item.disabled = state.busy || sessionNameEditing || (command === "delete" || command === "showChanges") && !getCurrentSessionPath();
    }
  }
  function setSessionMenuItemHover(item, hovered) {
    item.classList.toggle("pi-toolbar__menu-item--hover", hovered);
  }
  function runSessionMenuCommand(command) {
    if (command === "rename") {
      closeSessionCommandMenu();
      startSessionNameEdit();
      return;
    }
    if (command === "showChanges") {
      const sessionPath = getCurrentSessionPath();
      if (!sessionPath) {
        return;
      }
      closeSessionCommandMenu();
      vscode.postMessage({ type: "sessionItemCommand", sessionPath, command });
      focusPromptInput();
      return;
    }
    if (command === "fork" || command === "clone") {
      closeSessionCommandMenu();
      runSessionSlashCommand(command);
      return;
    }
    if (command === "delete") {
      closeSessionCommandMenu();
      deleteCurrentSession();
      return;
    }
    if (command !== "reload" && command !== "compact" && command !== "export") {
      return;
    }
    closeSessionCommandMenu();
    vscode.postMessage({ type: "submit", text: "/" + command });
    focusPromptInput();
  }
  function getCurrentSessionName() {
    return (getCurrentSession()?.name ?? state.currentSessionName ?? "").trim();
  }
  function getCurrentSessionPath() {
    return (getCurrentSession()?.path ?? state.currentSessionFile ?? "").trim();
  }
  function deleteCurrentSession() {
    const sessionPath = getCurrentSessionPath();
    if (!sessionPath) {
      return;
    }
    vscode.postMessage({ type: "deleteSession", sessionPath });
    focusPromptInput();
  }
  function toggleSessionView() {
    cancelSessionNameEdit();
    if (state.viewMode === "sessions" || state.viewMode === "tree") {
      vscode.postMessage({ type: "hideSessions" });
      focusPromptInput();
      return;
    }
    vscode.postMessage({ type: "showSessions" });
  }
  function syncSubmit() {
    const isStopMode = isStopSubmitMode();
    const hasInput = textarea.value.length > 0;
    const hasSendableText = textarea.value.trim().length > 0;
    const label = getSubmitLabel(isStopMode);
    submitButton.disabled = state.busy ? hasInput && !hasSendableText : !hasSendableText;
    newSessionButton.disabled = false;
    submitButton.classList.toggle("composer__submit--stop", isStopMode);
    submitButton.setAttribute("aria-label", label);
    submitButton.title = label;
  }
  function getSubmitLabel(isStopMode) {
    if (isStopMode) {
      return "Stop current response";
    }
    if (state.busy) {
      return streamingBehavior === "followUp" ? "Queue follow-up" : "Steer current run";
    }
    return "Send message";
  }
  function isStopSubmitMode() {
    return state.busy && textarea.value.length === 0;
  }
  function syncBusySubmitMode() {
    if (!busySubmitElement) {
      return;
    }
    const showDiffSummary = state.busy || hasWorkspaceDiffChanges();
    setBusySubmitVisible(showDiffSummary);
    syncDiffSummary();
    const streamingModesElement = streamingBehaviorButtonElements[0]?.parentElement;
    if (streamingModesElement) {
      streamingModesElement.hidden = !state.busy;
    }
    if (!state.busy) {
      return;
    }
    for (const button of streamingBehaviorButtonElements) {
      const isActive = button.getAttribute("data-streaming-behavior") === streamingBehavior;
      button.classList.toggle("composer__mode-button--active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }
  function syncDiffSummary() {
    const addedLines = normalizeDiffLineCount2(state.workspaceDiffStats.addedLines);
    const removedLines = normalizeDiffLineCount2(state.workspaceDiffStats.removedLines);
    updateDiffCounter(addedDiffCounter, addedLines);
    updateDiffCounter(removedDiffCounter, removedLines);
    diffSummaryElement.title = `Show session changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
  }
  function createDiffCounter(element, prefix) {
    const value = parseDiffCounterValue(element.textContent, prefix);
    const counter = {
      element,
      prefix,
      value,
      target: value,
      startValue: value,
      startTime: 0,
      duration: 0,
      lastText: "",
      animationFrame: void 0
    };
    renderDiffCounter(counter, value);
    return counter;
  }
  function updateDiffCounter(counter, targetValue) {
    const target = normalizeDiffLineCount2(targetValue);
    if (target === counter.target) {
      return;
    }
    const now = performance.now();
    const currentValue = counter.animationFrame === void 0 ? counter.value : getInterpolatedDiffCounterValue(counter, now);
    renderDiffCounter(counter, currentValue);
    counter.target = target;
    counter.startValue = currentValue;
    counter.startTime = now;
    counter.duration = getDiffCounterDuration(Math.abs(target - currentValue));
    if (counter.animationFrame === void 0) {
      counter.animationFrame = requestAnimationFrame((time) => tickDiffCounter(counter, time));
    }
  }
  function tickDiffCounter(counter, time) {
    const nextValue = getInterpolatedDiffCounterValue(counter, time);
    renderDiffCounter(counter, nextValue);
    if (nextValue === counter.target) {
      counter.animationFrame = void 0;
      return;
    }
    counter.animationFrame = requestAnimationFrame((nextTime) => tickDiffCounter(counter, nextTime));
  }
  function getInterpolatedDiffCounterValue(counter, time) {
    if (counter.duration <= 0) {
      return counter.target;
    }
    const progress = Math.min(1, Math.max(0, (time - counter.startTime) / counter.duration));
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = counter.startValue + (counter.target - counter.startValue) * eased;
    if (progress >= 1) {
      return counter.target;
    }
    return Math.round(value);
  }
  function renderDiffCounter(counter, value) {
    const normalizedValue = normalizeDiffLineCount2(value);
    const nextText = formatDiffLineCount(normalizedValue);
    if (counter.lastText === nextText && counter.value === normalizedValue) {
      return;
    }
    const previousText = counter.lastText;
    const fragment = document.createDocumentFragment();
    const sign = document.createElement("span");
    sign.className = "composer__diff-sign";
    sign.textContent = counter.prefix;
    fragment.append(sign);
    for (let index = 0; index < nextText.length; index += 1) {
      const char = nextText[index];
      const previousIndex = previousText.length - nextText.length + index;
      const previousChar = previousIndex >= 0 ? previousText[previousIndex] : void 0;
      const span = document.createElement("span");
      const isDigit = /\d/.test(char);
      span.className = isDigit ? "composer__diff-digit" : "composer__diff-separator";
      span.textContent = char;
      if (isDigit && previousChar !== void 0 && previousChar !== char) {
        span.classList.add("composer__diff-digit--rolling");
      }
      fragment.append(span);
    }
    counter.element.replaceChildren(fragment);
    counter.element.setAttribute("aria-label", `${counter.prefix}${nextText}`);
    counter.value = normalizedValue;
    counter.lastText = nextText;
  }
  function getDiffCounterDuration(delta) {
    if (delta <= 0) {
      return 0;
    }
    return Math.min(2400, Math.max(600, 450 + Math.log10(delta + 1) * 650));
  }
  function parseDiffCounterValue(text, prefix) {
    const normalized = (text ?? "").trim().replace(prefix, "").replace(/,/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  function normalizeDiffLineCount2(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  function hasWorkspaceDiffChanges() {
    return state.workspaceDiffStats.addedLines > 0 || state.workspaceDiffStats.removedLines > 0;
  }
  function formatDiffLineCount(value) {
    return Math.max(0, Math.floor(value)).toLocaleString();
  }
  function setBusySubmitVisible(visible) {
    if (!busySubmitElement) {
      return;
    }
    if (busySubmitHideTimeout) {
      clearTimeout(busySubmitHideTimeout);
      busySubmitHideTimeout = void 0;
    }
    if (visible) {
      busySubmitElement.hidden = false;
      requestAnimationFrame(() => {
        busySubmitElement.classList.add("composer__busy-submit--visible");
      });
      return;
    }
    busySubmitElement.classList.remove("composer__busy-submit--visible");
    busySubmitHideTimeout = setTimeout(() => {
      if (!state.busy) {
        busySubmitElement.hidden = true;
      }
    }, 160);
  }
  function syncBusyStatus() {
    busyStatusElement.hidden = !state.busy;
    if (!state.busy) {
      return;
    }
    const nextText = getBusyStatusText();
    if (busyStatusTextElement.textContent !== nextText) {
      busyStatusTextElement.textContent = nextText;
    }
  }
  function getBusyStatusText() {
    const activity = getLatestRunningActivity();
    if (!activity) {
      return "Pi is working...";
    }
    const title = typeof activity.title === "string" && activity.title ? activity.title : "Pi is working";
    const summary = typeof activity.summary === "string" && activity.summary ? ": " + activity.summary : "";
    return title + summary;
  }
  function getLatestRunningActivity() {
    for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = state.messages[messageIndex];
      const activities = Array.isArray(message.activities) ? message.activities : [];
      for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
        if (activities[activityIndex]?.status === "running") {
          return activities[activityIndex];
        }
      }
    }
    return void 0;
  }
  function syncPromptContextBadges() {
    if (!contextBadgesElement) {
      return;
    }
    const attachments = Array.isArray(state.promptContext) ? state.promptContext.filter(isPromptContextAttachment) : [];
    form?.classList.toggle("composer--has-context", attachments.length > 0);
    contextBadgesElement.hidden = attachments.length === 0;
    contextBadgesElement.replaceChildren();
    for (const attachment of attachments) {
      const badge = document.createElement("span");
      badge.className = "composer__context-badge";
      badge.title = attachment.title || attachment.label;
      const label = document.createElement("span");
      label.className = "composer__context-label";
      label.textContent = attachment.label;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "composer__context-remove";
      remove.setAttribute("data-context-id", attachment.id);
      remove.setAttribute("aria-label", "Remove context " + attachment.label);
      remove.title = "Remove context";
      remove.textContent = "\xD7";
      badge.append(label, remove);
      contextBadgesElement.append(badge);
    }
  }
  function isPromptContextAttachment(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const attachment = value;
    return typeof attachment.id === "string" && typeof attachment.label === "string" && typeof attachment.title === "string";
  }
  function syncModelLabel() {
    contextValueElement.textContent = state.contextUsageLabel;
    contextTooltipElement.textContent = state.contextUsageTitle;
    contextElement.title = state.contextUsageTitle;
    contextElement.className = "composer__context" + (state.contextUsageLevel ? " composer__context--" + state.contextUsageLevel : "");
    contextElement.hidden = state.contextUsageLabel.length === 0;
    const label = state.modelLabel || "Select model";
    modelElement.textContent = label;
    modelElement.className = "composer__model";
    modelElement.title = state.metadataRefreshing ? label + " (refreshing...)" : state.modelOptions.length === 0 && !state.busy ? "Load model settings" : label;
    modelElement.disabled = state.busy;
    modelElement.setAttribute("aria-busy", state.metadataRefreshing ? "true" : "false");
    modelMenuElement?.setAttribute("aria-busy", state.metadataRefreshing ? "true" : "false");
    syncModelSelect();
    syncThinkingSelect();
  }
  function syncModelSelect() {
    const selectedValue = modelKey(state.modelProvider, state.modelId);
    const currentValue = modelSelectElement.value;
    const modelOptions = getDisplayModelOptions();
    modelSelectElement.replaceChildren();
    for (const model of modelOptions) {
      if (!model || typeof model.provider !== "string" || typeof model.id !== "string") {
        continue;
      }
      const option = document.createElement("option");
      option.value = modelKey(model.provider, model.id);
      option.textContent = model.name && model.name !== model.id ? model.name + " (" + model.provider + "/" + model.id + ")" : model.provider + "/" + model.id;
      modelSelectElement.append(option);
    }
    modelSelectElement.value = selectedValue || currentValue;
    modelSelectElement.disabled = state.busy || modelOptions.length === 0;
  }
  function getDisplayModelOptions() {
    if (state.modelOptions.length > 0) {
      return state.modelOptions;
    }
    if (!state.modelProvider || !state.modelId) {
      return [];
    }
    return [{
      provider: state.modelProvider,
      id: state.modelId,
      name: state.modelLabel || state.modelId,
      reasoning: state.modelReasoning
    }];
  }
  function syncThinkingSelect() {
    thinkingSelectElement.value = state.thinkingLevel || "medium";
    thinkingSelectElement.disabled = state.busy || !state.modelReasoning;
    thinkingSelectElement.title = state.modelReasoning ? "Thinking mode" : "The selected model does not advertise thinking support.";
  }
  function toggleModelMenu() {
    if (modelElement.disabled) {
      return;
    }
    if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
      vscode.postMessage({ type: "refreshMetadata" });
    }
    cancelSessionNameEdit();
    const open = !modelMenuElement.hasAttribute("open");
    modelMenuElement.toggleAttribute("open", open);
    modelElement.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeModelMenu() {
    modelMenuElement?.removeAttribute("open");
    modelElement?.setAttribute("aria-expanded", "false");
  }
  function selectModel() {
    const [provider, modelId] = splitModelKey(modelSelectElement.value);
    if (!provider || !modelId || state.busy) {
      return;
    }
    closeModelMenu();
    vscode.postMessage({ type: "setModel", provider, modelId });
  }
  function selectThinkingLevel() {
    const level = thinkingSelectElement.value;
    if (!level || state.busy || !state.modelReasoning) {
      return;
    }
    closeModelMenu();
    vscode.postMessage({ type: "setThinkingLevel", level });
  }
  function handleSlashMenuKeydown(event) {
    if (!slashMenuOpen) {
      if (event.key === "Escape") {
        dismissSlashMenu();
      }
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSlashMenuSelection(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSlashMenuSelection(-1);
      return true;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      acceptActiveSlashCommand();
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && slashMenuItems.length > 0) {
      event.preventDefault();
      acceptActiveSlashCommand();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissSlashMenu();
      return true;
    }
    return false;
  }
  function syncSlashMenu() {
    if (!shouldShowSlashMenu()) {
      closeSlashMenu();
      return;
    }
    closeModelMenu();
    cancelSessionNameEdit();
    if (state.slashCommands.length === 0 && !state.slashCommandsRefreshing && !slashCommandsRefreshRequested) {
      slashCommandsRefreshRequested = true;
      vscode.postMessage({ type: "refreshSlashCommands" });
    }
    const query = getSlashCommandQuery();
    if (query === slashMenuDismissedQuery) {
      closeSlashMenu();
      return;
    }
    if (query !== slashMenuQuery) {
      slashMenuQuery = query;
      slashMenuActiveIndex = 0;
      if (slashMenuElement) {
        slashMenuElement.scrollTop = 0;
      }
    }
    slashMenuItems = getFilteredSlashCommands(query);
    slashMenuActiveIndex = Math.min(slashMenuActiveIndex, Math.max(0, slashMenuItems.length - 1));
    renderSlashMenu(query);
    openSlashMenu();
  }
  function shouldShowSlashMenu() {
    if (!textarea || state.busy || document.activeElement !== textarea) {
      return false;
    }
    const cursor = textarea.selectionStart;
    if (cursor !== textarea.selectionEnd) {
      return false;
    }
    const beforeCursor = textarea.value.slice(0, cursor);
    return beforeCursor.startsWith("/") && !Array.from(beforeCursor).some((character) => character.trim().length === 0);
  }
  function getSlashCommandQuery() {
    return textarea.value.slice(1, textarea.selectionStart).toLowerCase();
  }
  function getFilteredSlashCommands(query) {
    const commands = getAllSlashCommands();
    const scored = [];
    for (const command of commands) {
      if (!command || typeof command.name !== "string") {
        continue;
      }
      const name = command.name.toLowerCase();
      const description = typeof command.description === "string" ? command.description.toLowerCase() : "";
      const namePrefix = name.startsWith(query);
      const nameMatch = name.includes(query);
      const descriptionMatch = description.includes(query);
      if (!nameMatch && !descriptionMatch) {
        continue;
      }
      scored.push({
        command,
        score: namePrefix ? 0 : nameMatch ? 1 : 2
      });
    }
    return scored.sort((left, right) => left.score - right.score || getSlashCommandSourceRank(left.command.source) - getSlashCommandSourceRank(right.command.source) || left.command.name.localeCompare(right.command.name)).slice(0, 8).map((item) => item.command);
  }
  function getAllSlashCommands() {
    const commands = [...localSlashCommands2];
    const names = new Set(commands.map((command) => command.name));
    if (Array.isArray(state.slashCommands)) {
      for (const command of state.slashCommands) {
        if (!command || typeof command.name !== "string" || names.has(command.name)) {
          continue;
        }
        names.add(command.name);
        commands.push(command);
      }
    }
    return commands;
  }
  function getSlashCommandSourceRank(source) {
    if (source === "builtin") {
      return 0;
    }
    if (source === "extension") {
      return 1;
    }
    if (source === "prompt") {
      return 2;
    }
    if (source === "skill") {
      return 3;
    }
    if (source === "unsupported") {
      return 4;
    }
    return 5;
  }
  function renderSlashMenu(query) {
    slashMenuElement.replaceChildren();
    if (state.slashCommandsRefreshing && slashMenuItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement("Loading commands..."));
      return;
    }
    if (slashMenuItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(query ? "No matching slash commands" : "No slash commands available"));
      return;
    }
    for (let index = 0; index < slashMenuItems.length; index += 1) {
      slashMenuElement.append(createSlashMenuItemElement(slashMenuItems[index], index));
    }
    syncSlashMenuActiveDescendant();
  }
  function createSlashMenuEmptyElement(text) {
    const empty = document.createElement("div");
    empty.className = "composer__slash-empty";
    empty.textContent = text;
    return empty;
  }
  function createSlashMenuItemElement(command, index) {
    const item = document.createElement("button");
    item.type = "button";
    item.id = "slash-command-" + index;
    item.className = "composer__slash-item" + (index === slashMenuActiveIndex ? " composer__slash-item--active" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === slashMenuActiveIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    const label = document.createElement("span");
    label.className = "composer__slash-label";
    label.textContent = "/" + command.name;
    item.append(label);
    const meta = formatSlashCommandMeta(command);
    if (meta) {
      const source = document.createElement("span");
      source.className = "composer__slash-source";
      source.textContent = meta;
      item.append(source);
    }
    if (command.description) {
      const description = document.createElement("span");
      description.className = "composer__slash-description";
      description.textContent = command.description;
      item.append(description);
    }
    return item;
  }
  function formatSlashCommandMeta(command) {
    const source = typeof command.source === "string" ? command.source : "";
    const location = typeof command.location === "string" ? command.location : "";
    if (source && location) {
      return source + " \xB7 " + location;
    }
    return source || location;
  }
  function openSlashMenu() {
    if (!slashMenuElement) {
      return;
    }
    slashMenuOpen = true;
    slashMenuElement.setAttribute("open", "");
    textarea?.setAttribute("aria-expanded", "true");
    syncSlashMenuActiveDescendant();
  }
  function dismissSlashMenu() {
    slashMenuDismissedQuery = textarea ? getSlashCommandQuery() : void 0;
    closeSlashMenu();
  }
  function closeSlashMenu() {
    slashMenuOpen = false;
    slashCommandsRefreshRequested = false;
    slashMenuItems = [];
    slashMenuActiveIndex = 0;
    slashMenuQuery = "";
    slashMenuElement?.removeAttribute("open");
    textarea?.setAttribute("aria-expanded", "false");
    textarea?.removeAttribute("aria-activedescendant");
  }
  function moveSlashMenuSelection(delta) {
    if (slashMenuItems.length === 0) {
      return;
    }
    slashMenuActiveIndex = (slashMenuActiveIndex + delta + slashMenuItems.length) % slashMenuItems.length;
    renderSlashMenu(getSlashCommandQuery());
  }
  function syncSlashMenuActiveDescendant() {
    if (!slashMenuOpen || slashMenuItems.length === 0) {
      textarea?.removeAttribute("aria-activedescendant");
      return;
    }
    textarea?.setAttribute("aria-activedescendant", "slash-command-" + slashMenuActiveIndex);
    slashMenuElement?.querySelector(".composer__slash-item--active")?.scrollIntoView({ block: "nearest" });
  }
  function acceptActiveSlashCommand() {
    const command = slashMenuItems[slashMenuActiveIndex];
    if (command) {
      acceptSlashCommand(command);
    }
  }
  function acceptSlashCommand(command) {
    const cursor = textarea.selectionStart;
    const after = textarea.value.slice(cursor).trimStart();
    const value = "/" + command.name + " " + after;
    const nextCursor = command.name.length + 2;
    textarea.value = value;
    textarea.setSelectionRange(nextCursor, nextCursor);
    closeSlashMenu();
    syncComposer({ preserveBottom: true });
    focusPromptInput();
  }
  function modelKey(provider, id) {
    return provider + "/" + id;
  }
  function splitModelKey(value) {
    const slashIndex = value.indexOf("/");
    if (slashIndex <= 0) {
      return ["", ""];
    }
    return [value.slice(0, slashIndex), value.slice(slashIndex + 1)];
  }
  function isMessagesAtBottom() {
    const distanceFromBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight;
    return distanceFromBottom <= messagesBottomThreshold;
  }
  function scrollMessagesToBottom() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }
  function scheduleMessagesToBottom() {
    scrollMessagesToBottomIfChat();
    requestAnimationFrame(() => {
      scrollMessagesToBottomIfChat();
      requestAnimationFrame(scrollMessagesToBottomIfChat);
    });
    setTimeout(scrollMessagesToBottomIfChat, 80);
    setTimeout(scrollMessagesToBottomIfChat, 220);
  }
  function scrollMessagesToBottomIfChat() {
    if (state.viewMode === "chat") {
      scrollMessagesToBottom();
    }
  }
  function syncTextareaHeight() {
    textarea.style.height = "auto";
    const maxHeight = getMaxTextareaHeight();
    const nextHeight = Math.max(minTextareaHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = nextHeight + "px";
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }
  function getMaxTextareaHeight() {
    const reservedMessagesHeight = getReservedMessagesHeight();
    const composerChromeHeight = getComposerChromeHeight();
    const availableHeight = window.innerHeight - reservedMessagesHeight - composerChromeHeight;
    return Math.max(minTextareaHeight, Math.min(maxTextareaHeight, availableHeight));
  }
  function getReservedMessagesHeight() {
    return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
  }
  function getComposerChromeHeight() {
    const composerStyles = getComputedStyle(form);
    const composerMarginHeight = parseCssPixelValue(composerStyles.marginTop) + parseCssPixelValue(composerStyles.marginBottom);
    const composerHeight = form.getBoundingClientRect().height + composerMarginHeight;
    const textareaHeight = textarea.getBoundingClientRect().height;
    return Math.max(0, composerHeight - textareaHeight);
  }
  function parseCssPixelValue(value) {
    return Number.parseFloat(value) || 0;
  }
  function applyComposerTextFromState() {
    if (!textarea || state.composerTextRevision <= appliedComposerTextRevision) {
      return;
    }
    appliedComposerTextRevision = state.composerTextRevision;
    textarea.value = state.composerText;
    closeSlashMenu();
    syncComposer({ preserveBottom: true });
    focusPromptInput();
  }
  function syncComposer(options = {}) {
    const shouldPreserveBottom = Boolean(options.preserveBottom) && isMessagesAtBottom();
    syncSubmit();
    syncBusySubmitMode();
    syncTextareaHeight();
    if (shouldPreserveBottom) {
      scrollMessagesToBottom();
    }
  }
  function startNewSession() {
    cancelSessionNameEdit();
    vscode.postMessage({ type: "newSession" });
    focusPromptInput();
  }
  function runSessionSlashCommand(command) {
    if (state.busy) {
      return;
    }
    closeSlashMenu();
    cancelSessionNameEdit();
    vscode.postMessage({ type: "submit", text: "/" + command });
    focusPromptInput();
  }
  function isNewSessionShortcut(event) {
    if (event.key.toLowerCase() !== "n" || event.shiftKey || event.altKey) {
      return false;
    }
    if (isMac) {
      return event.metaKey && !event.ctrlKey;
    }
    return event.ctrlKey && !event.metaKey;
  }
  function focusPromptInput() {
    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
    });
  }
  function handleMessageClick(event) {
    const target = eventTargetElement(event);
    const copyButton = target?.closest(".message__copy");
    if (copyButton instanceof HTMLElement) {
      const index = Number(copyButton.dataset.copyMessageIndex);
      const text = Number.isInteger(index) ? state.messages[index]?.text : "";
      if (text) {
        event.preventDefault();
        vscode.postMessage({ type: "copyText", text });
      }
      return;
    }
    const link = target?.closest(".tau-file-link");
    if (!(link instanceof HTMLElement)) {
      return;
    }
    const filePath = link.dataset.filePath;
    if (!filePath) {
      return;
    }
    event.preventDefault();
    vscode.postMessage({
      type: "openFile",
      path: filePath,
      ...parseDatasetPositiveInteger(link.dataset.line, "line"),
      ...parseDatasetPositiveInteger(link.dataset.column, "column")
    });
  }
  function parseDatasetPositiveInteger(value, key) {
    if (!value) {
      return {};
    }
    const numberValue = Number(value);
    return Number.isInteger(numberValue) && numberValue > 0 ? { [key]: numberValue } : {};
  }
  function eventTargetElement(event) {
    return event.target instanceof Element ? event.target : null;
  }
  function eventTargetNode(event) {
    return event.target instanceof Node ? event.target : null;
  }
  vscode.postMessage({ type: "ready" });
  window.addEventListener("resize", () => {
    render();
    syncComposer({ preserveBottom: true });
  });
  render();
})();
