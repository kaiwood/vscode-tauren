import { ChatSession } from './chatSession';
import {
  createWebviewStateMessage,
  type WebviewMessage,
  type WebviewModelOption,
  type WebviewStateMessage
} from './chatWebview';
import {
  StatePublisher,
  type StatePublisherScheduler
} from './statePublisher';
import {
  createCancellingExtensionUi,
  ExtensionUiRequestHandler,
  type ExtensionUiRequestUi
} from './extensionUiRequestHandler';
import {
  formatExtensionError,
  getFailedResponseError,
  mapMessageUpdate,
  mapRpcActivity,
  type ActivityAddAction,
  type ActivityRemoveAction,
  type ActivityUpdateAction
} from './piEventMapper';
import type {
  PiModel,
  PiRpcClient,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from './piRpcClient';

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
  | 'respondExtensionUiRequest'
  | 'dispose'
>;

export type PiRpcClientFactory = (options: PiRpcClientOptions) => PiRpcClientLike;

export type PiChatControllerOptions = {
  createClient: PiRpcClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  extensionUi?: ExtensionUiRequestUi;
  getCwd?: () => string | undefined;
  fullRpcAgentCommunication?: boolean;
  stateScheduler?: StatePublisherScheduler;
};

type DisposableLike = {
  dispose(): void;
};

export class PiChatController {
  private client: PiRpcClientLike | undefined;
  private assistantStreamId = 0;
  private modelLabel = '';
  private modelProvider = '';
  private modelId = '';
  private modelReasoning = false;
  private thinkingLevel = '';
  private modelOptions: WebviewModelOption[] = [];
  private contextUsageLabel = '';
  private contextUsageTitle = '';
  private contextUsageLevel = '';
  private fullRpcAgentCommunication: boolean;
  private readonly session = new ChatSession();
  private readonly clientDisposables: DisposableLike[] = [];
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private readonly extensionUiRequestHandler: ExtensionUiRequestHandler;

  public constructor(private readonly options: PiChatControllerOptions) {
    this.fullRpcAgentCommunication = options.fullRpcAgentCommunication ?? false;
    this.statePublisher = new StatePublisher(
      () => this.getStateMessage(),
      options.postState,
      options.stateScheduler
    );
    this.extensionUiRequestHandler = new ExtensionUiRequestHandler({
      ui: options.extensionUi ?? createCancellingExtensionUi(options.showNotification),
      respond: (response) => this.getExistingClient()?.respondExtensionUiRequest(response),
      onError: (message) => this.handleClientError(message)
    });
  }

  public dispose(): void {
    this.extensionUiRequestHandler.dispose();
    this.statePublisher.dispose();
    this.disposeClient();
  }

  public async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
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

  public startNewSession(): void {
    this.extensionUiRequestHandler.startNewGeneration();
    this.assistantStreamId = 0;
    this.resetSessionMeta();
    this.session.startNewSession();
    this.disposeClient();
    this.postState();
  }

  public setFullRpcAgentCommunication(value: boolean): void {
    this.fullRpcAgentCommunication = value;
    this.postState();
  }

  public postState(): void {
    this.statePublisher.flush();
  }

  public getStateMessage(): WebviewStateMessage {
    return createWebviewStateMessage({
      state: this.session.snapshot(),
      model: {
        label: this.modelLabel,
        provider: this.modelProvider,
        id: this.modelId,
        reasoning: this.modelReasoning,
        thinkingLevel: this.thinkingLevel,
        options: this.modelOptions
      },
      contextUsage: {
        label: this.contextUsageLabel,
        title: this.contextUsageTitle,
        level: this.contextUsageLevel
      }
    });
  }

  public async refreshSessionMeta(options: { startClient?: boolean } = {}): Promise<void> {
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

    const client = this.options.createClient({ cwd: this.options.getCwd?.() });
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
        this.scheduleState();
      }

      return;
    }

    if (action.type === 'assistant_error') {
      this.session.markActiveAssistantError(action.message);
      this.postState();
      return;
    }

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);

      if (action.type === 'activity_update' && action.bodyMode === 'append') {
        this.scheduleState();
      } else {
        this.postState();
      }
    }
  }

  private scheduleState(): void {
    this.statePublisher.schedule();
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
    void this.extensionUiRequestHandler.handle(event);
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

function formatModelOptions(models: PiModel[] | undefined): WebviewModelOption[] {
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

function areModelOptionsEqual(left: WebviewModelOption[], right: WebviewModelOption[]): boolean {
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
