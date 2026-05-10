import type { ChatState } from './chatSession';
import { chatWebviewScript } from './chatWebviewScript';
import { chatWebviewStyles } from './chatWebviewStyles';
import { createNonce } from './nonce';

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
  metadataRefreshing: boolean;
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
};

export function createWebviewStateMessage({
  state,
  model = {},
  contextUsage = {},
  metadataRefreshing = false
}: CreateWebviewStateMessageOptions): WebviewStateMessage {
  return {
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
    metadataRefreshing
  };
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
${chatWebviewScript}
  </script>
</body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
