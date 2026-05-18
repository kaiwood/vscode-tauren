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

  // src/webview/composer/diffCounter.ts
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
    const target = normalizeDiffLineCount(targetValue);
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
  function normalizeDiffLineCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  function formatDiffLineCount(value) {
    return Math.max(0, Math.floor(value)).toLocaleString();
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
    const normalizedValue = normalizeDiffLineCount(value);
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

  // src/commands/slashCommands.ts
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

  // src/webview/composer/composer.ts
  var ComposerController = class {
    constructor(options) {
      this.options = options;
      this.addedDiffCounter = createDiffCounter(options.diffAddedElement, "+");
      this.removedDiffCounter = createDiffCounter(options.diffRemovedElement, "-");
    }
    options;
    appliedComposerTextRevision = 0;
    slashMenuOpen = false;
    slashMenuActiveIndex = 0;
    slashMenuItems = [];
    slashMenuQuery = "";
    slashMenuDismissedQuery;
    slashCommandsRefreshRequested = false;
    streamingBehavior = "steer";
    busySubmitHideTimeout;
    addedDiffCounter;
    removedDiffCounter;
    attachEventListeners() {
      this.options.form.addEventListener("submit", (event) => this.handleSubmit(event));
      this.options.submitButton.addEventListener("click", (event) => this.handleSubmitButtonClick(event));
      for (const button of this.options.streamingBehaviorButtonElements) {
        button.addEventListener("click", () => this.selectStreamingBehavior(button));
      }
      this.options.modelElement.addEventListener("click", () => this.toggleModelMenu());
      this.options.modelSelectElement.addEventListener("change", () => this.selectModel());
      this.options.thinkingSelectElement.addEventListener("change", () => this.selectThinkingLevel());
      this.options.textarea.addEventListener("keydown", (event) => {
        if (this.handleSlashMenuKeydown(event)) {
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.options.form.requestSubmit();
        }
      });
      this.options.textarea.addEventListener("input", () => {
        this.slashMenuDismissedQuery = void 0;
        this.syncComposer({ preserveBottom: true });
        this.syncSlashMenu();
      });
      this.options.textarea.addEventListener("click", () => this.syncSlashMenu());
      this.options.textarea.addEventListener("blur", () => this.closeSlashMenu());
      this.options.textarea.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
          this.syncSlashMenu();
        }
      });
      this.options.slashMenuElement?.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      this.options.slashMenuElement?.addEventListener("click", (event) => {
        const item = eventTargetElement(event)?.closest(".composer__slash-item");
        if (!item) {
          return;
        }
        const index = Number(item.getAttribute("data-index"));
        const command = this.slashMenuItems[index];
        if (command) {
          this.acceptSlashCommand(command);
        }
      });
      this.options.contextBadgesElement?.addEventListener("mousedown", (event) => {
        if (eventTargetElement(event)?.closest(".composer__context-remove")) {
          event.preventDefault();
        }
      });
      this.options.contextBadgesElement?.addEventListener("click", (event) => {
        const removeButton = eventTargetElement(event)?.closest(".composer__context-remove");
        if (!removeButton) {
          return;
        }
        const id = removeButton.getAttribute("data-context-id");
        if (!id) {
          return;
        }
        this.options.postMessage({ type: "removePromptContext", id });
        this.options.focusPromptInput();
      });
    }
    handleWindowClick(target) {
      if (this.options.modelMenuElement?.hasAttribute("open")) {
        if (!this.options.modelMenuElement.contains(target) && !this.options.modelElement.contains(target)) {
          this.closeModelMenu();
        }
      }
      if (this.slashMenuOpen) {
        if (!this.options.slashMenuElement?.contains(target) && target !== this.options.textarea) {
          this.closeSlashMenu();
        }
      }
    }
    hasSlashMenuOpen() {
      return this.slashMenuOpen;
    }
    hasModelMenuOpen() {
      return this.options.modelMenuElement?.hasAttribute("open") ?? false;
    }
    dismissSlashMenu() {
      this.slashMenuDismissedQuery = this.getSlashCommandQuery();
      this.closeSlashMenu();
    }
    closeSlashMenu() {
      this.slashMenuOpen = false;
      this.slashCommandsRefreshRequested = false;
      this.slashMenuItems = [];
      this.slashMenuActiveIndex = 0;
      this.slashMenuQuery = "";
      this.options.slashMenuElement?.removeAttribute("open");
      this.options.textarea.setAttribute("aria-expanded", "false");
      this.options.textarea.removeAttribute("aria-activedescendant");
    }
    closeModelMenu() {
      this.options.modelMenuElement?.removeAttribute("open");
      this.options.modelElement.setAttribute("aria-expanded", "false");
    }
    syncPromptContextBadges() {
      if (!this.options.contextBadgesElement) {
        return;
      }
      const state2 = this.options.getState();
      const attachments = Array.isArray(state2.promptContext) ? state2.promptContext.filter(isPromptContextAttachment) : [];
      this.options.form.classList.toggle("composer--has-context", attachments.length > 0);
      this.options.contextBadgesElement.hidden = attachments.length === 0;
      this.options.contextBadgesElement.replaceChildren();
      for (const attachment of attachments) {
        const badge = document.createElement("span");
        badge.className = "composer__context-badge";
        badge.classList.toggle("composer__context-badge--origin", attachment.source === "origin");
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
        this.options.contextBadgesElement.append(badge);
      }
    }
    syncModelLabel() {
      const state2 = this.options.getState();
      this.options.contextValueElement.textContent = state2.contextUsageLabel;
      this.options.contextTooltipElement.textContent = state2.contextUsageTitle;
      this.options.contextElement.title = state2.contextUsageTitle;
      this.options.contextElement.className = "composer__context" + (state2.contextUsageLevel ? " composer__context--" + state2.contextUsageLevel : "");
      this.options.contextElement.hidden = state2.contextUsageLabel.length === 0;
      const label = state2.modelLabel || "Select model";
      this.options.modelElement.textContent = label;
      this.options.modelElement.className = "composer__model";
      this.options.modelElement.title = state2.metadataRefreshing ? label + " (refreshing...)" : state2.modelOptions.length === 0 && !state2.busy ? "Load model settings" : label;
      this.options.modelElement.disabled = state2.busy;
      this.options.modelElement.setAttribute("aria-busy", state2.metadataRefreshing ? "true" : "false");
      this.options.modelMenuElement?.setAttribute("aria-busy", state2.metadataRefreshing ? "true" : "false");
      this.syncModelSelect();
      this.syncThinkingSelect();
    }
    applyComposerTextFromState() {
      const state2 = this.options.getState();
      if (state2.composerTextRevision <= this.appliedComposerTextRevision) {
        return;
      }
      this.appliedComposerTextRevision = state2.composerTextRevision;
      this.options.textarea.value = state2.composerText;
      this.closeSlashMenu();
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    syncComposer(options = {}) {
      const shouldPreserveBottom = Boolean(options.preserveBottom) && this.options.isMessagesAtBottom();
      this.syncSubmit();
      this.syncBusySubmitMode();
      this.syncTextareaHeight();
      if (shouldPreserveBottom) {
        this.options.scrollMessagesToBottom();
      }
    }
    syncSlashMenu() {
      const state2 = this.options.getState();
      if (!this.shouldShowSlashMenu()) {
        this.closeSlashMenu();
        return;
      }
      this.closeModelMenu();
      this.options.cancelSessionNameEdit();
      if (state2.slashCommands.length === 0 && !state2.slashCommandsRefreshing && !this.slashCommandsRefreshRequested) {
        this.slashCommandsRefreshRequested = true;
        this.options.postMessage({ type: "refreshSlashCommands" });
      }
      const query = this.getSlashCommandQuery();
      if (query === this.slashMenuDismissedQuery) {
        this.closeSlashMenu();
        return;
      }
      if (query !== this.slashMenuQuery) {
        this.slashMenuQuery = query;
        this.slashMenuActiveIndex = 0;
        if (this.options.slashMenuElement) {
          this.options.slashMenuElement.scrollTop = 0;
        }
      }
      this.slashMenuItems = this.getFilteredSlashCommands(query);
      this.slashMenuActiveIndex = Math.min(this.slashMenuActiveIndex, Math.max(0, this.slashMenuItems.length - 1));
      this.renderSlashMenu(query);
      this.openSlashMenu();
    }
    runSessionSlashCommand(command) {
      const state2 = this.options.getState();
      if (state2.busy) {
        return;
      }
      this.closeSlashMenu();
      this.options.cancelSessionNameEdit();
      this.options.postMessage({ type: "submit", text: "/" + command });
      this.options.focusPromptInput();
    }
    isStopSubmitMode() {
      return this.options.getState().busy && this.options.textarea.value.length === 0;
    }
    handleSubmit(event) {
      const state2 = this.options.getState();
      event.preventDefault();
      const text = this.options.textarea.value.trim();
      if (!text) {
        return;
      }
      this.closeSlashMenu();
      this.options.cancelSessionNameEdit();
      this.options.postMessage(state2.busy ? { type: "submit", text, streamingBehavior: this.streamingBehavior } : { type: "submit", text });
      this.options.textarea.value = "";
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    handleSubmitButtonClick(event) {
      if (!this.isStopSubmitMode()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.options.postMessage({ type: "abort" });
      this.options.focusPromptInput();
    }
    selectStreamingBehavior(button) {
      const nextBehavior = button.getAttribute("data-streaming-behavior");
      if (nextBehavior === "steer" || nextBehavior === "followUp") {
        this.streamingBehavior = nextBehavior;
        this.syncComposer({ preserveBottom: true });
        this.options.focusPromptInput();
      }
    }
    syncSubmit() {
      const state2 = this.options.getState();
      const isStopMode = this.isStopSubmitMode();
      const hasInput = this.options.textarea.value.length > 0;
      const hasSendableText = this.options.textarea.value.trim().length > 0;
      const label = this.getSubmitLabel(isStopMode);
      this.options.submitButton.disabled = state2.busy ? hasInput && !hasSendableText : !hasSendableText;
      this.options.newSessionButton.disabled = false;
      this.options.submitButton.classList.toggle("composer__submit--stop", isStopMode);
      this.options.submitButton.setAttribute("aria-label", label);
      this.options.submitButton.title = label;
    }
    getSubmitLabel(isStopMode) {
      if (isStopMode) {
        return "Stop current response";
      }
      if (this.options.getState().busy) {
        return this.streamingBehavior === "followUp" ? "Queue follow-up" : "Steer current run";
      }
      return "Send message";
    }
    syncBusySubmitMode() {
      const state2 = this.options.getState();
      if (!this.options.busySubmitElement) {
        return;
      }
      const showDiffSummary = state2.busy || this.hasWorkspaceDiffChanges();
      this.setBusySubmitVisible(showDiffSummary);
      this.syncDiffSummary();
      const streamingModesElement = this.options.streamingBehaviorButtonElements[0]?.parentElement;
      if (streamingModesElement) {
        streamingModesElement.hidden = !state2.busy;
      }
      if (!state2.busy) {
        return;
      }
      for (const button of this.options.streamingBehaviorButtonElements) {
        const isActive = button.getAttribute("data-streaming-behavior") === this.streamingBehavior;
        button.classList.toggle("composer__mode-button--active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      }
    }
    syncDiffSummary() {
      const state2 = this.options.getState();
      const addedLines = normalizeDiffLineCount(state2.workspaceDiffStats.addedLines);
      const removedLines = normalizeDiffLineCount(state2.workspaceDiffStats.removedLines);
      updateDiffCounter(this.addedDiffCounter, addedLines);
      updateDiffCounter(this.removedDiffCounter, removedLines);
      this.options.diffSummaryElement.title = `Show session changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
    }
    hasWorkspaceDiffChanges() {
      const state2 = this.options.getState();
      return state2.workspaceDiffStats.addedLines > 0 || state2.workspaceDiffStats.removedLines > 0;
    }
    setBusySubmitVisible(visible) {
      const busySubmitElement2 = this.options.busySubmitElement;
      if (!busySubmitElement2) {
        return;
      }
      if (this.busySubmitHideTimeout) {
        clearTimeout(this.busySubmitHideTimeout);
        this.busySubmitHideTimeout = void 0;
      }
      if (visible) {
        busySubmitElement2.hidden = false;
        requestAnimationFrame(() => {
          busySubmitElement2.classList.add("composer__busy-submit--visible");
        });
        return;
      }
      busySubmitElement2.classList.remove("composer__busy-submit--visible");
      this.busySubmitHideTimeout = setTimeout(() => {
        if (!this.options.getState().busy) {
          busySubmitElement2.hidden = true;
        }
      }, 160);
    }
    syncModelSelect() {
      const state2 = this.options.getState();
      const selectedValue = modelKey(state2.modelProvider, state2.modelId);
      const currentValue = this.options.modelSelectElement.value;
      const modelOptions = this.getDisplayModelOptions();
      this.options.modelSelectElement.replaceChildren();
      for (const model of modelOptions) {
        if (!model || typeof model.provider !== "string" || typeof model.id !== "string") {
          continue;
        }
        const option = document.createElement("option");
        option.value = modelKey(model.provider, model.id);
        option.textContent = model.name && model.name !== model.id ? model.name + " (" + model.provider + "/" + model.id + ")" : model.provider + "/" + model.id;
        this.options.modelSelectElement.append(option);
      }
      this.options.modelSelectElement.value = selectedValue || currentValue;
      this.options.modelSelectElement.disabled = state2.busy || modelOptions.length === 0;
    }
    getDisplayModelOptions() {
      const state2 = this.options.getState();
      if (state2.modelOptions.length > 0) {
        return state2.modelOptions;
      }
      if (!state2.modelProvider || !state2.modelId) {
        return [];
      }
      return [{
        provider: state2.modelProvider,
        id: state2.modelId,
        name: state2.modelLabel || state2.modelId,
        reasoning: state2.modelReasoning
      }];
    }
    syncThinkingSelect() {
      const state2 = this.options.getState();
      this.options.thinkingSelectElement.value = state2.thinkingLevel || "medium";
      this.options.thinkingSelectElement.disabled = state2.busy || !state2.modelReasoning;
      this.options.thinkingSelectElement.title = state2.modelReasoning ? "Thinking mode" : "The selected model does not advertise thinking support.";
    }
    toggleModelMenu() {
      const state2 = this.options.getState();
      if (this.options.modelElement.disabled) {
        return;
      }
      if (state2.modelOptions.length === 0 && !state2.metadataRefreshing) {
        this.options.refreshMetadata();
      }
      this.options.cancelSessionNameEdit();
      const open = !this.options.modelMenuElement?.hasAttribute("open");
      this.options.modelMenuElement?.toggleAttribute("open", open);
      this.options.modelElement.setAttribute("aria-expanded", open ? "true" : "false");
    }
    selectModel() {
      const state2 = this.options.getState();
      const [provider, modelId] = splitModelKey(this.options.modelSelectElement.value);
      if (!provider || !modelId || state2.busy) {
        return;
      }
      this.closeModelMenu();
      this.options.postMessage({ type: "setModel", provider, modelId });
    }
    selectThinkingLevel() {
      const state2 = this.options.getState();
      const level = this.options.thinkingSelectElement.value;
      if (!level || state2.busy || !state2.modelReasoning) {
        return;
      }
      this.closeModelMenu();
      this.options.postMessage({ type: "setThinkingLevel", level });
    }
    handleSlashMenuKeydown(event) {
      if (!this.slashMenuOpen) {
        if (event.key === "Escape") {
          this.dismissSlashMenu();
        }
        return false;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveSlashMenuSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveSlashMenuSelection(-1);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        this.acceptActiveSlashCommand();
        return true;
      }
      if (event.key === "Enter" && !event.shiftKey && this.slashMenuItems.length > 0) {
        event.preventDefault();
        this.acceptActiveSlashCommand();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dismissSlashMenu();
        return true;
      }
      return false;
    }
    shouldShowSlashMenu() {
      const state2 = this.options.getState();
      if (state2.busy || document.activeElement !== this.options.textarea) {
        return false;
      }
      const cursor = this.options.textarea.selectionStart;
      if (cursor !== this.options.textarea.selectionEnd) {
        return false;
      }
      const beforeCursor = this.options.textarea.value.slice(0, cursor);
      return beforeCursor.startsWith("/") && !Array.from(beforeCursor).some((character) => character.trim().length === 0);
    }
    getSlashCommandQuery() {
      return this.options.textarea.value.slice(1, this.options.textarea.selectionStart).toLowerCase();
    }
    getFilteredSlashCommands(query) {
      const commands = this.getAllSlashCommands();
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
    getAllSlashCommands() {
      const state2 = this.options.getState();
      const commands = [...localSlashCommands2];
      const names = new Set(commands.map((command) => command.name));
      if (Array.isArray(state2.slashCommands)) {
        for (const command of state2.slashCommands) {
          if (!command || typeof command.name !== "string" || names.has(command.name)) {
            continue;
          }
          names.add(command.name);
          commands.push(command);
        }
      }
      return commands;
    }
    renderSlashMenu(query) {
      const slashMenuElement2 = this.options.slashMenuElement;
      if (!slashMenuElement2) {
        return;
      }
      const state2 = this.options.getState();
      slashMenuElement2.replaceChildren();
      if (state2.slashCommandsRefreshing && this.slashMenuItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement("Loading commands..."));
        return;
      }
      if (this.slashMenuItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement(query ? "No matching slash commands" : "No slash commands available"));
        return;
      }
      for (let index = 0; index < this.slashMenuItems.length; index += 1) {
        slashMenuElement2.append(this.createSlashMenuItemElement(this.slashMenuItems[index], index));
      }
      this.syncSlashMenuActiveDescendant();
    }
    createSlashMenuItemElement(command, index) {
      const item = document.createElement("button");
      item.type = "button";
      item.id = "slash-command-" + index;
      item.className = "composer__slash-item" + (index === this.slashMenuActiveIndex ? " composer__slash-item--active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === this.slashMenuActiveIndex ? "true" : "false");
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
    openSlashMenu() {
      if (!this.options.slashMenuElement) {
        return;
      }
      this.slashMenuOpen = true;
      this.options.slashMenuElement.setAttribute("open", "");
      this.options.textarea.setAttribute("aria-expanded", "true");
      this.syncSlashMenuActiveDescendant();
    }
    moveSlashMenuSelection(delta) {
      if (this.slashMenuItems.length === 0) {
        return;
      }
      this.slashMenuActiveIndex = (this.slashMenuActiveIndex + delta + this.slashMenuItems.length) % this.slashMenuItems.length;
      this.renderSlashMenu(this.getSlashCommandQuery());
    }
    syncSlashMenuActiveDescendant() {
      if (!this.slashMenuOpen || this.slashMenuItems.length === 0) {
        this.options.textarea.removeAttribute("aria-activedescendant");
        return;
      }
      this.options.textarea.setAttribute("aria-activedescendant", "slash-command-" + this.slashMenuActiveIndex);
      this.options.slashMenuElement?.querySelector(".composer__slash-item--active")?.scrollIntoView({ block: "nearest" });
    }
    acceptActiveSlashCommand() {
      const command = this.slashMenuItems[this.slashMenuActiveIndex];
      if (command) {
        this.acceptSlashCommand(command);
      }
    }
    acceptSlashCommand(command) {
      const cursor = this.options.textarea.selectionStart;
      const after = this.options.textarea.value.slice(cursor).trimStart();
      const value = "/" + command.name + " " + after;
      const nextCursor = command.name.length + 2;
      this.options.textarea.value = value;
      this.options.textarea.setSelectionRange(nextCursor, nextCursor);
      this.closeSlashMenu();
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    syncTextareaHeight() {
      this.options.textarea.style.height = "auto";
      const maxHeight = this.getMaxTextareaHeight();
      const nextHeight = Math.max(minTextareaHeight, Math.min(this.options.textarea.scrollHeight, maxHeight));
      this.options.textarea.style.height = nextHeight + "px";
      this.options.textarea.style.overflowY = this.options.textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
    getMaxTextareaHeight() {
      const reservedMessagesHeight = getReservedMessagesHeight();
      const composerChromeHeight = this.getComposerChromeHeight();
      const availableHeight = window.innerHeight - reservedMessagesHeight - composerChromeHeight;
      return Math.max(minTextareaHeight, Math.min(maxTextareaHeight, availableHeight));
    }
    getComposerChromeHeight() {
      const composerStyles = getComputedStyle(this.options.form);
      const composerMarginHeight = parseCssPixelValue(composerStyles.marginTop) + parseCssPixelValue(composerStyles.marginBottom);
      const composerHeight = this.options.form.getBoundingClientRect().height + composerMarginHeight;
      const textareaHeight = this.options.textarea.getBoundingClientRect().height;
      return Math.max(0, composerHeight - textareaHeight);
    }
  };
  function isPromptContextAttachment(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const attachment = value;
    return typeof attachment.id === "string" && typeof attachment.label === "string" && typeof attachment.title === "string";
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
  function createSlashMenuEmptyElement(text) {
    const empty = document.createElement("div");
    empty.className = "composer__slash-empty";
    empty.textContent = text;
    return empty;
  }
  function formatSlashCommandMeta(command) {
    const source = typeof command.source === "string" ? command.source : "";
    const location = typeof command.location === "string" ? command.location : "";
    if (source && location) {
      return source + " \xB7 " + location;
    }
    return source || location;
  }
  function getReservedMessagesHeight() {
    return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
  }
  function parseCssPixelValue(value) {
    return Number.parseFloat(value) || 0;
  }
  function eventTargetElement(event) {
    return event.target instanceof Element ? event.target : null;
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
      sessionHelpWrapElement: queryRequired(".pi-toolbar__help-wrap"),
      sessionHelpButton: queryRequired(".pi-toolbar__help-button"),
      sessionHelpPopoverElement: queryRequired(".pi-toolbar__help-popover"),
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

  // src/webview/messages/ansi.ts
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

  // src/webview/messages/markdown.ts
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

  // src/webview/messages/renderMessages.ts
  var activityExpansion = /* @__PURE__ */ new Map();
  var activityBodyExpansion = /* @__PURE__ */ new Map();
  function toggleActivityBodyExpansion(activityId) {
    const next = !activityBodyExpansion.get(activityId);
    activityBodyExpansion.set(activityId, next);
    return next;
  }
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
      article.append(createActivityListElement(activities, messageIndex, options));
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
  function createActivityListElement(activities, messageIndex, options) {
    const list = document.createElement("div");
    list.className = "activity-list";
    for (const activity of activities) {
      list.append(createActivityElement(activity, messageIndex, options));
    }
    return list;
  }
  function createActivityElement(activity, messageIndex, options) {
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
      const bodyExpanded = Boolean(activityId && activityBodyExpansion.get(activityId) && activity.expandedBody);
      const bodyText = bodyExpanded && typeof activity.expandedBody === "string" ? activity.expandedBody : activity.body;
      const body = document.createElement(activity.code ? "pre" : "div");
      body.className = `activity__body${activity.code ? " activity__body--code" : " activity__body--markdown"}${bodyExpanded ? " activity__body--expanded" : ""}`;
      if (activity.code) {
        renderCodeActivityBody(body, activity, bodyText, {
          bodyExpanded,
          messageIndex,
          outputColors: options.outputColors !== false
        });
      } else {
        renderMarkdownInto(body, bodyText);
      }
      details.append(body);
      if (bodyExpanded && shouldScrollExpandedBodyToBottom(activity.body)) {
        scheduleActivityBodyScrollToBottom(body);
      }
    }
    return details;
  }
  function renderCodeActivityBody(element, activity, bodyText, options) {
    const activityId = typeof activity.id === "string" ? activity.id : "";
    const filePath = getReadActivityPath(activity, bodyText);
    const hasExpandedToggle = Boolean(options.bodyExpanded && activityId && typeof activity.expandedBody === "string");
    const marker = !options.bodyExpanded && activityId && typeof activity.expandedBody === "string" ? findTruncationMarker(bodyText) : void 0;
    if (filePath && !containsAnsiEscape(bodyText)) {
      renderHighlightedActivityCodeInto(element, bodyText, filePath, marker, activityId, options.messageIndex, hasExpandedToggle);
    } else {
      renderAnsiActivityCodeInto(element, bodyText, marker, activityId, options.messageIndex, options.outputColors);
    }
    if (hasExpandedToggle) {
      if (!bodyText.endsWith("\n")) {
        element.append(document.createTextNode("\n"));
      }
      appendActivityBodyToggle(element, "Show less", activityId, options.messageIndex, true);
    }
  }
  function getReadActivityPath(activity, bodyText) {
    if (activity.kind !== "tool_execution" || typeof activity.title !== "string" || containsAnsiEscape(bodyText)) {
      return void 0;
    }
    return parseReadActivityPath(activity.title);
  }
  function renderHighlightedActivityCodeInto(element, bodyText, filePath, marker, activityId, messageIndex, renderAsChild = false) {
    if (!marker) {
      if (renderAsChild) {
        element.replaceChildren();
        appendHighlightedCodeChunk(element, bodyText, filePath);
        return;
      }
      if (!renderHighlightedCodeInto(element, bodyText, filePath)) {
        element.textContent = bodyText;
      }
      return;
    }
    element.replaceChildren();
    appendHighlightedCodeChunk(element, marker.before, filePath);
    appendActivityBodyToggle(element, marker.text, activityId, messageIndex, false);
    appendHighlightedCodeChunk(element, marker.after, filePath);
  }
  function appendHighlightedCodeChunk(element, value, filePath) {
    if (!value) {
      return;
    }
    const code = document.createElement("code");
    if (!renderHighlightedCodeInto(code, value, filePath)) {
      code.textContent = value;
    }
    element.append(code);
  }
  function renderAnsiActivityCodeInto(element, bodyText, marker, activityId, messageIndex, outputColors) {
    if (!marker) {
      renderAnsiTextInto(element, bodyText, outputColors);
      return;
    }
    element.replaceChildren();
    appendAnsiCodeChunk(element, marker.before, outputColors);
    appendActivityBodyToggle(element, marker.text, activityId, messageIndex, false);
    appendAnsiCodeChunk(element, marker.after, outputColors);
  }
  function appendAnsiCodeChunk(element, value, outputColors) {
    if (!value) {
      return;
    }
    const chunk = document.createElement("span");
    renderAnsiTextInto(chunk, value, outputColors);
    element.append(...Array.from(chunk.childNodes));
  }
  function findTruncationMarker(value) {
    const markerPattern = /^\.\.\. \((?:\d+ (?:more|earlier)[^)]+|output truncated)\)$/m;
    const match = markerPattern.exec(value);
    if (!match || match.index === void 0) {
      return void 0;
    }
    const text = match[0];
    const markerStart = match.index;
    const markerEnd = markerStart + text.length;
    return {
      before: value.slice(0, markerStart),
      text,
      after: value.slice(markerEnd)
    };
  }
  function shouldScrollExpandedBodyToBottom(collapsedBody) {
    const marker = findTruncationMarker(collapsedBody);
    return Boolean(marker && marker.before.length === 0);
  }
  function scheduleActivityBodyScrollToBottom(element) {
    const scroll = () => {
      element.scrollTop = element.scrollHeight;
    };
    requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
    setTimeout(scroll, 80);
    setTimeout(scroll, 220);
  }
  function appendActivityBodyToggle(element, label, activityId, messageIndex, expanded) {
    const button = document.createElement("button");
    button.className = "activity__body-toggle";
    button.type = "button";
    button.textContent = label;
    button.title = expanded ? "Collapse output" : "Show full output";
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.dataset.activityBodyToggle = activityId;
    if (typeof messageIndex === "number") {
      button.dataset.messageIndex = String(messageIndex);
    }
    element.append(button);
  }
  function parseReadActivityPath(title) {
    const match = title.match(/^read\s+(.+?)(?::\d+(?:-\d+)?)?$/);
    return match?.[1];
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

  // src/webview/messages/messageList.ts
  var MessageListController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    renderedMessageViews = [];
    renderMessageList() {
      const state2 = this.options.getState();
      if (state2.messages.length === 0) {
        this.renderedMessageViews = [];
        this.options.messagesContentElement.replaceChildren(this.createEmptyStateElement());
        return;
      }
      if (this.options.messagesContentElement.querySelector(".empty-state")) {
        this.options.messagesContentElement.replaceChildren();
      }
      let previousMessageRole;
      for (const [index, message] of state2.messages.entries()) {
        const showRole = message.role !== previousMessageRole;
        const view = this.renderMessageAtIndex(index, message, showRole);
        const currentNode = this.options.messagesContentElement.children[index];
        if (currentNode !== view.element) {
          this.options.messagesContentElement.insertBefore(view.element, currentNode ?? null);
        }
        previousMessageRole = message.role;
      }
      for (let index = this.renderedMessageViews.length - 1; index >= state2.messages.length; index -= 1) {
        this.renderedMessageViews[index]?.element.remove();
      }
      this.renderedMessageViews.length = state2.messages.length;
      requestCodeHighlightsIn(this.options.messagesContentElement);
    }
    syncBusyStatus() {
      const state2 = this.options.getState();
      this.options.busyStatusElement.hidden = !state2.busy;
      if (!state2.busy) {
        return;
      }
      const nextText = this.getBusyStatusText();
      if (this.options.busyStatusTextElement.textContent !== nextText) {
        this.options.busyStatusTextElement.textContent = nextText;
      }
    }
    handleChatPageScroll(event) {
      const state2 = this.options.getState();
      if (state2.viewMode !== "chat" || event.key !== "PageUp" && event.key !== "PageDown") {
        return false;
      }
      if (event.altKey || event.metaKey || event.shiftKey) {
        return false;
      }
      const target = eventTargetElement2(event);
      if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "PageUp" ? -1 : 1;
      const amount = event.ctrlKey ? this.getTranscriptLineScrollAmount() : Math.max(80, Math.floor(this.options.messagesElement.clientHeight * 0.85));
      this.options.messagesElement.scrollBy({ top: direction * amount, behavior: "auto" });
      return true;
    }
    isMessagesAtBottom() {
      const distanceFromBottom = this.options.messagesElement.scrollHeight - this.options.messagesElement.scrollTop - this.options.messagesElement.clientHeight;
      return distanceFromBottom <= messagesBottomThreshold;
    }
    scrollMessagesToBottom() {
      this.options.messagesElement.scrollTop = this.options.messagesElement.scrollHeight;
    }
    scheduleMessagesToBottom() {
      this.scrollMessagesToBottomIfChat();
      requestAnimationFrame(() => {
        this.scrollMessagesToBottomIfChat();
        requestAnimationFrame(() => this.scrollMessagesToBottomIfChat());
      });
      setTimeout(() => this.scrollMessagesToBottomIfChat(), 80);
      setTimeout(() => this.scrollMessagesToBottomIfChat(), 220);
    }
    handleMessageClick(event) {
      const state2 = this.options.getState();
      const target = eventTargetElement2(event);
      const toggleButton = target?.closest("[data-activity-body-toggle]");
      if (toggleButton instanceof HTMLElement) {
        const activityId = toggleButton.dataset.activityBodyToggle;
        if (activityId) {
          event.preventDefault();
          event.stopPropagation();
          toggleActivityBodyExpansion(activityId);
          this.rerenderMessageAtIndex(parseDatasetInteger(toggleButton.dataset.messageIndex));
        }
        return;
      }
      const copyButton = target?.closest(".message__copy");
      if (copyButton instanceof HTMLElement) {
        const index = Number(copyButton.dataset.copyMessageIndex);
        const text = Number.isInteger(index) ? state2.messages[index]?.text : "";
        if (text) {
          event.preventDefault();
          this.options.postMessage({ type: "copyText", text });
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
      this.options.postMessage({
        type: "openFile",
        path: filePath,
        ...parseDatasetPositiveInteger(link.dataset.line, "line"),
        ...parseDatasetPositiveInteger(link.dataset.column, "column")
      });
    }
    createEmptyStateElement() {
      const state2 = this.options.getState();
      const empty = document.createElement("p");
      empty.className = "empty-state";
      if (!state2.sessionLoading) {
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
    renderMessageAtIndex(index, message, showRole) {
      const state2 = this.options.getState();
      const existingView = this.renderedMessageViews[index];
      const activitiesSignature = this.getActivitiesSignature(message);
      const copyable = canCopyAssistantMessage2(message);
      const animateFromText = this.getStreamingAnimationStartText(existingView, message, index);
      if (existingView && canReuseMessageElement(existingView, message, showRole, activitiesSignature, copyable)) {
        if ((existingView.message.text || "") !== (message.text || "")) {
          updateMessageBodyElement(
            existingView.element,
            message,
            {
              ...animateFromText === void 0 ? {} : { animateFromText },
              outputColors: state2.outputColors
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
            outputColors: state2.outputColors
          }
        ),
        message,
        showRole,
        activitiesSignature,
        copyable
      };
      existingView?.element.replaceWith(nextView.element);
      this.renderedMessageViews[index] = nextView;
      return nextView;
    }
    rerenderMessageAtIndex(index) {
      const state2 = this.options.getState();
      if (index === void 0 || !state2.messages[index]) {
        this.renderMessageList();
        return;
      }
      const existingView = this.renderedMessageViews[index];
      const previousMessage = index > 0 ? state2.messages[index - 1] : void 0;
      const showRole = state2.messages[index].role !== previousMessage?.role;
      const nextView = {
        element: createMessageElement(
          state2.messages[index],
          showRole,
          index,
          { outputColors: state2.outputColors }
        ),
        message: state2.messages[index],
        showRole,
        activitiesSignature: this.getActivitiesSignature(state2.messages[index]),
        copyable: canCopyAssistantMessage2(state2.messages[index])
      };
      existingView?.element.replaceWith(nextView.element);
      this.renderedMessageViews[index] = nextView;
      requestCodeHighlightsIn(nextView.element);
    }
    getStreamingAnimationStartText(existingView, message, index) {
      if (!existingView || !this.shouldAnimateStreamingAppend(existingView.message, message, index)) {
        return void 0;
      }
      return getMessageBodyVisibleText(existingView.element);
    }
    shouldAnimateStreamingAppend(previous, next, index) {
      const state2 = this.options.getState();
      const previousText = previous.text || "";
      const nextText = next.text || "";
      return state2.busy && index === state2.messages.length - 1 && previous.role === "assistant" && next.role === "assistant" && !previous.error && !next.error && previous.variant !== "thinking" && next.variant !== "thinking" && nextText.length > previousText.length && nextText.startsWith(previousText);
    }
    getActivitiesSignature(message) {
      const state2 = this.options.getState();
      if (!Array.isArray(message.activities) || message.activities.length === 0) {
        return "";
      }
      return JSON.stringify({ outputColors: state2.outputColors, activities: message.activities });
    }
    getBusyStatusText() {
      const activity = this.getLatestRunningActivity();
      if (!activity) {
        return "Pi is working...";
      }
      const title = typeof activity.title === "string" && activity.title ? activity.title : "Pi is working";
      const summary = typeof activity.summary === "string" && activity.summary ? ": " + activity.summary : "";
      return title + summary;
    }
    getLatestRunningActivity() {
      const state2 = this.options.getState();
      for (let messageIndex = state2.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = state2.messages[messageIndex];
        const activities = Array.isArray(message.activities) ? message.activities : [];
        for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
          if (activities[activityIndex]?.status === "running") {
            return activities[activityIndex];
          }
        }
      }
      return void 0;
    }
    getTranscriptLineScrollAmount() {
      return parseCssPixelValue2(getComputedStyle(this.options.messagesContentElement).lineHeight) || parseCssPixelValue2(getComputedStyle(this.options.messagesElement).lineHeight) || 20;
    }
    scrollMessagesToBottomIfChat() {
      if (this.options.getState().viewMode === "chat") {
        this.scrollMessagesToBottom();
      }
    }
  };
  function canReuseMessageElement(view, message, showRole, activitiesSignature, copyable) {
    return view.message.role === message.role && Boolean(view.message.error) === Boolean(message.error) && (view.message.variant || "") === (message.variant || "") && view.showRole === showRole && view.activitiesSignature === activitiesSignature && view.copyable === copyable;
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
  function parseDatasetPositiveInteger(value, key) {
    if (!value) {
      return {};
    }
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0) {
      return {};
    }
    return key === "line" ? { line: numberValue } : { column: numberValue };
  }
  function parseDatasetInteger(value) {
    if (!value) {
      return void 0;
    }
    const numberValue = Number(value);
    return Number.isInteger(numberValue) ? numberValue : void 0;
  }
  function parseCssPixelValue2(value) {
    return Number.parseFloat(value) || 0;
  }
  function eventTargetElement2(event) {
    return event.target instanceof Element ? event.target : null;
  }

  // src/webview/sessions/sessionFormat.ts
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

  // src/webview/sessions/sessionItemCommands.ts
  var sessionItemMenuCommands = ["rename", "fork", "clone", "compact", "export", "delete"];
  var sessionItemCommandIcons = {
    rename: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4.1 11.9L5.45 11.6L11.15 5.9C11.55 5.5 11.55 4.85 11.15 4.45L10.9 4.2C10.5 3.8 9.85 3.8 9.45 4.2L3.75 9.9L3.45 11.25C3.37 11.65 3.7 11.98 4.1 11.9Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.85 4.8L10.55 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
    fork: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><path d="M5.5 4.25V8.5C5.5 10.16 6.84 11.5 8.5 11.5H10.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 4.25V14.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M10.25 8.5L13.25 11.5L10.25 14.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.5" cy="4.25" r="1.55" fill="currentColor"/><circle cx="5.5" cy="14.75" r="1.55" fill="currentColor"/></svg>',
    clone: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><rect x="4.25" y="6.25" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.35"/><path d="M7.25 4.25H13.25C14.08 4.25 14.75 4.92 14.75 5.75V11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    compact: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3.5H3.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 3.5H12.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12.5H3.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 12.5H12.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.3 5.3L7.05 7.05M10.7 5.3L8.95 7.05M5.3 10.7L7.05 8.95M10.7 10.7L8.95 8.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    export: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3.5V10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M5.6 5.9L8 3.5L10.4 5.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.5V11.6C4 12.1 4.4 12.5 4.9 12.5H11.1C11.6 12.5 12 12.1 12 11.6V9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>',
    delete: '<svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M6 2h4l1 1h3v1H2V3h3l1-1Zm-2 3h8l-.6 9.2A2 2 0 0 1 9.4 16H6.6a2 2 0 0 1-2-1.8L4 5Zm2 1v8h1V6H6Zm3 0v8h1V6H9Z"/></svg>'
  };
  function parseSessionItemCommand(command) {
    return command === "rename" || command === "fork" || command === "clone" || command === "compact" || command === "export" || command === "delete" ? command : void 0;
  }
  function getSessionItemCommandLabel(command) {
    switch (command) {
      case "rename":
        return "Rename session";
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

  // src/webview/sessions/sessionElements.ts
  function createSessionItemElement(options) {
    const { session, index } = options;
    const item = document.createElement("div");
    item.id = "session-" + index;
    item.className = "sessions__item" + (index === options.selectedIndex ? " sessions__item--active" : "") + (session.current ? " sessions__item--current" : "") + (session.liveStatus ? " sessions__item--" + session.liveStatus : "") + (session.unread ? " sessions__item--unread" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === options.selectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    const prefix = document.createElement("span");
    prefix.className = "sessions__prefix";
    prefix.textContent = (session.liveStatus === "running" ? "\u25CF " : "") + buildSessionTreePrefix(session);
    item.append(prefix);
    const title = document.createElement("span");
    title.className = "sessions__title";
    if (options.nameEditPath === session.path) {
      title.append(createSessionListNameInput(options));
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
    item.append(createSessionItemMenuElement(options));
    return item;
  }
  function createTreeItemElement(treeItem, index, options) {
    const item = document.createElement("button");
    item.type = "button";
    item.id = "tree-" + index;
    item.className = "sessions__item" + (index === options.selectedIndex ? " sessions__item--active" : "") + (treeItem.current ? " sessions__item--current" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === options.selectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    item.disabled = options.disabled;
    const title = document.createElement("span");
    title.className = "sessions__title";
    title.textContent = treeItem.role + ": " + (treeItem.text || "(empty)");
    item.append(title);
    return item;
  }
  function createSessionListNameInput(options) {
    const input = document.createElement("input");
    input.className = "sessions__name-input";
    input.type = "text";
    input.value = options.nameEditInitialValue;
    input.placeholder = getSessionDisplayName(options.session);
    input.setAttribute("aria-label", "Session name");
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("blur", options.onNameInputBlur);
    return input;
  }
  function createSessionItemMenuElement(options) {
    const wrap = document.createElement("span");
    wrap.className = "sessions__menu-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sessions__menu-button";
    button.title = "Session commands";
    button.setAttribute("aria-label", "Session commands");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", options.openMenuIndex === options.index ? "true" : "false");
    button.disabled = !options.canRunSessionItemCommand(options.session);
    button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg>';
    wrap.append(button);
    const menu = document.createElement("span");
    menu.className = "sessions__menu";
    menu.setAttribute("role", "menu");
    menu.hidden = options.openMenuIndex !== options.index;
    for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
      const command = sessionItemMenuCommands[commandIndex];
      menu.append(createSessionItemMenuButton(command, commandIndex, options));
    }
    wrap.append(menu);
    return wrap;
  }
  function createSessionItemMenuButton(command, commandIndex, options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pi-toolbar__menu-item sessions__menu-item";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-session-command", command);
    button.setAttribute("data-session-command-index", String(commandIndex));
    button.disabled = !options.canRunSessionItemCommand(options.session, command);
    button.innerHTML = '<span class="pi-toolbar__menu-label">' + getSessionItemCommandLabel(command) + "</span>" + getSessionItemCommandIcon(command);
    button.addEventListener("pointerenter", () => options.onCommandActivate(commandIndex, button));
    button.addEventListener("pointerleave", () => options.onCommandHover(button, false));
    button.addEventListener("focus", () => options.onCommandActivate(commandIndex, button));
    button.addEventListener("blur", () => options.onCommandHover(button, false));
    return button;
  }

  // src/webview/sessions/sessionSearch.ts
  function getVisibleSessionIndexes(sessions, query, filter = {}) {
    if (sessions.length === 0) {
      return [];
    }
    const normalizedQuery = query.trim().toLowerCase();
    const indexes = [];
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      if (filter.namedOnly && !session.name?.trim()) {
        continue;
      }
      if (normalizedQuery && !getSessionDisplayName(session).toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      indexes.push(index);
    }
    return indexes;
  }
  function ensureVisibleSessionSelection(selectedIndex, visibleIndexes) {
    if (visibleIndexes.length === 0) {
      return 0;
    }
    return visibleIndexes.includes(selectedIndex) ? selectedIndex : visibleIndexes[0];
  }
  function moveVisibleSessionSelection(selectedIndex, visibleIndexes, delta) {
    if (visibleIndexes.length === 0) {
      return void 0;
    }
    const currentPosition = visibleIndexes.indexOf(selectedIndex);
    const nextPosition = currentPosition >= 0 ? Math.max(0, Math.min(currentPosition + delta, visibleIndexes.length - 1)) : delta > 0 ? 0 : visibleIndexes.length - 1;
    return visibleIndexes[nextPosition];
  }

  // src/webview/sessions/sessionUiHelpers.ts
  function createSessionEmptyElement(text) {
    const empty = document.createElement("div");
    empty.className = "sessions__empty";
    empty.textContent = text;
    return empty;
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
  function eventTargetElement3(event) {
    return event.target instanceof Element ? event.target : null;
  }

  // src/webview/sessions/sessionTreeController.ts
  var SessionTreeController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    selectedIndex = 0;
    render() {
      const state2 = this.options.getState();
      this.options.sessionsElement.replaceChildren();
      this.selectedIndex = this.clampIndex(this.selectedIndex);
      const header = document.createElement("div");
      header.className = "sessions__header";
      const count = Array.isArray(state2.treeItems) ? state2.treeItems.length : 0;
      header.textContent = state2.treeRefreshing ? "Loading session tree..." : count === 1 ? "1 tree entry" : count + " tree entries";
      this.options.sessionsElement.append(header);
      if (state2.treeError) {
        const error = document.createElement("div");
        error.className = "sessions__error";
        error.textContent = state2.treeError;
        this.options.sessionsElement.append(error);
      }
      if (state2.treeRefreshing && count === 0) {
        this.options.sessionsElement.append(createSessionEmptyElement("Loading session tree..."));
        return;
      }
      if (count === 0) {
        this.options.sessionsElement.append(createSessionEmptyElement("No persisted tree entries found for this session."));
        return;
      }
      for (let index = 0; index < state2.treeItems.length; index += 1) {
        this.options.sessionsElement.append(createTreeItemElement(state2.treeItems[index], index, {
          selectedIndex: this.selectedIndex,
          disabled: state2.busy || state2.treeRefreshing
        }));
      }
    }
    selectCurrent() {
      const state2 = this.options.getState();
      const currentIndex = Array.isArray(state2.treeItems) ? state2.treeItems.findIndex((item) => item.current) : -1;
      this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    }
    moveSelection(delta) {
      const state2 = this.options.getState();
      if (!Array.isArray(state2.treeItems) || state2.treeItems.length === 0) {
        return;
      }
      this.selectedIndex = this.clampIndex(this.selectedIndex + delta);
      this.render();
      document.getElementById("tree-" + this.selectedIndex)?.scrollIntoView({ block: "nearest" });
    }
    selectCurrentIndex() {
      this.selectIndex(this.selectedIndex);
    }
    selectIndex(index) {
      const state2 = this.options.getState();
      const treeItem = Array.isArray(state2.treeItems) ? state2.treeItems[index] : void 0;
      if (!treeItem?.entryId || state2.busy || state2.treeRefreshing) {
        return;
      }
      this.options.postMessage({ type: "selectTreeEntry", entryId: treeItem.entryId });
    }
    clampIndex(index) {
      const state2 = this.options.getState();
      const count = Array.isArray(state2.treeItems) ? state2.treeItems.length : 0;
      if (count === 0) {
        return 0;
      }
      return Math.max(0, Math.min(index, count - 1));
    }
  };

  // src/webview/sessions/topSessionControls.ts
  var TopSessionControls = class {
    constructor(options) {
      this.options = options;
    }
    options;
    sessionNameEditing = false;
    sessionNameEditInitialValue = "";
    get isSessionNameEditing() {
      return this.sessionNameEditing;
    }
    attachEventListeners() {
      this.options.sessionToggleButton.addEventListener("click", () => this.toggleSessionView());
      this.options.toolbarTitleElement.addEventListener("dblclick", (event) => this.startSessionNameEdit(event));
      this.options.sessionMenuButton.addEventListener("click", (event) => this.toggleSessionCommandMenu(event));
      this.options.sessionHelpButton.addEventListener("click", (event) => this.toggleSessionHelpPopover(event));
      for (const item of this.options.sessionMenuItemElements) {
        item.addEventListener("click", () => this.runSessionMenuCommand(item.getAttribute("data-session-command")));
        item.addEventListener("pointerenter", () => this.setSessionMenuItemHover(item, true));
        item.addEventListener("pointerleave", () => this.setSessionMenuItemHover(item, false));
        item.addEventListener("focus", () => this.setSessionMenuItemHover(item, true));
        item.addEventListener("blur", () => this.setSessionMenuItemHover(item, false));
      }
      this.options.sessionNameInputElement.addEventListener("blur", () => this.cancelSessionNameEdit());
    }
    handleGlobalKeydown(event) {
      if ((event.target === this.options.sessionToggleButton || event.target === this.options.sessionHelpButton) && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        event.target === this.options.sessionToggleButton ? this.toggleSessionView() : this.toggleSessionHelpPopover();
        return true;
      }
      if (this.hasSessionHelpPopoverOpen() && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSessionHelpPopover({ focusButton: true });
        return true;
      }
      if (!this.sessionNameEditing || event.target !== this.options.sessionNameInputElement) {
        return false;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.commitSessionNameEdit();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancelSessionNameEdit({ focusPrompt: true });
        return true;
      }
      return true;
    }
    syncForRender(isListView) {
      const state2 = this.options.getState();
      const toolbarTitle = state2.viewMode === "sessions" ? "Sessions" : state2.viewMode === "tree" ? "Session tree" : this.options.getCurrentSessionTitle();
      if ((isListView || state2.busy) && this.sessionNameEditing) {
        this.cancelSessionNameEdit();
      }
      this.options.toolbarTitleTextElement.textContent = toolbarTitle;
      this.options.toolbarTitleElement.title = toolbarTitle;
      this.options.toolbarTitleElement.classList.toggle("pi-toolbar__title--editing", this.sessionNameEditing);
      this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
      this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
      this.options.sessionMenuWrapElement.hidden = isListView;
      this.options.sessionHelpWrapElement.hidden = state2.viewMode !== "sessions";
      this.options.sessionMenuButton.disabled = state2.busy || this.sessionNameEditing;
      this.syncSessionCommandMenuItems();
      if (isListView || state2.busy || this.sessionNameEditing) {
        this.closeSessionCommandMenu();
      }
      if (state2.viewMode !== "sessions") {
        this.closeSessionHelpPopover();
      }
      this.options.sessionToggleButton.title = isListView ? "Back to chat" : "Show sessions";
      this.options.sessionToggleButton.setAttribute("aria-label", this.options.sessionToggleButton.title);
      this.options.sessionToggleButton.classList.toggle("pi-toolbar__sessions--back", isListView);
    }
    cancelSessionNameEdit(options = {}) {
      if (!this.sessionNameEditing) {
        return;
      }
      this.stopSessionNameEdit();
      if (options.focusPrompt) {
        this.options.focusPromptInput();
      }
    }
    closeSessionCommandMenu() {
      this.options.sessionMenuElement.hidden = true;
      this.options.sessionMenuButton.setAttribute("aria-expanded", "false");
      for (const item of this.options.sessionMenuItemElements) {
        this.setSessionMenuItemHover(item, false);
      }
    }
    closeSessionHelpPopover(options = {}) {
      if (this.options.sessionHelpPopoverElement.hidden) {
        return;
      }
      this.options.sessionHelpPopoverElement.hidden = true;
      this.options.sessionHelpButton.setAttribute("aria-expanded", "false");
      if (options.focusButton && !this.options.sessionHelpWrapElement.hidden) {
        this.options.sessionHelpButton.focus({ preventScroll: true });
      }
    }
    handleWindowClick(target) {
      if (!target || !this.options.sessionMenuWrapElement.contains(target)) {
        this.closeSessionCommandMenu();
      }
      if (!target || !this.options.sessionHelpWrapElement.contains(target)) {
        this.closeSessionHelpPopover();
      }
    }
    hasSessionCommandMenuOpen() {
      return !this.options.sessionMenuElement.hidden;
    }
    hasSessionHelpPopoverOpen() {
      return !this.options.sessionHelpPopoverElement.hidden;
    }
    startSessionNameEdit(event) {
      const state2 = this.options.getState();
      event?.preventDefault();
      event?.stopPropagation();
      if (state2.viewMode === "sessions" || state2.viewMode === "tree" || state2.busy) {
        return;
      }
      this.options.closeSlashMenu();
      this.options.closeModelMenu();
      this.closeSessionCommandMenu();
      const initialName = this.options.getCurrentSessionName();
      this.sessionNameEditing = true;
      this.sessionNameEditInitialValue = initialName;
      this.options.sessionNameInputElement.value = initialName;
      this.options.sessionNameInputElement.placeholder = initialName ? "" : this.options.getCurrentSessionTitle();
      this.syncSessionNameEditor();
      requestAnimationFrame(() => {
        this.options.sessionNameInputElement.focus({ preventScroll: true });
        this.options.sessionNameInputElement.select();
      });
    }
    commitSessionNameEdit() {
      if (!this.sessionNameEditing) {
        return;
      }
      const nextName = this.options.sessionNameInputElement.value.trim();
      const previousName = this.sessionNameEditInitialValue;
      this.stopSessionNameEdit();
      if (nextName !== previousName) {
        this.options.postMessage({ type: "setSessionName", name: nextName });
      }
      this.options.focusPromptInput();
    }
    stopSessionNameEdit() {
      this.sessionNameEditing = false;
      this.sessionNameEditInitialValue = "";
      this.options.sessionNameInputElement.value = "";
      this.options.sessionNameInputElement.placeholder = "";
      this.syncSessionNameEditor();
    }
    syncSessionNameEditor() {
      const state2 = this.options.getState();
      this.options.toolbarTitleElement.classList.toggle("pi-toolbar__title--editing", this.sessionNameEditing);
      this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
      this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
      this.options.sessionMenuButton.disabled = state2.busy || this.sessionNameEditing;
    }
    toggleSessionCommandMenu(event) {
      const state2 = this.options.getState();
      event?.preventDefault();
      event?.stopPropagation();
      if (state2.viewMode === "sessions" || state2.viewMode === "tree" || state2.busy || this.sessionNameEditing) {
        return;
      }
      this.options.closeSlashMenu();
      this.options.closeModelMenu();
      this.closeSessionHelpPopover();
      const isOpen = !this.options.sessionMenuElement.hidden;
      this.options.sessionMenuElement.hidden = isOpen;
      this.options.sessionMenuButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
    }
    toggleSessionHelpPopover(event) {
      const state2 = this.options.getState();
      event?.preventDefault();
      event?.stopPropagation();
      if (state2.viewMode !== "sessions") {
        return;
      }
      this.closeSessionCommandMenu();
      const isOpen = !this.options.sessionHelpPopoverElement.hidden;
      this.options.sessionHelpPopoverElement.hidden = isOpen;
      this.options.sessionHelpButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
    }
    syncSessionCommandMenuItems() {
      const state2 = this.options.getState();
      for (const item of this.options.sessionMenuItemElements) {
        const command = item.getAttribute("data-session-command");
        item.disabled = state2.busy || this.sessionNameEditing || command === "delete" && !this.options.getCurrentSessionPath();
      }
    }
    setSessionMenuItemHover(item, hovered) {
      item.classList.toggle("pi-toolbar__menu-item--hover", hovered);
    }
    runSessionMenuCommand(command) {
      if (command === "rename") {
        this.closeSessionCommandMenu();
        this.startSessionNameEdit();
        return;
      }
      if (command === "fork" || command === "clone") {
        this.closeSessionCommandMenu();
        this.options.runSessionSlashCommand(command);
        return;
      }
      if (command === "delete") {
        this.closeSessionCommandMenu();
        this.deleteCurrentSession();
        return;
      }
      if (command !== "reload" && command !== "compact" && command !== "export") {
        return;
      }
      this.closeSessionCommandMenu();
      this.options.postMessage({ type: "submit", text: "/" + command });
      this.options.focusPromptInput();
    }
    deleteCurrentSession() {
      const sessionPath = this.options.getCurrentSessionPath();
      if (!sessionPath) {
        return;
      }
      this.options.postMessage({ type: "deleteSession", sessionPath });
      this.options.focusPromptInput();
    }
    toggleSessionView() {
      const state2 = this.options.getState();
      this.cancelSessionNameEdit();
      if (state2.viewMode === "sessions" || state2.viewMode === "tree") {
        this.closeSessionHelpPopover();
        this.options.postMessage({ type: "hideSessions" });
        this.options.focusPromptInput();
        return;
      }
      this.options.postMessage({ type: "showSessions" });
    }
  };

  // src/webview/sessions/sessionView.ts
  var SessionViewController = class {
    constructor(options) {
      this.options = options;
      this.treeController = new SessionTreeController({
        getState: options.getState,
        postMessage: options.postMessage,
        sessionsElement: options.sessionsElement
      });
      this.topControls = new TopSessionControls({
        getState: options.getState,
        postMessage: options.postMessage,
        toolbarTitleElement: options.toolbarTitleElement,
        toolbarTitleTextElement: options.toolbarTitleTextElement,
        sessionNameInputElement: options.sessionNameInputElement,
        sessionToggleButton: options.sessionToggleButton,
        sessionMenuWrapElement: options.sessionMenuWrapElement,
        sessionMenuButton: options.sessionMenuButton,
        sessionMenuElement: options.sessionMenuElement,
        sessionMenuItemElements: options.sessionMenuItemElements,
        sessionHelpWrapElement: options.sessionHelpWrapElement,
        sessionHelpButton: options.sessionHelpButton,
        sessionHelpPopoverElement: options.sessionHelpPopoverElement,
        focusPromptInput: options.focusPromptInput,
        closeSlashMenu: options.closeSlashMenu,
        closeModelMenu: options.closeModelMenu,
        runSessionSlashCommand: options.runSessionSlashCommand,
        getCurrentSessionTitle: () => this.getCurrentSessionTitle(),
        getCurrentSessionName: () => this.getCurrentSessionName(),
        getCurrentSessionPath: () => this.getCurrentSessionPath()
      });
    }
    options;
    sessionListSelectedIndex = 0;
    sessionSearchQuery = "";
    sessionNamedOnlyFilter = false;
    sessionPointerHoverEnabled = false;
    openSessionListMenuIndex;
    openSessionListMenuCommandIndex = 0;
    sessionListNameEditPath;
    sessionListNameEditInitialValue = "";
    pendingSessionScrollIndex;
    pendingSessionScrollFrame;
    topControls;
    treeController;
    attachEventListeners() {
      this.topControls.attachEventListeners();
      this.options.sessionsElement.addEventListener("keydown", (event) => this.handleSessionListKeydown(event));
      this.options.sessionsElement.addEventListener("pointermove", () => this.enableSessionPointerHover());
      this.options.sessionsElement.addEventListener("click", (event) => this.handleSessionsClick(event));
    }
    handleWindowClick(target, eventTarget) {
      this.topControls.handleWindowClick(target);
      if (!target || !this.options.sessionsElement.contains(target) || !eventTarget?.closest(".sessions__menu-wrap")) {
        this.closeSessionItemMenus();
      }
    }
    handleGlobalKeydown(event) {
      if (this.topControls.handleGlobalKeydown(event)) {
        return true;
      }
      const state2 = this.options.getState();
      const target = eventTargetElement3(event);
      const sessionSearchInput = target?.closest(".sessions__search-input");
      if (sessionSearchInput instanceof HTMLInputElement && state2.viewMode === "sessions") {
        return this.handleSessionSearchKeydown(event, sessionSearchInput);
      }
      const namedOnlyFilterButton = target?.closest(".sessions__named-filter");
      if (namedOnlyFilterButton instanceof HTMLButtonElement && state2.viewMode === "sessions") {
        return this.handleNamedOnlyFilterKeydown(event);
      }
      const sessionListNameInput = target?.closest(".sessions__name-input");
      if (sessionListNameInput instanceof HTMLInputElement) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          this.commitSessionListNameEdit(sessionListNameInput.value);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.cancelSessionListNameEdit({ focusList: true });
          return true;
        }
        event.stopPropagation();
        return true;
      }
      return (state2.viewMode === "sessions" || state2.viewMode === "tree") && this.handleSessionListKeydown(event);
    }
    syncForRender(isListView) {
      const state2 = this.options.getState();
      if (state2.viewMode !== "sessions") {
        this.sessionSearchQuery = "";
        this.sessionNamedOnlyFilter = false;
        this.openSessionListMenuIndex = void 0;
        this.openSessionListMenuCommandIndex = 0;
        this.stopSessionListNameEdit();
      }
      this.topControls.syncForRender(isListView);
    }
    renderSessions() {
      const state2 = this.options.getState();
      const searchInput = this.isSessionSearchFocused() ? document.activeElement : void 0;
      const selectedIndex = searchInput ? -1 : this.sessionListSelectedIndex;
      const searchSelectionStart = searchInput?.selectionStart ?? null;
      const searchSelectionEnd = searchInput?.selectionEnd ?? null;
      const count = Array.isArray(state2.sessions) ? state2.sessions.length : 0;
      const visibleIndexes = this.getVisibleSessionIndexes();
      const filtersActive = this.hasActiveSessionListFilters();
      this.sessionListSelectedIndex = ensureVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes);
      this.options.sessionsElement.replaceChildren();
      const search = this.createSessionSearchElement();
      this.options.sessionsElement.append(search);
      const header = document.createElement("div");
      header.className = "sessions__header";
      if (this.openSessionListMenuIndex !== void 0 && !visibleIndexes.includes(this.openSessionListMenuIndex)) {
        this.openSessionListMenuIndex = void 0;
      }
      header.textContent = state2.sessionsRefreshing ? "Loading sessions..." : filtersActive && visibleIndexes.length !== count ? visibleIndexes.length + " of " + count + " sessions" : count === 1 ? "1 session" : count + " sessions";
      this.options.sessionsElement.append(header);
      if (state2.sessionsError) {
        const error = document.createElement("div");
        error.className = "sessions__error";
        error.textContent = state2.sessionsError;
        this.options.sessionsElement.append(error);
      }
      if (state2.sessionsRefreshing && count === 0) {
        this.options.sessionsElement.append(createSessionEmptyElement("Loading sessions..."));
      } else if (count === 0) {
        this.options.sessionsElement.append(createSessionEmptyElement("No sessions found for this workspace."));
      } else if (visibleIndexes.length === 0) {
        this.options.sessionsElement.append(createSessionEmptyElement(this.getSessionListEmptyText()));
      } else {
        for (const index of visibleIndexes) {
          this.options.sessionsElement.append(createSessionItemElement({
            session: state2.sessions[index],
            index,
            selectedIndex,
            nameEditPath: this.sessionListNameEditPath,
            nameEditInitialValue: this.sessionListNameEditInitialValue,
            openMenuIndex: this.openSessionListMenuIndex,
            canRunSessionItemCommand: (session, command) => this.canRunSessionItemCommand(session, command),
            onNameInputBlur: () => this.cancelSessionListNameEdit(),
            onCommandActivate: (commandIndex, button) => {
              this.openSessionListMenuCommandIndex = commandIndex;
              this.setSessionMenuItemHover(button, true);
            },
            onCommandHover: (button, hovered) => this.setSessionMenuItemHover(button, hovered)
          }));
        }
      }
      if (this.sessionListNameEditPath) {
        requestAnimationFrame(() => this.focusSessionListNameInput());
      } else if (searchInput) {
        this.focusSessionSearchInput({ select: false, selectionStart: searchSelectionStart, selectionEnd: searchSelectionEnd });
      }
    }
    renderTree() {
      this.treeController.render();
    }
    selectCurrentTreeEntry() {
      this.treeController.selectCurrent();
    }
    selectFirstVisibleSession() {
      this.sessionListSelectedIndex = this.getVisibleSessionIndexes()[0] ?? 0;
    }
    disableSessionPointerHover() {
      this.sessionPointerHoverEnabled = false;
      this.options.sessionsElement.classList.remove("sessions--pointer-hover");
    }
    stopSessionListNameEdit() {
      this.sessionListNameEditPath = void 0;
      this.sessionListNameEditInitialValue = "";
    }
    isSessionListNameEditing() {
      return Boolean(this.sessionListNameEditPath);
    }
    isSessionSearchFocused() {
      return document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains("sessions__search-input");
    }
    isSessionListNameEditingMissing() {
      const state2 = this.options.getState();
      return Boolean(this.sessionListNameEditPath && !state2.sessions.some((session) => session.path === this.sessionListNameEditPath));
    }
    hasSlashOrSessionUiOpen() {
      return {
        sessionCommandMenu: this.topControls.hasSessionCommandMenuOpen(),
        sessionNameEditing: this.topControls.isSessionNameEditing
      };
    }
    cancelSessionNameEdit(options = {}) {
      this.topControls.cancelSessionNameEdit(options);
    }
    closeSessionCommandMenu() {
      this.topControls.closeSessionCommandMenu();
    }
    closeSessionItemMenus() {
      if (this.openSessionListMenuIndex === void 0) {
        return;
      }
      this.openSessionListMenuIndex = void 0;
      this.openSessionListMenuCommandIndex = 0;
      for (const menu of this.options.sessionsElement.querySelectorAll(".sessions__menu")) {
        menu.hidden = true;
      }
      for (const button of this.options.sessionsElement.querySelectorAll(".sessions__menu-button")) {
        button.setAttribute("aria-expanded", "false");
      }
    }
    handleSessionsClick(event) {
      const state2 = this.options.getState();
      const target = eventTargetElement3(event);
      const sessionMenuButton2 = target?.closest(".sessions__menu-button");
      if (sessionMenuButton2) {
        event.preventDefault();
        event.stopPropagation();
        const item2 = sessionMenuButton2.closest(".sessions__item");
        const index2 = Number(item2?.getAttribute("data-index"));
        this.toggleSessionItemMenu(index2);
        return;
      }
      const sessionMenuItem = target?.closest(".sessions__menu-item");
      if (sessionMenuItem) {
        event.preventDefault();
        event.stopPropagation();
        const item2 = sessionMenuItem.closest(".sessions__item");
        const index2 = Number(item2?.getAttribute("data-index"));
        this.runSessionItemMenuCommand(index2, sessionMenuItem.getAttribute("data-session-command"));
        return;
      }
      const item = target?.closest(".sessions__item");
      if (!item) {
        this.closeSessionItemMenus();
        return;
      }
      this.closeSessionItemMenus();
      const index = Number(item.getAttribute("data-index"));
      state2.viewMode === "tree" ? this.treeController.selectIndex(index) : this.selectSessionIndex(index);
    }
    getCurrentSessionTitle() {
      const state2 = this.options.getState();
      const session = this.getCurrentSession();
      if (session) {
        return getSessionDisplayName(session);
      }
      if (state2.currentSessionName) {
        return state2.currentSessionName;
      }
      if (state2.currentSessionFile) {
        return "Current session";
      }
      return state2.messages.length === 0 ? "New session" : "Current session";
    }
    getCurrentSession() {
      const state2 = this.options.getState();
      if (!Array.isArray(state2.sessions) || state2.sessions.length === 0) {
        return void 0;
      }
      return (state2.currentSessionFile ? state2.sessions.find((session) => session.path === state2.currentSessionFile) : void 0) ?? state2.sessions.find((session) => session.current);
    }
    handleSessionListKeydown(event) {
      const state2 = this.options.getState();
      if (eventTargetElement3(event)?.closest(".sessions__search-input")) {
        return false;
      }
      if (state2.viewMode !== "sessions" && state2.viewMode !== "tree") {
        return false;
      }
      if (this.openSessionListMenuIndex !== void 0 && this.handleSessionItemMenuKeydown(event)) {
        return true;
      }
      if (event.key === "Escape") {
        this.hideSessionList(event);
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSessionItemMenus();
        state2.viewMode === "tree" ? this.treeController.moveSelection(1) : this.moveSessionSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSessionItemMenus();
        state2.viewMode === "tree" ? this.treeController.moveSelection(-1) : this.moveSessionSelectionUpOrFocusSearch();
        return true;
      }
      if (state2.viewMode === "sessions" && event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        this.openSessionItemMenu(this.sessionListSelectedIndex, { focusMenu: true });
        return true;
      }
      if (state2.viewMode === "sessions" && this.handleSessionListCommandKey(event)) {
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        state2.viewMode === "tree" ? this.treeController.selectCurrentIndex() : this.selectSessionIndex(this.sessionListSelectedIndex);
        return true;
      }
      if (state2.viewMode === "sessions" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        event.stopPropagation();
        this.deleteSessionIndex(this.sessionListSelectedIndex);
        return true;
      }
      return false;
    }
    hideSessionList(event) {
      event.preventDefault();
      event.stopPropagation();
      this.options.postMessage({ type: "hideSessions" });
      this.options.focusPromptInput();
    }
    enableSessionPointerHover() {
      if (this.sessionPointerHoverEnabled) {
        return;
      }
      this.sessionPointerHoverEnabled = true;
      this.options.sessionsElement.classList.add("sessions--pointer-hover");
    }
    moveSessionSelection(delta) {
      const visibleIndexes = this.getVisibleSessionIndexes();
      if (visibleIndexes.length === 0) {
        return;
      }
      const nextIndex = moveVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes, delta);
      if (nextIndex === void 0) {
        return;
      }
      const previousIndex = this.sessionListSelectedIndex;
      if (nextIndex === previousIndex) {
        return;
      }
      this.sessionListSelectedIndex = nextIndex;
      this.updateRenderedSessionSelection(previousIndex);
      this.scheduleSessionSelectionIntoView(nextIndex);
    }
    moveSessionSelectionUpOrFocusSearch() {
      const visibleIndexes = this.getVisibleSessionIndexes();
      if (visibleIndexes.length === 0 || this.sessionListSelectedIndex === visibleIndexes[0]) {
        this.focusSessionSearchInput({ reveal: true });
        return;
      }
      this.moveSessionSelection(-1);
    }
    updateRenderedSessionSelection(previousIndex) {
      this.updateRenderedSessionItemSelection(previousIndex, false);
      this.updateRenderedSessionItemSelection(this.sessionListSelectedIndex, true);
    }
    updateRenderedSessionItemSelection(index, selected) {
      const item = document.getElementById("session-" + index);
      if (!item) {
        return;
      }
      item.classList.toggle("sessions__item--active", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    }
    scheduleSessionSelectionIntoView(index) {
      this.pendingSessionScrollIndex = index;
      if (this.pendingSessionScrollFrame !== void 0) {
        return;
      }
      this.pendingSessionScrollFrame = requestAnimationFrame(() => {
        const scrollIndex = this.pendingSessionScrollIndex;
        this.pendingSessionScrollIndex = void 0;
        this.pendingSessionScrollFrame = void 0;
        if (scrollIndex === void 0) {
          return;
        }
        document.getElementById("session-" + scrollIndex)?.scrollIntoView({ block: "nearest" });
      });
    }
    cancelPendingSessionSelectionScroll() {
      if (this.pendingSessionScrollFrame !== void 0) {
        cancelAnimationFrame(this.pendingSessionScrollFrame);
      }
      this.pendingSessionScrollIndex = void 0;
      this.pendingSessionScrollFrame = void 0;
    }
    selectSessionIndex(index) {
      const state2 = this.options.getState();
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!session?.path || !this.isSessionIndexVisible(index)) {
        return;
      }
      this.options.postMessage({ type: "selectSession", sessionPath: session.path });
    }
    deleteSessionIndex(index) {
      const state2 = this.options.getState();
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!session?.path || !this.isSessionIndexVisible(index) || !this.canDeleteSession(session)) {
        return;
      }
      this.options.postMessage({ type: "deleteSession", sessionPath: session.path });
    }
    toggleSessionItemMenu(index) {
      if (this.openSessionListMenuIndex === index) {
        this.closeSessionItemMenus();
        return;
      }
      this.openSessionItemMenu(index, { focusMenu: true });
    }
    openSessionItemMenu(index, options = {}) {
      const state2 = this.options.getState();
      if (!Number.isInteger(index) || index < 0 || state2.viewMode !== "sessions" || !this.isSessionIndexVisible(index)) {
        return;
      }
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!session || !this.canRunSessionItemCommand(session)) {
        return;
      }
      this.sessionListSelectedIndex = this.clampSessionIndex(index);
      this.openSessionListMenuIndex = this.sessionListSelectedIndex;
      this.openSessionListMenuCommandIndex = this.getFirstEnabledSessionItemMenuCommandIndex(session);
      this.renderSessions();
      document.getElementById("session-" + this.sessionListSelectedIndex)?.scrollIntoView({ block: "nearest" });
      if (options.focusMenu) {
        requestAnimationFrame(() => this.focusSessionItemMenuCommand(this.openSessionListMenuIndex, this.openSessionListMenuCommandIndex));
      }
    }
    handleSessionItemMenuKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSessionItemMenus();
        this.options.sessionsElement.focus({ preventScroll: true });
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.moveSessionItemMenuSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.moveSessionItemMenuSelection(-1);
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
        const focusedCommand = eventTargetElement3(event)?.closest(".sessions__menu-item")?.getAttribute("data-session-command");
        this.runOpenSessionItemMenuCommand(focusedCommand ?? sessionItemMenuCommands[this.openSessionListMenuCommandIndex]);
        return true;
      }
      return false;
    }
    moveSessionItemMenuSelection(delta) {
      if (this.openSessionListMenuIndex === void 0) {
        return;
      }
      const state2 = this.options.getState();
      const session = Array.isArray(state2.sessions) ? state2.sessions[this.openSessionListMenuIndex] : void 0;
      const enabledIndexes = this.getEnabledSessionItemMenuCommandIndexes(session);
      if (enabledIndexes.length === 0) {
        return;
      }
      const currentPosition = enabledIndexes.indexOf(this.openSessionListMenuCommandIndex);
      const nextPosition = currentPosition >= 0 ? (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length : delta > 0 ? 0 : enabledIndexes.length - 1;
      this.openSessionListMenuCommandIndex = enabledIndexes[nextPosition];
      this.focusSessionItemMenuCommand(this.openSessionListMenuIndex, this.openSessionListMenuCommandIndex);
    }
    focusSessionItemMenuCommand(sessionIndex, commandIndex) {
      if (sessionIndex === void 0) {
        return;
      }
      const item = document.getElementById("session-" + sessionIndex);
      const commandButton = item?.querySelector('.sessions__menu-item[data-session-command-index="' + commandIndex + '"]:not(:disabled)') ?? item?.querySelector(".sessions__menu-item:not(:disabled)");
      commandButton?.focus({ preventScroll: true });
    }
    runOpenSessionItemMenuCommand(command) {
      if (this.openSessionListMenuIndex === void 0) {
        return;
      }
      this.runSessionItemMenuCommand(this.openSessionListMenuIndex, typeof command === "string" ? command : null);
    }
    getFirstEnabledSessionItemMenuCommandIndex(session) {
      return this.getEnabledSessionItemMenuCommandIndexes(session)[0] ?? 0;
    }
    getEnabledSessionItemMenuCommandIndexes(session) {
      if (!session) {
        return [];
      }
      const indexes = [];
      for (let index = 0; index < sessionItemMenuCommands.length; index += 1) {
        if (this.canRunSessionItemCommand(session, sessionItemMenuCommands[index])) {
          indexes.push(index);
        }
      }
      return indexes;
    }
    runSessionItemMenuCommand(index, command) {
      const state2 = this.options.getState();
      const parsedCommand = parseSessionItemCommand(command);
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!parsedCommand || !session?.path || !this.isSessionIndexVisible(index) || !this.canRunSessionItemCommand(session, parsedCommand)) {
        return;
      }
      this.closeSessionItemMenus();
      if (parsedCommand === "delete") {
        this.options.postMessage({ type: "deleteSession", sessionPath: session.path });
        return;
      }
      if (parsedCommand === "rename") {
        this.startSessionListNameEdit(index);
        return;
      }
      this.options.postMessage({ type: "sessionItemCommand", sessionPath: session.path, command: parsedCommand });
    }
    startSessionListNameEdit(index) {
      const state2 = this.options.getState();
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!session?.path || !this.canRunSessionItemCommand(session, "rename")) {
        return;
      }
      this.sessionListSelectedIndex = this.clampSessionIndex(index);
      this.sessionListNameEditPath = session.path;
      this.sessionListNameEditInitialValue = session.name?.trim() ?? "";
      this.closeSessionItemMenus();
      this.renderSessions();
    }
    commitSessionListNameEdit(name) {
      const sessionPath = this.sessionListNameEditPath;
      if (!sessionPath) {
        return;
      }
      const nextName = name.trim();
      const previousName = this.sessionListNameEditInitialValue.trim();
      this.stopSessionListNameEdit();
      this.renderSessions();
      if (nextName === previousName) {
        return;
      }
      this.options.postMessage({ type: "setSessionItemName", sessionPath, name: nextName });
    }
    cancelSessionListNameEdit(options = {}) {
      if (!this.sessionListNameEditPath) {
        return;
      }
      this.stopSessionListNameEdit();
      this.renderSessions();
      if (options.focusList) {
        requestAnimationFrame(() => this.options.sessionsElement.focus({ preventScroll: true }));
      }
    }
    focusSessionListNameInput() {
      const input = this.options.sessionsElement.querySelector(".sessions__name-input");
      input?.focus({ preventScroll: true });
      input?.select();
    }
    createSessionSearchElement() {
      const wrap = document.createElement("div");
      wrap.className = "sessions__search";
      const input = document.createElement("input");
      input.className = "sessions__search-input";
      input.type = "search";
      input.value = this.sessionSearchQuery;
      input.placeholder = "Search sessions";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Search sessions");
      input.addEventListener("input", () => this.updateSessionSearchQuery(input.value, input.selectionStart, input.selectionEnd));
      input.addEventListener("focus", () => this.handleSessionSearchFocus());
      input.addEventListener("blur", () => this.handleSessionSearchBlur());
      input.addEventListener("click", (event) => event.stopPropagation());
      wrap.append(input);
      const namedOnlyButton = document.createElement("button");
      namedOnlyButton.className = "sessions__named-filter";
      namedOnlyButton.classList.toggle("sessions__named-filter--active", this.sessionNamedOnlyFilter);
      namedOnlyButton.type = "button";
      namedOnlyButton.innerHTML = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.75 2.5H8.6C8.95 2.5 9.29 2.64 9.54 2.89L13.1 6.45C13.62 6.97 13.62 7.81 13.1 8.33L8.33 13.1C7.81 13.62 6.97 13.62 6.45 13.1L2.89 9.54C2.64 9.29 2.5 8.95 2.5 8.6V3.75C2.5 3.06 3.06 2.5 3.75 2.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="5.65" cy="5.65" r="1" fill="currentColor"/><path d="M7.35 8.3H10.7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
      namedOnlyButton.title = "Filter to named sessions";
      namedOnlyButton.setAttribute("aria-label", "Filter to named sessions");
      namedOnlyButton.setAttribute("aria-pressed", this.sessionNamedOnlyFilter ? "true" : "false");
      namedOnlyButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleNamedOnlyFilter();
      });
      wrap.append(namedOnlyButton);
      return wrap;
    }
    handleSessionSearchFocus() {
      this.disableSessionPointerHover();
      this.setSessionListHighlightEnabled(false);
    }
    handleSessionSearchBlur() {
      this.setSessionListHighlightEnabled(true);
    }
    setSessionListHighlightEnabled(enabled) {
      const activeItem = document.getElementById("session-" + this.sessionListSelectedIndex);
      for (const item of this.options.sessionsElement.querySelectorAll(".sessions__item")) {
        const isActive = enabled && item === activeItem;
        item.classList.toggle("sessions__item--active", isActive);
        item.setAttribute("aria-selected", isActive ? "true" : "false");
      }
    }
    updateSessionSearchQuery(value, selectionStart, selectionEnd) {
      if (value === this.sessionSearchQuery) {
        return;
      }
      this.sessionSearchQuery = value;
      this.closeSessionItemMenus();
      this.renderSessions();
      requestAnimationFrame(() => {
        const input = this.options.sessionsElement.querySelector(".sessions__search-input");
        input?.focus({ preventScroll: true });
        if (input && selectionStart !== null) {
          input.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
        }
      });
    }
    handleSessionSearchKeydown(event, input) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.focusFirstVisibleSession();
        return true;
      }
      if (event.key === "Escape") {
        if (input.value.length > 0 || this.sessionSearchQuery.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          this.updateSessionSearchQuery("", 0, 0);
          return true;
        }
        this.hideSessionList(event);
        return true;
      }
      event.stopPropagation();
      this.sessionSearchQuery = input.value;
      return true;
    }
    focusFirstVisibleSession() {
      const firstVisibleIndex = this.getVisibleSessionIndexes()[0];
      if (firstVisibleIndex === void 0) {
        return;
      }
      this.sessionListSelectedIndex = firstVisibleIndex;
      this.closeSessionItemMenus();
      this.renderSessions();
      requestAnimationFrame(() => {
        this.options.sessionsElement.focus({ preventScroll: true });
        this.setSessionListHighlightEnabled(true);
        document.getElementById("session-" + firstVisibleIndex)?.scrollIntoView({ block: "nearest" });
      });
    }
    focusSessionSearchInput(options = {}) {
      const input = this.options.sessionsElement.querySelector(".sessions__search-input");
      if (options.reveal) {
        this.cancelPendingSessionSelectionScroll();
        this.options.sessionsElement.scrollTop = 0;
      }
      input?.focus({ preventScroll: true });
      if (!input) {
        return;
      }
      if (options.select ?? true) {
        input.select();
        return;
      }
      if (options.selectionStart !== null && options.selectionStart !== void 0) {
        input.setSelectionRange(options.selectionStart, options.selectionEnd ?? options.selectionStart);
      }
    }
    handleNamedOnlyFilterKeydown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        this.toggleNamedOnlyFilter();
        return true;
      }
      return false;
    }
    toggleNamedOnlyFilter() {
      this.sessionNamedOnlyFilter = !this.sessionNamedOnlyFilter;
      this.closeSessionItemMenus();
      this.renderSessions();
    }
    hasActiveSessionListFilters() {
      return Boolean(this.sessionSearchQuery.trim()) || this.sessionNamedOnlyFilter;
    }
    getSessionListEmptyText() {
      if (this.sessionNamedOnlyFilter && this.sessionSearchQuery.trim()) {
        return "No named sessions match your search.";
      }
      if (this.sessionNamedOnlyFilter) {
        return "No named sessions found.";
      }
      return "No sessions match your search.";
    }
    handleSessionListCommandKey(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      const command = getSessionListCommandForKey(event.key);
      if (!command) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      this.runSessionItemMenuCommand(this.sessionListSelectedIndex, command);
      return true;
    }
    canRunSessionItemCommand(session, command) {
      const state2 = this.options.getState();
      if (command === "delete") {
        return this.canDeleteSession(session);
      }
      return session.liveStatus !== "running" && !(session.current && state2.busy);
    }
    canDeleteSession(session) {
      const state2 = this.options.getState();
      return session.liveStatus !== "running" && !(session.current && state2.busy);
    }
    getVisibleSessionIndexes() {
      const state2 = this.options.getState();
      return getVisibleSessionIndexes(Array.isArray(state2.sessions) ? state2.sessions : [], this.sessionSearchQuery, {
        namedOnly: this.sessionNamedOnlyFilter
      });
    }
    isSessionIndexVisible(index) {
      return this.getVisibleSessionIndexes().includes(index);
    }
    clampSessionIndex(index) {
      const state2 = this.options.getState();
      const count = Array.isArray(state2.sessions) ? state2.sessions.length : 0;
      if (count === 0) {
        return 0;
      }
      return Math.max(0, Math.min(index, count - 1));
    }
    setSessionMenuItemHover(item, hovered) {
      item.classList.toggle("pi-toolbar__menu-item--hover", hovered);
    }
    getCurrentSessionName() {
      const state2 = this.options.getState();
      return (this.getCurrentSession()?.name ?? state2.currentSessionName ?? "").trim();
    }
    getCurrentSessionPath() {
      const state2 = this.options.getState();
      return (this.getCurrentSession()?.path ?? state2.currentSessionFile ?? "").trim();
    }
  };

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
      addedLines: normalizeDiffLineCount2(value.addedLines),
      removedLines: normalizeDiffLineCount2(value.removedLines)
    };
  }
  function normalizeDiffLineCount2(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null;
  }

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
    sessionHelpWrapElement,
    sessionHelpButton,
    sessionHelpPopoverElement,
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
  var toastHideTimeout;
  var sessionsController;
  var messagesController = new MessageListController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    messagesElement,
    messagesContentElement,
    busyStatusElement,
    busyStatusTextElement
  });
  var composerController = new ComposerController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    refreshMetadata,
    form,
    textarea,
    submitButton,
    newSessionButton,
    busySubmitElement,
    diffSummaryElement,
    diffAddedElement,
    diffRemovedElement,
    streamingBehaviorButtonElements,
    slashMenuElement,
    contextBadgesElement,
    contextElement,
    contextValueElement,
    contextTooltipElement,
    modelElement,
    modelMenuElement,
    modelSelectElement,
    thinkingSelectElement,
    focusPromptInput,
    cancelSessionNameEdit: () => sessionsController.cancelSessionNameEdit(),
    closeSessionCommandMenu: () => sessionsController.closeSessionCommandMenu(),
    isMessagesAtBottom: () => messagesController.isMessagesAtBottom(),
    scrollMessagesToBottom: () => messagesController.scrollMessagesToBottom()
  });
  sessionsController = new SessionViewController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    sessionsElement,
    toolbarTitleElement,
    toolbarTitleTextElement,
    sessionNameInputElement,
    sessionToggleButton,
    sessionMenuWrapElement,
    sessionMenuButton,
    sessionMenuElement,
    sessionMenuItemElements,
    sessionHelpWrapElement,
    sessionHelpButton,
    sessionHelpPopoverElement,
    focusPromptInput,
    closeSlashMenu: () => composerController.closeSlashMenu(),
    closeModelMenu: () => composerController.closeModelMenu(),
    runSessionSlashCommand: (command) => composerController.runSessionSlashCommand(command)
  });
  composerController.attachEventListeners();
  sessionsController.attachEventListeners();
  newSessionButton.addEventListener("click", startNewSession);
  diffSummaryElement.addEventListener("click", showCurrentChanges);
  messagesElement.addEventListener("click", (event) => messagesController.handleMessageClick(event));
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
      sessionsController.disableSessionPointerHover();
    }
    if (state.viewMode === "sessions" && (previousViewMode !== "sessions" || previousCurrentSessionFile !== state.currentSessionFile || previousSessionCount === 0)) {
      sessionsController.selectFirstVisibleSession();
    }
    if (state.viewMode === "tree" && (previousViewMode !== "tree" || previousTreeCount === 0)) {
      sessionsController.selectCurrentTreeEntry();
    }
    if (sessionsController.isSessionListNameEditingMissing()) {
      sessionsController.stopSessionListNameEdit();
    }
    render();
    composerController.applyComposerTextFromState();
    if (wasListView && state.viewMode === "chat") {
      messagesController.scheduleMessagesToBottom();
      focusPromptInput();
    }
  });
  window.addEventListener("click", (event) => {
    const target = eventTargetNode(event);
    composerController.handleWindowClick(target);
    sessionsController.handleWindowClick(target, eventTargetElement4(event));
  });
  window.addEventListener("keydown", (event) => {
    if (sessionsController.handleGlobalKeydown(event)) {
      return;
    }
    if (event.key === "Escape" && handleChatEscape(event)) {
      return;
    }
    if (messagesController.handleChatPageScroll(event)) {
      return;
    }
    if (!isNewSessionShortcut(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startNewSession();
  }, true);
  window.addEventListener("resize", () => {
    render();
    composerController.syncComposer({ preserveBottom: true });
  });
  function showCurrentChanges() {
    vscode.postMessage({ type: "showCurrentChanges" });
    focusPromptInput();
  }
  function refreshMetadata() {
    vscode.postMessage({ type: "refreshMetadata" });
  }
  function showToast(message) {
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
    const shouldStickToBottom = !isListView && messagesController.isMessagesAtBottom();
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
    sessionsController.syncForRender(isListView);
    if (isListView) {
      busyStatusElement.hidden = true;
      state.viewMode === "tree" ? sessionsController.renderTree() : sessionsController.renderSessions();
      composerController.closeSlashMenu();
      composerController.closeModelMenu();
      sessionsController.closeSessionCommandMenu();
      sessionsController.cancelSessionNameEdit();
      if (!sessionsController.isSessionListNameEditing() && !sessionsController.isSessionSearchFocused()) {
        requestAnimationFrame(() => sessionsElement.focus({ preventScroll: true }));
      }
      return;
    }
    messagesController.renderMessageList();
    messagesController.syncBusyStatus();
    composerController.syncModelLabel();
    composerController.syncPromptContextBadges();
    composerController.syncComposer();
    composerController.syncSlashMenu();
    if (shouldStickToBottom) {
      messagesController.scrollMessagesToBottom();
    }
  }
  function handleChatEscape(event) {
    const hadSlashMenu = composerController.hasSlashMenuOpen();
    const hadModelMenu = composerController.hasModelMenuOpen();
    const sessionUiState = sessionsController.hasSlashOrSessionUiOpen();
    if (hadSlashMenu) {
      composerController.dismissSlashMenu();
    }
    if (hadModelMenu) {
      composerController.closeModelMenu();
    }
    if (sessionUiState.sessionCommandMenu) {
      sessionsController.closeSessionCommandMenu();
    }
    if (sessionUiState.sessionNameEditing) {
      sessionsController.cancelSessionNameEdit();
    }
    if (hadSlashMenu || hadModelMenu || sessionUiState.sessionCommandMenu || sessionUiState.sessionNameEditing) {
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
  function startNewSession() {
    sessionsController.cancelSessionNameEdit();
    vscode.postMessage({ type: "newSession" });
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
  function eventTargetElement4(event) {
    return event.target instanceof Element ? event.target : null;
  }
  function eventTargetNode(event) {
    return event.target instanceof Node ? event.target : null;
  }
  vscode.postMessage({ type: "ready" });
  render();
})();
