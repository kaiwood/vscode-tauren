import { ChatSession, type ChatImage, type ChatSnapshotMessage, type ChatSnapshotState } from './chat/chatSession';
import { createWebviewStateMessage } from './sidebar/chatWebview';
import type {
  WebviewAuthProvider,
  WebviewAuthState,
  WebviewMessage,
  WebviewMessagePatch,
  WebviewStateMessage
} from './webviewProtocol/types';
import { StatePublisher } from './controller/statePublisher';
import type { PiClient } from './pi/clientTypes';
import type { TaurenChatControllerOptions } from './controller/types';
import type {
  PiImageContent,
  PiOAuthLoginCallbacks,
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
import { getSettingDefinition, isPiSettingId, isTaurenSettingId, type SettingId, type SettingValue } from './settings/settingsRegistry';

export type { TaurenChatControllerOptions } from './controller/types';
export type { TaurenChatContextUsage, TaurenChatModelMeta, TaurenChatSessionMetaSnapshot } from './metadata/sessionMetadata';

export type { PiPromptContextAttachment, PiPromptContextInput } from './prompt/types';

export type PiPromptImageAttachment = PiImageContent & {
  id: string;
  label: string;
  title: string;
  sizeBytes: number;
};

type PostedChatMessageSync = {
  id: string;
  revision: number;
  imagesSignature: string;
  activityImageSignatures: Map<string, string>;
};

type PostedChatSync = {
  generation: number;
  messages: PostedChatMessageSync[];
};

type ChatMessageSyncPlan = {
  includeMessages: boolean;
  messagePatch?: WebviewMessagePatch;
  postedSync: PostedChatSync;
};

export class TaurenChatController {
  private readonly promptContext = new PromptContextStore();
  private promptImages: PiPromptImageAttachment[] = [];
  private readonly sessionMetadata: SessionMetadataState;
  private readonly sessionMetadataRefresh: SessionMetadataRefreshController;
  private readonly slashCommandController: LocalSlashCommandController;
  private readonly navigation: NavigationController;
  private readonly sessionView: SessionViewController;
  private readonly settingsView: SettingsViewController;
  private pendingComposerText: { text: string; revision: number; mode?: 'replace' | 'append' } | undefined;
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
  private readonly postedChatSyncByMessage = new WeakMap<WebviewStateMessage, PostedChatSync>();
  private lastPostedChatSync: PostedChatSync | undefined;
  private startupResourcesReloadRevision = 0;
  private workspaceWaitingNoticeAdded = false;
  private workspaceWarningNoticeAdded = false;
  private authState: WebviewAuthState = { providers: [] };
  private authAbortController: AbortController | undefined;

  public constructor(private readonly options: TaurenChatControllerOptions) {
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
      setComposerText: (text) => this.setPendingComposerText(text),
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
      isActiveSession: () => this.options.isActiveSession?.() ?? true,
      refreshSessionDiffStats: () => void this.refreshSessionDiffStats(),
      refreshContextUsage: () => void this.refreshContextUsage({ silent: true }),
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
      setComposerText: (text) => this.setPendingComposerText(text),
      restartClientForReload: (sessionFile) => {
        this.clientManager.setNextSessionFile(sessionFile);
        this.disposeClient();
      },
      markStartupResourcesReloaded: () => {
        this.startupResourcesReloadRevision += 1;
      },
      showLoginSettings: (mode) => this.showLoginSettings(mode),
      startNewSession: () => this.startNewSession()
    });

    this.statePublisher = new StatePublisher(
      () => this.getStateMessage(),
      (message) => {
        options.postState(message);
        this.recordPostedChatSync(message);
        this.clearPostedComposerText(message);
      },
      options.stateScheduler
    );
  }

  public dispose(): void {
    this.piEventHandler.dispose();
    this.statePublisher.dispose();
    this.disposeClient();
  }

  public async setCurrentSessionName(name: string): Promise<void> {
    await this.slashCommandController.setCurrentSessionName(name, { announce: false });
  }

  public async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.resetWebviewChatSync();
        this.postState();
        void this.refreshSessionDiffStats();
        void this.refreshSessionMeta({ startClient: true });
        void this.refreshAuthProviders({ startClient: true });
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
        if (message.section === 'login') {
          void this.refreshAuthProviders({ startClient: true });
        }
        return;
      case 'updateSetting':
        await this.updateSetting(message.settingId, message.value);
        return;
      case 'authLogin':
        await this.loginAuthProvider(message.providerId, message.authType);
        return;
      case 'authLogout':
        await this.logoutAuthProvider(message.providerId);
        return;
      case 'authRefresh':
        await this.refreshAuthProviders({ startClient: true, force: true });
        return;
      case 'authCancel':
        this.cancelAuthFlow();
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
      case 'removePromptImage':
        this.removePromptImage(message.id);
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

    const promptImages = this.consumePromptImages();
    const submittedPrompt = this.session.beginSubmit(message.text, toChatImages(promptImages));

    if (!submittedPrompt) {
      this.restorePromptImages(promptImages);
      return;
    }

    const promptContext = this.consumePromptContext();
    const promptText = this.formatPromptForPi(submittedPrompt.text, promptContext);

    this.resetAbortState();
    void this.refreshSessionDiffStats();
    this.postState();

    const previousReadyScriptArmed = this.armReadyScriptForUserPrompt();

    try {
      await this.getClient().prompt(promptText, undefined, toPiImages(promptImages));
    } catch (error) {
      this.restoreReadyScriptArming(previousReadyScriptArmed);
      if (submittedPrompt.sessionGeneration !== this.session.generation) {
        return;
      }

      this.restorePromptContext(promptContext);
      this.restorePromptImages(promptImages);
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
    this.resetWebviewChatSync();
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

  public addPromptImages(images: PiPromptImageAttachment[]): void {
    if (images.length === 0) {
      return;
    }

    this.promptImages.push(...images.map((image) => ({ ...image })));
    this.sessionView.showChat({ clearSessionsError: true });
    this.postState();
  }

  public removePromptImage(id: string): void {
    const nextImages = this.promptImages.filter((image) => image.id !== id);

    if (nextImages.length === this.promptImages.length) {
      return;
    }

    this.promptImages = nextImages;
    this.postState();
  }

  public takePromptImages(): PiPromptImageAttachment[] {
    const images = this.consumePromptImages();

    if (images.length > 0) {
      this.postState();
    }

    return images;
  }

  public replacePromptImages(images: PiPromptImageAttachment[]): void {
    this.promptImages = images.map((image) => ({ ...image }));
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
    const chatState = this.options.useMessagePatches ? this.session.webviewSnapshot() : this.session.snapshot();
    const chatSync = this.options.useMessagePatches
      ? this.createChatMessageSyncPlan(chatState as ChatSnapshotState)
      : undefined;
    this.settingsView.setSettings({ values: this.getSettingsValues(metadataState.piSettings) });

    const message = createWebviewStateMessage({
      state: chatState,
      ...(chatSync ? { includeMessages: chatSync.includeMessages, messagePatch: chatSync.messagePatch } : {}),
      model: metadataState.model,
      slashCommands: metadataState.slashCommands,
      slashCommandsRefreshing: metadataState.slashCommandsRefreshing,
      startupResources: metadataState.startupResources,
      startupResourcesReloadRevision: this.startupResourcesReloadRevision,
      outputColors: this.options.getOutputColors?.() ?? true,
      animationsEnabled: this.options.getAnimationsEnabled?.() ?? true,
      customUiTheme: this.options.getCustomUiTheme?.() ?? 'default',
      promptContext: this.promptContext.getWebviewAttachments(),
      promptImages: this.getWebviewPromptImages(),
      composer: this.pendingComposerText
        ? {
          text: this.pendingComposerText.text,
          revision: this.pendingComposerText.revision,
          mode: this.pendingComposerText.mode
        }
        : undefined,
      contextUsage: metadataState.contextUsage,
      metadataRefreshing: metadataState.metadataRefreshing,
      workspaceDiffStats: this.sessionDiffController.getStats(),
      navigation: this.navigation.getWebviewState(),
      sessionView: this.sessionView.getWebviewState(this.sessionHistory.isLoading),
      settingsView: this.settingsView.getWebviewState(),
      ...(hasAuthStatePayload(this.authState) ? { auth: this.authState } : {})
    });

    if (chatSync) {
      this.postedChatSyncByMessage.set(message, chatSync.postedSync);
    }
    return message;
  }

  private getSettingsValues(piSettings: Partial<Record<SettingId, SettingValue>>): Partial<Record<SettingId, SettingValue>> {
    return {
      ...piSettings,
      ...(this.options.getTaurenSettingValues?.() ?? {})
    };
  }

  private showLoginSettings(_mode: 'login' | 'logout'): void {
    this.sessionView.showChat({ clearSessionsError: true, clearTreeError: true, post: false });
    this.settingsView.showSettings();
    this.settingsView.setActiveSection('login');
    void this.refreshAuthProviders({ startClient: true, force: true });
  }

  private async refreshAuthProviders(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    if (this.authState.refreshing && !options.force) {
      return;
    }

    if (!options.startClient && !this.getExistingClient()) {
      return;
    }

    const client = options.startClient
      ? this.getPiStartupCwdState().status === 'ready'
        ? this.getClient()
        : undefined
      : this.getExistingClient();
    if (!client?.getAuthProviders) {
      return;
    }

    this.authState = { ...this.authState, refreshing: true, error: undefined };
    this.postState();

    try {
      const result = await client.getAuthProviders();
      this.authState = {
        providers: result.providers,
        ...(this.authState.busyProviderId ? { busyProviderId: this.authState.busyProviderId } : {}),
        ...(this.authState.busyAction ? { busyAction: this.authState.busyAction } : {}),
        ...(this.authState.progress ? { progress: this.authState.progress } : {})
      };
    } catch (error) {
      this.authState = {
        ...this.authState,
        refreshing: false,
        error: getErrorMessage(error)
      };
      this.options.showNotification(getErrorMessage(error), 'warning');
      this.postState();
      return;
    }

    this.postState();
  }

  private async loginAuthProvider(providerId: string, authType?: WebviewAuthProvider['authType']): Promise<void> {
    if (this.authState.busyProviderId || this.session.isBusy) {
      return;
    }

    const provider = await this.resolveAuthProvider(providerId, authType);
    if (!provider) {
      return;
    }

    if (provider.authType === 'api_key') {
      await this.loginAuthProviderWithApiKey(provider);
    } else {
      await this.loginAuthProviderWithOAuth(provider);
    }
  }

  private async resolveAuthProvider(providerId: string, authType?: WebviewAuthProvider['authType']): Promise<WebviewAuthProvider | undefined> {
    const matchesProvider = (candidate: WebviewAuthProvider) => (
      candidate.id === providerId && (!authType || candidate.authType === authType)
    );
    let provider = this.authState.providers.find(matchesProvider);

    if (!provider) {
      await this.refreshAuthProviders({ startClient: true, force: true });
      provider = this.authState.providers.find(matchesProvider);
    }

    if (!provider) {
      const message = `Authentication provider not found: ${providerId}`;
      this.authState = { ...this.authState, error: message };
      this.options.showNotification(message, 'warning');
      this.postState();
      return undefined;
    }

    return provider;
  }

  private async loginAuthProviderWithApiKey(provider: WebviewAuthProvider): Promise<void> {
    const apiKey = await this.options.inputSecret?.(
      `API key for ${provider.name}`,
      'Paste API key',
      'The key is stored in Pi auth.json and is not sent to the Tauren webview.'
    );

    if (!apiKey) {
      return;
    }

    const client = this.getClient();
    if (!client.loginWithApiKey) {
      this.options.showNotification('Pi auth is not available in this session.', 'warning');
      return;
    }

    this.authState = {
      ...this.authState,
      busyProviderId: provider.id,
      busyAction: 'login',
      progress: { providerId: provider.id, message: `Saving API key for ${provider.name}…` },
      error: undefined
    };
    this.postState();

    try {
      const result = await client.loginWithApiKey(provider.id, apiKey);
      this.options.showToast?.(result.message, 'success');
      this.authState = { providers: this.authState.providers };
      await this.afterAuthChanged();
    } catch (error) {
      this.authState = { ...this.authState, busyProviderId: undefined, busyAction: undefined, progress: undefined, error: getErrorMessage(error) };
      this.options.showNotification(getErrorMessage(error), 'warning');
      this.postState();
    }
  }

  private async loginAuthProviderWithOAuth(provider: WebviewAuthProvider): Promise<void> {
    const client = this.getClient();
    if (!client.loginWithOAuth) {
      this.options.showNotification('Pi OAuth login is not available in this session.', 'warning');
      return;
    }

    const abortController = new AbortController();
    this.authAbortController = abortController;
    this.authState = {
      ...this.authState,
      busyProviderId: provider.id,
      busyAction: 'login',
      progress: { providerId: provider.id, message: `Starting login for ${provider.name}…` },
      error: undefined
    };
    this.postState();

    const callbacks: PiOAuthLoginCallbacks = {
      onAuth: (info) => {
        this.authState = {
          ...this.authState,
          progress: {
            providerId: provider.id,
            message: info.instructions ?? `Complete login for ${provider.name} in your browser. If the callback does not complete, use the manual prompt.`,
            url: info.url
          }
        };
        this.postState();
        void this.options.openExternalUrl?.(info.url);
      },
      onDeviceCode: (info) => {
        this.authState = {
          ...this.authState,
          progress: {
            providerId: provider.id,
            message: `Enter this code at ${info.verificationUri}. Waiting for authentication…`,
            userCode: info.userCode,
            verificationUri: info.verificationUri
          }
        };
        this.postState();
        void this.options.openExternalUrl?.(info.verificationUri);
      },
      onPrompt: async (prompt) => {
        const value = await this.options.inputSecret?.(prompt.message, prompt.placeholder, 'OAuth input is kept out of Tauren webview state.');
        if (value === undefined || (!prompt.allowEmpty && !value.trim())) {
          throw new Error('Login cancelled');
        }
        return value;
      },
      onProgress: (message) => {
        this.authState = { ...this.authState, progress: { providerId: provider.id, message } };
        this.postState();
      },
      onManualCodeInput: async () => {
        const value = await this.options.inputSecret?.(
          `Manual code for ${provider.name}`,
          provider.usesCallbackServer ? 'Paste redirect URL or authorization code' : 'Paste authorization code',
          'Use this if browser callback did not complete automatically.'
        );
        if (!value?.trim()) {
          throw new Error('Login cancelled');
        }
        return value;
      },
      onSelect: async (prompt) => {
        const labels = prompt.options.map((option) => option.label);
        const picked = await this.options.extensionUi?.select?.(prompt.message, labels);
        return picked ? prompt.options[labels.indexOf(picked)]?.id : undefined;
      },
      signal: abortController.signal
    };

    try {
      const result = await client.loginWithOAuth(provider.id, callbacks);
      this.options.showToast?.(result.message, 'success');
      if (this.authAbortController === abortController) {
        this.authAbortController = undefined;
      }
      this.authState = { providers: this.authState.providers };
      await this.afterAuthChanged();
    } catch (error) {
      const message = getErrorMessage(error);
      const cancelled = message === 'Login cancelled' || abortController.signal.aborted;
      if (this.authAbortController === abortController) {
        this.authAbortController = undefined;
      }
      this.authState = {
        ...this.authState,
        busyProviderId: undefined,
        busyAction: undefined,
        progress: undefined,
        error: cancelled ? undefined : message
      };
      if (!cancelled) {
        this.options.showNotification(message, 'warning');
      }
      this.postState();
    }
  }

  private async logoutAuthProvider(providerId: string): Promise<void> {
    if (this.authState.busyProviderId) {
      return;
    }

    const client = this.getClient();
    if (!client.logoutAuthProvider) {
      this.options.showNotification('Pi auth logout is not available in this session.', 'warning');
      return;
    }

    this.authState = {
      ...this.authState,
      busyProviderId: providerId,
      busyAction: 'logout',
      progress: { providerId, message: 'Removing stored credentials…' },
      error: undefined
    };
    this.postState();

    try {
      const result = await client.logoutAuthProvider(providerId);
      this.options.showToast?.(result.message, 'success');
      this.authState = { providers: this.authState.providers };
      await this.afterAuthChanged();
    } catch (error) {
      this.authState = { ...this.authState, busyProviderId: undefined, busyAction: undefined, progress: undefined, error: getErrorMessage(error) };
      this.options.showNotification(getErrorMessage(error), 'warning');
      this.postState();
    }
  }

  private cancelAuthFlow(): void {
    this.authAbortController?.abort();
    this.authAbortController = undefined;
    this.authState = {
      ...this.authState,
      busyProviderId: undefined,
      busyAction: undefined,
      progress: undefined,
      error: undefined
    };
    this.postState();
  }

  private async afterAuthChanged(): Promise<void> {
    await this.refreshAuthProviders({ startClient: true, force: true });
    await this.refreshSessionMeta({ startClient: true, force: true });
    await this.refreshSlashCommands({ startClient: true, force: true });
    this.postState();
  }

  private async updateSetting(settingId: SettingId, value: SettingValue): Promise<void> {
    const definition = getSettingDefinition(settingId);

    if (!definition || definition.readOnly) {
      return;
    }

    try {
      if (isTaurenSettingId(settingId)) {
        if (!this.options.updateTaurenSetting) {
          throw new Error('Tauren settings are not available in this session.');
        }

        await this.options.updateTaurenSetting(settingId, value);
        this.options.showToast?.('Setting saved.', 'success');
        this.postState();
        return;
      }

      if (isPiSettingId(settingId)) {
        const client = this.getClient();
        if (!client.updateRuntimeSetting) {
          throw new Error('Pi runtime settings are not available in this session.');
        }

        const result = await client.updateRuntimeSetting(settingId, value);
        this.options.showToast?.(result.message ?? 'Pi setting saved.', result.applied === 'live' ? 'success' : 'warning');
        await this.refreshSessionMeta({ startClient: true, force: true });
        await this.refreshSlashCommands({ startClient: true, force: true });
        this.postState();
      }
    } catch (error) {
      this.session.addErrorMessage(getErrorMessage(error));
      this.options.showNotification(getErrorMessage(error), 'warning');
      this.postState();
    }
  }

  private createChatMessageSyncPlan(chatState: ChatSnapshotState): ChatMessageSyncPlan {
    const postedSync = createPostedChatSync(this.session.generation, chatState.messages);
    const lastSync = this.lastPostedChatSync;

    if (!lastSync || lastSync.generation !== postedSync.generation) {
      return { includeMessages: true, postedSync };
    }

    const upserts: Array<{ index: number; message: ChatSnapshotMessage }> = [];
    const limit = chatState.messages.length;

    for (let index = 0; index < limit; index += 1) {
      const message = chatState.messages[index];
      const previous = lastSync.messages[index];

      if (!previous || previous.id !== message.id || previous.revision !== message.revision) {
        upserts.push({
          index,
          message: createPatchMessage(message, previous)
        });
      }
    }

    const deleteFrom = lastSync.messages.length > chatState.messages.length
      ? chatState.messages.length
      : undefined;

    if (upserts.length === 0 && deleteFrom === undefined) {
      return { includeMessages: false, postedSync };
    }

    return {
      includeMessages: false,
      messagePatch: {
        ...(upserts.length > 0 ? { upserts } : {}),
        ...(deleteFrom !== undefined ? { deleteFrom } : {})
      },
      postedSync
    };
  }

  private recordPostedChatSync(message: WebviewStateMessage): void {
    const sync = this.postedChatSyncByMessage.get(message);

    if (sync) {
      this.lastPostedChatSync = sync;
      this.postedChatSyncByMessage.delete(message);
    }
  }

  private resetWebviewChatSync(): void {
    this.lastPostedChatSync = undefined;
  }

  private consumePromptContext(): PiPromptContextAttachment[] {
    return this.promptContext.consume();
  }

  private restorePromptContext(context: PiPromptContextAttachment[]): void {
    this.promptContext.restore(context);
  }

  private consumePromptImages(): PiPromptImageAttachment[] {
    const images = this.promptImages.map((image) => ({ ...image }));
    this.promptImages = [];
    return images;
  }

  private restorePromptImages(images: PiPromptImageAttachment[]): void {
    if (images.length === 0) {
      return;
    }

    this.promptImages = [
      ...images.map((image) => ({ ...image })),
      ...this.promptImages
    ];
  }

  private getWebviewPromptImages(): WebviewStateMessage['promptImages'] {
    return this.promptImages.map((image) => ({
      id: image.id,
      label: image.label,
      title: image.title,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes
    }));
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
        this.session.addSystemMessage(`VS Code workspace is ready: ${cwd}. Starting Pi engine.`);
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
    this.session.addSystemMessage(`Workspace changed to ${cwd}. Restarting Pi engine for the new workspace.`);
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
    const promptImages = this.consumePromptImages();
    const promptText = this.formatPromptForPi(trimmedText, promptContext);

    if (promptContext.length > 0 || promptImages.length > 0) {
      this.postState();
    }

    const previousReadyScriptArmed = this.armReadyScriptForUserPrompt(streamingBehavior);

    try {
      await this.getClient().prompt(promptText, streamingBehavior, toPiImages(promptImages));

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
      this.restorePromptImages(promptImages);
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
      summary: 'Sidebar commands are not available while Pi engine is working.'
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

  public setComposerText(text: string): void {
    this.setPendingComposerText(text, 'replace');
    this.postState();
  }

  public appendComposerText(text: string): void {
    this.setPendingComposerText(text, 'append');
    this.postState();
  }

  private setPendingComposerText(text: string, mode: 'replace' | 'append' = 'replace'): void {
    this.composerTextRevision += 1;
    this.pendingComposerText = { text, revision: this.composerTextRevision, mode };
  }

  private resetSessionMeta(): void {
    this.sessionMetadata.resetContextUsage();
    this.sessionMetadata.resetStartupResources();
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

  private restoreReadyScriptArming(snapshot: ReturnType<TaurenChatController['armReadyScriptForUserPrompt']>): void {
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
    return `Tauren cannot start Pi engine because ${state.reason}. Open a project folder and try again.`;
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
      this.session.addSystemMessage('Waiting for VS Code to provide the workspace folder before starting Pi engine.');
      this.workspaceWaitingNoticeAdded = true;
    }

    if (warn && !this.workspaceWarningNoticeAdded) {
      this.session.addSystemMessage('Still waiting for VS Code workspace folders. Pi engine will start automatically when the workspace is available.');
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

function toPiImages(images: PiPromptImageAttachment[]): PiImageContent[] | undefined {
  if (images.length === 0) {
    return undefined;
  }

  return images.map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mimeType
  }));
}

function toChatImages(images: PiPromptImageAttachment[]): ChatImage[] | undefined {
  if (images.length === 0) {
    return undefined;
  }

  return images.map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mimeType,
    alt: image.label
  }));
}

