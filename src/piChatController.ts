import { ChatSession } from './chat/chatSession';
import { createWebviewStateMessage } from './sidebar/chatWebview';
import type {
  WebviewMessage,
  WebviewStateMessage
} from './webviewProtocol/types';
import { StatePublisher } from './controller/statePublisher';
import type { PiClient } from './pi/clientTypes';
import type { PiChatControllerOptions } from './controller/types';
import type {
  PiPromptStreamingBehavior,
  PiEvent
} from './pi/types';
import { formatPromptForPi as formatPromptForPiMessage } from './prompt/formatting';
import { PromptContextStore } from './prompt/contextStore';
import type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';
import { ReadyScriptState } from './readyScript';
import {
  SessionMetadataRefreshController,
  SessionMetadataState
} from './metadata/sessionMetadata';
import { SessionDiffController } from './diff/sessionDiffController';
import { getErrorMessage } from './controller/errors';
import { parseLocalSlashCommand } from './controller/slashCommandParsing';
import { LocalSlashCommandController } from './controller/localSlashCommandController';
import { SessionHistoryController } from './sessions/sessionHistoryController';
import { PiClientManager } from './controller/piClientManager';
import { PiEventHandler } from './controller/piEventHandler';
import { SessionViewController } from './sessions/sessionViewController';
import { SettingsViewController } from './settings/settingsViewController';
import { NavigationController } from './navigation/navigationController';
import { getPiStartupCwdState, type PiStartupCwdState } from './workspace/cwdSafety';

export type { PiChatControllerOptions } from './controller/types';
export type { PiChatContextUsage, PiChatModelMeta, PiChatSessionMetaSnapshot } from './metadata/sessionMetadata';

export type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';

export class PiChatController {
  private readonly promptContext = new PromptContextStore();
  private readonly sessionMetadata: SessionMetadataState;
  private readonly sessionMetadataRefresh: SessionMetadataRefreshController;
  private readonly slashCommandController: LocalSlashCommandController;
  private readonly navigation: NavigationController;
  private readonly sessionView: SessionViewController;
  private readonly settingsView: SettingsViewController;
  private pendingComposerText: { text: string; revision: number } | undefined;
  private composerTextRevision = 0;
  private readonly clientManager: PiClientManager;
  private readonly sessionHistory: SessionHistoryController;
  private abortRequested = false;
  private abortNoticeAdded = false;
  private readonly sessionDiffController: SessionDiffController;
  private readonly piEventHandler: PiEventHandler;
  private readonly readyScriptState = new ReadyScriptState();
  private readonly session = new ChatSession();
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private workspaceWaitingNoticeAdded = false;
  private workspaceWarningNoticeAdded = false;

