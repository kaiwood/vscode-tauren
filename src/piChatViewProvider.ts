import * as vscode from 'vscode';
import { ChatSession } from './chatSession';
import {
  createWebviewHtml,
  createWebviewStateMessage,
  parseWebviewMessage,
  type WebviewMessage
} from './chatWebview';
import {
  formatExtensionError,
  getFailedResponseError,
  mapExtensionUiRequest,
  mapMessageUpdate,
  mapRpcActivity,
  type ActivityAddAction,
  type ActivityRemoveAction,
  type ActivityUpdateAction
} from './piEventMapper';
import { PiRpcClient, type PiModel, type PiRpcClientOptions, type PiSessionState, type PiSessionStats, type RpcEvent } from './piRpcClient';

export const chatViewType = 'piui.chatView';

export type PiRpcClientLike = Pick<
  PiRpcClient,
  | 'onEvent'
  | 'onError'
  | 'prompt'
  | 'isRunning'
  | 'getState'
  | 'getSessionStats'
  | 'getAvailableModels'
  | 'setModel'
  | 'setThinkingLevel'
  | 'cancelExtensionUiRequest'
  | 'dispose'
>;

type PiRpcClientFactory = (options: PiRpcClientOptions) => PiRpcClientLike;

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private client: PiRpcClientLike | undefined;
  private pendingInputFocus = false;
  private webviewReady = false;
  private assistantStreamId = 0;
  private modelLabel = '';
  private modelProvider = '';
  private modelId = '';
  private modelReasoning = false;
  private thinkingLevel = '';
  private modelOptions: { provider: string; id: string; name: string; reasoning: boolean }[] = [];
  private contextUsageLabel = '';
  private contextUsageTitle = '';
  private contextUsageLevel = '';
  private fullRpcAgentCommunication = false;
  private readonly session = new ChatSession();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly clientDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly createClient: PiRpcClientFactory = (options) => new PiRpcClient(options)
  ) {
    this.fullRpcAgentCommunication = getFullRpcAgentCommunicationSetting();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('piui.fullRpcAgentCommunication')) {
          return;
        }

        this.fullRpcAgentCommunication = getFullRpcAgentCommunicationSetting();
        this.postState();
      })
    );
  }

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

    const markdownItUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
    );
    const domPurifyUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'dompurify', 'dist', 'purify.min.js')
    );
    const highlightUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@highlightjs', 'cdn-assets', 'highlight.min.js')
    );

    webviewView.webview.html = createWebviewHtml({
      markdownItScriptUri: markdownItUri.toString(),
      domPurifyScriptUri: domPurifyUri.toString(),
      highlightScriptUri: highlightUri.toString()
    });
    this.fullRpcAgentCommunication = getFullRpcAgentCommunicationSetting();

    this.disposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView === webviewView) {
          this.webviewView = undefined;
          this.webviewReady = false;
        }
      }),
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(parseWebviewMessage(message));
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
      void this.refreshSessionMeta();
      return;
    }

    if (message.type === 'newSession') {
      this.startNewSession();
      return;
    }

    if (message.type === 'refreshMetadata') {
      if (!this.session.isBusy) {
        await this.refreshSessionMeta({ startClient: true });
      }

      return;
    }

    if (message.type === 'setModel') {
      await this.setModel(message.provider, message.modelId);
      return;
    }

    if (message.type === 'setThinkingLevel') {
      await this.setThinkingLevel(message.level);
      return;
    }

    if (message.type !== 'submit') {
      return;
    }

    const submittedPrompt = this.session.beginSubmit(message.text);

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

  private async setModel(provider: string, modelId: string): Promise<void> {
    if (this.session.isBusy) {
      return;
    }

    try {
      await this.getClient().setModel(provider, modelId);
      await this.refreshSessionMeta();
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private async setThinkingLevel(level: string): Promise<void> {
    if (this.session.isBusy) {
      return;
    }

    try {
      await this.getClient().setThinkingLevel(level);
      await this.refreshSessionMeta();
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private startNewSession(): void {
    this.assistantStreamId = 0;
    this.resetSessionMeta();
    this.session.startNewSession();
    this.disposeClient();
    this.postState();
  }

  private resetSessionMeta(): void {
    this.modelLabel = '';
    this.modelProvider = '';
    this.modelId = '';
    this.modelReasoning = false;
    this.thinkingLevel = '';
    this.modelOptions = [];
    this.contextUsageLabel = '';
    this.contextUsageTitle = '';
    this.contextUsageLevel = '';
  }

  private async refreshSessionMeta(options: { startClient?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.session.generation;

    try {
      const client = options.startClient ? this.getClient() : this.getExistingClient();

      if (!client) {
        return;
      }

      const [state, stats, availableModels] = await Promise.all([
        client.getState(),
        client.getSessionStats(),
        client.getAvailableModels()
      ]);

      if (sessionGeneration !== this.session.generation) {
        return;
      }

      const modelMeta = getModelMeta(state);
      const modelOptions = formatModelOptions(availableModels.models);
      const contextUsage = formatContextUsage(stats);

      if (
        modelMeta.label !== this.modelLabel
        || modelMeta.provider !== this.modelProvider
        || modelMeta.id !== this.modelId
        || modelMeta.reasoning !== this.modelReasoning
        || modelMeta.thinkingLevel !== this.thinkingLevel
        || !areModelOptionsEqual(modelOptions, this.modelOptions)
        || contextUsage.label !== this.contextUsageLabel
        || contextUsage.title !== this.contextUsageTitle
        || contextUsage.level !== this.contextUsageLevel
      ) {
        this.modelLabel = modelMeta.label;
        this.modelProvider = modelMeta.provider;
        this.modelId = modelMeta.id;
        this.modelReasoning = modelMeta.reasoning;
        this.thinkingLevel = modelMeta.thinkingLevel;
        this.modelOptions = modelOptions;
        this.contextUsageLabel = contextUsage.label;
        this.contextUsageTitle = contextUsage.title;
        this.contextUsageLevel = contextUsage.level;
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

  private getExistingClient(): PiRpcClientLike | undefined {
    if (!this.client?.isRunning()) {
      return undefined;
    }

    return this.client;
  }

  private getClient(): PiRpcClientLike {
    if (this.client) {
      return this.client;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const client = this.createClient({ cwd });
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
        void this.refreshSessionMeta();
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
    const action = mapMessageUpdate(event, this.getMessageUpdateStreamId(event), {
      fullCommunication: this.fullRpcAgentCommunication
    });

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

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);
      this.postState();
    }
  }

  private applyRpcActivity(event: RpcEvent): void {
    if (!this.session.isBusy && event.type !== 'agent_start') {
      return;
    }

    const action = mapRpcActivity(event, {
      fullCommunication: this.fullRpcAgentCommunication
    });

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);
    }
  }

  private applyActivityAction(action: ActivityUpdateAction | ActivityAddAction | ActivityRemoveAction): void {
    if (action.type === 'activity_update') {
      this.session.upsertActivity(action.sourceId, action.activity, action.bodyMode);
      return;
    }

    if (action.type === 'activity_remove') {
      this.session.removeActivity(action.sourceId);
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
      createWebviewStateMessage(
        this.session.snapshot(),
        this.modelLabel,
        this.contextUsageLabel,
        this.contextUsageTitle,
        this.contextUsageLevel,
        this.modelProvider,
        this.modelId,
        this.modelReasoning,
        this.thinkingLevel,
        this.modelOptions
      )
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

function getFullRpcAgentCommunicationSetting(): boolean {
  return vscode.workspace.getConfiguration('piui').get<boolean>(
    'fullRpcAgentCommunication',
    false
  );
}

function formatContextUsage(stats: PiSessionStats): { label: string; title: string; level: string } {
  const usage = stats.contextUsage;

  if (!usage || typeof usage.contextWindow !== 'number') {
    return { label: '', title: '', level: '' };
  }

  const percent = typeof usage.percent === 'number' ? Math.round(usage.percent) : undefined;
  const tokens = typeof usage.tokens === 'number' ? usage.tokens : undefined;

  if (percent === undefined && tokens === undefined) {
    return { label: '', title: '', level: '' };
  }

  const derivedPercent = percent ?? Math.round(((tokens ?? 0) / usage.contextWindow) * 100);
  const label = `${derivedPercent}%`;
  const titleTokens = tokens === undefined ? 'Unknown' : formatInteger(tokens);
  const title = [
    `Context used: ${derivedPercent}%`,
    `Current context: ${titleTokens} tokens`,
    `Model context size: ${formatInteger(usage.contextWindow)} tokens`
  ].join('\n');

  return { label, title, level: getContextUsageLevel(derivedPercent) };
}

function getContextUsageLevel(percent: number): string {
  if (percent >= 80) {
    return 'high';
  }

  if (percent >= 50) {
    return 'medium';
  }

  return 'low';
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function getModelMeta(state: PiSessionState): {
  label: string;
  provider: string;
  id: string;
  reasoning: boolean;
  thinkingLevel: string;
} {
  const model = state.model;
  const id = typeof model?.id === 'string' ? model.id : '';
  const provider = typeof model?.provider === 'string' ? model.provider : '';
  const reasoning = Boolean(model?.reasoning);
  const thinkingLevel = typeof state.thinkingLevel === 'string' ? state.thinkingLevel : '';

  if (!id) {
    return { label: '', provider, id, reasoning, thinkingLevel };
  }

  if (reasoning && thinkingLevel) {
    return { label: `${id} ${formatThinkingLevel(thinkingLevel)}`, provider, id, reasoning, thinkingLevel };
  }

  return { label: id, provider, id, reasoning, thinkingLevel };
}

function formatModelOptions(models: PiModel[] | undefined): { provider: string; id: string; name: string; reasoning: boolean }[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return models.flatMap((model) => {
    const provider = typeof model.provider === 'string' ? model.provider : '';
    const id = typeof model.id === 'string' ? model.id : '';

    if (!provider || !id) {
      return [];
    }

    return [{
      provider,
      id,
      name: typeof model.name === 'string' && model.name.length > 0 ? model.name : id,
      reasoning: Boolean(model.reasoning)
    }];
  });
}

function areModelOptionsEqual(
  left: { provider: string; id: string; name: string; reasoning: boolean }[],
  right: { provider: string; id: string; name: string; reasoning: boolean }[]
): boolean {
  return left.length === right.length
    && left.every((model, index) => {
      const other = right[index];
      return other
        && model.provider === other.provider
        && model.id === other.id
        && model.name === other.name
        && model.reasoning === other.reasoning;
    });
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
