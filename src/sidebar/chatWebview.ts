import { chatWebviewStyles } from './chatWebviewStyles';
import { createNonce } from './nonce';
import type {
  CreateWebviewHtmlOptions,
  CreateWebviewStateMessageOptions,
  WebviewMessage,
  WebviewScriptUris,
  WebviewSessionItemCommand,
  WebviewStateMessage,
  WebviewStreamingBehavior
} from '../webviewProtocol/types';

export function parseWebviewMessage(value: unknown): WebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { type: 'unknown' };
  }

  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'focusChanged':
      return typeof value.focused === 'boolean'
        ? { type: 'focusChanged', focused: value.focused }
        : { type: 'unknown' };
    case 'newSession':
      return { type: 'newSession' };
    case 'showSessions':
      return { type: 'showSessions' };
    case 'showTree':
      return { type: 'showTree' };
    case 'hideSessions':
      return { type: 'hideSessions' };
    case 'refreshSessions':
      return { type: 'refreshSessions' };
    case 'showCurrentChanges':
      return { type: 'showCurrentChanges' };
    case 'dismissWelcome':
      return { type: 'dismissWelcome' };
    case 'selectSession':
      return typeof value.sessionPath === 'string' && value.sessionPath
        ? { type: 'selectSession', sessionPath: value.sessionPath }
        : { type: 'unknown' };
    case 'deleteSession':
      return typeof value.sessionPath === 'string' && value.sessionPath
        ? { type: 'deleteSession', sessionPath: value.sessionPath }
        : { type: 'unknown' };
    case 'sessionItemCommand':
      return typeof value.sessionPath === 'string' && value.sessionPath && isWebviewSessionItemCommand(value.command)
        ? { type: 'sessionItemCommand', sessionPath: value.sessionPath, command: value.command }
        : { type: 'unknown' };
    case 'setSessionItemName':
      return typeof value.sessionPath === 'string' && value.sessionPath && typeof value.name === 'string'
        ? { type: 'setSessionItemName', sessionPath: value.sessionPath, name: value.name }
        : { type: 'unknown' };
    case 'selectTreeEntry':
      return typeof value.entryId === 'string' && value.entryId
        ? {
          type: 'selectTreeEntry',
          entryId: value.entryId,
          ...(typeof value.summarize === 'boolean' ? { summarize: value.summarize } : {}),
          ...(typeof value.customInstructions === 'string' ? { customInstructions: value.customInstructions } : {})
        }
        : { type: 'unknown' };
    case 'setSessionName':
      return typeof value.name === 'string'
        ? { type: 'setSessionName', name: value.name }
        : { type: 'unknown' };
    case 'refreshMetadata':
      return { type: 'refreshMetadata' };
    case 'refreshSlashCommands':
      return { type: 'refreshSlashCommands' };
    case 'removePromptContext':
      return typeof value.id === 'string' && value.id
        ? { type: 'removePromptContext', id: value.id }
        : { type: 'unknown' };
    case 'abort':
      return { type: 'abort' };
    case 'copyText':
      if (typeof value.text !== 'string' || !value.text || ('successMessage' in value && typeof value.successMessage !== 'string')) {
        return { type: 'unknown' };
      }

      return typeof value.successMessage === 'string' && value.successMessage
        ? { type: 'copyText', text: value.text, successMessage: value.successMessage }
        : { type: 'copyText', text: value.text };
    case 'openFile': {
      if (typeof value.path !== 'string' || !value.path) {
        return { type: 'unknown' };
      }

      const line = parsePositiveInteger(value.line);
      const column = parsePositiveInteger(value.column);

      if (('line' in value && line === undefined) || ('column' in value && column === undefined)) {
        return { type: 'unknown' };
      }

      return {
        type: 'openFile',
        path: value.path,
        ...(line ? { line } : {}),
        ...(column ? { column } : {})
      };
    }
    case 'highlightCode': {
      if (typeof value.id !== 'string' || !value.id
        || typeof value.code !== 'string' || !value.code
        || typeof value.language !== 'string' || !value.language
        || ('themeId' in value && typeof value.themeId !== 'string')) {
        return { type: 'unknown' };
      }

      const themeId = typeof value.themeId === 'string' && value.themeId ? value.themeId : undefined;

      return {
        type: 'highlightCode',
        id: value.id,
        code: value.code,
        language: value.language,
        ...(themeId ? { themeId } : {})
      };
    }
    case 'submit': {
      if (typeof value.text !== 'string') {
        return { type: 'unknown' };
      }

      const streamingBehavior = parseStreamingBehavior(value.streamingBehavior);

      if ('streamingBehavior' in value && !streamingBehavior) {
        return { type: 'unknown' };
      }

      return streamingBehavior
        ? { type: 'submit', text: value.text, streamingBehavior }
        : { type: 'submit', text: value.text };
    }
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

