import * as vscode from 'vscode';
import { ChatSession } from './chatSession';
import {
  createWebviewHtml,
  createWebviewStateMessage,
  type WebviewMessage
} from './chatWebview';
import {
  formatExtensionError,
  getFailedResponseError,
  mapExtensionUiRequest,
  mapMessageUpdate,
  mapRpcActivity,
  type ActivityAddAction,
  type ActivityUpdateAction
} from './piEventMapper';
import { PiRpcClient, type PiSessionState, type RpcEvent } from './piRpcClient';

export const chatViewType = 'piui.chatView';

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private client: PiRpcClient | undefined;
  private pendingInputFocus = false;
  private webviewReady = false;
  private assistantStreamId = 0;
  private modelLabel = '';
  private readonly session = new ChatSession();
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

    webviewView.webview.html = createWebviewHtml();
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
      await vscode.commands.executeCommand(`${chatViewType}.focus`);
    }

    this.postInputFocusSoon();
  }

  public async newSession(): Promise<void> {
    this.startNewSession();
    await this.focus();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.webviewReady = true;
      this.postState();
      this.postInputFocusSoon();
      void this.refreshModelLabel();
      return;
    }

    if (message.type === 'newSession') {
      this.startNewSession();
      return;
    }

    if (message.type !== 'submit') {
      return;
    }

    const submittedPrompt = this.session.beginSubmit(
      typeof message.text === 'string' ? message.text : ''
    );

    if (!submittedPrompt) {
      return;
    }

    this.postState();

    try {
      await this.getClient().prompt(submittedPrompt.text);
    } catch (error) {
      if (submittedPrompt.sessionGeneration !== this.session.generation) {
        return;
      }

      this.session.failActivePrompt(getErrorMessage(error));
      this.postState();
    }
  }

  private startNewSession(): void {
    this.assistantStreamId = 0;
    this.session.startNewSession();
    this.disposeClient();
    this.postState();
  }

  private async refreshModelLabel(): Promise<void> {
    const sessionGeneration = this.session.generation;

    try {
      const state = await this.getClient().getState();

      if (sessionGeneration !== this.session.generation) {
        return;
      }

      const label = formatModelLabel(state);

      if (label !== this.modelLabel) {
        this.modelLabel = label;
        this.postState();
      }
    } catch (error) {
      if (sessionGeneration === this.session.generation) {
        this.handleClientError(getErrorMessage(error));
      }
    }
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
    const sessionGeneration = this.session.generation;
    this.client = client;
    this.clientDisposables.push(
      { dispose: client.onEvent((event) => {
        if (sessionGeneration === this.session.generation) {
          this.handleRpcEvent(event);
        }
      }) },
      { dispose: client.onError((message) => {
        if (sessionGeneration === this.session.generation) {
          this.handleClientError(message);
        }
      }) }
    );

    return client;
  }

  private handleRpcEvent(event: RpcEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.session.handleAgentStart();
        this.applyRpcActivity(event);
        this.postState();
        break;
      case 'message_update':
        this.handleMessageUpdate(event);
        break;
      case 'agent_end':
        this.applyRpcActivity(event);
        this.session.handleAgentEnd();
        this.postState();
        break;
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
      case 'message_end':
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
      case 'queue_update':
      case 'compaction_start':
      case 'compaction_end':
      case 'auto_retry_start':
      case 'auto_retry_end':
        this.applyRpcActivity(event);
        this.postState();
        break;
      case 'extension_ui_request':
        this.applyRpcActivity(event);
        this.handleExtensionUiRequest(event);
        this.postState();
        break;
      case 'extension_error':
        this.applyRpcActivity(event);
        this.session.addErrorMessage(formatExtensionError(event));
        this.postState();
        break;
      case 'response':
        this.handleUnmatchedResponse(event);
        break;
      default:
        this.applyRpcActivity(event);
        this.postState();
        break;
    }
  }

  private handleMessageUpdate(event: RpcEvent): void {
    const action = mapMessageUpdate(event, this.getMessageUpdateStreamId(event));

    if (action.type === 'text_delta') {
      if (this.session.appendAssistantDelta(action.delta)) {
        this.postState();
      }

      return;
    }

    if (action.type === 'assistant_error') {
      this.session.markActiveAssistantError(action.message);
      this.postState();
    }

    if (action.type === 'activity_update' || action.type === 'activity_add') {
      this.applyActivityAction(action);
      this.postState();
    }
  }

  private applyRpcActivity(event: RpcEvent): void {
    if (!this.session.isBusy && event.type !== 'agent_start') {
      return;
    }

    const action = mapRpcActivity(event);

    if (action.type === 'activity_update' || action.type === 'activity_add') {
      this.applyActivityAction(action);
    }
  }

  private applyActivityAction(action: ActivityUpdateAction | ActivityAddAction): void {
    if (action.type === 'activity_update') {
      this.session.upsertActivity(action.sourceId, action.activity, action.bodyMode);
      return;
    }

    this.session.addActivity(action.activity);
  }

  private getMessageUpdateStreamId(event: RpcEvent): number {
    if (isMessageUpdateStart(event)) {
      this.assistantStreamId += 1;
    }

    return this.assistantStreamId;
  }

  private handleExtensionUiRequest(event: RpcEvent): void {
    const action = mapExtensionUiRequest(event);

    if (action.type === 'notify') {
      this.showNotification(action.message, action.notifyType);
      return;
    }

    if (action.type === 'cancel') {
      void this.client?.cancelExtensionUiRequest(action.id).catch((error) => {
        this.session.addErrorMessage(getErrorMessage(error));
        this.postState();
      });
    }
  }

  private showNotification(message: string, notifyType: string): void {
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
    const error = getFailedResponseError(event);

    if (!error) {
      return;
    }

    this.session.addErrorMessage(error);
    this.postState();
  }

  private handleClientError(message: string): void {
    this.session.addErrorMessage(message);
    this.session.setBusy(false);
    this.postState();
  }

  private postState(): void {
    void this.webviewView?.webview.postMessage(
      createWebviewStateMessage(this.session.snapshot(), this.modelLabel)
    );
  }

  private postInputFocus(): void {
    if (!this.pendingInputFocus || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingInputFocus = false;
    void this.webviewView.webview.postMessage({ type: 'focusInput' });
  }

  private postInputFocusSoon(): void {
    setTimeout(() => this.postInputFocus(), 0);
  }
}

function formatModelLabel(state: PiSessionState): string {
  const model = state.model;
  const modelId = typeof model?.id === 'string' ? model.id : '';

  if (!modelId) {
    return '';
  }

  if (model?.reasoning && state.thinkingLevel) {
    return `${modelId} ${formatThinkingLevel(state.thinkingLevel)}`;
  }

  return modelId;
}

function formatThinkingLevel(level: string): string {
  if (level === 'off') {
    return 'Thinking off';
  }

  return level.slice(0, 1).toUpperCase() + level.slice(1);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isMessageUpdateStart(event: RpcEvent): boolean {
  const assistantMessageEvent = event.assistantMessageEvent;

  return typeof assistantMessageEvent === 'object'
    && assistantMessageEvent !== null
    && 'type' in assistantMessageEvent
    && assistantMessageEvent.type === 'start';
}
