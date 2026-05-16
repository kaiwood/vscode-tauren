import { ChatSession } from './chatSession';
import { createWebviewStateMessage } from './sidebar/chatWebview';
import type {
  WebviewMessage,
  WebviewSessionItem,
  WebviewStateMessage,
  WebviewTreeItem
} from './sidebar/types';
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
import type { PiRpcClient } from './rpc/client';
import type {
  PiPromptStreamingBehavior,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from './rpc/types';
import { formatPromptForPi as formatPromptForPiMessage } from './prompt/formatting';
import { PromptContextStore } from './prompt/contextStore';
import type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';
import { isSupportedBuiltinSlashCommand } from './slashCommands';
import { ReadyScriptState } from './readyScript';
import {
  SessionMetadataRefreshController,
  SessionMetadataState,
  type PiChatSessionMetaSnapshot
} from './sessionMetadata';
import { SessionDiffController } from './diff/sessionDiffController';
import type { SessionDiffSnapshot } from './diff/types';
import {
  getErrorMessage,
  isAbortMessage,
  isClientLifecycleError,
  isMessageUpdateStart,
  isUnsupportedReloadCommandError
} from './controller/errors';
import { filterModelOptions, formatModelOptionLabel } from './controller/modelFormatting';
import { parseLocalSlashCommand } from './controller/slashCommandParsing';
import {
  formatForkMessageLabel,
  formatForkMessages,
  formatSessionInfo,
  getSessionFile
} from './controller/sessionFormatting';
import { SessionViewController } from './controller/sessionViewController';
import { formatAgentMessages, type RestoredToolCall } from './controller/transcriptFormatting';
import { getRecordString, isRecord } from './controller/typeGuards';

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
  | 'getMessages'
  | 'switchSession'
  | 'navigateTree'
  | 'getForkMessages'
  | 'fork'
  | 'clone'
  | 'respondExtensionUiRequest'
  | 'dispose'
>;

export type PiRpcClientFactory = (options: PiRpcClientOptions) => PiRpcClientLike;

export type { PiChatContextUsage, PiChatModelMeta, PiChatSessionMetaSnapshot } from './sessionMetadata';

export type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';

export type PiChatControllerOptions = {
  createClient: PiRpcClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string) => void;
  extensionUi?: ExtensionUiRequestUi;
  getCwd?: () => string | undefined;
  getPiPath?: () => string | undefined;
  getOutputColors?: () => boolean;
  getReadyScript?: () => string | undefined;
  getReadyScriptEnabled?: () => boolean;
  runReadyScript?: (scriptPath: string, cwd: string | undefined) => void;
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
  listSessions?: (cwd: string | undefined, currentSessionFile: string | undefined) => Promise<WebviewSessionItem[]>;
  listSessionTree?: (sessionFile: string | undefined) => Promise<WebviewTreeItem[]>;
  deleteSession?: (sessionPath: string, displayName: string) => Promise<boolean>;
  showSessionChanges?: (sessionPath: string, displayName: string) => Promise<void>;
  loadSessionDiffSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSessionDiffSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
};

type DisposableLike = {
  dispose(): void;
};

export class PiChatController {
  private client: PiRpcClientLike | undefined;
  private assistantStreamId = 0;
  private readonly promptContext = new PromptContextStore();
  private readonly sessionMetadata: SessionMetadataState;
  private readonly sessionMetadataRefresh: SessionMetadataRefreshController;
  private readonly sessionView: SessionViewController;
  private pendingComposerText: { text: string; revision: number } | undefined;
  private composerTextRevision = 0;
  private nextClientSessionFile: string | undefined;
  private shouldRestoreInitialSessionHistory: boolean;
  private sessionHistoryLoading: boolean;
  private restartClientWhenIdle = false;
  private abortRequested = false;
  private abortNoticeAdded = false;
  private compacting = false;
  private readonly sessionDiffController: SessionDiffController;
  private readonly readyScriptState = new ReadyScriptState();
  private readonly liveToolCallsById = new Map<string, RestoredToolCall>();
  private readonly session = new ChatSession();
  private readonly clientDisposables: DisposableLike[] = [];
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private readonly extensionUiRequestHandler: ExtensionUiRequestHandler;