export function createWebviewStateMessage({
  state,
  model = {},
  contextUsage = {},
  metadataRefreshing = false,
  workspaceDiffStats = { addedLines: 0, removedLines: 0 },
  slashCommands = [],
  slashCommandsRefreshing = false,
  outputColors = true,
  animationsEnabled = true,
  welcomeDismissed,
  promptContext = [],
  composer,
  sessionView
}: CreateWebviewStateMessageOptions): WebviewStateMessage {
  const message: WebviewStateMessage = {
    type: 'state',
    messages: state.messages,
    busy: state.busy,
    modelLabel: model.label ?? '',
    modelProvider: model.provider ?? '',
    modelId: model.id ?? '',
    modelReasoning: model.reasoning ?? false,
    thinkingLevel: model.thinkingLevel ?? '',
    modelOptions: model.options ?? [],
    contextUsageLabel: contextUsage.label ?? '',
    contextUsageTitle: contextUsage.title ?? '',
    contextUsageLevel: contextUsage.level ?? '',
    metadataRefreshing,
    workspaceDiffStats: {
      addedLines: normalizeDiffLineCount(workspaceDiffStats.addedLines),
      removedLines: normalizeDiffLineCount(workspaceDiffStats.removedLines)
    },
    slashCommands,
    slashCommandsRefreshing,
    outputColors,
    animationsEnabled
  };

  if (welcomeDismissed !== undefined) {
    message.welcomeDismissed = Boolean(welcomeDismissed);
  }

  if (promptContext.length > 0) {
    message.promptContext = promptContext.map((attachment) => ({ ...attachment }));
  }

  if (composer && typeof composer.revision === 'number' && composer.revision > 0) {
    message.composerText = composer.text ?? '';
    message.composerTextRevision = composer.revision;
  }

  if (sessionView) {
    if (sessionView.viewMode) {
      message.viewMode = sessionView.viewMode;
    }

    message.sessions = sessionView.sessions ?? [];
    message.sessionsRefreshing = sessionView.refreshing ?? false;
    message.sessionsError = sessionView.error ?? '';
    message.currentSessionFile = sessionView.currentSessionFile ?? '';
    message.currentSessionName = sessionView.currentSessionName ?? '';
    message.treeItems = sessionView.treeItems ?? [];
    message.treeRefreshing = sessionView.treeRefreshing ?? false;
    message.treeError = sessionView.treeError ?? '';

    if (sessionView.sessionLoading) {
      message.sessionLoading = true;
    }
  }

  return message;
}

