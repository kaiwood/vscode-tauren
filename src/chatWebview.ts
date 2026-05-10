import type { ChatState } from './chatSession';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'newSession' }
  | { type: 'refreshMetadata' }
  | { type: 'submit'; text: string }
  | { type: 'setModel'; provider: string; modelId: string }
  | { type: 'setThinkingLevel'; level: string }
  | { type: 'unknown' };

export function parseWebviewMessage(value: unknown): WebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { type: 'unknown' };
  }

  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'newSession':
      return { type: 'newSession' };
    case 'refreshMetadata':
      return { type: 'refreshMetadata' };
    case 'submit':
      return typeof value.text === 'string'
        ? { type: 'submit', text: value.text }
        : { type: 'unknown' };
    case 'setModel':
      return typeof value.provider === 'string' && typeof value.modelId === 'string'
        ? { type: 'setModel', provider: value.provider, modelId: value.modelId }
        : { type: 'unknown' };
    case 'setThinkingLevel':
      return typeof value.level === 'string'
        ? { type: 'setThinkingLevel', level: value.level }
        : { type: 'unknown' };
    default:
      return { type: 'unknown' };
  }
}

export type WebviewModelOption = {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
};

export type WebviewStateMessage = ChatState & {
  type: 'state';
  modelLabel: string;
  modelProvider: string;
  modelId: string;
  modelReasoning: boolean;
  thinkingLevel: string;
  modelOptions: WebviewModelOption[];
  contextUsageLabel: string;
  contextUsageTitle: string;
  contextUsageLevel: string;
};

export function createWebviewStateMessage(
  state: ChatState,
  modelLabel = '',
  contextUsageLabel = '',
  contextUsageTitle = '',
  contextUsageLevel = '',
  modelProvider = '',
  modelId = '',
  modelReasoning = false,
  thinkingLevel = '',
  modelOptions: WebviewModelOption[] = []
): WebviewStateMessage {
  return {
    type: 'state',
    messages: state.messages,
    busy: state.busy,
    modelLabel,
    modelProvider,
    modelId,
    modelReasoning,
    thinkingLevel,
    modelOptions,
    contextUsageLabel,
    contextUsageTitle,
    contextUsageLevel
  };
}

export type WebviewScriptUris = {
  markdownItScriptUri: string;
  domPurifyScriptUri: string;
  highlightScriptUri: string;
};