  public constructor(private readonly options: PiChatControllerOptions) {
    this.sessionDiffController = new SessionDiffController({
      initialSessionFile: options.initialSessionFile,
      getSessionGeneration: () => this.session.generation,
      postState: () => this.postState(),
      loadSnapshot: (sessionFile) => this.options.loadSessionDiffSnapshot?.(sessionFile),
      saveSnapshot: (sessionFile, snapshot) => this.options.saveSessionDiffSnapshot?.(sessionFile, snapshot)
    });

    this.navigation = new NavigationController(() => this.postState());
    this.settingsView = new SettingsViewController(this.navigation, () => this.postState());

    this.sessionView = new SessionViewController({
      navigation: this.navigation,
      createClient: options.createClient,
      deleteSession: options.deleteSession,
      extensionUi: options.extensionUi,
      initialSessionFile: options.initialSessionFile,
      listSessions: options.listSessions,
      onSessionFileChange: options.onSessionFileChange,
      renameOpenSession: options.renameOpenSession,
      showNotification: options.showNotification,
      showSessionChanges: options.showSessionChanges,
      showToast: options.showToast,
      getCwd: () => this.getPiStartupCwd(),
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
      getCwd: () => this.getPiStartupCwd(),
      getCurrentSessionFile: () => this.sessionView.currentSessionFile,
      getSessionGeneration: () => this.session.generation,
      extensionUi: options.extensionUi,
      onEvent: (event) => this.handlePiEvent(event),
      onError: (message) => this.handleClientError(message)
    });
    this.piEventHandler = new PiEventHandler({
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
      resetAbortState: () => this.resetAbortState()
    });
    this.sessionHistory = new SessionHistoryController({
      initialSessionFile: options.initialSessionFile,
      session: this.session,
      sessionView: this.sessionView,
      piEventHandler: this.piEventHandler,
      getClient: () => this.getClient(),
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
      getClient: ({ startClient }) => startClient ? this.getClientForMetadataRefresh() : this.getExistingClient(),
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
  }

  public dispose(): void {
    this.statePublisher.dispose();
    this.disposeClient();
  }

  public async setCurrentSessionName(name: string): Promise<void> {
    await this.slashCommandController.setCurrentSessionName(name, { announce: false });
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
      case 'showLane':
        if (message.lane === 'sessions') {
          this.sessionView.showSessions();
        } else if (message.lane === 'tree') {
          this.sessionView.showTree();
        } else {
          this.sessionView.showChat({ clearSessionsError: true, clearTreeError: true });
        }
        return;
      case 'showChatFace':
        if (message.chatFace === 'settings') {
          this.sessionView.showChat({ clearSessionsError: true, clearTreeError: true, post: false });
          this.settingsView.showSettings();
        } else {
          this.settingsView.hideSettings();
        }
        return;
      case 'hideChatFace':
        this.settingsView.hideSettings();
        return;
      case 'setSettingsSection':
        this.settingsView.setActiveSection(message.section);
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
      case 'setTreeEntryLabel':
        await this.sessionView.setTreeEntryLabel(message.entryId, message.label);
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
        if (localSlashCommand.name === 'name') {
          await this.slashCommandController.handle(localSlashCommand);
        } else {
          this.addBusySlashCommandNotice(localSlashCommand.name);
        }
        return;
      }

      await this.queuePromptWhileBusy(message.text, message.streamingBehavior ?? 'steer');
      return;
    }

    if (localSlashCommand) {
      await this.slashCommandController.handle(localSlashCommand);
      return;
    }

    if (!this.ensureWorkspaceReadyForClient()) {
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
    if (this.session.isBusy && name !== 'name') {
      this.addBusySlashCommandNotice(name);
      return;
    }

    await this.slashCommandController.handle({ name, args });
  }

  public toggleSessionList(): void {
    if (this.sessionView.isSessionListVisible) {
      this.sessionView.hideSessionLane();
      return;
    }

    if (this.session.isBusy) {
      this.addBusySlashCommandNotice('resume');
      return;
    }

    this.sessionView.toggleSessions();
  }

  public toggleSessionTree(): void {
    if (this.sessionView.isTreeVisible) {
      this.sessionView.hideSessionLane();
      return;
    }

    if (this.session.isBusy) {
      this.addBusySlashCommandNotice('tree');
      return;
    }

    this.sessionView.toggleTree();
  }

  public showChat(): void {
    this.sessionView.showChat({ clearSessionsError: true, clearTreeError: true });
  }

  public async deleteCurrentSession(): Promise<void> {
    await this.sessionView.deleteCurrentSession();
  }

  public toggleSettings(): void {
    if (!this.settingsView.isSettingsVisible) {
      this.sessionView.showChat({ clearSessionsError: true, clearTreeError: true, post: false });
    }

    this.settingsView.toggleSettings();
  }

  public startNewSession(options: { lane?: 'chat' | 'sessions' } = {}): void {
    if (this.session.isBusy) {
      this.addBusySlashCommandNotice('new');
      return;
    }

    this.piEventHandler.reset();
    this.resetAbortState();
    this.session.startNewSession();
    this.sessionView.startNewSession(options.lane ?? 'chat');
    this.sessionDiffController.reset(undefined);
    this.clientManager.setNextSessionFile(undefined);
    this.sessionHistory.startNewSession();
    this.resetReadyScriptArming();
    this.resetSessionMeta();
    this.disposeClient();
    this.postState();
    void this.refreshSessionMeta({ startClient: true });
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
      customUiTheme: this.options.getCustomUiTheme?.() ?? 'default',
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
      navigation: this.navigation.getWebviewState(),
      sessionView: this.sessionView.getWebviewState(this.sessionHistory.isLoading),
      settingsView: this.settingsView.getWebviewState()
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

  public noteWorkspacePending(): void {
    this.addWorkspaceWaitingNotice(false);
  }

  public noteWorkspacePendingWarning(): void {
    this.addWorkspaceWaitingNotice(true);
  }

  public noteWorkspaceAvailable(cwd: string): void {
    if (this.workspaceWaitingNoticeAdded || this.workspaceWarningNoticeAdded) {
      if (this.sessionHistory.needsInitialHistoryRestore) {
        this.session.replaceMessages([]);
      } else {
        this.session.addSystemMessage(`VS Code workspace is ready: ${cwd}. Starting Pi.`);
      }

      this.workspaceWaitingNoticeAdded = false;
      this.workspaceWarningNoticeAdded = false;
      this.postState();
    }

    void this.refreshSessionMeta({ startClient: true, force: true });
  }

  public restartForWorkspaceChange(cwd: string, sessionFile: string | undefined): void {
    this.disposeClient();
    this.piEventHandler.reset();
    this.resetAbortState();
    this.session.startNewSession();
    this.sessionView.startNewSession('chat');
    this.sessionDiffController.reset(undefined);
    this.clientManager.setNextSessionFile(sessionFile);
    this.sessionHistory.startNewSession();
    this.resetReadyScriptArming();
    this.resetSessionMeta();
    this.session.addSystemMessage(`Workspace changed to ${cwd}. Restarting Pi for the new workspace.`);
    this.postState();
    void this.refreshSessionMeta({ startClient: true, force: true });
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

    this.options.runReadyScript(scriptPath, this.getPiStartupCwd());
    return true;
  }

  private getExistingClient(): PiClient | undefined {
    return this.clientManager.getExistingClient();
  }

  private getClientForMetadataRefresh(): PiClient | undefined {
    if (!this.ensureWorkspaceReadyForClient()) {
      this.sessionHistory.setLoading(false);
      return undefined;
    }

    return this.getClient();
  }

  private getClient(): PiClient {
    const state = this.getPiStartupCwdState();

    if (state.status !== 'ready') {
      const message = this.getPiStartupErrorMessage(state);
      this.handlePiStartupBlocked(message);
      throw new Error(message);
    }

    return this.clientManager.getClient();
  }

  private ensureWorkspaceReadyForClient(): boolean {
    const state = this.getPiStartupCwdState();

    if (state.status === 'ready') {
      return true;
    }

    this.handlePiStartupBlocked(this.getPiStartupErrorMessage(state));
    return false;
  }

  private getPiStartupErrorMessage(state: Extract<PiStartupCwdState, { status: 'blocked' }>): string {
    return `Tau cannot start Pi because ${state.reason}. Open a project folder and try again.`;
  }

  private handlePiStartupBlocked(message: string): void {
    this.options.showNotification(message, 'warning');
    this.handleClientError(message);
  }

  private getPiStartupCwd(): string | undefined {
    const state = this.getPiStartupCwdState();
    return state.status === 'ready' ? state.cwd : undefined;
  }

  private getPiStartupCwdState(): PiStartupCwdState {
    return getPiStartupCwdState(
      this.options.getCwd?.(),
      Boolean(this.options.getRejectEditWriteOutsideWorkspace?.())
    );
  }

  private addWorkspaceWaitingNotice(warn: boolean): void {
    if (!this.workspaceWaitingNoticeAdded) {
      this.session.addSystemMessage('Waiting for VS Code to provide the workspace folder before starting Pi.');
      this.workspaceWaitingNoticeAdded = true;
    }

    if (warn && !this.workspaceWarningNoticeAdded) {
      this.session.addSystemMessage('Still waiting for VS Code workspace folders. Pi will start automatically when the workspace is available.');
      this.workspaceWarningNoticeAdded = true;
    }

    this.session.setBusy(false);
    this.sessionMetadata.clearRefreshing();
    this.sessionHistory.setLoading(false);
    this.postState();
  }

  private handlePiEvent(event: PiEvent): void {
    this.piEventHandler.handleEvent(event);
  }

  private refreshSessionMetaAfterAgentEnd(): void {
    void this.refreshSessionMeta();
  }

  private handleClientError(message: string): void {
    this.session.addErrorMessage(message);
    this.session.setBusy(false);
    this.slashCommandController.clearCompacting();
    this.sessionMetadata.clearRefreshing();
    this.sessionHistory.setLoading(false);
    this.postState();
  }
}
