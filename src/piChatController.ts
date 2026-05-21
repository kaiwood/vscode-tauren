import { ChatSession } from './chat/chatSession';
import { createWebviewStateMessage } from './sidebar/chatWebview';
import type {
  WebviewMessage,
  WebviewStateMessage
} from './webviewProtocol/types';
import { StatePublisher } from './controller/statePublisher';
import {
  createCancellingExtensionUi,
  ExtensionUiRequestHandler
} from './extensionUi/requestHandler';
import type { PiRpcClientLike } from './rpc/clientTypes';
import type { PiChatControllerOptions } from './controller/types';
import type {
  PiPromptStreamingBehavior,
  RpcEvent
} from './rpc/types';
import { formatPromptForPi as formatPromptForPiMessage } from './prompt/formatting';
import { PromptContextStore } from './prompt/contextStore';
import type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';
import { ReadyScriptState } from './readyScript';
import {
  SessionMetadataRefreshController,
  SessionMetadataState
} from './metadata/sessionMetadata';
import { SessionDiffController } from './diff/sessionDiffController';
import {
  getErrorMessage,
  isClientLifecycleError
} from './controller/errors';
import { parseLocalSlashCommand } from './controller/slashCommandParsing';
import { LocalSlashCommandController } from './controller/localSlashCommandController';
import { SessionHistoryController } from './sessions/sessionHistoryController';
import { PiClientManager } from './controller/piClientManager';
import { PiRpcEventHandler } from './controller/piRpcEventHandler';
import { SessionViewController } from './sessions/sessionViewController';

export type { PiChatControllerOptions } from './controller/types';
export type { PiChatContextUsage, PiChatModelMeta, PiChatSessionMetaSnapshot } from './metadata/sessionMetadata';

export type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';

export class PiChatController {
  private readonly promptContext = new PromptContextStore();
  private readonly sessionMetadata: SessionMetadataState;
  private readonly sessionMetadataRefresh: SessionMetadataRefreshController;
  private readonly slashCommandController: LocalSlashCommandController;
  private readonly sessionView: SessionViewController;
  private pendingComposerText: { text: string; revision: number } | undefined;
  private composerTextRevision = 0;
  private readonly clientManager: PiClientManager;
  private readonly sessionHistory: SessionHistoryController;
  private abortRequested = false;
  private abortNoticeAdded = false;
  private readonly sessionDiffController: SessionDiffController;
  private readonly rpcEventHandler: PiRpcEventHandler;
  private readonly readyScriptState = new ReadyScriptState();
  private readonly session = new ChatSession();
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private readonly extensionUiRequestHandler: ExtensionUiRequestHandler;