  public constructor(private readonly options: PiChatControllerOptions) {
    this.shouldRestoreInitialSessionHistory = Boolean(options.initialSessionFile);
    this.sessionHistoryLoading = Boolean(options.initialSessionFile);

    this.sessionDiffController = new SessionDiffController({
      initialSessionFile: options.initialSessionFile,
      getSessionGeneration: () => this.session.generation,
      postState: () => this.postState(),
      loadSnapshot: (sessionFile) => this.options.loadSessionDiffSnapshot?.(sessionFile),
      saveSnapshot: (sessionFile, snapshot) => this.options.saveSessionDiffSnapshot?.(sessionFile, snapshot)
    });

    this.sessionView = new SessionViewController({
      createClient: options.createClient,
      deleteSession: options.deleteSession,
      extensionUi: options.extensionUi,
      getCwd: options.getCwd,
      getPiPath: options.getPiPath,
      initialSessionFile: options.initialSessionFile,
      listSessions: options.listSessions,
      listSessionTree: options.listSessionTree,
      onSessionFileChange: options.onSessionFileChange,
      showNotification: options.showNotification,
      showSessionChanges: options.showSessionChanges,
      showToast: options.showToast,
      applySessionFile: (sessionFile) => this.sessionDiffController.applySessionFile(sessionFile),
      adoptReplacedSession: (adoptOptions) => this.adoptReplacedSession(adoptOptions),
      getClient: () => this.getClient(),
      handleCompactCurrentSession: () => this.handleCompactSlashCommand(''),
      isBusy: () => this.session.isBusy,
      postState: () => this.postState(),
      setComposerText: (text) => this.setComposerText(text),
      setCurrentSessionName: (name, nameOptions) => this.setCurrentSessionName(name, nameOptions),
      setSessionHistoryLoading: (value) => {
        this.sessionHistoryLoading = value;
      },
      startNewSession: (sessionOptions) => this.startNewSession(sessionOptions)
    });

    this.sessionMetadata = new SessionMetadataState({
      initialSessionMeta: options.initialSessionMeta,
      onChange: (metadata) => this.options.onSessionMetaChange?.(metadata),
      postState: () => this.postState()
    });
    this.sessionMetadataRefresh = new SessionMetadataRefreshController({
      state: this.sessionMetadata,
      getSessionGeneration: () => this.session.generation,
      getClient: ({ startClient }) => startClient ? this.getClient() : this.getExistingClient(),
      restoreInitialSessionHistory: (client, sessionGeneration, isCurrent) => this.restoreInitialSessionHistory(client, sessionGeneration, isCurrent),
      applySessionState: (state) => this.applySessionStateIdentity(state),
      applySessionStatsIdentity: (stats) => this.applySessionStatsIdentity(stats),
      refreshSessions: () => void this.sessionView.refreshSessions(),
      postState: () => this.postState(),
      onMetadataStartError: (message) => {
        this.sessionHistoryLoading = false;
        this.handleClientError(message);
      },
      onError: (message) => this.handleClientError(message),
      getErrorMessage
    });

    this.statePublisher = new StatePublisher(
      () => this.getStateMessage(),
      (message) => {
        options.postState(message);
        this.clearPostedComposerText(message);
      },
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
    switch (message.type) {
      case 'ready':
        this.postState();
        void this.refreshSessionDiffStats();
        void this.refreshSessionMeta({ startClient: true });
        void this.sessionView.refreshSessions();
        return;
      case 'newSession':
        this.startNewSession();
        return;
      case 'showSessions':
        this.sessionView.showSessions();
        return;
      case 'hideSessions':
        this.sessionView.hideSessions();
        return;
      case 'refreshSessions':
        await this.sessionView.refreshSessions();
        return;
      case 'showCurrentChanges':
        await this.sessionView.showCurrentSessionChanges();
        return;
      case 'selectSession':
        await this.sessionView.switchSession(message.sessionPath);
        return;
      case 'deleteSession':
        await this.sessionView.deleteSession(message.sessionPath);
        return;
      case 'sessionItemCommand':
        await this.sessionView.runSessionItemCommand(message.sessionPath, message.command);
        return;
      case 'setSessionItemName':
        await this.sessionView.setSessionItemName(message.sessionPath, message.name);
        return;
      case 'selectTreeEntry':
        await this.sessionView.navigateTree(message.entryId);
        return;
      case 'setSessionName':
        await this.setSessionNameFromWebview(message.name);
        return;
      case 'refreshMetadata':
        if (!this.session.isBusy) {
          await this.refreshSessionMeta({ startClient: true });
        }
        return;
      case 'refreshSlashCommands':
        if (!this.session.isBusy) {
          await this.refreshSlashCommands({ startClient: true });
        }
        return;
      case 'setModel':
        await this.setModel(message.provider, message.modelId);
        return;
      case 'setThinkingLevel':
        await this.setThinkingLevel(message.level);
        return;
      case 'removePromptContext':
        this.removePromptContext(message.id);
        return;
      case 'abort':
        await this.abortActivePrompt();
        return;
      case 'copyText':
        await this.copyTextFromWebview(message.text);
        return;
      case 'submit':
        await this.handleSubmitMessage(message);
        return;
      default:
        return;
    }
  }

  private async handleSubmitMessage(message: Extract<WebviewMessage, { type: 'submit' }>): Promise<void> {
    const localSlashCommand = parseLocalSlashCommand(message.text);

    if (this.session.isBusy) {
      if (this.compacting) {
        this.addCompactionBusyNotice();
        return;
      }

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

    if (this.shouldRestoreInitialSessionHistory) {
      await this.refreshSessionMeta({ startClient: true });
    }

    const submittedPrompt = this.session.beginSubmit(message.text);

    if (!submittedPrompt) {
      return;
    }

    const promptContext = this.consumePromptContext();
    const promptText = this.formatPromptForPi(submittedPrompt.text, promptContext);

    this.resetAbortState();
    void this.refreshSessionDiffStats();
    this.postState();

    const previousReadyScriptArmed = this.armReadyScriptForUserPrompt();

    try {
      await this.getClient().prompt(promptText);
    } catch (error) {
      this.restoreReadyScriptArming(previousReadyScriptArmed);
      if (submittedPrompt.sessionGeneration !== this.session.generation) {
        return;
      }

      this.restorePromptContext(promptContext);
      this.session.failActivePrompt(getErrorMessage(error));
      this.postState();
    }
  }

  public async runLocalSlashCommand(name: string, args = ''): Promise<void> {
    if (this.session.isBusy) {
      this.addBusySlashCommandNotice(name);
      return;
    }

    await this.handleLocalSlashCommand({ name, args });
  }

  public startNewSession(options: { viewMode?: 'chat' | 'sessions' } = {}): void {
    if (this.session.isBusy) {
      this.addBusySlashCommandNotice('new');
      return;
    }

    this.extensionUiRequestHandler.startNewGeneration();
    this.assistantStreamId = 0;
    this.liveToolCallsById.clear();
    this.resetAbortState();
    this.session.startNewSession();
    this.sessionView.startNewSession(options.viewMode ?? 'chat');
    this.sessionDiffController.reset(undefined);
    this.nextClientSessionFile = undefined;
    this.shouldRestoreInitialSessionHistory = false;
    this.sessionHistoryLoading = false;
    this.restartClientWhenIdle = false;
    this.resetReadyScriptArming();
    this.resetSessionMeta();
    this.disposeClient();
    this.postState();
    void this.refreshSessionMeta({ startClient: true });
  }

  public handlePiPathChanged(): void {
    if (!this.client) {
      return;
    }

    this.restartClientWhenIdle = true;

    if (this.session.isBusy) {
      return;
    }

    void this.refreshSessionMeta({ force: true }).then(
      () => this.restartClientForConfigurationChangeIfIdle(),
      () => this.restartClientForConfigurationChangeIfIdle()
    );
  }

  public postState(): void {
    this.statePublisher.flush();
  }

  public addPromptContext(context: PiPromptContextInput | PiPromptContextInput[]): void {
    if (!this.promptContext.add(context)) {
      return;
    }

    this.sessionView.showChat({ clearSessionsError: true });
    this.postState();
  }

  public removePromptContext(id: string): void {
    if (this.promptContext.remove(id)) {
      this.postState();
    }
  }

  private clearPostedComposerText(message: WebviewStateMessage): void {
    if (this.pendingComposerText && message.composerTextRevision === this.pendingComposerText.revision) {
      this.pendingComposerText = undefined;
    }
  }

  public getStateMessage(): WebviewStateMessage {
    const metadataState = this.sessionMetadata.getWebviewState();

    return createWebviewStateMessage({
      state: this.session.snapshot(),
      model: metadataState.model,
      slashCommands: metadataState.slashCommands,
      slashCommandsRefreshing: metadataState.slashCommandsRefreshing,
      outputColors: this.options.getOutputColors?.() ?? true,
      promptContext: this.promptContext.getWebviewAttachments(),
      composer: this.pendingComposerText
        ? {
          text: this.pendingComposerText.text,
          revision: this.pendingComposerText.revision
        }
        : undefined,
      contextUsage: metadataState.contextUsage,
      metadataRefreshing: metadataState.metadataRefreshing,
      workspaceDiffStats: this.sessionDiffController.getStats(),
      sessionView: this.sessionView.getWebviewState(this.sessionHistoryLoading)
    });
  }

  private consumePromptContext(): PiPromptContextAttachment[] {
    return this.promptContext.consume();
  }

  private restorePromptContext(context: PiPromptContextAttachment[]): void {
    this.promptContext.restore(context);
  }

  public refreshSessionMeta(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    return this.sessionMetadataRefresh.refreshSessionMeta(options);
  }

  public refreshContextUsage(options: { startClient?: boolean; silent?: boolean } = {}): Promise<void> {
    return this.sessionMetadataRefresh.refreshContextUsage(options);
  }

  public refreshSlashCommands(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    return this.sessionMetadataRefresh.refreshSlashCommands(options);
  }

  private async adoptReplacedSession(options: { fallbackSessionFile?: string; refreshSessions?: boolean } = {}): Promise<void> {
    const client = this.getClient();

    this.extensionUiRequestHandler.startNewGeneration();
    this.assistantStreamId = 0;
    this.liveToolCallsById.clear();
    this.resetAbortState();
    this.sessionMetadataRefresh.invalidate();
    this.shouldRestoreInitialSessionHistory = false;
    this.sessionHistoryLoading = true;
    this.resetSessionMeta();

    let messagesResult: Awaited<ReturnType<PiRpcClientLike['getMessages']>>;
    let stateResult: Awaited<ReturnType<PiRpcClientLike['getState']>> | undefined;

    try {
      [messagesResult, stateResult] = await Promise.all([
        client.getMessages(),
        client.getState().catch(() => undefined)
      ]);
    } catch (error) {
      this.sessionHistoryLoading = false;
      this.postState();
      throw error;
    }

    const sessionFile = stateResult
      ? getSessionFile(stateResult) ?? options.fallbackSessionFile
      : options.fallbackSessionFile;
    this.applyCurrentSessionFile(sessionFile);
    this.applyCurrentSessionName(stateResult?.sessionName);
    this.liveToolCallsById.clear();
    this.session.replaceMessages(formatAgentMessages(messagesResult.messages));
    this.sessionHistoryLoading = false;
    this.sessionView.showChat({ clearSessionsError: true });
    void this.refreshSessionDiffStats();
    this.postState();

    void this.refreshSessionMeta({ startClient: true, force: true });

    if (options.refreshSessions) {
      void this.sessionView.refreshSessions();
    }
  }

  private async restoreInitialSessionHistory(
    client: Pick<PiRpcClientLike, 'getMessages'>,
    _sessionGeneration: number,
    isCurrent: () => boolean
  ): Promise<void> {
    if (!this.shouldRestoreInitialSessionHistory) {
      return;
    }

    let result: Awaited<ReturnType<PiRpcClientLike['getMessages']>>;

    try {
      result = await client.getMessages();
    } catch (error) {
      if (isCurrent()) {
        this.sessionHistoryLoading = false;
        this.postState();
      }

      throw error;
    }

    if (!isCurrent()) {
      return;
    }

    this.shouldRestoreInitialSessionHistory = false;
    this.sessionHistoryLoading = false;

    if (this.session.isEmpty) {
      const messages = formatAgentMessages(result.messages);

      if (messages.length > 0) {
        this.liveToolCallsById.clear();
        this.session.replaceMessages(messages);
      }
    }

    this.postState();
  }

  private applySessionStateIdentity(state: PiSessionState): { sessionFileChanged: boolean; sessionNameChanged: boolean } {
    return {
      sessionFileChanged: this.applyCurrentSessionFile(getSessionFile(state)),
      sessionNameChanged: this.applyCurrentSessionName(state.sessionName)
    };
  }

  private applySessionStatsIdentity(stats: PiSessionStats): { sessionFileChanged: boolean; sessionNameChanged: boolean } {
    const statsSessionFile = getSessionFile(stats);

    return {
      sessionFileChanged: Boolean(statsSessionFile && this.applyCurrentSessionFile(statsSessionFile)),
      sessionNameChanged: this.applyCurrentSessionName(stats.sessionName)
    };
  }

  private applyCurrentSessionFile(sessionFile: string | undefined): boolean {
    return this.sessionView.applyCurrentSessionFile(sessionFile);
  }

  private applyCurrentSessionName(name: string | undefined): boolean {
    return this.sessionView.applyCurrentSessionName(name);
  }

  private formatPromptForPi(userText: string, context: PiPromptContextAttachment[]): string {
    return formatPromptForPiMessage(userText, context);
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
    const promptContext = this.consumePromptContext();
    const promptText = this.formatPromptForPi(trimmedText, promptContext);

    if (promptContext.length > 0) {
      this.postState();
    }

    const previousReadyScriptArmed = this.armReadyScriptForUserPrompt(streamingBehavior);

    try {
      await this.getClient().prompt(promptText, streamingBehavior);

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
      this.restoreReadyScriptArming(previousReadyScriptArmed);

      if (sessionGeneration !== this.session.generation) {
        return;
      }

      this.restorePromptContext(promptContext);
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

  private addCompactionBusyNotice(): void {
    this.session.addActivity({
      kind: 'queue',
      title: 'Compaction in progress',
      status: 'info',
      summary: 'Wait for context compaction to finish before sending another message.'
    });
    this.postState();
  }

  private async handleLocalSlashCommand(command: { name: string; args: string }): Promise<void> {
    if (!isSupportedBuiltinSlashCommand(command.name)) {
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
        case 'tree':
          this.sessionView.showTree();
          return;
        case 'resume':
          this.sessionView.showSessions();
          return;
        case 'fork':
          await this.handleForkSlashCommand();
          return;
        case 'clone':
          await this.handleCloneSlashCommand();
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

    if (this.sessionMetadata.getModelOptions().length === 0) {
      await this.refreshSessionMeta({ startClient: true, force: true });
    }

    const matches = filterModelOptions(this.sessionMetadata.getModelOptions(), query);

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
    await this.setCurrentSessionName(name, { announce: true });
  }

  private async setSessionNameFromWebview(name: string): Promise<void> {
    if (this.session.isBusy) {
      this.options.showNotification('Wait for Pi to finish before renaming the session.', 'warning');
      return;
    }

    try {
      await this.setCurrentSessionName(name, { announce: false });
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.postState();
    }
  }

  private async setCurrentSessionName(name: string, options: { announce: boolean }): Promise<void> {
    const trimmedName = name.trim();
    await this.getClient().setSessionName(trimmedName);
    this.applyCurrentSessionName(trimmedName);

    if (options.announce) {
      this.session.addSystemMessage(trimmedName ? `Session name set to "${trimmedName}".` : 'Session name cleared.');
    }

    this.postState();
    void this.refreshSessionMeta({ startClient: true, force: true });

    if (this.sessionView.currentSessionFile || this.sessionView.sessionCount > 0) {
      void this.sessionView.refreshSessions();
    }
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

  private async handleForkSlashCommand(): Promise<void> {
    const select = this.options.extensionUi?.select;

    if (!select) {
      this.session.addSystemMessage('Fork selection is not available in this environment.');
      this.postState();
      return;
    }

    const forkMessages = formatForkMessages((await this.getClient().getForkMessages()).messages);

    if (forkMessages.length === 0) {
      this.session.addSystemMessage('No messages to fork from.');
      this.postState();
      return;
    }

    const labels = forkMessages.map((message, index) => formatForkMessageLabel(message, index));
    const picked = await select('Fork from message', labels);

    if (!picked) {
      return;
    }

    const selected = forkMessages[labels.indexOf(picked)];

    if (!selected) {
      return;
    }

    const result = await this.getClient().fork(selected.entryId);

    if (result.cancelled) {
      return;
    }

    const forkText = typeof result.text === 'string'
      ? result.text.trim()
      : selected.text;

    await this.adoptReplacedSession({ refreshSessions: true });
    this.setComposerText(forkText);
    this.postState();
  }

  private async handleCloneSlashCommand(): Promise<void> {
    const result = await this.getClient().clone();

    if (result.cancelled) {
      return;
    }

    await this.adoptReplacedSession({ refreshSessions: true });
    this.options.showToast?.('Cloned current session.');
  }

  private async handleCopySlashCommand(): Promise<void> {
    const result = await this.getClient().getLastAssistantText();
    const text = typeof result.text === 'string' ? result.text : '';

    if (!text) {
      this.options.showNotification('No assistant message to copy.', 'warning');
      return;
    }

    await this.copyTextToClipboard(text, 'Copied last Pi response.');
  }

  private async copyTextFromWebview(text: string): Promise<void> {
    await this.copyTextToClipboard(text, 'Copied Pi response.');
  }

  private async copyTextToClipboard(text: string, successMessage: string): Promise<void> {
    if (!text) {
      this.options.showNotification('No assistant message to copy.', 'warning');
      return;
    }

    if (!this.options.writeClipboard) {
      this.options.showNotification('Copy is not available in this environment.', 'warning');
      return;
    }

    await this.options.writeClipboard(text);
    this.options.showNotification(successMessage, 'info');
  }

  private async handleCompactSlashCommand(customInstructions: string): Promise<void> {
    this.compacting = true;
    this.session.setBusy(true);
    this.applyActivityAction({
      type: 'activity_update',
      sourceId: 'compaction',
      activity: {
        kind: 'compaction',
        title: 'Compacting context…',
        status: 'running'
      }
    });
    this.postState();

    try {
      const result = await this.getClient().compact(customInstructions || undefined);
      const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
      this.applyActivityAction({
        type: 'activity_update',
        sourceId: 'compaction',
        activity: {
          kind: 'compaction',
          title: 'Compacting context…',
          status: 'completed',
          summary: 'Completed',
          ...(summary ? { body: summary } : {})
        }
      });
      this.session.handleAgentEnd();
      this.compacting = false;
      this.postState();
      void this.refreshSessionMeta({ startClient: true, force: true });
    } catch (error) {
      this.applyActivityAction({
        type: 'activity_update',
        sourceId: 'compaction',
        activity: {
          kind: 'compaction',
          title: 'Compacting context…',
          status: 'error',
          summary: getErrorMessage(error)
        }
      });
      this.session.handleAgentEnd();
      this.compacting = false;
      this.postState();
    }
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

  public async refreshSessionDiffStats(): Promise<void> {
    return this.sessionDiffController.refresh();
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

  private setComposerText(text: string): void {
    this.composerTextRevision += 1;
    this.pendingComposerText = { text, revision: this.composerTextRevision };
  }

  private resetSessionMeta(): void {
    this.sessionMetadata.resetContextUsage();
  }

  private disposeClient(): void {
    this.extensionUiRequestHandler.startNewGeneration();

    for (const disposable of this.clientDisposables.splice(0)) {
      disposable.dispose();
    }

    this.client?.dispose();
    this.client = undefined;
    this.resetReadyScriptArming();
  }

  private armReadyScriptForUserPrompt(streamingBehavior?: PiPromptStreamingBehavior) {
    return this.readyScriptState.armForUserPrompt({
      streamingBehavior,
      busy: this.session.isBusy
    });
  }

  private restoreReadyScriptArming(snapshot: ReturnType<PiChatController['armReadyScriptForUserPrompt']>): void {
    this.readyScriptState.restore(snapshot);
  }

  private resetReadyScriptArming(): void {
    this.readyScriptState.reset();
  }

  private armQueuedReadyScriptRun(): void {
    this.readyScriptState.armQueuedRun();
  }

  private runReadyScript(): boolean {
    if (this.options.getReadyScriptEnabled?.() === false || !this.options.runReadyScript) {
      return false;
    }

    const scriptPath = this.options.getReadyScript?.()?.trim();

    if (!scriptPath) {
      return false;
    }

    this.options.runReadyScript(scriptPath, this.options.getCwd?.());
    return true;
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

    const sessionFile = this.nextClientSessionFile ?? this.sessionView.currentSessionFile;
    this.nextClientSessionFile = undefined;
    const clientOptions: PiRpcClientOptions = { cwd: this.options.getCwd?.() };
    const piPath = this.options.getPiPath?.();

    if (piPath) {
      clientOptions.piPath = piPath;
    }

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
        this.armQueuedReadyScriptRun();
        this.session.handleAgentStart();
        void this.refreshSessionDiffStats();
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
        if (this.readyScriptState.consumeCurrentRun()) {
          this.runReadyScript();
        }
        void this.refreshSessionDiffStats();
        this.postState();
        void this.refreshSessionMeta().then(
          () => this.restartClientForConfigurationChangeIfIdle(),
          () => this.restartClientForConfigurationChangeIfIdle()
        );
        break;
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
      case 'message_end':
      case 'tool_execution_start':
        this.applyRpcActivity(event);
        this.postState();
        break;
      case 'tool_execution_update':
        this.applyRpcActivity(event);
        this.postState();
        break;
      case 'tool_execution_end':
        this.applyRpcActivity(event);
        this.updateSessionDiffForToolExecution(event);
        this.postState();
        break;
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
    this.rememberLiveToolCall(event);

    const action = mapMessageUpdate(event, this.getMessageUpdateStreamId(event), {
      fullCommunication: false
    });

    if (action.type === 'text_delta') {
      if (this.session.appendAssistantDelta(action.delta)) {
        this.scheduleState();
      }

      return;
    }

    if (action.type === 'thinking_start') {
      if (this.session.startThinking(action.sourceId)) {
        this.postState();
      }

      return;
    }

    if (action.type === 'thinking_delta') {
      if (this.session.appendThinkingDelta(action.sourceId, action.delta)) {
        this.scheduleState();
      }

      return;
    }

    if (action.type === 'thinking_end') {
      if (this.session.finishThinking(action.sourceId, action.content)) {
        this.postState();
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

    const action = mapRpcActivity(this.enrichLiveToolExecutionEvent(event), {
      fullCommunication: false
    });

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);
    }
  }

  private updateSessionDiffForToolExecution(event: RpcEvent): void {
    this.sessionDiffController.addToolExecution(this.enrichLiveToolExecutionEvent(event));
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

  private rememberLiveToolCall(event: RpcEvent): void {
    const assistantMessageEvent = event.assistantMessageEvent;

    if (!isRecord(assistantMessageEvent) || assistantMessageEvent.type !== 'toolcall_end') {
      return;
    }

    const toolCall = isRecord(assistantMessageEvent.toolCall) ? assistantMessageEvent.toolCall : undefined;
    const id = toolCall
      ? getRecordString(toolCall, 'id') ?? getRecordString(toolCall, 'toolCallId')
      : undefined;

    if (!id) {
      return;
    }

    this.liveToolCallsById.set(id, {
      id,
      name: toolCall ? getRecordString(toolCall, 'name') : undefined,
      args: toolCall?.arguments ?? toolCall?.args
    });
  }

  private enrichLiveToolExecutionEvent(event: RpcEvent): RpcEvent {
    if (
      event.type !== 'tool_execution_start'
      && event.type !== 'tool_execution_update'
      && event.type !== 'tool_execution_end'
    ) {
      return event;
    }

    const toolCallId = getRecordString(event, 'toolCallId');
    const toolCall = toolCallId ? this.liveToolCallsById.get(toolCallId) : undefined;

    if (!toolCall) {
      return event;
    }

    return {
      ...event,
      toolName: getRecordString(event, 'toolName') ?? toolCall.name,
      args: event.args ?? toolCall.args
    };
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
    if (isClientLifecycleError(message)) {
      this.extensionUiRequestHandler.startNewGeneration();
    }

    this.session.addErrorMessage(message);
    this.session.setBusy(false);
    this.compacting = false;
    this.sessionMetadata.clearRefreshing();
    this.sessionHistoryLoading = false;
    this.postState();
    this.restartClientForConfigurationChangeIfIdle();
  }

  private restartClientForConfigurationChangeIfIdle(): void {
    if (!this.restartClientWhenIdle || this.session.isBusy) {
      return;
    }

    this.restartClientForConfigurationChange();
  }

  private restartClientForConfigurationChange(): void {
    this.restartClientWhenIdle = false;
    this.sessionMetadataRefresh.invalidate();
    this.disposeClient();
    this.postState();
    void Promise.all([
      this.refreshSessionMeta({ startClient: true, force: true }),
      this.refreshSlashCommands({ startClient: true, force: true })
    ]).then(undefined, () => undefined);
  }
}
