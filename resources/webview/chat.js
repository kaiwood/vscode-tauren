"use strict";
(() => {
  // src/webview/dom.ts
  function getWebviewDom() {
    return {
      toolbarTitleElement: queryRequired(".pi-toolbar__title"),
      toolbarTitleTextElement: queryRequired(".pi-toolbar__title-text"),
      sessionNameInputElement: queryRequired(".pi-toolbar__title-input"),
      sessionToggleButton: queryRequired(".pi-toolbar__sessions"),
      sessionEditButton: queryRequired(".pi-toolbar__edit"),
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
      busySubmitHintElement: queryRequired(".composer__busy-submit-hint"),
      streamingBehaviorButtonElements: queryAll(".composer__mode-button"),
      newSessionButton: queryRequired(".composer__add"),
      forkSessionButton: queryRequired(".composer__fork"),
      cloneSessionButton: queryRequired(".composer__clone"),
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
    breaks: false,
    highlight: highlightCode
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
    animateNewVisibleText(element, options.animateFromText);
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
  function highlightCode(code, language) {
    if (!window.hljs || typeof language !== "string" || language.length === 0) {
      return escapeHtml(code);
    }
    const normalizedLanguage = normalizeCodeLanguage(language);
    if (!window.hljs.getLanguage(normalizedLanguage)) {
      return escapeHtml(code);
    }
    try {
      return window.hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true
      }).value;
    } catch {
      return escapeHtml(code);
    }
  }
  function normalizeCodeLanguage(language) {
    const normalized = language.toLowerCase().trim();
    const aliases = {
      cjs: "javascript",
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      shell: "bash",
      sh: "bash",
      ts: "typescript",
      tsx: "typescript",
      yml: "yaml"
    };
    return aliases[normalized] || normalized;
  }
  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
      article.append(createActivityListElement(activities));
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
  function createActivityListElement(activities) {
    const list = document.createElement("div");
    list.className = "activity-list";
    for (const activity of activities) {
      list.append(createActivityElement(activity));
    }
    return list;
  }
  function createActivityElement(activity) {
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
        body.textContent = activity.body;
      } else {
        renderMarkdownInto(body, activity.body);
      }
      details.append(body);
    }
    return details;
  }
  function shouldKeepActivityOpen(activity) {
    return activity.kind === "thinking" && typeof activity.body === "string" && activity.body.length > 0;
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
  var {
    toolbarTitleElement,
    toolbarTitleTextElement,
    sessionNameInputElement,
    sessionToggleButton,
    sessionEditButton,
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
    busySubmitHintElement,
    streamingBehaviorButtonElements,
    newSessionButton,
    forkSessionButton,
    cloneSessionButton,
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
  var state = { messages: [], busy: false, modelLabel: "", modelProvider: "", modelId: "", modelReasoning: false, thinkingLevel: "", modelOptions: [], contextUsageLabel: "", contextUsageTitle: "", contextUsageLevel: "", metadataRefreshing: false, slashCommands: [], slashCommandsRefreshing: false, promptContext: [], composerText: "", composerTextRevision: 0, viewMode: "chat", sessions: [], sessionsRefreshing: false, sessionsError: "", currentSessionFile: "", currentSessionName: "", treeItems: [], treeRefreshing: false, treeError: "" };
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
  var sessionNameEditing = false;
  var sessionNameEditInitialValue = "";
  var renderedMessageViews = [];
  window.addEventListener("message", (event) => {
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
    state = {
      messages: Array.isArray(event.data.messages) ? event.data.messages : [],
      busy: Boolean(event.data.busy),
      modelLabel: typeof event.data.modelLabel === "string" ? event.data.modelLabel : "",
      modelProvider: typeof event.data.modelProvider === "string" ? event.data.modelProvider : "",
      modelId: typeof event.data.modelId === "string" ? event.data.modelId : "",
      modelReasoning: Boolean(event.data.modelReasoning),
      thinkingLevel: typeof event.data.thinkingLevel === "string" ? event.data.thinkingLevel : "",
      modelOptions: Array.isArray(event.data.modelOptions) ? event.data.modelOptions : [],
      contextUsageLabel: typeof event.data.contextUsageLabel === "string" ? event.data.contextUsageLabel : "",
      contextUsageTitle: typeof event.data.contextUsageTitle === "string" ? event.data.contextUsageTitle : "",
      contextUsageLevel: typeof event.data.contextUsageLevel === "string" ? event.data.contextUsageLevel : "",
      metadataRefreshing: Boolean(event.data.metadataRefreshing),
      slashCommands: Array.isArray(event.data.slashCommands) ? event.data.slashCommands : [],
      slashCommandsRefreshing: Boolean(event.data.slashCommandsRefreshing),
      promptContext: Array.isArray(event.data.promptContext) ? event.data.promptContext : [],
      composerText: typeof event.data.composerText === "string" ? event.data.composerText : "",
      composerTextRevision: typeof event.data.composerTextRevision === "number" ? event.data.composerTextRevision : 0,
      viewMode: event.data.viewMode === "sessions" || event.data.viewMode === "tree" ? event.data.viewMode : "chat",
      sessions: Array.isArray(event.data.sessions) ? event.data.sessions : [],
      sessionsRefreshing: Boolean(event.data.sessionsRefreshing),
      sessionsError: typeof event.data.sessionsError === "string" ? event.data.sessionsError : "",
      currentSessionFile: typeof event.data.currentSessionFile === "string" ? event.data.currentSessionFile : "",
      currentSessionName: typeof event.data.currentSessionName === "string" ? event.data.currentSessionName : "",
      treeItems: Array.isArray(event.data.treeItems) ? event.data.treeItems : [],
      treeRefreshing: Boolean(event.data.treeRefreshing),
      treeError: typeof event.data.treeError === "string" ? event.data.treeError : ""
    };
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
    render();
    applyComposerTextFromState();
    if ((previousViewMode === "sessions" || previousViewMode === "tree") && state.viewMode === "chat") {
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
  forkSessionButton?.addEventListener("click", () => runSessionSlashCommand("fork"));
  cloneSessionButton?.addEventListener("click", () => runSessionSlashCommand("clone"));
  messagesElement?.addEventListener("click", handleMessageClick);
  sessionToggleButton?.addEventListener("click", toggleSessionView);
  sessionEditButton?.addEventListener("click", startSessionNameEdit);
  sessionMenuButton?.addEventListener("click", toggleSessionCommandMenu);
  for (const item of sessionMenuItemElements) {
    item.addEventListener("click", () => runSessionMenuCommand(item.getAttribute("data-session-command")));
  }
  sessionNameInputElement?.addEventListener("blur", () => cancelSessionNameEdit());
  sessionsElement?.addEventListener("keydown", handleSessionListKeydown);
  sessionsElement?.addEventListener("pointermove", enableSessionPointerHover);
  sessionsElement?.addEventListener("click", (event) => {
    const target = eventTargetElement(event);
    const deleteButton = target?.closest(".sessions__delete");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      const item2 = deleteButton.closest(".sessions__item");
      const index2 = Number(item2?.getAttribute("data-index"));
      deleteSessionIndex(index2);
      return;
    }
    const item = target?.closest(".sessions__item");
    if (!item) {
      return;
    }
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
    messagesElement.hidden = isListView;
    sessionsElement.hidden = !isListView;
    form.hidden = isListView;
    const toolbarTitle = state.viewMode === "sessions" ? "Sessions" : state.viewMode === "tree" ? "Session tree" : getCurrentSessionTitle();
    if ((isListView || state.busy) && sessionNameEditing) {
      cancelSessionNameEdit();
    }
    toolbarTitleTextElement.textContent = toolbarTitle;
    toolbarTitleElement.title = toolbarTitle;
    toolbarTitleElement.classList.toggle("pi-toolbar__title--editing", sessionNameEditing);
    toolbarTitleTextElement.hidden = sessionNameEditing;
    sessionNameInputElement.hidden = !sessionNameEditing;
    sessionEditButton.hidden = isListView;
    sessionEditButton.disabled = state.busy || sessionNameEditing;
    sessionMenuWrapElement.hidden = isListView;
    sessionMenuButton.disabled = state.busy || sessionNameEditing;
    for (const item of sessionMenuItemElements) {
      item.disabled = state.busy || sessionNameEditing;
    }
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
      requestAnimationFrame(() => sessionsElement?.focus({ preventScroll: true }));
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
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Ask Pi about this workspace.";
      messagesContentElement.replaceChildren(empty);
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
          animateFromText === void 0 ? void 0 : { animateFromText }
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
        animateFromText === void 0 ? void 0 : { animateFromText }
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
    return JSON.stringify(message.activities);
  }
  function renderSessions() {
    sessionsElement.replaceChildren();
    sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex);
    const header = document.createElement("div");
    header.className = "sessions__header";
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
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
    title.textContent = getSessionDisplayName(session);
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
    if (canDeleteSession(session)) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "sessions__delete";
      deleteButton.title = "Move session to Trash";
      deleteButton.setAttribute("aria-label", "Move session to Trash");
      deleteButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v1H2V3h3l1-1Zm-2 3h8l-.6 9.2A2 2 0 0 1 9.4 16H6.6a2 2 0 0 1-2-1.8L4 5Zm2 1v8h1V6H6Zm3 0v8h1V6H9Z"/></svg>';
      item.append(deleteButton);
    }
    return item;
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
    if (!Array.isArray(state.sessions) || state.sessions.length === 0 || !state.currentSessionFile) {
      return void 0;
    }
    return state.sessions.find((session) => session.path === state.currentSessionFile) ?? state.sessions.find((session) => session.current);
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
    if (document.activeElement === textarea && state.viewMode === "chat") {
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
      state.viewMode === "tree" ? moveTreeSelection(1) : moveSessionSelection(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      state.viewMode === "tree" ? moveTreeSelection(-1) : moveSessionSelection(-1);
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
    sessionEditButton.disabled = state.busy || sessionNameEditing;
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
  }
  function runSessionMenuCommand(command) {
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
    forkSessionButton.disabled = state.busy;
    cloneSessionButton.disabled = state.busy;
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
    if (!busySubmitElement || !busySubmitHintElement) {
      return;
    }
    setBusySubmitVisible(state.busy);
    if (!state.busy) {
      return;
    }
    const hasSendableText = textarea.value.trim().length > 0;
    busySubmitHintElement.textContent = hasSendableText ? streamingBehavior === "followUp" ? "This will run after Pi finishes the current task." : "This will steer the current run before Pi's next LLM call." : "Type to steer Pi, or leave empty to stop.";
    for (const button of streamingBehaviorButtonElements) {
      const isActive = button.getAttribute("data-streaming-behavior") === streamingBehavior;
      button.classList.toggle("composer__mode-button--active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
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
//# sourceMappingURL=chat.js.map