export function createWebviewHtml(scriptUris: WebviewScriptUris): string {
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Pi</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      height: 100%;
    }

    body {
      margin: 0;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .pi-view {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto auto;
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    .messages {
      min-height: 0;
      padding: 12px 12px calc(8px + 2lh);
      overflow-y: auto;
    }

    .empty-state {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .message {
      margin: 0 0 14px;
    }

    .message:last-child {
      margin-bottom: 0;
    }

    .message__role {
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .message__body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }

    .message__body--markdown {
      white-space: normal;
    }

    .message__body--markdown > :first-child {
      margin-top: 0;
    }

    .message__body--markdown > :last-child {
      margin-bottom: 0;
    }

    .message__body--markdown p,
    .message__body--markdown ul,
    .message__body--markdown ol,
    .message__body--markdown blockquote,
    .message__body--markdown pre,
    .message__body--markdown table {
      margin: 0 0 8px;
    }

    .message__body--markdown ul,
    .message__body--markdown ol {
      padding-left: 20px;
    }

    .message__body--markdown li + li {
      margin-top: 3px;
    }

    .message__body--markdown code {
      padding: 1px 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      border-radius: 3px;
    }

    .message__body--markdown pre {
      max-width: 100%;
      padding: 8px;
      overflow: auto;
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      border-radius: 6px;
      white-space: pre;
    }

    .message__body--markdown pre code {
      padding: 0;
      background: transparent;
      border-radius: 0;
    }

    .message__body--markdown .hljs-comment,
    .message__body--markdown .hljs-quote {
      color: var(--vscode-descriptionForeground);
    }

    .message__body--markdown .hljs-keyword,
    .message__body--markdown .hljs-selector-tag,
    .message__body--markdown .hljs-subst {
      color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
    }

    .message__body--markdown .hljs-literal,
    .message__body--markdown .hljs-number,
    .message__body--markdown .hljs-doctag {
      color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
    }

    .message__body--markdown .hljs-string,
    .message__body--markdown .hljs-regexp,
    .message__body--markdown .hljs-addition {
      color: var(--vscode-symbolIcon-stringForeground, #ce9178);
    }

    .message__body--markdown .hljs-title,
    .message__body--markdown .hljs-section,
    .message__body--markdown .hljs-selector-id {
      color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
    }

    .message__body--markdown .hljs-class .hljs-title,
    .message__body--markdown .hljs-type,
    .message__body--markdown .hljs-built_in {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
    }

    .message__body--markdown .hljs-attr,
    .message__body--markdown .hljs-variable,
    .message__body--markdown .hljs-template-variable,
    .message__body--markdown .hljs-attribute {
      color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
    }

    .message__body--markdown .hljs-deletion,
    .message__body--markdown .hljs-meta {
      color: var(--vscode-errorForeground, #f44747);
    }

    .message__body--markdown .hljs-emphasis {
      font-style: italic;
    }

    .message__body--markdown .hljs-strong {
      font-weight: 600;
    }

    .message__body--markdown blockquote {
      padding-left: 9px;
      color: var(--vscode-descriptionForeground);
      border-left: 2px solid color-mix(in srgb, var(--vscode-foreground) 25%, transparent);
    }

    .message__body--markdown table {
      display: block;
      max-width: 100%;
      overflow: auto;
      border-collapse: collapse;
    }

    .message__body--markdown th,
    .message__body--markdown td {
      padding: 4px 6px;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
    }

    .message__body--markdown a {
      color: var(--vscode-textLink-foreground);
    }

    .message__body--after-activities {
      margin-top: 8px;
    }

    .message--user .message__body {
      color: var(--vscode-input-foreground);
    }

    .message--error .message__body {
      color: var(--vscode-errorForeground);
    }

    .activity-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }

    .activity {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, var(--vscode-foreground) 14%);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
      border-radius: 6px;
    }

    .activity--running {
      border-color: color-mix(in srgb, var(--vscode-progressBar-background, var(--vscode-focusBorder)) 58%, var(--vscode-foreground) 18%);
    }

    .activity--error {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 70%, transparent);
    }

    .activity__summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 8px;
      padding: 6px 8px;
      cursor: pointer;
      list-style: none;
    }

    .activity__summary::-webkit-details-marker {
      display: none;
    }

    .activity__title {
      min-width: 0;
      overflow: hidden;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .activity__status {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    .activity__description {
      grid-column: 1 / -1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.35;
    }

    .activity__body {
      max-height: 260px;
      margin: 0;
      padding: 7px 8px 8px;
      overflow: auto;
      color: var(--vscode-foreground);
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }

    .activity__body--code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }

    .activity__body--markdown {
      white-space: normal;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status__spinner {
      width: 10px;
      height: 10px;
      flex: 0 0 auto;
      border: 1.5px solid color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent);
      border-top-color: #ffffff;
      border-radius: 999px;
      animation: pi-spin 0.8s linear infinite;
    }

    @keyframes pi-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .composer {
      position: relative;
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) 36px;
      grid-template-rows: minmax(22px, auto) 36px;
      align-items: end;
      gap: 4px 8px;
      min-height: 84px;
      max-height: calc(100vh - 16px);
      margin: 0 8px 8px;
      padding: 14px 9px 8px;
      overflow: visible;
      background: #303030;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 21px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .composer__input {
      grid-column: 1 / -1;
      align-self: start;
      width: 100%;
      height: auto;
      min-height: 22px;
      max-height: 180px;
      resize: none;
      overflow-y: hidden;
      padding: 0 6px 4px;
      color: var(--vscode-input-foreground);
      caret-color: var(--vscode-input-foreground);
      background: transparent;
      border: 0;
      font: inherit;
      line-height: 1.4;
    }

    .composer__input:focus {
      outline: none;
    }

    .composer__button {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .composer__button:hover:not(:disabled) {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .composer__button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .composer__button svg {
      display: block;
    }

    .composer__info {
      justify-self: end;
      display: flex;
      align-items: baseline;
      gap: 14px;
      padding: 0 2px 8px 0;
      min-width: 0;
      overflow: visible;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      line-height: 1;
      white-space: nowrap;
    }

    .composer__context {
      position: relative;
      flex: 0 0 auto;
      font-size: 11px;
      font-weight: 600;
    }

    .composer__context--low {
      color: var(--vscode-testing-iconPassed, #73c991);
    }

    .composer__context--medium {
      color: var(--vscode-testing-iconQueued, #cca700);
    }

    .composer__context--high {
      color: var(--vscode-testing-iconFailed, #f14c4c);
    }

    .composer__context-tooltip {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 1;
      display: none;
      width: max-content;
      max-width: min(260px, 70vw);
      padding: 7px 9px;
      color: var(--vscode-editorHoverWidget-foreground);
      background: var(--vscode-editorHoverWidget-background);
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.35;
      white-space: pre-line;
    }

    .composer__context:hover .composer__context-tooltip,
    .composer__context:focus-within .composer__context-tooltip {
      display: block;
    }

    .composer__model {
      min-width: 0;
      max-width: 100%;
      padding: 0;
      overflow: hidden;
      color: inherit;
      background: transparent;
      border: 0;
      font: inherit;
      text-align: left;
      text-overflow: ellipsis;
      cursor: pointer;
    }

    .composer__model:hover:not(:disabled),
    .composer__model:focus-visible {
      color: var(--vscode-foreground);
      outline: none;
    }

    .composer__model-menu {
      position: absolute;
      right: 46px;
      bottom: 44px;
      z-index: 2;
      display: none;
      width: min(320px, calc(100vw - 24px));
      padding: 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 8px;
      box-shadow: 0 4px 16px color-mix(in srgb, #000 38%, transparent);
      font-size: 12px;
      line-height: 1.35;
    }

    .composer__model-menu[open] {
      display: grid;
      gap: 8px;
    }

    .composer__field {
      display: grid;
      gap: 4px;
    }

    .composer__field label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
    }

    .composer__select {
      width: 100%;
      min-width: 0;
      padding: 4px 6px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 3px;
      font: inherit;
    }

    .composer__select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .composer__submit {
      justify-self: end;
      width: 34px;
      height: 34px;
      color: var(--vscode-input-background);
      background: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 82%, transparent);
    }

    .composer__submit:hover:not(:disabled) {
      background: var(--vscode-foreground);
    }

    .composer__submit:disabled {
      color: color-mix(in srgb, var(--vscode-input-background) 72%, var(--vscode-foreground) 28%);
      background: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 48%, transparent);
      cursor: default;
    }
  </style>
</head>
<body>
  <main class="pi-view">
    <section class="messages" aria-live="polite" aria-label="Pi conversation">
      <p class="empty-state">Ask Pi about this workspace.</p>
    </section>
    <form class="composer" aria-label="Pi message input">
      <textarea class="composer__input" rows="1" aria-label="Message"></textarea>
      <button class="composer__button composer__add" type="button" aria-label="New session" title="New session">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 19 19" fill="none">
          <path d="M9.5 3.5V15.5M3.5 9.5H15.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="composer__info">
        <span class="composer__context"><span class="composer__context-value"></span><span class="composer__context-tooltip"></span></span>
        <button class="composer__model" type="button" aria-haspopup="true" aria-expanded="false"></button>
      </div>
      <div class="composer__model-menu" role="menu">
        <div class="composer__field">
          <label for="thinking-select">Thinking</label>
          <select id="thinking-select" class="composer__select composer__thinking-select" aria-label="Thinking mode">
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X High</option>
          </select>
        </div>
        <div class="composer__field">
          <label for="model-select">Model</label>
          <select id="model-select" class="composer__select composer__model-select" aria-label="Model"></select>
        </div>
      </div>
      <button class="composer__button composer__submit" type="submit" aria-label="Send message" title="Send message" disabled>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 14.25V3.75M4.75 8L9 3.75L13.25 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </form>
  </main>

  <script nonce="${nonce}" src="${scriptUris.highlightScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.markdownItScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.domPurifyScriptUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesElement = document.querySelector('.messages');
    const form = document.querySelector('.composer');
    const textarea = document.querySelector('textarea');
    const newSessionButton = document.querySelector('.composer__add');
    const contextElement = document.querySelector('.composer__context');
    const contextValueElement = document.querySelector('.composer__context-value');
    const contextTooltipElement = document.querySelector('.composer__context-tooltip');
    const modelElement = document.querySelector('.composer__model');
    const modelMenuElement = document.querySelector('.composer__model-menu');
    const modelSelectElement = document.querySelector('.composer__model-select');
    const thinkingSelectElement = document.querySelector('.composer__thinking-select');
    const submitButton = document.querySelector('.composer__submit');
    const messagesBottomThreshold = 4;
    const maxTextareaHeight = 180;
    const minTextareaHeight = 22;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    let state = { messages: [], busy: false, modelLabel: '', modelProvider: '', modelId: '', modelReasoning: false, thinkingLevel: '', modelOptions: [], contextUsageLabel: '', contextUsageTitle: '', contextUsageLevel: '' };
    const activityExpansion = new Map();
    const markdownRenderer = window.markdownit
      ? window.markdownit({
        html: false,
        linkify: true,
        breaks: false,
        highlight: highlightCode
      })
      : undefined;

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'focusInput') {
        focusPromptInput();
        return;
      }

      if (event.data?.type !== 'state') {
        return;
      }

      state = {
        messages: Array.isArray(event.data.messages) ? event.data.messages : [],
        busy: Boolean(event.data.busy),
        modelLabel: typeof event.data.modelLabel === 'string' ? event.data.modelLabel : '',
        modelProvider: typeof event.data.modelProvider === 'string' ? event.data.modelProvider : '',
        modelId: typeof event.data.modelId === 'string' ? event.data.modelId : '',
        modelReasoning: Boolean(event.data.modelReasoning),
        thinkingLevel: typeof event.data.thinkingLevel === 'string' ? event.data.thinkingLevel : '',
        modelOptions: Array.isArray(event.data.modelOptions) ? event.data.modelOptions : [],
        contextUsageLabel: typeof event.data.contextUsageLabel === 'string' ? event.data.contextUsageLabel : '',
        contextUsageTitle: typeof event.data.contextUsageTitle === 'string' ? event.data.contextUsageTitle : '',
        contextUsageLevel: typeof event.data.contextUsageLevel === 'string' ? event.data.contextUsageLevel : ''
      };
      render();
    });

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = textarea.value.trim();

      if (!text || state.busy) {
        return;
      }

      vscode.postMessage({ type: 'submit', text });
      textarea.value = '';
      syncComposer({ preserveBottom: true });
      focusPromptInput();
    });

    newSessionButton?.addEventListener('click', startNewSession);
    modelElement?.addEventListener('click', toggleModelMenu);
    modelSelectElement?.addEventListener('change', selectModel);
    thinkingSelectElement?.addEventListener('change', selectThinkingLevel);

    window.addEventListener('click', (event) => {
      if (!modelMenuElement?.hasAttribute('open')) {
        return;
      }

      if (modelMenuElement.contains(event.target) || modelElement?.contains(event.target)) {
        return;
      }

      closeModelMenu();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeModelMenu();
        return;
      }

      if (!isNewSessionShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      startNewSession();
    }, true);

    textarea?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });

    textarea?.addEventListener('input', () => {
      syncComposer({ preserveBottom: true });
    });

    function render() {
      const shouldStickToBottom = isMessagesAtBottom();
      messagesElement.replaceChildren();

      if (state.messages.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Ask Pi about this workspace.';
        messagesElement.append(empty);
      }

      for (const message of state.messages) {
        messagesElement.append(createMessageElement(message));
      }

      if (state.busy) {
        const status = document.createElement('div');
        status.className = 'status';
        const spinner = document.createElement('span');
        spinner.className = 'status__spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = getBusyStatusText();
        status.append(spinner, text);
        messagesElement.append(status);
      }

      syncModelLabel();
      syncComposer();
      if (shouldStickToBottom) {
        scrollMessagesToBottom();
      }
    }

    function createMessageElement(message) {
      const article = document.createElement('article');
      article.className = \`message message--\${message.role}\${message.error ? ' message--error' : ''}\`;

      const role = document.createElement('div');
      role.className = 'message__role';
      role.textContent = roleLabel(message.role);

      const body = document.createElement('div');
      body.className = 'message__body';

      if (message.role === 'assistant' && !message.error) {
        renderMarkdownInto(body, message.text || '');
      } else {
        body.textContent = message.text || '';
      }

      article.append(role);

      const activities = Array.isArray(message.activities) ? message.activities : [];
      const hasBody = Boolean(message.text || message.error || activities.length === 0);

      if (message.role !== 'assistant') {
        article.append(body);
        return article;
      }

      if (activities.length > 0) {
        article.append(createActivityListElement(activities));
      }

      if (hasBody) {
        if (activities.length > 0) {
          body.classList.add('message__body--after-activities');
        }

        article.append(body);
      }

      return article;
    }

    function renderMarkdownInto(element, text) {
      if (!markdownRenderer || !window.DOMPurify) {
        element.textContent = text;
        return;
      }

      element.classList.add('message__body--markdown');

      const rendered = markdownRenderer.render(text);
      element.innerHTML = window.DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true }
      });
    }

    function highlightCode(code, language) {
      if (!window.hljs || typeof language !== 'string' || language.length === 0) {
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
        cjs: 'javascript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        shell: 'bash',
        sh: 'bash',
        ts: 'typescript',
        tsx: 'typescript',
        yml: 'yaml'
      };

      return aliases[normalized] || normalized;
    }

    function escapeHtml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function createActivityListElement(activities) {
      const list = document.createElement('div');
      list.className = 'activity-list';

      for (const activity of activities) {
        list.append(createActivityElement(activity));
      }

      return list;
    }

    function createActivityElement(activity) {
      const details = document.createElement('details');
      details.className = \`activity activity--\${activity.kind || 'rpc'} activity--\${activity.status || 'info'}\`;

      const activityId = typeof activity.id === 'string' ? activity.id : '';
      const savedOpenState = activityExpansion.get(activityId);
      details.open = typeof savedOpenState === 'boolean'
        ? savedOpenState
        : activity.status === 'running' || shouldKeepActivityOpen(activity);

      details.addEventListener('toggle', () => {
        if (activityId) {
          activityExpansion.set(activityId, details.open);
        }
      });

      const summary = document.createElement('summary');
      summary.className = 'activity__summary';

      const title = document.createElement('span');
      title.className = 'activity__title';
      title.textContent = typeof activity.title === 'string' ? activity.title : 'Activity';

      const status = document.createElement('span');
      status.className = 'activity__status';
      status.textContent = activityStatusLabel(activity.status);

      summary.append(title, status);

      if (typeof activity.summary === 'string' && activity.summary.length > 0) {
        const description = document.createElement('span');
        description.className = 'activity__description';
        description.textContent = activity.summary;
        summary.append(description);
      }

      details.append(summary);

      if (typeof activity.body === 'string' && activity.body.length > 0) {
        const body = document.createElement(activity.code ? 'pre' : 'div');
        body.className = \`activity__body\${activity.code ? ' activity__body--code' : ' activity__body--markdown'}\`;

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
      return activity.kind === 'thinking'
        && typeof activity.body === 'string'
        && activity.body.length > 0;
    }

    function roleLabel(role) {
      if (role === 'user') {
        return 'You';
      }

      if (role === 'assistant') {
        return 'Pi';
      }

      return 'System';
    }

    function syncSubmit() {
      submitButton.disabled = state.busy || textarea.value.trim().length === 0;
    }

    function activityStatusLabel(status) {
      if (status === 'running') {
        return 'Running';
      }

      if (status === 'completed') {
        return 'Done';
      }

      if (status === 'error') {
        return 'Error';
      }

      return 'Info';
    }

    function getBusyStatusText() {
      const activity = getLatestRunningActivity();

      if (!activity) {
        return 'Pi is working...';
      }

      const title = typeof activity.title === 'string' && activity.title
        ? activity.title
        : 'Pi is working';
      const summary = typeof activity.summary === 'string' && activity.summary
        ? ': ' + activity.summary
        : '';

      return title + summary;
    }

    function getLatestRunningActivity() {
      for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const activities = Array.isArray(state.messages[messageIndex].activities)
          ? state.messages[messageIndex].activities
          : [];

        for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
          if (activities[activityIndex]?.status === 'running') {
            return activities[activityIndex];
          }
        }
      }

      return undefined;
    }

    function syncModelLabel() {
      contextValueElement.textContent = state.contextUsageLabel;
      contextTooltipElement.textContent = state.contextUsageTitle;
      contextElement.title = state.contextUsageTitle;
      contextElement.className = 'composer__context' + (state.contextUsageLevel ? ' composer__context--' + state.contextUsageLevel : '');
      contextElement.hidden = state.contextUsageLabel.length === 0;

      const label = state.modelLabel || 'Select model';
      modelElement.textContent = label;
      modelElement.title = state.modelOptions.length === 0 && !state.busy
        ? 'Load model settings'
        : label;
      modelElement.disabled = state.busy;

      syncModelSelect();
      syncThinkingSelect();
    }

    function syncModelSelect() {
      const selectedValue = modelKey(state.modelProvider, state.modelId);
      const currentValue = modelSelectElement.value;
      modelSelectElement.replaceChildren();

      for (const model of state.modelOptions) {
        if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') {
          continue;
        }

        const option = document.createElement('option');
        option.value = modelKey(model.provider, model.id);
        option.textContent = model.name && model.name !== model.id
          ? model.name + ' (' + model.provider + '/' + model.id + ')'
          : model.provider + '/' + model.id;
        modelSelectElement.append(option);
      }

      modelSelectElement.value = selectedValue || currentValue;
      modelSelectElement.disabled = state.busy || state.modelOptions.length === 0;
    }

    function syncThinkingSelect() {
      thinkingSelectElement.value = state.thinkingLevel || 'medium';
      thinkingSelectElement.disabled = state.busy || !state.modelReasoning;
      thinkingSelectElement.title = state.modelReasoning
        ? 'Thinking mode'
        : 'The selected model does not advertise thinking support.';
    }

    function toggleModelMenu() {
      if (modelElement.disabled) {
        return;
      }

      if (state.modelOptions.length === 0) {
        vscode.postMessage({ type: 'refreshMetadata' });
        return;
      }

      const open = !modelMenuElement.hasAttribute('open');
      modelMenuElement.toggleAttribute('open', open);
      modelElement.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeModelMenu() {
      modelMenuElement?.removeAttribute('open');
      modelElement?.setAttribute('aria-expanded', 'false');
    }

    function selectModel() {
      const [provider, modelId] = splitModelKey(modelSelectElement.value);

      if (!provider || !modelId || state.busy) {
        return;
      }

      vscode.postMessage({ type: 'setModel', provider, modelId });
    }

    function selectThinkingLevel() {
      const level = thinkingSelectElement.value;

      if (!level || state.busy || !state.modelReasoning) {
        return;
      }

      vscode.postMessage({ type: 'setThinkingLevel', level });
    }

    function modelKey(provider, id) {
      return provider + '/' + id;
    }

    function splitModelKey(value) {
      const slashIndex = value.indexOf('/');

      if (slashIndex <= 0) {
        return ['', ''];
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
      textarea.style.height = 'auto';

      const maxHeight = getMaxTextareaHeight();
      const nextHeight = Math.max(minTextareaHeight, Math.min(textarea.scrollHeight, maxHeight));
      textarea.style.height = nextHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
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

    function syncComposer(options = {}) {
      const shouldPreserveBottom = Boolean(options.preserveBottom) && isMessagesAtBottom();
      syncSubmit();
      syncTextareaHeight();

      if (shouldPreserveBottom) {
        scrollMessagesToBottom();
      }
    }

    function startNewSession() {
      vscode.postMessage({ type: 'newSession' });
      focusPromptInput();
    }

    function isNewSessionShortcut(event) {
      if (event.key.toLowerCase() !== 'n' || event.shiftKey || event.altKey) {
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

    vscode.postMessage({ type: 'ready' });
    window.addEventListener('resize', () => {
      syncComposer({ preserveBottom: true });
    });
    render();
  </script>
</body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}
