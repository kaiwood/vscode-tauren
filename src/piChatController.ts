import { ChatSession, type ChatActivityInput, type ChatMessage } from './chatSession';
import { listPiSessionTree } from './piSessionTree';
import {
  createWebviewStateMessage,
  type WebviewMessage,
  type WebviewModelOption,
  type WebviewSessionItemCommand,
  type WebviewPromptContextAttachment,
  type WebviewSessionItem,
  type WebviewSlashCommand,
  type WebviewStateMessage,
  type WebviewTreeItem
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
  formatToolExecutionActivity,
  getFailedResponseError,
  mapMessageUpdate,
  mapRpcActivity,
  type ActivityAddAction,
  type ActivityRemoveAction,
  type ActivityUpdateAction
} from './piEventMapper';
import type {
  PiAgentMessage,
  PiCommand,
  PiForkMessage,
  PiModel,
  PiPromptStreamingBehavior,
  PiRpcClient,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from './piRpcClient';
import { extractPiMessageText } from './piMessageContent';
import { formatPromptForPi as formatPromptForPiMessage } from './piPromptFormatting';
import {
  isBuiltinSlashCommand,
  isSupportedBuiltinSlashCommand
} from './slashCommands';
import {
  emptySessionDiffStats,
  SessionDiffTracker,
  type SessionDiffSnapshot,
  type SessionDiffStats,
  type ToolExecutionInput
} from './sessionDiffTracker';

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

type RestoredToolCall = {
  id: string;
  name?: string;
  args?: unknown;
};

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

export type PiPromptContextInput = {
  kind: 'file' | 'selection';
  path: string;
  label?: string;
  title?: string;
  languageId?: string;
  startLine?: number;
  endLine?: number;
  text?: string;
};

export type PiPromptContextAttachment = PiPromptContextInput & {
  id: string;
  label: string;
  title: string;
};

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
  loadSessionDiffSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSessionDiffSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
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
  private promptContextSequence = 0;
  private promptContext: PiPromptContextAttachment[] = [];
  private sessionViewMode: 'chat' | 'sessions' | 'tree' = 'chat';
  private sessions: WebviewSessionItem[] = [];
  private sessionsRefreshing = false;
  private sessionsError = '';
  private treeItems: WebviewTreeItem[] = [];
  private treeRefreshing = false;
  private treeError = '';
  private pendingComposerText: { text: string; revision: number } | undefined;
  private composerTextRevision = 0;
  private sessionsRefreshSequence = 0;
  private treeRefreshSequence = 0;
  private metadataRefreshSequence = 0;
  private slashCommandsRefreshSequence = 0;
  private currentSessionFile: string | undefined;
  private currentSessionName = '';
  private nextClientSessionFile: string | undefined;
  private shouldRestoreInitialSessionHistory: boolean;
  private sessionHistoryLoading: boolean;
  private restartClientWhenIdle = false;
  private abortRequested = false;
  private abortNoticeAdded = false;
  private metadataRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private contextUsageRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private slashCommandsRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private compacting = false;
  private sessionDiffStats = emptySessionDiffStats();
  private sessionDiffRefreshInFlight: Promise<void> | undefined;
  private readonly sessionDiffTracker: SessionDiffTracker;
  private readyScriptClient: PiRpcClientLike | undefined;
  private resumedClient: PiRpcClientLike | undefined;
  private readonly liveToolCallsById = new Map<string, RestoredToolCall>();
  private readonly session = new ChatSession();
  private readonly clientDisposables: DisposableLike[] = [];
  private readonly statePublisher: StatePublisher<WebviewStateMessage>;
  private readonly extensionUiRequestHandler: ExtensionUiRequestHandler;

  public constructor(private readonly options: PiChatControllerOptions) {
    this.currentSessionFile = options.initialSessionFile;
    this.shouldRestoreInitialSessionHistory = Boolean(options.initialSessionFile);
    this.sessionHistoryLoading = Boolean(options.initialSessionFile);

    this.sessionDiffTracker = new SessionDiffTracker(this.loadSessionDiffSnapshot(this.currentSessionFile));
    this.sessionDiffStats = this.sessionDiffTracker.getStats();

    if (options.initialSessionMeta) {
      this.setSessionMetaFields(options.initialSessionMeta);
    }

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
    if (message.type === 'ready') {
      this.postState();
      void this.refreshSessionDiffStats();
      void this.refreshSessionMeta({ startClient: true });
      void this.refreshSessions();
      return;
    }

    if (message.type === 'newSession') {
      this.startNewSession();
      return;
    }

    if (message.type === 'showSessions') {
      this.showSessions();
      return;
    }

    if (message.type === 'hideSessions') {
      this.hideSessions();
      return;
    }

    if (message.type === 'refreshSessions') {
      await this.refreshSessions();
      return;
    }

    if (message.type === 'selectSession') {
      await this.switchSession(message.sessionPath);
      return;
    }

    if (message.type === 'deleteSession') {
      await this.deleteSession(message.sessionPath);
      return;
    }

    if (message.type === 'sessionItemCommand') {
      await this.runSessionItemCommand(message.sessionPath, message.command);
      return;
    }

    if (message.type === 'setSessionItemName') {
      await this.setSessionItemName(message.sessionPath, message.name);
      return;
    }

    if (message.type === 'selectTreeEntry') {
      await this.navigateTree(message.entryId);
      return;
    }

    if (message.type === 'setSessionName') {
      await this.setSessionNameFromWebview(message.name);
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

    if (message.type === 'removePromptContext') {
      this.removePromptContext(message.id);
      return;
    }

    if (message.type === 'abort') {
      await this.abortActivePrompt();
      return;
    }

    if (message.type === 'copyText') {
      await this.copyTextFromWebview(message.text);
      return;
    }

    if (message.type !== 'submit') {
      return;
    }

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

    try {
      await this.getClient().prompt(promptText);
    } catch (error) {
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
    this.sessionViewMode = options.viewMode ?? 'chat';
    this.sessionsError = '';
    this.treeRefreshSequence += 1;
    this.treeItems = [];
    this.treeRefreshing = false;
    this.treeError = '';
    this.currentSessionFile = undefined;
    this.resetSessionDiffTracker(undefined);
    this.currentSessionName = '';
    this.sessions = this.sessions.map((session) => ({ ...session, current: false }));
    this.nextClientSessionFile = undefined;
    this.shouldRestoreInitialSessionHistory = false;
    this.sessionHistoryLoading = false;
    this.restartClientWhenIdle = false;
    this.options.onSessionFileChange?.(undefined);
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
    const entries = Array.isArray(context) ? context : [context];
    const attachments = entries.flatMap((entry) => this.createPromptContextAttachment(entry));

    if (attachments.length === 0) {
      return;
    }

    this.promptContext.push(...attachments);
    this.sessionViewMode = 'chat';
    this.sessionsError = '';
    this.postState();
  }

  public removePromptContext(id: string): void {
    const nextContext = this.promptContext.filter((attachment) => attachment.id !== id);

    if (nextContext.length === this.promptContext.length) {
      return;
    }

    this.promptContext = nextContext;
    this.postState();
  }

  private clearPostedComposerText(message: WebviewStateMessage): void {
    if (this.pendingComposerText && message.composerTextRevision === this.pendingComposerText.revision) {
      this.pendingComposerText = undefined;
    }
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
      outputColors: this.options.getOutputColors?.() ?? true,
      promptContext: this.getWebviewPromptContext(),
      composer: this.pendingComposerText
        ? {
          text: this.pendingComposerText.text,
          revision: this.pendingComposerText.revision
        }
        : undefined,
      contextUsage: {
        label: this.contextUsageLabel,
        title: this.contextUsageTitle,
        level: this.contextUsageLevel
      },
      metadataRefreshing: this.metadataRefreshing,
      workspaceDiffStats: this.sessionDiffStats,
      sessionView: this.shouldPublishSessionView()
        ? {
          viewMode: this.sessionViewMode === 'sessions' || this.sessionViewMode === 'tree' ? this.sessionViewMode : undefined,
          sessions: this.sessions,
          refreshing: this.sessionsRefreshing,
          error: this.sessionsError,
          currentSessionFile: this.currentSessionFile,
          currentSessionName: this.currentSessionName,
          treeItems: this.treeItems,
          treeRefreshing: this.treeRefreshing,
          treeError: this.treeError,
          sessionLoading: this.sessionHistoryLoading
        }
        : undefined
    });
  }

  private shouldPublishSessionView(): boolean {
    return this.sessionViewMode === 'sessions'
      || this.sessionViewMode === 'tree'
      || this.sessions.length > 0
      || this.sessionsRefreshing
      || Boolean(this.sessionsError)
      || Boolean(this.currentSessionFile)
      || Boolean(this.currentSessionName)
      || this.sessionHistoryLoading
      || this.treeItems.length > 0
      || this.treeRefreshing
      || Boolean(this.treeError);
  }

  private createPromptContextAttachment(input: PiPromptContextInput): PiPromptContextAttachment[] {
    const path = input.path.trim();

    if (!path) {
      return [];
    }

    const kind = input.kind === 'selection' ? 'selection' : 'file';
    const label = (input.label ?? '').trim() || createPromptContextLabel(input, path);
    const title = (input.title ?? '').trim() || createPromptContextTitle(input, path);

    if (kind === 'file') {
      return [{ id: this.nextPromptContextId(), kind, path, label, title }];
    }

    const text = typeof input.text === 'string' ? input.text : '';

    if (!text.trim()) {
      return [];
    }

    return [{
      id: this.nextPromptContextId(),
      kind,
      path,
      label,
      title,
      languageId: input.languageId,
      startLine: normalizeLineNumber(input.startLine),
      endLine: normalizeLineNumber(input.endLine),
      text
    }];
  }

  private nextPromptContextId(): string {
    this.promptContextSequence += 1;
    return `context-${this.promptContextSequence}`;
  }

  private getWebviewPromptContext(): WebviewPromptContextAttachment[] {
    return this.promptContext.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      label: attachment.label,
      title: attachment.title
    }));
  }

  private consumePromptContext(): PiPromptContextAttachment[] {
    if (this.promptContext.length === 0) {
      return [];
    }

    const context = this.promptContext.map((attachment) => ({ ...attachment }));
    this.promptContext = [];
    return context;
  }

  private restorePromptContext(context: PiPromptContextAttachment[]): void {
    if (context.length === 0) {
      return;
    }

    this.promptContext = [
      ...context.map((attachment) => ({ ...attachment })),
      ...this.promptContext
    ];
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

  public refreshContextUsage(options: { startClient?: boolean; silent?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.session.generation;
    const existingRefresh = this.contextUsageRefreshInFlight;

    if (existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    let refreshPromise!: Promise<void>;

    refreshPromise = this.runContextUsageRefresh(options, sessionGeneration)
      .finally(() => {
        if (this.contextUsageRefreshInFlight?.promise === refreshPromise) {
          this.contextUsageRefreshInFlight = undefined;
        }
      });

    this.contextUsageRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

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

  private showSessions(): void {
    this.sessionViewMode = 'sessions';
    this.sessionsError = '';
    this.postState();
    void this.refreshSessions();
  }

  private showTree(): void {
    this.sessionViewMode = 'tree';
    this.treeError = '';
    this.postState();
    void this.refreshTree();
  }

  private hideSessions(): void {
    if (this.sessionViewMode === 'chat') {
      return;
    }

    this.sessionViewMode = 'chat';
    this.sessionsError = '';
    this.treeError = '';
    this.postState();
  }

  private async refreshSessions(): Promise<void> {
    const refreshId = ++this.sessionsRefreshSequence;
    this.sessionsRefreshing = true;
    this.sessionsError = '';
    this.postState();

    try {
      const listSessions = this.options.listSessions ?? defaultListSessions;
      const sessions = await listSessions(this.options.getCwd?.(), this.currentSessionFile);

      if (refreshId !== this.sessionsRefreshSequence) {
        return;
      }

      this.sessions = sessions.map((session) => ({ ...session }));
      const currentSession = this.sessions.find((session) => this.currentSessionFile
        ? session.path === this.currentSessionFile
        : session.current);
      this.applyCurrentSessionName(currentSession?.name);
    } catch (error) {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsError = getErrorMessage(error);
      }
    } finally {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsRefreshing = false;
        this.postState();
      }
    }
  }

  private async refreshTree(): Promise<void> {
    const refreshId = ++this.treeRefreshSequence;
    const sessionFile = this.currentSessionFile;
    this.treeRefreshing = true;
    this.treeError = '';
    this.postState();

    try {
      const listSessionTree = this.options.listSessionTree ?? listPiSessionTree;
      const treeItems = await listSessionTree(sessionFile);

      if (!this.isCurrentTreeRefresh(refreshId, sessionFile)) {
        return;
      }

      this.treeItems = treeItems;
    } catch (error) {
      if (this.isCurrentTreeRefresh(refreshId, sessionFile)) {
        this.treeError = getErrorMessage(error);
      }
    } finally {
      if (this.isCurrentTreeRefresh(refreshId, sessionFile)) {
        this.treeRefreshing = false;
        this.postState();
      }
    }
  }

  private async navigateTree(entryId: string): Promise<void> {
    if (this.session.isBusy) {
      this.options.showNotification('Wait for Pi to finish before navigating the session tree.', 'warning');
      return;
    }

    this.treeError = '';
    this.treeRefreshing = true;
    this.postState();

    try {
      const result = await this.getClient().navigateTree(entryId, { summarize: false });

      if (result.cancelled) {
        return;
      }

      if (result.editorText) {
        this.setComposerText(result.editorText);
      }

      await this.adoptReplacedSession();
      void this.refreshTree();
    } catch (error) {
      const message = getErrorMessage(error);
      this.treeError = message.includes('Unknown command') || message.includes('Unsupported command')
        ? 'This Pi version does not expose session tree navigation over RPC yet.'
        : message;
      this.postState();
    } finally {
      this.treeRefreshing = false;
      if (this.sessionViewMode === 'tree') {
        this.postState();
      }
    }
  }

  private async switchSession(sessionPath: string): Promise<void> {
    if (this.session.isBusy) {
      this.options.showNotification('Wait for Pi to finish before switching sessions.', 'warning');
      return;
    }

    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.sessionHistoryLoading = true;
    this.postState();

    try {
      const result = await this.getClient().switchSession(trimmedPath);

      if (result.cancelled) {
        this.sessionHistoryLoading = false;
        this.postState();
        return;
      }

      await this.adoptReplacedSession({ fallbackSessionFile: trimmedPath });
    } catch (error) {
      this.sessionHistoryLoading = false;
      this.sessionsError = getErrorMessage(error);
      this.postState();
    } finally {
      this.sessionsRefreshing = false;
      if (this.sessionViewMode === 'sessions') {
        this.postState();
      }
    }
  }

  private async deleteSession(sessionPath: string): Promise<void> {
    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    const normalizedPath = normalizeSessionPath(trimmedPath);
    const session = this.sessions.find((entry) => normalizeSessionPath(entry.path) === normalizedPath);
    const isCurrentSession = Boolean(session?.current) || normalizeSessionPath(this.currentSessionFile) === normalizedPath;

    if (session?.liveStatus === 'running' || (isCurrentSession && this.session.isBusy)) {
      this.options.showNotification('Wait for the session to finish before deleting it.', 'warning');
      return;
    }

    if (!this.options.deleteSession) {
      this.options.showNotification('Session deletion is not available in this environment.', 'warning');
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.postState();

    try {
      const deleted = await this.options.deleteSession(trimmedPath, getSessionDisplayName(session, trimmedPath));

      if (!deleted) {
        return;
      }

      this.sessions = this.sessions.filter((entry) => normalizeSessionPath(entry.path) !== normalizedPath);
      this.options.showToast?.('Session moved to Trash.');

      if (isCurrentSession) {
        this.sessionsRefreshing = false;
        this.startNewSession({ viewMode: 'sessions' });
        return;
      }

      await this.refreshSessions();
    } catch (error) {
      this.sessionsError = getErrorMessage(error);
      this.postState();
    } finally {
      this.sessionsRefreshing = false;
      if (this.sessionViewMode === 'sessions') {
        this.postState();
      }
    }
  }

  private async setSessionItemName(sessionPath: string, name: string): Promise<void> {
    await this.runSessionAction(sessionPath, async (session, isCurrentSession) => {
      const trimmedName = name.trim();

      if (isCurrentSession) {
        await this.setCurrentSessionName(trimmedName, { announce: false });
        return;
      }

      await this.withSessionClient(session.path, async (client) => {
        await client.setSessionName(trimmedName);
      });
      this.options.showToast?.(trimmedName ? 'Session renamed.' : 'Session name cleared.');
    });
  }

  private async runSessionItemCommand(sessionPath: string, command: WebviewSessionItemCommand): Promise<void> {
    if (command === 'rename' || command === 'delete') {
      return;
    }

    await this.runSessionAction(sessionPath, async (session, isCurrentSession) => {
      if (command === 'compact' && isCurrentSession) {
        await this.handleCompactSlashCommand('');
        return;
      }

      await this.withSessionClient(session.path, async (client) => {
        switch (command) {
          case 'fork':
            await this.forkSessionWithClient(client);
            return;
          case 'clone':
            await this.cloneSessionWithClient(client);
            return;
          case 'compact':
            await this.compactSessionWithClient(client);
            return;
          case 'export':
            await this.exportSessionWithClient(client);
            return;
          default:
            return;
        }
      });
    });
  }

  private async runSessionAction(
    sessionPath: string,
    action: (session: WebviewSessionItem, isCurrentSession: boolean) => Promise<void>
  ): Promise<void> {
    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    const normalizedPath = normalizeSessionPath(trimmedPath);
    const session = this.sessions.find((entry) => normalizeSessionPath(entry.path) === normalizedPath)
      ?? createFallbackSessionItem(trimmedPath);
    const isCurrentSession = Boolean(session.current) || normalizeSessionPath(this.currentSessionFile) === normalizedPath;

    if (session.liveStatus === 'running' || (isCurrentSession && this.session.isBusy)) {
      this.options.showNotification('Wait for the session to finish before running this command.', 'warning');
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.postState();

    try {
      await action(session, isCurrentSession);
      await this.refreshSessions();
    } catch (error) {
      this.sessionsError = getErrorMessage(error);
      this.postState();
    } finally {
      this.sessionsRefreshing = false;

      if (this.sessionViewMode === 'sessions') {
        this.postState();
      }
    }
  }

  private async forkSessionWithClient(client: PiRpcClientLike): Promise<void> {
    const select = this.options.extensionUi?.select;

    if (!select) {
      this.options.showNotification('Fork selection is not available in this environment.', 'warning');
      return;
    }

    const forkMessages = formatForkMessages((await client.getForkMessages()).messages);

    if (forkMessages.length === 0) {
      this.options.showNotification('No messages to fork from.', 'warning');
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

    const result = await client.fork(selected.entryId);

    if (!result.cancelled) {
      this.options.showToast?.('Forked session.');
    }
  }

  private async cloneSessionWithClient(client: PiRpcClientLike): Promise<void> {
    const result = await client.clone();

    if (!result.cancelled) {
      this.options.showToast?.('Cloned session.');
    }
  }

  private async compactSessionWithClient(client: PiRpcClientLike): Promise<void> {
    await client.compact(undefined);
    this.options.showToast?.('Compacted session.');
  }

  private async exportSessionWithClient(client: PiRpcClientLike): Promise<void> {
    const result = await client.exportHtml(undefined);
    const path = typeof result.path === 'string' && result.path ? result.path : 'HTML file';
    this.options.showToast?.(`Exported session to ${path}.`);
  }

  private async withSessionClient<T>(sessionPath: string, action: (client: PiRpcClientLike) => Promise<T>): Promise<T> {
    const clientOptions: PiRpcClientOptions = { cwd: this.options.getCwd?.(), sessionFile: sessionPath };
    const piPath = this.options.getPiPath?.();

    if (piPath) {
      clientOptions.piPath = piPath;
    }

    const client = this.options.createClient(clientOptions);
    const extensionUiRequestHandler = new ExtensionUiRequestHandler({
      ui: this.options.extensionUi ?? createCancellingExtensionUi(this.options.showNotification),
      respond: (response) => client.respondExtensionUiRequest(response),
      onError: (message) => {
        this.sessionsError = message;
        this.postState();
      }
    });
    const disposables = [
      { dispose: client.onEvent((event) => {
        if (event.type === 'extension_ui_request') {
          void extensionUiRequestHandler.handle(event);
        }
      }) },
      { dispose: client.onError((message) => {
        this.sessionsError = message;
        this.postState();
      }) }
    ];

    try {
      return await action(client);
    } finally {
      extensionUiRequestHandler.dispose();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      client.dispose();
    }
  }

  private async adoptReplacedSession(options: { fallbackSessionFile?: string; refreshSessions?: boolean } = {}): Promise<void> {
    const client = this.getClient();

    this.extensionUiRequestHandler.startNewGeneration();
    this.assistantStreamId = 0;
    this.liveToolCallsById.clear();
    this.resetAbortState();
    this.metadataRefreshSequence += 1;
    this.slashCommandsRefreshSequence += 1;
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
    this.sessionViewMode = 'chat';
    this.sessionsError = '';
    void this.refreshSessionDiffStats();
    this.postState();

    void this.refreshSessionMeta({ startClient: true, force: true });

    if (options.refreshSessions) {
      void this.refreshSessions();
    }
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
        this.sessionHistoryLoading = false;
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
        this.restoreInitialSessionHistory(client, sessionGeneration, refreshId),
        this.refreshModelMeta(client, sessionGeneration, refreshId),
        this.refreshContextUsageForMetadata(client, sessionGeneration, refreshId),
        this.refreshModelOptions(client, sessionGeneration, refreshId)
      ].map((refresh) => refresh.catch(handleRefreshError)));
    } finally {
      if (this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        this.setMetadataRefreshing(false);
      }
    }
  }

  private async restoreInitialSessionHistory(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    if (!this.shouldRestoreInitialSessionHistory) {
      return;
    }

    let result: Awaited<ReturnType<PiRpcClientLike['getMessages']>>;

    try {
      result = await client.getMessages();
    } catch (error) {
      if (this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        this.sessionHistoryLoading = false;
        this.postState();
      }

      throw error;
    }

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
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

  private async refreshModelMeta(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const state = await client.getState();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    this.maybeRunReadyScript(client);

    const sessionFileChanged = this.applyCurrentSessionFile(getSessionFile(state));
    const sessionNameChanged = this.applyCurrentSessionName(state.sessionName);

    if (sessionFileChanged) {
      void this.refreshSessions();
    }

    if (sessionNameChanged || this.applyModelMeta(getModelMeta(state))) {
      this.postState();
    }
  }

  private async refreshContextUsageForMetadata(
    client: PiRpcClientLike,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const stats = await client.getSessionStats();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    this.applySessionStats(stats);
  }

  private async runContextUsageRefresh(
    options: { startClient?: boolean; silent?: boolean },
    sessionGeneration: number
  ): Promise<void> {
    let client: PiRpcClientLike | undefined;

    try {
      client = options.startClient ? this.getClient() : this.getExistingClient();
    } catch (error) {
      if (!options.silent && sessionGeneration === this.session.generation) {
        this.handleClientError(getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    try {
      const stats = await client.getSessionStats();

      if (sessionGeneration !== this.session.generation) {
        return;
      }

      this.applySessionStats(stats);
    } catch (error) {
      if (!options.silent && sessionGeneration === this.session.generation) {
        this.handleClientError(getErrorMessage(error));
      }
    }
  }

  private applySessionStats(stats: PiSessionStats): void {
    const statsSessionFile = getSessionFile(stats);
    const sessionNameChanged = this.applyCurrentSessionName(stats.sessionName);

    if (statsSessionFile && this.applyCurrentSessionFile(statsSessionFile)) {
      void this.refreshSessions();
    }

    if (sessionNameChanged || this.applyContextUsage(formatContextUsage(stats))) {
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

  private isCurrentTreeRefresh(refreshId: number, sessionFile: string | undefined): boolean {
    return refreshId === this.treeRefreshSequence
      && sessionFile === this.currentSessionFile;
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

  private applyCurrentSessionFile(sessionFile: string | undefined): boolean {
    if (sessionFile === this.currentSessionFile) {
      return false;
    }

    const previousSessionFile = this.currentSessionFile;
    const currentDiffSnapshot = this.sessionDiffTracker.snapshot();
    this.currentSessionFile = sessionFile;

    if (sessionFile && !previousSessionFile && hasSessionDiffStats(currentDiffSnapshot.stats) && !this.loadSessionDiffSnapshot(sessionFile)) {
      this.saveSessionDiffSnapshot();
    } else {
      this.resetSessionDiffTracker(sessionFile);
    }

    this.treeRefreshSequence += 1;
    this.treeRefreshing = false;
    this.treeItems = [];
    this.sessions = this.sessions.map((session) => ({
      ...session,
      current: Boolean(sessionFile) && session.path === sessionFile
    }));
    this.options.onSessionFileChange?.(sessionFile);
    return true;
  }

  private applyCurrentSessionName(name: string | undefined): boolean {
    if (typeof name !== 'string') {
      return false;
    }

    const nextName = name.trim();

    const sessionsChanged = this.applySessionNameToCurrentSession(nextName);

    if (nextName === this.currentSessionName) {
      return sessionsChanged;
    }

    this.currentSessionName = nextName;
    return true;
  }

  private applySessionNameToCurrentSession(name: string): boolean {
    const nextName = name.trim() || undefined;
    let changed = false;

    this.sessions = this.sessions.map((session) => {
      const isCurrent = Boolean(this.currentSessionFile)
        ? session.path === this.currentSessionFile
        : session.current;

      if (!isCurrent || session.name === nextName) {
        return session;
      }

      changed = true;
      return { ...session, name: nextName };
    });

    return changed;
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
          this.showTree();
          return;
        case 'resume':
          this.showSessions();
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

    if (this.currentSessionFile || this.sessions.length > 0) {
      void this.refreshSessions();
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
    if (this.sessionDiffRefreshInFlight) {
      return this.sessionDiffRefreshInFlight;
    }

    const sessionGeneration = this.session.generation;
    const refresh = this.sessionDiffTracker.restoreFromSessionFile(this.currentSessionFile)
      .then((stats) => {
        if (sessionGeneration !== this.session.generation) {
          return;
        }

        this.applySessionDiffStats(stats);
      })
      .finally(() => {
        if (this.sessionDiffRefreshInFlight === refresh) {
          this.sessionDiffRefreshInFlight = undefined;
        }
      });

    this.sessionDiffRefreshInFlight = refresh;
    return refresh;
  }

  private applySessionDiffStats(stats: SessionDiffStats): void {
    const addedLines = normalizeDiffLineCount(stats.addedLines);
    const removedLines = normalizeDiffLineCount(stats.removedLines);

    this.saveSessionDiffSnapshot();

    if (addedLines === this.sessionDiffStats.addedLines && removedLines === this.sessionDiffStats.removedLines) {
      return;
    }

    this.sessionDiffStats = { addedLines, removedLines };
    this.postState();
  }

  private resetSessionDiffTracker(sessionFile: string | undefined): void {
    this.sessionDiffTracker.restore(this.loadSessionDiffSnapshot(sessionFile));
    this.sessionDiffStats = this.sessionDiffTracker.getStats();
    void this.refreshSessionDiffStats();
  }

  private loadSessionDiffSnapshot(sessionFile: string | undefined): SessionDiffSnapshot | undefined {
    return sessionFile ? this.options.loadSessionDiffSnapshot?.(sessionFile) : undefined;
  }

  private saveSessionDiffSnapshot(): void {
    if (!this.currentSessionFile) {
      return;
    }

    this.options.saveSessionDiffSnapshot?.(this.currentSessionFile, this.sessionDiffTracker.snapshot());
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
    const changed = Boolean(this.contextUsageLabel || this.contextUsageTitle || this.contextUsageLevel);
    this.contextUsageLabel = '';
    this.contextUsageTitle = '';
    this.contextUsageLevel = '';

    if (changed) {
      this.notifySessionMetaChange();
    }
  }

  private disposeClient(): void {
    this.extensionUiRequestHandler.startNewGeneration();

    for (const disposable of this.clientDisposables.splice(0)) {
      disposable.dispose();
    }

    this.client?.dispose();
    this.client = undefined;
    this.readyScriptClient = undefined;
    this.resumedClient = undefined;
  }

  private maybeRunReadyScript(client: PiRpcClientLike): void {
    if (this.readyScriptClient === client) {
      return;
    }

    this.readyScriptClient = client;

    if (this.resumedClient === client) {
      return;
    }

    this.runReadyScript();
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

    const sessionFile = this.nextClientSessionFile ?? this.currentSessionFile;
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

    if (sessionFile) {
      this.resumedClient = client;
    }
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
        if (this.runReadyScript() && this.client) {
          this.readyScriptClient = this.client;
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
    const stats = this.sessionDiffTracker.addToolExecution(this.enrichLiveToolExecutionEvent(event) as ToolExecutionInput);
    this.applySessionDiffStats(stats);
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
    this.metadataRefreshing = false;
    this.slashCommandsRefreshing = false;
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
    this.metadataRefreshSequence += 1;
    this.slashCommandsRefreshSequence += 1;
    this.metadataRefreshInFlight = undefined;
    this.contextUsageRefreshInFlight = undefined;
    this.slashCommandsRefreshInFlight = undefined;
    this.metadataRefreshing = false;
    this.slashCommandsRefreshing = false;
    this.disposeClient();
    this.postState();
    void Promise.all([
      this.refreshSessionMeta({ startClient: true, force: true }),
      this.refreshSlashCommands({ startClient: true, force: true })
    ]).then(undefined, () => undefined);
  }
}

async function defaultListSessions(): Promise<WebviewSessionItem[]> {
  return [];
}

function formatContextUsage(stats: PiSessionStats): PiChatContextUsage {
  const usage = stats.contextUsage;

  if (!usage || typeof usage.contextWindow !== 'number') {
    return { label: '', title: '', level: '' };
  }

  const percent = typeof usage.percent === 'number' ? Math.round(usage.percent) : undefined;
  const tokens = typeof usage.tokens === 'number' ? usage.tokens : undefined;

  if (percent === undefined && tokens === undefined) {
    return {
      label: '?%',
      title: [
        'Context usage unavailable',
        `Model context size: ${formatInteger(usage.contextWindow)} tokens`
      ].join('\n'),
      level: 'low'
    };
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

function getSessionFile(state: { sessionFile?: string }): string | undefined {
  return typeof state.sessionFile === 'string' && state.sessionFile
    ? state.sessionFile
    : undefined;
}

function normalizeSessionPath(sessionPath: string | undefined): string {
  return typeof sessionPath === 'string' ? sessionPath.replace(/\\/g, '/') : '';
}

function createFallbackSessionItem(sessionPath: string): WebviewSessionItem {
  return {
    path: sessionPath,
    id: sessionPath.split(/[\\/]/).pop()?.trim() || sessionPath,
    cwd: '',
    created: '',
    modified: '',
    messageCount: 0,
    firstMessage: '',
    depth: 0,
    isLast: true,
    ancestorContinues: [],
    current: false
  };
}

function getSessionDisplayName(session: WebviewSessionItem | undefined, fallbackPath: string): string {
  const name = session?.name?.trim() || session?.firstMessage?.trim() || session?.id?.trim();

  if (name) {
    return name.length > 80 ? name.slice(0, 77) + '...' : name;
  }

  const fileName = fallbackPath.split(/[\\/]/).pop()?.trim();
  return fileName || 'session';
}

function normalizeLineNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function createPromptContextLabel(input: PiPromptContextInput, path: string): string {
  return appendLineRange(getPathBasename(path), input);
}

function createPromptContextTitle(input: PiPromptContextInput, path: string): string {
  return appendLineRange(path, input);
}

function appendLineRange(label: string, input: PiPromptContextInput): string {
  if (input.kind !== 'selection') {
    return label;
  }

  const startLine = normalizeLineNumber(input.startLine);
  const endLine = normalizeLineNumber(input.endLine);

  if (startLine && endLine && endLine !== startLine) {
    return `${label}:${startLine}-${endLine}`;
  }

  if (startLine) {
    return `${label}:${startLine}`;
  }

  return label;
}

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

type ForkMessageOption = {
  entryId: string;
  text: string;
};

function formatForkMessages(messages: PiForkMessage[] | undefined): ForkMessageOption[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    const entryId = typeof message.entryId === 'string' ? message.entryId : '';
    const text = typeof message.text === 'string'
      ? message.text.trim()
      : '';

    return entryId && text ? [{ entryId, text }] : [];
  });
}

function formatForkMessageLabel(message: ForkMessageOption, index: number): string {
  return `${index + 1}. ${truncateOneLine(message.text, 120)}`;
}

function truncateOneLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatAgentMessages(messages: PiAgentMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const transcript: ChatMessage[] = [];
  const toolCallsById = new Map<string, RestoredToolCall>();
  let lastAssistant: ChatMessage | undefined;
  let restoredActivitySequence = 0;

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    if (message.role === 'user') {
      const text = extractPiMessageText(message.content, { includeImages: true });

      if (text.trim()) {
        transcript.push({ role: 'user', text });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls = extractRestoredToolCalls(message.content);

      for (const toolCall of toolCalls) {
        toolCallsById.set(toolCall.id, toolCall);
      }

      const text = extractPiMessageText(message.content, { includeImages: true });
      const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : '';
      const displayText = text || errorMessage;

      if (displayText.trim() || toolCalls.length > 0) {
        const chatMessage: ChatMessage = {
          role: 'assistant',
          text: displayText,
          ...(errorMessage ? { error: true } : {})
        };
        transcript.push(chatMessage);
        lastAssistant = chatMessage;
      } else {
        lastAssistant = undefined;
      }

      continue;
    }

    if (message.role === 'toolResult') {
      const activity = formatRestoredToolResultActivity(message, toolCallsById);

      if (activity) {
        const target = lastAssistant ?? createRestoredToolAssistantMessage(transcript);
        restoredActivitySequence += 1;
        target.activities ??= [];
        target.activities.push({
          id: `restored-tool-${restoredActivitySequence}`,
          ...activity
        });
        lastAssistant = target;
      }

      continue;
    }

    if (message.role === 'compactionSummary') {
      const summary = typeof message.summary === 'string' ? message.summary : '';

      if (summary.trim()) {
        transcript.push({ role: 'system', text: `Compacted session context.\n\n${summary}` });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'branchSummary') {
      const summary = typeof message.summary === 'string' ? message.summary : '';

      if (summary.trim()) {
        transcript.push({ role: 'system', text: `Returned from branch.\n\n${summary}` });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'custom') {
      const displayText = typeof message.display === 'string'
        ? message.display
        : extractPiMessageText(message.content, { includeImages: true });

      if (displayText.trim()) {
        transcript.push({ role: 'system', text: displayText });
      }

      lastAssistant = undefined;
    }
  }

  return transcript;
}

function extractRestoredToolCalls(content: unknown): RestoredToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((item): RestoredToolCall[] => {
    if (!isRecord(item) || item.type !== 'toolCall') {
      return [];
    }

    const id = typeof item.id === 'string' ? item.id : '';

    if (!id) {
      return [];
    }

    return [{
      id,
      name: typeof item.name === 'string' ? item.name : undefined,
      args: item.arguments ?? item.args
    }];
  });
}

function formatRestoredToolResultActivity(
  message: PiAgentMessage,
  toolCallsById: Map<string, RestoredToolCall>
): ChatActivityInput | undefined {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  const restoredToolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
  const toolName = typeof message.toolName === 'string'
    ? message.toolName
    : restoredToolCall?.name;
  const result = { content: message.content };

  if (!toolName && message.content === undefined) {
    return undefined;
  }

  return formatToolExecutionActivity({
    toolName,
    args: restoredToolCall?.args,
    result,
    status: message.isError === true ? 'error' : 'completed'
  });
}

function createRestoredToolAssistantMessage(transcript: ChatMessage[]): ChatMessage {
  const message: ChatMessage = { role: 'assistant', text: '' };
  transcript.push(message);
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
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

function formatSlashCommands(commands: PiCommand[] | undefined): WebviewSlashCommand[] {
  if (!Array.isArray(commands)) {
    return [];
  }

  return commands
    .flatMap((command) => {
      const name = typeof command.name === 'string' ? command.name.trim() : '';

      if (!name) {
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

function parseLocalSlashCommand(text: string): { name: string; args: string } | undefined {
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return undefined;
  }

  const name = match[1];

  if (!isBuiltinSlashCommand(name)) {
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

function normalizeDiffLineCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function hasSessionDiffStats(stats: SessionDiffStats | undefined): boolean {
  return Boolean(stats && (stats.addedLines > 0 || stats.removedLines > 0));
}

function isUnsupportedReloadCommandError(error: unknown): boolean {
  return /unknown command:?\s+reload/i.test(getErrorMessage(error));
}

function isAbortMessage(message: string): boolean {
  return message.trim().toLowerCase() === 'aborted';
}

function isClientLifecycleError(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return normalized.startsWith('pi rpc process exited')
    || normalized.startsWith('failed to start pi rpc process')
    || normalized.startsWith('failed to parse pi rpc output')
    || normalized.startsWith('received malformed pi rpc output')
    || normalized.includes('pi rpc process is not running')
    || normalized.includes('pi rpc client disposed');
}

function isMessageUpdateStart(event: RpcEvent): boolean {
  const assistantMessageEvent = event.assistantMessageEvent;

  return typeof assistantMessageEvent === 'object'
    && assistantMessageEvent !== null
    && 'type' in assistantMessageEvent
    && assistantMessageEvent.type === 'start';
}
