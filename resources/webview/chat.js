"use strict";
(() => {
  // src/webview/chatLaneLayout.ts
  function getChatLaneLayout(state2) {
    const isSessionLane = state2.lane === "sessions" || state2.lane === "tree";
    const isSettingsFaceVisible = !isSessionLane && state2.chatFace === "settings";
    return {
      isSessionLane,
      isSettingsFaceVisible,
      hiddenBySurface: isSessionLane || isSettingsFaceVisible,
      reserveBottomSurfaceLayout: isSessionLane
    };
  }

  // src/shared/typeGuards.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  // src/webview/codeHighlighting.ts
  var maxHighlightCodeLength = 2e5;
  var maxCachedHighlightCodeLength = 5e4;
  var maxHighlightCacheBytes = 4 * 1024 * 1024;
  var highlightedElements = /* @__PURE__ */ new Map();
  var pendingHighlights = /* @__PURE__ */ new Map();
  var highlightHtmlCache = /* @__PURE__ */ new Map();
  var highlightHtmlCacheSizeBytes = 0;
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
    const cacheKey = isCacheableHighlightCode(code) ? getHighlightCacheKey(code, normalizedLanguage, themeId) : void 0;
    const cached = cacheKey ? highlightHtmlCache.get(cacheKey) : void 0;
    if (cacheKey && cached) {
      highlightHtmlCache.delete(cacheKey);
      highlightHtmlCache.set(cacheKey, cached);
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
    element.classList.add("tauren-shiki-pending");
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
  function pruneDisconnectedCodeHighlights() {
    for (const [element, info] of Array.from(highlightedElements.entries())) {
      if (!element.isConnected) {
        highlightedElements.delete(element);
        pendingHighlights.delete(info.requestId);
      }
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
    if (sanitizedHtml && isCacheableHighlightCode(info.code)) {
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
    element.classList.remove("tauren-shiki-pending");
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
    element.classList.remove("tauren-shiki-pending");
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
    const sizeBytes = estimateCachedHighlightBytes(cacheKey, html);
    if (sizeBytes > maxHighlightCacheBytes) {
      deleteHighlightHtmlCacheEntry(cacheKey);
      return;
    }
    deleteHighlightHtmlCacheEntry(cacheKey);
    highlightHtmlCache.set(cacheKey, { html, sizeBytes });
    highlightHtmlCacheSizeBytes += sizeBytes;
    while (highlightHtmlCacheSizeBytes > maxHighlightCacheBytes) {
      const oldestKey = highlightHtmlCache.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      deleteHighlightHtmlCacheEntry(oldestKey);
    }
  }
  function deleteHighlightHtmlCacheEntry(cacheKey) {
    const cached = highlightHtmlCache.get(cacheKey);
    if (!cached) {
      return;
    }
    highlightHtmlCache.delete(cacheKey);
    highlightHtmlCacheSizeBytes -= cached.sizeBytes;
  }
  function isCacheableHighlightCode(code) {
    return code.length <= maxCachedHighlightCodeLength;
  }
  function estimateCachedHighlightBytes(cacheKey, html) {
    return estimateStringBytes(cacheKey) + estimateStringBytes(html);
  }
  function estimateStringBytes(value) {
    return value.length * 2;
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

  // src/webview/extensionRenderBlocks.ts
  function normalizeExtensionRenderBlocks(blocks, fallbackLines) {
    if (Array.isArray(blocks)) {
      const normalized = blocks.map(normalizeExtensionRenderBlock).filter((block) => Boolean(block));
      if (normalized.length > 0) {
        return normalized;
      }
    }
    return fallbackLines.length > 0 ? [{ type: "text", lines: fallbackLines }] : [];
  }
  function createExtensionImageElement(block) {
    const wrapper = document.createElement("div");
    wrapper.className = "extension-render-image";
    if (block.cellWidthPx && block.cellHeightPx) {
      wrapper.style.width = `${block.columns * block.cellWidthPx}px`;
      wrapper.style.height = `${block.rows * block.cellHeightPx}px`;
    } else {
      wrapper.style.width = `calc(${block.columns} * 1ch)`;
      wrapper.style.height = `calc(${block.rows} * 1lh)`;
    }
    if (block.indentColumns && block.indentColumns > 0) {
      wrapper.style.marginLeft = block.cellWidthPx ? `${block.indentColumns * block.cellWidthPx}px` : `calc(${block.indentColumns} * 1ch)`;
    }
    const image = document.createElement("img");
    image.className = "extension-render-image__img";
    image.alt = block.alt || "Image";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = `data:${block.mimeType};base64,${block.data}`;
    wrapper.append(image);
    return wrapper;
  }
  function normalizeExtensionRenderBlock(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    if (value.type === "text" && Array.isArray(value.lines)) {
      return { type: "text", lines: value.lines.map((line) => String(line)) };
    }
    if (value.type === "image" && typeof value.data === "string" && value.data.length > 0 && typeof value.mimeType === "string" && isSupportedImageMimeType(value.mimeType)) {
      const columns = clampPositiveInteger(value.columns, 1);
      const rows = clampPositiveInteger(value.rows, 1);
      return {
        type: "image",
        data: value.data,
        mimeType: value.mimeType.toLowerCase(),
        columns,
        rows,
        ...typeof value.widthPx === "number" && Number.isFinite(value.widthPx) && value.widthPx > 0 ? { widthPx: Math.floor(value.widthPx) } : {},
        ...typeof value.heightPx === "number" && Number.isFinite(value.heightPx) && value.heightPx > 0 ? { heightPx: Math.floor(value.heightPx) } : {},
        ...typeof value.cellWidthPx === "number" && Number.isFinite(value.cellWidthPx) && value.cellWidthPx > 0 ? { cellWidthPx: value.cellWidthPx } : {},
        ...typeof value.cellHeightPx === "number" && Number.isFinite(value.cellHeightPx) && value.cellHeightPx > 0 ? { cellHeightPx: value.cellHeightPx } : {},
        ...typeof value.alt === "string" && value.alt ? { alt: value.alt } : {},
        ...typeof value.indentColumns === "number" && Number.isFinite(value.indentColumns) && value.indentColumns > 0 ? { indentColumns: Math.floor(value.indentColumns) } : {}
      };
    }
    return void 0;
  }
  function isSupportedImageMimeType(value) {
    const mimeType = value.toLowerCase();
    return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/gif" || mimeType === "image/webp";
  }
  function clampPositiveInteger(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  // src/webview/messages/ansi.ts
  function containsAnsiEscape(value) {
    return /\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/.test(value);
  }
  function stripAnsiSequences(value) {
    return value.replace(/\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/g, "");
  }
  function getAnsiLineBackground(value, outputColors) {
    if (!outputColors) {
      return void 0;
    }
    const lineBackground = getUniformAnsiLineBackground(value);
    return lineBackground.hasVisibleText ? lineBackground.background : void 0;
  }
  function isAnsiBlockImageLine(value) {
    const stripped = stripAnsiSequences(value);
    return containsAnsiEscape(value) && /[▀▄█]/.test(stripped) && /^[▀▄█ ]+$/.test(stripped);
  }
  function getAnsiBlockImageCells(value, outputColors) {
    if (!outputColors || !isAnsiBlockImageLine(value)) {
      return void 0;
    }
    const cells = [];
    const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
    let style = {};
    let index = 0;
    let match;
    while ((match = csiPattern.exec(value)) !== null) {
      appendAnsiBlockImageCells(cells, value.slice(index, match.index), style);
      if (match[3] === "m") {
        style = applyAnsiSgr(match[1], style);
      }
      index = match.index + match[0].length;
    }
    appendAnsiBlockImageCells(cells, value.slice(index), style);
    return cells.length > 0 ? cells : void 0;
  }
  function renderAnsiBlockImageLineInto(element, value, outputColors) {
    const cells = getAnsiBlockImageCells(value, outputColors);
    if (!cells) {
      return false;
    }
    element.replaceChildren();
    for (const cell of cells) {
      const cellElement = document.createElement("span");
      cellElement.className = "tauren-ansi-block-image-cell";
      cellElement.setAttribute("aria-hidden", "true");
      applyAnsiBlockImageCellStyle(cellElement, cell);
      element.append(cellElement);
    }
    return true;
  }
  function getAnsiFullWidgetBackground(lines, outputColors) {
    if (!outputColors) {
      return void 0;
    }
    let widgetBackground;
    let hasVisibleLine = false;
    for (const line of lines) {
      const lineBackground = getUniformAnsiLineBackground(line);
      if (!lineBackground.hasVisibleText) {
        continue;
      }
      if (!lineBackground.background) {
        return void 0;
      }
      hasVisibleLine = true;
      if (widgetBackground === void 0) {
        widgetBackground = lineBackground.background;
        continue;
      }
      if (widgetBackground !== lineBackground.background) {
        return void 0;
      }
    }
    return hasVisibleLine ? widgetBackground : void 0;
  }
  function renderAnsiTextInto(element, value, outputColors, options = {}) {
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
      appendAnsiText(element, value.slice(index, match.index), style, options);
      if (match[3] === "m") {
        style = applyAnsiSgr(match[1], style);
      }
      index = match.index + match[0].length;
    }
    appendAnsiText(element, value.slice(index), style, options);
  }
  var ansiSpinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  var ansiSpinnerPattern = new RegExp(`(^|\\n)([\\t ]*)([${ansiSpinnerFrames.join("")}])(?=$|[\\t ])`, "g");
  var ansiSpinnerFrameIndex = 0;
  var ansiSpinnerTimer;
  function renderAnsiSpinnersInto(element, animationsEnabled) {
    if (!animationsEnabled || areAnsiSpinnerAnimationsDisabled()) {
      stopAnsiSpinnerTimer();
      return;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node;
        if (ansiSpinnerPattern.test(textNode.data)) {
          textNodes.push(textNode);
        }
      }
      ansiSpinnerPattern.lastIndex = 0;
      node = walker.nextNode();
    }
    for (const textNode of textNodes) {
      replaceAnsiSpinnerTextNode(textNode);
    }
    if (textNodes.length > 0) {
      startAnsiSpinnerTimer();
    }
  }
  function replaceAnsiSpinnerTextNode(textNode) {
    const value = textNode.data;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    ansiSpinnerPattern.lastIndex = 0;
    while ((match = ansiSpinnerPattern.exec(value)) !== null) {
      fragment.append(document.createTextNode(value.slice(lastIndex, match.index)));
      if (match[1] || match[2]) {
        fragment.append(document.createTextNode(`${match[1] ?? ""}${match[2] ?? ""}`));
      }
      const spinner = document.createElement("span");
      spinner.className = "tauren-ansi-spinner";
      spinner.setAttribute("aria-hidden", "true");
      spinner.textContent = ansiSpinnerFrames[ansiSpinnerFrameIndex] ?? match[3];
      fragment.append(spinner);
      lastIndex = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(value.slice(lastIndex)));
    textNode.replaceWith(fragment);
  }
  function startAnsiSpinnerTimer() {
    if (ansiSpinnerTimer !== void 0) {
      return;
    }
    ansiSpinnerTimer = window.setInterval(() => {
      const spinners = document.querySelectorAll(".tauren-ansi-spinner");
      if (spinners.length === 0 || areAnsiSpinnerAnimationsDisabled()) {
        stopAnsiSpinnerTimer();
        return;
      }
      ansiSpinnerFrameIndex = (ansiSpinnerFrameIndex + 1) % ansiSpinnerFrames.length;
      const frame = ansiSpinnerFrames[ansiSpinnerFrameIndex];
      for (const spinner of spinners) {
        spinner.textContent = frame;
      }
    }, 80);
  }
  function stopAnsiSpinnerTimer() {
    if (ansiSpinnerTimer === void 0) {
      return;
    }
    window.clearInterval(ansiSpinnerTimer);
    ansiSpinnerTimer = void 0;
  }
  function areAnsiSpinnerAnimationsDisabled() {
    return document.body.classList.contains("tauren-animations-disabled") || document.body.classList.contains("vscode-reduce-motion");
  }
  function appendAnsiText(element, value, style, options) {
    if (!value) {
      return;
    }
    if (isEmptyAnsiStyle(style)) {
      element.append(document.createTextNode(value));
      return;
    }
    const span = document.createElement("span");
    span.textContent = value;
    applyAnsiStyle(span, style, options);
    element.append(span);
  }
  function appendAnsiBlockImageCells(cells, value, style) {
    for (const character of Array.from(value)) {
      const foreground = effectiveForeground(style);
      const background = effectiveBackground(style);
      if (character === "\u2580") {
        cells.push({ top: foreground, bottom: background });
      } else if (character === "\u2584") {
        cells.push({ top: background, bottom: foreground });
      } else if (character === "\u2588") {
        cells.push({ top: foreground, bottom: foreground });
      } else if (character === " ") {
        cells.push({ top: background, bottom: background });
      }
    }
  }
  function applyAnsiBlockImageCellStyle(element, cell) {
    const top = cell.top ?? "transparent";
    const bottom = cell.bottom ?? "transparent";
    if (top === bottom) {
      element.style.background = top;
      return;
    }
    element.style.background = `linear-gradient(to bottom, ${top} 0 50%, ${bottom} 50% 100%)`;
  }
  function getUniformAnsiLineBackground(value) {
    const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
    let style = {};
    let index = 0;
    let match;
    let lineBackground;
    let hasVisible = false;
    while ((match = csiPattern.exec(value)) !== null) {
      const segmentBackground = visibleSegmentBackground(value.slice(index, match.index), style);
      if (segmentBackground.visible) {
        hasVisible = true;
        if (!segmentBackground.background) {
          return { hasVisibleText: true, background: void 0 };
        }
        if (lineBackground === void 0) {
          lineBackground = segmentBackground.background;
        } else if (lineBackground !== segmentBackground.background) {
          return { hasVisibleText: true, background: void 0 };
        }
      }
      if (match[3] === "m") {
        style = applyAnsiSgr(match[1], style);
      }
      index = match.index + match[0].length;
    }
    const trailingBackground = visibleSegmentBackground(value.slice(index), style);
    if (trailingBackground.visible) {
      hasVisible = true;
      if (!trailingBackground.background) {
        return { hasVisibleText: true, background: void 0 };
      }
      if (lineBackground === void 0) {
        lineBackground = trailingBackground.background;
      } else if (lineBackground !== trailingBackground.background) {
        return { hasVisibleText: true, background: void 0 };
      }
    }
    return { hasVisibleText: hasVisible, background: lineBackground };
  }
  function visibleSegmentBackground(value, style) {
    const background = effectiveBackground(style);
    return {
      visible: background ? hasVisibleText(value) : hasNonWhitespaceText(value),
      background
    };
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
  function applyAnsiStyle(element, style, options) {
    const foreground = effectiveForeground(style);
    const background = effectiveBackground(style);
    if (foreground) {
      element.style.color = foreground;
    } else if (style.inverse && background) {
      element.style.color = "var(--tauren-code-background, var(--vscode-sideBar-background))";
    }
    if (!options.suppressBackgrounds) {
      if (background) {
        element.style.backgroundColor = background;
      } else if (style.inverse && foreground) {
        element.style.backgroundColor = foreground;
      }
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
  function effectiveForeground(style) {
    return style.inverse ? style.background : style.foreground;
  }
  function effectiveBackground(style) {
    return style.inverse ? style.foreground : style.background;
  }
  function hasVisibleText(value) {
    return stripAnsiSequences(value).length > 0;
  }
  function hasNonWhitespaceText(value) {
    return stripAnsiSequences(value).trim().length > 0;
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
    "--tauren-ansi-black-fallback",
    "--tauren-ansi-red-fallback",
    "--tauren-ansi-green-fallback",
    "--tauren-ansi-yellow-fallback",
    "--tauren-ansi-blue-fallback",
    "--tauren-ansi-magenta-fallback",
    "--tauren-ansi-cyan-fallback",
    "--tauren-ansi-white-fallback"
  ];
  var ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES = [
    "--tauren-ansi-bright-black-fallback",
    "--tauren-ansi-bright-red-fallback",
    "--tauren-ansi-bright-green-fallback",
    "--tauren-ansi-bright-yellow-fallback",
    "--tauren-ansi-bright-blue-fallback",
    "--tauren-ansi-bright-magenta-fallback",
    "--tauren-ansi-bright-cyan-fallback",
    "--tauren-ansi-bright-white-fallback"
  ];
  var ANSI_COLOR_FALLBACKS = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
  var ANSI_BRIGHT_COLOR_FALLBACKS = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"];
  function ansiBasicColor(index, bright) {
    const names = bright ? ANSI_BRIGHT_COLOR_NAMES : ANSI_COLOR_NAMES;
    const fallbackVariables = bright ? ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES : ANSI_COLOR_FALLBACK_VARIABLES;
    const fallbacks = bright ? ANSI_BRIGHT_COLOR_FALLBACKS : ANSI_COLOR_FALLBACKS;
    const fallbackVariable = fallbackVariables[index] ?? "--tauren-ansi-white-fallback";
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

  // src/webview/metrics.ts
  function roundDevicePixelMetric(value) {
    const devicePixelRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return Math.max(1 / devicePixelRatio, Math.round(value * devicePixelRatio) / devicePixelRatio);
  }

  // src/webview/customUI/customUi.ts
  var cursorMarker = "\x1B_pi:c\x07";
  var cursorMarkerPattern = /\x1b_pi:c\x07/g;
  var csiEscapePattern = /\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/g;
  var nonCsiEscapePattern = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|_[^\x07]*(?:\x07|\x1b\\)|\^[^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*(?:\x1b\\)?)/g;
  var CustomUiController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    activeId;
    lastDimensionSignature = "";
    resizeFrame;
    renderFrame;
    pendingRender;
    inputCaptureElement;
    cursorElement;
    isComposing = false;
    lastTextInputValue = "";
    lastTextInputTime = 0;
    compositionFallbackTimer;
    attachEventListeners() {
      const inputCaptureElement = this.ensureInputCaptureElement();
      this.options.customUiCloseButton.addEventListener("click", () => this.cancel());
      this.options.customUiElement.addEventListener("keydown", (event) => {
        this.handleKeydown(event);
      });
      this.options.customUiElement.addEventListener("keyup", (event) => {
        this.handleKeyup(event);
      });
      this.options.customUiElement.addEventListener("paste", (event) => {
        this.handlePaste(event);
      });
      inputCaptureElement.addEventListener("beforeinput", (event) => {
        this.handleBeforeInput(event);
      });
      inputCaptureElement.addEventListener("compositionstart", () => {
        this.handleCompositionStart();
      });
      inputCaptureElement.addEventListener("compositionend", (event) => {
        this.handleCompositionEnd(event);
      });
    }
    handleHostMessage(message) {
      if (!isCustomUiHostMessage(message)) {
        return false;
      }
      if (message.type === "customUiShow") {
        this.show(message.id);
        return true;
      }
      if (message.type === "customUiRender") {
        this.scheduleRender(message.id, message.lines, message.blocks, message.outputColors !== false);
        return true;
      }
      this.hide(message.id);
      return true;
    }
    handleGlobalKeydown(event) {
      if (!this.activeId) {
        return false;
      }
      if (event.target === this.options.customUiCloseButton) {
        return false;
      }
      this.handleKeydown(event);
      return true;
    }
    handleGlobalKeyup(event) {
      if (!this.activeId) {
        return false;
      }
      if (event.target === this.options.customUiCloseButton) {
        return false;
      }
      this.handleKeyup(event);
      return true;
    }
    syncForRender(isSessionLane) {
      const active = Boolean(this.activeId) && !isSessionLane;
      this.options.customUiElement.hidden = !active;
      this.options.customUiElement.inert = !active;
      this.options.form.classList.toggle("composer--custom-hidden", Boolean(this.activeId));
      if (this.activeId) {
        this.options.form.setAttribute("aria-hidden", "true");
        this.options.form.inert = true;
        this.scheduleDimensionsPost();
      }
    }
    handleResize() {
      if (!this.activeId) {
        return;
      }
      this.scheduleDimensionsPost();
    }
    isActive() {
      return Boolean(this.activeId);
    }
    focusInput() {
      if (!this.activeId || this.options.customUiElement.hidden || this.options.customUiElement.inert) {
        return false;
      }
      this.focusInputCapture();
      return true;
    }
    show(id) {
      this.cancelPendingRender();
      this.activeId = id;
      this.lastDimensionSignature = "";
      this.options.customUiOutputElement.replaceChildren();
      this.options.customUiElement.hidden = false;
      this.options.customUiElement.inert = false;
      this.options.form.classList.add("composer--custom-hidden");
      this.options.form.setAttribute("aria-hidden", "true");
      this.options.form.inert = true;
      this.focusInputCapture();
      this.scheduleDimensionsPost();
    }
    scheduleRender(id, lines, blocks, outputColors) {
      if (this.activeId !== id) {
        return;
      }
      this.pendingRender = { id, lines, ...blocks ? { blocks } : {}, outputColors };
      if (this.renderFrame !== void 0) {
        return;
      }
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = void 0;
        const pending = this.pendingRender;
        this.pendingRender = void 0;
        if (!pending) {
          return;
        }
        this.renderNow(pending.id, pending.lines, pending.blocks, pending.outputColors);
      });
    }
    renderNow(id, lines, blocks, outputColors) {
      if (this.activeId !== id) {
        return;
      }
      const contentBlocks = normalizeExtensionRenderBlocks(blocks, lines);
      const rendered = renderCustomUiBlocks(contentBlocks, outputColors);
      this.options.customUiOutputElement.replaceChildren(rendered.fragment);
      this.updateCursor(rendered.cursor);
      this.scheduleDimensionsPost();
    }
    hide(id) {
      if (this.activeId !== id) {
        return;
      }
      this.activeId = void 0;
      this.lastDimensionSignature = "";
      this.cancelPendingRender();
      this.isComposing = false;
      this.clearCompositionFallback();
      this.clearInputCaptureValue();
      this.options.customUiElement.hidden = true;
      this.options.customUiElement.inert = true;
      this.updateCursor(void 0);
      this.options.customUiOutputElement.replaceChildren();
      this.options.form.classList.remove("composer--custom-hidden");
      this.options.form.removeAttribute("aria-hidden");
      this.options.form.inert = false;
      this.options.onClose?.();
    }
    cancel() {
      if (!this.activeId) {
        return;
      }
      this.options.vscode.postMessage({ type: "customUiCancel", id: this.activeId });
    }
    cancelPendingRender() {
      this.pendingRender = void 0;
      if (this.renderFrame !== void 0) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = void 0;
      }
    }
    handlePaste(event) {
      if (!this.activeId) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.postInput(text);
    }
    handleBeforeInput(event) {
      if (!this.activeId) {
        return;
      }
      if (!isTextInsertionInput(event)) {
        return;
      }
      if (event.isComposing || this.isComposing || event.inputType === "insertCompositionText") {
        return;
      }
      const data = event.data ?? "";
      if (!data) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.postTextInput(data);
    }
    handleCompositionStart() {
      this.isComposing = true;
    }
    handleCompositionEnd(event) {
      this.isComposing = false;
      this.clearInputCaptureValue();
      const data = event.data ?? "";
      if (!data || this.isRecentTextInput(data)) {
        return;
      }
      this.clearCompositionFallback();
      this.compositionFallbackTimer = window.setTimeout(() => {
        this.compositionFallbackTimer = void 0;
        if (!this.activeId || this.isRecentTextInput(data)) {
          return;
        }
        this.postTextInput(data);
      }, 0);
    }
    handleKeydown(event) {
      if (!this.activeId) {
        return;
      }
      if (event.target === this.options.customUiCloseButton) {
        return;
      }
      if (event.isComposing || this.isComposing || event.key === "Process" || event.key === "Dead") {
        return;
      }
      if (isTextInputKeyboardEvent(event)) {
        this.focusInputCapture();
        return;
      }
      const data = terminalDataForKeyboardEvent(event, event.repeat ? "repeat" : "press");
      if (data === void 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.postInput(data);
    }
    handleKeyup(event) {
      if (!this.activeId) {
        return;
      }
      if (event.target === this.options.customUiCloseButton) {
        return;
      }
      if (event.isComposing || this.isComposing || event.key === "Process" || event.key === "Dead") {
        return;
      }
      const data = terminalDataForKeyboardEvent(event, "release");
      if (data === void 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.postInput(data);
    }
    ensureInputCaptureElement() {
      if (this.inputCaptureElement) {
        return this.inputCaptureElement;
      }
      const element = document.createElement("textarea");
      element.className = "custom-ui__input-capture";
      element.setAttribute("aria-label", "Extension UI keyboard input");
      element.autocapitalize = "off";
      element.autocomplete = "off";
      element.spellcheck = false;
      element.rows = 1;
      element.tabIndex = -1;
      this.options.customUiElement.append(element);
      this.inputCaptureElement = element;
      return element;
    }
    focusInputCapture() {
      const element = this.ensureInputCaptureElement();
      element.value = "";
      element.focus({ preventScroll: true });
    }
    ensureCursorElement() {
      if (this.cursorElement) {
        return this.cursorElement;
      }
      const element = document.createElement("span");
      element.className = "custom-ui__cursor";
      element.setAttribute("aria-hidden", "true");
      this.cursorElement = element;
      return element;
    }
    updateCursor(cursor) {
      if (!cursor) {
        if (this.cursorElement) {
          this.cursorElement.hidden = true;
        }
        this.positionInputCapture(void 0);
        return;
      }
      const element = this.ensureCursorElement();
      const metrics = measureTerminalMetrics(this.options.customUiOutputElement);
      element.hidden = false;
      element.style.left = `${metrics.paddingLeft + cursor.column * metrics.charWidth}px`;
      element.style.top = `${metrics.paddingTop + cursor.row * metrics.lineHeight}px`;
      element.style.width = `${metrics.charWidth}px`;
      element.style.height = `${metrics.lineHeight}px`;
      this.options.customUiOutputElement.append(element);
      this.positionInputCapture(element);
    }
    positionInputCapture(cursorElement) {
      if (!cursorElement && !this.inputCaptureElement) {
        return;
      }
      const input = this.ensureInputCaptureElement();
      if (!cursorElement || cursorElement.hidden) {
        input.style.left = "0px";
        input.style.top = "0px";
        input.style.height = "1px";
        return;
      }
      const cursorRect = cursorElement.getBoundingClientRect();
      const containerRect = this.options.customUiElement.getBoundingClientRect();
      input.style.left = `${Math.max(0, cursorRect.left - containerRect.left)}px`;
      input.style.top = `${Math.max(0, cursorRect.top - containerRect.top)}px`;
      input.style.height = `${Math.max(1, cursorRect.height)}px`;
    }
    clearInputCaptureValue() {
      if (this.inputCaptureElement) {
        this.inputCaptureElement.value = "";
      }
    }
    clearCompositionFallback() {
      if (this.compositionFallbackTimer !== void 0) {
        window.clearTimeout(this.compositionFallbackTimer);
        this.compositionFallbackTimer = void 0;
      }
    }
    postTextInput(data) {
      this.clearCompositionFallback();
      this.lastTextInputValue = data;
      this.lastTextInputTime = Date.now();
      this.clearInputCaptureValue();
      this.postInput(data);
    }
    isRecentTextInput(data) {
      return this.lastTextInputValue === data && Date.now() - this.lastTextInputTime < 100;
    }
    postInput(data) {
      if (!this.activeId) {
        return;
      }
      this.options.vscode.postMessage({ type: "customUiInput", id: this.activeId, data });
    }
    scheduleDimensionsPost() {
      if (this.resizeFrame !== void 0) {
        return;
      }
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = void 0;
        this.postDimensions();
      });
    }
    postDimensions() {
      if (!this.activeId || this.options.customUiElement.hidden) {
        return;
      }
      const dimensions = measureTerminalDimensions(this.options.customUiOutputElement);
      const signature = `${dimensions.columns}x${dimensions.rows}@${dimensions.cellWidthPx}x${dimensions.cellHeightPx}`;
      if (signature === this.lastDimensionSignature) {
        return;
      }
      this.lastDimensionSignature = signature;
      this.options.vscode.postMessage({
        type: "customUiDimensions",
        id: this.activeId,
        columns: dimensions.columns,
        rows: dimensions.rows,
        cellWidthPx: dimensions.cellWidthPx,
        cellHeightPx: dimensions.cellHeightPx
      });
    }
  };
  function renderCustomUiBlocks(blocks, outputColors) {
    const fragment = document.createDocumentFragment();
    let cursor;
    let rowOffset = 0;
    for (const block of blocks) {
      if (block.type === "image") {
        fragment.append(createExtensionImageElement(block));
        rowOffset += Math.max(1, block.rows);
        continue;
      }
      const prepared = prepareCustomUiLines(block.lines);
      for (const line of prepared.lines) {
        const lineElement = document.createElement("div");
        lineElement.className = "custom-ui__line";
        if (isAnsiBlockImageLine(line)) {
          lineElement.classList.add("custom-ui__line--ansi-image");
          if (renderAnsiBlockImageLineInto(lineElement, line, outputColors)) {
            fragment.append(lineElement);
            continue;
          }
        }
        renderAnsiTextInto(lineElement, line, outputColors);
        fragment.append(lineElement);
      }
      if (!cursor && prepared.cursor) {
        cursor = {
          row: rowOffset + prepared.cursor.row,
          column: prepared.cursor.column
        };
      }
      rowOffset += prepared.lines.length;
    }
    return { fragment, cursor };
  }
  function prepareCustomUiLines(lines) {
    let cursor;
    const preparedLines = lines.map((line, row) => {
      const markerIndex = cursor ? -1 : line.indexOf(cursorMarker);
      if (markerIndex !== -1) {
        cursor = {
          row,
          column: visibleColumn(line.slice(0, markerIndex))
        };
      }
      return sanitizeTuiLine(line);
    });
    return {
      lines: preparedLines,
      cursor
    };
  }
  function sanitizeTuiLine(value) {
    return value.replace(cursorMarkerPattern, "").replace(nonCsiEscapePattern, "");
  }
  function visibleColumn(value) {
    const text = value.replace(cursorMarkerPattern, "").replace(nonCsiEscapePattern, "").replace(csiEscapePattern, "");
    let column = 0;
    for (const character of Array.from(text)) {
      if (character === "	") {
        column += Math.max(1, 2 - column % 2);
        continue;
      }
      column += characterCellWidth(character);
    }
    return column;
  }
  function characterCellWidth(character) {
    const codePoint = character.codePointAt(0);
    if (codePoint === void 0 || codePoint === 0 || codePoint < 32 || codePoint >= 127 && codePoint < 160) {
      return 0;
    }
    if (isCombiningCodePoint(codePoint)) {
      return 0;
    }
    return isWideCodePoint(codePoint) ? 2 : 1;
  }
  function isCombiningCodePoint(codePoint) {
    return codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071;
  }
  function isWideCodePoint(codePoint) {
    return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 128591 || codePoint >= 129280 && codePoint <= 129535);
  }
  var measurementCanvas;
  function measureTerminalMetrics(element) {
    const style = window.getComputedStyle(element);
    const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
    const canvas = measurementCanvas ?? document.createElement("canvas");
    measurementCanvas = canvas;
    const context = canvas.getContext("2d");
    let charWidth = 8;
    if (context) {
      context.font = font;
      charWidth = Math.max(1, context.measureText("M").width);
    }
    const fontSize = Number.parseFloat(style.fontSize) || 12;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.35 || 18;
    return {
      charWidth,
      lineHeight,
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      paddingTop: Number.parseFloat(style.paddingTop) || 0
    };
  }
  function measureTerminalDimensions(element) {
    const metrics = measureTerminalMetrics(element);
    const rect = element.getBoundingClientRect();
    const columns = Math.max(20, Math.floor(rect.width / metrics.charWidth));
    const targetHeight = Math.max(rect.height, Math.min(window.innerHeight * 0.7, window.innerHeight - 140));
    const rows = Math.max(4, Math.min(80, Math.floor(Math.max(120, targetHeight) / metrics.lineHeight)));
    return {
      columns,
      rows,
      cellWidthPx: roundDevicePixelMetric(metrics.charWidth),
      cellHeightPx: roundDevicePixelMetric(metrics.lineHeight)
    };
  }
  function isTextInputKeyboardEvent(event) {
    return !event.metaKey && !event.ctrlKey && !event.altKey && isSingleCodePoint(event.key);
  }
  function terminalDataForKeyboardEvent(event, eventType = "press") {
    if (event.metaKey) {
      return void 0;
    }
    if (eventType !== "press") {
      return kittyDataForKeyboardEvent(event, eventType);
    }
    if (event.ctrlKey && !event.altKey && event.key.length === 1) {
      const lower = event.key.toLowerCase();
      if (lower >= "a" && lower <= "z") {
        return String.fromCharCode(lower.charCodeAt(0) - 96);
      }
    }
    const special = specialKeyData(event);
    if (special !== void 0) {
      return event.altKey && special.length > 0 && !special.startsWith("\x1B") ? `\x1B${special}` : special;
    }
    if (isSingleCodePoint(event.key) && !event.ctrlKey) {
      return event.altKey ? `\x1B${event.key}` : event.key;
    }
    return void 0;
  }
  function kittyDataForKeyboardEvent(event, eventType) {
    const modifier = kittyModifierForEvent(event);
    const eventCode = eventType === "repeat" ? 2 : 3;
    const special = kittySpecialKeyData(event, modifier, eventCode);
    if (special !== void 0) {
      return special;
    }
    if (!isSingleCodePoint(event.key)) {
      return void 0;
    }
    const codepoint = event.key.codePointAt(0);
    return codepoint === void 0 ? void 0 : `\x1B[${codepoint};${modifier}:${eventCode}u`;
  }
  function kittyModifierForEvent(event) {
    return 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
  }
  function kittySpecialKeyData(event, modifier, eventCode) {
    const arrowCode = arrowKittyCode(event.key);
    if (arrowCode !== void 0) {
      return `\x1B[1;${modifier}:${eventCode}${arrowCode}`;
    }
    if (event.key === "Home") return `\x1B[1;${modifier}:${eventCode}H`;
    if (event.key === "End") return `\x1B[1;${modifier}:${eventCode}F`;
    const functional = functionalKittyCode(event.key);
    if (functional !== void 0) {
      return `\x1B[${functional};${modifier}:${eventCode}~`;
    }
    const codepoint = csiUCodepoint(event.key);
    return codepoint === void 0 ? void 0 : `\x1B[${codepoint};${modifier}:${eventCode}u`;
  }
  function arrowKittyCode(key) {
    if (key === "ArrowUp") return "A";
    if (key === "ArrowDown") return "B";
    if (key === "ArrowRight") return "C";
    if (key === "ArrowLeft") return "D";
    return void 0;
  }
  function functionalKittyCode(key) {
    if (key === "Insert") return 2;
    if (key === "Delete") return 3;
    if (key === "PageUp") return 5;
    if (key === "PageDown") return 6;
    return void 0;
  }
  function csiUCodepoint(key) {
    if (key === "Escape") return 27;
    if (key === "Tab") return 9;
    if (key === "Enter") return 13;
    if (key === "Backspace") return 127;
    return void 0;
  }
  function specialKeyData(event) {
    if (event.key === "Escape") return "\x1B";
    if (event.key === "Enter") return event.shiftKey ? "\x1B\r" : "\r";
    if (event.key === "Tab") return event.shiftKey ? "\x1B[Z" : "	";
    if (event.key === "Backspace") return event.altKey ? "\x1B\x7F" : "\x7F";
    if (event.key === "Delete") return "\x1B[3~";
    if (event.key === "Home") return "\x1B[H";
    if (event.key === "End") return "\x1B[F";
    if (event.key === "PageUp") return "\x1B[5~";
    if (event.key === "PageDown") return "\x1B[6~";
    if (event.key === "ArrowUp") return event.shiftKey ? "\x1B[a" : event.ctrlKey ? "\x1BOa" : "\x1B[A";
    if (event.key === "ArrowDown") return event.shiftKey ? "\x1B[b" : event.ctrlKey ? "\x1BOb" : "\x1B[B";
    if (event.key === "ArrowRight") return event.shiftKey ? "\x1B[c" : event.ctrlKey ? "\x1BOc" : "\x1B[C";
    if (event.key === "ArrowLeft") return event.shiftKey ? "\x1B[d" : event.ctrlKey ? "\x1BOd" : "\x1B[D";
    return void 0;
  }
  function isTextInsertionInput(event) {
    return event.inputType === "insertText" || event.inputType === "insertCompositionText" || event.inputType === "insertFromComposition";
  }
  function isSingleCodePoint(value) {
    return Array.from(value).length === 1;
  }
  function isCustomUiHostMessage(value) {
    if (!value || typeof value !== "object" || !("type" in value)) {
      return false;
    }
    const message = value;
    if (message.type === "customUiShow" || message.type === "customUiHide") {
      return typeof message.id === "string" && message.id.length > 0;
    }
    return message.type === "customUiRender" && typeof message.id === "string" && message.id.length > 0 && Array.isArray(message.lines) && message.lines.every((line) => typeof line === "string") && (message.blocks === void 0 || Array.isArray(message.blocks));
  }

  // src/webview/messages/actionButtons.ts
  var copyIconSvg = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 1.75A1.75 1.75 0 0 1 6.75 0h6.5A1.75 1.75 0 0 1 15 1.75v6.5A1.75 1.75 0 0 1 13.25 10h-1.5v1.25A1.75 1.75 0 0 1 10 13H3.75A1.75 1.75 0 0 1 2 11.25v-6.5A1.75 1.75 0 0 1 3.75 3H5V1.75Zm1.75-.25a.25.25 0 0 0-.25.25V3H10a1.75 1.75 0 0 1 1.75 1.75V8.5h1.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5ZM3.75 4.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H10a.25.25 0 0 0 .25-.25v-6.5A.25.25 0 0 0 10 4.5H3.75Z"/></svg>';
  function createIconActionButton(className, label) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.innerHTML = copyIconSvg;
    const tooltip = document.createElement("span");
    tooltip.className = "tauren-icon-action-tooltip";
    tooltip.textContent = label;
    button.append(tooltip);
    return button;
  }

  // src/webview/messages/markdown.ts
  var supportedDataImagePattern = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
  var localImageRequests = /* @__PURE__ */ new Map();
  var postMessage2;
  var nextLocalImageRequestId = 1;
  var markdownRenderer = window.markdownit ? window.markdownit({
    html: false,
    linkify: true,
    breaks: false
  }) : void 0;
  function configureMarkdownImageRendering(post) {
    postMessage2 = post;
  }
  function handleMarkdownImageMessage(message) {
    if (!isLocalImageResolveResult(message)) {
      return false;
    }
    applyLocalImageResolveResult(message);
    return true;
  }
  function pruneDisconnectedLocalImageRequests() {
    for (const [id, pending] of Array.from(localImageRequests.entries())) {
      if (!pending.placeholder.isConnected) {
        localImageRequests.delete(id);
      }
    }
  }
  function renderMarkdownInto(element, text, options = {}) {
    if (!markdownRenderer || !window.DOMPurify) {
      element.textContent = text;
      if (options.animationsEnabled !== false) {
        animateNewVisibleText(element, options.animateFromText);
      }
      return;
    }
    element.classList.add("message__body--markdown");
    const rendered = markdownRenderer.render(normalizeRawImageTags(text));
    element.innerHTML = window.DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true }
    });
    processImages(element, options);
    linkifyFileReferences(element);
    addCodeBlockActions(element);
    requestCodeHighlightsIn(element);
    if (options.animationsEnabled !== false) {
      animateNewVisibleText(element, options.animateFromText);
    }
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
  function normalizeRawImageTags(text) {
    return text.replace(/<img\b[^>]*>/gi, (tag) => {
      const template = document.createElement("template");
      template.innerHTML = tag;
      const image = template.content.querySelector("img");
      const src = image?.getAttribute("src")?.trim();
      if (!src) {
        return tag;
      }
      const alt = image?.getAttribute("alt") ?? "";
      const title = image?.getAttribute("title")?.trim() ?? "";
      return `![${escapeMarkdownImageLabel(alt)}](<${escapeMarkdownImageDestination(src)}>${title ? ` "${escapeMarkdownImageTitle(title)}"` : ""})`;
    });
  }
  function escapeMarkdownImageLabel(value) {
    return value.replace(/[\\\]]/g, "\\$&").replace(/\n/g, " ");
  }
  function escapeMarkdownImageDestination(value) {
    return value.replace(/[>\n\r]/g, (character) => encodeURIComponent(character));
  }
  function escapeMarkdownImageTitle(value) {
    return value.replace(/["\\]/g, "\\$&").replace(/\n/g, " ");
  }
  function processImages(root, options) {
    for (const image of Array.from(root.querySelectorAll("img"))) {
      if (!(image instanceof HTMLImageElement)) {
        continue;
      }
      processImageElement(image, options);
    }
  }
  function processImageElement(image, options) {
    const src = image.getAttribute("src")?.trim() ?? "";
    const alt = image.getAttribute("alt") ?? "Image";
    if (!src) {
      image.replaceWith(createImageFallback("Image source is missing."));
      return;
    }
    if (isSupportedDataImage(src)) {
      markRenderableImage(image);
      return;
    }
    if (isHttpsImage(src)) {
      if (options.allowRemoteImages === true) {
        markRenderableImage(image);
        return;
      }
      image.replaceWith(createImageFallback("Remote image blocked."));
      return;
    }
    if (isLocalImageReference(src)) {
      requestLocalImage(image, src, alt);
      return;
    }
    image.replaceWith(createImageFallback("Unsupported image source."));
  }
  function markRenderableImage(image) {
    image.classList.add("tauren-image");
    image.loading = "lazy";
    image.decoding = "async";
  }
  function requestLocalImage(image, src, alt) {
    if (!postMessage2) {
      image.replaceWith(createImageFallback("Local image unavailable."));
      return;
    }
    const id = `local-image-${nextLocalImageRequestId++}`;
    const placeholder = createImageFallback("Loading image\u2026");
    placeholder.classList.add("tauren-image--pending");
    placeholder.dataset.localImageRequestId = id;
    localImageRequests.set(id, { placeholder, alt });
    image.replaceWith(placeholder);
    postMessage2({ type: "resolveLocalImage", id, src });
  }
  function applyLocalImageResolveResult(message) {
    const pending = localImageRequests.get(message.id);
    localImageRequests.delete(message.id);
    if (!pending || !pending.placeholder.isConnected) {
      return;
    }
    if (!message.uri) {
      pending.placeholder.replaceWith(createImageFallback(message.error || "Local image unavailable."));
      return;
    }
    const image = document.createElement("img");
    image.src = message.uri;
    image.alt = pending.alt;
    markRenderableImage(image);
    pending.placeholder.replaceWith(image);
  }
  function createImageFallback(text) {
    const fallback = document.createElement("span");
    fallback.className = "tauren-image-fallback";
    fallback.textContent = text;
    return fallback;
  }
  function isSupportedDataImage(src) {
    return supportedDataImagePattern.test(src);
  }
  function isHttpsImage(src) {
    try {
      return new URL(src).protocol === "https:";
    } catch {
      return false;
    }
  }
  function isLocalImageReference(src) {
    return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src) && /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(src);
  }
  function isLocalImageResolveResult(message) {
    if (!isRecord(message) || message.type !== "resolveLocalImageResult") {
      return false;
    }
    return typeof message.id === "string" && (!("uri" in message) || typeof message.uri === "string") && (!("error" in message) || typeof message.error === "string");
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
    link.className = "tauren-file-link";
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
  function addCodeBlockActions(root) {
    for (const pre of Array.from(root.querySelectorAll("pre"))) {
      if (!(pre instanceof HTMLElement) || pre.closest(".tauren-code-block")) {
        continue;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "tauren-code-block";
      const actions = document.createElement("div");
      actions.className = "tauren-code-block__actions";
      const copyButton = createIconActionButton("tauren-code-block__action", "Copy code");
      copyButton.dataset.copyCodeBlock = "true";
      actions.append(copyButton);
      pre.replaceWith(wrapper);
      wrapper.append(actions, pre);
    }
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
      span.className = "tauren-stream-word";
      span.textContent = token;
      if (wordIndex > 0) {
        span.style.animationDelay = Math.min(wordIndex * 8, 40) + "ms";
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

  // src/webview/dom.ts
  function eventTargetElement(event) {
    return event.target instanceof Element ? event.target : null;
  }
  function parseCssPixelValue(value) {
    return Number.parseFloat(value) || 0;
  }
  function getWebviewDom() {
    return {
      viewElement: queryRequired(".tauren-view"),
      toolbarTitleElement: queryRequired(".tauren-toolbar__title"),
      toolbarTitleTextElement: queryRequired(".tauren-toolbar__title-text"),
      toolbarTimestampElement: queryRequired(".tauren-toolbar__timestamp"),
      sessionNameInputElement: queryRequired(".tauren-toolbar__title-input"),
      sessionToggleButton: queryRequired(".tauren-toolbar__sessions"),
      treeToggleButton: queryRequired(".tauren-toolbar__tree"),
      helpOverlayElement: queryRequired(".tauren-help-overlay"),
      helpCloseButton: queryRequired(".tauren-help-overlay__close"),
      settingsElement: queryRequired(".settings-surface"),
      settingsBodyElement: queryRequired(".settings-surface__body"),
      settingsBackButton: queryRequired(".settings-surface__back"),
      toastElement: queryRequired(".tauren-toast"),
      messagesElement: queryRequired(".messages"),
      sessionsElement: queryRequired(".sessions"),
      sessionTreeElement: queryRequired(".session-tree"),
      customUiElement: queryRequired(".custom-ui"),
      customUiOutputElement: queryRequired(".custom-ui__output"),
      customUiCloseButton: queryRequired(".custom-ui__close"),
      extensionEditorElement: queryRequired(".extension-editor"),
      extensionEditorTitleElement: queryRequired(".extension-editor__title"),
      extensionEditorInputElement: queryRequired(".extension-editor__input"),
      extensionEditorSaveButton: queryRequired(".extension-editor__save"),
      extensionEditorCancelButton: queryRequired(".extension-editor__cancel"),
      extensionEditorCloseButton: queryRequired(".extension-editor__close"),
      widgetBusySlotElement: queryRequired(".composer__widget-busy-slot"),
      extensionWidgetsAboveElement: queryRequired(".extension-widgets--above"),
      extensionWidgetsBelowElement: queryRequired(".extension-widgets--below"),
      form: queryRequired(".composer"),
      textarea: queryRequired(".composer__input"),
      composerStatusElement: queryRequired(".composer-status"),
      composerStatusTextElement: queryRequired(".composer-status__text"),
      slashMenuElement: queryRequired(".composer__slash-menu"),
      contextBadgesElement: queryRequired(".composer__context-badges"),
      busySubmitElement: queryRequired(".composer__busy-submit"),
      diffSummaryElement: queryRequired(".composer__diff-summary"),
      diffAddedElement: queryRequired(".composer__diff-added"),
      diffRemovedElement: queryRequired(".composer__diff-removed"),
      streamingBehaviorButtonElements: queryAll(".composer__mode-button"),
      attachButton: queryRequired(".composer__attach"),
      voiceButton: queryRequired(".composer__voice"),
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

  // src/commands/slashCommands.ts
  var localSlashCommandDefinitions = [
    { name: "model", description: "Select model", source: "builtin", supported: true },
    { name: "name", description: "Set or clear session name", source: "builtin", supported: true },
    { name: "session", description: "Show session info and stats", source: "builtin", supported: true },
    { name: "compact", description: "Manually compact context", source: "builtin", supported: true },
    { name: "copy", description: "Copy last response", source: "builtin", supported: true },
    { name: "export", description: "Export session to HTML", source: "builtin", supported: true },
    { name: "new", description: "Start a new session", source: "builtin", supported: true },
    { name: "settings", description: "Open Tauren settings", source: "builtin", supported: true },
    { name: "scoped-models", description: "Configure scoped model cycling", source: "builtin", supported: true },
    { name: "memory", description: "Manage Kward memory", source: "builtin", supported: true },
    { name: "mcp", description: "Show Kward MCP server and tool status", source: "builtin", supported: true, kwardOnly: true },
    { name: "tools", description: "Show available Kward tools", source: "builtin", supported: true, kwardOnly: true },
    { name: "import", description: "Import and resume a JSONL session", source: "builtin", supported: true },
    { name: "share", description: "Share session as a secret GitHub gist", source: "builtin", supported: true },
    { name: "changelog", description: "Show Pi and Tauren changelogs", source: "builtin", supported: true },
    { name: "hotkeys", description: "Show Tauren keyboard shortcuts", source: "builtin", supported: true },
    { name: "fork", description: "Fork from a previous user message", source: "builtin", supported: true },
    { name: "clone", description: "Duplicate the current session", source: "builtin", supported: true },
    { name: "tree", description: "Navigate session tree", source: "builtin", supported: true },
    { name: "login", description: "Configure provider authentication", source: "builtin", supported: true },
    { name: "logout", description: "Remove stored provider authentication", source: "builtin", supported: true },
    { name: "resume", description: "Resume a different session", source: "builtin", supported: true },
    { name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", source: "builtin", supported: true },
    { name: "restart", description: "Restart the backend engine and reconnect the session", source: "builtin", supported: true },
    { name: "quit", description: "Not supported here", source: "unsupported", supported: false }
  ];
  var builtinSlashCommandNames = new Set(localSlashCommandDefinitions.map((command) => command.name));
  var supportedBuiltinSlashCommandNames = new Set(
    localSlashCommandDefinitions.filter((command) => command.supported).map((command) => command.name)
  );
  var localSlashCommandNames = localSlashCommandDefinitions.map((command) => command.name);
  var hiddenLocalSlashCommandNames = localSlashCommandDefinitions.filter((command) => command.hidden).map((command) => command.name);
  var localSlashCommands = localSlashCommandDefinitions.map(({ supported: _supported, hidden: _hidden, kwardOnly: _kwardOnly, ...command }) => command);
  var localSlashMenuCommands = localSlashCommandDefinitions.filter((command) => command.supported && !command.hidden && !command.kwardOnly).map(({ supported: _supported, hidden: _hidden, kwardOnly: _kwardOnly, ...command }) => command);
  var kwardLocalSlashMenuCommands = localSlashCommandDefinitions.filter((command) => command.supported && !command.hidden && command.kwardOnly).map(({ supported: _supported, hidden: _hidden, kwardOnly: _kwardOnly, ...command }) => command);

  // src/kward/memoryCommandOptions.ts
  var kwardMemoryCommandOptions = [
    { command: "status", description: "Show memory and auto-summary status" },
    { command: "enable", description: "Enable Kward memory" },
    { command: "disable", description: "Disable memory prompt injection" },
    { command: "auto-summary enable", description: "Learn soft memories after completed turns" },
    { command: "auto-summary disable", description: "Disable automatic memory summarization" },
    { command: "core <text>", description: "Add a global core memory", insertText: "core" },
    { command: "add <text>", description: "Add a workspace soft memory", insertText: "add" },
    { command: "list", description: "List active memory for this workspace" },
    { command: "list --all", description: "List memory including inactive records" },
    { command: "forget <id>", description: "Forget a core or soft memory", insertText: "forget" },
    { command: "promote <id>", description: "Promote soft memory or workspace core memory", insertText: "promote" },
    { command: "relax <id>", description: "Relax a global core memory into this workspace", insertText: "relax" },
    { command: "inspect", description: "Inspect memory status, paths, and stored records" },
    { command: "why", description: "Explain the latest memory retrieval" },
    { command: "summarize", description: "Learn soft memories from this session" }
  ];

  // src/webview/constants.ts
  var webviewHiddenLocalSlashCommandNames = hiddenLocalSlashCommandNames;
  var webviewLocalSlashCommands = localSlashMenuCommands.map((command) => ({ ...command }));
  var webviewKwardLocalSlashCommands = kwardLocalSlashMenuCommands.map((command) => ({ ...command }));
  var webviewKwardMemoryCommandOptions = kwardMemoryCommandOptions.map((option) => ({ ...option }));
  var messagesBottomThreshold = 4;
  var maxTextareaHeight = 180;
  var minTextareaHeight = 22;

  // src/diff/lineCount.ts
  function normalizeDiffLineCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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
  function updateDiffCounter(counter, targetValue, animationsEnabled = true) {
    const target = normalizeDiffLineCount(targetValue);
    if (!animationsEnabled) {
      if (counter.animationFrame !== void 0) {
        cancelAnimationFrame(counter.animationFrame);
        counter.animationFrame = void 0;
      }
      counter.target = target;
      counter.startValue = target;
      counter.duration = 0;
      renderDiffCounter(counter, target);
      return;
    }
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
  function formatDiffLineCount(value) {
    return normalizeDiffLineCount(value).toLocaleString();
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

  // src/webview/composer/appendText.ts
  function appendComposerText(existingText, appendedText) {
    if (existingText.length === 0) {
      return {
        text: appendedText,
        cursor: appendedText.length
      };
    }
    const separator = existingText.endsWith("\n") ? "" : "\n";
    const text = `${existingText}${separator}${appendedText}`;
    return {
      text,
      cursor: text.length
    };
  }

  // src/webview/composer/paste.ts
  var pasteMarkerRegex = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
  var csiuControlRegex = /\x1b\[(\d+);5u/g;
  var ComposerPasteBuffer = class {
    pastes = /* @__PURE__ */ new Map();
    pasteCounter = 0;
    paste(text, pastedText, selectionStart, selectionEnd) {
      const start = clampIndex(selectionStart, text.length);
      const end = clampIndex(selectionEnd, text.length);
      const left = Math.min(start, end);
      const right = Math.max(start, end);
      const insertText = this.preparePasteText(text, pastedText, left);
      const nextText = text.slice(0, left) + insertText + text.slice(right);
      return {
        text: nextText,
        cursor: left + insertText.length
      };
    }
    expand(text) {
      if (this.pastes.size === 0 || !text.includes("[paste #")) {
        return text;
      }
      return text.replace(pasteMarkerRegex, (marker, idText) => {
        const paste = this.pastes.get(Number(idText));
        return paste ?? marker;
      });
    }
    clear() {
      this.pastes.clear();
      this.pasteCounter = 0;
    }
    preparePasteText(currentText, pastedText, cursor) {
      const decodedText = pastedText.replace(csiuControlRegex, (match, code) => {
        const cp = Number(code);
        if (cp >= 97 && cp <= 122) {
          return String.fromCharCode(cp - 96);
        }
        if (cp >= 65 && cp <= 90) {
          return String.fromCharCode(cp - 64);
        }
        return match;
      });
      const cleanText = normalizePasteText(decodedText);
      let filteredText = cleanText.split("").filter((char) => char === "\n" || char.charCodeAt(0) >= 32).join("");
      if (/^[/~.]/.test(filteredText)) {
        const charBeforeCursor = cursor > 0 ? currentText[cursor - 1] : "";
        if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
          filteredText = ` ${filteredText}`;
        }
      }
      const pastedLines = filteredText.split("\n");
      const totalChars = filteredText.length;
      if (pastedLines.length > 10 || totalChars > 1e3) {
        this.pasteCounter += 1;
        const pasteId = this.pasteCounter;
        this.pastes.set(pasteId, filteredText);
        return pastedLines.length > 10 ? `[paste #${pasteId} +${pastedLines.length} lines]` : `[paste #${pasteId} ${totalChars} chars]`;
      }
      return filteredText;
    }
  };
  function normalizePasteText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
  }
  function clampIndex(index, length) {
    return Math.min(Math.max(Number.isFinite(index) ? Math.trunc(index) : length, 0), length);
  }

  // src/webview/composer/tooltip.ts
  function createTooltipElement(text) {
    const tooltip = document.createElement("span");
    tooltip.className = "tauren-icon-action-tooltip";
    tooltip.textContent = text;
    return tooltip;
  }
  function setTooltipText(element, text) {
    const tooltip = element.querySelector(".tauren-icon-action-tooltip");
    if (tooltip) {
      tooltip.textContent = text;
    }
  }

  // src/webview/scopedModels.ts
  function getScopedModelSelection(state2) {
    const allIds = state2.modelOptions.map(getModelFullId);
    const patterns = getScopedModelPatterns(state2);
    const enabledIds = patterns === void 0 ? allIds : resolveScopedModelIds(patterns, state2.modelOptions);
    const allEnabled = enabledIds.length === allIds.length;
    const enabledSet = new Set(enabledIds);
    const orderedIds = allEnabled ? allIds : [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
    const modelsById = new Map(state2.modelOptions.map((model) => [getModelFullId(model), model]));
    return {
      allEnabled,
      enabledIds,
      orderedModels: orderedIds.flatMap((id) => {
        const model = modelsById.get(id);
        return model ? [model] : [];
      })
    };
  }
  function getScopedModelPickerOptions(state2) {
    const patterns = getScopedModelPatterns(state2);
    if (patterns === void 0) {
      return state2.modelOptions;
    }
    const enabledIds = resolveScopedModelIds(patterns, state2.modelOptions);
    const modelsById = new Map(state2.modelOptions.map((model) => [getModelFullId(model), model]));
    return enabledIds.flatMap((id) => {
      const model = modelsById.get(id);
      return model ? [model] : [];
    });
  }
  function normalizeScopedModelSelection(enabledIds, modelOptions) {
    const allIds = modelOptions.map(getModelFullId);
    return allIds.filter((id) => enabledIds.includes(id));
  }
  function getModelFullId(model) {
    return `${model.provider}/${model.id}`;
  }
  function getScopedModelPatterns(state2) {
    const value = state2.settings.values.enabledModels;
    return Array.isArray(value) ? value : void 0;
  }
  function resolveScopedModelIds(patterns, modelOptions) {
    const ids = [];
    for (const pattern of patterns) {
      const matcher = createModelPatternMatcher(pattern);
      for (const model of modelOptions) {
        const fullId = getModelFullId(model);
        if (!ids.includes(fullId) && matcher(model, fullId)) {
          ids.push(fullId);
        }
      }
    }
    return ids;
  }
  function createModelPatternMatcher(pattern) {
    const normalized = pattern.trim().toLowerCase();
    const hasGlob = /[*?[\]]/.test(normalized);
    if (!hasGlob) {
      return (model, fullId) => fullId.toLowerCase() === normalized || model.id.toLowerCase() === normalized;
    }
    const globRegex = new RegExp(`^${escapeRegex(normalized).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`, "i");
    return (model, fullId) => globRegex.test(fullId) || globRegex.test(model.id);
  }
  function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }

  // src/webview/composer/modelPickerController.ts
  var ModelPickerController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    modelSelectOptionsSignature = "";
    hasOpenMenu() {
      return this.options.modelMenuElement?.hasAttribute("open") ?? false;
    }
    closeMenu() {
      this.options.modelMenuElement?.removeAttribute("open");
      this.options.modelElement.setAttribute("aria-expanded", "false");
    }
    openPicker() {
      if (this.options.modelElement.disabled) {
        return;
      }
      this.openMenu();
      this.focusControl(1);
    }
    syncLabel(label, tooltipText, busy, metadataRefreshing) {
      const modelLabel = document.createElement("span");
      modelLabel.className = "composer__model-label";
      modelLabel.textContent = label;
      const tooltip = createTooltipElement(tooltipText);
      this.options.modelElement.replaceChildren(modelLabel, tooltip);
      this.options.modelElement.className = "composer__model";
      this.options.modelElement.setAttribute("aria-label", tooltipText);
      this.options.modelElement.disabled = busy;
      this.options.modelElement.setAttribute("aria-busy", metadataRefreshing ? "true" : "false");
      this.options.modelMenuElement?.setAttribute("aria-busy", metadataRefreshing ? "true" : "false");
      this.syncModelSelect();
      this.syncThinkingSelect();
    }
    toggleMenu() {
      if (this.options.modelElement.disabled) {
        return;
      }
      const open = !this.options.modelMenuElement?.hasAttribute("open");
      if (open) {
        this.openMenu();
      } else {
        this.closeMenu();
      }
    }
    selectModel() {
      const state2 = this.options.getState();
      const [provider, modelId] = splitModelKey(this.options.modelSelectElement.value);
      if (!provider || !modelId || state2.busy) {
        return;
      }
      this.closeMenu();
      this.options.postMessage({ type: "setModel", provider, modelId });
    }
    selectThinkingLevel() {
      const state2 = this.options.getState();
      const level = this.options.thinkingSelectElement.value;
      if (!level || state2.busy || !state2.modelReasoning) {
        return;
      }
      this.closeMenu();
      this.options.postMessage({ type: "setThinkingLevel", level });
    }
    handleMenuKeydown(event) {
      if (!this.hasOpenMenu()) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.focusControl(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        this.focusControl(event.key === "End" ? -1 : 1, true);
      }
    }
    openMenu() {
      const state2 = this.options.getState();
      if (state2.modelOptions.length === 0 && !state2.metadataRefreshing) {
        this.options.refreshMetadata();
      }
      this.options.closeSuggestionMenu();
      this.options.cancelSessionNameEdit();
      this.options.modelMenuElement?.setAttribute("open", "");
      this.options.modelElement.setAttribute("aria-expanded", "true");
    }
    focusControl(direction, edge = false) {
      const controls = this.getEnabledControls();
      if (controls.length === 0) {
        this.options.modelElement.focus({ preventScroll: true });
        return;
      }
      const activeIndex = controls.findIndex((control) => control === document.activeElement);
      const nextIndex = edge || activeIndex === -1 ? direction === 1 ? 0 : controls.length - 1 : (activeIndex + direction + controls.length) % controls.length;
      requestAnimationFrame(() => controls[nextIndex]?.focus({ preventScroll: true }));
    }
    getEnabledControls() {
      return [this.options.thinkingSelectElement, this.options.modelSelectElement].filter((control) => !control.disabled);
    }
    syncModelSelect() {
      const state2 = this.options.getState();
      const selectedValue = modelKey(state2.modelProvider, state2.modelId);
      const currentValue = this.options.modelSelectElement.value;
      const modelOptions = this.getDisplayModelOptions();
      const nextOptionsSignature = getModelOptionsSignature(modelOptions);
      if (nextOptionsSignature !== this.modelSelectOptionsSignature) {
        this.modelSelectOptionsSignature = nextOptionsSignature;
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
      }
      this.options.modelSelectElement.value = selectedValue || currentValue;
      this.options.modelSelectElement.disabled = state2.busy || modelOptions.length === 0;
    }
    getDisplayModelOptions() {
      const state2 = this.options.getState();
      if (state2.modelOptions.length > 0) {
        return getScopedModelPickerOptions(state2);
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
  };
  function getModelOptionsSignature(modelOptions) {
    return modelOptions.map((model) => [model.provider, model.id, model.name, model.reasoning ? "1" : "0"].join("\0")).join("");
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

  // src/prompt/imageAttachments.ts
  var maxPromptImageBytes = 10 * 1024 * 1024;
  function getSupportedPromptImageMimeType(filePath) {
    const extension = getLowercaseExtension(filePath);
    if (extension === ".png") {
      return "image/png";
    }
    if (extension === ".jpg" || extension === ".jpeg") {
      return "image/jpeg";
    }
    if (extension === ".gif") {
      return "image/gif";
    }
    if (extension === ".webp") {
      return "image/webp";
    }
    return void 0;
  }
  function getUnsupportedPromptImageMessage(label) {
    return `Unsupported attachment: ${label}. Tauren currently supports PNG, JPEG, GIF, and WebP images.`;
  }
  function getPromptImageTooLargeMessage(label) {
    return `Image too large: ${label} exceeds 10MB.`;
  }
  function getLowercaseExtension(filePath) {
    const normalized = filePath.split(/[\\/]/).pop() ?? filePath;
    const dotIndex = normalized.lastIndexOf(".");
    return dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase() : "";
  }

  // src/webview/composer/promptImages.ts
  async function createDroppedPromptImagesMessage(dataTransfer) {
    const files = Array.from(dataTransfer.files ?? []);
    const uris = files.length > 0 ? [] : getDroppedUriTexts(dataTransfer);
    if (files.length === 0 && uris.length === 0) {
      return void 0;
    }
    const rejections = getPromptImageFileRejections(files);
    if (rejections.length > 0) {
      return { type: "dropPromptImages", files: [], uris: [], rejections };
    }
    return createPromptImagesMessageFromFiles(files, uris);
  }
  async function createPromptImagesMessageFromFiles(files, uris = []) {
    const droppedFiles = [];
    for (const file of files) {
      try {
        droppedFiles.push({
          label: getPromptImageFileLabel(file),
          title: getPromptImageFileLabel(file),
          mimeType: getSupportedPromptImageMimeType(getPromptImageFileLabel(file)) ?? file.type,
          sizeBytes: file.size,
          data: await readFileAsBase64(file)
        });
      } catch {
        return {
          type: "dropPromptImages",
          files: [],
          uris: [],
          rejections: [`Cannot read attachment: ${getPromptImageFileLabel(file)}.`]
        };
      }
    }
    return { type: "dropPromptImages", files: droppedFiles, uris };
  }
  function getPromptImageFileRejections(files) {
    const rejections = [];
    for (const file of files) {
      const label = getPromptImageFileLabel(file);
      if (!getSupportedPromptImageMimeType(label)) {
        rejections.push(getUnsupportedPromptImageMessage(label));
        continue;
      }
      if (file.size > maxPromptImageBytes) {
        rejections.push(getPromptImageTooLargeMessage(label));
      }
    }
    return rejections;
  }
  function getPastedPromptImageFiles(dataTransfer) {
    const files = Array.from(dataTransfer.files ?? []).filter(hasClipboardFileName);
    if (files.length > 0) {
      return files;
    }
    return Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file) => Boolean(file && hasClipboardFileName(file)));
  }
  function classifyComposerDragState(dataTransfer) {
    if (!dataTransfer) {
      return "neutral";
    }
    const files = Array.from(dataTransfer.files ?? []);
    if (files.length > 0) {
      return getPromptImageFileRejections(files).length > 0 ? "invalid" : "valid";
    }
    const itemStates = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file").map(classifyDataTransferFileItem);
    if (itemStates.includes("invalid")) {
      return "invalid";
    }
    if (itemStates.length > 0 && itemStates.every((state2) => state2 === "valid")) {
      return "valid";
    }
    return "neutral";
  }
  function getPromptImageFileLabel(file) {
    return file.name || "dropped file";
  }
  function hasClipboardFileName(file) {
    return typeof file.name === "string" && file.name.length > 0;
  }
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        resolve(typeof reader.result === "string" ? stripDataUrlPrefix(reader.result) : "");
      });
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });
  }
  function stripDataUrlPrefix(value) {
    const commaIndex = value.indexOf(",");
    return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  }
  function classifyDataTransferFileItem(item) {
    const file = item.getAsFile();
    if (file?.name) {
      return getPromptImageFileRejections([file]).length > 0 ? "invalid" : "valid";
    }
    if (item.type) {
      return isSupportedPromptImageMimeType(item.type) ? "valid" : "invalid";
    }
    return "neutral";
  }
  function isSupportedPromptImageMimeType(value) {
    return value === "image/png" || value === "image/jpeg" || value === "image/gif" || value === "image/webp";
  }
  function getDroppedUriTexts(dataTransfer) {
    const uriList = parseDroppedUriText(dataTransfer.getData("text/uri-list"));
    if (uriList.length > 0) {
      return uriList;
    }
    return parseDroppedUriText(dataTransfer.getData("text/plain"));
  }
  function parseDroppedUriText(value) {
    return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#")).filter(isDroppedUriText);
  }
  function isDroppedUriText(value) {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
  }

  // src/webview/composer/fileSuggestions.ts
  var fileSuggestionDelimiters = /* @__PURE__ */ new Set([" ", "	", "\n", "\r", '"', "'", "="]);
  function extractAtFilePrefix(textBeforeCursor) {
    const quotedPrefix = extractQuotedAtFilePrefix(textBeforeCursor);
    if (quotedPrefix) {
      return quotedPrefix;
    }
    const lastDelimiterIndex = findLastFileSuggestionDelimiter(textBeforeCursor);
    const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
    if (textBeforeCursor[tokenStart] === "@") {
      return { prefix: textBeforeCursor.slice(tokenStart), start: tokenStart };
    }
    return void 0;
  }
  function getFileSuggestionPrefixInfo(textarea2) {
    const cursor = textarea2.selectionStart;
    if (cursor !== textarea2.selectionEnd) {
      return void 0;
    }
    return extractAtFilePrefix(textarea2.value.slice(0, cursor));
  }
  function acceptFileSuggestion(textarea2, file) {
    const prefixInfo = getFileSuggestionPrefixInfo(textarea2);
    if (!prefixInfo) {
      return false;
    }
    const cursor = textarea2.selectionStart;
    const beforePrefix = textarea2.value.slice(0, prefixInfo.start);
    const afterCursor = textarea2.value.slice(cursor);
    const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
    const hasTrailingQuoteInItem = file.value.endsWith('"');
    const adjustedAfterCursor = hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
    const suffix = file.directory ? "" : " ";
    const nextValue = beforePrefix + file.value + suffix + adjustedAfterCursor;
    const cursorOffset = file.directory && hasTrailingQuoteInItem ? file.value.length - 1 : file.value.length;
    const nextCursor = beforePrefix.length + cursorOffset + suffix.length;
    textarea2.value = nextValue;
    textarea2.setSelectionRange(nextCursor, nextCursor);
    return true;
  }
  function isFileSuggestionsResult(message) {
    if (!isRecord2(message) || message.type !== "fileSuggestionsResult") {
      return false;
    }
    return typeof message.id === "string" && typeof message.prefix === "string" && Array.isArray(message.items) && message.items.every(isFileSuggestion);
  }
  function extractQuotedAtFilePrefix(textBeforeCursor) {
    let inQuotes = false;
    let quoteStart = -1;
    for (let index = 0; index < textBeforeCursor.length; index += 1) {
      if (textBeforeCursor[index] === '"') {
        inQuotes = !inQuotes;
        if (inQuotes) {
          quoteStart = index;
        }
      }
    }
    if (!inQuotes || quoteStart <= 0 || textBeforeCursor[quoteStart - 1] !== "@") {
      return void 0;
    }
    const atStart = quoteStart - 1;
    if (atStart > 0 && !fileSuggestionDelimiters.has(textBeforeCursor[atStart - 1] ?? "")) {
      return void 0;
    }
    return { prefix: textBeforeCursor.slice(atStart), start: atStart };
  }
  function findLastFileSuggestionDelimiter(text) {
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (fileSuggestionDelimiters.has(text[index] ?? "")) {
        return index;
      }
    }
    return -1;
  }
  function isFileSuggestion(value) {
    return isRecord2(value) && typeof value.value === "string" && typeof value.label === "string" && ("description" in value ? typeof value.description === "string" : true) && typeof value.directory === "boolean";
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null;
  }

  // src/webview/composer/suggestionMenuController.ts
  var SuggestionMenuController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    open = false;
    activeIndex = 0;
    pointerHoverEnabled = false;
    slashItems = [];
    slashQuery = "";
    dismissedSlashQuery;
    slashCommandsRefreshRequested = false;
    kind;
    commandOptionItems = [];
    commandOptionQuery = "";
    commandOptionProvider;
    fileItems = [];
    filePrefix = "";
    fileRequestId = 0;
    fileLoading = false;
    completionItems = [];
    completionRequestId = 0;
    completionLoading = false;
    completionText = "";
    completionSelectionStart = 0;
    completionSelectionEnd = 0;
    completionRevision = 0;
    completionCapabilities = { triggerCharacters: ["@"], generation: 0 };
    isOpen() {
      return this.open;
    }
    dismiss() {
      this.dismissedSlashQuery = this.kind === "slash" ? this.getSlashCommandQuery() : void 0;
      this.close();
    }
    close() {
      this.open = false;
      this.slashCommandsRefreshRequested = false;
      this.slashItems = [];
      this.activeIndex = 0;
      this.slashQuery = "";
      this.kind = void 0;
      this.commandOptionItems = [];
      this.commandOptionQuery = "";
      this.commandOptionProvider = void 0;
      this.fileItems = [];
      this.filePrefix = "";
      this.fileLoading = false;
      this.completionItems = [];
      this.completionLoading = false;
      this.completionText = "";
      this.completionRevision += 1;
      this.disablePointerHover();
      this.options.slashMenuElement?.removeAttribute("open");
      this.options.slashMenuElement?.setAttribute("aria-label", "Slash commands");
      this.options.textarea.setAttribute("aria-expanded", "false");
      this.options.textarea.removeAttribute("aria-activedescendant");
    }
    handleHostMessage(message) {
      if (isComposerCompletionCapabilities(message)) {
        this.completionCapabilities = message;
        this.sync();
        return true;
      }
      if (isComposerCompletionsResult(message)) {
        if (message.id !== String(this.completionRequestId) || message.revision !== this.completionRevision || this.options.textarea.value !== this.completionText || this.options.textarea.selectionStart !== this.completionSelectionStart || this.options.textarea.selectionEnd !== this.completionSelectionEnd) {
          return true;
        }
        this.completionCapabilities = message.capabilities;
        this.completionLoading = false;
        this.completionItems = message.items;
        this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.completionItems.length - 1));
        this.renderCompletionMenu();
        this.openMenu();
        return true;
      }
      if (isComposerCompletionApplied(message)) {
        if (message.id !== String(this.completionRequestId) || message.revision !== this.completionRevision) {
          return true;
        }
        this.options.textarea.value = message.text;
        this.options.textarea.setSelectionRange(message.selectionStart, message.selectionEnd);
        this.close();
        this.options.syncComposer({ preserveBottom: true });
        this.options.focusPromptInput();
        return true;
      }
      if (!isFileSuggestionsResult(message)) {
        return false;
      }
      if (message.id !== String(this.fileRequestId) || message.prefix !== this.filePrefix) {
        return true;
      }
      const activePrefix = getFileSuggestionPrefixInfo(this.options.textarea)?.prefix;
      if (activePrefix !== message.prefix) {
        return true;
      }
      this.fileLoading = false;
      this.fileItems = message.items;
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.fileItems.length - 1));
      this.renderFileMenu(message.prefix);
      this.openMenu();
      return true;
    }
    sync() {
      const completionPrefix = getComposerCompletionPrefix(this.options.textarea, this.completionCapabilities.triggerCharacters);
      if (completionPrefix) {
        this.syncCompletionMenu();
        return;
      }
      const filePrefix = getFileSuggestionPrefixInfo(this.options.textarea)?.prefix;
      if (filePrefix) {
        this.syncFileMenu(filePrefix);
        return;
      }
      const state2 = this.options.getState();
      const commandOptionQuery = this.getCommandOptionQuery();
      if (!this.shouldShowSlashMenu() && commandOptionQuery === void 0) {
        this.close();
        return;
      }
      this.options.closeModelMenu();
      this.options.cancelSessionNameEdit();
      if (commandOptionQuery !== void 0) {
        this.syncCommandOptionMenu(commandOptionQuery);
        return;
      }
      if (state2.slashCommands.length === 0 && !state2.slashCommandsRefreshing && !this.slashCommandsRefreshRequested) {
        this.slashCommandsRefreshRequested = true;
        this.options.postMessage({ type: "refreshSlashCommands" });
      }
      const query = this.getSlashCommandQuery();
      if (query === this.dismissedSlashQuery) {
        this.close();
        return;
      }
      if (this.kind !== "slash" || query !== this.slashQuery) {
        this.kind = "slash";
        this.commandOptionItems = [];
        this.commandOptionQuery = "";
        this.commandOptionProvider = void 0;
        this.fileItems = [];
        this.fileLoading = false;
        this.slashQuery = query;
        this.activeIndex = 0;
        this.disablePointerHover();
        if (this.options.slashMenuElement) {
          this.options.slashMenuElement.scrollTop = 0;
        }
      }
      this.slashItems = this.getFilteredSlashCommands(query);
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.slashItems.length - 1));
      this.renderSlashMenu(query);
      this.openMenu();
    }
    clearDismissedSlashQuery() {
      this.dismissedSlashQuery = void 0;
    }
    handleKeydown(event) {
      if (!this.open) {
        if (event.key === "Escape") {
          this.dismiss();
        }
        return false;
      }
      this.disablePointerHover();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveSelection(-1);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        this.acceptActiveSuggestion();
        return true;
      }
      if (event.key === "Enter" && !event.shiftKey && this.getActiveSuggestionCount() > 0) {
        event.preventDefault();
        this.acceptActiveSuggestion();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
        return true;
      }
      return false;
    }
    handlePointerMove(event) {
      if (!this.open) {
        return;
      }
      this.enablePointerHover();
      const item = eventTargetElement(event)?.closest(".composer__slash-item");
      if (!(item instanceof HTMLElement) || !this.options.slashMenuElement?.contains(item)) {
        return;
      }
      const index = Number(item.getAttribute("data-index"));
      if (!Number.isInteger(index) || index < 0 || index >= this.getActiveSuggestionCount()) {
        return;
      }
      const previousIndex = this.activeIndex;
      if (index === previousIndex) {
        return;
      }
      this.activeIndex = index;
      this.updateRenderedSelection(previousIndex);
    }
    handleClick(event) {
      const item = eventTargetElement(event)?.closest(".composer__slash-item");
      if (!item) {
        return;
      }
      const index = Number(item.getAttribute("data-index"));
      if (this.kind === "completion") {
        const item2 = this.completionItems[index];
        if (item2) {
          this.acceptCompletion(item2);
        }
        return;
      }
      if (this.kind === "file") {
        const file = this.fileItems[index];
        if (file) {
          this.acceptFile(file);
        }
        return;
      }
      if (this.kind === "commandOption") {
        const command2 = this.commandOptionItems[index];
        if (command2) {
          this.acceptCommandOption(command2);
        }
        return;
      }
      const command = this.slashItems[index];
      if (command) {
        this.acceptSlashCommand(command);
      }
    }
    syncCompletionMenu() {
      if (document.activeElement !== this.options.textarea) {
        this.close();
        return;
      }
      this.options.closeModelMenu();
      this.options.cancelSessionNameEdit();
      const text = this.options.textarea.value;
      const selectionStart = this.options.textarea.selectionStart;
      const selectionEnd = this.options.textarea.selectionEnd;
      if (this.kind !== "completion" || text !== this.completionText || selectionStart !== this.completionSelectionStart || selectionEnd !== this.completionSelectionEnd) {
        this.kind = "completion";
        this.fileItems = [];
        this.completionItems = [];
        this.completionText = text;
        this.completionSelectionStart = selectionStart;
        this.completionSelectionEnd = selectionEnd;
        this.completionLoading = true;
        this.activeIndex = 0;
        this.completionRequestId += 1;
        this.completionRevision += 1;
        this.options.postMessage({
          type: "requestComposerCompletions",
          id: String(this.completionRequestId),
          revision: this.completionRevision,
          text,
          selectionStart,
          selectionEnd
        });
      }
      this.renderCompletionMenu();
      this.openMenu();
    }
    syncFileMenu(prefix) {
      if (document.activeElement !== this.options.textarea) {
        this.close();
        return;
      }
      this.options.closeModelMenu();
      this.options.cancelSessionNameEdit();
      if (this.kind !== "file" || prefix !== this.filePrefix) {
        this.kind = "file";
        this.slashItems = [];
        this.commandOptionItems = [];
        this.commandOptionQuery = "";
        this.commandOptionProvider = void 0;
        this.fileItems = [];
        this.filePrefix = prefix;
        this.fileLoading = true;
        this.activeIndex = 0;
        this.disablePointerHover();
        this.options.slashMenuElement?.scrollTo({ top: 0 });
        this.fileRequestId += 1;
        this.options.postMessage({
          type: "requestFileSuggestions",
          id: String(this.fileRequestId),
          prefix
        });
      }
      this.renderFileMenu(prefix);
      this.openMenu();
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
    getCommandOptionQuery() {
      const state2 = this.options.getState();
      if (state2.busy || document.activeElement !== this.options.textarea) {
        return void 0;
      }
      const cursor = this.options.textarea.selectionStart;
      if (cursor !== this.options.textarea.selectionEnd) {
        return void 0;
      }
      const beforeCursor = this.options.textarea.value.slice(0, cursor);
      const match = beforeCursor.match(/^\/([^\s]*)(?:\s+(.*))?$/);
      if (!match) {
        return void 0;
      }
      const commandQuery = match[1].toLowerCase();
      if (!commandQuery) {
        return void 0;
      }
      const argQuery = (match[2] ?? "").toLowerCase();
      const matchingProviders = this.getCommandOptionProviders().filter((provider2) => provider2.name.startsWith(commandQuery));
      if (matchingProviders.length !== 1) {
        return void 0;
      }
      const provider = matchingProviders[0];
      const matchingCommands = this.getAllSlashCommands().filter((command) => command.name.toLowerCase().startsWith(commandQuery));
      if (matchingCommands.some((command) => command.name !== provider.name)) {
        return void 0;
      }
      return { provider, query: commandQuery === provider.name ? argQuery : "" };
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
      const backend = state2.settings.values["tauren.backend"];
      const commands = webviewLocalSlashCommands.filter((command) => command.name !== "memory" || backend === "kward");
      if (backend === "kward") {
        commands.push(...webviewKwardLocalSlashCommands);
      }
      const names = /* @__PURE__ */ new Set([
        ...commands.map((command) => command.name),
        ...webviewHiddenLocalSlashCommandNames
      ]);
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
    syncCommandOptionMenu(optionQuery) {
      const providerChanged = this.commandOptionProvider?.name !== optionQuery.provider.name;
      if (this.kind !== "commandOption" || providerChanged || optionQuery.query !== this.commandOptionQuery) {
        this.kind = "commandOption";
        this.slashItems = [];
        this.fileItems = [];
        this.fileLoading = false;
        this.commandOptionQuery = optionQuery.query;
        this.commandOptionProvider = optionQuery.provider;
        this.activeIndex = 0;
        this.disablePointerHover();
        this.options.slashMenuElement?.scrollTo({ top: 0 });
      }
      this.commandOptionItems = this.getFilteredCommandOptions(optionQuery.provider, optionQuery.query);
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.commandOptionItems.length - 1));
      this.renderCommandOptionMenu(optionQuery);
      this.openMenu();
    }
    getFilteredCommandOptions(provider, query) {
      const normalizedQuery = query.trim().toLowerCase();
      const scored = [];
      for (const option of provider.options) {
        const command = option.command.toLowerCase();
        const description = option.description.toLowerCase();
        const commandPrefix = command.startsWith(normalizedQuery);
        const commandMatch = command.includes(normalizedQuery);
        const descriptionMatch = description.includes(normalizedQuery);
        if (!commandMatch && !descriptionMatch) {
          continue;
        }
        scored.push({
          option,
          score: commandPrefix ? 0 : commandMatch ? 1 : 2
        });
      }
      return scored.sort((left, right) => left.score - right.score || left.option.command.localeCompare(right.option.command)).slice(0, 8).map((item) => item.option);
    }
    getCommandOptionProviders() {
      const state2 = this.options.getState();
      const providers = [];
      if (state2.settings.values["tauren.backend"] === "kward") {
        providers.push({ name: "memory", source: "memory", options: webviewKwardMemoryCommandOptions });
      }
      return providers;
    }
    renderSlashMenu(query) {
      const slashMenuElement2 = this.options.slashMenuElement;
      if (!slashMenuElement2) {
        return;
      }
      const state2 = this.options.getState();
      slashMenuElement2.replaceChildren();
      if (state2.slashCommandsRefreshing && this.slashItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement("Loading commands..."));
        return;
      }
      if (this.slashItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement(query ? "No matching slash commands" : "No slash commands available"));
        return;
      }
      for (let index = 0; index < this.slashItems.length; index += 1) {
        slashMenuElement2.append(this.createSlashMenuItemElement(this.slashItems[index], index));
      }
      this.syncActiveDescendant();
    }
    renderCommandOptionMenu(optionQuery) {
      const slashMenuElement2 = this.options.slashMenuElement;
      if (!slashMenuElement2) {
        return;
      }
      slashMenuElement2.replaceChildren();
      if (this.commandOptionItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement(optionQuery.query ? `No matching ${optionQuery.provider.source} commands` : `No ${optionQuery.provider.source} commands available`));
        return;
      }
      for (let index = 0; index < this.commandOptionItems.length; index += 1) {
        slashMenuElement2.append(this.createCommandOptionSuggestionItemElement(optionQuery.provider, this.commandOptionItems[index], index));
      }
      this.syncActiveDescendant();
    }
    renderCompletionMenu() {
      const menu = this.options.slashMenuElement;
      if (!menu) {
        return;
      }
      menu.replaceChildren();
      if (this.completionLoading) {
        menu.append(createSlashMenuEmptyElement("Finding suggestions..."));
        return;
      }
      if (this.completionItems.length === 0) {
        menu.append(createSlashMenuEmptyElement("No matching suggestions"));
        return;
      }
      for (let index = 0; index < this.completionItems.length; index += 1) {
        const completion = this.completionItems[index];
        const item = this.createSuggestionBaseElement(index);
        const label = document.createElement("span");
        label.className = "composer__slash-label";
        label.textContent = completion.label;
        item.append(label);
        if (completion.description) {
          const description = document.createElement("span");
          description.className = "composer__slash-description";
          description.textContent = completion.description;
          item.append(description);
        }
        menu.append(item);
      }
      this.syncActiveDescendant();
    }
    renderFileMenu(prefix) {
      const slashMenuElement2 = this.options.slashMenuElement;
      if (!slashMenuElement2) {
        return;
      }
      slashMenuElement2.replaceChildren();
      if (this.fileLoading && this.fileItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement("Finding files..."));
        return;
      }
      if (this.fileItems.length === 0) {
        slashMenuElement2.append(createSlashMenuEmptyElement(prefix.length > 1 ? "No matching files" : "No files available"));
        return;
      }
      for (let index = 0; index < this.fileItems.length; index += 1) {
        slashMenuElement2.append(this.createFileSuggestionItemElement(this.fileItems[index], index));
      }
      this.syncActiveDescendant();
    }
    createSuggestionBaseElement(index) {
      const item = document.createElement("button");
      item.type = "button";
      item.id = "slash-command-" + index;
      item.className = "composer__slash-item" + (index === this.activeIndex ? " composer__slash-item--active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === this.activeIndex ? "true" : "false");
      item.setAttribute("data-index", String(index));
      return item;
    }
    createFileSuggestionItemElement(file, index) {
      const item = this.createSuggestionBaseElement(index);
      const label = document.createElement("span");
      label.className = "composer__slash-label";
      label.textContent = file.label;
      item.append(label);
      const source = document.createElement("span");
      source.className = "composer__slash-source";
      source.textContent = file.directory ? "dir" : "file";
      item.append(source);
      if (file.description) {
        const description = document.createElement("span");
        description.className = "composer__slash-description";
        description.textContent = file.description;
        item.append(description);
      }
      return item;
    }
    createCommandOptionSuggestionItemElement(provider, command, index) {
      const item = this.createSuggestionBaseElement(index);
      const label = document.createElement("span");
      label.className = "composer__slash-label";
      label.textContent = "/" + provider.name + " " + command.command;
      item.append(label);
      const source = document.createElement("span");
      source.className = "composer__slash-source";
      source.textContent = provider.source;
      item.append(source);
      const description = document.createElement("span");
      description.className = "composer__slash-description";
      description.textContent = command.description;
      item.append(description);
      return item;
    }
    createSlashMenuItemElement(command, index) {
      const item = this.createSuggestionBaseElement(index);
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
    openMenu() {
      if (!this.options.slashMenuElement) {
        return;
      }
      this.open = true;
      this.options.slashMenuElement.setAttribute("open", "");
      this.options.slashMenuElement.setAttribute("aria-label", this.kind === "completion" ? "Suggestions" : this.kind === "file" ? "File suggestions" : this.kind === "commandOption" ? "Slash command options" : "Slash commands");
      this.options.textarea.setAttribute("aria-expanded", "true");
      this.syncActiveDescendant();
    }
    moveSelection(delta) {
      const itemCount = this.getActiveSuggestionCount();
      if (itemCount === 0) {
        return;
      }
      this.activeIndex = (this.activeIndex + delta + itemCount) % itemCount;
      if (this.kind === "completion") {
        this.renderCompletionMenu();
      } else if (this.kind === "file") {
        this.renderFileMenu(this.filePrefix);
      } else if (this.kind === "commandOption" && this.commandOptionProvider) {
        this.renderCommandOptionMenu({ provider: this.commandOptionProvider, query: this.commandOptionQuery });
      } else {
        this.renderSlashMenu(this.getSlashCommandQuery());
      }
    }
    enablePointerHover() {
      if (this.pointerHoverEnabled) {
        return;
      }
      this.pointerHoverEnabled = true;
      this.options.slashMenuElement?.classList.add("composer__slash-menu--pointer-hover");
    }
    disablePointerHover() {
      if (!this.pointerHoverEnabled) {
        return;
      }
      this.pointerHoverEnabled = false;
      this.options.slashMenuElement?.classList.remove("composer__slash-menu--pointer-hover");
    }
    updateRenderedSelection(previousIndex) {
      this.updateRenderedItemSelection(previousIndex, false);
      this.updateRenderedItemSelection(this.activeIndex, true);
      this.syncActiveDescendant({ reveal: false });
    }
    updateRenderedItemSelection(index, selected) {
      const item = document.getElementById("slash-command-" + index);
      if (!item) {
        return;
      }
      item.classList.toggle("composer__slash-item--active", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    }
    syncActiveDescendant(options = {}) {
      if (!this.open || this.getActiveSuggestionCount() === 0) {
        this.options.textarea.removeAttribute("aria-activedescendant");
        return;
      }
      this.options.textarea.setAttribute("aria-activedescendant", "slash-command-" + this.activeIndex);
      if (options.reveal !== false) {
        this.options.slashMenuElement?.querySelector(".composer__slash-item--active")?.scrollIntoView({ block: "nearest" });
      }
    }
    acceptActiveSuggestion() {
      if (this.kind === "completion") {
        const item = this.completionItems[this.activeIndex];
        if (item) {
          this.acceptCompletion(item);
        }
        return;
      }
      if (this.kind === "file") {
        const file = this.fileItems[this.activeIndex];
        if (file) {
          this.acceptFile(file);
        }
        return;
      }
      if (this.kind === "commandOption") {
        const command2 = this.commandOptionItems[this.activeIndex];
        if (command2) {
          this.acceptCommandOption(command2);
        }
        return;
      }
      const command = this.slashItems[this.activeIndex];
      if (command) {
        this.acceptSlashCommand(command);
      }
    }
    getActiveSuggestionCount() {
      return this.kind === "completion" ? this.completionItems.length : this.kind === "file" ? this.fileItems.length : this.kind === "commandOption" ? this.commandOptionItems.length : this.slashItems.length;
    }
    acceptSlashCommand(command) {
      const cursor = this.options.textarea.selectionStart;
      const after = this.options.textarea.value.slice(cursor).trimStart();
      const value = "/" + command.name + " " + after;
      const nextCursor = command.name.length + 2;
      this.options.textarea.value = value;
      this.options.textarea.setSelectionRange(nextCursor, nextCursor);
      this.close();
      this.options.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    acceptCommandOption(command) {
      const provider = this.commandOptionProvider;
      if (!provider) {
        return;
      }
      const cursor = this.options.textarea.selectionStart;
      const after = this.options.textarea.value.slice(cursor).trimStart();
      const insertText = command.insertText ?? command.command;
      const value = "/" + provider.name + " " + insertText + " " + after;
      const nextCursor = provider.name.length + insertText.length + 3;
      this.options.textarea.value = value;
      this.options.textarea.setSelectionRange(nextCursor, nextCursor);
      this.close();
      this.options.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    acceptCompletion(item) {
      this.options.postMessage({ type: "applyComposerCompletion", id: String(this.completionRequestId), revision: this.completionRevision, itemId: item.id });
    }
    acceptFile(file) {
      if (!acceptFileSuggestion(this.options.textarea, file)) {
        return;
      }
      this.close();
      this.options.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
  };
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
  function getComposerCompletionPrefix(textarea2, triggerCharacters) {
    if (textarea2.selectionStart !== textarea2.selectionEnd) {
      return void 0;
    }
    const beforeCursor = textarea2.value.slice(0, textarea2.selectionStart);
    const triggerSet = new Set(triggerCharacters);
    for (let index = beforeCursor.length - 1; index >= 0; index -= 1) {
      const character = beforeCursor[index] ?? "";
      if (triggerSet.has(character)) {
        const beforeTrigger = beforeCursor[index - 1];
        if (index === 0 || beforeTrigger === void 0 || /[\s='\"]/.test(beforeTrigger)) {
          return beforeCursor.slice(index);
        }
        return void 0;
      }
      if (/[\s]/.test(character)) {
        return void 0;
      }
    }
    return void 0;
  }
  function isComposerCompletionsResult(value) {
    return isRecord3(value) && value.type === "composerCompletionsResult" && typeof value.id === "string" && typeof value.revision === "number" && Number.isInteger(value.revision) && isComposerCompletionCapabilities(value.capabilities) && Array.isArray(value.items) && value.items.every((item) => isRecord3(item) && typeof item.id === "string" && typeof item.value === "string" && typeof item.label === "string" && (item.description === void 0 || typeof item.description === "string"));
  }
  function isComposerCompletionCapabilities(value) {
    return isRecord3(value) && value.type === "composerCompletionCapabilities" && typeof value.generation === "number" && Number.isInteger(value.generation) && Array.isArray(value.triggerCharacters) && value.triggerCharacters.every((character) => typeof character === "string" && Array.from(character).length === 1);
  }
  function isComposerCompletionApplied(value) {
    return isRecord3(value) && value.type === "composerCompletionApplied" && typeof value.id === "string" && typeof value.revision === "number" && Number.isInteger(value.revision) && typeof value.text === "string" && typeof value.selectionStart === "number" && typeof value.selectionEnd === "number" && Number.isInteger(value.selectionStart) && Number.isInteger(value.selectionEnd) && value.selectionStart >= 0 && value.selectionEnd >= 0 && value.selectionStart <= value.text.length && value.selectionEnd <= value.text.length;
  }
  function isRecord3(value) {
    return typeof value === "object" && value !== null;
  }

  // src/webview/composer/composer.ts
  var ComposerController = class {
    constructor(options) {
      this.options = options;
      this.addedDiffCounter = createDiffCounter(options.diffAddedElement, "+");
      this.removedDiffCounter = createDiffCounter(options.diffRemovedElement, "-");
      this.modelPicker = new ModelPickerController({
        getState: options.getState,
        postMessage: options.postMessage,
        refreshMetadata: options.refreshMetadata,
        modelElement: options.modelElement,
        modelMenuElement: options.modelMenuElement,
        modelSelectElement: options.modelSelectElement,
        thinkingSelectElement: options.thinkingSelectElement,
        closeSuggestionMenu: () => this.suggestionMenu.close(),
        cancelSessionNameEdit: options.cancelSessionNameEdit
      });
      this.suggestionMenu = new SuggestionMenuController({
        getState: options.getState,
        postMessage: options.postMessage,
        textarea: options.textarea,
        slashMenuElement: options.slashMenuElement,
        closeModelMenu: () => this.modelPicker.closeMenu(),
        cancelSessionNameEdit: options.cancelSessionNameEdit,
        syncComposer: (syncOptions) => this.syncComposer(syncOptions),
        focusPromptInput: options.focusPromptInput
      });
    }
    options;
    appliedComposerTextRevision = 0;
    streamingBehavior = "steer";
    busySubmitHideTimeout;
    composerDragDepth = 0;
    voiceStarting = false;
    textareaLayoutSignature = "";
    promptContextBadgesSignature = "";
    cachedMaxTextareaHeight = maxTextareaHeight;
    pasteBuffer = new ComposerPasteBuffer();
    addedDiffCounter;
    removedDiffCounter;
    modelPicker;
    suggestionMenu;
    attachEventListeners() {
      this.options.form.addEventListener("submit", (event) => this.handleSubmit(event));
      this.options.form.addEventListener("dragenter", (event) => this.handleComposerDragEnter(event));
      this.options.form.addEventListener("dragover", (event) => this.handleComposerDragOver(event));
      this.options.form.addEventListener("dragleave", (event) => this.handleComposerDragLeave(event));
      this.options.form.addEventListener("drop", (event) => {
        void this.handleComposerDrop(event);
      });
      this.options.textarea.addEventListener("paste", (event) => {
        void this.handleComposerPaste(event);
      });
      this.options.submitButton.addEventListener("click", (event) => this.handleSubmitButtonClick(event));
      this.options.attachButton.addEventListener("click", () => {
        this.options.postMessage({ type: "selectPromptImages" });
        this.options.focusPromptInput();
      });
      this.options.voiceButton.addEventListener("click", () => this.handleVoiceButtonClick());
      this.options.voiceButton.addEventListener("pointerdown", (event) => this.handleVoicePointerDown(event));
      this.options.voiceButton.addEventListener("pointerup", () => this.handleVoicePointerUp());
      this.options.voiceButton.addEventListener("pointercancel", () => this.handleVoicePointerUp());
      this.options.voiceButton.addEventListener("lostpointercapture", () => this.handleVoicePointerUp());
      for (const button of this.options.streamingBehaviorButtonElements) {
        button.addEventListener("click", () => this.selectStreamingBehavior(button));
      }
      this.options.modelElement.addEventListener("click", () => this.modelPicker.toggleMenu());
      this.options.modelMenuElement?.addEventListener("keydown", (event) => this.modelPicker.handleMenuKeydown(event), true);
      this.options.modelSelectElement.addEventListener("change", () => this.modelPicker.selectModel());
      this.options.thinkingSelectElement.addEventListener("change", () => this.modelPicker.selectThinkingLevel());
      window.addEventListener("resize", () => this.syncPromptContextBadgeOverflow());
      this.options.textarea.addEventListener("keydown", (event) => {
        if (this.suggestionMenu.handleKeydown(event)) {
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.options.form.requestSubmit();
        }
      });
      this.options.textarea.addEventListener("input", () => {
        this.options.measurePerfEvent("composer.input", () => {
          this.suggestionMenu.clearDismissedSlashQuery();
          this.syncComposer({ preserveBottom: true });
          this.options.measurePerfEvent("composer.slashMenuSync", () => this.syncSlashMenu());
        });
      });
      this.options.textarea.addEventListener("click", () => this.syncSlashMenu());
      this.options.textarea.addEventListener("select", () => this.syncSlashMenu());
      this.options.textarea.addEventListener("blur", () => this.closeSlashMenu());
      this.options.textarea.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
          this.syncSlashMenu();
        }
      });
      this.options.slashMenuElement?.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      this.options.slashMenuElement?.addEventListener("pointermove", (event) => this.suggestionMenu.handlePointerMove(event));
      this.options.slashMenuElement?.addEventListener("click", (event) => this.suggestionMenu.handleClick(event));
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
        const contextId = removeButton.getAttribute("data-context-id");
        const imageId = removeButton.getAttribute("data-image-id");
        if (contextId) {
          this.options.postMessage({ type: "removePromptContext", id: contextId });
        } else if (imageId) {
          this.options.postMessage({ type: "removePromptImage", id: imageId });
        } else {
          return;
        }
        this.options.focusPromptInput();
      });
    }
    handleWindowClick(target) {
      if (this.options.modelMenuElement?.hasAttribute("open")) {
        if (!this.options.modelMenuElement.contains(target) && !this.options.modelElement.contains(target)) {
          this.closeModelMenu();
        }
      }
      if (this.suggestionMenu.isOpen()) {
        if (!this.options.slashMenuElement?.contains(target) && target !== this.options.textarea) {
          this.closeSlashMenu();
        }
      }
    }
    hasSlashMenuOpen() {
      return this.suggestionMenu.isOpen();
    }
    hasModelMenuOpen() {
      return this.modelPicker.hasOpenMenu();
    }
    dismissSlashMenu() {
      this.suggestionMenu.dismiss();
    }
    closeSlashMenu() {
      this.suggestionMenu.close();
    }
    handleHostMessage(message) {
      return this.suggestionMenu.handleHostMessage(message);
    }
    closeModelMenu() {
      this.modelPicker.closeMenu();
    }
    openModelPicker() {
      this.modelPicker.openPicker();
    }
    syncPromptContextBadges() {
      if (!this.options.contextBadgesElement) {
        return;
      }
      const attachments = this.getPromptContextAttachments();
      const images = this.getPromptImageAttachments();
      const nextSignature = this.getPromptContextBadgesSignature(attachments, images);
      if (nextSignature === this.promptContextBadgesSignature) {
        return;
      }
      this.promptContextBadgesSignature = nextSignature;
      const hasAttachments = attachments.length > 0 || images.length > 0;
      this.options.form.classList.toggle("composer--has-context", hasAttachments);
      this.options.contextBadgesElement.hidden = !hasAttachments;
      this.options.contextBadgesElement.replaceChildren();
      for (const attachment of attachments) {
        const badge = document.createElement("span");
        badge.className = "composer__context-badge";
        badge.classList.toggle("composer__context-badge--origin", attachment.source === "origin");
        const badgeLabel = attachment.source === "origin" ? attachment.label : "Context: " + attachment.label;
        badge.dataset.overflowLabel = badgeLabel;
        badge.dataset.overflowTitle = attachment.title || badgeLabel;
        const label = document.createElement("span");
        label.className = "composer__context-label";
        label.textContent = badgeLabel;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "composer__context-remove";
        remove.setAttribute("data-context-id", attachment.id);
        remove.setAttribute("aria-label", "Remove context " + attachment.label);
        remove.textContent = "\xD7";
        const tooltip = document.createElement("span");
        tooltip.className = "composer__context-badge-tooltip";
        const tooltipCode = attachment.xml || badgeLabel;
        const tooltipPre = document.createElement("pre");
        const tooltipCodeElement = document.createElement("code");
        tooltipCodeElement.className = "language-xml";
        tooltipCodeElement.textContent = tooltipCode;
        tooltipPre.append(tooltipCodeElement);
        tooltip.append(tooltipPre);
        requestCodeHighlight(tooltipCodeElement, tooltipCode, "xml");
        badge.append(label, remove, tooltip);
        this.options.contextBadgesElement.append(badge);
      }
      for (const image of images) {
        const badge = document.createElement("span");
        badge.className = "composer__context-badge composer__context-badge--image";
        badge.dataset.overflowLabel = "Image: " + image.label;
        badge.dataset.overflowTitle = image.title || image.label;
        const label = document.createElement("span");
        label.className = "composer__context-label";
        label.textContent = "Image: " + image.label;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "composer__context-remove";
        remove.setAttribute("data-image-id", image.id);
        remove.setAttribute("aria-label", "Remove image " + image.label);
        remove.textContent = "\xD7";
        const tooltip = document.createElement("span");
        tooltip.className = "composer__context-badge-tooltip";
        const tooltipPre = document.createElement("pre");
        const tooltipCodeElement = document.createElement("code");
        tooltipCodeElement.textContent = `${image.title}
${image.mimeType}, ${formatBytes(image.sizeBytes)}`;
        tooltipPre.append(tooltipCodeElement);
        tooltip.append(tooltipPre);
        badge.append(label, remove, tooltip);
        this.options.contextBadgesElement.append(badge);
      }
      this.syncPromptContextBadgeOverflow();
    }
    syncPromptContextBadgeOverflow() {
      const container = this.options.contextBadgesElement;
      if (!container || container.hidden) {
        return;
      }
      container.querySelector(".composer__context-badge--overflow")?.remove();
      const badges = Array.from(container.querySelectorAll(".composer__context-badge"));
      for (const badge of badges) {
        badge.hidden = false;
      }
      if (badges.length === 0) {
        return;
      }
      for (const badge of getContextBadgesPastSecondRow(badges)) {
        badge.hidden = true;
      }
      let hiddenBadges = badges.filter((badge) => badge.hidden);
      if (hiddenBadges.length === 0) {
        return;
      }
      const overflowBadge = createContextOverflowBadge();
      container.append(overflowBadge);
      updateContextOverflowBadge(overflowBadge, hiddenBadges);
      while (getContextBadgeRowIndex(overflowBadge) > 1) {
        const visibleBadges = badges.filter((badge) => !badge.hidden);
        const badgeToHide = visibleBadges[visibleBadges.length - 1];
        if (!badgeToHide) {
          break;
        }
        badgeToHide.hidden = true;
        hiddenBadges = badges.filter((badge) => badge.hidden);
        updateContextOverflowBadge(overflowBadge, hiddenBadges);
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
      const modelTooltip = state2.metadataRefreshing ? label + " (refreshing...)" : state2.modelOptions.length === 0 && !state2.busy ? "Load model settings" : label;
      this.modelPicker.syncLabel(label, modelTooltip, state2.busy, state2.metadataRefreshing);
    }
    applyComposerTextFromState() {
      const state2 = this.options.getState();
      if (state2.composerTextRevision <= this.appliedComposerTextRevision) {
        return;
      }
      this.appliedComposerTextRevision = state2.composerTextRevision;
      if (state2.composerTextMode === "append") {
        const result = appendComposerText(this.options.textarea.value, state2.composerText);
        this.options.textarea.value = result.text;
        this.options.textarea.selectionStart = result.cursor;
        this.options.textarea.selectionEnd = result.cursor;
        this.revealTextareaEnd();
      } else {
        this.options.textarea.value = state2.composerText;
      }
      this.pasteBuffer.clear();
      this.closeSlashMenu();
      this.syncComposer({ preserveBottom: true });
      if (state2.composerTextMode === "append") {
        this.revealTextareaEnd();
      }
      this.options.focusPromptInput();
    }
    revealTextareaEnd() {
      const textarea2 = this.options.textarea;
      textarea2.scrollTop = textarea2.scrollHeight;
      requestAnimationFrame(() => {
        textarea2.scrollTop = textarea2.scrollHeight;
      });
    }
    pasteToEditor(text) {
      const textarea2 = this.options.textarea;
      const result = this.pasteBuffer.paste(
        textarea2.value,
        text,
        textarea2.selectionStart,
        textarea2.selectionEnd
      );
      textarea2.value = result.text;
      textarea2.selectionStart = result.cursor;
      textarea2.selectionEnd = result.cursor;
      this.suggestionMenu.clearDismissedSlashQuery();
      this.closeSlashMenu();
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    syncComposer(options = {}) {
      this.options.measurePerfEvent("composer.sync", () => {
        let shouldPreserveBottom = false;
        if (options.preserveBottom) {
          this.options.measurePerfEvent("composer.scrollPreserve", () => {
            shouldPreserveBottom = this.options.isMessagesAtBottom();
          });
        }
        this.syncVoiceButton();
        this.syncSubmit();
        this.syncBusySubmitMode();
        let textareaHeightChanged = false;
        this.options.measurePerfEvent("composer.textareaResize", () => {
          textareaHeightChanged = this.syncTextareaHeightIfNeeded(Boolean(options.forceResize));
        });
        if (textareaHeightChanged && shouldPreserveBottom) {
          this.options.measurePerfEvent("composer.scrollPreserve", () => this.options.scrollMessagesToBottom());
        }
      });
    }
    syncSlashMenu() {
      this.suggestionMenu.sync();
    }
    handleVoiceButtonClick() {
      if (this.options.getState().voice?.mode === "pushToTalk" && this.options.getState().voice?.activationMode === "hold") {
        return;
      }
      this.toggleVoiceRecording();
    }
    handleVoicePointerDown(event) {
      const voice = this.options.getState().voice;
      if (voice?.mode !== "pushToTalk" || voice.activationMode !== "hold" || event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.options.voiceButton.setPointerCapture(event.pointerId);
      this.startVoiceRecording();
    }
    handleVoicePointerUp() {
      const voice = this.options.getState().voice;
      if (voice?.mode !== "pushToTalk" || voice.activationMode !== "hold") {
        return;
      }
      if (this.options.getState().voice?.recordingStatus === "recording") {
        this.showVoiceFeedback("Stopping recording\u2026");
        this.options.postMessage({ type: "voiceStopRecording" });
      }
    }
    toggleVoiceRecording() {
      const voice = this.options.getState().voice;
      const status = voice?.recordingStatus;
      if (status === "recording" || status === "listening") {
        this.showVoiceFeedback("Stopping recording\u2026");
        this.options.postMessage({ type: "voiceStopRecording" });
        return;
      }
      if (status === "transcribing") {
        this.showVoiceFeedback("Stopping voice input\u2026");
        this.options.postMessage({ type: "voiceStopRecording" });
        return;
      }
      this.startVoiceRecording();
    }
    startVoiceRecording() {
      const voice = this.options.getState().voice;
      const selectedModel = voice?.models.find((model) => model.id === voice.selectedModelId);
      const isReady = Boolean(voice?.enabled && voice.binary.status === "downloaded" && selectedModel?.downloaded);
      if (!isReady) {
        this.options.postMessage({ type: "showChatFace", chatFace: "settings" });
        this.options.postMessage({ type: "setSettingsSection", section: "voice" });
        return;
      }
      this.voiceStarting = true;
      this.syncVoiceButton();
      this.showVoiceFeedback("Starting recording\u2026");
      this.options.postMessage({ type: "voiceStartRecording" });
    }
    showVoiceFeedback(message) {
      const tooltip = this.options.voiceButton.querySelector(".composer__button-tooltip, .tauren-icon-action-tooltip");
      if (tooltip) {
        tooltip.textContent = message;
      }
    }
    syncVoiceButton() {
      const voice = this.options.getState().voice;
      const button = this.options.voiceButton;
      const tooltip = button.querySelector(".composer__button-tooltip, .tauren-icon-action-tooltip");
      const enabled = voice?.enabled === true;
      const selectedModel = voice?.models.find((model) => model.id === voice.selectedModelId);
      if (voice?.recordingStatus === "listening" || voice?.recordingStatus === "recording" || voice?.recordingStatus === "transcribing" || voice?.recordingStatus === "error") {
        this.voiceStarting = false;
      }
      const isStarting = enabled && this.voiceStarting;
      const isListening = enabled && voice?.recordingStatus === "listening";
      const isRecording = enabled && voice?.recordingStatus === "recording";
      const isTranscribing = voice?.recordingStatus === "transcribing";
      const isReady = Boolean(voice && voice.binary.status === "downloaded" && selectedModel?.downloaded);
      const audioLevel = voice?.audioLevel ?? 0;
      button.style.setProperty("--voice-level", audioLevel.toFixed(3));
      button.hidden = !enabled;
      button.style.display = enabled ? "" : "none";
      button.classList.toggle("composer__voice--starting", isStarting);
      button.classList.toggle("composer__voice--listening", isListening);
      button.classList.toggle("composer__voice--recording", isRecording);
      button.classList.toggle("composer__voice--transcribing", isTranscribing);
      button.disabled = false;
      button.setAttribute("aria-label", isRecording || isListening || isStarting || isTranscribing ? "Stop voice input" : "Start voice input");
      if (tooltip) {
        tooltip.textContent = isStarting ? "Starting voice input\u2026" : isRecording ? "Stop voice input" : isListening ? "Listening\u2026 click to stop" : voice?.recordingStatus === "error" && voice.error ? voice.error : isTranscribing ? "Transcribing\u2026 click to stop" : isReady ? "Start voice input" : "Start voice input (setup required)";
      }
    }
    toggleStreamingBehavior() {
      if (!this.options.getState().busy) {
        return;
      }
      this.streamingBehavior = this.streamingBehavior === "steer" ? "followUp" : "steer";
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
    handlePromptEscape() {
      if (document.activeElement !== this.options.textarea) {
        return false;
      }
      if (this.options.textarea.value.length > 0) {
        this.options.textarea.value = "";
        this.pasteBuffer.clear();
        this.suggestionMenu.clearDismissedSlashQuery();
        this.closeSlashMenu();
        this.syncComposer({ preserveBottom: true });
        return true;
      }
      const attachments = this.getPromptContextAttachments();
      const images = this.getPromptImageAttachments();
      if (attachments.length === 0 && images.length === 0) {
        return false;
      }
      for (const attachment of attachments) {
        this.options.postMessage({ type: "removePromptContext", id: attachment.id });
      }
      for (const image of images) {
        this.options.postMessage({ type: "removePromptImage", id: image.id });
      }
      return true;
    }
    isStopSubmitMode() {
      return this.options.getState().busy && this.options.textarea.value.length === 0;
    }
    handleComposerDragEnter(event) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.composerDragDepth += 1;
      this.syncComposerDragState(classifyComposerDragState(event.dataTransfer));
    }
    handleComposerDragOver(event) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      this.syncComposerDragState(classifyComposerDragState(event.dataTransfer));
    }
    handleComposerDragLeave(event) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.composerDragDepth = Math.max(0, this.composerDragDepth - 1);
      if (this.composerDragDepth === 0) {
        this.syncComposerDragState("none");
      }
    }
    async handleComposerDrop(event) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.composerDragDepth = 0;
      this.syncComposerDragState("none");
      const message = await createDroppedPromptImagesMessage(event.dataTransfer);
      if (message) {
        this.options.postMessage(message);
      }
      this.options.focusPromptInput();
    }
    async handleComposerPaste(event) {
      if (!event.clipboardData) {
        return;
      }
      const files = getPastedPromptImageFiles(event.clipboardData);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rejections = getPromptImageFileRejections(files);
      if (rejections.length > 0) {
        this.options.postMessage({ type: "dropPromptImages", files: [], uris: [], rejections });
        this.options.focusPromptInput();
        return;
      }
      const message = await createPromptImagesMessageFromFiles(files);
      if (message) {
        this.options.postMessage(message);
      }
      this.options.focusPromptInput();
    }
    syncComposerDragState(state2) {
      this.options.form.classList.toggle("composer--drag-over", state2 !== "none");
      this.options.form.classList.toggle("composer--drag-neutral", state2 === "neutral");
      this.options.form.classList.toggle("composer--drag-valid", state2 === "valid");
      this.options.form.classList.toggle("composer--drag-invalid", state2 === "invalid");
    }
    getPromptContextAttachments() {
      const state2 = this.options.getState();
      return Array.isArray(state2.promptContext) ? state2.promptContext.filter(isPromptContextAttachment) : [];
    }
    getPromptImageAttachments() {
      const state2 = this.options.getState();
      return Array.isArray(state2.promptImages) ? state2.promptImages.filter(isPromptImageAttachment) : [];
    }
    handleSubmit(event) {
      const state2 = this.options.getState();
      event.preventDefault();
      const text = this.pasteBuffer.expand(this.options.textarea.value).trim();
      if (!text) {
        return;
      }
      this.closeSlashMenu();
      this.options.cancelSessionNameEdit();
      this.options.postMessage(state2.busy ? { type: "submit", text, streamingBehavior: this.streamingBehavior } : { type: "submit", text });
      this.options.textarea.value = "";
      this.pasteBuffer.clear();
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
      setTooltipText(this.options.submitButton, label);
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
      updateDiffCounter(this.addedDiffCounter, addedLines, state2.animationsEnabled);
      updateDiffCounter(this.removedDiffCounter, removedLines, state2.animationsEnabled);
      const label = `Show session changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
      this.options.diffSummaryElement.setAttribute("aria-label", label);
      setTooltipText(this.options.diffSummaryElement, label);
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
    syncTextareaHeightIfNeeded(force) {
      const nextSignature = this.getTextareaLayoutSignature();
      if (force || nextSignature !== this.textareaLayoutSignature) {
        this.textareaLayoutSignature = nextSignature;
        this.cachedMaxTextareaHeight = this.getMaxTextareaHeight();
      }
      return this.syncTextareaHeight(this.cachedMaxTextareaHeight);
    }
    syncTextareaHeight(maxHeight) {
      const previousHeight = parseCssPixelValue(this.options.textarea.style.height);
      this.options.textarea.style.height = "auto";
      const scrollHeight = this.options.textarea.scrollHeight;
      const nextHeight = Math.max(minTextareaHeight, Math.min(scrollHeight, maxHeight));
      this.options.textarea.style.height = nextHeight + "px";
      this.options.textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
      return Math.abs(previousHeight - nextHeight) > 0.5;
    }
    getPromptContextBadgesSignature(attachments, images) {
      const promptContextSignature = attachments.map((attachment) => [attachment.id, attachment.source, attachment.label, attachment.title, attachment.xml?.length ?? 0].join("\0")).join("\0");
      const promptImagesSignature = images.map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.mimeType, attachment.sizeBytes].join("\0")).join("\0");
      return [promptContextSignature, promptImagesSignature].join("");
    }
    getTextareaLayoutSignature() {
      const state2 = this.options.getState();
      const promptContextSignature = state2.promptContext.map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.xml?.length ?? 0].join("\0")).join("\0");
      const promptImagesSignature = state2.promptImages.map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.mimeType, attachment.sizeBytes].join("\0")).join("\0");
      return [
        window.innerWidth,
        window.innerHeight,
        state2.lane,
        state2.chatFace,
        state2.busy ? "1" : "0",
        state2.workspaceDiffStats.addedLines,
        state2.workspaceDiffStats.removedLines,
        promptContextSignature,
        promptImagesSignature
      ].join("");
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
    return typeof attachment.id === "string" && typeof attachment.label === "string" && typeof attachment.title === "string" && (!("xml" in attachment) || typeof attachment.xml === "string");
  }
  function isPromptImageAttachment(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    const attachment = value;
    return typeof attachment.id === "string" && typeof attachment.label === "string" && typeof attachment.title === "string" && typeof attachment.mimeType === "string" && typeof attachment.sizeBytes === "number";
  }
  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) {
      return "0 B";
    }
    if (value < 1024) {
      return `${Math.round(value)} B`;
    }
    const kib = value / 1024;
    if (kib < 1024) {
      return `${Math.round(kib)} KB`;
    }
    return `${(kib / 1024).toFixed(1)} MB`;
  }
  function getContextBadgesPastSecondRow(badges) {
    const rowTops = [];
    const overflowBadges = [];
    for (const badge of badges) {
      const rowIndex = getOrAddContextBadgeRowIndex(rowTops, badge.offsetTop);
      if (rowIndex > 1) {
        overflowBadges.push(badge);
      }
    }
    return overflowBadges;
  }
  function getContextBadgeRowIndex(badge) {
    const parent = badge.parentElement;
    if (!parent) {
      return 0;
    }
    const visibleBadges = Array.from(parent.querySelectorAll(".composer__context-badge")).filter((candidate) => !candidate.hidden);
    const rowTops = [];
    for (const visibleBadge of visibleBadges) {
      getOrAddContextBadgeRowIndex(rowTops, visibleBadge.offsetTop);
    }
    return rowTops.findIndex((top) => Math.abs(top - badge.offsetTop) <= 2);
  }
  function getOrAddContextBadgeRowIndex(rowTops, top) {
    const existingIndex = rowTops.findIndex((rowTop) => Math.abs(rowTop - top) <= 2);
    if (existingIndex >= 0) {
      return existingIndex;
    }
    rowTops.push(top);
    return rowTops.length - 1;
  }
  function createContextOverflowBadge() {
    const badge = document.createElement("span");
    badge.className = "composer__context-badge composer__context-badge--overflow";
    const label = document.createElement("span");
    label.className = "composer__context-label";
    const tooltip = document.createElement("span");
    tooltip.className = "composer__context-badge-tooltip";
    const tooltipPre = document.createElement("pre");
    const tooltipCode = document.createElement("code");
    tooltipPre.append(tooltipCode);
    tooltip.append(tooltipPre);
    badge.append(label, tooltip);
    return badge;
  }
  function updateContextOverflowBadge(badge, hiddenBadges) {
    const label = badge.querySelector(".composer__context-label");
    const tooltipCode = badge.querySelector(".composer__context-badge-tooltip code");
    const attachmentLabels = hiddenBadges.map((hiddenBadge) => hiddenBadge.dataset.overflowTitle || hiddenBadge.dataset.overflowLabel || "Attachment");
    const tooltipText = attachmentLabels.map((attachmentLabel) => "\u2022 " + attachmentLabel).join("\n");
    if (label) {
      label.textContent = "+" + hiddenBadges.length + " more";
    }
    if (tooltipCode) {
      tooltipCode.textContent = tooltipText;
    }
    badge.title = tooltipText;
  }
  function getReservedMessagesHeight() {
    return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
  }

  // src/webview/extensionEditorDialog.ts
  var ExtensionEditorDialogController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    activeId;
    attachEventListeners() {
      this.options.saveButton.addEventListener("click", () => this.save());
      this.options.cancelButton.addEventListener("click", () => this.cancel());
      this.options.closeButton.addEventListener("click", () => this.cancel());
    }
    handleHostMessage(message) {
      if (!isExtensionEditorHostMessage(message)) {
        return false;
      }
      if (message.type === "extensionEditorShow") {
        this.show(message.id, message.title, message.prefill ?? "");
        return true;
      }
      if (!this.activeId || message.id === this.activeId) {
        this.hide();
      }
      return true;
    }
    handleGlobalKeydown(event) {
      if (!this.activeId || this.options.element.hidden) {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
        return true;
      }
      return false;
    }
    isActive() {
      return Boolean(this.activeId) && !this.options.element.hidden;
    }
    show(id, title, prefill) {
      this.activeId = id;
      this.options.titleElement.textContent = title || "Edit text";
      this.options.inputElement.value = prefill;
      this.options.element.hidden = false;
      this.options.element.inert = false;
      requestAnimationFrame(() => {
        this.options.inputElement.focus();
        this.options.inputElement.selectionStart = this.options.inputElement.value.length;
        this.options.inputElement.selectionEnd = this.options.inputElement.value.length;
      });
    }
    save() {
      if (!this.activeId) {
        return;
      }
      const id = this.activeId;
      const text = this.options.inputElement.value;
      this.hide();
      this.options.vscode.postMessage({ type: "extensionEditorSave", id, text });
    }
    cancel() {
      if (!this.activeId) {
        return;
      }
      const id = this.activeId;
      this.hide();
      this.options.vscode.postMessage({ type: "extensionEditorCancel", id });
    }
    hide() {
      this.activeId = void 0;
      this.options.element.hidden = true;
      this.options.element.inert = true;
      this.options.inputElement.value = "";
    }
  };
  function isExtensionEditorHostMessage(message) {
    if (!message || typeof message !== "object") {
      return false;
    }
    const value = message;
    if (value.type === "extensionEditorShow") {
      return typeof value.id === "string" && value.id.length > 0 && typeof value.title === "string" && (value.prefill === void 0 || typeof value.prefill === "string");
    }
    return value.type === "extensionEditorHide" && typeof value.id === "string" && value.id.length > 0;
  }

  // src/webview/extensionPrompt.ts
  var ExtensionPromptController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    activeId;
    handleHostMessage(message) {
      if (!isExtensionPromptHostMessage(message)) {
        return false;
      }
      if (message.type === "extensionPromptShow") {
        this.show(message);
        return true;
      }
      if (!this.activeId || message.id === this.activeId) {
        this.hide();
      }
      return true;
    }
    handleGlobalKeydown(event) {
      if (!this.isActive() || event.key !== "Escape") {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return true;
    }
    isActive() {
      return Boolean(this.activeId) && !this.options.element.hidden;
    }
    show(message) {
      this.activeId = message.id;
      const header = document.createElement("header");
      header.className = "extension-prompt__header";
      const headingGroup = document.createElement("div");
      headingGroup.className = "extension-prompt__heading-group";
      const eyebrow = document.createElement("div");
      eyebrow.className = "extension-prompt__eyebrow";
      eyebrow.textContent = "Pi needs your input";
      const title = document.createElement("h3");
      title.className = "extension-prompt__title";
      title.textContent = message.title || "Choose a response";
      headingGroup.append(eyebrow, title);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "extension-prompt__close";
      close.setAttribute("aria-label", "Cancel Pi prompt");
      close.textContent = "\xD7";
      close.addEventListener("click", () => this.cancel());
      header.append(headingGroup, close);
      const body = document.createElement("div");
      body.className = "extension-prompt__body";
      if (message.message) {
        const detail = document.createElement("p");
        detail.className = "extension-prompt__message";
        detail.textContent = message.message;
        body.append(detail);
      }
      if (message.kind === "select") {
        body.append(this.createChoiceList(message.id, message.options ?? []));
      } else if (message.kind === "confirm") {
        body.append(this.createConfirmActions(message.id));
      } else {
        body.append(this.createInputForm(message.id, message.placeholder));
      }
      this.options.element.replaceChildren(header, body);
      this.options.element.hidden = false;
      this.options.element.inert = false;
      this.options.onShow();
      requestAnimationFrame(() => {
        this.options.element.querySelector("button:not(.extension-prompt__close), input")?.focus({ preventScroll: true });
      });
    }
    createChoiceList(id, choices) {
      const list = document.createElement("div");
      list.className = "extension-prompt__choices";
      list.setAttribute("role", "list");
      for (const choice of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "extension-prompt__choice";
        button.textContent = choice;
        button.addEventListener("click", () => this.answer(id, choice));
        button.addEventListener("keydown", (event) => this.moveChoiceFocus(event));
        const item = document.createElement("div");
        item.setAttribute("role", "listitem");
        item.append(button);
        list.append(item);
      }
      if (choices.length === 0) {
        const empty = document.createElement("p");
        empty.className = "extension-prompt__message";
        empty.textContent = "No choices are available.";
        list.append(empty);
      }
      return list;
    }
    createConfirmActions(id) {
      const actions = document.createElement("div");
      actions.className = "extension-prompt__actions";
      const no = this.createActionButton("No", false, () => this.answer(id, false));
      const yes = this.createActionButton("Yes", true, () => this.answer(id, true));
      actions.append(no, yes);
      return actions;
    }
    createInputForm(id, placeholder) {
      const form2 = document.createElement("form");
      form2.className = "extension-prompt__input-form";
      const input = document.createElement("input");
      input.className = "extension-prompt__input";
      input.type = "text";
      input.placeholder = placeholder ?? "";
      input.setAttribute("aria-label", placeholder || "Response");
      const actions = document.createElement("div");
      actions.className = "extension-prompt__actions";
      const cancel = this.createActionButton("Cancel", false, () => this.cancel());
      const submit = this.createActionButton("Submit", true);
      submit.type = "submit";
      actions.append(cancel, submit);
      form2.append(input, actions);
      form2.addEventListener("submit", (event) => {
        event.preventDefault();
        this.answer(id, input.value);
      });
      return form2;
    }
    createActionButton(label, primary, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `extension-prompt__button${primary ? " extension-prompt__button--primary" : ""}`;
      button.textContent = label;
      if (onClick) {
        button.addEventListener("click", onClick);
      }
      return button;
    }
    moveChoiceFocus(event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const buttons = Array.from(this.options.element.querySelectorAll(".extension-prompt__choice"));
      const currentIndex = buttons.indexOf(event.currentTarget);
      if (currentIndex < 0 || buttons.length === 0) {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      buttons[(currentIndex + delta + buttons.length) % buttons.length]?.focus();
    }
    answer(id, value) {
      if (this.activeId !== id) {
        return;
      }
      this.hide();
      this.options.vscode.postMessage({ type: "extensionPromptAnswer", id, value });
    }
    cancel() {
      if (!this.activeId) {
        return;
      }
      const id = this.activeId;
      this.hide();
      this.options.vscode.postMessage({ type: "extensionPromptCancel", id });
    }
    hide() {
      this.activeId = void 0;
      this.options.element.hidden = true;
      this.options.element.inert = true;
      this.options.element.replaceChildren();
    }
  };
  function isExtensionPromptHostMessage(message) {
    if (!message || typeof message !== "object") {
      return false;
    }
    const value = message;
    if (value.type === "extensionPromptHide") {
      return typeof value.id === "string" && value.id.length > 0;
    }
    if (value.type !== "extensionPromptShow" || typeof value.id !== "string" || !value.id || value.kind !== "select" && value.kind !== "confirm" && value.kind !== "input" || typeof value.title !== "string") {
      return false;
    }
    return (value.message === void 0 || typeof value.message === "string") && (value.placeholder === void 0 || typeof value.placeholder === "string") && (value.options === void 0 || Array.isArray(value.options) && value.options.every((option) => typeof option === "string"));
  }

  // src/shared/agentRuntimeLabels.ts
  function getAgentRuntimeLabel(backend) {
    return backend === "kward" ? "Kward" : "Pi engine";
  }
  function getAgentRuntimeWorkingText(backend, options = {}) {
    return `${getAgentRuntimeLabel(backend)} is working${options.ellipsis ? "..." : ""}`;
  }

  // src/shared/url.ts
  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  // src/webview/messages/renderPolicy.ts
  function shouldRenderMarkdown(message) {
    return !message.error && message.role !== "user";
  }
  function shouldRenderQuietEmptyTranscript(state2) {
    return state2.messages.length === 0 && !state2.sessionLoading && state2.settings.values.quietStartup === true;
  }

  // src/webview/messages/renderMessages.ts
  var maxRememberedActivityIds = 1e3;
  var activityExpansion = /* @__PURE__ */ new Map();
  var activityBodyExpansion = /* @__PURE__ */ new Map();
  var activityRenderSignatures = /* @__PURE__ */ new WeakMap();
  function toggleActivityBodyExpansion(activityId) {
    const next = !activityBodyExpansion.get(activityId);
    activityBodyExpansion.set(activityId, next);
    return next;
  }
  function setActivityBodyExpansion(activityId, expanded) {
    activityBodyExpansion.set(activityId, expanded);
  }
  function getActivityBodyExpansion(activityId) {
    return activityBodyExpansion.get(activityId) === true;
  }
  function pruneActivityRenderState(activeActivityIds) {
    const retainedActivityIds = getRecentActivityIds(activeActivityIds);
    pruneStringMap(activityExpansion, retainedActivityIds);
    pruneStringMap(activityBodyExpansion, retainedActivityIds);
  }
  function createMessageElement(message, showRole, messageIndex, options = {}) {
    const article = document.createElement("article");
    article.className = `message message--${message.role}${message.error ? " message--error" : ""}${getMessageVariantClass(message)}`;
    if (message.variant === "branchSummary") {
      article.append(createBranchSummaryActivityElement(message.text || "", messageIndex, options));
      return article;
    }
    if (message.variant === "compactionSummary") {
      article.append(createCompactionSummaryActivityElement(message.text || "", messageIndex, options));
      return article;
    }
    const body = document.createElement("div");
    body.className = "message__body";
    renderMessageBodyInto(body, message, options);
    if (showRole) {
      const role = document.createElement("div");
      role.className = "message__role";
      role.textContent = roleLabel(message);
      article.append(role);
    }
    const activities = Array.isArray(message.activities) ? message.activities : [];
    const images = getRenderableImages(message.images);
    const hasBody = Boolean(message.text || message.error || images.length > 0 || activities.length === 0);
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
    if (message.variant === "branchSummary") {
      return updateBranchSummaryActivityElement(article, message.text || "");
    }
    if (message.variant === "compactionSummary") {
      return updateCompactionSummaryActivityElement(article, message.text || "");
    }
    const body = getDirectMessageBodyElement(article);
    if (!body) {
      return false;
    }
    body.className = "message__body";
    if (Array.isArray(message.activities) && message.activities.length > 0) {
      body.classList.add("message__body--after-activities");
    }
    renderMessageBodyInto(body, message, options);
    return true;
  }
  function getRecentActivityIds(activeActivityIds) {
    if (activeActivityIds.size <= maxRememberedActivityIds) {
      return activeActivityIds;
    }
    return new Set(Array.from(activeActivityIds).slice(-maxRememberedActivityIds));
  }
  function pruneStringMap(map, retainedKeys) {
    for (const key of Array.from(map.keys())) {
      if (!retainedKeys.has(key)) {
        map.delete(key);
      }
    }
  }
  function renderMessageBodyInto(body, message, options) {
    const text = message.text || "";
    if (shouldRenderMarkdown(message)) {
      renderMarkdownInto(body, text, options);
    } else {
      body.textContent = text;
    }
    const images = getRenderableImages(message.images);
    if (images.length > 0) {
      body.append(createImageListElement(images, "message__images"));
    }
  }
  function createImageListElement(images, className) {
    const list = document.createElement("div");
    list.className = className;
    for (const image of images) {
      list.append(createDataImageElement(image));
    }
    return list;
  }
  function createDataImageElement(image) {
    const element = document.createElement("img");
    const mimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : "";
    const data = typeof image.data === "string" ? image.data : "";
    element.className = "tauren-image";
    element.alt = typeof image.alt === "string" && image.alt ? image.alt : "Image";
    element.loading = "lazy";
    element.decoding = "async";
    element.src = `data:${mimeType};base64,${data}`;
    return element;
  }
  function getRenderableImages(images) {
    if (!Array.isArray(images)) {
      return [];
    }
    return images.filter((image) => {
      const mimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : "";
      return image.type === "image" && typeof image.data === "string" && Boolean(image.data) && (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/gif" || mimeType === "image/webp");
    });
  }
  function getDirectMessageBodyElement(article) {
    for (const child of Array.from(article.children)) {
      if (child instanceof HTMLElement && child.classList.contains("message__body")) {
        return child;
      }
    }
    return void 0;
  }
  function getMessageVariantClass(message) {
    return message.variant === "thinking" ? " message--thinking" : "";
  }
  function createBranchSummaryActivityElement(text, messageIndex, options) {
    const body = stripBranchSummaryPrefix(text);
    return createActivityElement({
      id: typeof messageIndex === "number" ? `branch-summary-${messageIndex}` : "branch-summary",
      kind: "message",
      title: "Branch summary",
      status: "info",
      body: createBranchSummaryPreview(body),
      expandedBody: body,
      code: true
    }, messageIndex, options);
  }
  function updateBranchSummaryActivityElement(article, text) {
    article.replaceChildren(createBranchSummaryActivityElement(text, void 0, {}));
    return true;
  }
  function createCompactionSummaryActivityElement(text, messageIndex, options) {
    const { title, body } = splitCompactionSummary(text);
    return createActivityElement({
      id: typeof messageIndex === "number" ? `compaction-summary-${messageIndex}` : "compaction-summary",
      kind: "compaction",
      title,
      status: "completed",
      ...body ? { body } : {}
    }, messageIndex, options);
  }
  function updateCompactionSummaryActivityElement(article, text) {
    article.replaceChildren(createCompactionSummaryActivityElement(text, void 0, {}));
    return true;
  }
  function createBranchSummaryPreview(text) {
    const previewLineCount = 4;
    const lines = text.split("\n");
    if (lines.length <= previewLineCount) {
      return text;
    }
    return [
      ...lines.slice(0, previewLineCount),
      `... (${lines.length - previewLineCount} more lines)`
    ].join("\n");
  }
  function stripBranchSummaryPrefix(text) {
    const prefix = "Returned from branch.\n\n";
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
  }
  function splitCompactionSummary(text) {
    const separator = "\n\n";
    const separatorIndex = text.indexOf(separator);
    if (separatorIndex < 0) {
      return { title: stripTrailingPeriod(text.trim() || "Compacted session context") };
    }
    const title = stripTrailingPeriod(text.slice(0, separatorIndex).trim() || "Compacted session context");
    const body = text.slice(separatorIndex + separator.length).trim();
    return body ? { title, body } : { title };
  }
  function stripTrailingPeriod(text) {
    return text.endsWith(".") ? text.slice(0, -1) : text;
  }
  function canCopyAssistantMessage(message) {
    return message.role === "assistant" && !message.error && message.variant !== "thinking" && Boolean(message.text);
  }
  function createCopyButtonElement(messageIndex) {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    const button = createIconActionButton("message__copy", "Copy response");
    button.dataset.copyMessageIndex = String(messageIndex);
    actions.append(button);
    return actions;
  }
  function createActivityListElement(activities, messageIndex, options) {
    const list = createActivityListShell();
    for (const activity of activities) {
      list.append(createTrackedActivityElement(activity, messageIndex, options));
    }
    return list;
  }
  function updateMessageActivitiesElement(article, message, messageIndex, options = {}) {
    const activities = Array.isArray(message.activities) ? message.activities : [];
    if (message.variant === "branchSummary" || message.variant === "compactionSummary") {
      return activities.length === 0;
    }
    updateMessageBodyActivityClass(article, activities.length > 0);
    const existingList = getDirectActivityListElement(article);
    if (activities.length === 0) {
      existingList?.remove();
      return true;
    }
    const list = existingList ?? createActivityListShell();
    updateActivityListElement(list, activities, messageIndex, options);
    if (!existingList) {
      article.insertBefore(list, getActivityListInsertionReference(article));
    }
    return true;
  }
  function createActivityListShell() {
    const list = document.createElement("div");
    list.className = "activity-list";
    return list;
  }
  function updateActivityListElement(list, activities, messageIndex, options) {
    const existingById = getExistingActivityElementsById(list);
    const reusedIds = /* @__PURE__ */ new Set();
    for (const [index, activity] of activities.entries()) {
      const activityId = getActivityRenderId(activity);
      const signature = getActivityRenderSignature(activity, messageIndex, options);
      const reusable = activityId ? existingById.get(activityId) : void 0;
      const element = reusable && !reusedIds.has(activityId) && activityRenderSignatures.get(reusable) === signature ? reusable : createTrackedActivityElement(activity, messageIndex, options, signature);
      if (activityId) {
        reusedIds.add(activityId);
      }
      const currentNode = list.children[index];
      if (currentNode !== element) {
        list.insertBefore(element, currentNode ?? null);
      }
    }
    while (list.children.length > activities.length) {
      list.children[activities.length]?.remove();
    }
  }
  function createTrackedActivityElement(activity, messageIndex, options, signature = getActivityRenderSignature(activity, messageIndex, options)) {
    const element = createActivityElement(activity, messageIndex, options);
    const activityId = getActivityRenderId(activity);
    if (activityId) {
      element.dataset.activityRenderId = activityId;
    }
    activityRenderSignatures.set(element, signature);
    return element;
  }
  function getExistingActivityElementsById(list) {
    const elements = /* @__PURE__ */ new Map();
    for (const child of Array.from(list.children)) {
      if (!(child instanceof HTMLElement) || !child.classList.contains("activity")) {
        continue;
      }
      const activityId = child.dataset.activityRenderId;
      if (activityId && !elements.has(activityId)) {
        elements.set(activityId, child);
      }
    }
    return elements;
  }
  function getDirectActivityListElement(article) {
    for (const child of Array.from(article.children)) {
      if (child instanceof HTMLElement && child.classList.contains("activity-list")) {
        return child;
      }
    }
    return void 0;
  }
  function updateMessageBodyActivityClass(article, hasActivities) {
    const body = getDirectMessageBodyElement(article);
    body?.classList.toggle("message__body--after-activities", hasActivities);
  }
  function getActivityListInsertionReference(article) {
    for (const child of Array.from(article.children)) {
      if (child instanceof HTMLElement && (child.classList.contains("message__body") || child.classList.contains("message__actions"))) {
        return child;
      }
    }
    return null;
  }
  function getActivityRenderId(activity) {
    return typeof activity.id === "string" ? activity.id : "";
  }
  function getActivityRenderSignature(activity, messageIndex, options) {
    return [
      messageIndex ?? "",
      getActivityRenderId(activity),
      activity.kind ?? "",
      activity.status ?? "",
      activity.title ?? "",
      activity.summary ?? "",
      activity.body ?? "",
      activity.expandedBody ?? "",
      activity.code ? "code" : "",
      isActivityBodyExpanded(activity, getActivityRenderId(activity)) ? "expanded" : "collapsed",
      options.outputColors !== false ? "colors" : "plain",
      options.animationsEnabled !== false ? "animated" : "static",
      options.allowRemoteImages === true ? "remote" : "local",
      getImagesSignature(activity.images)
    ].join("\0");
  }
  function isActivityBodyExpanded(activity, activityId) {
    const isCollapsibleCompactionOutput = activity.kind === "compaction" && !activity.code;
    const bodyCanVisuallyExpand = Boolean(activityId && (activity.code || isCollapsibleCompactionOutput));
    return Boolean(activityId && activityBodyExpansion.get(activityId) && (activity.expandedBody || bodyCanVisuallyExpand));
  }
  function getImagesSignature(images) {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }
    return images.map((image) => {
      const data = typeof image.data === "string" ? image.data : "";
      const prefix = data.slice(0, 32);
      const suffix = data.length > 32 ? data.slice(-32) : "";
      return [
        image.type ?? "",
        image.mimeType ?? "",
        image.alt ?? "",
        data.length,
        prefix,
        suffix
      ].join("\0");
    }).join("");
  }
  function createActivityElement(activity, messageIndex, options) {
    const details = document.createElement("details");
    details.className = `activity activity--${activity.kind || "pi"} activity--${activity.status || "info"}`;
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
    const activityImages = getRenderableImages(activity.images);
    if (typeof activity.body === "string" && activity.body.length > 0) {
      const isCollapsibleCompactionOutput = activity.kind === "compaction" && !activity.code;
      const bodyCanVisuallyExpand = Boolean(activityId && (activity.code || isCollapsibleCompactionOutput));
      const bodyExpanded = isActivityBodyExpanded(activity, activityId);
      const bodyText = bodyExpanded && typeof activity.expandedBody === "string" ? activity.expandedBody : activity.body;
      const body = document.createElement(activity.code ? "pre" : "div");
      body.className = `activity__body${activity.code ? " activity__body--code" : " activity__body--markdown"}${isCollapsibleCompactionOutput ? " activity__body--compaction" : ""}${bodyExpanded ? " activity__body--expanded" : ""}`;
      let bodyToggle;
      if (activity.code) {
        bodyToggle = renderCodeActivityBody(body, activity, bodyText, {
          bodyExpanded,
          messageIndex,
          outputColors: options.outputColors !== false,
          animationsEnabled: options.animationsEnabled !== false
        });
      } else {
        renderMarkdownInto(body, bodyText, options);
        if (bodyExpanded && bodyCanVisuallyExpand) {
          bodyToggle = { label: "Show less", activityId, messageIndex, expanded: true };
        }
      }
      const overflowToggle = bodyCanVisuallyExpand && !bodyExpanded && !bodyToggle ? { label: "Show full output", activityId, messageIndex, expanded: false } : void 0;
      const copyBodyText = activity.title === "Branch summary" && typeof activity.expandedBody === "string" ? activity.expandedBody : bodyText;
      const filePath = getReadActivityPath(activity, bodyText);
      const bodyWrap = activity.code || bodyToggle || overflowToggle || filePath ? createActivityBodyWrap(body, bodyText, filePath, bodyToggle, overflowToggle, copyBodyText) : body;
      details.append(bodyWrap);
      if (bodyExpanded && shouldScrollExpandedBodyToBottom(activity.body)) {
        scheduleActivityBodyScrollToBottom(body);
      }
    }
    if (activityImages.length > 0) {
      details.append(createImageListElement(activityImages, "activity__images"));
    }
    return details;
  }
  function createActivityBodyWrap(body, bodyText, filePath, bodyToggle, overflowToggle, copyText = bodyText) {
    const wrap = document.createElement("div");
    wrap.className = "activity__body-wrap";
    const actions = document.createElement("div");
    actions.className = "activity__body-actions";
    const copyOutput = createIconActionButton("activity__body-action", "Copy output");
    copyOutput.dataset.copyActivityOutput = copyText;
    actions.append(copyOutput);
    if (filePath) {
      const openFile = document.createElement("button");
      openFile.className = "activity__body-action activity__body-action--text";
      openFile.type = "button";
      openFile.textContent = "Open";
      openFile.setAttribute("aria-label", "Open file");
      openFile.dataset.openFilePath = filePath;
      const openFileTooltip = document.createElement("span");
      openFileTooltip.className = "tauren-icon-action-tooltip";
      openFileTooltip.textContent = "Open file";
      openFile.append(openFileTooltip);
      actions.append(openFile);
      const copyPath = createIconActionButton("activity__body-action", "Copy path");
      copyPath.dataset.copyPath = filePath;
      actions.append(copyPath);
    }
    wrap.append(actions, body);
    if (bodyToggle) {
      wrap.append(createActivityBodyToggle(bodyToggle));
    } else if (overflowToggle) {
      scheduleActivityBodyOverflowToggle(wrap, body, overflowToggle);
    }
    return wrap;
  }
  function renderCodeActivityBody(element, activity, bodyText, options) {
    const activityId = typeof activity.id === "string" ? activity.id : "";
    const filePath = getReadActivityPath(activity, bodyText);
    const hasExpandedToggle = Boolean(options.bodyExpanded && activityId);
    const marker = !options.bodyExpanded && activityId && typeof activity.expandedBody === "string" ? findTruncationMarker(bodyText) : void 0;
    const renderedBodyText = marker ? removeTruncationMarker(marker) : bodyText;
    if (filePath && !containsAnsiEscape(renderedBodyText)) {
      renderHighlightedActivityCodeInto(element, renderedBodyText, filePath);
    } else {
      renderAnsiActivityCodeInto(element, renderedBodyText, options.outputColors, options.animationsEnabled);
    }
    if (hasExpandedToggle) {
      return {
        label: "Show less",
        activityId,
        messageIndex: options.messageIndex,
        expanded: true
      };
    }
    if (marker) {
      return {
        label: marker.text,
        activityId,
        messageIndex: options.messageIndex,
        expanded: false
      };
    }
    return void 0;
  }
  function getReadActivityPath(activity, bodyText) {
    if (activity.kind !== "tool_execution" || typeof activity.title !== "string" || containsAnsiEscape(bodyText)) {
      return void 0;
    }
    return parseReadActivityPath(activity.title);
  }
  function renderHighlightedActivityCodeInto(element, bodyText, filePath) {
    if (!renderHighlightedCodeInto(element, bodyText, filePath)) {
      element.textContent = bodyText;
    }
  }
  function renderAnsiActivityCodeInto(element, bodyText, outputColors, animationsEnabled) {
    renderAnsiTextInto(element, bodyText, outputColors);
    renderAnsiSpinnersInto(element, animationsEnabled);
  }
  function removeTruncationMarker(marker) {
    const before = marker.before.endsWith("\n") ? marker.before.slice(0, -1) : marker.before;
    const after = marker.after.startsWith("\n") ? marker.after.slice(1) : marker.after;
    if (before && after) {
      return `${before}
${after}`;
    }
    return before || after;
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
  function scheduleActivityBodyOverflowToggle(wrap, body, bodyToggle) {
    const appendIfOverflowing = () => {
      if (!wrap.isConnected || wrap.querySelector("[data-activity-body-toggle]")) {
        return;
      }
      if (body.scrollHeight > body.clientHeight + 1) {
        wrap.append(createActivityBodyToggle(bodyToggle));
      }
    };
    requestAnimationFrame(() => {
      appendIfOverflowing();
      requestAnimationFrame(appendIfOverflowing);
    });
    setTimeout(appendIfOverflowing, 80);
    setTimeout(appendIfOverflowing, 220);
  }
  function createActivityBodyToggle({
    label,
    activityId,
    messageIndex,
    expanded
  }) {
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
    return button;
  }
  function parseReadActivityPath(title) {
    const match = title.match(/^read\s+(.+?)(?::\d+(?:-\d+)?)?$/);
    return match?.[1];
  }
  function shouldKeepActivityOpen(activity) {
    return typeof activity.body === "string" && activity.body.length > 0 || getRenderableImages(activity.images).length > 0;
  }
  function roleLabel(message) {
    if (message.role === "user") {
      return "You";
    }
    if (message.role === "assistant") {
      return message.assistantLabel || "Tauren";
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

  // src/webview/messages/scrollFollow.ts
  var scrollMovementTolerance = 1;
  function createScrollFollowState() {
    return {
      followOutput: true,
      lastScrollTop: 0,
      lastScrollHeight: 0,
      lastClientHeight: 0
    };
  }
  function isScrollAtBottom(metrics, threshold) {
    return getDistanceFromBottom(metrics) <= threshold;
  }
  function getDistanceFromBottom(metrics) {
    return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  }
  function recordScrollMetrics(state2, metrics) {
    state2.lastScrollTop = metrics.scrollTop;
    state2.lastScrollHeight = metrics.scrollHeight;
    state2.lastClientHeight = metrics.clientHeight;
  }
  function updateScrollFollowStateForScroll(state2, metrics, threshold) {
    if (isScrollAtBottom(metrics, threshold)) {
      state2.followOutput = true;
      recordScrollMetrics(state2, metrics);
      return;
    }
    if (metrics.scrollTop < state2.lastScrollTop - scrollMovementTolerance) {
      state2.followOutput = false;
    }
    recordScrollMetrics(state2, metrics);
  }

  // src/webview/messages/messageList.ts
  var largeTranscriptCollapseThreshold = 250;
  var largeTranscriptHeadCount = 20;
  var largeTranscriptTailCount = 180;
  var MessageListController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    renderedMessageViews = [];
    scrollFollowState = createScrollFollowState();
    savedChatScroll;
    bottomScrollScheduled = false;
    collapsedTranscriptElement;
    renderMessageList() {
      const state2 = this.options.getState();
      if (state2.messages.length === 0) {
        this.renderedMessageViews = [];
        if (shouldRenderQuietEmptyTranscript(state2)) {
          this.options.messagesContentElement.replaceChildren();
        } else {
          this.options.messagesContentElement.replaceChildren(this.createEmptyStateElement());
        }
        pruneActivityRenderState(/* @__PURE__ */ new Set());
        pruneDisconnectedMessageRenderState();
        return;
      }
      if (this.options.messagesContentElement.querySelector(".empty-state")) {
        this.options.messagesContentElement.replaceChildren();
      }
      const renderPlan = getMessageRenderPlan(state2.messages.length);
      const renderedIndexes = /* @__PURE__ */ new Set();
      const nodes = [];
      let previousMessageRole;
      for (const item of renderPlan) {
        if (item.kind === "collapse") {
          nodes.push(this.getCollapsedTranscriptElement(item.count));
          previousMessageRole = void 0;
          continue;
        }
        const message = state2.messages[item.index];
        if (!message) {
          continue;
        }
        const showRole = message.role !== previousMessageRole;
        const view = this.renderMessageAtIndex(item.index, message, showRole);
        renderedIndexes.add(item.index);
        nodes.push(view.element);
        previousMessageRole = message.role;
      }
      for (const [index, view] of this.renderedMessageViews.entries()) {
        if (view && !renderedIndexes.has(index)) {
          view.element.remove();
        }
      }
      this.options.messagesContentElement.replaceChildren(...nodes);
      this.renderedMessageViews.length = state2.messages.length;
      pruneActivityRenderState(getActiveActivityIds(state2.messages));
      pruneDisconnectedMessageRenderState();
    }
    syncBusyStatus() {
      const state2 = this.options.getState();
      if (!state2.busy) {
        this.options.busyStatusElement.hidden = true;
        this.options.busyStatusTextElement.textContent = "";
        return;
      }
      const nextText = this.getBusyStatusText();
      if (this.options.busyStatusTextElement.textContent !== nextText) {
        this.options.busyStatusTextElement.textContent = nextText;
      }
      this.options.busyStatusElement.hidden = false;
    }
    toggleToolActivityDetail() {
      const activityIds = getExpandableToolActivityIds(this.options.getState().messages);
      if (activityIds.length === 0) {
        return void 0;
      }
      const nextExpanded = activityIds.some((activityId) => !getActivityBodyExpansion(activityId));
      for (const activityId of activityIds) {
        setActivityBodyExpansion(activityId, nextExpanded);
      }
      this.renderMessageList();
      return nextExpanded;
    }
    handleMessagesScroll() {
      updateScrollFollowStateForScroll(
        this.scrollFollowState,
        this.getScrollMetrics(),
        messagesBottomThreshold
      );
    }
    isMessagesAtBottom() {
      return isScrollAtBottom(this.getScrollMetrics(), messagesBottomThreshold);
    }
    shouldFollowOutput() {
      return this.scrollFollowState.followOutput || this.isMessagesAtBottom();
    }
    scrollMessagesToTop() {
      this.scrollFollowState.followOutput = false;
      this.options.messagesElement.scrollTop = 0;
      recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
    }
    scrollMessagesToBottom() {
      this.scrollFollowState.followOutput = true;
      this.options.messagesElement.scrollTop = this.options.messagesElement.scrollHeight;
      recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
    }
    scheduleMessagesToBottom() {
      this.scrollMessagesToBottomIfFollowingChat();
      if (this.bottomScrollScheduled) {
        return;
      }
      this.bottomScrollScheduled = true;
      requestAnimationFrame(() => {
        this.scrollMessagesToBottomIfFollowingChat();
        requestAnimationFrame(() => this.scrollMessagesToBottomIfFollowingChat());
      });
      setTimeout(() => this.scrollMessagesToBottomIfFollowingChat(), 80);
      setTimeout(() => {
        this.scrollMessagesToBottomIfFollowingChat();
        this.bottomScrollScheduled = false;
      }, 220);
    }
    rememberChatScrollPosition() {
      this.savedChatScroll = {
        sessionKey: this.getSessionKey(),
        scrollTop: this.options.messagesElement.scrollTop,
        followOutput: this.shouldFollowOutput()
      };
    }
    restoreChatScrollAfterReturn() {
      const saved = this.savedChatScroll;
      if (!saved || saved.sessionKey !== this.getSessionKey()) {
        this.scrollFollowState.followOutput = true;
        this.scheduleMessagesToBottom();
        return;
      }
      if (saved.followOutput) {
        this.scrollFollowState.followOutput = true;
        this.scheduleMessagesToBottom();
        return;
      }
      this.scrollFollowState.followOutput = false;
      requestAnimationFrame(() => {
        if (saved !== this.savedChatScroll || saved.sessionKey !== this.getSessionKey()) {
          return;
        }
        this.options.messagesElement.scrollTop = saved.scrollTop;
        recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
      });
    }
    handleMessageClick(event) {
      const state2 = this.options.getState();
      const target = eventTargetElement(event);
      const toggleButton = target?.closest("[data-activity-body-toggle]");
      if (toggleButton instanceof HTMLElement) {
        const activityId = toggleButton.dataset.activityBodyToggle;
        if (activityId) {
          event.preventDefault();
          event.stopPropagation();
          toggleActivityBodyExpansion(activityId);
          const expandableToolActivityIds = getExpandableToolActivityIds(state2.messages);
          if (expandableToolActivityIds.includes(activityId)) {
            const expanded = expandableToolActivityIds.some((toolActivityId) => getActivityBodyExpansion(toolActivityId));
            this.options.postMessage({ type: "setToolsExpanded", expanded });
          }
          this.rerenderMessageAtIndex(parseDatasetInteger(toggleButton.dataset.messageIndex));
        }
        return;
      }
      const dismissWelcomeButton = target?.closest("[data-dismiss-welcome]");
      if (dismissWelcomeButton instanceof HTMLElement) {
        event.preventDefault();
        this.options.postMessage({ type: "dismissWelcome" });
        return;
      }
      const codeCopyButton = target?.closest("[data-copy-code-block]");
      if (codeCopyButton instanceof HTMLElement) {
        const block = codeCopyButton.closest(".tauren-code-block");
        const text = block?.querySelector("pre")?.textContent ?? "";
        if (text) {
          event.preventDefault();
          this.options.postMessage({ type: "copyText", text, successMessage: "Copied code." });
        }
        return;
      }
      const activityCopyButton = target?.closest("[data-copy-activity-output]");
      if (activityCopyButton instanceof HTMLElement) {
        const text = activityCopyButton.dataset.copyActivityOutput ?? "";
        if (text) {
          event.preventDefault();
          this.options.postMessage({ type: "copyText", text, successMessage: "Copied output." });
        }
        return;
      }
      const pathCopyButton = target?.closest("[data-copy-path]");
      if (pathCopyButton instanceof HTMLElement) {
        const text = pathCopyButton.dataset.copyPath ?? "";
        if (text) {
          event.preventDefault();
          this.options.postMessage({ type: "copyText", text, successMessage: "Copied path." });
        }
        return;
      }
      const openFileButton = target?.closest("[data-open-file-path]");
      if (openFileButton instanceof HTMLElement) {
        const filePath = openFileButton.dataset.openFilePath;
        if (filePath) {
          event.preventDefault();
          this.options.postMessage({ type: "openFile", path: filePath });
        }
        return;
      }
      const copyButton = target?.closest(".message__copy");
      if (copyButton instanceof HTMLElement) {
        const index = Number(copyButton.dataset.copyMessageIndex);
        const text = Number.isInteger(index) ? state2.messages[index]?.text : "";
        if (text) {
          event.preventDefault();
          this.options.postMessage({ type: "copyText", text, successMessage: "Copied response." });
        }
        return;
      }
      const link = target?.closest(".tauren-file-link");
      if (link instanceof HTMLElement) {
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
        return;
      }
      const externalLink = target?.closest("a[href]");
      if (externalLink instanceof HTMLAnchorElement && isHttpUrl(externalLink.href)) {
        event.preventDefault();
        this.options.postMessage({ type: "openExternal", url: externalLink.href });
      }
    }
    getRenderedMessageCount() {
      return getMessageRenderPlan(this.options.getState().messages.length).filter((item) => item.kind === "message").length;
    }
    getCollapsedMessageCount() {
      return getMessageRenderPlan(this.options.getState().messages.length).reduce((count, item) => item.kind === "collapse" ? count + item.count : count, 0);
    }
    getCollapsedTranscriptElement(count) {
      if (!this.collapsedTranscriptElement) {
        const element = document.createElement("div");
        element.className = "message message--collapsed-transcript";
        element.setAttribute("role", "note");
        this.collapsedTranscriptElement = element;
      }
      this.collapsedTranscriptElement.textContent = `${count} earlier messages hidden to keep this large session responsive.`;
      return this.collapsedTranscriptElement;
    }
    createEmptyStateElement() {
      const state2 = this.options.getState();
      if (!state2.sessionLoading) {
        return state2.welcomeDismissed ? createPlainEmptyStateElement(state2) : createWelcomeStateElement(state2);
      }
      const empty = document.createElement("p");
      empty.className = "empty-state empty-state--loading";
      empty.setAttribute("role", "status");
      empty.setAttribute("aria-live", "polite");
      empty.setAttribute("aria-atomic", "true");
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
      if (existingView && existingView.message === message && existingView.showRole === showRole && existingView.allowRemoteImages === state2.allowRemoteImages && existingView.outputColors === state2.outputColors && existingView.animationsEnabled === state2.animationsEnabled) {
        return existingView;
      }
      const imagesSignature = this.getImagesSignature(message);
      const copyable = canCopyAssistantMessage2(message);
      const hasBody = shouldRenderMessageBody(message);
      const animateFromText = this.getStreamingAnimationStartText(existingView, message, index);
      if (existingView && canReuseMessageElement(existingView, message, showRole, imagesSignature, state2.allowRemoteImages, copyable, hasBody)) {
        const renderOptions = {
          ...animateFromText === void 0 ? {} : { animateFromText },
          outputColors: state2.outputColors,
          animationsEnabled: state2.animationsEnabled,
          allowRemoteImages: state2.allowRemoteImages
        };
        if ((existingView.message.text || "") !== (message.text || "") || existingView.imagesSignature !== imagesSignature) {
          updateMessageBodyElement(existingView.element, message, renderOptions);
        }
        updateMessageActivitiesElement(existingView.element, message, index, renderOptions);
        pruneDisconnectedMessageRenderState();
        existingView.message = message;
        existingView.showRole = showRole;
        existingView.imagesSignature = imagesSignature;
        existingView.allowRemoteImages = state2.allowRemoteImages;
        existingView.outputColors = state2.outputColors;
        existingView.animationsEnabled = state2.animationsEnabled;
        existingView.copyable = copyable;
        existingView.hasBody = hasBody;
        return existingView;
      }
      const nextView = {
        element: createMessageElement(
          message,
          showRole,
          index,
          {
            ...animateFromText === void 0 ? {} : { animateFromText },
            outputColors: state2.outputColors,
            animationsEnabled: state2.animationsEnabled,
            allowRemoteImages: state2.allowRemoteImages
          }
        ),
        message,
        showRole,
        imagesSignature,
        allowRemoteImages: state2.allowRemoteImages,
        outputColors: state2.outputColors,
        animationsEnabled: state2.animationsEnabled,
        copyable,
        hasBody
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
      if (!existingView) {
        this.renderMessageList();
        return;
      }
      const previousMessage = index > 0 ? state2.messages[index - 1] : void 0;
      const showRole = state2.messages[index].role !== previousMessage?.role;
      const nextView = {
        element: createMessageElement(
          state2.messages[index],
          showRole,
          index,
          { outputColors: state2.outputColors, animationsEnabled: state2.animationsEnabled, allowRemoteImages: state2.allowRemoteImages }
        ),
        message: state2.messages[index],
        showRole,
        imagesSignature: this.getImagesSignature(state2.messages[index]),
        allowRemoteImages: state2.allowRemoteImages,
        outputColors: state2.outputColors,
        animationsEnabled: state2.animationsEnabled,
        copyable: canCopyAssistantMessage2(state2.messages[index]),
        hasBody: shouldRenderMessageBody(state2.messages[index])
      };
      existingView.element.replaceWith(nextView.element);
      this.renderedMessageViews[index] = nextView;
      pruneDisconnectedMessageRenderState();
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
    getImagesSignature(message) {
      return getImagesSignature2(message.images);
    }
    getBusyStatusText() {
      const activity = this.getLatestRunningActivity();
      if (!activity) {
        return getAgentRuntimeWorkingText(this.getBackend(), { ellipsis: true });
      }
      const title = typeof activity.title === "string" && activity.title ? activity.title : getAgentRuntimeWorkingText(this.getBackend());
      const summary = typeof activity.summary === "string" && activity.summary ? ": " + activity.summary : "";
      return title + summary;
    }
    getBackend() {
      return this.options.getState().settings.values["tauren.backend"];
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
    scrollMessagesToBottomIfFollowingChat() {
      if (this.options.getState().lane === "chat" && this.shouldFollowOutput()) {
        this.scrollMessagesToBottom();
      }
    }
    getScrollMetrics() {
      return {
        scrollTop: this.options.messagesElement.scrollTop,
        scrollHeight: this.options.messagesElement.scrollHeight,
        clientHeight: this.options.messagesElement.clientHeight
      };
    }
    getSessionKey() {
      const state2 = this.options.getState();
      return state2.currentSessionFile || "__transient_chat__";
    }
  };
  function pruneDisconnectedMessageRenderState() {
    pruneDisconnectedCodeHighlights();
    pruneDisconnectedLocalImageRequests();
  }
  function createPlainEmptyStateElement(state2) {
    const resources = createStartupResourcesElement(state2.startupResources);
    if (!resources) {
      const empty2 = document.createElement("p");
      empty2.className = "empty-state";
      empty2.textContent = "Ask Tauren about this workspace.";
      return empty2;
    }
    const empty = document.createElement("div");
    empty.className = "empty-state empty-state--welcome empty-state--new-session";
    const description = document.createElement("p");
    description.textContent = "Ask Tauren about this workspace.";
    empty.append(description, resources);
    return empty;
  }
  function createWelcomeStateElement(state2) {
    const empty = document.createElement("div");
    empty.className = "empty-state empty-state--welcome";
    const title = document.createElement("h2");
    title.className = "empty-state__title";
    title.textContent = "Welcome to Tauren";
    const description = document.createElement("p");
    description.textContent = "Ask Tauren about this workspace, review code, plan changes, or make edits.";
    const commandHint = document.createElement("p");
    commandHint.textContent = "Type / for commands, or add a file/selection as context from the editor.";
    const resources = createStartupResourcesElement(state2.startupResources);
    const tryLabel = document.createElement("p");
    tryLabel.className = "empty-state__try-label";
    tryLabel.textContent = "Try:";
    const promptList = document.createElement("ul");
    promptList.className = "empty-state__prompts";
    for (const prompt of [
      "Explain how this workspace is structured",
      "Review the current file for bugs",
      "Plan the changes before editing",
      "Write tests for this behavior"
    ]) {
      const item = document.createElement("li");
      item.textContent = prompt;
      promptList.append(item);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "empty-state__dismiss";
    dismiss.textContent = "Don't show again";
    dismiss.setAttribute("data-dismiss-welcome", "");
    empty.append(title, description, commandHint);
    if (resources) {
      empty.append(resources);
    }
    empty.append(tryLabel, promptList, dismiss);
    return empty;
  }
  function createStartupResourcesElement(resources) {
    if (resources.length === 0) {
      return void 0;
    }
    const container = document.createElement("div");
    container.className = "empty-state__resources";
    for (const section of resources) {
      if (section.items.length === 0) {
        continue;
      }
      const row = document.createElement("div");
      row.className = "empty-state__resource-row";
      const heading = document.createElement("span");
      heading.className = "empty-state__resource-heading";
      heading.textContent = `[${section.name}]`;
      const items = document.createElement("span");
      items.className = "empty-state__resource-items";
      items.textContent = section.items.join(", ");
      row.append(heading, items);
      container.append(row);
    }
    return container.childElementCount > 0 ? container : void 0;
  }
  function getImagesSignature2(images) {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }
    return images.map((image) => {
      const data = typeof image.data === "string" ? image.data : "";
      const prefix = data.slice(0, 32);
      const suffix = data.length > 32 ? data.slice(-32) : "";
      return [
        image.type ?? "",
        image.mimeType ?? "",
        image.alt ?? "",
        data.length,
        prefix,
        suffix
      ].join("\0");
    }).join("");
  }
  function canReuseMessageElement(view, message, showRole, imagesSignature, allowRemoteImages, copyable, hasBody) {
    return view.message.role === message.role && Boolean(view.message.error) === Boolean(message.error) && (view.message.variant || "") === (message.variant || "") && view.showRole === showRole && view.imagesSignature === imagesSignature && view.allowRemoteImages === allowRemoteImages && view.copyable === copyable && view.hasBody === hasBody;
  }
  function shouldRenderMessageBody(message) {
    const activities = Array.isArray(message.activities) ? message.activities : [];
    return Boolean(message.text || message.error || hasRenderableImages(message.images) || activities.length === 0);
  }
  function hasRenderableImages(images) {
    if (!Array.isArray(images)) {
      return false;
    }
    return images.some((image) => {
      const mimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : "";
      return image.type === "image" && typeof image.data === "string" && Boolean(image.data) && (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/gif" || mimeType === "image/webp");
    });
  }
  function getMessageRenderPlan(messageCount) {
    if (messageCount <= largeTranscriptCollapseThreshold) {
      return Array.from({ length: messageCount }, (_, index) => ({ kind: "message", index }));
    }
    const headCount = Math.min(largeTranscriptHeadCount, messageCount);
    const tailStart = Math.max(headCount, messageCount - largeTranscriptTailCount);
    const collapsedCount = Math.max(0, tailStart - headCount);
    const plan = [];
    for (let index = 0; index < headCount; index += 1) {
      plan.push({ kind: "message", index });
    }
    if (collapsedCount > 0) {
      plan.push({ kind: "collapse", count: collapsedCount });
    }
    for (let index = tailStart; index < messageCount; index += 1) {
      plan.push({ kind: "message", index });
    }
    return plan;
  }
  function getActiveActivityIds(messages) {
    const ids = /* @__PURE__ */ new Set();
    for (const message of messages) {
      for (const activity of message.activities ?? []) {
        if (typeof activity.id === "string" && activity.id) {
          ids.delete(activity.id);
          ids.add(activity.id);
        }
      }
    }
    return ids;
  }
  function getExpandableToolActivityIds(messages) {
    const ids = [];
    for (const message of messages) {
      for (const activity of message.activities ?? []) {
        if (typeof activity.id === "string" && activity.id && isExpandableToolActivity(activity)) {
          ids.push(activity.id);
        }
      }
    }
    return ids;
  }
  function isExpandableToolActivity(activity) {
    return typeof activity.expandedBody === "string" || activity.kind === "tool_execution" && activity.status === "running" && typeof activity.body === "string" && activity.body.length > 0;
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

  // src/webview/messages/transcriptSearch.ts
  var TranscriptSearchController = class {
    constructor(options) {
      this.options = options;
      const { element, input, countElement, previousButton, nextButton, closeButton } = createTranscriptSearchElement();
      this.element = element;
      this.input = input;
      this.countElement = countElement;
      this.previousButton = previousButton;
      this.nextButton = nextButton;
      this.closeButton = closeButton;
      this.options.messagesElement.parentElement?.insertBefore(this.element, this.options.messagesElement);
      this.attachEventListeners();
      this.syncVisibility();
    }
    options;
    element;
    input;
    countElement;
    previousButton;
    nextButton;
    closeButton;
    query = "";
    open = false;
    pendingFocus = false;
    matches = [];
    currentIndex;
    openSearch() {
      this.open = true;
      this.pendingFocus = true;
      this.syncVisibility();
      this.refreshHighlights({ resetCurrent: this.currentIndex === void 0 });
    }
    closeSearch() {
      if (!this.open && !this.query) {
        return;
      }
      this.open = false;
      this.pendingFocus = false;
      this.query = "";
      this.input.value = "";
      this.currentIndex = void 0;
      this.clearHighlights();
      this.syncVisibility();
      this.options.onClose();
    }
    syncForRender() {
      this.syncVisibility();
      if (this.open && this.query) {
        this.refreshHighlights({ preserveCurrent: true });
      }
    }
    refreshHighlights(options = {}) {
      this.clearHighlights();
      const query = this.query;
      if (!query) {
        this.matches = [];
        this.currentIndex = void 0;
        this.syncCount();
        return;
      }
      this.matches = highlightTranscriptMatches(this.options.messagesContentElement, query);
      if (this.matches.length === 0) {
        this.currentIndex = void 0;
        this.syncCount();
        return;
      }
      if (options.resetCurrent || this.currentIndex === void 0) {
        this.currentIndex = 0;
      } else if (options.preserveCurrent) {
        this.currentIndex = Math.min(this.currentIndex, this.matches.length - 1);
      }
      this.syncCurrentMatch({ scroll: Boolean(this.open && this.options.isChatMainVisible()) });
    }
    handleGlobalKeydown(event) {
      if (isTranscriptSearchShortcut(event)) {
        if (!this.options.isChatMainVisible()) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        this.openSearch();
        return true;
      }
      if (event.key === "Escape" && this.open && isWithinElement(event.target, this.element)) {
        event.preventDefault();
        event.stopPropagation();
        this.closeSearch();
        return true;
      }
      return false;
    }
    attachEventListeners() {
      this.input.addEventListener("input", () => {
        this.query = this.input.value;
        this.refreshHighlights({ resetCurrent: true });
      });
      this.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          this.moveCurrentMatch(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.closeSearch();
        }
      });
      this.previousButton.addEventListener("click", () => this.moveCurrentMatch(-1));
      this.nextButton.addEventListener("click", () => this.moveCurrentMatch(1));
      this.closeButton.addEventListener("click", () => this.closeSearch());
    }
    moveCurrentMatch(direction) {
      this.currentIndex = moveTranscriptSearchMatchIndex(this.currentIndex, this.matches.length, direction);
      this.syncCurrentMatch({ scroll: true });
      this.input.focus({ preventScroll: true });
    }
    syncCurrentMatch(options) {
      const current = this.currentIndex;
      for (const element of this.options.messagesContentElement.querySelectorAll(".tauren-transcript-search-match--current")) {
        element.classList.remove("tauren-transcript-search-match--current");
      }
      if (current === void 0) {
        this.syncCount();
        return;
      }
      const match = this.matches[current];
      for (const element of match?.elements ?? []) {
        element.classList.add("tauren-transcript-search-match--current");
      }
      if (options.scroll) {
        match?.elements[0]?.scrollIntoView({ block: "center", inline: "nearest" });
      }
      this.syncCount();
    }
    syncCount() {
      if (!this.query) {
        this.countElement.textContent = "";
      } else if (this.matches.length === 0 || this.currentIndex === void 0) {
        this.countElement.textContent = "No results";
      } else {
        this.countElement.textContent = `${this.currentIndex + 1}/${this.matches.length}`;
      }
      const disabled = this.matches.length === 0;
      this.previousButton.disabled = disabled;
      this.nextButton.disabled = disabled;
    }
    syncVisibility() {
      const visible = this.open && this.options.isChatMainVisible();
      this.element.classList.toggle("tauren-transcript-search--open", visible);
      this.element.setAttribute("aria-hidden", visible ? "false" : "true");
      this.element.inert = !visible;
      if (visible && this.pendingFocus) {
        this.pendingFocus = false;
        requestAnimationFrame(() => {
          if (this.open && this.options.isChatMainVisible()) {
            this.input.focus({ preventScroll: true });
            this.input.select();
          }
        });
      }
    }
    clearHighlights() {
      clearTranscriptSearchHighlights(this.options.messagesContentElement);
      this.matches = [];
    }
  };
  function findPlainTextMatches(text, query) {
    const normalizedQuery = query.toLocaleLowerCase();
    if (!text || !normalizedQuery) {
      return [];
    }
    const normalizedText = text.toLocaleLowerCase();
    const matches = [];
    let index = normalizedText.indexOf(normalizedQuery);
    while (index !== -1) {
      matches.push({ start: index, end: index + normalizedQuery.length });
      index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length);
    }
    return matches;
  }
  function moveTranscriptSearchMatchIndex(currentIndex, matchCount, direction) {
    if (matchCount <= 0) {
      return void 0;
    }
    if (currentIndex === void 0 || currentIndex < 0 || currentIndex >= matchCount) {
      return direction < 0 ? matchCount - 1 : 0;
    }
    return (currentIndex + direction + matchCount) % matchCount;
  }
  function highlightTranscriptMatches(root, query) {
    const { text, segments } = collectTranscriptText(root);
    const ranges = findPlainTextMatches(text, query);
    if (ranges.length === 0) {
      return [];
    }
    for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const segment = segments[segmentIndex];
      const overlaps = getSegmentMatches(segment, ranges);
      if (overlaps.length > 0) {
        wrapSegmentMatches(segment.node, overlaps);
      }
    }
    return ranges.map((_range, index) => ({
      elements: Array.from(root.querySelectorAll(`[data-transcript-search-match-index="${index}"]`))
    }));
  }
  function collectTranscriptText(root) {
    const segments = [];
    let text = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => isSearchableTranscriptTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    let current = walker.nextNode();
    while (current) {
      const node = current;
      const value = node.textContent ?? "";
      segments.push({ node, start: text.length, end: text.length + value.length });
      text += value;
      current = walker.nextNode();
    }
    return { text, segments };
  }
  function getSegmentMatches(segment, ranges) {
    const matches = [];
    for (const [index, range] of ranges.entries()) {
      const start = Math.max(range.start, segment.start);
      const end = Math.min(range.end, segment.end);
      if (start < end) {
        matches.push({ index, start: start - segment.start, end: end - segment.start });
      }
    }
    return matches;
  }
  function wrapSegmentMatches(node, matches) {
    let currentNode = node;
    for (const match of matches.sort((a, b) => b.start - a.start)) {
      const after = currentNode.splitText(match.end);
      const matched = currentNode.splitText(match.start);
      const marker = document.createElement("mark");
      marker.className = "tauren-transcript-search-match";
      marker.dataset.transcriptSearchMatchIndex = String(match.index);
      marker.append(matched);
      currentNode.parentNode?.insertBefore(marker, after);
    }
  }
  function clearTranscriptSearchHighlights(root) {
    const markers = Array.from(root.querySelectorAll(".tauren-transcript-search-match"));
    for (const marker of markers) {
      const text = document.createTextNode(marker.textContent ?? "");
      marker.replaceWith(text);
      text.parentElement?.normalize();
    }
  }
  function isSearchableTranscriptTextNode(node) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    return Boolean(parent && text && !parent.closest([
      ".tauren-transcript-search",
      ".tauren-icon-action-tooltip",
      ".message__actions",
      ".tauren-code-block__actions",
      "button",
      "input",
      "textarea",
      "select",
      "[hidden]",
      '[aria-hidden="true"]'
    ].join(",")));
  }
  function createTranscriptSearchElement() {
    const element = document.createElement("div");
    element.className = "tauren-transcript-search";
    element.setAttribute("role", "search");
    const input = document.createElement("input");
    input.className = "tauren-transcript-search__input";
    input.type = "search";
    input.placeholder = "Search transcript";
    input.setAttribute("aria-label", "Search transcript");
    input.spellcheck = false;
    const countElement = document.createElement("span");
    countElement.className = "tauren-transcript-search__count";
    countElement.setAttribute("aria-live", "polite");
    const previousButton = createSearchButton("Previous match", "up");
    const nextButton = createSearchButton("Next match", "down");
    const closeButton = createCloseButton();
    const actions = document.createElement("span");
    actions.className = "tauren-transcript-search__actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Transcript search navigation");
    actions.append(previousButton, nextButton, closeButton);
    element.append(input, countElement, actions);
    return { element, input, countElement, previousButton, nextButton, closeButton };
  }
  function createSearchButton(label, direction) {
    const button = document.createElement("button");
    button.className = "tauren-transcript-search__button";
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.innerHTML = direction === "up" ? '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" fill="none"><path d="M4.5 11.25L9 6.75L13.5 11.25" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" fill="none"><path d="M4.5 6.75L9 11.25L13.5 6.75" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return button;
  }
  function createCloseButton() {
    const button = document.createElement("button");
    button.className = "tauren-transcript-search__button tauren-transcript-search__button--close";
    button.type = "button";
    button.setAttribute("aria-label", "Close transcript search");
    button.innerHTML = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" fill="none"><path d="M5.25 5.25L12.75 12.75M12.75 5.25L5.25 12.75" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    return button;
  }
  function isTranscriptSearchShortcut(event) {
    return event.key.toLowerCase() === "f" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
  }
  function isWithinElement(target, element) {
    return target instanceof Node && element.contains(target);
  }

  // src/webview/sessions/sessionFormat.ts
  function getSessionDisplayName(session) {
    const name = sanitizeSessionTitle(session.name);
    if (name) {
      return name;
    }
    if (session.metadataState === "loading") {
      return "Loading metadata\u2026";
    }
    const firstMessage = sanitizeSessionTitle(session.firstMessage);
    return firstMessage || shortenPath(session.cwd) || "Untitled session";
  }
  function getSessionNameEditValue(session) {
    const explicitName = typeof session.name === "string" ? session.name.trim() : "";
    if (explicitName) {
      return explicitName;
    }
    return session.metadataState === "loading" ? "" : getSessionDisplayName(session);
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
    const age = formatRelativeTime(session.modified);
    const cwd = shortenPath(session.cwd);
    if (session.metadataState === "loading") {
      return ["Loading metadata\u2026", age, cwd].filter(Boolean).join(" \xB7 ");
    }
    const count = typeof session.messageCount === "number" ? session.messageCount : 0;
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

  // src/settings/settingsRegistry.ts
  var thinkingLevelOptions = [
    { value: "off", label: "Off" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "X High" }
  ];
  var deliveryModeOptions = [
    { value: "one-at-a-time", label: "One at a time" },
    { value: "all", label: "All queued" }
  ];
  var transportOptions = [
    { value: "sse", label: "SSE" },
    { value: "websocket", label: "WebSocket" },
    { value: "auto", label: "Auto" }
  ];
  var backendOptions = [
    { value: "pi", label: "Pi" },
    { value: "kward", label: "Kward" }
  ];
  var customUiThemeOptions = [
    { value: "default", label: "Default" },
    { value: "modern", label: "Modern" },
    { value: "crt", label: "CRT" },
    { value: "amber", label: "Amber" },
    { value: "matrix", label: "Matrix" }
  ];
  var voiceModelOptions = [
    { value: "tiny.en", label: "Tiny English" },
    { value: "base.en", label: "Base English" },
    { value: "small.en", label: "Small English" },
    { value: "tiny", label: "Tiny Multilingual" },
    { value: "base", label: "Base Multilingual" },
    { value: "small", label: "Small Multilingual" }
  ];
  var voiceLanguageOptions = [
    { value: "auto", label: "Auto-detect" },
    { value: "en", label: "English" },
    { value: "de", label: "German" },
    { value: "fr", label: "French" },
    { value: "es", label: "Spanish" },
    { value: "it", label: "Italian" },
    { value: "pt", label: "Portuguese" },
    { value: "nl", label: "Dutch" },
    { value: "pl", label: "Polish" },
    { value: "ja", label: "Japanese" },
    { value: "ko", label: "Korean" },
    { value: "zh", label: "Chinese" }
  ];
  var voiceModeOptions = [
    { value: "pushToTalk", label: "Push to talk" },
    { value: "handsFree", label: "Hands-free" }
  ];
  var voiceActivationModeOptions = [
    { value: "toggle", label: "Click to toggle" },
    { value: "hold", label: "Hold to talk" }
  ];
  var voiceMaxRecordingSecondsOptions = [
    { value: "0", label: "No limit" },
    { value: "15", label: "15 seconds" },
    { value: "30", label: "30 seconds" },
    { value: "60", label: "1 minute" },
    { value: "120", label: "2 minutes" }
  ];
  var voiceHandsFreeSensitivityOptions = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" }
  ];
  var voiceHandsFreeSilenceSecondsOptions = [
    { value: "0.8", label: "0.8 seconds" },
    { value: "1.2", label: "1.2 seconds" },
    { value: "1.5", label: "1.5 seconds" },
    { value: "2", label: "2 seconds" }
  ];
  var voiceTranscriptActionOptions = [
    { value: "insert", label: "Insert into Chat Input" },
    { value: "submit", label: "Submit automatically" }
  ];
  var settingsSections = [
    {
      id: "login",
      label: "Login",
      eyebrow: "Backend auth",
      title: "Login",
      description: "Configure runtime provider authentication for the selected backend."
    },
    {
      id: "appearance",
      label: "Appearance",
      eyebrow: "Tauren host",
      title: "Appearance",
      description: "Tauren-owned presentation controls for the sidebar and Pi extension UI."
    },
    {
      id: "extensions",
      label: "Extensions",
      eyebrow: "Pi extensions",
      title: "Extensions",
      description: "Sidebar-only controls for Pi extension surfaces in Tauren."
    },
    {
      id: "runtime",
      label: "Runtime",
      eyebrow: "Agent runtime",
      title: "Runtime",
      description: "Backend defaults and runtime behavior. The selected backend remains the source of truth."
    },
    {
      id: "scopedModels",
      label: "Scoped Models",
      eyebrow: "Agent runtime",
      title: "Scoped Models",
      description: "Choose and order the models Tauren sends to the selected backend for model cycling."
    },
    {
      id: "voice",
      label: "Voice",
      eyebrow: "Local STT",
      title: "Voice",
      description: "Download local whisper.cpp assets and configure Tauren voice input."
    },
    {
      id: "workspaceSafety",
      label: "Safety",
      eyebrow: "Guardrails",
      title: "Workspace / Safety",
      description: "Explicit workflow and workspace safety controls."
    },
    {
      id: "advanced",
      label: "Advanced",
      eyebrow: "Advanced",
      title: "Advanced",
      description: "Less common controls shown plainly, without turning Tauren into a settings dump."
    }
  ];
  var settingDefinitions = [
    {
      id: "tauren.backend",
      owner: "tauren",
      section: "runtime",
      label: "Backend",
      description: "Agent backend Tauren should use for sidebar chat.",
      control: "select",
      options: backendOptions,
      defaultValue: "pi",
      helper: "Kward is experimental and uses a local RPC process.",
      liveBehavior: "reload"
    },
    {
      id: "tauren.kward.path",
      owner: "tauren",
      section: "runtime",
      label: "Kward path",
      description: "Optional path to a Kward executable used when Backend is Kward.",
      control: "text",
      defaultValue: "",
      helper: "Leave empty to launch the global kward rpc command.",
      liveBehavior: "reload"
    },
    {
      id: "tauren.outputColors",
      owner: "tauren",
      section: "appearance",
      label: "Output colors",
      description: "Render ANSI and syntax colors in Tauren output.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate"
    },
    {
      id: "tauren.animationsEnabled",
      owner: "tauren",
      section: "appearance",
      label: "Animations",
      description: "Use subtle surface and counter animations.",
      control: "toggle",
      defaultValue: true,
      helper: "Reduced-motion preferences still disable motion.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.showWelcome",
      owner: "tauren",
      section: "appearance",
      label: "Welcome message",
      description: "Show the Welcome to Tauren empty state for new chats.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate"
    },
    {
      id: "tauren.useTaurenShareViewer",
      owner: "tauren",
      section: "appearance",
      label: "Tauren export style",
      description: "Use Tauren docs styling for HTML exports and new shared session links.",
      control: "toggle",
      defaultValue: true,
      helper: "When disabled, exports keep Pi styling and /share uses pi.dev unless PI_SHARE_VIEWER_URL is set.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.customUiTheme",
      owner: "tauren",
      section: "appearance",
      label: "Custom UI theme",
      description: "Theme for Pi extension custom UI terminal panels.",
      control: "select",
      options: customUiThemeOptions,
      defaultValue: "default",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.enabled",
      owner: "tauren",
      section: "voice",
      label: "Voice input",
      description: "Show the microphone control in the Chat Input and allow local speech-to-text.",
      control: "toggle",
      defaultValue: false,
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.model",
      owner: "tauren",
      section: "voice",
      label: "Voice model",
      description: "Local Whisper model Tauren should use for speech-to-text.",
      control: "select",
      options: voiceModelOptions,
      defaultValue: "base.en",
      helper: "Download the selected model below before using voice input.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.inputDevice",
      owner: "tauren",
      section: "voice",
      label: "Voice input device",
      description: "Microphone or audio input source Tauren should record from.",
      control: "text",
      defaultValue: "default",
      helper: "Use the device selector below to change this setting.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.language",
      owner: "tauren",
      section: "voice",
      label: "Voice language",
      description: "Language Tauren should pass to whisper.cpp for speech-to-text.",
      control: "select",
      options: voiceLanguageOptions,
      defaultValue: "auto",
      helper: "English-only models always use English. Choose a multilingual model for auto-detect or non-English input.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.mode",
      owner: "tauren",
      section: "voice",
      label: "Voice mode",
      description: "Choose manual recording or explicit hands-free listening.",
      control: "select",
      options: voiceModeOptions,
      defaultValue: "pushToTalk",
      helper: "Hands-free keeps the selected microphone open locally while enabled.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.activationMode",
      owner: "tauren",
      section: "voice",
      label: "Microphone action",
      description: "Choose whether the microphone button toggles recording or records only while held.",
      control: "select",
      options: voiceActivationModeOptions,
      defaultValue: "toggle",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.maxRecordingSeconds",
      owner: "tauren",
      section: "voice",
      label: "Maximum recording length",
      description: "Stop recording automatically after this duration.",
      control: "select",
      options: voiceMaxRecordingSecondsOptions,
      defaultValue: "60",
      helper: "Use this as a safety stop for long or forgotten recordings.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.handsFreeSensitivity",
      owner: "tauren",
      section: "voice",
      label: "Hands-free sensitivity",
      description: "Choose how readily hands-free listening treats microphone input as speech.",
      control: "select",
      options: voiceHandsFreeSensitivityOptions,
      defaultValue: "normal",
      helper: "Use Low in noisy rooms, High for quieter speech.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.handsFreeSilenceSeconds",
      owner: "tauren",
      section: "voice",
      label: "Hands-free silence stop",
      description: "Silence duration after speech before Tauren finalizes and transcribes the utterance.",
      control: "select",
      options: voiceHandsFreeSilenceSecondsOptions,
      defaultValue: "1.2",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.voice.transcriptAction",
      owner: "tauren",
      section: "voice",
      label: "After transcription",
      description: "Choose what Tauren does with completed voice transcripts.",
      control: "select",
      options: voiceTranscriptActionOptions,
      defaultValue: "insert",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.extensions.aboveWidgetsEnabled",
      owner: "tauren",
      section: "extensions",
      label: "Enable above widgets",
      description: "Show Pi extension widgets above the composer.",
      control: "toggle",
      defaultValue: true,
      helper: "Sidebar-only setting; turning this off clears current above widgets.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.extensions.belowWidgetsEnabled",
      owner: "tauren",
      section: "extensions",
      label: "Enable below widgets",
      description: "Show Pi extension widgets below the composer.",
      control: "toggle",
      defaultValue: true,
      helper: "Sidebar-only setting; turning this off clears current below widgets.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.extensions.statusBarEnabled",
      owner: "tauren",
      section: "extensions",
      label: "Enable status bar",
      description: "Show one-line Pi extension status updates below the composer.",
      control: "toggle",
      defaultValue: true,
      helper: "Sidebar-only setting; turning this off clears current statuses.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.extensions.backgroundColorsEnabled",
      owner: "tauren",
      section: "extensions",
      label: "Enable background colors",
      description: "Render background colors sent by Pi extension widgets.",
      control: "toggle",
      defaultValue: true,
      helper: "Foreground colors still follow Output colors.",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.extensions.monospaceFontEnabled",
      owner: "tauren",
      section: "extensions",
      label: "Use monospace font",
      description: "Use the editor monospace font for Pi extension widgets and status.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate"
    },
    {
      id: "tauren.blockHttpsImages",
      owner: "tauren",
      section: "workspaceSafety",
      label: "Block HTTPS images",
      description: "Block remote HTTPS images in chat markdown.",
      control: "toggle",
      defaultValue: true,
      helper: "Turn this off to allow external HTTPS image requests while keeping local/workspace images available.",
      liveBehavior: "immediate",
      danger: true
    },
    {
      id: "defaultProvider",
      owner: "pi",
      section: "runtime",
      label: "Default provider",
      description: "Provider Pi should prefer for new model defaults.",
      control: "select",
      defaultValue: "",
      helper: "Provider-only changes are persisted for new sessions.",
      liveBehavior: "reload"
    },
    {
      id: "defaultModel",
      owner: "pi",
      section: "runtime",
      label: "Default model",
      description: "Model used by Pi for this session and future defaults.",
      control: "select",
      defaultValue: "",
      liveBehavior: "immediate"
    },
    {
      id: "defaultThinkingLevel",
      owner: "pi",
      section: "runtime",
      label: "Thinking level",
      description: "Default reasoning effort for models that support thinking.",
      control: "select",
      options: thinkingLevelOptions,
      defaultValue: "off",
      liveBehavior: "immediate"
    },
    {
      id: "hideThinkingBlock",
      owner: "pi",
      section: "runtime",
      label: "Hide thinking blocks",
      description: "Hide model thinking content in the Tauren transcript.",
      control: "toggle",
      defaultValue: false,
      liveBehavior: "immediate"
    },
    {
      id: "quietStartup",
      owner: "pi",
      section: "runtime",
      label: "Quiet startup",
      description: "Show a blank Tauren transcript for empty new sessions.",
      control: "toggle",
      defaultValue: false,
      liveBehavior: "immediate"
    },
    {
      id: "compaction.enabled",
      owner: "pi",
      section: "runtime",
      label: "Auto-compaction",
      description: "Let Pi summarize older context when the conversation grows too large.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate"
    },
    {
      id: "retry.enabled",
      owner: "pi",
      section: "runtime",
      label: "Auto-retry",
      description: "Let Pi retry transient provider failures.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate"
    },
    {
      id: "steeringMode",
      owner: "pi",
      section: "runtime",
      label: "Steering delivery",
      description: "How steering messages are delivered while Pi is running.",
      control: "select",
      options: deliveryModeOptions,
      defaultValue: "one-at-a-time",
      liveBehavior: "immediate"
    },
    {
      id: "followUpMode",
      owner: "pi",
      section: "runtime",
      label: "Follow-up delivery",
      description: "How follow-up prompts are delivered after the current run.",
      control: "select",
      options: deliveryModeOptions,
      defaultValue: "one-at-a-time",
      liveBehavior: "immediate"
    },
    {
      id: "tauren.confirmSessionDeletion",
      owner: "tauren",
      section: "workspaceSafety",
      label: "Confirm deletion",
      description: "Ask before moving Tauren sessions to Trash.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate",
      danger: true
    },
    {
      id: "tauren.restrictFileReferencesToWorkspace",
      owner: "tauren",
      section: "workspaceSafety",
      label: "Restrict file links",
      description: "Only open Tauren sidebar file references when they resolve inside the workspace.",
      control: "toggle",
      defaultValue: true,
      helper: "Turn this off to allow Tauren sidebar links to open absolute local files outside the workspace.",
      liveBehavior: "immediate",
      danger: true
    },
    {
      id: "tauren.rejectEditWriteOutsideWorkspace",
      owner: "tauren",
      section: "workspaceSafety",
      label: "Reject external edits",
      description: "Reject Pi edit/write mutations outside the active workspace folder.",
      control: "toggle",
      defaultValue: false,
      helper: "This guardrail does not restrict bash commands.",
      liveBehavior: "immediate",
      danger: true
    },
    {
      id: "tauren.debugPerformance",
      owner: "tauren",
      section: "advanced",
      label: "Debug performance",
      description: "Collect Tauren performance diagnostics in the output channel and diagnostics view.",
      control: "toggle",
      defaultValue: false,
      liveBehavior: "immediate",
      subtle: true
    },
    {
      id: "tauren.readyScript",
      owner: "tauren",
      section: "advanced",
      label: "Ready script",
      description: "Executable script Tauren runs when Pi becomes ready.",
      control: "text",
      defaultValue: "",
      helper: "Relative paths resolve from the workspace folder.",
      liveBehavior: "immediate",
      subtle: true
    },
    {
      id: "tauren.readyScriptEnabled",
      owner: "tauren",
      section: "advanced",
      label: "Run ready script",
      description: "Temporarily enable or disable the ready script without clearing its path.",
      control: "toggle",
      defaultValue: true,
      liveBehavior: "immediate",
      subtle: true
    },
    {
      id: "transport",
      owner: "pi",
      section: "advanced",
      label: "Transport",
      description: "Preferred provider transport when multiple transports are available.",
      control: "select",
      options: transportOptions,
      defaultValue: "sse",
      helper: "Persisted for Pi; takes effect after reload or a new session.",
      liveBehavior: "reload",
      subtle: true
    },
    {
      id: "images.blockImages",
      owner: "pi",
      section: "advanced",
      label: "Block LLM images",
      description: "Prevent images from being sent to the model.",
      control: "toggle",
      defaultValue: false,
      helper: "Persisted for Pi; takes effect after reload or a new session.",
      liveBehavior: "reload",
      subtle: true
    },
    {
      id: "images.autoResize",
      owner: "pi",
      section: "advanced",
      label: "Auto-resize images",
      description: "Let Pi resize images before sending them to the model.",
      control: "toggle",
      defaultValue: true,
      helper: "Persisted for Pi; takes effect after reload or a new session.",
      liveBehavior: "reload",
      subtle: true
    },
    {
      id: "enabledModels",
      owner: "pi",
      section: "scopedModels",
      label: "Model cycling scope",
      description: "Enable, disable, and order models used for model cycling.",
      control: "scopedModels",
      defaultValue: [],
      helper: "Saved immediately to Pi enabledModels. Unselected models are hidden from the model picker.",
      liveBehavior: "immediate"
    },
    {
      id: "enableSkillCommands",
      owner: "pi",
      section: "advanced",
      label: "Skill commands",
      description: "Register loaded skills as slash commands.",
      control: "toggle",
      defaultValue: true,
      helper: "Persisted for Pi; takes effect after reload or a new session.",
      liveBehavior: "reload",
      subtle: true
    }
  ];
  function getSettingDefinition(id) {
    return settingDefinitions.find((definition) => definition.id === id);
  }
  function getSettingsForSection(section) {
    return settingDefinitions.filter((definition) => definition.section === section);
  }
  function isSettingId(value) {
    return typeof value === "string" && Boolean(getSettingDefinition(value));
  }
  function normalizeSettingValue(id, value) {
    const definition = getSettingDefinition(id);
    if (!definition) {
      return void 0;
    }
    if (definition.control === "toggle") {
      return typeof value === "boolean" ? value : void 0;
    }
    if (definition.control === "readonlyList" || definition.control === "scopedModels") {
      return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value.map((entry) => entry.trim()).filter(Boolean) : void 0;
    }
    if (typeof value !== "string") {
      return void 0;
    }
    const trimmed = definition.control === "text" ? value.trim() : value;
    if (definition.options && !definition.options.some((option) => option.value === trimmed)) {
      return void 0;
    }
    return trimmed;
  }

  // src/webviewProtocol/values.ts
  var webviewCustomUiThemes = ["default", "modern", "crt", "amber", "matrix"];
  var webviewLanes = ["chat", "sessions", "tree"];
  var webviewSettingsSections = settingsSections.map((section) => section.id);
  var webviewSessionItemCommands = ["rename", "showChanges", "fork", "clone", "compact", "export", "delete"];
  function parseWebviewCustomUiTheme(value, fallback = "default") {
    return includesValue(webviewCustomUiThemes, value) ? value : fallback;
  }
  function parseWebviewLane(value, fallback = "chat") {
    return includesValue(webviewLanes, value) ? value : fallback;
  }
  function parseWebviewSettingsSection(value, fallback) {
    return includesValue(webviewSettingsSections, value) ? value : fallback;
  }
  function parseWebviewSessionItemCommand(command) {
    return includesValue(webviewSessionItemCommands, command) ? command : void 0;
  }
  function includesValue(values, value) {
    return typeof value === "string" && values.includes(value);
  }

  // src/webview/sessions/sessionItemCommands.ts
  var sessionItemMenuCommands = webviewSessionItemCommands;
  var sessionItemCommandIcons = {
    rename: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4.1 11.9L5.45 11.6L11.15 5.9C11.55 5.5 11.55 4.85 11.15 4.45L10.9 4.2C10.5 3.8 9.85 3.8 9.45 4.2L3.75 9.9L3.45 11.25C3.37 11.65 3.7 11.98 4.1 11.9Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.85 4.8L10.55 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
    showChanges: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 4.5H12.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M3.5 8H9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M3.5 11.5H7.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M11.1 9.1V13.1M9.1 11.1H13.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>',
    fork: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><path d="M5.5 4.25V8.5C5.5 10.16 6.84 11.5 8.5 11.5H10.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 4.25V14.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M10.25 8.5L13.25 11.5L10.25 14.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.5" cy="4.25" r="1.55" fill="currentColor"/><circle cx="5.5" cy="14.75" r="1.55" fill="currentColor"/></svg>',
    clone: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none"><rect x="4.25" y="6.25" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.35"/><path d="M7.25 4.25H13.25C14.08 4.25 14.75 4.92 14.75 5.75V11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    compact: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3.5H3.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 3.5H12.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12.5H3.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 12.5H12.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.3 5.3L7.05 7.05M10.7 5.3L8.95 7.05M5.3 10.7L7.05 8.95M10.7 10.7L8.95 8.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    export: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3.5V10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M5.6 5.9L8 3.5L10.4 5.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.5V11.6C4 12.1 4.4 12.5 4.9 12.5H11.1C11.6 12.5 12 12.1 12 11.6V9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>',
    delete: '<svg class="tauren-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M6 2h4l1 1h3v1H2V3h3l1-1Zm-2 3h8l-.6 9.2A2 2 0 0 1 9.4 16H6.6a2 2 0 0 1-2-1.8L4 5Zm2 1v8h1V6H6Zm3 0v8h1V6H9Z"/></svg>'
  };
  function parseSessionItemCommand(command) {
    return parseWebviewSessionItemCommand(command);
  }
  function canOpenSessionItemMenu(session) {
    return session.path.length > 0;
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

  // src/webview/sessions/sessionElements.ts
  function getSessionIndicatorKinds(session) {
    const indicators = [];
    if (session.liveStatus === "running" || session.liveStatus === "error") {
      indicators.push(session.liveStatus);
    } else if (session.liveStatus === "done") {
      indicators.push("done");
    }
    return indicators;
  }
  function createSessionItemElement(options) {
    const { session, index } = options;
    const item = document.createElement("div");
    item.id = "session-" + index;
    item.className = "sessions__item" + (index === options.selectedIndex ? " sessions__item--active" : "") + (session.current ? " sessions__item--current" : "") + (session.metadataState === "loading" ? " sessions__item--loading" : "") + (session.liveStatus ? " sessions__item--" + session.liveStatus : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === options.selectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    const prefix = document.createElement("span");
    prefix.className = "sessions__prefix";
    prefix.textContent = buildSessionTreePrefix(session);
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
    const roleClass = getTreeRoleClass(treeItem.role);
    item.className = "sessions__item sessions__tree-item sessions__tree-item--" + roleClass + (index === options.selectedIndex ? " sessions__item--active" : "") + (treeItem.current ? " sessions__item--current" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === options.selectedIndex ? "true" : "false");
    item.setAttribute("data-index", String(index));
    item.disabled = options.disabled;
    item.append(createTreePrefixElement(treeItem, index === options.selectedIndex));
    const title = document.createElement("span");
    title.className = "sessions__title sessions__tree-title";
    if (treeItem.label) {
      const label = document.createElement("span");
      label.className = "sessions__tree-label";
      label.textContent = `[${treeItem.label}]`;
      title.append(label);
      if (treeItem.labelTimestamp) {
        const timestamp = document.createElement("span");
        timestamp.className = "sessions__meta sessions__tree-label-time";
        timestamp.textContent = formatTreeLabelTimestamp(treeItem.labelTimestamp);
        title.append(timestamp);
      }
    }
    if (treeItem.role === "tool") {
      const toolText = document.createElement("span");
      toolText.className = "sessions__title-text sessions__tree-content";
      toolText.textContent = treeItem.text || "[tool]";
      title.append(toolText);
    } else {
      const role = document.createElement("span");
      role.className = "sessions__role sessions__tree-role";
      role.textContent = formatTreeRoleLabel(treeItem.role);
      title.append(role);
      const titleText = document.createElement("span");
      titleText.className = "sessions__title-text sessions__tree-content";
      titleText.textContent = treeItem.text || "(empty)";
      title.append(titleText);
    }
    item.append(title);
    return item;
  }
  function formatTreeRoleLabel(role) {
    return role === "summary" ? "[branch summary]:" : role + ":";
  }
  function formatTreeLabelTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString(void 0, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  function createTreePrefixElement(treeItem, selected) {
    const prefix = document.createElement("span");
    prefix.className = "sessions__prefix sessions__tree-prefix";
    const cursor = document.createElement("span");
    cursor.className = "sessions__tree-cursor";
    cursor.textContent = selected ? "\u203A" : "";
    prefix.append(cursor);
    for (const chunk of getTreePrefixChunks(treeItem.prefix ?? "")) {
      const connector = document.createElement("span");
      connector.className = "sessions__tree-connector" + getTreeConnectorClass(chunk);
      connector.textContent = getTreeConnectorText(chunk);
      prefix.append(connector);
    }
    const activePath = document.createElement("span");
    activePath.className = "sessions__tree-active-path";
    activePath.textContent = treeItem.activePath ? "\u2022" : "";
    prefix.append(activePath);
    return prefix;
  }
  function getTreePrefixChunks(prefix) {
    const chunks = [];
    for (let index = 0; index < prefix.length; index += 3) {
      chunks.push(prefix.slice(index, index + 3));
    }
    return chunks;
  }
  function getTreeConnectorText(chunk) {
    if (chunk.includes("\u251C")) {
      return chunk.includes("\u229F") ? "\u251C\u229F" : "\u251C\u2500";
    }
    if (chunk.includes("\u2514")) {
      return chunk.includes("\u229F") ? "\u2514\u229F" : "\u2514\u2500";
    }
    if (chunk.includes("\u2502")) {
      return "\u2502";
    }
    return "";
  }
  function getTreeConnectorClass(chunk) {
    if (chunk.includes("\u251C") || chunk.includes("\u2514")) {
      return " sessions__tree-connector--branch";
    }
    if (chunk.includes("\u2502")) {
      return " sessions__tree-connector--gutter";
    }
    return " sessions__tree-connector--blank";
  }
  function getTreeRoleClass(role) {
    return role.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "entry";
  }
  function createSessionListNameInput(options) {
    const input = document.createElement("input");
    input.className = "sessions__name-input";
    input.type = "text";
    input.value = options.nameEditValue;
    input.placeholder = getSessionDisplayName(options.session);
    input.setAttribute("aria-label", "Session name");
    input.addEventListener("input", () => options.onNameInputInput(input.value));
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("blur", options.onNameInputBlur);
    return input;
  }
  function createSessionItemMenuElement(options) {
    const wrap = document.createElement("span");
    wrap.className = "sessions__menu-wrap";
    const indicators = createSessionIndicatorsElement(options.session);
    if (indicators) {
      wrap.append(indicators);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sessions__menu-button";
    button.setAttribute("aria-label", "Session commands");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", options.openMenuIndex === options.index ? "true" : "false");
    button.disabled = !canOpenSessionItemMenu(options.session);
    button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg><span class="tauren-icon-action-tooltip">Session commands</span>';
    wrap.append(button);
    if (options.openMenuIndex !== options.index) {
      return wrap;
    }
    const menu = document.createElement("span");
    menu.className = "sessions__menu";
    menu.setAttribute("role", "menu");
    if (options.menuPosition) {
      menu.classList.add("sessions__menu--context");
      menu.style.left = options.menuPosition.x + "px";
      menu.style.top = options.menuPosition.y + "px";
    }
    for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
      const command = sessionItemMenuCommands[commandIndex];
      menu.append(createSessionItemMenuButton(command, commandIndex, options));
    }
    wrap.append(menu);
    return wrap;
  }
  function createSessionIndicatorsElement(session) {
    const indicatorKinds = getSessionIndicatorKinds(session);
    if (indicatorKinds.length === 0) {
      return void 0;
    }
    const indicators = document.createElement("span");
    indicators.className = "sessions__indicators";
    indicators.title = indicatorKinds.map(getSessionIndicatorLabel).join(" \xB7 ");
    indicators.setAttribute("aria-label", indicators.title);
    for (const kind of indicatorKinds) {
      const indicator = document.createElement("span");
      indicator.className = "sessions__indicator sessions__indicator--" + kind;
      indicators.append(indicator);
    }
    return indicators;
  }
  function getSessionIndicatorLabel(kind) {
    if (kind === "running") {
      return "Running";
    }
    if (kind === "done") {
      return "Ready";
    }
    return "Error";
  }
  function createSessionItemMenuButton(command, commandIndex, options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tauren-toolbar__menu-item sessions__menu-item";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-session-command", command);
    button.setAttribute("data-session-command-index", String(commandIndex));
    button.disabled = !options.canRunSessionItemCommand(options.session, command);
    button.innerHTML = '<span class="tauren-toolbar__menu-label">' + getSessionItemCommandLabel(command) + "</span>" + getSessionItemCommandIcon(command);
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
    if (normalizedQuery && filter.matchedSessionPaths) {
      return getMatchedSessionIndexes(sessions, filter.matchedSessionPaths, filter.namedOnly);
    }
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
  function getMatchedSessionIndexes(sessions, matchedSessionPaths, namedOnly) {
    const sessionIndexes = /* @__PURE__ */ new Map();
    for (let index = 0; index < sessions.length; index += 1) {
      sessionIndexes.set(sessions[index].path, index);
    }
    const indexes = [];
    const seen = /* @__PURE__ */ new Set();
    for (const path of matchedSessionPaths) {
      const index = sessionIndexes.get(path);
      if (index === void 0 || seen.has(index)) {
        continue;
      }
      if (namedOnly && !sessions[index].name?.trim()) {
        continue;
      }
      seen.add(index);
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

  // src/webview/sessions/sessionTreeController.ts
  var treeFilterModes = ["default", "no-tools", "user-only", "labeled-only", "all"];
  var SessionTreeController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    selectedIndex = 0;
    pendingSummaryEntryId;
    pendingLabelEntryId;
    labelEditValue = "";
    summaryChoiceIndex = 0;
    customSummaryMode = false;
    customInstructions = "";
    pendingTreeScrollIndex;
    pendingTreeScrollFrame;
    searchQuery = "";
    filterMode = "default";
    showLabelTimestamps = false;
    foldedEntryIds = /* @__PURE__ */ new Set();
    render() {
      const state2 = this.options.getState();
      this.options.treeElement.replaceChildren();
      const visibleItems = this.getVisibleItems();
      this.selectedIndex = this.clampIndex(this.selectedIndex);
      const header = document.createElement("div");
      header.className = "sessions__header";
      const count = visibleItems.length;
      header.textContent = state2.treeRefreshing ? "Loading session tree..." : "Session tree" + this.getStatusLabel();
      this.options.treeElement.append(header);
      if (this.searchQuery) {
        const search = document.createElement("div");
        search.className = "sessions__header";
        search.textContent = `Search: ${this.searchQuery}`;
        this.options.treeElement.append(search);
      }
      if (state2.treeError) {
        const error = document.createElement("div");
        error.className = "sessions__error";
        error.textContent = state2.treeError;
        this.options.treeElement.append(error);
      }
      if (state2.treeRefreshing && count === 0) {
        this.options.treeElement.append(createSessionEmptyElement("Loading session tree..."));
        return;
      }
      if (count === 0) {
        this.options.treeElement.append(createSessionEmptyElement("No persisted tree entries found for this session."));
        return;
      }
      for (let index = 0; index < visibleItems.length; index += 1) {
        const item = visibleItems[index];
        if (item.entryId === this.pendingLabelEntryId) {
          this.options.treeElement.append(this.createLabelDialog());
        }
        if (item.entryId === this.pendingSummaryEntryId) {
          this.options.treeElement.append(this.createSummaryDialog());
        }
        this.options.treeElement.append(createTreeItemElement(
          this.showLabelTimestamps ? item : { ...item, labelTimestamp: void 0 },
          index,
          {
            selectedIndex: this.selectedIndex,
            disabled: state2.busy || state2.treeRefreshing || item.selectable === false
          }
        ));
      }
      const footer = document.createElement("div");
      footer.className = "sessions__header sessions__tree-footer";
      footer.textContent = `(${this.selectedIndex + 1}/${count})`;
      this.options.treeElement.append(footer);
      requestAnimationFrame(() => this.scrollSelectedIntoView());
    }
    selectCurrent() {
      const items = this.getVisibleItems();
      const currentIndex = items.findIndex((item) => item.current);
      if (currentIndex >= 0) {
        this.selectedIndex = currentIndex;
        return;
      }
      const activePathIndex = findLastIndex(items, (item) => Boolean(item.activePath));
      this.selectedIndex = activePathIndex >= 0 ? activePathIndex : 0;
    }
    moveSelection(delta) {
      const items = this.getVisibleItems();
      if (items.length === 0) {
        return;
      }
      this.setSelectionIndex(this.wrapIndex(this.selectedIndex + delta, items.length));
    }
    moveToFirst() {
      return this.setSelectionIndex(0);
    }
    moveToLast() {
      const count = this.getVisibleItems().length;
      if (count === 0) {
        return false;
      }
      return this.setSelectionIndex(count - 1);
    }
    moveToParent() {
      const items = this.getVisibleItems();
      const parentIndex = findParentTreeItemIndex(items, this.selectedIndex);
      return parentIndex === void 0 ? false : this.setSelectionIndex(parentIndex);
    }
    moveToDeepestLastChild() {
      const items = this.getVisibleItems();
      const childIndex = findDeepestLastChildTreeItemIndex(items, this.selectedIndex);
      return childIndex === void 0 ? false : this.setSelectionIndex(childIndex);
    }
    selectCurrentIndex() {
      this.selectIndex(this.selectedIndex);
    }
    selectIndex(index) {
      const state2 = this.options.getState();
      const treeItem = this.getVisibleItems()[index];
      if (!treeItem?.entryId || treeItem.selectable === false || state2.busy || state2.treeRefreshing) {
        return;
      }
      this.selectedIndex = this.clampIndex(index);
      this.openSummaryDialog(treeItem.entryId);
    }
    handleClick(target, event) {
      const action = target?.closest("[data-tree-summary-action]");
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        this.runSummaryAction(action.getAttribute("data-tree-summary-action"));
        return true;
      }
      const labelAction = target?.closest("[data-tree-label-action]");
      if (labelAction) {
        event.preventDefault();
        event.stopPropagation();
        this.runLabelAction(labelAction.getAttribute("data-tree-label-action"));
        return true;
      }
      const cancel = target?.closest(".sessions__tree-summary-cancel");
      if (cancel) {
        event.preventDefault();
        event.stopPropagation();
        this.closeDialogs();
        this.render();
        this.options.treeElement.focus({ preventScroll: true });
        return true;
      }
      return false;
    }
    handleKeydown(event) {
      const target = eventTargetElement(event);
      const labelInput = target?.closest(".sessions__tree-label-input");
      if (this.pendingLabelEntryId) {
        if (labelInput instanceof HTMLInputElement) {
          this.labelEditValue = labelInput.value;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.closeLabelDialog();
          this.render();
          this.options.treeElement.focus({ preventScroll: true });
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          this.savePendingLabel();
          return true;
        }
        return labelInput instanceof HTMLInputElement;
      }
      if (!this.pendingSummaryEntryId) {
        if (event.key === "L") {
          event.preventDefault();
          event.stopPropagation();
          this.openLabelDialogForSelected();
          return true;
        }
        const handled = this.handleNavigationKey(event);
        if (handled) {
          return true;
        }
        if (event.key === "Backspace" && this.searchQuery) {
          event.preventDefault();
          event.stopPropagation();
          this.searchQuery = this.searchQuery.slice(0, -1);
          this.selectedIndex = this.clampIndex(this.selectedIndex);
          this.render();
          return true;
        }
        if (event.key === "T") {
          event.preventDefault();
          event.stopPropagation();
          this.showLabelTimestamps = !this.showLabelTimestamps;
          this.render();
          return true;
        }
        if (event.ctrlKey && event.key.toLowerCase() === "o") {
          event.preventDefault();
          event.stopPropagation();
          this.cycleFilterMode(event.shiftKey ? -1 : 1);
          return true;
        }
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          this.searchQuery += event.key;
          this.foldedEntryIds.clear();
          this.selectedIndex = this.clampIndex(this.selectedIndex);
          this.render();
          return true;
        }
        return false;
      }
      const customInput = target?.closest(".sessions__tree-summary-input");
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSummaryDialog();
        this.render();
        this.options.treeElement.focus({ preventScroll: true });
        return true;
      }
      if (customInput instanceof HTMLTextAreaElement) {
        this.customInstructions = customInput.value;
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          this.navigatePending("custom");
          return true;
        }
        return false;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.summaryChoiceIndex = this.wrapIndex(this.summaryChoiceIndex + 1, 3);
        this.customSummaryMode = false;
        this.renderAndFocusSummaryChoice();
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.summaryChoiceIndex = this.wrapIndex(this.summaryChoiceIndex - 1, 3);
        this.customSummaryMode = false;
        this.renderAndFocusSummaryChoice();
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.runSummaryAction(this.getSummaryChoice(this.summaryChoiceIndex));
        return true;
      }
      return false;
    }
    createSummaryDialog() {
      const dialog = document.createElement("div");
      dialog.className = "sessions__tree-summary";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Summarize branch?");
      const title = document.createElement("div");
      title.className = "sessions__tree-summary-title";
      title.textContent = "Summarize branch?";
      dialog.append(title);
      if (this.customSummaryMode) {
        const input = document.createElement("textarea");
        input.className = "sessions__tree-summary-input";
        input.value = this.customInstructions;
        input.rows = 3;
        input.placeholder = "Custom summary prompt";
        input.addEventListener("input", () => {
          this.customInstructions = input.value;
        });
        dialog.append(input);
        const actions = document.createElement("div");
        actions.className = "sessions__tree-summary-actions";
        actions.append(
          this.createSummaryButton("custom", "Summarize", true),
          this.createCancelLink()
        );
        dialog.append(actions);
        requestAnimationFrame(() => {
          dialog.scrollIntoView({ block: "nearest" });
          input.focus({ preventScroll: true });
        });
        return dialog;
      }
      const choices = document.createElement("div");
      choices.className = "sessions__tree-summary-choices";
      const options = [
        { action: "none", label: "No summary" },
        { action: "summarize", label: "Summarize" },
        { action: "custom", label: "Summarize with custom prompt" }
      ];
      options.forEach((option, index) => {
        choices.append(this.createSummaryButton(option.action, option.label, index === this.summaryChoiceIndex));
      });
      dialog.append(choices, this.createCancelLink());
      requestAnimationFrame(() => {
        dialog.scrollIntoView({ block: "nearest" });
        dialog.querySelector(".sessions__tree-summary-choice--active")?.focus({ preventScroll: true });
      });
      return dialog;
    }
    createLabelDialog() {
      const dialog = document.createElement("div");
      dialog.className = "sessions__tree-summary sessions__tree-label-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Edit label");
      const title = document.createElement("div");
      title.className = "sessions__tree-summary-title";
      title.textContent = "Edit label";
      const input = document.createElement("input");
      input.className = "sessions__tree-summary-input sessions__tree-label-input";
      input.type = "text";
      input.value = this.labelEditValue;
      input.placeholder = "Label";
      input.addEventListener("input", () => {
        this.labelEditValue = input.value;
      });
      const actions = document.createElement("div");
      actions.className = "sessions__tree-summary-actions";
      actions.append(
        this.createLabelButton("save", "Save"),
        this.createCancelLink()
      );
      dialog.append(title, input, actions);
      requestAnimationFrame(() => {
        dialog.scrollIntoView({ block: "nearest" });
        input.focus({ preventScroll: true });
        input.select();
      });
      return dialog;
    }
    createLabelButton(action, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sessions__tree-summary-choice sessions__tree-summary-choice--active";
      button.setAttribute("data-tree-label-action", action);
      button.textContent = label;
      return button;
    }
    createSummaryButton(action, label, active) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sessions__tree-summary-choice" + (active ? " sessions__tree-summary-choice--active" : "");
      button.setAttribute("data-tree-summary-action", action);
      button.textContent = (active ? "\u2192 " : "  ") + label;
      return button;
    }
    createCancelLink() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sessions__tree-summary-cancel";
      button.textContent = "Cancel";
      return button;
    }
    openSummaryDialog(entryId) {
      this.closeLabelDialog();
      this.pendingSummaryEntryId = entryId;
      this.summaryChoiceIndex = 0;
      this.customSummaryMode = false;
      this.customInstructions = "";
      this.render();
    }
    openLabelDialogForSelected() {
      const state2 = this.options.getState();
      const treeItem = this.getVisibleItems()[this.selectedIndex];
      if (!treeItem?.entryId || treeItem.selectable === false || state2.busy || state2.treeRefreshing) {
        return;
      }
      this.closeSummaryDialog();
      this.pendingLabelEntryId = treeItem.entryId;
      this.labelEditValue = treeItem.label ?? "";
      this.render();
    }
    closeSummaryDialog() {
      this.pendingSummaryEntryId = void 0;
      this.summaryChoiceIndex = 0;
      this.customSummaryMode = false;
      this.customInstructions = "";
    }
    closeLabelDialog() {
      this.pendingLabelEntryId = void 0;
      this.labelEditValue = "";
    }
    closeDialogs() {
      this.closeSummaryDialog();
      this.closeLabelDialog();
    }
    hasOpenDialog() {
      return Boolean(this.pendingSummaryEntryId || this.pendingLabelEntryId);
    }
    runSummaryAction(action) {
      if (action === "custom") {
        if (!this.customSummaryMode) {
          this.customSummaryMode = true;
          this.summaryChoiceIndex = 2;
          this.render();
          return;
        }
        this.navigatePending("custom");
        return;
      }
      if (action === "summarize") {
        this.navigatePending("summarize");
        return;
      }
      if (action === "none") {
        this.navigatePending("none");
      }
    }
    navigatePending(choice) {
      const entryId = this.pendingSummaryEntryId;
      if (!entryId) {
        return;
      }
      const customInstructions = this.customInstructions.trim();
      this.closeSummaryDialog();
      this.options.postMessage({
        type: "selectTreeEntry",
        entryId,
        summarize: choice !== "none",
        ...choice === "custom" && customInstructions ? { customInstructions } : {}
      });
    }
    runLabelAction(action) {
      if (action === "save") {
        this.savePendingLabel();
      }
    }
    savePendingLabel() {
      const entryId = this.pendingLabelEntryId;
      if (!entryId) {
        return;
      }
      const label = this.labelEditValue.trim();
      this.closeLabelDialog();
      this.options.postMessage({ type: "setTreeEntryLabel", entryId, label });
      this.render();
      this.options.treeElement.focus({ preventScroll: true });
    }
    getSummaryChoice(index) {
      return index === 1 ? "summarize" : index === 2 ? "custom" : "none";
    }
    renderAndFocusSummaryChoice() {
      this.render();
      requestAnimationFrame(() => {
        this.options.treeElement.querySelector(".sessions__tree-summary-choice--active")?.focus({ preventScroll: true });
      });
    }
    setSelectionIndex(index) {
      if (this.getVisibleItems().length === 0) {
        return false;
      }
      const previousIndex = this.selectedIndex;
      const hadDialog = this.hasOpenDialog();
      const nextIndex = this.clampIndex(index);
      if (nextIndex === previousIndex && !hadDialog) {
        return false;
      }
      this.closeDialogs();
      this.selectedIndex = nextIndex;
      if (hadDialog) {
        this.render();
        return true;
      }
      this.updateRenderedSelection(previousIndex);
      this.scheduleSelectedIntoView(nextIndex);
      return true;
    }
    handleNavigationKey(event) {
      const handled = event.key === "Home" ? this.moveToFirst() : event.key === "End" ? this.moveToLast() : event.key === "ArrowLeft" ? event.ctrlKey || event.altKey ? this.foldSelectedOrMoveToParent() : this.moveToParent() : event.key === "ArrowRight" ? event.ctrlKey || event.altKey ? this.unfoldSelectedOrMoveToDeepestLastChild() : this.moveToDeepestLastChild() : event.key === "1" ? this.setFilterMode("default") : event.key === "2" ? this.setFilterMode(this.filterMode === "no-tools" ? "default" : "no-tools") : event.key === "3" ? this.setFilterMode(this.filterMode === "user-only" ? "default" : "user-only") : event.key === "4" ? this.setFilterMode(this.filterMode === "labeled-only" ? "default" : "labeled-only") : event.key === "5" ? this.setFilterMode(this.filterMode === "all" ? "default" : "all") : false;
      if (!handled) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    getVisibleItems() {
      const state2 = this.options.getState();
      const items = Array.isArray(state2.treeItems) ? state2.treeItems : [];
      const searchTokens = this.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      const visible = items.filter((item) => this.passesFilter(item) && this.passesSearch(item, searchTokens));
      if (this.foldedEntryIds.size === 0) {
        return visible;
      }
      const hidden = /* @__PURE__ */ new Set();
      for (const item of items) {
        if (item.parentId && (this.foldedEntryIds.has(item.parentId) || hidden.has(item.parentId))) {
          hidden.add(item.entryId);
        }
      }
      return visible.filter((item) => !hidden.has(item.entryId));
    }
    passesFilter(item) {
      switch (this.filterMode) {
        case "no-tools":
          return item.role !== "tool";
        case "user-only":
          return item.role === "user";
        case "labeled-only":
          return Boolean(item.label);
        case "all":
          return true;
        default:
          return !["label", "custom", "model_change", "thinking_level_change", "session_info"].includes(item.role);
      }
    }
    passesSearch(item, tokens) {
      if (tokens.length === 0) {
        return true;
      }
      const text = [item.role, item.text, item.label].filter(Boolean).join(" ").toLowerCase();
      return tokens.every((token) => text.includes(token));
    }
    getStatusLabel() {
      const labels = [];
      if (this.filterMode !== "default") {
        labels.push(this.filterMode);
      }
      if (this.showLabelTimestamps) {
        labels.push("+label time");
      }
      return labels.length > 0 ? " [" + labels.join(", ") + "]" : "";
    }
    setFilterMode(mode) {
      this.filterMode = mode;
      this.foldedEntryIds.clear();
      this.selectedIndex = this.clampIndex(this.selectedIndex);
      this.render();
      return true;
    }
    cycleFilterMode(delta) {
      const currentIndex = treeFilterModes.indexOf(this.filterMode);
      const nextIndex = this.wrapIndex(currentIndex + delta, treeFilterModes.length);
      this.setFilterMode(treeFilterModes[nextIndex]);
    }
    foldSelectedOrMoveToParent() {
      const item = this.getVisibleItems()[this.selectedIndex];
      if (item && this.hasVisibleChildren(item.entryId) && !this.foldedEntryIds.has(item.entryId)) {
        this.foldedEntryIds.add(item.entryId);
        this.selectedIndex = this.clampIndex(this.selectedIndex);
        this.render();
        return true;
      }
      return this.moveToParent();
    }
    unfoldSelectedOrMoveToDeepestLastChild() {
      const item = this.getVisibleItems()[this.selectedIndex];
      if (item && this.foldedEntryIds.has(item.entryId)) {
        this.foldedEntryIds.delete(item.entryId);
        this.render();
        return true;
      }
      return this.moveToDeepestLastChild();
    }
    hasVisibleChildren(entryId) {
      return this.getVisibleItems().some((item) => item.parentId === entryId);
    }
    updateRenderedSelection(previousIndex) {
      this.updateRenderedTreeItemSelection(previousIndex, false);
      this.updateRenderedTreeItemSelection(this.selectedIndex, true);
      this.updateRenderedFooter();
    }
    updateRenderedTreeItemSelection(index, selected) {
      const item = document.getElementById("tree-" + index);
      if (!item) {
        return;
      }
      item.classList.toggle("sessions__item--active", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
      const cursor = item.querySelector(".sessions__tree-cursor");
      if (cursor) {
        cursor.textContent = selected ? "\u203A" : "";
      }
    }
    updateRenderedFooter() {
      const count = this.getVisibleItems().length;
      const footer = this.options.treeElement.querySelector(".sessions__tree-footer");
      if (footer) {
        footer.textContent = `(${this.selectedIndex + 1}/${count})`;
      }
    }
    scheduleSelectedIntoView(index) {
      this.pendingTreeScrollIndex = index;
      if (this.pendingTreeScrollFrame !== void 0) {
        return;
      }
      this.pendingTreeScrollFrame = requestAnimationFrame(() => {
        const scrollIndex = this.pendingTreeScrollIndex;
        this.pendingTreeScrollIndex = void 0;
        this.pendingTreeScrollFrame = void 0;
        if (scrollIndex === void 0) {
          return;
        }
        this.scrollIndexIntoView(scrollIndex);
      });
    }
    scrollSelectedIntoView() {
      this.scrollIndexIntoView(this.selectedIndex);
    }
    scrollIndexIntoView(index) {
      const item = document.getElementById("tree-" + index);
      if (!item) {
        return;
      }
      const footer = this.options.treeElement.querySelector(".sessions__tree-footer");
      const containerRect = this.options.treeElement.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const footerTop = footer?.getBoundingClientRect().top ?? containerRect.bottom;
      const bottomOverlap = itemRect.bottom - footerTop;
      if (bottomOverlap > 0) {
        this.options.treeElement.scrollTop += bottomOverlap + 6;
        return;
      }
      const topOverlap = containerRect.top - itemRect.top;
      if (topOverlap > 0) {
        this.options.treeElement.scrollTop -= topOverlap + 6;
      }
    }
    clampIndex(index) {
      const count = this.getVisibleItems().length;
      if (count === 0) {
        return 0;
      }
      return Math.max(0, Math.min(index, count - 1));
    }
    wrapIndex(index, count) {
      if (count <= 0) {
        return 0;
      }
      return (index % count + count) % count;
    }
  };
  function findParentTreeItemIndex(items, selectedIndex) {
    const selected = items[selectedIndex];
    if (!selected) {
      return void 0;
    }
    const selectedDepth = selected.depth ?? 0;
    if (selectedDepth <= 0) {
      return void 0;
    }
    for (let index = selectedIndex - 1; index >= 0; index -= 1) {
      if ((items[index]?.depth ?? 0) < selectedDepth) {
        return index;
      }
    }
    return void 0;
  }
  function findDeepestLastChildTreeItemIndex(items, selectedIndex) {
    const selected = items[selectedIndex];
    if (!selected) {
      return void 0;
    }
    const selectedDepth = selected.depth ?? 0;
    let childIndex;
    for (let index = selectedIndex + 1; index < items.length; index += 1) {
      const depth = items[index]?.depth ?? 0;
      if (depth <= selectedDepth) {
        break;
      }
      childIndex = index;
    }
    return childIndex;
  }
  function findLastIndex(items, predicate) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index])) {
        return index;
      }
    }
    return -1;
  }

  // src/webview/sessions/sessionVirtualization.ts
  function getVirtualSessionRange(options) {
    const itemCount = Math.max(0, Math.floor(options.itemCount));
    if (itemCount <= Math.max(0, options.threshold)) {
      return {
        enabled: false,
        start: 0,
        end: itemCount,
        topPadding: 0,
        bottomPadding: 0
      };
    }
    const itemHeight = Math.max(1, options.itemHeight);
    const overscan = Math.max(0, Math.floor(options.overscan));
    const viewportHeight = Math.max(itemHeight, options.viewportHeight);
    const relativeScrollTop = Math.max(0, options.scrollTop - Math.max(0, options.listTopOffset));
    const visibleStart = Math.floor(relativeScrollTop / itemHeight);
    const visibleEnd = Math.ceil((relativeScrollTop + viewportHeight) / itemHeight);
    const start = Math.max(0, visibleStart - overscan);
    const end = Math.min(itemCount, Math.max(start + 1, visibleEnd + overscan));
    return {
      enabled: true,
      start,
      end,
      topPadding: start * itemHeight,
      bottomPadding: Math.max(0, itemCount - end) * itemHeight
    };
  }

  // src/webview/sessions/sessionContextMenu.ts
  function shouldOpenSessionListContextMenu(event, options) {
    return !options.nameEditing && event.button === 2;
  }

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
      this.options.sessionToggleButton.addEventListener("click", () => this.toggleSessionLane("sessions"));
      this.options.treeToggleButton.addEventListener("click", () => this.toggleSessionLane("tree"));
      this.options.toolbarTitleElement.addEventListener("dblclick", (event) => this.startSessionNameEdit(event));
      this.options.sessionNameInputElement.addEventListener("blur", () => this.cancelSessionNameEdit());
    }
    handleGlobalKeydown(event) {
      if ((event.target === this.options.sessionToggleButton || event.target === this.options.treeToggleButton) && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleSessionLane(event.target === this.options.sessionToggleButton ? "sessions" : "tree");
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
    syncForRender(isSessionLane) {
      const state2 = this.options.getState();
      const isSettingsView = state2.chatFace === "settings" && state2.lane === "chat";
      const isChatMainHidden = isSessionLane || isSettingsView;
      const toolbarTitle = isSettingsView ? "Settings" : state2.lane === "sessions" ? "Sessions" : state2.lane === "tree" ? "Session tree" : this.options.getCurrentSessionTitle();
      const toolbarTimestamp = isChatMainHidden ? "" : formatRelativeTime(this.options.getCurrentSessionTimestamp());
      const toolbarTitleTooltip = [toolbarTitle, toolbarTimestamp].filter(Boolean).join(" \xB7 ");
      if (isChatMainHidden && this.sessionNameEditing) {
        this.cancelSessionNameEdit();
      }
      this.options.toolbarTitleTextElement.textContent = toolbarTitle;
      this.options.toolbarTimestampElement.textContent = toolbarTimestamp;
      this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !toolbarTimestamp;
      this.options.toolbarTitleElement.title = toolbarTitleTooltip;
      this.options.toolbarTitleElement.classList.toggle("tauren-toolbar__title--editing", this.sessionNameEditing);
      this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
      this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
      const sessionToggleLabel = isSessionLane ? "Back to chat" : "Show sessions";
      this.options.sessionToggleButton.setAttribute("aria-label", sessionToggleLabel);
      setTooltipText2(this.options.sessionToggleButton, sessionToggleLabel);
      this.options.sessionToggleButton.classList.toggle("tauren-toolbar__sessions--back", isSessionLane);
      const treeToggleLabel = isSessionLane ? "Back to chat" : "Show tree";
      this.options.treeToggleButton.setAttribute("aria-label", treeToggleLabel);
      setTooltipText2(this.options.treeToggleButton, treeToggleLabel);
      this.options.treeToggleButton.classList.toggle("tauren-toolbar__tree--back", isSessionLane);
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
    }
    handleWindowClick(_target) {
    }
    hasSessionCommandMenuOpen() {
      return false;
    }
    startSessionNameEdit(event) {
      const state2 = this.options.getState();
      event?.preventDefault();
      event?.stopPropagation();
      if (state2.lane === "sessions" || state2.lane === "tree") {
        return;
      }
      this.options.closeSlashMenu();
      this.options.closeModelMenu();
      this.sessionNameEditing = true;
      this.sessionNameEditInitialValue = this.options.getCurrentSessionName();
      this.options.sessionNameInputElement.value = this.sessionNameEditInitialValue;
      this.options.sessionNameInputElement.placeholder = this.sessionNameEditInitialValue ? "" : this.options.getCurrentSessionTitle();
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
      const previousName = this.sessionNameEditInitialValue.trim();
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
      this.syncSessionNameEditor();
    }
    syncSessionNameEditor() {
      this.options.toolbarTitleElement.classList.toggle("tauren-toolbar__title--editing", this.sessionNameEditing);
      this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
      this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !this.options.toolbarTimestampElement.textContent;
      this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
    }
    toggleSessionLane(targetLane) {
      const state2 = this.options.getState();
      this.cancelSessionNameEdit();
      if (state2.lane === "sessions" || state2.lane === "tree") {
        this.options.postMessage({ type: "showLane", lane: "chat" });
        this.options.focusPromptInput();
        return;
      }
      this.options.postMessage({ type: "showLane", lane: targetLane });
    }
  };
  function setTooltipText2(element, text) {
    const tooltip = element.querySelector(".tauren-icon-action-tooltip");
    if (tooltip) {
      tooltip.textContent = text;
    }
  }

  // src/webview/sessions/sessionView.ts
  var sessionItemMenuCloseDelayMs = 250;
  var sessionListVirtualizationThreshold = 500;
  var sessionListVirtualOverscan = 8;
  var defaultSessionListItemHeight = 54;
  var defaultSessionListTopOffset = 72;
  var sessionSearchDebounceMs = 150;
  var SessionViewController = class {
    constructor(options) {
      this.options = options;
      this.treeController = new SessionTreeController({
        getState: options.getState,
        postMessage: options.postMessage,
        treeElement: options.sessionTreeElement
      });
      this.topControls = new TopSessionControls({
        getState: options.getState,
        postMessage: options.postMessage,
        toolbarTitleElement: options.toolbarTitleElement,
        toolbarTitleTextElement: options.toolbarTitleTextElement,
        toolbarTimestampElement: options.toolbarTimestampElement,
        sessionNameInputElement: options.sessionNameInputElement,
        sessionToggleButton: options.sessionToggleButton,
        treeToggleButton: options.treeToggleButton,
        focusPromptInput: options.focusPromptInput,
        closeSlashMenu: options.closeSlashMenu,
        closeModelMenu: options.closeModelMenu,
        getCurrentSessionTitle: () => this.getCurrentSessionTitle(),
        getCurrentSessionName: () => this.getCurrentSessionName(),
        getCurrentSessionTimestamp: () => this.getCurrentSessionTimestamp()
      });
    }
    options;
    sessionListSelectedIndex = 0;
    sessionSearchQuery = "";
    sessionNamedOnlyFilter = false;
    sessionSearchRequestId = 0;
    pendingSessionSearchRequest;
    sessionPointerHoverEnabled = false;
    openSessionListMenuIndex;
    openSessionListMenuCommandIndex = 0;
    openSessionListMenuPosition;
    pendingSessionItemMenuClose;
    sessionListNameEditPath;
    sessionListNameEditInitialValue = "";
    sessionListNameEditValue = "";
    sessionListNameEditShouldSelect = false;
    suppressSessionListNameInputBlur = false;
    sessionListScrollTop;
    pendingSessionListScrollRestore = false;
    pendingSessionScrollIndex;
    pendingSessionScrollFrame;
    pendingSessionVirtualRenderFrame;
    sessionListVirtualItemHeight = defaultSessionListItemHeight;
    topControls;
    treeController;
    attachEventListeners() {
      this.topControls.attachEventListeners();
      this.options.sessionsElement.addEventListener("keydown", (event) => this.handleSessionListKeydown(event));
      this.options.sessionsElement.addEventListener("pointermove", (event) => this.handleSessionListPointerMove(event));
      this.options.sessionsElement.addEventListener("pointerleave", () => this.scheduleSessionItemMenuClose());
      this.options.sessionsElement.addEventListener("scroll", () => this.handleSessionListScroll());
      this.options.sessionsElement.addEventListener("contextmenu", (event) => this.handleSessionListContextMenu(event));
      this.options.sessionsElement.addEventListener("click", (event) => this.handleSessionsClick(event));
      this.options.sessionTreeElement.addEventListener("keydown", (event) => this.handleSessionListKeydown(event));
      this.options.sessionTreeElement.addEventListener("click", (event) => this.handleSessionsClick(event));
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
      if (state2.lane === "tree" && this.treeController.handleKeydown(event)) {
        return true;
      }
      if (state2.lane === "tree" && event.key === "Escape") {
        this.hideSessionList(event);
        return true;
      }
      const target = eventTargetElement(event);
      const sessionSearchInput = target?.closest(".sessions__search-input");
      if (sessionSearchInput instanceof HTMLInputElement && state2.lane === "sessions") {
        return this.handleSessionSearchKeydown(event, sessionSearchInput);
      }
      const namedOnlyFilterButton = target?.closest(".sessions__named-filter");
      if (namedOnlyFilterButton instanceof HTMLButtonElement && state2.lane === "sessions") {
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
        if (isTextInputShortcut(event)) {
          return false;
        }
        event.stopPropagation();
        return true;
      }
      return (state2.lane === "sessions" || state2.lane === "tree") && this.handleSessionListKeydown(event);
    }
    startCurrentSessionNameEdit() {
      this.topControls.startSessionNameEdit();
    }
    syncForRender(isSessionLane) {
      const state2 = this.options.getState();
      if (state2.lane !== "sessions") {
        this.openSessionListMenuIndex = void 0;
        this.openSessionListMenuCommandIndex = 0;
        this.openSessionListMenuPosition = void 0;
        this.clearPendingSessionItemMenuClose();
        this.stopSessionListNameEdit();
      }
      this.topControls.syncForRender(isSessionLane);
    }
    renderSessions() {
      const state2 = this.options.getState();
      const searchInput = this.isSessionSearchFocused() ? document.activeElement : void 0;
      const nameInput = this.isSessionListNameInputFocused() ? document.activeElement : void 0;
      const selectedIndex = searchInput ? -1 : this.sessionListSelectedIndex;
      const searchSelectionStart = searchInput?.selectionStart ?? null;
      const searchSelectionEnd = searchInput?.selectionEnd ?? null;
      const nameSelectionStart = nameInput?.selectionStart ?? null;
      const nameSelectionEnd = nameInput?.selectionEnd ?? null;
      if (nameInput) {
        this.sessionListNameEditValue = nameInput.value;
      }
      const count = Array.isArray(state2.sessions) ? state2.sessions.length : 0;
      const visibleIndexes = this.getVisibleSessionIndexes();
      const filtersActive = this.hasActiveSessionListFilters();
      this.sessionListSelectedIndex = ensureVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes);
      const preservedScrollTop = this.options.sessionsElement.scrollTop;
      const renderWindow = this.getSessionRenderWindow(visibleIndexes);
      this.suppressSessionListNameInputBlur = Boolean(this.sessionListNameEditPath);
      this.options.sessionsElement.replaceChildren();
      this.suppressSessionListNameInputBlur = false;
      const search = this.createSessionSearchElement();
      this.options.sessionsElement.append(search);
      const header = document.createElement("div");
      header.className = "sessions__header";
      if (this.openSessionListMenuIndex !== void 0 && !visibleIndexes.includes(this.openSessionListMenuIndex)) {
        this.openSessionListMenuIndex = void 0;
        this.openSessionListMenuPosition = void 0;
        this.clearPendingSessionItemMenuClose();
      } else if (this.openSessionListMenuIndex !== void 0 && renderWindow.virtualized && !renderWindow.indexes.includes(this.openSessionListMenuIndex)) {
        this.openSessionListMenuIndex = void 0;
        this.openSessionListMenuPosition = void 0;
        this.clearPendingSessionItemMenuClose();
      }
      const headerText = state2.sessionsRefreshing ? "Loading sessions..." : filtersActive && visibleIndexes.length !== count ? visibleIndexes.length + " of " + count + " sessions" : count === 1 ? "1 session" : count + " sessions";
      const searchStatusText = this.getSessionSearchStatusText();
      header.textContent = searchStatusText ? `${headerText} \xB7 ${searchStatusText}` : headerText;
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
        this.appendSessionVirtualSpacer(renderWindow.topPadding, "top");
        for (const index of renderWindow.indexes) {
          this.options.sessionsElement.append(createSessionItemElement({
            session: state2.sessions[index],
            index,
            selectedIndex,
            nameEditPath: this.sessionListNameEditPath,
            nameEditValue: this.sessionListNameEditValue,
            openMenuIndex: this.openSessionListMenuIndex,
            menuPosition: this.openSessionListMenuIndex === index ? this.openSessionListMenuPosition : void 0,
            canRunSessionItemCommand: (session, command) => this.canRunSessionItemCommand(session, command),
            onNameInputInput: (value) => this.updateSessionListNameEditValue(value),
            onNameInputBlur: () => this.handleSessionListNameInputBlur(),
            onCommandActivate: (commandIndex, button) => {
              this.openSessionListMenuCommandIndex = commandIndex;
              this.setSessionMenuItemHover(button, true);
            },
            onCommandHover: (button, hovered) => this.setSessionMenuItemHover(button, hovered)
          }));
        }
        this.appendSessionVirtualSpacer(renderWindow.bottomPadding, "bottom");
        this.updateSessionVirtualItemHeight();
        if (renderWindow.virtualized) {
          this.options.sessionsElement.scrollTop = preservedScrollTop;
        }
      }
      if (this.sessionListNameEditPath) {
        const select = this.sessionListNameEditShouldSelect;
        this.sessionListNameEditShouldSelect = false;
        requestAnimationFrame(() => this.focusSessionListNameInput({ select, selectionStart: nameSelectionStart, selectionEnd: nameSelectionEnd }));
      } else if (searchInput) {
        this.focusSessionSearchInput({ select: false, selectionStart: searchSelectionStart, selectionEnd: searchSelectionEnd });
      }
      if (this.pendingSessionListScrollRestore) {
        this.pendingSessionListScrollRestore = false;
        this.restoreSessionListScrollPositionOrRevealSelection();
      }
      if (this.openSessionListMenuPosition) {
        requestAnimationFrame(() => this.clampOpenSessionItemContextMenu());
      }
    }
    getSessionRenderWindow(visibleIndexes) {
      const range = getVirtualSessionRange({
        itemCount: visibleIndexes.length,
        scrollTop: this.options.sessionsElement.scrollTop,
        viewportHeight: this.options.sessionsElement.clientHeight || 600,
        listTopOffset: this.getSessionVirtualListTopOffset(),
        itemHeight: this.sessionListVirtualItemHeight,
        overscan: sessionListVirtualOverscan,
        threshold: sessionListVirtualizationThreshold
      });
      return {
        indexes: visibleIndexes.slice(range.start, range.end),
        topPadding: range.topPadding,
        bottomPadding: range.bottomPadding,
        virtualized: range.enabled
      };
    }
    appendSessionVirtualSpacer(height, position) {
      if (height <= 0) {
        return;
      }
      const spacer = document.createElement("div");
      spacer.className = "sessions__virtual-spacer sessions__virtual-spacer--" + position;
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.height = Math.round(height) + "px";
      this.options.sessionsElement.append(spacer);
    }
    updateSessionVirtualItemHeight() {
      const item = this.options.sessionsElement.querySelector(".sessions__item");
      if (!item || item.offsetHeight <= 0) {
        return;
      }
      this.sessionListVirtualItemHeight = item.offsetHeight;
    }
    getSessionVirtualListTopOffset() {
      const topSpacer = this.options.sessionsElement.querySelector(".sessions__virtual-spacer--top");
      if (topSpacer) {
        return topSpacer.offsetTop;
      }
      const firstItem = this.options.sessionsElement.querySelector(".sessions__item");
      if (firstItem) {
        return firstItem.offsetTop;
      }
      return defaultSessionListTopOffset;
    }
    renderTree() {
      this.treeController.render();
    }
    selectCurrentTreeEntry() {
      this.treeController.selectCurrent();
    }
    selectCurrentSessionOrFirstVisible() {
      const visibleIndexes = this.getVisibleSessionIndexes();
      const currentIndex = this.getCurrentSessionIndex();
      this.sessionListSelectedIndex = currentIndex !== void 0 && visibleIndexes.includes(currentIndex) ? currentIndex : visibleIndexes[0] ?? 0;
    }
    rememberSessionListScrollPosition() {
      this.sessionListScrollTop = this.options.sessionsElement.scrollTop;
    }
    restoreSessionListScrollAfterNextRender() {
      this.pendingSessionListScrollRestore = true;
    }
    disableSessionPointerHover() {
      this.sessionPointerHoverEnabled = false;
      this.options.sessionsElement.classList.remove("sessions--pointer-hover");
    }
    stopSessionListNameEdit() {
      this.sessionListNameEditPath = void 0;
      this.sessionListNameEditInitialValue = "";
      this.sessionListNameEditValue = "";
      this.sessionListNameEditShouldSelect = false;
    }
    isSessionListNameEditing() {
      return Boolean(this.sessionListNameEditPath);
    }
    getVisibleSessionCount() {
      return this.getVisibleSessionIndexes().length;
    }
    isSessionSearchFocused() {
      return document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains("sessions__search-input");
    }
    isSessionListNameInputFocused() {
      return document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains("sessions__name-input");
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
      this.clearPendingSessionItemMenuClose();
      if (this.openSessionListMenuIndex === void 0) {
        return;
      }
      this.openSessionListMenuIndex = void 0;
      this.openSessionListMenuCommandIndex = 0;
      this.openSessionListMenuPosition = void 0;
      for (const menu of this.options.sessionsElement.querySelectorAll(".sessions__menu")) {
        menu.hidden = true;
      }
      for (const button of this.options.sessionsElement.querySelectorAll(".sessions__menu-button")) {
        button.setAttribute("aria-expanded", "false");
      }
    }
    handleSessionsClick(event) {
      const state2 = this.options.getState();
      const target = eventTargetElement(event);
      if (state2.lane === "tree" && this.treeController.handleClick(target, event)) {
        return;
      }
      const sessionMenuButton = target?.closest(".sessions__menu-button");
      if (sessionMenuButton) {
        event.preventDefault();
        event.stopPropagation();
        const item2 = sessionMenuButton.closest(".sessions__item");
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
      state2.lane === "tree" ? this.treeController.selectIndex(index) : this.selectSessionIndex(index);
    }
    handleSessionListContextMenu(event) {
      const state2 = this.options.getState();
      if (state2.lane !== "sessions") {
        return;
      }
      const target = eventTargetElement(event);
      if (target?.closest(".sessions__name-input")) {
        return;
      }
      const item = target?.closest(".sessions__item");
      if (!(item instanceof HTMLElement) || !this.options.sessionsElement.contains(item)) {
        return;
      }
      const index = Number(item.getAttribute("data-index"));
      if (!Number.isInteger(index) || !this.isSessionIndexVisible(index)) {
        return;
      }
      if (!shouldOpenSessionListContextMenu(event, { nameEditing: this.sessionListNameEditPath !== void 0 })) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.disableSessionPointerHover();
      this.openSessionItemMenu(index, { focusMenu: true, position: { x: event.clientX, y: event.clientY } });
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
      const currentIndex = this.getCurrentSessionIndex();
      return currentIndex === void 0 ? void 0 : state2.sessions[currentIndex];
    }
    getCurrentSessionIndex() {
      const state2 = this.options.getState();
      if (!Array.isArray(state2.sessions) || state2.sessions.length === 0) {
        return void 0;
      }
      const index = state2.currentSessionFile ? state2.sessions.findIndex((session) => session.path === state2.currentSessionFile) : -1;
      const fallbackIndex = index >= 0 ? index : state2.sessions.findIndex((session) => session.current);
      return fallbackIndex >= 0 ? fallbackIndex : void 0;
    }
    handleSessionListKeydown(event) {
      const state2 = this.options.getState();
      const target = eventTargetElement(event);
      if (target?.closest(".sessions__search-input, .sessions__name-input")) {
        return false;
      }
      if (state2.lane !== "sessions" && state2.lane !== "tree") {
        return false;
      }
      if (state2.lane === "tree" && this.treeController.handleKeydown(event)) {
        return true;
      }
      if (this.openSessionListMenuIndex !== void 0 && this.handleSessionItemMenuKeydown(event)) {
        return true;
      }
      if (state2.lane === "sessions" && event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        this.closeSessionItemMenus();
        this.options.openHelpOverlay();
        return true;
      }
      if (event.key === "Escape") {
        this.hideSessionList(event);
        return true;
      }
      if (state2.lane === "sessions" && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        event.stopPropagation();
        this.disableSessionPointerHover();
        this.closeSessionItemMenus();
        this.moveSessionSelectionToEdge(event.key === "End");
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.disableSessionPointerHover();
        this.closeSessionItemMenus();
        state2.lane === "tree" ? this.treeController.moveSelection(1) : this.moveSessionSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.disableSessionPointerHover();
        this.closeSessionItemMenus();
        state2.lane === "tree" ? this.treeController.moveSelection(-1) : this.moveSessionSelectionUpOrFocusSearch();
        return true;
      }
      if (state2.lane === "sessions" && this.handleSessionListCommandKey(event)) {
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        state2.lane === "tree" ? this.treeController.selectCurrentIndex() : this.selectSessionIndex(this.sessionListSelectedIndex);
        return true;
      }
      if (state2.lane === "sessions" && (event.key === "Delete" || event.key === "Backspace")) {
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
      this.options.postMessage({ type: "showLane", lane: "chat" });
      this.options.focusPromptInput();
    }
    enableSessionPointerHover() {
      if (this.sessionPointerHoverEnabled) {
        return;
      }
      this.sessionPointerHoverEnabled = true;
      this.options.sessionsElement.classList.add("sessions--pointer-hover");
    }
    handleSessionListScroll() {
      this.sessionListScrollTop = this.options.sessionsElement.scrollTop;
      const state2 = this.options.getState();
      if (state2.lane !== "sessions" || !Array.isArray(state2.sessions) || state2.sessions.length <= sessionListVirtualizationThreshold) {
        return;
      }
      this.scheduleSessionVirtualRender();
    }
    scheduleSessionVirtualRender() {
      if (this.pendingSessionVirtualRenderFrame !== void 0) {
        return;
      }
      this.pendingSessionVirtualRenderFrame = requestAnimationFrame(() => {
        this.pendingSessionVirtualRenderFrame = void 0;
        if (this.options.getState().lane === "sessions") {
          this.renderSessions();
        }
      });
    }
    handleSessionListPointerMove(event) {
      this.enableSessionPointerHover();
      const state2 = this.options.getState();
      if (state2.lane !== "sessions") {
        return;
      }
      const item = eventTargetElement(event)?.closest(".sessions__item");
      if (!(item instanceof HTMLElement) || !this.options.sessionsElement.contains(item)) {
        this.scheduleSessionItemMenuClose();
        return;
      }
      const index = Number(item.getAttribute("data-index"));
      if (!Number.isInteger(index) || !this.isSessionIndexVisible(index)) {
        this.scheduleSessionItemMenuClose();
        return;
      }
      if (this.openSessionListMenuIndex !== void 0) {
        if (this.openSessionListMenuIndex !== index) {
          this.scheduleSessionItemMenuClose();
          return;
        }
        this.clearPendingSessionItemMenuClose();
      }
      const previousIndex = this.sessionListSelectedIndex;
      if (index === previousIndex) {
        return;
      }
      this.sessionListSelectedIndex = index;
      this.updateRenderedSessionSelection(previousIndex);
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
    moveSessionSelectionToEdge(last) {
      const visibleIndexes = this.getVisibleSessionIndexes();
      const nextIndex = last ? visibleIndexes[visibleIndexes.length - 1] : visibleIndexes[0];
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
        const item = document.getElementById("session-" + scrollIndex);
        if (item) {
          item.scrollIntoView({ block: "nearest" });
        } else {
          this.scrollVirtualSessionIndexIntoView(scrollIndex);
        }
      });
    }
    cancelPendingSessionSelectionScroll() {
      if (this.pendingSessionScrollFrame !== void 0) {
        cancelAnimationFrame(this.pendingSessionScrollFrame);
      }
      this.pendingSessionScrollIndex = void 0;
      this.pendingSessionScrollFrame = void 0;
    }
    restoreSessionListScrollPositionOrRevealSelection() {
      const scrollTop = this.sessionListScrollTop;
      requestAnimationFrame(() => {
        if (scrollTop !== void 0) {
          this.options.sessionsElement.scrollTop = scrollTop;
        }
        this.revealSelectedSessionIfNeeded();
      });
    }
    revealSelectedSessionIfNeeded() {
      const item = document.getElementById("session-" + this.sessionListSelectedIndex);
      if (!item) {
        this.scrollVirtualSessionIndexIntoView(this.sessionListSelectedIndex);
        return;
      }
      const containerRect = this.options.sessionsElement.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
    scrollVirtualSessionIndexIntoView(index) {
      const state2 = this.options.getState();
      if (state2.lane !== "sessions" || !Array.isArray(state2.sessions) || state2.sessions.length <= sessionListVirtualizationThreshold) {
        return;
      }
      const visibleIndexes = this.getVisibleSessionIndexes();
      const position = visibleIndexes.indexOf(index);
      if (position < 0) {
        return;
      }
      const itemTop = this.getSessionVirtualListTopOffset() + position * this.sessionListVirtualItemHeight;
      const itemBottom = itemTop + this.sessionListVirtualItemHeight;
      const container = this.options.sessionsElement;
      if (itemTop < container.scrollTop) {
        container.scrollTop = itemTop;
      } else if (itemBottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = itemBottom - container.clientHeight;
      }
      this.scheduleSessionVirtualRender();
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
      this.clearPendingSessionItemMenuClose();
      if (!Number.isInteger(index) || index < 0 || state2.lane !== "sessions" || !this.isSessionIndexVisible(index)) {
        return;
      }
      const session = Array.isArray(state2.sessions) ? state2.sessions[index] : void 0;
      if (!session || !canOpenSessionItemMenu(session)) {
        return;
      }
      this.sessionListSelectedIndex = this.clampSessionIndex(index);
      this.openSessionListMenuIndex = this.sessionListSelectedIndex;
      this.openSessionListMenuCommandIndex = this.getFirstEnabledSessionItemMenuCommandIndex(session);
      this.openSessionListMenuPosition = options.position;
      this.renderSessions();
      document.getElementById("session-" + this.sessionListSelectedIndex)?.scrollIntoView({ block: "nearest" });
      if (options.focusMenu) {
        requestAnimationFrame(() => this.focusSessionItemMenuCommand(this.openSessionListMenuIndex, this.openSessionListMenuCommandIndex));
      }
    }
    scheduleSessionItemMenuClose() {
      if (this.openSessionListMenuIndex === void 0 || this.pendingSessionItemMenuClose !== void 0) {
        return;
      }
      this.pendingSessionItemMenuClose = setTimeout(() => {
        this.pendingSessionItemMenuClose = void 0;
        this.closeSessionItemMenus();
      }, sessionItemMenuCloseDelayMs);
    }
    clearPendingSessionItemMenuClose() {
      if (this.pendingSessionItemMenuClose === void 0) {
        return;
      }
      clearTimeout(this.pendingSessionItemMenuClose);
      this.pendingSessionItemMenuClose = void 0;
    }
    clampOpenSessionItemContextMenu() {
      const menu = this.options.sessionsElement.querySelector(".sessions__menu--context:not([hidden])");
      if (!menu || !this.openSessionListMenuPosition) {
        return;
      }
      const margin = 8;
      const rect = menu.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      const left = Math.max(margin, Math.min(this.openSessionListMenuPosition.x, maxLeft));
      const top = Math.max(margin, Math.min(this.openSessionListMenuPosition.y, maxTop));
      menu.style.left = left + "px";
      menu.style.top = top + "px";
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
        const focusedCommand = eventTargetElement(event)?.closest(".sessions__menu-item")?.getAttribute("data-session-command");
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
      this.sessionListNameEditInitialValue = getSessionNameEditValue(session);
      this.sessionListNameEditValue = this.sessionListNameEditInitialValue;
      this.sessionListNameEditShouldSelect = true;
      this.closeSessionItemMenus();
      this.renderSessions();
    }
    updateSessionListNameEditValue(value) {
      this.sessionListNameEditValue = value;
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
    handleSessionListNameInputBlur() {
      if (this.suppressSessionListNameInputBlur) {
        return;
      }
      this.cancelSessionListNameEdit();
    }
    focusSessionListNameInput(options = {}) {
      const input = this.options.sessionsElement.querySelector(".sessions__name-input");
      input?.focus({ preventScroll: true });
      if (!input) {
        return;
      }
      if (options.select) {
        input.select();
        return;
      }
      if (options.selectionStart !== null && options.selectionStart !== void 0) {
        input.setSelectionRange(options.selectionStart, options.selectionEnd ?? options.selectionStart);
      }
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
      namedOnlyButton.innerHTML = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.75 2.5H8.6C8.95 2.5 9.29 2.64 9.54 2.89L13.1 6.45C13.62 6.97 13.62 7.81 13.1 8.33L8.33 13.1C7.81 13.62 6.97 13.62 6.45 13.1L2.89 9.54C2.64 9.29 2.5 8.95 2.5 8.6V3.75C2.5 3.06 3.06 2.5 3.75 2.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="5.65" cy="5.65" r="1" fill="currentColor"/><path d="M7.35 8.3H10.7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg><span class="tauren-icon-action-tooltip">Filter to named sessions</span>';
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
      this.scheduleSessionSearchRequest();
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
    scheduleSessionSearchRequest() {
      if (this.pendingSessionSearchRequest) {
        clearTimeout(this.pendingSessionSearchRequest);
        this.pendingSessionSearchRequest = void 0;
      }
      const requestId = this.sessionSearchRequestId + 1;
      this.sessionSearchRequestId = requestId;
      const query = this.sessionSearchQuery.trim();
      const namedOnly = this.sessionNamedOnlyFilter;
      if (!query) {
        this.options.postMessage({ type: "searchSessions", requestId, query: "", namedOnly });
        return;
      }
      this.pendingSessionSearchRequest = setTimeout(() => {
        this.pendingSessionSearchRequest = void 0;
        this.options.postMessage({ type: "searchSessions", requestId, query, namedOnly });
      }, sessionSearchDebounceMs);
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
      this.scheduleSessionSearchRequest();
      this.closeSessionItemMenus();
      this.renderSessions();
    }
    getCurrentHostSessionSearch() {
      const state2 = this.options.getState();
      const query = this.sessionSearchQuery.trim();
      const search = state2.sessionSearch;
      if (!query || !search || search.requestId !== this.sessionSearchRequestId) {
        return void 0;
      }
      return search.query === query && search.namedOnly === this.sessionNamedOnlyFilter ? search : void 0;
    }
    getSessionSearchStatusText() {
      const query = this.sessionSearchQuery.trim();
      const state2 = this.options.getState();
      const currentSearch = this.getCurrentHostSessionSearch();
      const search = currentSearch ?? state2.sessionSearch;
      if (query && this.pendingSessionSearchRequest) {
        return "Searching sessions\u2026";
      }
      if (!search || search.totalCount === 0) {
        return "";
      }
      if (query && !currentSearch) {
        return "Searching titles while full-content search catches up\u2026";
      }
      if (search.status === "error") {
        return search.error || "Session search index failed.";
      }
      if (search.status === "indexing") {
        const count = Math.min(search.indexedCount, search.totalCount);
        return query ? `Full-content search indexing ${count}/${search.totalCount} sessions\u2026` : `Indexing session search ${count}/${search.totalCount}\u2026`;
      }
      if (query && search.status === "ready") {
        return "Full-content search ready.";
      }
      return "";
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
      if (command === "rename") {
        return true;
      }
      return session.liveStatus !== "running" && !(session.current && state2.busy);
    }
    canDeleteSession(session) {
      const state2 = this.options.getState();
      return session.liveStatus !== "running" && !(session.current && state2.busy);
    }
    getVisibleSessionIndexes() {
      const state2 = this.options.getState();
      const hostSearch = this.getCurrentHostSessionSearch();
      return getVisibleSessionIndexes(Array.isArray(state2.sessions) ? state2.sessions : [], this.sessionSearchQuery, {
        namedOnly: this.sessionNamedOnlyFilter,
        matchedSessionPaths: hostSearch?.matchedSessionPaths
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
      item.classList.toggle("tauren-toolbar__menu-item--hover", hovered);
    }
    getCurrentSessionName() {
      const state2 = this.options.getState();
      return (this.getCurrentSession()?.name ?? state2.currentSessionName ?? "").trim();
    }
    getCurrentSessionTimestamp() {
      return this.getCurrentSession()?.modified ?? "";
    }
  };
  function isTextInputShortcut(event) {
    if (event.altKey || !event.ctrlKey && !event.metaKey) {
      return false;
    }
    const key = event.key.toLowerCase();
    return key === "a" || key === "c" || key === "v" || key === "x" || key === "z" || key === "y";
  }

  // src/webview/settings/settingsPane.ts
  var SettingsPaneController = class {
    constructor(options) {
      this.options = options;
    }
    options;
    renderedSignature = "";
    wasVisible = false;
    scopedModelsProviderFilter;
    attachEventListeners() {
      this.options.settingsBackButton.addEventListener("click", () => this.hideSettings({ focusPrompt: true }));
      this.options.settingsElement.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const authButton = target?.closest("[data-auth-action]");
        if (authButton) {
          this.handleAuthAction(authButton);
          return;
        }
        const voiceButton2 = target?.closest("[data-voice-action]") ?? null;
        if (voiceButton2) {
          this.handleVoiceAction(voiceButton2);
          return;
        }
        const scopedModelsButton = target?.closest("[data-scoped-model-action]") ?? null;
        if (scopedModelsButton) {
          this.handleScopedModelsAction(scopedModelsButton);
          return;
        }
        const button = target?.closest("[data-settings-section]") ?? null;
        if (!button) {
          return;
        }
        const section = parseWebviewSettingsSection(button.dataset.settingsSection);
        if (section) {
          this.selectSection(section);
        }
      });
      this.options.settingsElement.addEventListener("change", (event) => this.handleSettingChange(event));
      this.options.settingsElement.addEventListener("keydown", (event) => this.handleSettingsKeydown(event));
    }
    handleGlobalKeydown(event) {
      if (this.options.getState().chatFace !== "settings") {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.hideSettings({ focusPrompt: true });
        return true;
      }
      return false;
    }
    syncForRender(isSessionLane) {
      const state2 = this.options.getState();
      const visible = !isSessionLane && state2.chatFace === "settings";
      this.options.settingsElement.hidden = false;
      this.options.settingsElement.inert = !visible;
      this.options.settingsElement.setAttribute("aria-hidden", visible ? "false" : "true");
      this.options.settingsElement.tabIndex = visible ? 0 : -1;
      this.renderSection(state2.settingsSection);
      if (visible && !this.wasVisible) {
        requestAnimationFrame(() => {
          if (this.options.getState().chatFace === "settings") {
            this.focusActiveSectionButton();
          }
        });
      }
      this.wasVisible = visible;
    }
    hideSettings(options = {}) {
      this.options.postMessage({ type: "hideChatFace" });
      if (options.focusPrompt) {
        this.options.focusPromptInput();
      }
    }
    selectSection(section) {
      this.options.postMessage({ type: "setSettingsSection", section });
    }
    handleAuthAction(button) {
      const action = button.dataset.authAction;
      if (action === "refresh") {
        this.options.postMessage({ type: "authRefresh" });
        return;
      }
      if (action === "cancel") {
        this.options.postMessage({ type: "authCancel" });
        return;
      }
      if (action === "loginSelected") {
        const authType = button.dataset.authType;
        const select = authType ? this.options.settingsBodyElement.querySelector(`[data-auth-select="${authType}"]`) : void 0;
        const providerId2 = select?.value;
        if (providerId2 && (authType === "oauth" || authType === "api_key")) {
          this.options.postMessage({ type: "authLogin", providerId: providerId2, authType });
        }
        return;
      }
      const providerId = button.dataset.authProviderId;
      if (!providerId) {
        return;
      }
      if (action === "login") {
        const authType = button.dataset.authType;
        this.options.postMessage({
          type: "authLogin",
          providerId,
          ...authType === "oauth" || authType === "api_key" ? { authType } : {}
        });
      } else if (action === "logout") {
        this.options.postMessage({ type: "authLogout", providerId });
      }
    }
    handleSettingsKeydown(event) {
      if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-settings-section]")) {
        return;
      }
      const currentIndex = settingsSections.findIndex((section2) => section2.id === this.options.getState().settingsSection);
      let nextIndex = currentIndex;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % settingsSections.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + settingsSections.length) % settingsSections.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = settingsSections.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const section = settingsSections[nextIndex];
      this.selectSection(section.id);
      requestAnimationFrame(() => this.focusSectionButton(section.id));
    }
    handleSettingChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.scopedModelId) {
        this.handleScopedModelsToggle(target);
        return;
      }
      const settingId = target.dataset.settingId;
      const definition = settingDefinitions.find((item) => item.id === settingId);
      if (!definition || definition.readOnly) {
        return;
      }
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
      this.options.postMessage({ type: "updateSetting", settingId: definition.id, value });
    }
    handleVoiceAction(button) {
      const action = button.dataset.voiceAction;
      const modelId = button.dataset.voiceModelId;
      if (action === "downloadBinary") {
        this.options.postMessage({ type: "voiceDownloadBinary" });
      } else if (action === "refreshInputDevices") {
        this.options.postMessage({ type: "voiceRefreshInputDevices" });
      } else if (action === "downloadModel") {
        this.options.postMessage({ type: "voiceDownloadModel", ...modelId ? { modelId } : {} });
      } else if (action === "deleteModel" && modelId) {
        this.options.postMessage({ type: "voiceDeleteModel", modelId });
      }
    }
    handleScopedModelsToggle(input) {
      const modelId = input.dataset.scopedModelId;
      if (!modelId) {
        return;
      }
      const state2 = this.options.getState();
      const selection = getScopedModelSelection(state2);
      const nextIds = input.checked ? [...selection.enabledIds, modelId] : selection.enabledIds.filter((id) => id !== modelId);
      this.postScopedModelsUpdate(normalizeScopedModelSelection(nextIds, state2.modelOptions));
    }
    handleScopedModelsAction(button) {
      const state2 = this.options.getState();
      const selection = getScopedModelSelection(state2);
      const action = button.dataset.scopedModelAction;
      if (action === "showAll") {
        this.scopedModelsProviderFilter = void 0;
        this.rerenderSettingsSection();
        return;
      }
      if (action === "provider") {
        const provider = button.dataset.scopedProvider;
        if (!provider) {
          return;
        }
        this.scopedModelsProviderFilter = provider;
        this.rerenderSettingsSection();
        return;
      }
      if (action === "selectVisible" || action === "unselectVisible") {
        const visibleIds = getVisibleScopedModels(selection, this.scopedModelsProviderFilter).map(getModelFullId);
        const selectedIds = selection.enabledIds;
        const visibleSet = new Set(visibleIds);
        const nextIds = action === "selectVisible" ? [...selectedIds, ...visibleIds.filter((id) => !selectedIds.includes(id))] : selectedIds.filter((id) => !visibleSet.has(id));
        this.postScopedModelsUpdate(normalizeScopedModelSelection(nextIds, state2.modelOptions));
        return;
      }
      if (action === "moveUp" || action === "moveDown") {
        if (selection.allEnabled) {
          return;
        }
        const modelId = button.dataset.scopedModelId;
        const index = modelId ? selection.enabledIds.indexOf(modelId) : -1;
        const delta = action === "moveUp" ? -1 : 1;
        const nextIndex = index + delta;
        if (index < 0 || nextIndex < 0 || nextIndex >= selection.enabledIds.length) {
          return;
        }
        const nextIds = selection.enabledIds.slice();
        [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
        this.postScopedModelsUpdate(nextIds);
      }
    }
    postScopedModelsUpdate(enabledModelIds) {
      this.options.postMessage({ type: "updateSetting", settingId: "enabledModels", value: enabledModelIds });
    }
    rerenderSettingsSection() {
      this.renderedSignature = "";
      this.renderSection(this.options.getState().settingsSection);
    }
    renderSection(sectionId) {
      const state2 = this.options.getState();
      const signature = createSettingsSignature(sectionId, state2, this.scopedModelsProviderFilter);
      if (this.renderedSignature === signature) {
        this.syncNavState(sectionId);
        return;
      }
      const section = settingsSections.find((item) => item.id === sectionId) ?? settingsSections[0];
      const nav = document.createElement("nav");
      nav.className = "settings-surface__nav";
      nav.setAttribute("aria-label", "Settings sections");
      nav.setAttribute("role", "tablist");
      nav.setAttribute("aria-orientation", "vertical");
      for (const item of settingsSections) {
        const button = document.createElement("button");
        button.className = "settings-surface__nav-item";
        button.type = "button";
        button.dataset.settingsSection = item.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", "settings-panel");
        button.textContent = item.label;
        nav.append(button);
      }
      const panel = document.createElement("section");
      panel.id = "settings-panel";
      panel.className = "settings-surface__panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-label", section.title);
      const intro = document.createElement("div");
      intro.className = "settings-surface__intro";
      intro.append(createTextElement("div", "settings-surface__section-eyebrow", section.eyebrow));
      intro.append(createTextElement("h3", "settings-surface__section-title", section.title));
      intro.append(createTextElement("p", "settings-surface__section-description", section.description));
      panel.append(intro);
      const cards = document.createElement("div");
      cards.className = "settings-surface__cards";
      if (section.id === "login") {
        this.appendAuthCards(cards, state2);
      } else if (section.id === "voice") {
        this.appendVoiceCards(cards, state2);
      } else {
        for (const definition of getVisibleSettingsForSection(section.id, state2)) {
          cards.append(this.createSettingCard(definition, state2));
        }
        if (cards.childElementCount === 0 && state2.settings.values["tauren.backend"] === "kward") {
          cards.append(createKwardUnsupportedSettingsEmptyState());
        }
      }
      panel.append(cards);
      this.options.settingsBodyElement.replaceChildren(nav, panel);
      this.renderedSignature = signature;
      this.syncNavState(sectionId);
      if (state2.chatFace === "settings") {
        requestAnimationFrame(() => this.focusSectionButton(sectionId));
      }
    }
    appendVoiceCards(cards, state2) {
      const voice = state2.voice;
      if (!voice) {
        const card = document.createElement("article");
        card.className = "settings-surface__card";
        card.append(createTextElement("h4", "settings-surface__card-title", "Voice assets"));
        card.append(createTextElement("p", "settings-surface__card-body", "Voice state is not available yet."));
        cards.append(card);
        return;
      }
      for (const definition of getVisibleSettingsForSection("voice", state2)) {
        if (definition.id !== "tauren.voice.inputDevice") {
          cards.append(this.createSettingCard(definition, state2));
        }
      }
      if (voice.languageForced) {
        const card = document.createElement("article");
        card.className = "settings-surface__card";
        card.append(createTextElement("h4", "settings-surface__card-title", "Language forced to English"));
        card.append(createTextElement("p", "settings-surface__card-helper", "The selected English-only Whisper model always uses English. Choose a multilingual model for auto-detect or non-English input."));
        cards.append(card);
      }
      cards.append(this.createVoiceInputDeviceCard(voice));
      cards.append(this.createVoiceBinaryCard(voice));
      cards.append(this.createVoiceModelCard(voice));
    }
    createVoiceInputDeviceCard(voice) {
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      card.append(createTextElement("h4", "settings-surface__card-title", "Input device"));
      card.append(createTextElement("p", "settings-surface__card-body", "Choose which microphone or audio source Tauren records from."));
      const select = document.createElement("select");
      select.className = "settings-surface__select";
      select.dataset.settingId = "tauren.voice.inputDevice";
      select.disabled = voice.recordingStatus === "recording" || voice.recordingStatus === "transcribing";
      for (const device of voice.inputDevices.devices) {
        const option = document.createElement("option");
        option.value = device.id;
        option.textContent = device.label;
        option.selected = device.id === voice.inputDevices.selectedId;
        select.append(option);
      }
      card.append(select);
      const toolbar = document.createElement("div");
      toolbar.className = "settings-surface__auth-toolbar";
      const refreshButton = this.createVoiceButton(voice.inputDevices.status === "refreshing" ? "Refreshing\u2026" : "Refresh devices", "refreshInputDevices");
      refreshButton.disabled = voice.inputDevices.status === "refreshing";
      toolbar.append(refreshButton);
      card.append(toolbar);
      const statusLabel = voice.inputDevices.status === "ready" ? `${Math.max(voice.inputDevices.devices.length - 1, 0)} input device${voice.inputDevices.devices.length === 2 ? "" : "s"} detected.` : voice.inputDevices.status === "refreshing" ? "Looking for input devices\u2026" : "Click Refresh devices to detect available microphones.";
      card.append(createTextElement("p", "settings-surface__card-helper", statusLabel));
      if (voice.inputDevices.error) {
        card.append(createTextElement("p", "settings-surface__card-error", voice.inputDevices.error));
      }
      return card;
    }
    createVoiceBinaryCard(voice) {
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      card.append(createTextElement("h4", "settings-surface__card-title", "whisper.cpp runtime"));
      card.append(createTextElement("p", "settings-surface__card-body", voice.binary.source === "system" && voice.binary.path ? `${voice.binary.label}: ${voice.binary.path}` : voice.binary.label));
      card.append(createTextElement("p", "settings-surface__card-helper", voice.binary.helper ?? getVoiceDownloadLabel(voice.binary.download)));
      const button = this.createVoiceButton(voice.binary.status === "failed" ? "Retry runtime download" : "Download runtime", "downloadBinary");
      button.disabled = voice.binary.status === "downloaded" || voice.binary.status === "downloading" || voice.binary.status === "unavailable";
      card.append(button);
      if (voice.binary.download.error) {
        card.append(createTextElement("p", "settings-surface__card-error", voice.binary.download.error));
      }
      return card;
    }
    createVoiceModelCard(voice) {
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      card.append(createTextElement("h4", "settings-surface__card-title", "Downloaded models"));
      for (const model of voice.models) {
        const row = document.createElement("div");
        row.className = "settings-surface__auth-toolbar";
        row.append(createTextElement("span", "settings-surface__card-body", `${model.label} \xB7 ${formatVoiceBytes(model.sizeBytes)} \xB7 ${getVoiceDownloadLabel(model.download)}`));
        const downloadButton = this.createVoiceButton(model.download.status === "failed" ? "Retry" : "Download", "downloadModel", model.id);
        downloadButton.disabled = model.downloaded || model.download.status === "downloading";
        row.append(downloadButton);
        const deleteButton = this.createVoiceButton("Delete", "deleteModel", model.id);
        deleteButton.disabled = !model.downloaded || model.id === voice.selectedModelId;
        row.append(deleteButton);
        card.append(row);
        if (model.download.error) {
          card.append(createTextElement("p", "settings-surface__card-error", model.download.error));
        }
      }
      if (voice.error) {
        card.append(createTextElement("p", "settings-surface__card-error", voice.error));
      }
      return card;
    }
    createVoiceButton(label, action, modelId) {
      const button = document.createElement("button");
      button.className = "settings-surface__button";
      button.type = "button";
      button.textContent = label;
      button.dataset.voiceAction = action;
      if (modelId) {
        button.dataset.voiceModelId = modelId;
      }
      return button;
    }
    appendAuthCards(cards, state2) {
      const toolbar = document.createElement("div");
      toolbar.className = "settings-surface__auth-toolbar";
      const refreshButton = this.createAuthButton("Refresh", "refresh", void 0, Boolean(state2.auth.refreshing || state2.auth.busyProviderId));
      toolbar.append(refreshButton);
      if (state2.auth.busyProviderId) {
        toolbar.append(this.createAuthButton("Cancel", "cancel", void 0, false));
      }
      cards.append(toolbar);
      if (state2.auth.progress) {
        cards.append(this.createAuthProgressCard(state2));
      }
      if (state2.auth.error) {
        const errorCard = document.createElement("article");
        errorCard.className = "settings-surface__card settings-surface__card--danger";
        errorCard.append(createTextElement("h4", "settings-surface__card-title", "Login error"));
        errorCard.append(createTextElement("p", "settings-surface__card-error", state2.auth.error));
        cards.append(errorCard);
      }
      const providers = state2.auth.providers;
      if (providers.length === 0) {
        const emptyCard = document.createElement("article");
        emptyCard.className = "settings-surface__card";
        emptyCard.append(createTextElement("h4", "settings-surface__card-title", state2.auth.refreshing ? "Loading providers\u2026" : "No providers loaded"));
        emptyCard.append(createTextElement("p", "settings-surface__card-body", "Refresh to load Pi runtime authentication providers."));
        cards.append(emptyCard);
        return;
      }
      cards.append(this.createAuthLoginCard("oauth", providers.filter((provider) => provider.authType === "oauth"), state2));
      cards.append(this.createAuthLoginCard("api_key", providers.filter((provider) => provider.authType === "api_key"), state2));
      const activeProviders = providers.filter((provider) => provider.canLogout);
      const separator = document.createElement("div");
      separator.className = "settings-surface__auth-separator";
      separator.setAttribute("role", "separator");
      cards.append(separator);
      const activeGroup = document.createElement("div");
      activeGroup.className = "settings-surface__auth-group";
      activeGroup.append(createTextElement("div", "settings-surface__section-eyebrow", "Active providers"));
      if (activeProviders.length === 0) {
        const emptyActiveCard = document.createElement("article");
        emptyActiveCard.className = "settings-surface__card";
        emptyActiveCard.append(createTextElement("h4", "settings-surface__card-title", "No active stored logins"));
        emptyActiveCard.append(createTextElement("p", "settings-surface__card-body", "Environment variables and models.json credentials may still be active outside Tauren logout."));
        activeGroup.append(emptyActiveCard);
      } else {
        for (const provider of activeProviders) {
          activeGroup.append(this.createActiveAuthProviderCard(provider, state2));
        }
      }
      cards.append(activeGroup);
    }
    createAuthLoginCard(authType, providers, state2) {
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      const title = authType === "oauth" ? "OAuth login" : "API key login";
      card.append(createTextElement("h4", "settings-surface__card-title", title));
      card.append(createTextElement(
        "p",
        "settings-surface__card-body",
        authType === "oauth" ? "Choose a subscription provider and complete OAuth in your browser." : "Choose a provider and store an API key in Pi auth.json."
      ));
      const select = document.createElement("select");
      select.className = "settings-surface__select";
      select.dataset.authSelect = authType;
      select.disabled = providers.length === 0 || Boolean(state2.auth.busyProviderId || state2.busy);
      if (providers.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = authType === "oauth" ? "No OAuth providers available" : "No API key providers available";
        select.append(option);
      } else {
        for (const provider of providers) {
          const option = document.createElement("option");
          option.value = provider.id;
          option.textContent = provider.configured ? `${provider.name} (${getAuthStatusLabel(provider)})` : provider.name;
          select.append(option);
        }
      }
      const actionRow = document.createElement("div");
      actionRow.className = "settings-surface__auth-actions";
      const loginButton = this.createAuthButton("Login / Replace", "loginSelected", void 0, providers.length === 0 || Boolean(state2.auth.busyProviderId || state2.busy));
      loginButton.dataset.authType = authType;
      actionRow.append(loginButton);
      const control = document.createElement("div");
      control.className = "settings-surface__control";
      control.append(select, actionRow);
      card.append(control);
      return card;
    }
    createAuthProgressCard(state2) {
      const progress = state2.auth.progress;
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      card.append(createTextElement("h4", "settings-surface__card-title", "Authentication in progress"));
      if (!progress) {
        return card;
      }
      card.append(createTextElement("p", "settings-surface__card-body", progress.message));
      if (progress.userCode) {
        const code = document.createElement("code");
        code.className = "settings-surface__auth-code";
        code.textContent = progress.userCode;
        card.append(code);
      }
      if (progress.url || progress.verificationUri) {
        card.append(createTextElement("p", "settings-surface__card-helper", progress.url ?? progress.verificationUri ?? ""));
      }
      return card;
    }
    createActiveAuthProviderCard(provider, state2) {
      const card = document.createElement("article");
      card.className = "settings-surface__card";
      const titleRow = document.createElement("div");
      titleRow.className = "settings-surface__card-title-row";
      titleRow.append(createTextElement("h4", "settings-surface__card-title", provider.name));
      titleRow.append(createTextElement("span", "settings-surface__card-status settings-surface__card-status--pi", getAuthStatusLabel(provider)));
      const actionRow = document.createElement("div");
      actionRow.className = "settings-surface__auth-actions";
      actionRow.append(this.createAuthButton("Logout", "logout", provider.id, Boolean(state2.auth.busyProviderId || state2.busy)));
      card.append(
        titleRow,
        createTextElement("p", "settings-surface__card-body", provider.authType === "oauth" ? "Stored OAuth subscription credentials." : "Stored API key credentials."),
        actionRow
      );
      if (provider.label || provider.source) {
        card.append(createTextElement("p", "settings-surface__card-helper", provider.label ?? `Configured via ${provider.source}`));
      }
      return card;
    }
    createAuthButton(label, action, providerId, disabled) {
      const button = document.createElement("button");
      button.className = "settings-surface__button";
      button.type = "button";
      button.textContent = label;
      button.dataset.authAction = action;
      button.disabled = disabled;
      if (providerId) {
        button.dataset.authProviderId = providerId;
      }
      return button;
    }
    createSettingCard(definition, state2) {
      const value = getSettingValue(definition, state2);
      const cardElement = document.createElement("article");
      cardElement.className = "settings-surface__card";
      cardElement.classList.toggle("settings-surface__card--danger", Boolean(definition.danger));
      cardElement.classList.toggle("settings-surface__card--subtle", Boolean(definition.subtle));
      const titleRow = document.createElement("div");
      titleRow.className = "settings-surface__card-title-row";
      titleRow.append(createTextElement("h4", "settings-surface__card-title", definition.label));
      titleRow.append(createTextElement("span", `settings-surface__card-status settings-surface__card-status--${definition.owner}`, definition.owner === "tauren" ? "Tauren" : "Pi"));
      const control = this.createControl(definition, value, state2);
      const body = createTextElement("p", "settings-surface__card-body", definition.description);
      const helperText = getHelperText(definition);
      const helper = helperText ? createTextElement("p", "settings-surface__card-helper", helperText) : void 0;
      const error = state2.settings.errors?.[definition.id] ? createTextElement("p", "settings-surface__card-error", state2.settings.errors[definition.id] ?? "") : void 0;
      cardElement.append(titleRow, body, control);
      if (helper) {
        cardElement.append(helper);
      }
      if (error) {
        cardElement.append(error);
      }
      return cardElement;
    }
    createControl(definition, value, state2) {
      const wrapper = document.createElement("div");
      wrapper.className = "settings-surface__control";
      if (definition.control === "toggle") {
        const label = document.createElement("label");
        label.className = "settings-surface__toggle";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.settingId = definition.id;
        input.checked = value === true;
        input.disabled = definition.readOnly === true || state2.busy;
        label.append(input, document.createElement("span"));
        wrapper.append(label);
        return wrapper;
      }
      if (definition.control === "select") {
        const select = document.createElement("select");
        select.className = "settings-surface__select";
        select.dataset.settingId = definition.id;
        select.disabled = definition.readOnly === true || state2.busy;
        const options = getSettingOptions(definition, state2);
        if (options.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "Waiting for Pi\u2026";
          select.append(option);
          select.disabled = true;
        }
        for (const item of options) {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.label;
          select.append(option);
        }
        select.value = typeof value === "string" ? value : "";
        wrapper.append(select);
        return wrapper;
      }
      if (definition.control === "text") {
        const input = document.createElement("input");
        input.className = "settings-surface__text";
        input.type = "text";
        input.dataset.settingId = definition.id;
        input.value = typeof value === "string" ? value : "";
        input.disabled = definition.readOnly === true;
        wrapper.append(input);
        return wrapper;
      }
      if (definition.control === "scopedModels") {
        wrapper.append(this.createScopedModelsControl(state2));
        return wrapper;
      }
      const list = document.createElement("div");
      list.className = "settings-surface__readonly-list";
      const values = Array.isArray(value) ? value : [];
      if (values.length === 0) {
        list.textContent = "No scoped model patterns configured.";
      } else {
        for (const entry of values) {
          const item = document.createElement("code");
          item.textContent = entry;
          list.append(item);
        }
      }
      wrapper.append(list);
      return wrapper;
    }
    createScopedModelsControl(state2) {
      const container = document.createElement("div");
      container.className = "settings-surface__scoped-models";
      if (state2.modelOptions.length === 0) {
        container.append(createTextElement("p", "settings-surface__card-helper", state2.metadataRefreshing ? "Loading models\u2026" : "No models available yet."));
        return container;
      }
      const selection = getScopedModelSelection(state2);
      const summary = selection.allEnabled ? "All models are enabled for cycling." : `${selection.enabledIds.length}/${state2.modelOptions.length} models enabled for cycling.`;
      container.append(createTextElement("p", "settings-surface__card-helper", summary));
      const visibleModels = getVisibleScopedModels(selection, this.scopedModelsProviderFilter);
      const filterToolbar = document.createElement("div");
      filterToolbar.className = "settings-surface__scoped-toolbar";
      filterToolbar.append(this.createScopedModelsButton("All models", "showAll", state2.busy, this.scopedModelsProviderFilter === void 0));
      for (const provider of Array.from(new Set(state2.modelOptions.map((model) => model.provider))).sort()) {
        const button = this.createScopedModelsButton(provider, "provider", state2.busy, this.scopedModelsProviderFilter === provider);
        button.dataset.scopedProvider = provider;
        filterToolbar.append(button);
      }
      const separator = document.createElement("div");
      separator.className = "settings-surface__scoped-separator";
      separator.setAttribute("role", "separator");
      const actionToolbar = document.createElement("div");
      actionToolbar.className = "settings-surface__scoped-toolbar settings-surface__scoped-toolbar--actions";
      actionToolbar.append(this.createScopedModelsButton("Select", "selectVisible", state2.busy || visibleModels.length === 0));
      actionToolbar.append(this.createScopedModelsButton("Unselect", "unselectVisible", state2.busy || visibleModels.length === 0));
      container.append(filterToolbar, separator, actionToolbar);
      const list = document.createElement("div");
      list.className = "settings-surface__scoped-list";
      for (const group of groupScopedModelsByProvider(visibleModels)) {
        const providerIds = group.models.map(getModelFullId);
        const enabledCount = selection.allEnabled ? providerIds.length : providerIds.filter((id) => selection.enabledIds.includes(id)).length;
        const groupElement = document.createElement("section");
        groupElement.className = "settings-surface__scoped-provider";
        groupElement.setAttribute("aria-label", `${group.provider} scoped models`);
        const header = document.createElement("div");
        header.className = "settings-surface__scoped-provider-header";
        const title = document.createElement("div");
        title.className = "settings-surface__scoped-provider-title";
        title.textContent = group.provider;
        const count = document.createElement("span");
        count.className = "settings-surface__scoped-provider-count";
        count.textContent = `${enabledCount}/${providerIds.length} selected`;
        title.append(count);
        header.append(title);
        groupElement.append(header);
        for (const model of group.models) {
          const fullId = getModelFullId(model);
          const enabled = selection.allEnabled || selection.enabledIds.includes(fullId);
          const row = document.createElement("div");
          row.className = "settings-surface__scoped-row";
          row.classList.toggle("settings-surface__scoped-row--disabled", !enabled);
          const label = document.createElement("label");
          label.className = "settings-surface__scoped-check";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.scopedModelId = fullId;
          checkbox.checked = enabled;
          checkbox.disabled = state2.busy;
          label.append(checkbox, document.createTextNode(model.name || model.id));
          const meta = document.createElement("span");
          meta.className = "settings-surface__scoped-meta";
          meta.textContent = fullId;
          const actions = document.createElement("div");
          actions.className = "settings-surface__scoped-actions";
          const moveUp = this.createScopedModelsButton("Up", "moveUp", state2.busy || selection.allEnabled || !enabled);
          moveUp.dataset.scopedModelId = fullId;
          const moveDown = this.createScopedModelsButton("Down", "moveDown", state2.busy || selection.allEnabled || !enabled);
          moveDown.dataset.scopedModelId = fullId;
          actions.append(moveUp, moveDown);
          row.append(label, meta, actions);
          groupElement.append(row);
        }
        list.append(groupElement);
      }
      container.append(list);
      return container;
    }
    createScopedModelsButton(label, action, disabled, active = false) {
      const button = document.createElement("button");
      button.className = "settings-surface__button settings-surface__button--compact";
      button.classList.toggle("settings-surface__button--active", active);
      button.type = "button";
      button.textContent = label;
      button.dataset.scopedModelAction = action;
      button.disabled = disabled;
      return button;
    }
    syncNavState(sectionId) {
      for (const button of this.options.settingsBodyElement.querySelectorAll("[data-settings-section]")) {
        const selected = button.dataset.settingsSection === sectionId;
        button.classList.toggle("settings-surface__nav-item--active", selected);
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
      }
    }
    focusActiveSectionButton() {
      this.focusSectionButton(this.options.getState().settingsSection);
    }
    focusSectionButton(section) {
      this.options.settingsBodyElement.querySelector(`[data-settings-section="${section}"]`)?.focus({ preventScroll: true });
    }
  };
  function getAuthStatusLabel(provider) {
    if (provider.canLogout && provider.storedCredentialType === "oauth") {
      return "Logged in";
    }
    if (provider.canLogout && provider.storedCredentialType === "api_key") {
      return "Stored key";
    }
    if (provider.configured) {
      return provider.source === "environment" ? "Env" : "Configured";
    }
    return "Not set";
  }
  function getSettingValue(definition, state2) {
    return state2.settings.values[definition.id] ?? definition.defaultValue;
  }
  function createKwardUnsupportedSettingsEmptyState() {
    const empty = document.createElement("div");
    empty.className = "settings-surface__card settings-surface__card--subtle";
    empty.append(
      createTextElement("h4", "settings-surface__card-title", "No Kward-supported settings in this section yet"),
      createTextElement("p", "settings-surface__card-body", "Kward reports supported runtime settings through RPC capabilities. Unsupported Pi settings are hidden.")
    );
    return empty;
  }
  function getVisibleSettingsForSection(sectionId, state2) {
    return getSettingsForSection(sectionId).filter((definition) => isSettingVisible(definition, state2));
  }
  function isSettingVisible(definition, state2) {
    if (state2.settings.values["tauren.backend"] !== "kward" || definition.owner !== "pi") {
      return true;
    }
    return definition.id in state2.settings.values;
  }
  function getSettingOptions(definition, state2) {
    if (definition.id === "defaultProvider") {
      const providers = Array.from(new Set(state2.modelOptions.map((model) => model.provider).filter(Boolean)));
      return providers.map((provider) => ({ value: provider, label: provider }));
    }
    if (definition.id === "defaultModel") {
      return state2.modelOptions.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: model.name || `${model.provider}/${model.id}`
      }));
    }
    return definition.options ? [...definition.options] : [];
  }
  function getHelperText(definition) {
    if (definition.helper) {
      return definition.helper;
    }
    return definition.liveBehavior === "reload" ? "Saved for Pi; takes effect after reload or a new session." : "";
  }
  function groupScopedModelsByProvider(models) {
    const groups = [];
    for (const model of models) {
      let group = groups.find((item) => item.provider === model.provider);
      if (!group) {
        group = { provider: model.provider, models: [] };
        groups.push(group);
      }
      group.models.push(model);
    }
    return groups;
  }
  function getVisibleScopedModels(selection, providerFilter) {
    return providerFilter ? selection.orderedModels.filter((model) => model.provider === providerFilter) : selection.orderedModels;
  }
  function createSettingsSignature(sectionId, state2, scopedModelsProviderFilter) {
    const values = getVisibleSettingsForSection(sectionId, state2).map((definition) => [definition.id, state2.settings.values[definition.id]]);
    const modelOptions = sectionId === "runtime" || sectionId === "scopedModels" ? state2.modelOptions.map((model) => `${model.provider}/${model.id}:${model.name}`).join("|") : "";
    const auth = sectionId === "login" ? state2.auth : void 0;
    const voice = sectionId === "voice" ? state2.voice : void 0;
    const providerFilter = sectionId === "scopedModels" ? scopedModelsProviderFilter : void 0;
    return JSON.stringify([sectionId, values, modelOptions, auth, voice, state2.busy, state2.settings.errors, providerFilter]);
  }
  function getVoiceDownloadLabel(download) {
    if (download.status === "downloaded") {
      return "Downloaded";
    }
    if (download.status === "downloading") {
      if (download.totalBytes && download.receivedBytes !== void 0) {
        return `Downloading ${Math.round(download.receivedBytes / download.totalBytes * 100)}% (${formatVoiceBytes(download.receivedBytes)} / ${formatVoiceBytes(download.totalBytes)})`;
      }
      return `Downloading ${formatVoiceBytes(download.receivedBytes ?? 0)}`;
    }
    if (download.status === "failed") {
      return "Download failed";
    }
    if (download.status === "unavailable") {
      return "Unavailable";
    }
    return "Not downloaded";
  }
  function formatVoiceBytes(value) {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
    }
    return `${Math.round(value / (1024 * 1024))} MiB`;
  }
  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  // src/webviewProtocol/messagePatch.ts
  function parseWebviewMessagePatch(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    const upserts = Array.isArray(value.upserts) ? value.upserts.filter(isWebviewMessagePatchUpsert) : void 0;
    const deleteFrom = typeof value.deleteFrom === "number" && Number.isInteger(value.deleteFrom) && value.deleteFrom >= 0 ? value.deleteFrom : void 0;
    if ((!upserts || upserts.length === 0) && deleteFrom === void 0) {
      return void 0;
    }
    return {
      ...upserts && upserts.length > 0 ? { upserts } : {},
      ...deleteFrom !== void 0 ? { deleteFrom } : {}
    };
  }
  function applyWebviewMessagePatch(previousMessages, patch) {
    const messages = previousMessages.slice();
    if (typeof patch.deleteFrom === "number") {
      messages.splice(patch.deleteFrom);
    }
    for (const upsert of patch.upserts ?? []) {
      messages[upsert.index] = mergePatchedWebviewMessage(messages[upsert.index], upsert.message);
    }
    return messages;
  }
  function isWebviewMessagePatchUpsert(value) {
    if (!isRecord(value)) {
      return false;
    }
    return typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 && isRecord(value.message) && typeof value.message.role === "string" && typeof value.message.text === "string";
  }
  function mergePatchedWebviewMessage(previous, incoming) {
    if (!previous || !incoming.id || previous.id !== incoming.id) {
      return incoming;
    }
    const merged = { ...incoming };
    if (!("images" in incoming) && previous.images) {
      merged.images = previous.images;
    }
    if (Array.isArray(incoming.activities) && Array.isArray(previous.activities)) {
      merged.activities = incoming.activities.map((activity) => {
        const activityId = typeof activity.id === "string" ? activity.id : "";
        const previousActivity = activityId ? previous.activities?.find((item) => item.id === activityId) : void 0;
        if (!previousActivity || "images" in activity || !previousActivity.images) {
          return activity;
        }
        return { ...activity, images: previousActivity.images };
      });
    }
    return merged;
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
    animationsEnabled: true,
    customUiTheme: "default",
    extensionStatus: [],
    extensionFooter: void 0,
    extensionWidgets: [],
    startupResources: [],
    startupResourcesReloadRevision: 0,
    allowRemoteImages: false,
    welcomeDismissed: false,
    promptContext: [],
    promptImages: [],
    composerText: "",
    composerTextRevision: 0,
    composerTextMode: "replace",
    lane: "chat",
    chatFace: "main",
    settingsSection: "appearance",
    settings: { values: {} },
    auth: { providers: [] },
    kwardQuestion: void 0,
    sessions: [],
    sessionsRefreshing: false,
    sessionsError: "",
    sessionSearch: createEmptySessionSearchState(),
    currentSessionFile: "",
    currentSessionName: "",
    treeItems: [],
    treeRefreshing: false,
    treeError: "",
    sessionLoading: false,
    voice: void 0,
    perfEnabled: false
  };
  function createStartupResourcesCache() {
    return {
      initialized: false,
      reloadRevision: 0,
      resources: []
    };
  }
  function applyStartupResourcesCache(nextState, cache) {
    let nextCache = cache;
    if (nextState.startupResourcesReloadRevision > cache.reloadRevision) {
      nextCache = {
        initialized: true,
        reloadRevision: nextState.startupResourcesReloadRevision,
        resources: cloneStartupResources(nextState.startupResources)
      };
    } else if (!cache.initialized && nextState.startupResources.length > 0) {
      nextCache = {
        initialized: true,
        reloadRevision: nextState.startupResourcesReloadRevision,
        resources: cloneStartupResources(nextState.startupResources)
      };
    }
    if (!nextCache.initialized || areStartupResourcesEqual(nextState.startupResources, nextCache.resources)) {
      return { state: nextState, cache: nextCache };
    }
    return {
      state: {
        ...nextState,
        startupResources: cloneStartupResources(nextCache.resources)
      },
      cache: nextCache
    };
  }
  function createOptimisticNewSessionState(previousState) {
    return {
      ...previousState,
      messages: [],
      busy: false,
      contextUsageLabel: "",
      contextUsageTitle: "",
      contextUsageLevel: "",
      workspaceDiffStats: { addedLines: 0, removedLines: 0 },
      composerPaste: void 0,
      lane: "chat",
      chatFace: "main",
      currentSessionFile: "",
      currentSessionName: "",
      treeRefreshing: false,
      treeError: "",
      sessionLoading: false
    };
  }
  function createProvisionalExtensionUiSnapshot(state2) {
    const hasFooterUi = hasExtensionFooterUi(state2);
    return {
      extensionFooter: hasFooterUi && state2.extensionFooter ? { ...state2.extensionFooter } : void 0,
      extensionStatus: state2.extensionStatus.map((entry) => ({ ...entry })),
      extensionWidgets: state2.extensionWidgets.map((widget) => ({
        ...widget,
        lines: [...widget.lines],
        ...widget.blocks ? { blocks: [...widget.blocks] } : {}
      })),
      footerPending: shouldReserveExtensionFooter(state2),
      widgetsPending: state2.extensionWidgets.length > 0
    };
  }
  function applyProvisionalExtensionUiSnapshot(nextState, snapshot) {
    if (!snapshot) {
      return { state: nextState, snapshot: void 0 };
    }
    const footerPending = snapshot.footerPending && !hasExtensionFooterUi(nextState);
    const widgetsPending = snapshot.widgetsPending && nextState.extensionWidgets.length === 0;
    if (!footerPending && !widgetsPending) {
      return { state: nextState, snapshot: void 0 };
    }
    return {
      state: {
        ...nextState,
        ...footerPending ? {
          extensionFooter: snapshot.extensionFooter,
          extensionStatus: snapshot.extensionStatus
        } : {},
        ...widgetsPending ? {
          extensionWidgets: snapshot.extensionWidgets
        } : {}
      },
      snapshot: {
        ...snapshot,
        footerPending,
        widgetsPending
      }
    };
  }
  function hasPendingProvisionalExtensionUi(snapshot) {
    return Boolean(snapshot?.footerPending || snapshot?.widgetsPending);
  }
  function hasExtensionFooterUi(state2) {
    return state2.extensionFooter !== void 0 || state2.extensionStatus.length > 0;
  }
  function shouldReserveExtensionFooter(state2) {
    return state2.settings.values["tauren.extensions.statusBarEnabled"] !== false && hasExtensionFooterUi(state2);
  }
  function parseWebviewStateMessage(data, previousState) {
    const record = isRecord(data) ? data : {};
    return {
      messages: parseMessages(record, previousState?.messages ?? []),
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
      animationsEnabled: typeof record.animationsEnabled === "boolean" ? record.animationsEnabled : true,
      customUiTheme: parseWebviewCustomUiTheme(record.customUiTheme),
      extensionStatus: parseExtensionStatus(record.extensionStatus),
      extensionFooter: parseExtensionFooter(record.extensionFooter),
      extensionWidgets: parseExtensionWidgets(record.extensionWidgets),
      startupResources: parseStartupResources(record.startupResources),
      startupResourcesReloadRevision: parseNonNegativeInteger(record.startupResourcesReloadRevision, previousState?.startupResourcesReloadRevision ?? 0),
      allowRemoteImages: typeof record.allowRemoteImages === "boolean" ? record.allowRemoteImages : false,
      welcomeDismissed: Boolean(record.welcomeDismissed),
      promptContext: Array.isArray(record.promptContext) ? record.promptContext : [],
      promptImages: parsePromptImages(record.promptImages),
      composerText: typeof record.composerText === "string" ? record.composerText : "",
      composerTextRevision: typeof record.composerTextRevision === "number" ? record.composerTextRevision : 0,
      composerTextMode: record.composerTextMode === "append" ? "append" : "replace",
      composerPaste: parseComposerPaste(record.composerPaste),
      lane: parseWebviewLane(record.lane, "chat"),
      chatFace: parseChatFace(record.chatFace, parseWebviewLane(record.lane, "chat")),
      settingsSection: parseWebviewSettingsSection(record.settingsSection, "appearance"),
      settings: parseSettingsState(record.settings),
      auth: parseAuthState(record.auth),
      kwardQuestion: parseKwardQuestion(record.kwardQuestion),
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
      sessionsRefreshing: Boolean(record.sessionsRefreshing),
      sessionsError: typeof record.sessionsError === "string" ? record.sessionsError : "",
      sessionSearch: parseSessionSearchState(record.sessionSearch, previousState?.sessionSearch),
      currentSessionFile: typeof record.currentSessionFile === "string" ? record.currentSessionFile : "",
      currentSessionName: typeof record.currentSessionName === "string" ? record.currentSessionName : "",
      treeItems: Array.isArray(record.treeItems) ? record.treeItems : [],
      treeRefreshing: Boolean(record.treeRefreshing),
      treeError: typeof record.treeError === "string" ? record.treeError : "",
      sessionLoading: Boolean(record.sessionLoading),
      voice: parseVoiceState(record.voice),
      perfEnabled: Boolean(record.perfEnabled)
    };
  }
  function parseVoiceState(value) {
    if (!isRecord(value) || !Array.isArray(value.models) || !isRecord(value.binary)) {
      return void 0;
    }
    const selectedModelId = parseVoiceModelId(value.selectedModelId);
    const transcriptAction = value.transcriptAction === "submit" ? "submit" : "insert";
    const language = parseVoiceLanguage(value.language);
    const effectiveLanguage = parseVoiceLanguage(value.effectiveLanguage);
    const languageForced = Boolean(value.languageForced);
    const mode = value.mode === "handsFree" ? "handsFree" : "pushToTalk";
    const activationMode = value.activationMode === "hold" ? "hold" : "toggle";
    const maxRecordingSeconds = typeof value.maxRecordingSeconds === "number" ? value.maxRecordingSeconds : 60;
    const handsFreeSensitivity = value.handsFreeSensitivity === "low" || value.handsFreeSensitivity === "high" ? value.handsFreeSensitivity : "normal";
    const handsFreeSilenceSeconds = typeof value.handsFreeSilenceSeconds === "number" ? value.handsFreeSilenceSeconds : 1.2;
    const audioLevel = typeof value.audioLevel === "number" ? Math.max(0, Math.min(1, value.audioLevel)) : 0;
    const recordingStatus = value.recordingStatus === "listening" || value.recordingStatus === "recording" || value.recordingStatus === "transcribing" || value.recordingStatus === "error" ? value.recordingStatus : "idle";
    return {
      enabled: Boolean(value.enabled),
      selectedModelId,
      transcriptAction,
      mode,
      activationMode,
      maxRecordingSeconds,
      handsFreeSensitivity,
      handsFreeSilenceSeconds,
      language,
      effectiveLanguage,
      languageForced,
      models: value.models.filter(isVoiceModelOption).map((model) => ({
        ...model,
        download: parseVoiceDownloadState(model.download)
      })),
      binary: {
        status: parseVoiceDownloadStatus(value.binary.status),
        label: typeof value.binary.label === "string" ? value.binary.label : "whisper.cpp",
        ...typeof value.binary.path === "string" ? { path: value.binary.path } : {},
        ...value.binary.source === "system" || value.binary.source === "downloaded" ? { source: value.binary.source } : {},
        ...typeof value.binary.helper === "string" ? { helper: value.binary.helper } : {},
        download: parseVoiceDownloadState(value.binary.download)
      },
      inputDevices: parseVoiceInputDevicesState(value.inputDevices),
      recordingStatus,
      audioLevel,
      ...typeof value.error === "string" && value.error ? { error: value.error } : {}
    };
  }
  function parseVoiceModelId(value) {
    return value === "tiny.en" || value === "base.en" || value === "small.en" || value === "tiny" || value === "base" || value === "small" ? value : "base.en";
  }
  function parseVoiceLanguage(value) {
    return value === "en" || value === "de" || value === "fr" || value === "es" || value === "it" || value === "pt" || value === "nl" || value === "pl" || value === "ja" || value === "ko" || value === "zh" ? value : "auto";
  }
  function parseVoiceInputDevicesState(value) {
    if (!isRecord(value) || !Array.isArray(value.devices)) {
      return {
        selectedId: "default",
        status: "idle",
        devices: [{ id: "default", label: "Default microphone", isDefault: true }]
      };
    }
    const status = value.status === "refreshing" || value.status === "ready" || value.status === "error" ? value.status : "idle";
    const devices = value.devices.filter(isVoiceInputDevice);
    return {
      selectedId: typeof value.selectedId === "string" && value.selectedId ? value.selectedId : "default",
      status,
      devices: devices.length > 0 ? devices : [{ id: "default", label: "Default microphone", isDefault: true }],
      ...typeof value.error === "string" && value.error ? { error: value.error } : {}
    };
  }
  function isVoiceInputDevice(value) {
    return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
  }
  function isVoiceModelOption(value) {
    return isRecord(value) && (value.id === "tiny.en" || value.id === "base.en" || value.id === "small.en" || value.id === "tiny" || value.id === "base" || value.id === "small") && typeof value.label === "string" && typeof value.description === "string" && typeof value.sizeBytes === "number" && typeof value.downloaded === "boolean";
  }
  function parseVoiceDownloadState(value) {
    if (!isRecord(value)) {
      return { status: "idle" };
    }
    return {
      status: parseVoiceDownloadStatus(value.status),
      ...typeof value.receivedBytes === "number" ? { receivedBytes: value.receivedBytes } : {},
      ...typeof value.totalBytes === "number" ? { totalBytes: value.totalBytes } : {},
      ...typeof value.error === "string" ? { error: value.error } : {}
    };
  }
  function parseVoiceDownloadStatus(value) {
    return value === "downloading" || value === "downloaded" || value === "failed" || value === "unavailable" ? value : "idle";
  }
  function parseKwardQuestion(value) {
    if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.questionRequestId !== "string" || !Array.isArray(value.questions)) {
      return void 0;
    }
    const questions = value.questions.map((question) => {
      if (!isRecord(question) || typeof question.question !== "string" || typeof question.header !== "string" || !Array.isArray(question.options)) {
        return void 0;
      }
      const options = question.options.map((option) => {
        if (!isRecord(option) || typeof option.label !== "string" || typeof option.description !== "string") {
          return void 0;
        }
        return { label: option.label, description: option.description };
      });
      if (options.some((option) => !option)) {
        return void 0;
      }
      return { question: question.question, header: question.header, options };
    });
    if (questions.some((question) => !question)) {
      return void 0;
    }
    return {
      sessionId: value.sessionId,
      questionRequestId: value.questionRequestId,
      questions
    };
  }
  function createEmptySessionSearchState() {
    return {
      requestId: 0,
      query: "",
      namedOnly: false,
      status: "idle",
      matchedSessionPaths: [],
      indexedCount: 0,
      totalCount: 0
    };
  }
  function parseSessionSearchState(value, fallback) {
    if (!isRecord(value)) {
      return fallback ?? createEmptySessionSearchState();
    }
    const status = value.status === "indexing" || value.status === "ready" || value.status === "error" ? value.status : "idle";
    const requestId = parseNonNegativeInteger(value.requestId, 0);
    const indexedCount = parseNonNegativeInteger(value.indexedCount, 0);
    const totalCount = parseNonNegativeInteger(value.totalCount, 0);
    const matchedSessionPaths = Array.isArray(value.matchedSessionPaths) ? value.matchedSessionPaths.filter((path) => typeof path === "string" && path.length > 0) : [];
    return {
      requestId,
      query: typeof value.query === "string" ? value.query : "",
      namedOnly: Boolean(value.namedOnly),
      status,
      matchedSessionPaths,
      indexedCount,
      totalCount,
      ...typeof value.error === "string" && value.error ? { error: value.error } : {}
    };
  }
  function parsePromptImages(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isPromptImageAttachment2).map((attachment) => ({
      id: attachment.id,
      label: attachment.label,
      title: attachment.title,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes
    }));
  }
  function isPromptImageAttachment2(value) {
    return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" && typeof value.title === "string" && typeof value.mimeType === "string" && typeof value.sizeBytes === "number";
  }
  function parseComposerPaste(value) {
    if (!isRecord(value) || typeof value.text !== "string" || typeof value.revision !== "number") {
      return void 0;
    }
    return {
      text: value.text,
      revision: value.revision
    };
  }
  function parseExtensionStatus(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isExtensionStatusEntry).map((entry) => ({
      key: entry.key,
      text: entry.text
    }));
  }
  function parseExtensionFooter(value) {
    return isRecord(value) && typeof value.line === "string" ? { line: value.line } : void 0;
  }
  function isExtensionStatusEntry(value) {
    return isRecord(value) && typeof value.key === "string" && typeof value.text === "string";
  }
  function parseExtensionWidgets(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isExtensionWidgetEntry).map((entry) => ({
      key: entry.key,
      placement: entry.placement,
      lines: entry.lines.map((line) => String(line)),
      ...Array.isArray(entry.blocks) ? { blocks: entry.blocks } : {}
    }));
  }
  function isExtensionWidgetEntry(value) {
    return isRecord(value) && typeof value.key === "string" && (value.placement === "aboveEditor" || value.placement === "belowEditor") && Array.isArray(value.lines);
  }
  function parseNonNegativeInteger(value, fallback) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
  }
  function cloneStartupResources(resources) {
    return resources.map((section) => ({
      name: section.name,
      items: section.items.slice()
    }));
  }
  function areStartupResourcesEqual(left, right) {
    return left.length === right.length && left.every((section, index) => {
      const other = right[index];
      return other && section.name === other.name && section.items.length === other.items.length && section.items.every((item, itemIndex) => item === other.items[itemIndex]);
    });
  }
  function parseStartupResources(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((section) => {
      if (!isRecord(section) || typeof section.name !== "string" || !Array.isArray(section.items)) {
        return [];
      }
      const items = section.items.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
      return section.name.trim() && items.length > 0 ? [{ name: section.name.trim(), items }] : [];
    });
  }
  function parseAuthState(value) {
    if (!isRecord(value)) {
      return { providers: [] };
    }
    return {
      providers: Array.isArray(value.providers) ? value.providers.filter(isAuthProvider).map(sanitizeAuthProvider) : [],
      ...value.refreshing === true ? { refreshing: true } : {},
      ...typeof value.busyProviderId === "string" && value.busyProviderId ? { busyProviderId: value.busyProviderId } : {},
      ...value.busyAction === "login" || value.busyAction === "logout" ? { busyAction: value.busyAction } : {},
      ...isAuthProgress(value.progress) ? { progress: value.progress } : {},
      ...typeof value.error === "string" && value.error ? { error: value.error } : {}
    };
  }
  function isAuthProvider(value) {
    return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && (value.authType === "oauth" || value.authType === "api_key") && typeof value.configured === "boolean" && typeof value.canLogout === "boolean";
  }
  function sanitizeAuthProvider(provider) {
    return {
      id: provider.id,
      name: provider.name,
      authType: provider.authType,
      configured: provider.configured,
      canLogout: provider.canLogout,
      ...typeof provider.source === "string" ? { source: provider.source } : {},
      ...typeof provider.label === "string" ? { label: provider.label } : {},
      ...provider.storedCredentialType === "oauth" || provider.storedCredentialType === "api_key" ? { storedCredentialType: provider.storedCredentialType } : {},
      ...typeof provider.usesCallbackServer === "boolean" ? { usesCallbackServer: provider.usesCallbackServer } : {}
    };
  }
  function isAuthProgress(value) {
    return isRecord(value) && typeof value.message === "string" && (!("providerId" in value) || typeof value.providerId === "string") && (!("url" in value) || typeof value.url === "string") && (!("userCode" in value) || typeof value.userCode === "string") && (!("verificationUri" in value) || typeof value.verificationUri === "string");
  }
  function parseSettingsState(value) {
    if (!isRecord(value)) {
      return { values: {} };
    }
    const parsedValues = {};
    const values = isRecord(value.values) ? value.values : {};
    for (const [settingId, settingValue] of Object.entries(values)) {
      if (!isSettingId(settingId)) {
        continue;
      }
      const normalizedValue = normalizeSettingValue(settingId, settingValue);
      if (normalizedValue !== void 0) {
        parsedValues[settingId] = normalizedValue;
      }
    }
    return {
      values: parsedValues,
      pending: Array.isArray(value.pending) ? value.pending.filter(isSettingId) : void 0,
      errors: parseSettingsErrors(value.errors)
    };
  }
  function parseSettingsErrors(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    const parsedErrors = {};
    for (const [settingId, error] of Object.entries(value)) {
      if (isSettingId(settingId) && typeof error === "string") {
        parsedErrors[settingId] = error;
      }
    }
    return parsedErrors;
  }
  function parseChatFace(value, lane) {
    return lane === "chat" && value === "settings" ? "settings" : "main";
  }
  function parseMessages(record, previousMessages) {
    if (Array.isArray(record.messages)) {
      return record.messages;
    }
    const patch = parseWebviewMessagePatch(record.messagePatch);
    if (!patch) {
      return previousMessages;
    }
    return applyWebviewMessagePatch(previousMessages, patch);
  }
  function parseWorkspaceDiffStats(value) {
    if (!isRecord(value)) {
      return { addedLines: 0, removedLines: 0 };
    }
    return {
      addedLines: normalizeDiffLineCount(value.addedLines),
      removedLines: normalizeDiffLineCount(value.removedLines)
    };
  }

  // src/webview/kwardQuestion.ts
  function createKwardQuestionUiState(request) {
    return {
      requestKey: getKwardQuestionRequestKey(request),
      stepIndex: 0,
      selectedAnswers: request.questions.map((question) => question.options[0]?.label ?? ""),
      customAnswers: request.questions.map(() => "")
    };
  }
  function getKwardQuestionAnswerMessage(request, uiState) {
    return {
      type: "kwardQuestionAnswer",
      sessionId: request.sessionId,
      questionRequestId: request.questionRequestId,
      answers: getKwardQuestionAnswers(request, uiState)
    };
  }
  function getKwardQuestionAnswers(request, uiState) {
    return request.questions.map((question, index) => ({
      question: question.question,
      answer: getKwardQuestionAnswerForIndex(request, uiState, index)
    }));
  }
  function getKwardQuestionAnswerForIndex(request, uiState, index) {
    return getKwardQuestionCustomAnswerForIndex(uiState, index) || getKwardQuestionSelectedAnswerForIndex(request, uiState, index) || "";
  }
  function getKwardQuestionSelectedAnswerForIndex(request, uiState, index) {
    return uiState.selectedAnswers[index] || request.questions[index]?.options[0]?.label || "";
  }
  function getKwardQuestionCustomAnswerForIndex(uiState, index) {
    return (uiState.customAnswers[index] ?? "").trim();
  }
  function getKwardQuestionRequestKey(request) {
    return `${request.sessionId}\0${request.questionRequestId}`;
  }
  function getKwardQuestionLastStepIndex(request) {
    return request.questions.length;
  }
  function getKwardQuestionNextProgressFocusIndex(request, currentIndex, delta) {
    const stepCount = getKwardQuestionLastStepIndex(request) + 1;
    return moduloIndex(currentIndex, delta, stepCount);
  }
  function getKwardQuestionChoiceCount(request, questionIndex) {
    return (request.questions[questionIndex]?.options.length ?? 0) + 1;
  }
  function getKwardQuestionCustomChoiceIndex(request, questionIndex) {
    return Math.max(0, getKwardQuestionChoiceCount(request, questionIndex) - 1);
  }
  function getKwardQuestionNextVerticalFocusTarget(request, questionIndex, currentIndex, delta) {
    const choiceCount = getKwardQuestionChoiceCount(request, questionIndex);
    if (choiceCount <= 0) {
      return { kind: "progress" };
    }
    if (delta < 0 && currentIndex <= 0) {
      return { kind: "progress" };
    }
    return { kind: "choice", choiceIndex: moduloIndex(currentIndex, delta, choiceCount) };
  }
  function isKwardQuestionSummaryStep(request, uiState) {
    return uiState.stepIndex >= request.questions.length;
  }
  function getKwardQuestionTitle(request, uiState) {
    if (request.questions.length === 1) {
      return "Kward needs your input";
    }
    return isKwardQuestionSummaryStep(request, uiState) ? `Kward needs your input \xB7 Review (${request.questions.length + 1}/${request.questions.length + 1})` : `Kward needs your input \xB7 Question ${uiState.stepIndex + 1}/${request.questions.length}`;
  }
  function getKwardQuestionAriaLabel(request, uiState) {
    return isKwardQuestionSummaryStep(request, uiState) ? "Kward question review" : "Kward question";
  }
  function getKwardQuestionRenderSignature(request, uiState) {
    return JSON.stringify({
      key: uiState.requestKey,
      questions: request.questions,
      stepIndex: uiState.stepIndex,
      selectedAnswers: uiState.selectedAnswers,
      customAnswers: uiState.customAnswers
    });
  }
  function moduloIndex(currentIndex, delta, count) {
    if (count <= 0) {
      return 0;
    }
    return (currentIndex + delta + count) % count;
  }

  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  configureCodeHighlighting((message) => vscode.postMessage(message));
  configureMarkdownImageRendering((message) => vscode.postMessage(message));
  watchCodeHighlightThemeChanges();
  var {
    viewElement,
    toolbarTitleElement,
    toolbarTitleTextElement,
    toolbarTimestampElement,
    sessionNameInputElement,
    sessionToggleButton,
    treeToggleButton,
    helpOverlayElement,
    helpCloseButton,
    settingsElement,
    settingsBodyElement,
    settingsBackButton,
    toastElement,
    messagesElement,
    sessionsElement,
    sessionTreeElement,
    customUiElement,
    customUiOutputElement,
    customUiCloseButton,
    extensionEditorElement,
    extensionEditorTitleElement,
    extensionEditorInputElement,
    extensionEditorSaveButton,
    extensionEditorCancelButton,
    extensionEditorCloseButton,
    widgetBusySlotElement,
    extensionWidgetsAboveElement,
    extensionWidgetsBelowElement,
    form,
    textarea,
    composerStatusElement,
    composerStatusTextElement,
    slashMenuElement,
    contextBadgesElement,
    busySubmitElement,
    diffSummaryElement,
    diffAddedElement,
    diffRemovedElement,
    streamingBehaviorButtonElements,
    attachButton,
    voiceButton,
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
  busyStatusElement.setAttribute("role", "status");
  busyStatusElement.setAttribute("aria-live", "polite");
  busyStatusElement.setAttribute("aria-atomic", "true");
  var busyStatusSpinnerElement = document.createElement("span");
  busyStatusSpinnerElement.className = "status__spinner";
  busyStatusSpinnerElement.setAttribute("aria-hidden", "true");
  var busyStatusTextElement = document.createElement("span");
  busyStatusElement.append(busyStatusSpinnerElement, busyStatusTextElement);
  messagesContentElement.replaceChildren(...Array.from(messagesElement.childNodes));
  var extensionPromptElement = document.createElement("article");
  extensionPromptElement.className = "extension-prompt";
  extensionPromptElement.hidden = true;
  extensionPromptElement.inert = true;
  extensionPromptElement.setAttribute("aria-live", "polite");
  extensionPromptElement.setAttribute("aria-label", "Pi extension prompt");
  messagesElement.append(messagesContentElement, busyStatusElement, extensionPromptElement);
  var kwardQuestionElement = document.createElement("section");
  kwardQuestionElement.className = "kward-question";
  kwardQuestionElement.hidden = true;
  kwardQuestionElement.setAttribute("aria-label", "Kward question");
  kwardQuestionElement.setAttribute("aria-live", "polite");
  kwardQuestionElement.setAttribute("role", "dialog");
  kwardQuestionElement.tabIndex = 0;
  extensionWidgetsAboveElement.after(kwardQuestionElement);
  var state = { ...initialWebviewState };
  var kwardQuestionUiState;
  var renderedKwardQuestionSignature = "";
  var toolsExpanded = false;
  var toastHideTimeout;
  var pendingRenderFrame;
  var pendingReturnToChatAfterRender = false;
  var hasReceivedHostState = false;
  var faceTransitionSuppressionFrame;
  var renderInstrumentationEnabled = document.body.dataset.taurenDevRenderInstrumentation === "true";
  var perfEventThresholdMs = 8;
  var busySubmitHomeMarker = document.createComment("busy-submit-home");
  busySubmitElement.after(busySubmitHomeMarker);
  var widgetDimensionSignatures = /* @__PURE__ */ new Map();
  var footerDimensionSignature = "";
  var provisionalExtensionUiSnapshot;
  var startupResourcesCache = createStartupResourcesCache();
  var sessionsController;
  var settingsController;
  var transcriptSearchController;
  var isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform);
  var customUiController = new CustomUiController({
    vscode,
    customUiElement,
    customUiOutputElement,
    customUiCloseButton,
    form,
    onClose: handleCustomUiClose
  });
  var extensionEditorDialogController = new ExtensionEditorDialogController({
    vscode,
    element: extensionEditorElement,
    titleElement: extensionEditorTitleElement,
    inputElement: extensionEditorInputElement,
    saveButton: extensionEditorSaveButton,
    cancelButton: extensionEditorCancelButton,
    closeButton: extensionEditorCloseButton
  });
  var messagesController = new MessageListController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    messagesElement,
    messagesContentElement,
    busyStatusElement,
    busyStatusTextElement
  });
  var extensionPromptController = new ExtensionPromptController({
    vscode,
    element: extensionPromptElement,
    onShow: () => messagesController.scheduleMessagesToBottom()
  });
  transcriptSearchController = new TranscriptSearchController({
    messagesElement,
    messagesContentElement,
    isChatMainVisible: () => state.lane === "chat" && state.chatFace !== "settings",
    onClose: focusPromptInput
  });
  var composerController = new ComposerController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    refreshMetadata,
    form,
    textarea,
    submitButton,
    attachButton,
    voiceButton,
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
    scrollMessagesToBottom: () => messagesController.scrollMessagesToBottom(),
    measurePerfEvent
  });
  settingsController = new SettingsPaneController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    settingsElement,
    settingsBodyElement,
    settingsBackButton,
    focusPromptInput
  });
  sessionsController = new SessionViewController({
    getState: () => state,
    postMessage: (message) => vscode.postMessage(message),
    sessionsElement,
    sessionTreeElement,
    toolbarTitleElement,
    toolbarTitleTextElement,
    toolbarTimestampElement,
    sessionNameInputElement,
    sessionToggleButton,
    treeToggleButton,
    focusPromptInput,
    closeSlashMenu: () => composerController.closeSlashMenu(),
    closeModelMenu: () => composerController.closeModelMenu(),
    openHelpOverlay
  });
  composerController.attachEventListeners();
  sessionsController.attachEventListeners();
  settingsController.attachEventListeners();
  customUiController.attachEventListeners();
  extensionEditorDialogController.attachEventListeners();
  helpCloseButton.addEventListener("click", () => closeHelpOverlay());
  newSessionButton.addEventListener("click", startNewSession);
  diffSummaryElement.addEventListener("click", showCurrentChanges);
  messagesElement.addEventListener("click", (event) => messagesController.handleMessageClick(event));
  messagesElement.addEventListener("scroll", () => messagesController.handleMessagesScroll());
  window.addEventListener("message", (event) => {
    if (extensionPromptController.handleHostMessage(event.data)) {
      return;
    }
    if (extensionEditorDialogController.handleHostMessage(event.data)) {
      return;
    }
    if (composerController.handleHostMessage(event.data)) {
      return;
    }
    if (customUiController.handleHostMessage(event.data)) {
      return;
    }
    if (handleCodeHighlightMessage(event.data)) {
      transcriptSearchController.refreshHighlights({ preserveCurrent: true });
      messagesController.scheduleMessagesToBottom();
      return;
    }
    if (handleMarkdownImageMessage(event.data)) {
      messagesController.scheduleMessagesToBottom();
      return;
    }
    if (event.data?.type === "focusInput") {
      focusPromptInput();
      return;
    }
    if (event.data?.type === "openTranscriptSearch") {
      composerController.closeSlashMenu();
      composerController.closeModelMenu();
      sessionsController.closeSessionCommandMenu();
      transcriptSearchController.openSearch();
      return;
    }
    if (event.data?.type === "openModelPicker") {
      composerController.openModelPicker();
      return;
    }
    if (event.data?.type === "scrollPane") {
      const command = parsePaneScrollCommand(event.data);
      if (command) {
        scrollActivePane(command);
      }
      return;
    }
    if (event.data?.type === "toggleStreamingBehavior") {
      composerController.toggleStreamingBehavior();
      return;
    }
    if (event.data?.type === "toggleHelpOverlay") {
      toggleHelpOverlay();
      return;
    }
    if (event.data?.type === "startSessionNameEdit") {
      sessionsController.startCurrentSessionNameEdit();
      return;
    }
    if (event.data?.type === "toast") {
      showToast(
        typeof event.data.message === "string" ? event.data.message : "Done.",
        parseToastKind(event.data.kind)
      );
      return;
    }
    if (event.data?.type === "optimisticNewSession") {
      applyOptimisticNewSessionTransition();
      focusPromptInput();
      return;
    }
    if (event.data?.type === "voiceState") {
      const voice = parseHostVoiceState(event.data.voice);
      if (voice) {
        state = { ...state, voice };
        scheduleRender();
      }
      return;
    }
    if (event.data?.type !== "state") {
      return;
    }
    const previousLane = state.lane;
    const previousChatFace = state.chatFace;
    const previousCurrentSessionFile = state.currentSessionFile;
    const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
    const previousTreeCount = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    const isInitialHostState = !hasReceivedHostState;
    hasReceivedHostState = true;
    const parsedState = parseWebviewStateMessage(event.data, state);
    const startupResourcesResult = applyStartupResourcesCache(parsedState, startupResourcesCache);
    startupResourcesCache = startupResourcesResult.cache;
    const provisionalResult = applyProvisionalExtensionUiSnapshot(startupResourcesResult.state, provisionalExtensionUiSnapshot);
    const nextState = provisionalResult.state;
    provisionalExtensionUiSnapshot = provisionalResult.snapshot;
    clearProvisionalExtensionUiIfSettled();
    const hasComposerTextUpdate = nextState.composerTextRevision > 0;
    const hasComposerPasteUpdate = nextState.composerPaste !== void 0;
    state = nextState;
    if (isInitialHostState) {
      suppressFaceTransitionForNextRender();
    }
    document.body.classList.toggle("tauren-animations-disabled", !state.animationsEnabled);
    applyCustomUiTheme(state.customUiTheme);
    const wasSessionLane = previousLane === "sessions" || previousLane === "tree";
    const isSessionLane = state.lane === "sessions" || state.lane === "tree";
    if (previousLane === "sessions" && state.lane !== "sessions") {
      sessionsController.rememberSessionListScrollPosition();
    }
    if (!wasSessionLane && isSessionLane) {
      messagesController.rememberChatScrollPosition();
      sessionsController.disableSessionPointerHover();
    }
    if (state.lane === "sessions" && (previousLane !== "sessions" || previousCurrentSessionFile !== state.currentSessionFile || previousSessionCount === 0)) {
      sessionsController.selectCurrentSessionOrFirstVisible();
      if (previousLane !== "sessions") {
        sessionsController.restoreSessionListScrollAfterNextRender();
      }
    }
    if (state.lane === "tree" && (previousLane !== "tree" || previousTreeCount === 0)) {
      sessionsController.selectCurrentTreeEntry();
    }
    if (sessionsController.isSessionListNameEditingMissing()) {
      sessionsController.stopSessionListNameEdit();
    }
    if (hasComposerTextUpdate) {
      composerController.applyComposerTextFromState();
    }
    if (hasComposerPasteUpdate && state.composerPaste) {
      composerController.pasteToEditor(state.composerPaste.text);
    }
    scheduleRender({
      returnToChatMain: wasSessionLane && state.lane === "chat" && state.chatFace !== "settings"
    });
    if (previousChatFace === "settings" && state.chatFace === "main" && state.lane === "chat") {
      requestAnimationFrame(() => focusPromptInput());
    }
  });
  window.addEventListener("click", (event) => {
    const target = eventTargetNode(event);
    composerController.handleWindowClick(target);
    sessionsController.handleWindowClick(target, eventTargetElement(event));
    handleHelpWindowClick(target);
  });
  window.addEventListener("keydown", (event) => {
    if (extensionPromptController.handleGlobalKeydown(event)) {
      return;
    }
    if (extensionEditorDialogController.handleGlobalKeydown(event)) {
      return;
    }
    if (customUiController.handleGlobalKeydown(event)) {
      return;
    }
    if (settingsController.handleGlobalKeydown(event)) {
      return;
    }
    if (handleKwardQuestionGlobalKeydown(event)) {
      return;
    }
    if (transcriptSearchController.handleGlobalKeydown(event)) {
      composerController.closeSlashMenu();
      composerController.closeModelMenu();
      sessionsController.closeSessionCommandMenu();
      return;
    }
    if (sessionsController.handleGlobalKeydown(event)) {
      return;
    }
    if (event.key === "Escape" && handleHelpEscape(event)) {
      return;
    }
    if (event.key === "Escape" && handleChatEscape(event)) {
      return;
    }
    if (handlePaneScrollShortcut(event)) {
      return;
    }
    if (handleToolDetailShortcut(event)) {
      return;
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    customUiController.handleGlobalKeyup(event);
  }, true);
  window.addEventListener("resize", () => {
    renderWithInstrumentation();
    composerController.syncComposer({ preserveBottom: true });
    customUiController.handleResize();
  });
  function showCurrentChanges() {
    vscode.postMessage({ type: "showCurrentChanges" });
    focusPromptInput();
  }
  function refreshMetadata() {
    vscode.postMessage({ type: "refreshMetadata" });
  }
  function showToast(message, kind = "success") {
    if (toastHideTimeout) {
      clearTimeout(toastHideTimeout);
    }
    toastElement.className = "tauren-toast tauren-toast--" + kind;
    toastElement.replaceChildren(createToastIcon(kind), document.createTextNode(message));
    toastElement.hidden = false;
    toastElement.classList.add("tauren-toast--visible");
    toastHideTimeout = setTimeout(() => {
      toastElement.classList.remove("tauren-toast--visible");
      toastElement.hidden = true;
      toastHideTimeout = void 0;
    }, 2500);
  }
  function parseToastKind(value) {
    return value === "warning" || value === "error" ? value : "success";
  }
  function applyCustomUiTheme(theme) {
    for (const name of ["default", "modern", "crt", "amber", "matrix"]) {
      document.body.classList.toggle(`tauren-custom-ui-theme-${name}`, name === theme);
    }
  }
  function createToastIcon(kind) {
    const icon = document.createElement("span");
    icon.className = "tauren-toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = kind === "warning" ? "\u26A0" : kind === "error" ? "\u2715" : "\u2713";
    return icon;
  }
  function parseHostVoiceState(value) {
    const parsedState = parseWebviewStateMessage({ type: "state", voice: value }, state);
    return parsedState.voice;
  }
  function scheduleRender(options = {}) {
    pendingReturnToChatAfterRender ||= Boolean(options.returnToChatMain);
    if (pendingRenderFrame !== void 0) {
      return;
    }
    pendingRenderFrame = requestAnimationFrame(() => {
      pendingRenderFrame = void 0;
      const shouldHandleReturnToChat = pendingReturnToChatAfterRender;
      pendingReturnToChatAfterRender = false;
      renderWithInstrumentation();
      if (shouldHandleReturnToChat && state.lane === "chat") {
        messagesController.restoreChatScrollAfterReturn();
        focusPromptInput();
      }
    });
  }
  function suppressFaceTransitionForNextRender() {
    viewElement.classList.add("tauren-view--suppress-face-transition");
    if (faceTransitionSuppressionFrame !== void 0) {
      cancelAnimationFrame(faceTransitionSuppressionFrame);
    }
    faceTransitionSuppressionFrame = requestAnimationFrame(() => {
      faceTransitionSuppressionFrame = requestAnimationFrame(() => {
        faceTransitionSuppressionFrame = void 0;
        viewElement.classList.remove("tauren-view--suppress-face-transition");
      });
    });
  }
  function renderWithInstrumentation() {
    if (!renderInstrumentationEnabled) {
      measurePerfEvent("chat.render", render);
      return;
    }
    const started = performance.now();
    measurePerfEvent("chat.render", render);
    const duration = performance.now() - started;
    if (duration > 8) {
      console.debug(`[Tauren] render ${duration.toFixed(1)}ms`, {
        messages: state.messages.length,
        sessions: state.sessions.length,
        treeItems: state.treeItems.length,
        lane: state.lane
      });
    }
  }
  function measurePerfEvent(name, measure) {
    if (!state.perfEnabled) {
      measure();
      return;
    }
    const started = performance.now();
    measure();
    const durationMs = performance.now() - started;
    if (durationMs < perfEventThresholdMs) {
      return;
    }
    vscode.postMessage({
      type: "perfEvent",
      event: {
        name,
        durationMs,
        lane: state.lane,
        messageCount: state.messages.length,
        sessionCount: state.sessions.length,
        renderedMessageCount: messagesController.getRenderedMessageCount(),
        collapsedMessageCount: messagesController.getCollapsedMessageCount(),
        currentSessionFile: state.currentSessionFile,
        sessionLoading: state.sessionLoading,
        textareaLength: textarea.value.length,
        promptContextCount: state.promptContext.length,
        promptImageCount: state.promptImages.length,
        busy: state.busy
      }
    });
  }
  function measureRenderBoundary(name, renderBoundary) {
    if (!state.perfEnabled) {
      renderBoundary();
      return;
    }
    const started = performance.now();
    renderBoundary();
    const durationMs = performance.now() - started;
    if (durationMs < perfEventThresholdMs) {
      return;
    }
    vscode.postMessage({
      type: "perfEvent",
      event: {
        name,
        durationMs,
        lane: state.lane,
        messageCount: state.messages.length,
        sessionCount: state.sessions.length,
        visibleItemCount: name === "sessionList.render" ? sessionsController.getVisibleSessionCount() : void 0,
        renderedMessageCount: messagesController.getRenderedMessageCount(),
        collapsedMessageCount: messagesController.getCollapsedMessageCount(),
        currentSessionFile: state.currentSessionFile,
        sessionLoading: state.sessionLoading
      }
    });
  }
  function render() {
    const chatLaneLayout = getChatLaneLayout(state);
    const { isSessionLane, isSettingsFaceVisible } = chatLaneLayout;
    const shouldStickToBottom = !isSessionLane && !isSettingsFaceVisible && messagesController.shouldFollowOutput();
    viewElement.classList.toggle("tauren-view--session-lane", isSessionLane);
    viewElement.classList.toggle("tauren-view--lane-sessions", state.lane === "sessions");
    viewElement.classList.toggle("tauren-view--lane-tree", state.lane === "tree");
    viewElement.classList.toggle("tauren-view--lane-chat", !isSessionLane);
    viewElement.classList.toggle("tauren-view--chat-face-settings", isSettingsFaceVisible);
    viewElement.classList.toggle("tauren-view--extension-ui-font", !isExtensionMonospaceFontEnabled());
    messagesElement.hidden = false;
    sessionsElement.hidden = false;
    sessionTreeElement.hidden = false;
    messagesElement.setAttribute("aria-hidden", isSessionLane || isSettingsFaceVisible ? "true" : "false");
    sessionsElement.setAttribute("aria-hidden", state.lane === "sessions" ? "false" : "true");
    sessionTreeElement.setAttribute("aria-hidden", state.lane === "tree" ? "false" : "true");
    messagesElement.inert = isSessionLane || isSettingsFaceVisible;
    sessionsElement.inert = state.lane !== "sessions";
    sessionTreeElement.inert = state.lane !== "tree";
    sessionsElement.tabIndex = state.lane === "sessions" ? 0 : -1;
    sessionTreeElement.tabIndex = state.lane === "tree" ? 0 : -1;
    form.classList.toggle("composer--list-hidden", isSessionLane);
    form.setAttribute("aria-hidden", isSessionLane || isSettingsFaceVisible ? "true" : "false");
    form.inert = isSessionLane || isSettingsFaceVisible;
    syncExtensionWidgets(chatLaneLayout.hiddenBySurface, { reserveLayout: chatLaneLayout.reserveBottomSurfaceLayout });
    syncExtensionStatus(chatLaneLayout.hiddenBySurface, { reserveLayout: chatLaneLayout.reserveBottomSurfaceLayout });
    syncKwardQuestion(chatLaneLayout.hiddenBySurface || isSessionLane || isSettingsFaceVisible);
    sessionsController.syncForRender(isSessionLane);
    settingsController.syncForRender(isSessionLane);
    customUiController.syncForRender(isSessionLane || isSettingsFaceVisible);
    transcriptSearchController.syncForRender();
    if (isSettingsFaceVisible) {
      busyStatusElement.hidden = true;
      composerController.closeSlashMenu();
      composerController.closeModelMenu();
      sessionsController.closeSessionCommandMenu();
      sessionsController.cancelSessionNameEdit();
      return;
    }
    if (isSessionLane) {
      busyStatusElement.hidden = true;
      state.lane === "tree" ? measureRenderBoundary("tree.render", () => sessionsController.renderTree()) : measureRenderBoundary("sessionList.render", () => sessionsController.renderSessions());
      composerController.closeSlashMenu();
      composerController.closeModelMenu();
      sessionsController.closeSessionCommandMenu();
      sessionsController.cancelSessionNameEdit();
      if (!sessionsController.isSessionListNameEditing() && !sessionsController.isSessionSearchFocused()) {
        const activeSessionPane = state.lane === "tree" ? sessionTreeElement : sessionsElement;
        requestAnimationFrame(() => {
          if (document.hasFocus()) {
            activeSessionPane.focus({ preventScroll: true });
          }
        });
      }
      return;
    }
    measureRenderBoundary("transcript.render", () => messagesController.renderMessageList());
    transcriptSearchController.syncForRender();
    messagesController.syncBusyStatus();
    composerController.syncModelLabel();
    composerController.syncPromptContextBadges();
    if (!customUiController.isActive() && !extensionEditorDialogController.isActive()) {
      composerController.syncComposer();
    }
    composerController.syncSlashMenu();
    if (shouldStickToBottom) {
      messagesController.scheduleMessagesToBottom();
    }
  }
  function handleKwardQuestionGlobalKeydown(event) {
    if (event.key !== "Escape" || kwardQuestionElement.hidden || !state.kwardQuestion) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    cancelKwardQuestion(state.kwardQuestion);
    return true;
  }
  function syncKwardQuestion(hiddenBySurface) {
    const request = hiddenBySurface ? void 0 : state.kwardQuestion;
    if (!request) {
      kwardQuestionElement.hidden = true;
      kwardQuestionElement.replaceChildren();
      renderedKwardQuestionSignature = "";
      return;
    }
    const uiState = ensureKwardQuestionUiState(request);
    renderKwardQuestion(request, uiState);
  }
  function ensureKwardQuestionUiState(request) {
    const requestKey = getKwardQuestionRequestKey(request);
    const existing = kwardQuestionUiState;
    if (existing?.requestKey === requestKey && existing.selectedAnswers.length === request.questions.length && existing.customAnswers.length === request.questions.length) {
      existing.stepIndex = Math.min(existing.stepIndex, getKwardQuestionLastStepIndex(request));
      return existing;
    }
    const nextState = createKwardQuestionUiState(request);
    kwardQuestionUiState = nextState;
    renderedKwardQuestionSignature = "";
    return nextState;
  }
  function renderKwardQuestion(request, uiState) {
    const signature = getKwardQuestionRenderSignature(request, uiState);
    if (!kwardQuestionElement.hidden && renderedKwardQuestionSignature === signature) {
      return;
    }
    const previousActiveName = kwardQuestionElement.contains(document.activeElement) ? document.activeElement?.getAttribute("name") ?? void 0 : void 0;
    const focusQuestion = kwardQuestionElement.hidden || kwardQuestionElement.contains(document.activeElement);
    renderedKwardQuestionSignature = signature;
    kwardQuestionElement.hidden = false;
    kwardQuestionElement.setAttribute("aria-label", getKwardQuestionAriaLabel(request, uiState));
    const header = document.createElement("div");
    header.className = "kward-question__header";
    const title = document.createElement("div");
    title.className = "kward-question__title";
    title.textContent = getKwardQuestionTitle(request, uiState);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kward-question__close";
    close.setAttribute("aria-label", "Close Kward question");
    close.textContent = "\xD7";
    close.addEventListener("click", () => cancelKwardQuestion(request));
    header.append(title, close);
    const formElement = document.createElement("form");
    formElement.className = "kward-question__form";
    formElement.addEventListener("keydown", (event) => handleKwardQuestionKeydown(event, request, uiState));
    if (isKwardQuestionSummaryStep(request, uiState)) {
      formElement.append(createKwardQuestionSummary(request, uiState), createKwardQuestionActions(request, true));
    } else {
      const questionIndex = uiState.stepIndex;
      formElement.append(createKwardQuestionStep(request, uiState, questionIndex), createKwardQuestionActions(request, false));
    }
    formElement.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isKwardQuestionSummaryStep(request, uiState)) {
        uiState.stepIndex = Math.min(uiState.stepIndex + 1, getKwardQuestionLastStepIndex(request));
        rerenderKwardQuestion(request, { focus: true });
        return;
      }
      const submit = formElement.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
      }
      vscode.postMessage(getKwardQuestionAnswerMessage(request, uiState));
    });
    kwardQuestionElement.replaceChildren(header, formElement);
    if (focusQuestion) {
      focusKwardQuestionStep(isKwardQuestionSummaryStep(request, uiState) ? void 0 : previousActiveName);
    }
  }
  function createKwardQuestionStep(request, uiState, questionIndex) {
    const body = document.createElement("div");
    body.className = "kward-question__body";
    const question = request.questions[questionIndex];
    if (!question) {
      return body;
    }
    const progress = createKwardQuestionProgress(request, uiState);
    body.append(progress);
    const fieldset = document.createElement("fieldset");
    fieldset.className = "kward-question__fieldset";
    const legend = document.createElement("legend");
    legend.className = "kward-question__legend";
    legend.textContent = `${question.header}: ${question.question}`;
    fieldset.append(legend);
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "kward-question__option";
      label.dataset.kwardQuestionChoiceIndex = String(optionIndex);
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `kward-question-${questionIndex}`;
      input.value = option.label;
      input.checked = uiState.selectedAnswers[questionIndex] === option.label && !getKwardQuestionCustomAnswerForIndex(uiState, questionIndex);
      input.addEventListener("change", () => {
        uiState.selectedAnswers[questionIndex] = option.label;
        uiState.customAnswers[questionIndex] = "";
        const customInput = fieldset.querySelector(`input[name="kward-question-custom-${questionIndex}"]`);
        if (customInput) {
          customInput.value = "";
        }
      });
      const text = document.createElement("span");
      text.className = "kward-question__option-text";
      const optionLabel = document.createElement("span");
      optionLabel.className = "kward-question__option-label";
      optionLabel.textContent = option.label;
      const description = document.createElement("span");
      description.className = "kward-question__option-description";
      description.textContent = option.description;
      text.append(optionLabel, description);
      label.append(input, text);
      fieldset.append(label);
    });
    const customLabel = document.createElement("label");
    customLabel.className = "kward-question__custom-wrap";
    customLabel.dataset.kwardQuestionChoiceIndex = String(getKwardQuestionCustomChoiceIndex(request, questionIndex));
    const customRadio = document.createElement("input");
    customRadio.type = "radio";
    customRadio.name = `kward-question-${questionIndex}`;
    customRadio.value = "__custom__";
    customRadio.checked = Boolean(getKwardQuestionCustomAnswerForIndex(uiState, questionIndex));
    const customText = document.createElement("span");
    customText.className = "kward-question__option-label";
    customText.textContent = "Custom input";
    const custom = document.createElement("input");
    custom.className = "kward-question__custom";
    custom.type = "text";
    custom.name = `kward-question-custom-${questionIndex}`;
    custom.placeholder = "Custom answer\u2026";
    custom.value = uiState.customAnswers[questionIndex] ?? "";
    customRadio.addEventListener("change", () => {
      if (customRadio.checked) {
        requestAnimationFrame(() => custom.focus({ preventScroll: true }));
      }
    });
    custom.addEventListener("focus", () => {
      customRadio.checked = true;
    });
    custom.addEventListener("input", () => {
      uiState.customAnswers[questionIndex] = custom.value;
      customRadio.checked = true;
    });
    customLabel.append(customRadio, customText, custom);
    fieldset.append(customLabel);
    body.append(fieldset, createKwardQuestionHint());
    return body;
  }
  function createKwardQuestionSummary(request, uiState) {
    const body = document.createElement("div");
    body.className = "kward-question__body";
    body.append(createKwardQuestionProgress(request, uiState));
    const heading = document.createElement("div");
    heading.className = "kward-question__legend";
    heading.textContent = "Review your answers";
    const list = document.createElement("ol");
    list.className = "kward-question__summary";
    request.questions.forEach((question, index) => {
      const item = document.createElement("li");
      item.className = "kward-question__summary-item";
      const label = document.createElement("span");
      label.className = "kward-question__summary-question";
      label.textContent = `${question.header}: ${question.question}`;
      const selected = document.createElement("span");
      selected.className = "kward-question__summary-answer";
      selected.textContent = `Selected answer: ${getKwardQuestionSelectedAnswerForIndex(request, uiState, index) || "None"}`;
      item.append(label, selected);
      const customAnswer = getKwardQuestionCustomAnswerForIndex(uiState, index);
      if (customAnswer) {
        const custom = document.createElement("span");
        custom.className = "kward-question__summary-custom";
        custom.textContent = `Custom answer: ${customAnswer}`;
        item.append(custom);
      }
      list.append(item);
    });
    body.append(heading, list, createKwardQuestionHint());
    return body;
  }
  function createKwardQuestionProgress(request, uiState) {
    const progress = document.createElement("div");
    progress.className = "kward-question__progress";
    progress.setAttribute("aria-label", "Question steps");
    const totalSteps = getKwardQuestionLastStepIndex(request) + 1;
    for (let index = 0; index < totalSteps; index += 1) {
      const step = document.createElement("button");
      step.type = "button";
      step.className = "kward-question__progress-step";
      step.classList.toggle("kward-question__progress-step--active", index === uiState.stepIndex);
      step.classList.toggle("kward-question__progress-step--answered", index < request.questions.length && Boolean(getKwardQuestionAnswerForIndex(request, uiState, index)));
      step.setAttribute("aria-current", index === uiState.stepIndex ? "step" : "false");
      step.dataset.kwardQuestionStepIndex = String(index);
      step.textContent = index === request.questions.length ? "Review" : String(index + 1);
      step.addEventListener("click", () => openKwardQuestionStep(request, uiState, index, { focusProgress: true }));
      progress.append(step);
    }
    return progress;
  }
  function createKwardQuestionActions(request, includeSubmit) {
    const actions = document.createElement("div");
    actions.className = "kward-question__actions";
    if (includeSubmit) {
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "C3PO-arm";
      submit.textContent = request.questions.length > 1 ? "Send answers" : "Send answer";
      actions.append(submit);
    }
    if (request.questions.length > 1 && !includeSubmit) {
      const spacer = document.createElement("span");
      spacer.className = "kward-question__actions-hint";
      spacer.textContent = "Press Enter to continue";
      actions.prepend(spacer);
    }
    return actions;
  }
  function createKwardQuestionHint() {
    const hint = document.createElement("div");
    hint.className = "kward-question__hint";
    hint.textContent = "Press Enter to continue. Tab to move through choices and custom answer. Focus step indicators to use \u2190 and \u2192.";
    return hint;
  }
  function handleKwardQuestionKeydown(event, request, uiState) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelKwardQuestion(request);
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !isKwardQuestionSummaryStep(request, uiState)) {
      event.preventDefault();
      event.stopPropagation();
      moveKwardQuestionChoice(request, uiState, event.key === "ArrowDown" ? 1 : -1, event.target);
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && isKwardQuestionProgressStep(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      moveKwardQuestionProgressFocus(request, event.target, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && isKwardQuestionProgressStep(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      openKwardQuestionStep(request, uiState, getKwardQuestionProgressStepIndex(event.target), { focusProgress: true });
      return;
    }
    if (event.key === "Enter" && !isKwardQuestionCloseButton(event.target)) {
      const submit = kwardQuestionElement.querySelector('button[type="submit"]');
      if (isKwardQuestionSummaryStep(request, uiState) && submit) {
        event.preventDefault();
        event.stopPropagation();
        submit.click();
        return;
      }
      if (!isKwardQuestionSummaryStep(request, uiState)) {
        event.preventDefault();
        event.stopPropagation();
        openKwardQuestionStep(request, uiState, Math.min(uiState.stepIndex + 1, getKwardQuestionLastStepIndex(request)), { focus: true });
        return;
      }
    }
  }
  function moveKwardQuestionChoice(request, uiState, delta, target) {
    const questionIndex = uiState.stepIndex;
    const choiceIndex = getKwardQuestionChoiceIndexFromTarget(target) ?? getKwardQuestionCurrentChoiceIndex(request, uiState, questionIndex);
    const focusTarget = getKwardQuestionNextVerticalFocusTarget(request, questionIndex, choiceIndex, delta);
    if (focusTarget.kind === "progress") {
      focusKwardQuestionStep(void 0, uiState.stepIndex);
      return;
    }
    focusKwardQuestionChoice(request, uiState, questionIndex, focusTarget.choiceIndex);
  }
  function getKwardQuestionCurrentChoiceIndex(request, uiState, questionIndex) {
    if (getKwardQuestionCustomAnswerForIndex(uiState, questionIndex)) {
      return getKwardQuestionCustomChoiceIndex(request, questionIndex);
    }
    const selectedIndex = request.questions[questionIndex]?.options.findIndex((option) => option.label === uiState.selectedAnswers[questionIndex]) ?? -1;
    return selectedIndex >= 0 ? selectedIndex : 0;
  }
  function focusKwardQuestionChoice(request, uiState, questionIndex, choiceIndex) {
    const customIndex = getKwardQuestionCustomChoiceIndex(request, questionIndex);
    if (choiceIndex >= customIndex) {
      requestAnimationFrame(() => kwardQuestionElement.querySelector(`input[name="kward-question-custom-${questionIndex}"]`)?.focus({ preventScroll: true }));
      return;
    }
    const option = request.questions[questionIndex]?.options[choiceIndex];
    if (option) {
      uiState.selectedAnswers[questionIndex] = option.label;
      uiState.customAnswers[questionIndex] = "";
      rerenderKwardQuestion(request, { focusChoiceIndex: choiceIndex });
    }
  }
  function moveKwardQuestionProgressFocus(request, target, delta) {
    const nextIndex = getKwardQuestionNextProgressFocusIndex(request, getKwardQuestionProgressStepIndex(target), delta);
    focusKwardQuestionStep(void 0, nextIndex);
  }
  function openKwardQuestionStep(request, uiState, stepIndex, options = {}) {
    uiState.stepIndex = Math.max(0, Math.min(stepIndex, getKwardQuestionLastStepIndex(request)));
    rerenderKwardQuestion(request, { focus: options.focus, focusProgressIndex: options.focusProgress ? uiState.stepIndex : void 0 });
  }
  function rerenderKwardQuestion(request, options = {}) {
    renderedKwardQuestionSignature = "";
    renderKwardQuestion(request, ensureKwardQuestionUiState(request));
    if (options.focus || options.focusProgressIndex !== void 0 || options.focusChoiceIndex !== void 0) {
      focusKwardQuestionStep(void 0, options.focusProgressIndex, options.focusChoiceIndex);
    }
  }
  function focusKwardQuestionStep(previousActiveName, progressIndex, choiceIndex) {
    requestAnimationFrame(() => {
      const preferred = previousActiveName ? kwardQuestionElement.querySelector(`[name="${cssEscape(previousActiveName)}"]`) : void 0;
      const progressTarget = progressIndex !== void 0 ? kwardQuestionElement.querySelectorAll(".kward-question__progress-step")[progressIndex] : void 0;
      const choiceTarget = choiceIndex !== void 0 ? kwardQuestionElement.querySelector(`[data-kward-question-choice-index="${choiceIndex}"] input`) : void 0;
      const focusTarget = preferred ?? progressTarget ?? choiceTarget ?? kwardQuestionElement.querySelector('button[type="submit"]') ?? kwardQuestionElement.querySelector('input[type="radio"]:checked') ?? kwardQuestionElement;
      focusTarget.focus({ preventScroll: true });
    });
  }
  function cancelKwardQuestion(request) {
    vscode.postMessage({ type: "kwardQuestionCancel", sessionId: request.sessionId, questionRequestId: request.questionRequestId });
  }
  function isKwardQuestionProgressStep(target) {
    return target instanceof HTMLElement && target.classList.contains("kward-question__progress-step");
  }
  function getKwardQuestionProgressStepIndex(target) {
    if (!(target instanceof HTMLElement)) {
      return 0;
    }
    const stepIndex = Number(target.dataset.kwardQuestionStepIndex);
    return Number.isInteger(stepIndex) ? stepIndex : 0;
  }
  function getKwardQuestionChoiceIndexFromTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return void 0;
    }
    const choiceElement = target.closest("[data-kward-question-choice-index]");
    const choiceIndex = Number(choiceElement?.dataset.kwardQuestionChoiceIndex);
    return Number.isInteger(choiceIndex) ? choiceIndex : void 0;
  }
  function isKwardQuestionCloseButton(target) {
    return target instanceof HTMLElement && target.classList.contains("kward-question__close");
  }
  function syncExtensionWidgets(hiddenBySurface, options = {}) {
    const reserveLayout = Boolean(options.reserveLayout);
    const collapseLayout = hiddenBySurface && !reserveLayout;
    const aboveWidgets = collapseLayout || !areExtensionAboveWidgetsEnabled() ? [] : state.extensionWidgets.filter((widget) => widget.placement === "aboveEditor");
    const belowWidgets = collapseLayout || !areExtensionBelowWidgetsEnabled() ? [] : state.extensionWidgets.filter((widget) => widget.placement === "belowEditor");
    const placeBusySubmitOnTopWidget = (!hiddenBySurface || reserveLayout) && aboveWidgets.length > 0;
    const activeKeys = new Set([...aboveWidgets, ...belowWidgets].map((widget) => widget.key));
    for (const key of widgetDimensionSignatures.keys()) {
      if (!activeKeys.has(key)) {
        widgetDimensionSignatures.delete(key);
      }
    }
    const renderPlaceholderWidgets = provisionalExtensionUiSnapshot?.widgetsPending === true;
    const widgetRenderOptions = { hiddenFromAccessibility: hiddenBySurface, postDimensions: !hiddenBySurface };
    renderExtensionWidgetContainer(extensionWidgetsAboveElement, aboveWidgets, placeBusySubmitOnTopWidget ? busySubmitElement : void 0, renderPlaceholderWidgets, widgetRenderOptions);
    renderExtensionWidgetContainer(extensionWidgetsBelowElement, belowWidgets, void 0, renderPlaceholderWidgets, widgetRenderOptions);
    syncBusySubmitPlacement(placeBusySubmitOnTopWidget);
    extensionWidgetsAboveElement.classList.toggle("extension-widgets--with-busy", placeBusySubmitOnTopWidget);
    viewElement.classList.toggle("tauren-view--has-extension-widgets-above", aboveWidgets.length > 0);
    viewElement.classList.toggle("tauren-view--has-extension-widgets-below", belowWidgets.length > 0);
  }
  function renderExtensionWidgetContainer(container, widgets, leadingElement, placeholderWidgets = false, options = {}) {
    const hasContent = widgets.length > 0 || Boolean(leadingElement);
    const hiddenFromAccessibility = Boolean(options.hiddenFromAccessibility);
    container.hidden = !hasContent;
    container.inert = hiddenFromAccessibility;
    container.setAttribute("aria-hidden", hasContent && !hiddenFromAccessibility ? "false" : "true");
    if (!hasContent) {
      container.replaceChildren();
      return;
    }
    const fragment = document.createDocumentFragment();
    if (leadingElement) {
      fragment.append(leadingElement);
    }
    for (const widget of widgets) {
      const element = document.createElement("article");
      element.className = "extension-widget";
      element.classList.toggle("extension-widget--placeholder", placeholderWidgets);
      element.dataset.widgetKey = widget.key;
      element.setAttribute("aria-label", `Pi extension widget ${widget.key}`);
      const blocks = normalizeExtensionRenderBlocks(widget.blocks, widget.lines);
      const textLines = blocks.length === 1 && blocks[0]?.type === "text" ? blocks[0].lines : [];
      const prepared = prepareCustomUiLines(textLines);
      const backgroundColorsEnabled = areExtensionBackgroundColorsEnabled();
      const widgetBackground = getAnsiFullWidgetBackground(prepared.lines, backgroundColorsEnabled && state.outputColors);
      if (widgetBackground) {
        element.classList.add("extension-widget--ansi-background");
        element.style.backgroundColor = widgetBackground;
        element.style.borderColor = widgetBackground;
      }
      for (const block of blocks) {
        if (block.type === "image") {
          element.append(createExtensionImageElement(block));
          continue;
        }
        for (const line of prepareCustomUiLines(block.lines).lines) {
          const lineElement = document.createElement("div");
          lineElement.className = "extension-widget__line";
          const background = backgroundColorsEnabled ? getAnsiLineBackground(line, state.outputColors) : void 0;
          if (background) {
            lineElement.classList.add("extension-widget__line--ansi-background");
            lineElement.style.backgroundColor = background;
          }
          if (isAnsiBlockImageLine(line)) {
            lineElement.classList.add("extension-widget__line--ansi-image");
            if (renderAnsiBlockImageLineInto(lineElement, line, state.outputColors)) {
              element.append(lineElement);
              continue;
            }
          }
          renderAnsiTextInto(lineElement, line, state.outputColors, { suppressBackgrounds: !backgroundColorsEnabled });
          renderAnsiSpinnersInto(lineElement, state.animationsEnabled);
          element.append(lineElement);
        }
      }
      fragment.append(element);
    }
    container.replaceChildren(fragment);
    if (!placeholderWidgets && options.postDimensions !== false) {
      scheduleExtensionWidgetDimensionsPost(container, widgets);
    }
  }
  function syncBusySubmitPlacement(aboveWidgets) {
    widgetBusySlotElement.hidden = true;
    if (aboveWidgets) {
      return;
    }
    if (busySubmitElement.parentElement !== form) {
      busySubmitHomeMarker.parentNode?.insertBefore(busySubmitElement, busySubmitHomeMarker);
    }
  }
  function scheduleExtensionWidgetDimensionsPost(container, widgets) {
    requestAnimationFrame(() => {
      for (const widget of widgets) {
        const element = container.querySelector(`.extension-widget[data-widget-key="${cssEscape(widget.key)}"]`);
        if (!element) {
          continue;
        }
        const dimensions = measureExtensionWidgetDimensions(element);
        const signature = `${dimensions.columns}x${dimensions.rows}@${dimensions.cellWidthPx}x${dimensions.cellHeightPx}`;
        const signatureKey = widget.key;
        if (widgetDimensionSignatures.get(signatureKey) === signature) {
          continue;
        }
        widgetDimensionSignatures.set(signatureKey, signature);
        vscode.postMessage({
          type: "extensionWidgetDimensions",
          key: widget.key,
          columns: dimensions.columns,
          rows: dimensions.rows,
          cellWidthPx: dimensions.cellWidthPx,
          cellHeightPx: dimensions.cellHeightPx
        });
      }
    });
  }
  function measureExtensionWidgetDimensions(element) {
    const style = window.getComputedStyle(element);
    const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let charWidth = 8;
    if (context) {
      context.font = font;
      charWidth = Math.max(1, context.measureText("M").width);
    }
    const fontSize = Number.parseFloat(style.fontSize) || 12;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.35 || 18;
    const rect = element.getBoundingClientRect();
    const contentWidth = Math.max(0, rect.width - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0));
    const contentHeight = Math.max(lineHeight, rect.height - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0));
    const columns = Math.max(20, Math.floor(contentWidth / charWidth));
    const rows = Math.max(1, Math.min(80, Math.floor(contentHeight / lineHeight)));
    return {
      columns,
      rows,
      cellWidthPx: roundDevicePixelMetric(charWidth),
      cellHeightPx: roundDevicePixelMetric(lineHeight)
    };
  }
  function cssEscape(value) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function areExtensionAboveWidgetsEnabled() {
    return state.settings.values["tauren.extensions.aboveWidgetsEnabled"] !== false;
  }
  function areExtensionBelowWidgetsEnabled() {
    return state.settings.values["tauren.extensions.belowWidgetsEnabled"] !== false;
  }
  function areExtensionStatusBarEnabled() {
    return state.settings.values["tauren.extensions.statusBarEnabled"] !== false;
  }
  function areExtensionBackgroundColorsEnabled() {
    return state.settings.values["tauren.extensions.backgroundColorsEnabled"] !== false;
  }
  function isExtensionMonospaceFontEnabled() {
    return state.settings.values["tauren.extensions.monospaceFontEnabled"] === true;
  }
  function syncExtensionStatus(hiddenBySurface, options = {}) {
    const statusEnabled = areExtensionStatusBarEnabled();
    const reserveLayout = Boolean(options.reserveLayout);
    const placeholderFooter = provisionalExtensionUiSnapshot?.footerPending === true;
    const footerLine = statusEnabled ? state.extensionFooter?.line : void 0;
    const text = statusEnabled && !placeholderFooter ? footerLine !== void 0 ? footerLine : state.extensionStatus.map((entry) => entry.text.trim()).filter(Boolean).join("  \u2022  ") : "";
    const hasStatusContent = placeholderFooter || footerLine !== void 0 || text.length > 0;
    const hasStatusSlot = statusEnabled && hasStatusContent && (!hiddenBySurface || reserveLayout);
    const hasAccessibleText = !hiddenBySurface && text.length > 0 && !placeholderFooter;
    composerStatusTextElement.replaceChildren();
    renderAnsiTextInto(composerStatusTextElement, text, state.outputColors, { suppressBackgrounds: true });
    renderAnsiSpinnersInto(composerStatusTextElement, state.animationsEnabled);
    composerStatusElement.hidden = !hasStatusSlot;
    composerStatusElement.inert = hiddenBySurface;
    composerStatusElement.setAttribute("aria-hidden", hasAccessibleText ? "false" : "true");
    viewElement.classList.toggle("tauren-view--has-extension-status", hasStatusSlot);
    if (hasStatusSlot && hasAccessibleText && footerLine !== void 0) {
      scheduleExtensionFooterDimensionsPost();
    } else {
      footerDimensionSignature = "";
    }
  }
  function scheduleExtensionFooterDimensionsPost() {
    requestAnimationFrame(() => {
      if (composerStatusElement.hidden || state.extensionFooter === void 0) {
        footerDimensionSignature = "";
        return;
      }
      const dimensions = measureExtensionWidgetDimensions(composerStatusElement);
      const signature = [dimensions.columns, dimensions.rows, dimensions.cellWidthPx, dimensions.cellHeightPx].join(":");
      if (signature === footerDimensionSignature) {
        return;
      }
      footerDimensionSignature = signature;
      vscode.postMessage({
        type: "extensionFooterDimensions",
        columns: dimensions.columns,
        rows: dimensions.rows,
        cellWidthPx: dimensions.cellWidthPx,
        cellHeightPx: dimensions.cellHeightPx
      });
    });
  }
  function toggleHelpOverlay() {
    if (hasHelpOverlayOpen()) {
      closeHelpOverlay();
      return;
    }
    openHelpOverlay();
  }
  function openHelpOverlay() {
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    sessionsController.closeSessionItemMenus();
    helpOverlayElement.hidden = false;
    requestAnimationFrame(() => helpOverlayElement.focus({ preventScroll: true }));
  }
  function closeHelpOverlay() {
    helpOverlayElement.hidden = true;
  }
  function parsePaneScrollCommand(value) {
    if (!isRecord(value)) {
      return void 0;
    }
    const direction = value.direction === "up" || value.direction === "down" ? value.direction : void 0;
    const amount = value.amount === "page" || value.amount === "line" || value.amount === "edge" ? value.amount : void 0;
    return direction && amount ? { direction, amount } : void 0;
  }
  function handlePaneScrollShortcut(event) {
    const command = getPaneScrollCommandForEvent(event);
    if (!command) {
      return false;
    }
    const target = eventTargetElement(event);
    if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
      return false;
    }
    if (target instanceof HTMLTextAreaElement && target !== textarea) {
      return false;
    }
    if (target === textarea && shouldPreserveComposerTextNavigation(event)) {
      return false;
    }
    if (!scrollActivePane(command)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  function getPaneScrollCommandForEvent(event) {
    if (event.shiftKey) {
      return void 0;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      const direction = event.key === "PageUp" ? "up" : "down";
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        return { direction, amount: "page" };
      }
      if (isMacPlatform) {
        return event.metaKey && !event.ctrlKey && !event.altKey ? { direction, amount: "page" } : void 0;
      }
      return event.altKey && !event.ctrlKey && !event.metaKey ? { direction, amount: "page" } : void 0;
    }
    if (!isMacPlatform && (event.key === "Home" || event.key === "End")) {
      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        return { direction: event.key === "Home" ? "up" : "down", amount: "edge" };
      }
    }
    if (isMacPlatform && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        return { direction: event.key === "ArrowUp" ? "up" : "down", amount: "edge" };
      }
    }
    return void 0;
  }
  function shouldPreserveComposerTextNavigation(event) {
    return event.key === "Home" || event.key === "End" || event.key === "ArrowUp" || event.key === "ArrowDown";
  }
  function scrollActivePane(command) {
    const element = getActiveScrollElement();
    if (!element) {
      return false;
    }
    if (command.amount === "edge") {
      scrollElementToEdge(element, command.direction);
      return true;
    }
    const multiplier = command.direction === "up" ? -1 : 1;
    const amount = command.amount === "line" ? getLineScrollAmount(element) : Math.max(80, Math.floor(element.clientHeight * 0.85));
    element.scrollBy({ top: multiplier * amount, behavior: "auto" });
    afterScrollElement(element);
    return true;
  }
  function getActiveScrollElement() {
    if (hasHelpOverlayOpen() || customUiController.isActive() || extensionEditorDialogController.isActive()) {
      return void 0;
    }
    if (state.lane === "sessions") {
      return sessionsElement;
    }
    if (state.lane === "tree") {
      return sessionTreeElement;
    }
    if (state.chatFace === "settings") {
      return settingsBodyElement.querySelector(".settings-surface__panel") ?? settingsBodyElement;
    }
    return messagesElement;
  }
  function scrollElementToEdge(element, direction) {
    if (element === messagesElement) {
      direction === "up" ? messagesController.scrollMessagesToTop() : messagesController.scrollMessagesToBottom();
      return;
    }
    element.scrollTop = direction === "up" ? 0 : element.scrollHeight;
    afterScrollElement(element);
  }
  function afterScrollElement(element) {
    if (element === messagesElement) {
      messagesController.handleMessagesScroll();
    }
  }
  function getLineScrollAmount(element) {
    return parseCssPixelValue(getComputedStyle(element).lineHeight) || 20;
  }
  function handleToolDetailShortcut(event) {
    if (state.lane !== "chat" || state.chatFace === "settings" || event.key.toLowerCase() !== "o") {
      return false;
    }
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const expanded = messagesController.toggleToolActivityDetail();
    if (expanded !== void 0) {
      toolsExpanded = expanded;
    }
    const data = terminalDataForKeyboardEvent(event);
    if (data) {
      vscode.postMessage({ type: "extensionTerminalInput", data });
    }
    if (expanded !== void 0) {
      vscode.postMessage({ type: "setToolsExpanded", expanded: toolsExpanded });
    }
    return true;
  }
  function handleHelpWindowClick(target) {
    if (hasHelpOverlayOpen() && (!target || !helpOverlayElement.contains(target))) {
      closeHelpOverlay();
    }
  }
  function handleHelpEscape(event) {
    if (!hasHelpOverlayOpen()) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    closeHelpOverlay();
    return true;
  }
  function hasHelpOverlayOpen() {
    return !helpOverlayElement.hidden;
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
    if (composerController.handlePromptEscape()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (state.lane === "chat") {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "showLane", lane: "sessions" });
      return true;
    }
    return false;
  }
  function startNewSession() {
    sessionsController.cancelSessionNameEdit();
    applyOptimisticNewSessionTransition();
    vscode.postMessage({ type: "newSession" });
    focusPromptInput();
  }
  function applyOptimisticNewSessionTransition() {
    const wasSessionLane = state.lane === "sessions" || state.lane === "tree";
    provisionalExtensionUiSnapshot = createProvisionalExtensionUiSnapshot(state);
    state = createOptimisticNewSessionState(state);
    suppressFaceTransitionForNextRender();
    scheduleRender({ returnToChatMain: wasSessionLane });
  }
  function clearProvisionalExtensionUiIfSettled() {
    if (hasPendingProvisionalExtensionUi(provisionalExtensionUiSnapshot)) {
      return;
    }
    provisionalExtensionUiSnapshot = void 0;
  }
  function handleCustomUiClose() {
    if (state.lane !== "chat") {
      return;
    }
    requestAnimationFrame(() => {
      if (state.lane === "chat" && !customUiController.isActive() && !extensionPromptController.isActive()) {
        textarea.focus({ preventScroll: true });
      }
    });
  }
  function focusPromptInput() {
    requestAnimationFrame(() => {
      if (extensionPromptController.isActive()) {
        return;
      }
      if (customUiController.focusInput()) {
        return;
      }
      textarea.focus({ preventScroll: true });
    });
  }
  function eventTargetNode(event) {
    return event.target instanceof Node ? event.target : null;
  }
  var webviewFocusState = false;
  function postFocusChanged(focused) {
    if (webviewFocusState === focused) {
      return;
    }
    webviewFocusState = focused;
    vscode.postMessage({ type: "focusChanged", focused });
  }
  document.addEventListener("focusin", () => postFocusChanged(true));
  window.addEventListener("focus", handleWindowFocus);
  window.addEventListener("blur", () => postFocusChanged(false));
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!document.hasFocus()) {
        postFocusChanged(false);
      }
    }, 0);
  });
  function handleWindowFocus() {
    postFocusChanged(true);
    focusPromptInputIfNothingFocused();
  }
  function focusPromptInputIfNothingFocused() {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement === document.body || activeElement === document.documentElement) {
        focusPromptInput();
      }
    });
  }
  vscode.postMessage({ type: "ready" });
  postFocusChanged(document.hasFocus());
  renderWithInstrumentation();
})();