  public constructor(private readonly options: PiChatControllerOptions) {
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
      supportsSessionTree: options.supportsSessionTree,
      initialSessionFile: options.initialSessionFile,
      listSessions: options.listSessions,
      listSessionTree: options.listSessionTree,
      onSessionFileChange: options.onSessionFileChange,
      showNotification: options.showNotification,
      showSessionChanges: options.showSessionChanges,
      showToast: options.showToast,
      applySessionFile: (sessionFile) => this.sessionDiffController.applySessionFile(sessionFile),
      adoptReplacedSession: (adoptOptions) => this.sessionHistory.adoptReplacedSession(adoptOptions),
      getClient: () => this.getClient(),
      handleCompactCurrentSession: () => this.slashCommandController.handleCompactSlashCommand(''),
      isBusy: () => this.session.isBusy,
      postState: () => this.postState(),
      setComposerText: (text) => this.setComposerText(text),
      setCurrentSessionName: (name, nameOptions) => this.slashCommandController.setCurrentSessionName(name, nameOptions),
      setSessionHistoryLoading: (value) => {
        this.sessionHistory.setLoading(value);
      },
      hasStartedCurrentSession: () => !this.session.isEmpty,
      startNewSession: (sessionOptions) => this.startNewSession(sessionOptions)
    });

    this.clientManager = new PiClientManager({
      createClient: options.createClient,
      getCwd: options.getCwd,
      getPiPath: options.getPiPath,
      getCurrentSessionFile: () => this.sessionView.currentSessionFile,
      getSessionGeneration: () => this.session.generation,
      onEvent: (event) => this.handleRpcEvent(event),
      onError: (message) => this.handleClientError(message)
    });
    this.rpcEventHandler = new PiRpcEventHandler({
      session: this.session,
      postState: () => this.postState(),
      scheduleState: () => this.statePublisher.schedule(),
      refreshSessionDiffStats: () => void this.refreshSessionDiffStats(),
      addToolExecution: (event) => this.sessionDiffController.addToolExecution(event),
      armQueuedReadyScriptRun: () => this.armQueuedReadyScriptRun(),
      runReadyScriptAfterAgentEnd: () => {
        if (this.readyScriptState.consumeCurrentRun()) {
          this.runReadyScript();
        }
      },
      refreshMetadataAfterAgentEnd: () => this.refreshSessionMetaAfterAgentEnd(),
      isAbortRequested: () => this.abortRequested,
      appendAbortNoticeIfNeeded: () => this.appendAbortNoticeIfNeeded(),
      resetAbortState: () => this.resetAbortState(),
      handleExtensionUiRequest: (event) => this.handleExtensionUiRequest(event)
    });
    this.sessionHistory = new SessionHistoryController({
      initialSessionFile: options.initialSessionFile,
      session: this.session,
      sessionView: this.sessionView,
      rpcEventHandler: this.rpcEventHandler,
      getClient: () => this.getClient(),
      startNewExtensionUiGeneration: () => this.extensionUiRequestHandler.startNewGeneration(),
      invalidateMetadata: () => this.sessionMetadataRefresh.invalidate(),
      resetSessionMeta: () => this.resetSessionMeta(),
      refreshSessionDiffStats: () => void this.refreshSessionDiffStats(),
      refreshSessionMeta: (refreshOptions) => this.refreshSessionMeta(refreshOptions),
      postState: () => this.postState()
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
      restoreInitialSessionHistory: (client, sessionGeneration, isCurrent) => this.sessionHistory.restoreInitialSessionHistory(client, sessionGeneration, isCurrent),
      applySessionState: (state) => this.sessionHistory.applySessionStateIdentity(state),
      applySessionStatsIdentity: (stats) => this.sessionHistory.applySessionStatsIdentity(stats),
      refreshSessions: () => void this.sessionView.refreshSessions(),
      postState: () => this.postState(),
      onMetadataStartError: (message) => {
        this.sessionHistory.setLoading(false);
        this.handleClientError(message);
      },
      onError: (message) => this.handleClientError(message),
      getErrorMessage
    });
    this.slashCommandController = new LocalSlashCommandController({
      session: this.session,
      sessionMetadata: this.sessionMetadata,
      sessionView: this.sessionView,
      extensionUi: options.extensionUi,
      showNotification: options.showNotification,
      showToast: options.showToast,
      writeClipboard: options.writeClipboard,
      getClient: () => this.getClient(),
      postState: () => this.postState(),
      refreshSessionMeta: (refreshOptions) => this.refreshSessionMeta(refreshOptions),
      refreshSlashCommands: (refreshOptions) => this.refreshSlashCommands(refreshOptions),
      adoptReplacedSession: (adoptOptions) => this.sessionHistory.adoptReplacedSession(adoptOptions),
      setComposerText: (text) => this.setComposerText(text),
      restartClientForReload: (sessionFile) => {
        this.clientManager.setNextSessionFile(sessionFile);
        this.disposeClient();
      },
      startNewSession: () => this.startNewSession()
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
      case 'showTree':
        if (!this.sessionView.canNavigateTree()) {
          this.session.addSystemMessage('/tree currently requires Tau SDK mode. Enable tau.useSdkInsteadOfRpc to navigate the live session tree.');
          this.postState();
          return;
        }
        this.sessionView.showTree();
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
        await this.sessionView.navigateTree(message.entryId, {
          summarize: message.summarize,
          customInstructions: message.customInstructions
        });
        return;
      case 'setSessionName':
        await this.slashCommandController.setSessionNameFromWebview(message.name);
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
        await this.slashCommandController.setModel(message.provider, message.modelId);
        return;
      case 'setThinkingLevel':
        await this.slashCommandController.setThinkingLevel(message.level);
        return;
      case 'removePromptContext':
        this.removePromptContext(message.id);
        return;
      case 'abort':
        await this.abortActivePrompt();
        return;
      case 'copyText':
        await this.slashCommandController.copyTextFromWebview(message.text, message.successMessage);
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
      if (this.slashCommandController.isCompacting) {
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
      await this.slashCommandController.handle(localSlashCommand);
      return;
    }

    if (this.sessionHistory.needsInitialHistoryRestore) {
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

    await this.slashCommandController.handle({ name, args });
  }

  public startNewSession(options: { viewMode?: 'chat' | 'sessions' } = {}): void {
    if (this.session.isBusy) {
      this.addBusySlashCommandNotice('new');
      return;
    }

    this.extensionUiRequestHandler.startNewGeneration();
    this.rpcEventHandler.reset();
    this.resetAbortState();
    this.session.startNewSession();
    this.sessionView.startNewSession(options.viewMode ?? 'chat');
    this.sessionDiffController.reset(undefined);
    this.clientManager.setNextSessionFile(undefined);
    this.sessionHistory.startNewSession();
    this.resetReadyScriptArming();
    this.resetSessionMeta();
    this.disposeClient();
    this.postState();
    void this.refreshSessionMeta({ startClient: true });
  }

  public handleClientConfigurationChanged(): void {
    if (!this.clientManager.hasClient) {
      return;
    }

    this.clientManager.requestRestartWhenIdle();

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

  public takePromptContext(): PiPromptContextAttachment[] {
    const context = this.promptContext.consume();

    if (context.length > 0) {
      this.postState();
    }

    return context;
  }

  public replacePromptContext(context: PiPromptContextAttachment[]): void {
    this.promptContext.replace(context);
    this.postState();
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
      animationsEnabled: this.options.getAnimationsEnabled?.() ?? true,
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
      sessionView: this.sessionView.getWebviewState(this.sessionHistory.isLoading)
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
    this.prepareForClientDispose();
    this.clientManager.disposeClient();
  }

  private prepareForClientDispose(): void {
    this.extensionUiRequestHandler.startNewGeneration();
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
    return this.clientManager.getExistingClient();
  }

  private getClient(): PiRpcClientLike {
    return this.clientManager.getClient();
  }

  private handleRpcEvent(event: RpcEvent): void {
    this.rpcEventHandler.handleEvent(event);
  }

  private refreshSessionMetaAfterAgentEnd(): void {
    void this.refreshSessionMeta().then(
      () => this.restartClientForConfigurationChangeIfIdle(),
      () => this.restartClientForConfigurationChangeIfIdle()
    );
  }

  private handleExtensionUiRequest(event: RpcEvent): void {
    void this.extensionUiRequestHandler.handle(event);
  }

  private handleClientError(message: string): void {
    if (isClientLifecycleError(message)) {
      this.extensionUiRequestHandler.startNewGeneration();
    }

    this.session.addErrorMessage(message);
    this.session.setBusy(false);
    this.slashCommandController.clearCompacting();
    this.sessionMetadata.clearRefreshing();
    this.sessionHistory.setLoading(false);
    this.postState();
    this.restartClientForConfigurationChangeIfIdle();
  }

  private restartClientForConfigurationChangeIfIdle(): void {
    if (!this.clientManager.restartIfIdle(this.session.isBusy, () => this.prepareForClientDispose())) {
      return;
    }

    this.afterClientRestartForConfigurationChange();
  }

  private afterClientRestartForConfigurationChange(): void {
    this.sessionMetadataRefresh.invalidate();
    this.postState();
    void Promise.all([
      this.refreshSessionMeta({ startClient: true, force: true }),
      this.refreshSlashCommands({ startClient: true, force: true })
    ]).then(undefined, () => undefined);
  }
}
