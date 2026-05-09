import * as vscode from 'vscode';
import { PiRpcClient, type RpcEvent } from './piRpcClient';

const viewType = 'piui.chatView';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  error?: boolean;
};

type WebviewMessage = {
  type?: unknown;
  text?: unknown;
};

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PiChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(viewType, provider),
    vscode.commands.registerCommand('piui.focus', () => provider.focus()),
    vscode.commands.registerCommand('piui.newSession', () => provider.newSession())
  );
}

export function deactivate(): void {}

class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private client: PiRpcClient | undefined;
  private activeAssistantIndex: number | undefined;
  private busy = false;
  private sessionGeneration = 0;
  private pendingInputFocus = false;
  private webviewReady = false;
  private readonly transcript: ChatMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly clientDisposables: vscode.Disposable[] = [];

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }

    this.disposeClient();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    this.webviewReady = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml();
    this.disposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView === webviewView) {
          this.webviewView = undefined;
          this.webviewReady = false;
        }
      }),
      webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleWebviewMessage(message);
      })
    );

    this.postState();
  }

  public async focus(): Promise<void> {
    this.pendingInputFocus = true;

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${viewType}.focus`);
    }

    this.postInputFocus();
  }

  public async newSession(): Promise<void> {
    this.startNewSession();
    await this.focus();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.webviewReady = true;
      this.postState();
      this.postInputFocus();
      return;
    }

    if (message.type === 'newSession') {
      this.startNewSession();
      return;
    }

    if (message.type !== 'submit') {
      return;
    }

    const text = typeof message.text === 'string' ? message.text.trim() : '';

    if (!text || this.busy) {
      return;
    }

    const sessionGeneration = this.sessionGeneration;
    this.transcript.push({ role: 'user', text });
    this.activeAssistantIndex = this.transcript.push({ role: 'assistant', text: '' }) - 1;
    this.busy = true;
    this.postState();

    try {
      await this.getClient().prompt(text);
    } catch (error) {
      if (sessionGeneration !== this.sessionGeneration) {
        return;
      }

      this.markActiveAssistantError(getErrorMessage(error));
      this.busy = false;
      this.activeAssistantIndex = undefined;
      this.postState();
    }
  }

  private startNewSession(): void {
    this.sessionGeneration += 1;
    this.disposeClient();
    this.transcript.length = 0;
    this.activeAssistantIndex = undefined;
    this.busy = false;
    this.postState();
  }

  private disposeClient(): void {
    for (const disposable of this.clientDisposables.splice(0)) {
      disposable.dispose();
    }

    this.client?.dispose();
    this.client = undefined;
  }

  private getClient(): PiRpcClient {
    if (this.client) {
      return this.client;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const client = new PiRpcClient({ cwd });
    const sessionGeneration = this.sessionGeneration;
    this.client = client;
    this.clientDisposables.push(
      { dispose: client.onEvent((event) => {
        if (sessionGeneration === this.sessionGeneration) {
          this.handleRpcEvent(event);
        }
      }) },
      { dispose: client.onError((message) => {
        if (sessionGeneration === this.sessionGeneration) {
          this.handleClientError(message);
        }
      }) }
    );

    return client;
  }

  private handleRpcEvent(event: RpcEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.busy = true;
        this.postState();
        break;
      case 'message_update':
        this.handleMessageUpdate(event);
        break;
      case 'agent_end':
        this.busy = false;
        this.activeAssistantIndex = undefined;
        this.postState();
        break;
      case 'extension_ui_request':
        this.handleExtensionUiRequest(event);
        break;
      case 'extension_error':
        this.addErrorMessage(formatExtensionError(event));
        break;
      case 'response':
        this.handleUnmatchedResponse(event);
        break;
    }
  }

  private handleMessageUpdate(event: RpcEvent): void {
    const assistantMessageEvent = event.assistantMessageEvent;

    if (!isRecord(assistantMessageEvent)) {
      return;
    }

    if (assistantMessageEvent.type === 'text_delta') {
      const delta = typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : '';
      this.appendAssistantDelta(delta);
      return;
    }

    if (assistantMessageEvent.type === 'error') {
      const reason = getRecordString(assistantMessageEvent, 'reason')
        ?? getRecordString(assistantMessageEvent, 'error')
        ?? 'Pi reported an error while responding.';
      this.markActiveAssistantError(reason);
      this.postState();
    }
  }

  private handleExtensionUiRequest(event: RpcEvent): void {
    const method = typeof event.method === 'string' ? event.method : '';

    if (method === 'notify') {
      this.showNotification(event);
      return;
    }

    if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
      const id = typeof event.id === 'string' ? event.id : undefined;

      if (id) {
        void this.client?.cancelExtensionUiRequest(id).catch((error) => {
          this.addErrorMessage(getErrorMessage(error));
        });
      }
    }
  }

  private showNotification(event: RpcEvent): void {
    const message = typeof event.message === 'string' ? event.message : 'Pi notification';
    const notifyType = typeof event.notifyType === 'string' ? event.notifyType : 'info';

    if (notifyType === 'error') {
      void vscode.window.showErrorMessage(message);
      return;
    }

    if (notifyType === 'warning') {
      void vscode.window.showWarningMessage(message);
      return;
    }

    void vscode.window.showInformationMessage(message);
  }

  private handleUnmatchedResponse(event: RpcEvent): void {
    if (event.success !== false) {
      return;
    }

    const error = typeof event.error === 'string' ? event.error : 'Pi command failed.';
    this.addErrorMessage(error);
  }

  private handleClientError(message: string): void {
    this.addErrorMessage(message);
    this.busy = false;
    this.postState();
  }

  private appendAssistantDelta(delta: string): void {
    if (!delta) {
      return;
    }

    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text += delta;
    this.postState();
  }

  private markActiveAssistantError(message: string): void {
    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text = message;
    this.transcript[index].error = true;
  }

  private addErrorMessage(message: string): void {
    if (this.activeAssistantIndex !== undefined) {
      this.markActiveAssistantError(message);
    } else {
      this.transcript.push({ role: 'system', text: message, error: true });
    }

    this.postState();
  }

  private ensureActiveAssistantMessage(): number {
    if (this.activeAssistantIndex !== undefined) {
      return this.activeAssistantIndex;
    }

    this.activeAssistantIndex = this.transcript.push({ role: 'assistant', text: '' }) - 1;
    return this.activeAssistantIndex;
  }

  private postState(): void {
    void this.webviewView?.webview.postMessage({
      type: 'state',
      messages: this.transcript,
      busy: this.busy
    });
  }

  private postInputFocus(): void {
    if (!this.pendingInputFocus || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingInputFocus = false;
    void this.webviewView.webview.postMessage({ type: 'focusInput' });
  }

  private getHtml(): string {
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
      grid-template-rows: minmax(0, 1fr) auto;
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    .messages {
      min-height: 0;
      padding: 12px 12px 8px;
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

    .message--user .message__body {
      color: var(--vscode-input-foreground);
    }

    .message--error .message__body {
      color: var(--vscode-errorForeground);
    }

    .status {
      margin-top: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .composer {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) 36px;
      grid-template-rows: minmax(22px, auto) 36px;
      align-items: end;
      gap: 4px 8px;
      min-height: 84px;
      max-height: calc(100vh - 16px);
      margin: 0 8px 8px;
      padding: 14px 9px 8px;
      overflow: hidden;
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

    .composer__model {
      justify-self: end;
      padding: 0 2px 8px 0;
      min-width: 0;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__model-version {
      color: var(--vscode-input-foreground);
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
      <div class="composer__model" aria-hidden="true"><span class="composer__model-version">5.5</span>&nbsp;Medium</div>
      <button class="composer__button composer__submit" type="submit" aria-label="Send message" title="Send message" disabled>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 14.25V3.75M4.75 8L9 3.75L13.25 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </form>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesElement = document.querySelector('.messages');
    const form = document.querySelector('.composer');
    const textarea = document.querySelector('textarea');
    const newSessionButton = document.querySelector('.composer__add');
    const submitButton = document.querySelector('.composer__submit');
    const messagesBottomThreshold = 4;
    const maxTextareaHeight = 180;
    const minTextareaHeight = 22;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    let state = { messages: [], busy: false };

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
        busy: Boolean(event.data.busy)
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

    window.addEventListener('keydown', (event) => {
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
        status.textContent = 'Pi is working...';
        messagesElement.append(status);
      }

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
      body.textContent = message.text || '';

      article.append(role, body);
      return article;
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
      textarea.focus({ preventScroll: true });
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
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function formatExtensionError(event: RpcEvent): string {
  const extensionPath = typeof event.extensionPath === 'string' ? event.extensionPath : 'extension';
  const error = typeof event.error === 'string' ? event.error : 'Unknown extension error.';

  return `Pi ${extensionPath} error: ${error}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
