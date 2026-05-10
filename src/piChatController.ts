import { ChatSession } from './chatSession';
import {
  createWebviewStateMessage,
  type WebviewMessage,
  type WebviewModelOption,
  type WebviewSlashCommand,
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
  PiCommand,
  PiModel,
  PiPromptStreamingBehavior,
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
  | 'abort'
  | 'reload'
  | 'isRunning'
  | 'getState'
  | 'getSessionStats'
  | 'getAvailableModels'
  | 'getCommands'
  | 'setModel'
  | 'setThinkingLevel'
  | 'setSessionName'
  | 'compact'
  | 'exportHtml'
  | 'getLastAssistantText'
  | 'respondExtensionUiRequest'
  | 'dispose'
>;

export type PiRpcClientFactory = (options: PiRpcClientOptions) => PiRpcClientLike;

export type PiChatModelMeta = {
  label: string;
  provider: string;
  id: string;
  reasoning: boolean;
  thinkingLevel: string;
};

export type PiChatContextUsage = {
  label: string;
  title: string;
  level: string;
};

export type PiChatSessionMetaSnapshot = {
  model?: PiChatModelMeta;
  modelOptions?: WebviewModelOption[];
  contextUsage?: PiChatContextUsage;
};

export type PiChatControllerOptions = {
  createClient: PiRpcClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  extensionUi?: ExtensionUiRequestUi;
  getCwd?: () => string | undefined;
  fullRpcAgentCommunication?: boolean;
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  onSessionMetaChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
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
  private metadataRefreshing = false;
  private slashCommands: WebviewSlashCommand[] = [];
  private slashCommandsRefreshing = false;
  private metadataRefreshSequence = 0;
  private slashCommandsRefreshSequence = 0;
  private nextClientSessionFile: string | undefined;
  private abortRequested = false;
  private abortNoticeAdded = false;
  private metadataRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private slashCommandsRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private fullRpcAgentCommunication: boolean;
  private readonly session = new ChatSession();
  private readonly clientDisposables: DisposableLike[] = [];
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private readonly extensionUiRequestHandler: ExtensionUiRequestHandler;

  public constructor(private readonly options: PiChatControllerOptions) {
    this.fullRpcAgentCommunication = options.fullRpcAgentCommunication ?? false;

    if (options.initialSessionMeta) {
      this.setSessionMetaFields(options.initialSessionMeta);
    }

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
      void this.refreshSessionMeta({ startClient: true });
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

    if (message.type === 'refreshSlashCommands') {
      if (!this.session.isBusy) {
        await this.refreshSlashCommands({ startClient: true });
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

    if (message.type === 'abort') {
      await this.abortActivePrompt();
      return;
    }

    if (message.type !== 'submit') {
      return;
    }

    const localSlashCommand = parseLocalSlashCommand(message.text);

    if (this.session.isBusy) {
      if (localSlashCommand) {
        this.addBusySlashCommandNotice(localSlashCommand.name);
        return;
      }

      await this.queuePromptWhileBusy(message.text, message.streamingBehavior ?? 'steer');
      return;
    }

    if (localSlashCommand) {
      await this.handleLocalSlashCommand(localSlashCommand);
      return;
    }

    const submittedPrompt = this.session.beginSubmit(message.text);

    if (!submittedPrompt) {
      return;
    }

    this.resetAbortState();
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
    this.resetAbortState();
    this.session.startNewSession();
    this.nextClientSessionFile = undefined;
    this.resetSessionMeta();
    this.disposeClient();
    this.postState();
    void this.refreshSessionMeta({ startClient: true });
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
      slashCommands: this.slashCommands,
      slashCommandsRefreshing: this.slashCommandsRefreshing,
      contextUsage: {
        label: this.contextUsageLabel,
        title: this.contextUsageTitle,
        level: this.contextUsageLevel
      },
      metadataRefreshing: this.metadataRefreshing
    });
  }

  public refreshSessionMeta(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.session.generation;
    const existingRefresh = this.metadataRefreshInFlight;

    if (!options.force && existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    const refreshId = ++this.metadataRefreshSequence;
    let refreshPromise!: Promise<void>;

    refreshPromise = this.runSessionMetaRefresh(options, sessionGeneration, refreshId)
      .finally(() => {
        if (this.metadataRefreshInFlight?.promise === refreshPromise) {
          this.metadataRefreshInFlight = undefined;
        }
      });

    this.metadataRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

    return refreshPromise;
  }

  public refreshSlashCommands(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.session.generation;
    const existingRefresh = this.slashCommandsRefreshInFlight;

    if (!options.force && existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    const refreshId = ++this.slashCommandsRefreshSequence;
    let refreshPromise!: Promise<void>;

    refreshPromise = this.runSlashCommandsRefresh(options, sessionGeneration, refreshId)
      .finally(() => {
        if (this.slashCommandsRefreshInFlight?.promise === refreshPromise) {
          this.slashCommandsRefreshInFlight = undefined;
        }
      });

    this.slashCommandsRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

    return refreshPromise;
  }

  private async runSessionMetaRefresh(
    options: { startClient?: boolean },
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    let client: PiRpcClientLike | undefined;

    try {
      client = options.startClient ? this.getClient() : this.getExistingClient();
    } catch (error) {
      if (sessionGeneration === this.session.generation) {
        this.handleClientError(getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    this.setMetadataRefreshing(true);

    let handledError = false;
    const handleRefreshError = (error: unknown): void => {
      if (handledError || !this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        return;
      }

      handledError = true;
      this.handleClientError(getErrorMessage(error));
    };

    try {
      await Promise.all([
        this.refreshModelMeta(client, sessionGeneration, refreshId),
        this.refreshContextUsage(client, sessionGeneration, refreshId),
        this.refreshModelOptions(client, sessionGeneration, refreshId)
      ].map((refresh) => refresh.catch(handleRefreshError)));
    } finally {
      if (this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        this.setMetadataRefreshing(false);
      }
    }
  }

  private async refreshModelMeta(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const state = await client.getState();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    if (this.applyModelMeta(getModelMeta(state))) {
      this.postState();
    }
  }

  private async refreshContextUsage(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const stats = await client.getSessionStats();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    if (this.applyContextUsage(formatContextUsage(stats))) {
      this.postState();
    }
  }

  private async refreshModelOptions(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const availableModels = await client.getAvailableModels();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    if (this.applyModelOptions(formatModelOptions(availableModels.models))) {
      this.postState();
    }
  }

  private async runSlashCommandsRefresh(
    options: { startClient?: boolean },
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    let client: PiRpcClientLike | undefined;

    try {
      client = options.startClient ? this.getClient() : this.getExistingClient();
    } catch (error) {
      if (sessionGeneration === this.session.generation) {
        this.handleClientError(getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    this.setSlashCommandsRefreshing(true);

    try {
      const availableCommands = await client.getCommands();

      if (!this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        return;
      }

      if (this.applySlashCommands(formatSlashCommands(availableCommands.commands))) {
        this.postState();
      }
    } catch (error) {
      if (this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        this.handleClientError(getErrorMessage(error));
      }
    } finally {
      if (this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        this.setSlashCommandsRefreshing(false);
      }
    }
  }

  private isCurrentMetadataRefresh(sessionGeneration: number, refreshId: number): boolean {
    return sessionGeneration === this.session.generation
      && refreshId === this.metadataRefreshSequence;
  }

  private isCurrentSlashCommandRefresh(sessionGeneration: number, refreshId: number): boolean {
    return sessionGeneration === this.session.generation
      && refreshId === this.slashCommandsRefreshSequence;
  }

  private applyModelMeta(modelMeta: PiChatModelMeta): boolean {
    if (
      modelMeta.label === this.modelLabel
      && modelMeta.provider === this.modelProvider
      && modelMeta.id === this.modelId
      && modelMeta.reasoning === this.modelReasoning
      && modelMeta.thinkingLevel === this.thinkingLevel
    ) {
      return false;
    }

    this.setModelMetaFields(modelMeta);
    this.notifySessionMetaChange();
    return true;
  }

  private setModelMetaFields(modelMeta: PiChatModelMeta): void {
    this.modelLabel = modelMeta.label;
    this.modelProvider = modelMeta.provider;
    this.modelId = modelMeta.id;
    this.modelReasoning = modelMeta.reasoning;
    this.thinkingLevel = modelMeta.thinkingLevel;
  }

  private applyContextUsage(contextUsage: PiChatContextUsage): boolean {
    if (
      contextUsage.label === this.contextUsageLabel
      && contextUsage.title === this.contextUsageTitle
      && contextUsage.level === this.contextUsageLevel
    ) {
      return false;
    }

    this.contextUsageLabel = contextUsage.label;
    this.contextUsageTitle = contextUsage.title;
    this.contextUsageLevel = contextUsage.level;
    this.notifySessionMetaChange();
    return true;
  }

  private applyModelOptions(modelOptions: WebviewModelOption[]): boolean {
    if (areModelOptionsEqual(modelOptions, this.modelOptions)) {
      return false;
    }

    this.modelOptions = modelOptions;
    this.notifySessionMetaChange();
    return true;
  }

  private applySlashCommands(slashCommands: WebviewSlashCommand[]): boolean {
    if (areSlashCommandsEqual(slashCommands, this.slashCommands)) {
      return false;
    }

    this.slashCommands = slashCommands;
    return true;
  }

  private setSessionMetaFields(snapshot: PiChatSessionMetaSnapshot): void {
    if (snapshot.model) {
      this.setModelMetaFields(snapshot.model);
    }

    if (snapshot.modelOptions) {
      this.modelOptions = snapshot.modelOptions.map((modelOption) => ({ ...modelOption }));
    }

    if (snapshot.contextUsage) {
      this.contextUsageLabel = snapshot.contextUsage.label;
      this.contextUsageTitle = snapshot.contextUsage.title;
      this.contextUsageLevel = snapshot.contextUsage.level;
    }
  }

  private notifySessionMetaChange(): void {
    this.options.onSessionMetaChange?.(this.getSessionMetaSnapshot());
  }

  private getSessionMetaSnapshot(): PiChatSessionMetaSnapshot {
    return {
      model: this.modelId
        ? {
          label: this.modelLabel,
          provider: this.modelProvider,
          id: this.modelId,
          reasoning: this.modelReasoning,
          thinkingLevel: this.thinkingLevel
        }
        : undefined,
      modelOptions: this.modelOptions.map((modelOption) => ({ ...modelOption })),
      contextUsage: this.contextUsageLabel
        ? {
          label: this.contextUsageLabel,
          title: this.contextUsageTitle,
          level: this.contextUsageLevel
        }
        : undefined
    };
  }

  private setMetadataRefreshing(value: boolean): void {
    if (this.metadataRefreshing === value) {
      return;
    }

    this.metadataRefreshing = value;
    this.postState();
  }

  private setSlashCommandsRefreshing(value: boolean): void {
    if (this.slashCommandsRefreshing === value) {
      return;
    }

    this.slashCommandsRefreshing = value;
    this.postState();
  }

  private async queuePromptWhileBusy(
    text: string,
    streamingBehavior: PiPromptStreamingBehavior
  ): Promise<void> {
    const trimmedText = text.trim();

    if (!trimmedText || !this.session.isBusy) {
      return;
    }

    const sessionGeneration = this.session.generation;

    try {
      await this.getClient().prompt(trimmedText, streamingBehavior);

      if (sessionGeneration !== this.session.generation) {
        return;
      }

      this.session.addActivity({
        kind: 'queue',
        title: streamingBehavior === 'followUp' ? 'Follow-up queued' : 'Steering queued',
        status: 'info',
        summary: trimmedText
      });
      this.postState();
    } catch (error) {
      if (sessionGeneration !== this.session.generation) {
        return;
      }

      this.session.addActivity({
        kind: 'queue',
        title: streamingBehavior === 'followUp' ? 'Failed to queue follow-up' : 'Failed to queue steering',
        status: 'error',
        summary: getErrorMessage(error)
      });
      this.postState();
    }
  }

  private addBusySlashCommandNotice(commandName: string): void {
    this.session.addActivity({
      kind: 'queue',
      title: `/${commandName} not queued`,
      status: 'error',
      summary: 'Sidebar commands are not available while Pi is working.'
    });
    this.postState();
  }

  private async handleLocalSlashCommand(command: { name: string; args: string }): Promise<void> {
    if (!supportedBuiltinSlashCommandNames.has(command.name)) {
      this.session.addSystemMessage(`/${command.name} is a Pi terminal command that is not supported in the VS Code sidebar yet.`);
      this.postState();
      return;
    }

    try {
      switch (command.name) {
        case 'new':
          this.startNewSession();
          return;
        case 'model':
          await this.handleModelSlashCommand(command.args);
          return;
        case 'name':
          await this.handleNameSlashCommand(command.args);
          return;
        case 'session':
          await this.handleSessionSlashCommand();
          return;
        case 'copy':
          await this.handleCopySlashCommand();
          return;
        case 'compact':
          await this.handleCompactSlashCommand(command.args);
          return;
        case 'reload':
          await this.handleReloadSlashCommand();
          return;
        case 'export':
          await this.handleExportSlashCommand(command.args);
          return;
        default:
          return;
      }
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private async handleModelSlashCommand(query: string): Promise<void> {
    if (this.session.isBusy) {
      return;
    }

    if (this.modelOptions.length === 0) {
      await this.refreshSessionMeta({ startClient: true, force: true });
    }

    const matches = filterModelOptions(this.modelOptions, query);

    if (matches.length === 0) {
      this.session.addSystemMessage(query ? `No model matched "${query}".` : 'No models are available yet.');
      this.postState();
      return;
    }

    let selected = matches.length === 1 ? matches[0] : undefined;

    if (!selected) {
      const labels = matches.map(formatModelOptionLabel);
      const picked = await this.options.extensionUi?.select?.('Select Pi model', labels);

      if (!picked) {
        return;
      }

      selected = matches[labels.indexOf(picked)];
    }

    if (!selected) {
      return;
    }

    await this.setModel(selected.provider, selected.id);
  }

  private async handleNameSlashCommand(name: string): Promise<void> {
    await this.getClient().setSessionName(name);
    this.session.addSystemMessage(name ? `Session name set to "${name}".` : 'Session name cleared.');
    this.postState();
    void this.refreshSessionMeta({ startClient: true, force: true });
  }

  private async handleSessionSlashCommand(): Promise<void> {
    const client = this.getClient();
    const [state, stats] = await Promise.all([
      client.getState(),
      client.getSessionStats()
    ]);

    this.session.addSystemMessage(formatSessionInfo(state, stats));
    this.postState();
  }

  private async handleCopySlashCommand(): Promise<void> {
    const result = await this.getClient().getLastAssistantText();
    const text = typeof result.text === 'string' ? result.text : '';

    if (!text) {
      this.options.showNotification('No assistant message to copy.', 'warning');
      return;
    }

    if (!this.options.writeClipboard) {
      this.options.showNotification('Copy is not available in this environment.', 'warning');
      return;
    }

    await this.options.writeClipboard(text);
    this.options.showNotification('Copied last Pi response.', 'info');
  }

  private async handleCompactSlashCommand(customInstructions: string): Promise<void> {
    const result = await this.getClient().compact(customInstructions || undefined);
    const summary = typeof result.summary === 'string' && result.summary
      ? `\n\n${result.summary}`
      : '';
    this.session.addSystemMessage(`Compacted session context.${summary}`);
    this.postState();
    void this.refreshSessionMeta({ startClient: true, force: true });
  }

  private async handleExportSlashCommand(outputPath: string): Promise<void> {
    const result = await this.getClient().exportHtml(outputPath || undefined);
    const path = typeof result.path === 'string' && result.path ? result.path : 'HTML file';
    this.session.addSystemMessage(`Exported session to ${path}.`);
    this.postState();
  }

  private async handleReloadSlashCommand(): Promise<void> {
    this.session.addSystemMessage('Reloading Pi resources...');
    this.postState();

    let restartedClient = false;
    let restoredSession = false;
    const client = this.getClient();

    try {
      await client.reload();
    } catch (error) {
      if (!isUnsupportedReloadCommandError(error)) {
        throw error;
      }

      const sessionFile = getSessionFile(await client.getState());
      restartedClient = true;
      restoredSession = Boolean(sessionFile);
      this.nextClientSessionFile = sessionFile;
      this.disposeClient();
      this.session.addSystemMessage(sessionFile
        ? 'Pi RPC reload is not supported by this Pi version; restarted Pi and reconnected to the current session.'
        : 'Pi RPC reload is not supported by this Pi version; restarted Pi without a persisted session to reconnect.');
      this.postState();
    }

    await Promise.all([
      this.refreshSessionMeta({ startClient: true, force: true }),
      this.refreshSlashCommands({ startClient: true, force: true })
    ]);

    this.session.addSystemMessage(restartedClient
      ? restoredSession
        ? 'Reloaded skills, prompts, extensions, metadata, and restored LLM session context.'
        : 'Reloaded skills, prompts, extensions, and metadata by restarting Pi.'
      : 'Reloaded keybindings, extensions, skills, prompts, and themes.');
    this.postState();
  }

  private async setModel(provider: string, modelId: string): Promise<void> {
    if (this.session.isBusy) {
      return;
    }

    try {
      await this.getClient().setModel(provider, modelId);
      await this.refreshSessionMeta({ startClient: true, force: true });
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
      await this.refreshSessionMeta({ startClient: true, force: true });
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private async abortActivePrompt(): Promise<void> {
    if (!this.session.isBusy) {
      return;
    }

    const client = this.getExistingClient();

    if (!client) {
      return;
    }

    this.abortRequested = true;

    try {
      await client.abort();
    } catch (error) {
      this.resetAbortState();
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private appendAbortNoticeIfNeeded(): void {
    if (!this.abortRequested || this.abortNoticeAdded) {
      return;
    }

    this.abortNoticeAdded = this.session.appendAssistantNotice('Aborted.');
  }

  private resetAbortState(): void {
    this.abortRequested = false;
    this.abortNoticeAdded = false;
  }

  private resetSessionMeta(): void {
    const changed = Boolean(this.contextUsageLabel || this.contextUsageTitle || this.contextUsageLevel);
    this.contextUsageLabel = '';
    this.contextUsageTitle = '';
    this.contextUsageLevel = '';

    if (changed) {
      this.notifySessionMetaChange();
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

    const sessionFile = this.nextClientSessionFile;
    this.nextClientSessionFile = undefined;
    const clientOptions: PiRpcClientOptions = { cwd: this.options.getCwd?.() };

    if (sessionFile) {
      clientOptions.sessionFile = sessionFile;
    }

    const client = this.options.createClient(clientOptions);
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
        this.appendAbortNoticeIfNeeded();
        this.session.handleAgentEnd();
        this.resetAbortState();
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
      if (this.abortRequested && isAbortMessage(action.message)) {
        this.appendAbortNoticeIfNeeded();
      } else {
        this.session.markActiveAssistantError(action.message);
      }

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
    this.metadataRefreshing = false;
    this.slashCommandsRefreshing = false;
    this.postState();
  }
}

function formatContextUsage(stats: PiSessionStats): PiChatContextUsage {
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

function getSessionFile(state: PiSessionState): string | undefined {
  return typeof state.sessionFile === 'string' && state.sessionFile
    ? state.sessionFile
    : undefined;
}

function getModelMeta(state: PiSessionState): PiChatModelMeta {
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

const blacklistedSlashCommandNames = new Set<string>([
  // Future: add commands known to be TUI-only or confusing in VS Code.
]);

function formatSlashCommands(commands: PiCommand[] | undefined): WebviewSlashCommand[] {
  if (!Array.isArray(commands)) {
    return [];
  }

  return commands
    .flatMap((command) => {
      const name = typeof command.name === 'string' ? command.name.trim() : '';

      if (!name || isBlacklistedSlashCommand(command)) {
        return [];
      }

      return [{
        name,
        description: typeof command.description === 'string' ? command.description : '',
        source: typeof command.source === 'string' ? command.source : '',
        location: typeof command.location === 'string' ? command.location : undefined,
        path: typeof command.path === 'string' ? command.path : undefined
      }];
    })
    .sort(compareSlashCommands);
}

function isBlacklistedSlashCommand(command: PiCommand): boolean {
  const name = typeof command.name === 'string' ? command.name.trim() : '';
  return blacklistedSlashCommandNames.has(name);
}

function compareSlashCommands(left: WebviewSlashCommand, right: WebviewSlashCommand): number {
  return getSlashCommandSourceRank(left.source) - getSlashCommandSourceRank(right.source)
    || left.name.localeCompare(right.name);
}

function getSlashCommandSourceRank(source: string): number {
  if (source === 'extension') {
    return 0;
  }

  if (source === 'prompt') {
    return 1;
  }

  if (source === 'skill') {
    return 2;
  }

  return 3;
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

function areSlashCommandsEqual(left: WebviewSlashCommand[], right: WebviewSlashCommand[]): boolean {
  return left.length === right.length
    && left.every((command, index) => {
      const other = right[index];
      return other
        && command.name === other.name
        && command.description === other.description
        && command.source === other.source
        && command.location === other.location
        && command.path === other.path;
    });
}

const builtinSlashCommandNames = new Set([
  'settings',
  'model',
  'scoped-models',
  'export',
  'import',
  'share',
  'copy',
  'name',
  'session',
  'changelog',
  'hotkeys',
  'fork',
  'clone',
  'tree',
  'login',
  'logout',
  'new',
  'compact',
  'resume',
  'reload',
  'quit'
]);

const supportedBuiltinSlashCommandNames = new Set([
  'model',
  'export',
  'copy',
  'name',
  'session',
  'new',
  'compact',
  'reload'
]);

function parseLocalSlashCommand(text: string): { name: string; args: string } | undefined {
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return undefined;
  }

  const name = match[1];

  if (!builtinSlashCommandNames.has(name)) {
    return undefined;
  }

  return { name, args: match[2]?.trim() ?? '' };
}

function filterModelOptions(modelOptions: WebviewModelOption[], query: string): WebviewModelOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return modelOptions;
  }

  return modelOptions.filter((model) => {
    const providerAndId = `${model.provider}/${model.id}`.toLowerCase();
    const id = model.id.toLowerCase();
    const name = model.name.toLowerCase();
    return providerAndId === normalizedQuery
      || id === normalizedQuery
      || name === normalizedQuery
      || providerAndId.includes(normalizedQuery)
      || id.includes(normalizedQuery)
      || name.includes(normalizedQuery);
  });
}

function formatModelOptionLabel(model: WebviewModelOption): string {
  return model.name && model.name !== model.id
    ? `${model.name} (${model.provider}/${model.id})`
    : `${model.provider}/${model.id}`;
}

function formatSessionInfo(state: PiSessionState, stats: PiSessionStats): string {
  const lines = ['Session'];
  const sessionName = state.sessionName ?? stats.sessionName;
  const sessionId = state.sessionId ?? stats.sessionId;
  const sessionFile = state.sessionFile ?? stats.sessionFile;

  if (sessionName) {
    lines.push(`Name: ${sessionName}`);
  }

  if (sessionId) {
    lines.push(`ID: ${sessionId}`);
  }

  if (sessionFile) {
    lines.push(`File: ${sessionFile}`);
  }

  if (typeof state.messageCount === 'number') {
    lines.push(`Messages: ${formatInteger(state.messageCount)}`);
  } else if (typeof stats.totalMessages === 'number') {
    lines.push(`Messages: ${formatInteger(stats.totalMessages)}`);
  }

  if (typeof stats.toolCalls === 'number') {
    lines.push(`Tool calls: ${formatInteger(stats.toolCalls)}`);
  }

  if (typeof stats.cost === 'number') {
    lines.push(`Cost: $${stats.cost.toFixed(4)}`);
  }

  const contextUsage = formatContextUsage(stats);

  if (contextUsage.label) {
    lines.push(`Context used: ${contextUsage.label}`);
  }

  return lines.join('\n');
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

function isUnsupportedReloadCommandError(error: unknown): boolean {
  return /unknown command:?\s+reload/i.test(getErrorMessage(error));
}

function isAbortMessage(message: string): boolean {
  return message.trim().toLowerCase() === 'aborted';
}

function isMessageUpdateStart(event: RpcEvent): boolean {
  const assistantMessageEvent = event.assistantMessageEvent;

  return typeof assistantMessageEvent === 'object'
    && assistantMessageEvent !== null
    && 'type' in assistantMessageEvent
    && assistantMessageEvent.type === 'start';
}
