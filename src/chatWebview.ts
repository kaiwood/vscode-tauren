import type { ChatState } from './chatSession';
import { chatWebviewScript } from './chatWebviewScript';
import { chatWebviewStyles } from './chatWebviewStyles';
import { createNonce } from './nonce';

export type WebviewStreamingBehavior = 'steer' | 'followUp';

export type WebviewPromptContextAttachment = {
  id: string;
  kind: 'file' | 'selection';
  label: string;
  title: string;
};

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'newSession' }
  | { type: 'showSessions' }
  | { type: 'hideSessions' }
  | { type: 'refreshSessions' }
  | { type: 'selectSession'; sessionPath: string }
  | { type: 'refreshMetadata' }
  | { type: 'refreshSlashCommands' }
  | { type: 'removePromptContext'; id: string }
  | { type: 'abort' }
  | { type: 'submit'; text: string; streamingBehavior?: WebviewStreamingBehavior }
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
    case 'showSessions':
      return { type: 'showSessions' };
    case 'hideSessions':
      return { type: 'hideSessions' };
    case 'refreshSessions':
      return { type: 'refreshSessions' };
    case 'selectSession':
      return typeof value.sessionPath === 'string' && value.sessionPath
        ? { type: 'selectSession', sessionPath: value.sessionPath }
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

export type WebviewModelOption = {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
};

export type WebviewSlashCommand = {
  name: string;
  description: string;
  source: string;
  location?: string;
  path?: string;
};

export type WebviewViewMode = 'chat' | 'sessions';

export type WebviewSessionItem = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
  current: boolean;
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
  metadataRefreshing: boolean;
  slashCommands: WebviewSlashCommand[];
  slashCommandsRefreshing: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composerText?: string;
  composerTextRevision?: number;
  viewMode?: WebviewViewMode;
  sessions?: WebviewSessionItem[];
  sessionsRefreshing?: boolean;
  sessionsError?: string;
  currentSessionFile?: string;
};

type CreateWebviewStateMessageOptions = {
  state: ChatState;
  model?: {
    label?: string;
    provider?: string;
    id?: string;
    reasoning?: boolean;
    thinkingLevel?: string;
    options?: WebviewModelOption[];
  };
  contextUsage?: {
    label?: string;
    title?: string;
    level?: string;
  };
  metadataRefreshing?: boolean;
  slashCommands?: WebviewSlashCommand[];
  slashCommandsRefreshing?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composer?: {
    text?: string;
    revision?: number;
  };
  sessionView?: {
    viewMode?: WebviewViewMode;
    sessions?: WebviewSessionItem[];
    refreshing?: boolean;
    error?: string;
    currentSessionFile?: string;
  };
};

export function createWebviewStateMessage({
  state,
  model = {},
  contextUsage = {},
  metadataRefreshing = false,
  slashCommands = [],
  slashCommandsRefreshing = false,
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
    slashCommands,
    slashCommandsRefreshing
  };

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
  }

  return message;
}

export type WebviewScriptUris = {
  markdownItScriptUri: string;
  domPurifyScriptUri: string;
  highlightScriptUri: string;
};

export function createWebviewHtml(scriptUris: WebviewScriptUris): string {
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
  <main class="pi-view">
    <header class="pi-toolbar">
      <button class="pi-toolbar__sessions" type="button" aria-label="Show sessions" title="Show sessions">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11.25 4.5L6.75 9L11.25 13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="pi-toolbar__title" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="pi-toolbar__title-text">Pi</span></button>
      <div class="pi-toolbar__session-menu" role="listbox" aria-label="Recent sessions"></div>
    </header>
    <section class="messages" aria-live="polite" aria-label="Pi conversation">
      <p class="empty-state">Ask Pi about this workspace.</p>
    </section>
    <section class="sessions" aria-label="Pi sessions" role="listbox" tabindex="0" hidden></section>
    <form class="composer" aria-label="Pi message input">
      <div id="slash-command-list" class="composer__slash-menu" role="listbox" aria-label="Slash commands"></div>
      <div class="composer__context-badges" aria-label="Attached context" hidden></div>
      <textarea class="composer__input" rows="1" aria-label="Message" placeholder="Write your prompt…" aria-autocomplete="list" aria-controls="slash-command-list" aria-expanded="false"></textarea>
      <div class="composer__busy-submit" hidden aria-live="polite">
        <span class="composer__busy-submit-hint"></span>
        <span class="composer__busy-submit-modes" role="group" aria-label="Busy submit mode">
          <button class="composer__mode-button" type="button" data-streaming-behavior="steer">Steer</button>
          <button class="composer__mode-button" type="button" data-streaming-behavior="followUp">Follow-up</button>
        </span>
      </div>
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
          <path class="composer__submit-arrow" d="M9 14.25V3.75M4.75 8L9 3.75L13.25 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <rect class="composer__submit-stop" x="4" y="4" width="10" height="10" rx="1.5" fill="currentColor"/>
        </svg>
      </button>
    </form>
  </main>

  <script nonce="${nonce}" src="${scriptUris.highlightScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.markdownItScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.domPurifyScriptUri}"></script>
  <script nonce="${nonce}">
${chatWebviewScript}
  </script>
</body>
</html>`;
}

function parseStreamingBehavior(value: unknown): WebviewStreamingBehavior | undefined {
  return value === 'steer' || value === 'followUp' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