export function createWebviewHtml(scriptUris: WebviewScriptUris, options: CreateWebviewHtmlOptions = {}): string {
  const nonce = createNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Pi</title>
  <style>
${chatWebviewStyles}
  </style>
</head>
<body>
  <main class="pi-view pi-view--chat">
    <header class="pi-toolbar">
      <button class="pi-toolbar__sessions" type="button" aria-label="Show sessions">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11.25 4.5L6.75 9L11.25 13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="tau-icon-action-tooltip">Show sessions</span>
      </button>
      <div class="pi-toolbar__title"><span class="pi-toolbar__title-text">Pi</span><span class="pi-toolbar__timestamp" hidden></span><input class="pi-toolbar__title-input" type="text" aria-label="Session name" spellcheck="false" hidden></div>
      <div class="pi-toolbar__menu-wrap">
        <button class="pi-toolbar__menu-button" type="button" aria-label="Session commands" aria-haspopup="menu" aria-expanded="false" aria-controls="session-command-menu">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/>
          </svg>
          <span class="tau-icon-action-tooltip">Session commands</span>
        </button>
        <div id="session-command-menu" class="pi-toolbar__menu" role="menu" hidden>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="reload">
            <span class="pi-toolbar__menu-label">Reload Pi</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M12.5 5.3A5 5 0 1 0 13 8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12.5 2.75V5.3H9.95" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="rename">
            <span class="pi-toolbar__menu-label">Rename session</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4.1 11.9L5.45 11.6L11.15 5.9C11.55 5.5 11.55 4.85 11.15 4.45L10.9 4.2C10.5 3.8 9.85 3.8 9.45 4.2L3.75 9.9L3.45 11.25C3.37 11.65 3.7 11.98 4.1 11.9Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8.85 4.8L10.55 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="fork">
            <span class="pi-toolbar__menu-label">Fork session</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none">
              <path d="M5.5 4.25V8.5C5.5 10.16 6.84 11.5 8.5 11.5H10.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5.5 4.25V14.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
              <path d="M10.25 8.5L13.25 11.5L10.25 14.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="5.5" cy="4.25" r="1.55" fill="currentColor"/>
              <circle cx="5.5" cy="14.75" r="1.55" fill="currentColor"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="clone">
            <span class="pi-toolbar__menu-label">Clone session</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 19 19" fill="none">
              <rect x="4.25" y="6.25" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.35"/>
              <path d="M7.25 4.25H13.25C14.08 4.25 14.75 4.92 14.75 5.75V11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="compact">
            <span class="pi-toolbar__menu-label">Compact session</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M5 3.5H3.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M11 3.5H12.5V5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5 12.5H3.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M11 12.5H12.5V11" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5.3 5.3L7.05 7.05M10.7 5.3L8.95 7.05M5.3 10.7L7.05 8.95M10.7 10.7L8.95 8.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="export">
            <span class="pi-toolbar__menu-label">Export as HTML</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3.5V10" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
              <path d="M5.6 5.9L8 3.5L10.4 5.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 9.5V11.6C4 12.1 4.4 12.5 4.9 12.5H11.1C11.6 12.5 12 12.1 12 11.6V9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="pi-toolbar__menu-item" type="button" role="menuitem" data-session-command="delete">
            <span class="pi-toolbar__menu-label">Move session to trash</span>
            <svg class="pi-toolbar__menu-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
              <path fill="currentColor" d="M6 2h4l1 1h3v1H2V3h3l1-1Zm-2 3h8l-.6 9.2A2 2 0 0 1 9.4 16H6.6a2 2 0 0 1-2-1.8L4 5Zm2 1v8h1V6H6Zm3 0v8h1V6H9Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="pi-toolbar__help-wrap pi-toolbar__chat-help-wrap">
        <button class="pi-toolbar__help-button pi-toolbar__chat-help-button" type="button" aria-label="Chat shortcuts" aria-haspopup="dialog" aria-expanded="false" aria-controls="chat-shortcuts">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.25"/>
            <path d="M6.55 6.35C6.64 5.48 7.28 4.9 8.12 4.9C9.02 4.9 9.65 5.48 9.65 6.27C9.65 6.84 9.38 7.24 8.82 7.62C8.25 8.01 8.03 8.35 8.03 8.95V9.18" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            <circle cx="8" cy="11.1" r="0.65" fill="currentColor"/>
          </svg>
          <span class="tau-icon-action-tooltip">Chat shortcuts</span>
        </button>
        <div id="chat-shortcuts" class="pi-toolbar__help-popover pi-toolbar__chat-help-popover" role="dialog" aria-label="Chat shortcuts" hidden>
          <div class="pi-toolbar__help-title">Chat shortcuts</div>
          <dl class="pi-toolbar__help-list">
            <div><dt>Enter</dt><dd>Send message</dd></div>
            <div><dt>Shift+Enter</dt><dd>Insert newline</dd></div>
            <div><dt>/</dt><dd>Show slash commands</dd></div>
            <div><dt>Esc</dt><dd>Open session list</dd></div>
            <div><dt>PageUp / PageDown</dt><dd>Scroll transcript</dd></div>
            <div><dt>Ctrl+PageUp / Ctrl+PageDown</dt><dd>Scroll transcript by line</dd></div>
            <div><dt>Model button</dt><dd>Change model or thinking</dd></div>
            <div><dt>Changes</dt><dd>Show session changes</dd></div>
            <div><dt>Stop</dt><dd>Stop current response</dd></div>
            <div><dt>Steer</dt><dd>Send guidance to the running response</dd></div>
            <div><dt>Follow-up</dt><dd>Queue the text as the next prompt</dd></div>
          </dl>
        </div>
      </div>
      <div class="pi-toolbar__help-wrap pi-toolbar__session-help-wrap" hidden>
        <button class="pi-toolbar__help-button pi-toolbar__session-help-button" type="button" aria-label="Session list shortcuts" aria-haspopup="dialog" aria-expanded="false" aria-controls="session-shortcuts">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.25"/>
            <path d="M6.55 6.35C6.64 5.48 7.28 4.9 8.12 4.9C9.02 4.9 9.65 5.48 9.65 6.27C9.65 6.84 9.38 7.24 8.82 7.62C8.25 8.01 8.03 8.35 8.03 8.95V9.18" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            <circle cx="8" cy="11.1" r="0.65" fill="currentColor"/>
          </svg>
          <span class="tau-icon-action-tooltip">Session list shortcuts</span>
        </button>
        <div id="session-shortcuts" class="pi-toolbar__help-popover pi-toolbar__session-help-popover" role="dialog" aria-label="Session list shortcuts" hidden>
          <div class="pi-toolbar__help-title">Session shortcuts</div>
          <dl class="pi-toolbar__help-list">
            <div><dt>Enter</dt><dd>Open selected session</dd></div>
            <div><dt>?</dt><dd>Show shortcuts</dd></div>
            <div><dt>R</dt><dd>Rename</dd></div>
            <div><dt>F</dt><dd>Fork</dd></div>
            <div><dt>C</dt><dd>Clone</dd></div>
            <div><dt>Z</dt><dd>Compact</dd></div>
            <div><dt>E</dt><dd>Export as HTML</dd></div>
            <div><dt>Del / Backspace</dt><dd>Move to trash</dd></div>
            <div><dt>Esc</dt><dd>Back to chat</dd></div>
          </dl>
        </div>
      </div>
      <button class="pi-toolbar__tree" type="button" aria-label="Show tree">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M6.75 4.5L11.25 9L6.75 13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="tau-icon-action-tooltip">Show tree</span>
      </button>
    </header>
    <div class="pi-toast" role="status" aria-live="polite" hidden></div>
    <section class="messages" aria-live="polite" aria-label="Pi conversation">
${createInitialEmptyStateHtml(Boolean(options.welcomeDismissed))}
    </section>
    <section class="sessions" aria-label="Pi sessions and tree" role="listbox" tabindex="0" hidden></section>
    <form class="composer" aria-label="Pi message input">
      <div id="slash-command-list" class="composer__slash-menu" role="listbox" aria-label="Slash commands"></div>
      <div class="composer__context-badges" aria-label="Attached context" hidden></div>
      <textarea class="composer__input" rows="1" aria-label="Message" placeholder="Write your prompt…" aria-autocomplete="list" aria-controls="slash-command-list" aria-expanded="false"></textarea>
      <div class="composer__busy-submit" hidden aria-live="polite">
        <button class="composer__diff-summary" type="button" aria-label="Show session changes">
          <span>Changes:</span>
          <span class="composer__diff-added">+0</span>
          <span aria-hidden="true">|</span>
          <span class="composer__diff-removed">-0</span>
          <span class="tau-icon-action-tooltip">Show session changes</span>
        </button>
        <span class="composer__busy-submit-modes" role="group" aria-label="Busy submit mode">
          <button class="composer__mode-button" type="button" data-streaming-behavior="steer">Steer<span class="tau-icon-action-tooltip">Steer current run</span></button>
          <button class="composer__mode-button" type="button" data-streaming-behavior="followUp">Follow-up<span class="tau-icon-action-tooltip">Queue follow-up</span></button>
        </span>
      </div>
      <div class="composer__session-actions" role="group" aria-label="Session actions">
        <button class="composer__button composer__add" type="button" aria-label="New session">
          <svg aria-hidden="true" width="19" height="19" viewBox="0 0 19 19" fill="none">
            <path d="M4.25 5.25C4.25 4.42 4.92 3.75 5.75 3.75H11.9C12.73 3.75 13.4 4.42 13.4 5.25V9.8C13.4 10.63 12.73 11.3 11.9 11.3H8.2L5.25 14.05V11.3C4.7 11.3 4.25 10.85 4.25 10.3V5.25Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
            <path d="M14.6 12.2L15.15 13.35L16.3 13.9L15.15 14.45L14.6 15.6L14.05 14.45L12.9 13.9L14.05 13.35L14.6 12.2Z" fill="currentColor"/>
          </svg>
          <span class="composer__button-tooltip">New session</span>
        </button>
      </div>
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
      <button class="composer__button composer__submit" type="submit" aria-label="Send message" disabled>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path class="composer__submit-play" d="M5.1 3.55C5.1 2.75 5.97 2.27 6.65 2.68L15.65 8.05C16.34 8.46 16.34 9.54 15.65 9.95L6.65 15.32C5.97 15.73 5.1 15.25 5.1 14.45Z" fill="currentColor"/>
          <rect class="composer__submit-stop" x="4" y="4" width="10" height="10" rx="1.5" fill="currentColor"/>
        </svg>
        <span class="tau-icon-action-tooltip">Send message</span>
      </button>
    </form>
  </main>

  <script nonce="${nonce}" src="${scriptUris.markdownItScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.domPurifyScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.webviewScriptUri}"></script>
</body>
</html>`;
}

function createInitialEmptyStateHtml(welcomeDismissed: boolean): string {
  if (welcomeDismissed) {
    return '      <p class="empty-state">Ask Pi about this workspace.</p>';
  }

  return /* html */ `      <div class="empty-state empty-state--welcome">
        <h2 class="empty-state__title">Welcome to Tau</h2>
        <p>Ask Pi about this workspace, review code, plan changes, or make edits.</p>
        <p>Type / for commands, or add a file/selection as context from the editor.</p>
        <p class="empty-state__try-label">Try:</p>
        <ul class="empty-state__prompts">
          <li>Explain how this workspace is structured</li>
          <li>Review the current file for bugs</li>
          <li>Plan the changes before editing</li>
          <li>Write tests for this behavior</li>
        </ul>
        <button class="empty-state__dismiss" type="button" data-dismiss-welcome>Don't show again</button>
      </div>`;
}

function parseStreamingBehavior(value: unknown): WebviewStreamingBehavior | undefined {
  return value === 'steer' || value === 'followUp' ? value : undefined;
}

function normalizeDiffLineCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isWebviewSessionItemCommand(command: unknown): command is WebviewSessionItemCommand {
  return command === 'rename'
    || command === 'showChanges'
    || command === 'fork'
    || command === 'clone'
    || command === 'compact'
    || command === 'export'
    || command === 'delete';
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