function hasAuthStatePayload(state: WebviewAuthState): boolean {
  return state.providers.length > 0
    || Boolean(state.refreshing)
    || Boolean(state.busyProviderId)
    || Boolean(state.busyAction)
    || Boolean(state.progress)
    || Boolean(state.error);
}

function createPostedChatSync(generation: number, messages: ChatSnapshotMessage[]): PostedChatSync {
  return {
    generation,
    messages: messages.map((message) => ({
      id: message.id,
      revision: message.revision,
      imagesSignature: getImagesSignature(message.images),
      activityImageSignatures: getActivityImageSignatures(message)
    }))
  };
}

function createPatchMessage(message: ChatSnapshotMessage, previous: PostedChatMessageSync | undefined): ChatSnapshotMessage {
  if (!previous || previous.id !== message.id) {
    return message;
  }

  const next: ChatSnapshotMessage = { ...message };

  const imagesSignature = getImagesSignature(message.images);

  if (imagesSignature === previous.imagesSignature) {
    delete next.images;
  } else if (!Array.isArray(message.images) && previous.imagesSignature) {
    next.images = [];
  }

  if (Array.isArray(message.activities)) {
    next.activities = message.activities.map((activity) => {
      const activityId = typeof activity.id === 'string' ? activity.id : '';

      const activityImagesSignature = getImagesSignature(activity.images);
      const previousActivityImagesSignature = previous.activityImageSignatures.get(activityId);

      if (!activityId || activityImagesSignature !== previousActivityImagesSignature) {
        return !Array.isArray(activity.images) && previousActivityImagesSignature
          ? { ...activity, images: [] }
          : activity;
      }

      const nextActivity = { ...activity };
      delete nextActivity.images;
      return nextActivity;
    });
  }

  return next;
}

function getActivityImageSignatures(message: ChatSnapshotMessage): Map<string, string> {
  const signatures = new Map<string, string>();

  for (const activity of message.activities ?? []) {
    if (typeof activity.id === 'string') {
      signatures.set(activity.id, getImagesSignature(activity.images));
    }
  }

  return signatures;
}

function getImagesSignature(images: { data: string; mimeType: string; alt?: string; type: 'image' }[] | undefined): string {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }

  return images.map((image) => {
    const data = typeof image.data === 'string' ? image.data : '';
    const prefix = data.slice(0, 32);
    const suffix = data.length > 32 ? data.slice(-32) : '';
    return [image.type, image.mimeType, image.alt ?? '', data.length, prefix, suffix].join('\u0000');
  }).join('\u0001');
}
