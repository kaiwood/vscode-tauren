import type { NavigationController } from '../navigation/navigationController';
import type {
  WebviewLane,
  WebviewMessage,
  WebviewSessionItem,
  WebviewSessionItemCommand,
  WebviewSessionSearchState,
  WebviewTreeItem
} from '../webviewProtocol/types';
import type { TaurenChatControllerOptions } from '../controller/types';
import type { AgentClient } from '../agent/clientTypes';
import { getErrorMessage } from '../controller/errors';
import {
  cloneSessionWithClient,
  compactSessionWithClient,
  exportSessionWithClient,
  forkSessionWithClient,
  withSessionClient,
  type BackgroundSessionClientOptions,
  type SessionClientActionUi
} from './sessionClientActions';
import {
  createFallbackSessionItem,
  getSessionDisplayName,
  normalizeSessionPath
} from './sessionFormatting';
import { SessionSearchIndex } from './sessionSearchIndex';

const sessionSearchBackgroundIndexDelayMs = 150;
export type SessionViewState = {
  sessions: WebviewSessionItem[];
  refreshing: boolean;
  error: string;
  search?: WebviewSessionSearchState;
  currentSessionFile?: string;
  currentSessionName: string;
  treeItems: WebviewTreeItem[];
  treeRefreshing: boolean;
  treeError: string;
  sessionLoading: boolean;
};

type SessionViewControllerOptions = Pick<
  TaurenChatControllerOptions,
  | 'createClient'
  | 'deleteSession'
  | 'extensionUi'
  | 'getCwd'
  | 'listSessions'
  | 'onSessionFileChange'
  | 'renameOpenSession'
  | 'showNotification'
  | 'showSessionChanges'
  | 'showToast'
> & {
  initialSessionFile?: string;
  applySessionFile: (sessionFile: string | undefined) => void;
  adoptReplacedSession: (options?: { fallbackSessionFile?: string; refreshSessions?: boolean }) => Promise<void>;
  getClient: () => AgentClient;
  handleCompactCurrentSession: () => Promise<void>;
  isBusy: () => boolean;
  postState: () => void;
  setComposerText: (text: string) => void;
  setCurrentSessionName: (name: string, options: { announce: boolean }) => Promise<void>;
  setSessionHistoryLoading: (value: boolean) => void;
  hasStartedCurrentSession: () => boolean;
  shouldRefreshSessionsOnShow?: () => boolean;
  navigation: NavigationController;
  startNewSession: (options?: { lane?: 'chat' | 'sessions' }) => void;
};

export class SessionViewController {
  private sessions: WebviewSessionItem[] = [];
  private sessionsRefreshing = false;
  private sessionsError = '';
  private treeItems: WebviewTreeItem[] = [];
  private treeRefreshing = false;
  private treeError = '';
  private sessionsRefreshSequence = 0;
  private sessionsRefreshPromise: Promise<void> | undefined;
  private treeRefreshSequence = 0;
  private readonly sessionSearchIndex = new SessionSearchIndex();
  private sessionSearchState: WebviewSessionSearchState | undefined;
  private pendingSessionSearchProgressPost: ReturnType<typeof setTimeout> | undefined;
  private pendingSessionSearchIndexStart: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingSessionItemNames = new Map<string, string | undefined>();
  private readonly fallbackSessionPaths = new Set<string>();
  private readonly sessionItemNameRenameSequences = new Map<string, number>();
  private sessionFile: string | undefined;
  private sessionName = '';

  public constructor(private readonly options: SessionViewControllerOptions) {
    this.sessionFile = options.initialSessionFile;
  }

  public get currentSessionFile(): string | undefined {
    return this.sessionFile;
  }

  public get currentSessionName(): string {
    return this.sessionName;
  }

  public get sessionCount(): number {
    return this.sessions.length;
  }

  public get isSessionListVisible(): boolean {
    return this.options.navigation.isSessionListVisible;
  }

  public get isTreeVisible(): boolean {
    return this.options.navigation.isTreeVisible;
  }

  public getWebviewState(sessionLoading: boolean): SessionViewState | undefined {
    if (!this.shouldPublish(sessionLoading)) {
      return undefined;
    }

    return {
      sessions: this.sessions,
      refreshing: this.sessionsRefreshing,
      error: this.sessionsError,
      search: this.sessionSearchState,
      currentSessionFile: this.sessionFile,
      currentSessionName: this.sessionName,
      treeItems: this.treeItems,
      treeRefreshing: this.treeRefreshing,
      treeError: this.treeError,
      sessionLoading
    };
  }

  public shouldPublish(sessionLoading: boolean): boolean {
    return this.options.navigation.lane === 'sessions'
      || this.options.navigation.lane === 'tree'
      || this.sessions.length > 0
      || this.sessionsRefreshing
      || Boolean(this.sessionsError)
      || Boolean(this.sessionFile)
      || Boolean(this.sessionName)
      || sessionLoading
      || this.treeItems.length > 0
      || this.treeRefreshing
      || Boolean(this.treeError);
  }

  public showSessions(): void {
    const hasCachedSessions = this.sessions.length > 0;
    this.options.navigation.showLane('sessions', { post: false });
    this.sessionsError = '';
    this.refreshSessionSearchState({ post: false });
    this.options.postState();
    this.scheduleSessionSearchIndexing();

    if (!hasCachedSessions || this.options.shouldRefreshSessionsOnShow?.()) {
      void this.refreshSessions('showSessions');
    }
  }

  public showTree(): void {
    this.options.navigation.showLane('tree', { post: false });
    this.treeError = '';
    this.cancelPendingSessionSearchIndexing();
    this.options.postState();
    void this.refreshTree();
  }

  public toggleSessions(): void {
    if (this.options.navigation.lane === 'sessions') {
      this.hideSessionLane();
      return;
    }

    this.showSessions();
  }

  public toggleTree(): void {
    if (this.options.navigation.lane === 'tree') {
      this.hideSessionLane();
      return;
    }

    this.showTree();
  }

  public showChat(options: { clearSessionsError?: boolean; clearTreeError?: boolean; post?: boolean } = {}): void {
    this.options.navigation.showChatMain({ post: false });
    this.cancelPendingSessionSearchIndexing();

    if (options.clearSessionsError) {
      this.sessionsError = '';
    }

    if (options.clearTreeError) {
      this.treeError = '';
    }

    if (options.post !== false) {
      this.options.postState();
    }
  }

  public hideSessionLane(): void {
    if (this.options.navigation.lane === 'chat') {
      return;
    }

    this.showChat({ clearSessionsError: true, clearTreeError: true });
  }

  public startNewSession(lane: WebviewLane = 'chat'): void {
    this.options.navigation.showLane(lane, { post: false });
    this.cancelPendingSessionSearchIndexing();
    this.sessionsError = '';
    this.treeRefreshSequence += 1;
    this.treeItems = [];
    this.treeRefreshing = false;
    this.treeError = '';
    this.sessionFile = undefined;
    this.sessionName = '';
    this.fallbackSessionPaths.clear();
    this.sessions = this.sessions.map((session) => ({ ...session, current: false }));
    this.options.onSessionFileChange?.(undefined);
  }

  public refreshSessions(reason = 'manual'): Promise<void> {
    if (this.sessionsRefreshPromise) {
      return this.sessionsRefreshPromise;
    }

    this.sessionsRefreshPromise = this.refreshSessionsNow(reason).finally(() => {
      this.sessionsRefreshPromise = undefined;
    });
    return this.sessionsRefreshPromise;
  }

  private async refreshSessionsNow(reason: string): Promise<void> {
    const refreshId = ++this.sessionsRefreshSequence;
    this.sessionsRefreshing = true;
    this.sessionsError = '';
    this.cancelPendingSessionSearchIndexing();
    this.options.postState();

    try {
      const listSessions = this.options.listSessions ?? defaultListSessions;
      const sessions = await listSessions(this.options.getCwd?.(), this.sessionFile, {
        previousSessions: this.sessions,
        reason,
        onProgress: (progressSessions) => {
          if (refreshId !== this.sessionsRefreshSequence) {
            return;
          }

          this.applySessionList(progressSessions);
          this.options.postState();
        }
      });

      if (refreshId !== this.sessionsRefreshSequence) {
        return;
      }

      this.applySessionList(sessions);
    } catch (error) {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsError = getErrorMessage(error);
      }
    } finally {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsRefreshing = false;
        this.options.postState();
        if (this.sessionSearchState?.query) {
          this.startSessionSearchIndexing();
        } else {
          this.scheduleSessionSearchIndexing();
        }
      }
    }
  }

  public searchSessions(message: Extract<WebviewMessage, { type: 'searchSessions' }>): void {
    const query = message.query.trim();
    const progress = this.sessionSearchIndex.getProgress();

    this.sessionSearchState = {
      requestId: message.requestId,
      query,
      namedOnly: message.namedOnly,
      status: this.getSessionSearchStatus(progress),
      matchedSessionPaths: [],
      indexedCount: progress.indexedCount,
      totalCount: progress.totalCount
    };

    if (query) {
      this.startSessionSearchIndexing();
      this.updateSessionSearchResults(message.requestId, query, message.namedOnly);
    } else {
      this.options.postState();
    }
  }

  public async refreshTree(): Promise<void> {
    const refreshId = ++this.treeRefreshSequence;
    const sessionFile = this.sessionFile;
    this.treeRefreshing = true;
    this.treeError = '';
    this.options.postState();

    try {
      const treeItems = await this.options.getClient().getSessionTree();

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
        this.options.postState();
      }
    }
  }

  public async setTreeEntryLabel(entryId: string, label: string): Promise<void> {
    if (this.options.isBusy()) {
      this.options.showNotification('Wait for Pi engine to finish before editing session tree labels.', 'warning');
      return;
    }

    try {
      const trimmedLabel = label.trim();
      await this.options.getClient().setTreeEntryLabel(entryId, trimmedLabel || undefined);
      this.treeItems = this.treeItems.map((item) => item.entryId === entryId
        ? trimmedLabel
          ? { ...item, label: trimmedLabel }
          : omitTreeItemLabel(item)
        : item);
      this.options.postState();
      void this.refreshTree();
    } catch (error) {
      this.treeError = getErrorMessage(error);
      this.options.postState();
    }
  }

  public async navigateTree(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string } = {}
  ): Promise<void> {
    if (this.options.isBusy()) {
      this.options.showNotification('Wait for Pi engine to finish before navigating the session tree.', 'warning');
      return;
    }

    this.treeError = '';
    this.treeRefreshing = true;
    this.options.postState();

    try {
      const result = await this.options.getClient().navigateTree(entryId, {
        summarize: options.summarize ?? false,
        ...(options.customInstructions ? { customInstructions: options.customInstructions } : {})
      });

      if (result.cancelled) {
        return;
      }

      if (result.editorText) {
        this.options.setComposerText(result.editorText);
      }

      await this.options.adoptReplacedSession();
      void this.refreshTree();
    } catch (error) {
      const message = getErrorMessage(error);
      this.treeError = message.includes('Unknown command') || message.includes('Unsupported command')
        ? 'This Pi version does not expose session tree navigation yet.'
        : message;
      this.options.postState();
    } finally {
      this.treeRefreshing = false;
      if (this.options.navigation.lane === 'tree') {
        this.options.postState();
      }
    }
  }

  public async switchSession(sessionPath: string): Promise<void> {
    if (this.options.isBusy()) {
      this.options.showNotification('Wait for Pi engine to finish before switching sessions.', 'warning');
      return;
    }

    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.options.setSessionHistoryLoading(true);
    this.options.postState();

    try {
      const result = await this.options.getClient().switchSession(trimmedPath);

      if (result.cancelled) {
        this.options.setSessionHistoryLoading(false);
        this.options.postState();
        return;
      }

      await this.options.adoptReplacedSession({ fallbackSessionFile: trimmedPath });
    } catch (error) {
      this.options.setSessionHistoryLoading(false);
      this.sessionsError = getErrorMessage(error);
      this.options.postState();
    } finally {
      this.sessionsRefreshing = false;
      if (this.options.navigation.lane === 'sessions') {
        this.options.postState();
      }
    }
  }

  public async deleteSession(sessionPath: string): Promise<void> {
    await this.deleteSessionPath(sessionPath, { removeFallbackOnly: true });
  }

  public async deleteCurrentSession(): Promise<void> {
    if (!this.sessionFile) {
      this.options.showNotification('No persisted session is available to move to Trash yet.', 'info');
      return;
    }

    await this.deleteSessionPath(this.sessionFile, { removeFallbackOnly: false });
  }

  private async deleteSessionPath(sessionPath: string, options: { removeFallbackOnly: boolean }): Promise<void> {
    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    const normalizedPath = normalizeSessionPath(trimmedPath);
    const session = this.sessions.find((entry) => normalizeSessionPath(entry.path) === normalizedPath);
    const isCurrentSession = Boolean(session?.current) || normalizeSessionPath(this.sessionFile) === normalizedPath;

    if (session?.liveStatus === 'running' || (isCurrentSession && this.options.isBusy())) {
      this.options.showNotification('Wait for the session to finish before deleting it.', 'warning');
      return;
    }

    if (options.removeFallbackOnly && this.fallbackSessionPaths.has(normalizedPath)) {
      this.removeFallbackSession(normalizedPath, isCurrentSession);
      return;
    }

    if (!this.options.deleteSession) {
      this.options.showNotification('Session deletion is not available in this environment.', 'warning');
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.options.postState();

    try {
      const deleted = await this.options.deleteSession(trimmedPath, getSessionDisplayName(session, trimmedPath));

      if (!deleted) {
        return;
      }

      this.sessions = this.sessions.filter((entry) => normalizeSessionPath(entry.path) !== normalizedPath);
      this.options.showToast?.('Session moved to Trash.');

      if (isCurrentSession) {
        this.sessionsRefreshing = false;
        this.options.startNewSession({ lane: 'sessions' });
        return;
      }

      await this.refreshSessions();
    } catch (error) {
      this.sessionsError = getErrorMessage(error);
      this.options.postState();
    } finally {
      this.sessionsRefreshing = false;
      if (this.options.navigation.lane === 'sessions') {
        this.options.postState();
      }
    }
  }

  public async setSessionItemName(sessionPath: string, name: string): Promise<void> {
    const trimmedPath = sessionPath.trim();

    if (!trimmedPath) {
      return;
    }

    const normalizedPath = normalizeSessionPath(trimmedPath);
    const session = this.sessions.find((entry) => normalizeSessionPath(entry.path) === normalizedPath)
      ?? createFallbackSessionItem(trimmedPath);
    const isCurrentSession = Boolean(session.current) || normalizeSessionPath(this.sessionFile) === normalizedPath;

    const trimmedName = name.trim();
    const previousName = typeof session.name === 'string' ? session.name : undefined;
    const nextName = trimmedName || undefined;
    const renameSequence = (this.sessionItemNameRenameSequences.get(normalizedPath) ?? 0) + 1;
    this.sessionItemNameRenameSequences.set(normalizedPath, renameSequence);
    this.pendingSessionItemNames.set(normalizedPath, nextName);
    this.sessionsError = '';

    if (!isCurrentSession) {
      this.applySessionItemName(trimmedPath, trimmedName || undefined);
      this.options.postState();
    }

    try {
      if (isCurrentSession) {
        await this.options.setCurrentSessionName(trimmedName, { announce: false });
      } else {
        const renamedOpenSession = await this.options.renameOpenSession?.(session.path, trimmedName);

        if (!renamedOpenSession) {
          await withSessionClient(session.path, this.getBackgroundSessionClientOptions(), async (client) => {
            await client.setSessionName(trimmedName);
          });
        }

        this.options.showToast?.(trimmedName ? 'Session renamed.' : 'Session name cleared.');
      }

      if (this.sessionItemNameRenameSequences.get(normalizedPath) === renameSequence) {
        await this.refreshSessions();
      }
    } catch (error) {
      if (this.sessionItemNameRenameSequences.get(normalizedPath) === renameSequence) {
        if (!isCurrentSession) {
          this.applySessionItemName(trimmedPath, previousName);
        }

        this.sessionsError = getErrorMessage(error);
        this.options.postState();
      }
    } finally {
      if (this.sessionItemNameRenameSequences.get(normalizedPath) === renameSequence) {
        this.sessionItemNameRenameSequences.delete(normalizedPath);
        this.pendingSessionItemNames.delete(normalizedPath);
      }
    }
  }

  public async runSessionItemCommand(sessionPath: string, command: WebviewSessionItemCommand): Promise<void> {
    if (command === 'rename' || command === 'delete') {
      return;
    }

    await this.runSessionAction(sessionPath, async (session, isCurrentSession) => {
      if (command === 'compact' && isCurrentSession) {
        await this.options.handleCompactCurrentSession();
        return;
      }

      const actionOptions = this.getSessionClientActionUi();
      await withSessionClient(session.path, this.getBackgroundSessionClientOptions(), async (client) => {
        switch (command) {
          case 'fork':
            await forkSessionWithClient(client, actionOptions);
            return;
          case 'clone':
            await cloneSessionWithClient(client, actionOptions);
            return;
          case 'compact':
            await compactSessionWithClient(client, actionOptions);
            return;
          case 'export':
            await exportSessionWithClient(client, actionOptions);
            return;
          default:
            return;
        }
      });
    });
  }

  public async showCurrentSessionChanges(): Promise<void> {
    if (!this.sessionFile) {
      this.options.showNotification('No persisted session changes are available yet.', 'info');
      return;
    }

    const session = this.sessions.find((entry) => normalizeSessionPath(entry.path) === normalizeSessionPath(this.sessionFile));
    await this.showSessionChanges(session ?? createFallbackSessionItem(this.sessionFile));
  }

  public applyCurrentSessionFile(sessionFile: string | undefined): boolean {
    if (sessionFile === this.sessionFile) {
      return false;
    }

    this.sessionFile = sessionFile;
    this.options.applySessionFile(sessionFile);

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

  public applyCurrentSessionName(name: string | undefined): boolean {
    if (typeof name !== 'string') {
      return false;
    }

    const nextName = name.trim();

    const sessionsChanged = this.applySessionNameToCurrentSession(nextName);

    if (nextName === this.sessionName) {
      return sessionsChanged;
    }

    this.sessionName = nextName;
    return true;
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
    const isCurrentSession = Boolean(session.current) || normalizeSessionPath(this.sessionFile) === normalizedPath;

    if (session.liveStatus === 'running' || (isCurrentSession && this.options.isBusy())) {
      this.options.showNotification('Wait for the session to finish before running this command.', 'warning');
      return;
    }

    this.sessionsError = '';
    this.sessionsRefreshing = true;
    this.options.postState();

    try {
      await action(session, isCurrentSession);
      await this.refreshSessions();
    } catch (error) {
      this.sessionsError = getErrorMessage(error);
      this.options.postState();
    } finally {
      this.sessionsRefreshing = false;

      if (this.options.navigation.lane === 'sessions') {
        this.options.postState();
      }
    }
  }

  private async showSessionChanges(session: WebviewSessionItem): Promise<void> {
    if (!this.options.showSessionChanges) {
      this.options.showNotification('Session changes view is not available in this environment.', 'warning');
      return;
    }

    await this.options.showSessionChanges(session.path, getSessionDisplayName(session, session.path));
  }

  private applySessionList(sessions: WebviewSessionItem[]): void {
    this.sessions = this.applyPendingSessionItemNames(this.mergeCurrentSessionFallback(sessions));
    this.sessionSearchIndex.setSessions(this.sessions);
    this.refreshSessionSearchState({ post: false });
    if (this.sessionSearchState?.query) {
      this.startSessionSearchIndexing();
    }
    const currentSession = this.sessions.find((session) => this.sessionFile
      ? normalizeSessionPath(session.path) === normalizeSessionPath(this.sessionFile)
      : session.current);

    if (currentSession) {
      this.applyCurrentSessionName(currentSession.name ?? '');
    }
  }

  private scheduleSessionSearchIndexing(): void {
    if (this.pendingSessionSearchIndexStart || (this.options.navigation.lane !== 'sessions' && !this.sessionSearchState?.query)) {
      return;
    }

    this.pendingSessionSearchIndexStart = setTimeout(() => {
      this.pendingSessionSearchIndexStart = undefined;
      this.startSessionSearchIndexing();
      this.options.postState();
    }, sessionSearchBackgroundIndexDelayMs);
  }

  private cancelPendingSessionSearchIndexing(): void {
    if (!this.pendingSessionSearchIndexStart) {
      return;
    }

    clearTimeout(this.pendingSessionSearchIndexStart);
    this.pendingSessionSearchIndexStart = undefined;
  }

  private startSessionSearchIndexing(): void {
    this.cancelPendingSessionSearchIndexing();

    if (this.options.navigation.lane !== 'sessions' && !this.sessionSearchState?.query) {
      return;
    }

    this.sessionSearchIndex.startIndexing(() => this.handleSessionSearchIndexProgress());
    this.refreshSessionSearchState({ post: false });
  }

  private handleSessionSearchIndexProgress(): void {
    this.refreshSessionSearchState({ post: false });

    if (this.pendingSessionSearchProgressPost) {
      return;
    }

    this.pendingSessionSearchProgressPost = setTimeout(() => {
      this.pendingSessionSearchProgressPost = undefined;
      this.refreshSessionSearchState({ post: false });
      this.options.postState();
    }, 100);
  }

  private refreshSessionSearchState(options: { post: boolean }): void {
    const current = this.sessionSearchState;
    const progress = this.sessionSearchIndex.getProgress();

    if (!current) {
      this.sessionSearchState = {
        requestId: 0,
        query: '',
        namedOnly: false,
        status: this.getSessionSearchStatus(progress),
        matchedSessionPaths: [],
        indexedCount: progress.indexedCount,
        totalCount: progress.totalCount
      };
    } else if (current.query) {
      this.updateSessionSearchResults(current.requestId, current.query, current.namedOnly, { post: false });
    } else {
      this.sessionSearchState = {
        ...current,
        status: this.getSessionSearchStatus(progress),
        indexedCount: progress.indexedCount,
        totalCount: progress.totalCount
      };
    }

    if (options.post) {
      this.options.postState();
    }
  }

  private updateSessionSearchResults(
    requestId: number,
    query: string,
    namedOnly: boolean,
    options: { post?: boolean } = {}
  ): void {
    const result = this.sessionSearchIndex.search(query, { namedOnly });

    this.sessionSearchState = {
      requestId,
      query,
      namedOnly,
      status: this.getSessionSearchStatus(result),
      matchedSessionPaths: result.matchedSessionPaths,
      indexedCount: result.indexedCount,
      totalCount: result.totalCount
    };

    if (options.post !== false) {
      this.options.postState();
    }
  }

  private getSessionSearchStatus(progress: { indexedCount: number; totalCount: number; indexing: boolean }): WebviewSessionSearchState['status'] {
    if (progress.totalCount === 0) {
      return 'idle';
    }

    if (progress.indexing) {
      return 'indexing';
    }

    return progress.indexedCount >= progress.totalCount ? 'ready' : 'idle';
  }

  private applyPendingSessionItemNames(sessions: WebviewSessionItem[]): WebviewSessionItem[] {
    if (this.pendingSessionItemNames.size === 0) {
      return sessions;
    }

    return sessions.map((session) => {
      const normalizedPath = normalizeSessionPath(session.path);

      if (!this.pendingSessionItemNames.has(normalizedPath)) {
        return session;
      }

      const pendingName = this.pendingSessionItemNames.get(normalizedPath);
      return { ...session, name: pendingName };
    });
  }

  private mergeCurrentSessionFallback(sessions: WebviewSessionItem[]): WebviewSessionItem[] {
    const sessionFile = this.sessionFile;

    if (!sessionFile) {
      this.fallbackSessionPaths.clear();
      return sessions.map((session) => ({ ...session }));
    }

    const currentPath = normalizeSessionPath(sessionFile);
    let foundCurrent = false;
    const merged = sessions.map((session) => {
      const sessionPath = normalizeSessionPath(session.path);
      const isCurrent = sessionPath === currentPath;
      this.fallbackSessionPaths.delete(sessionPath);

      if (!isCurrent) {
        return session.current ? { ...session, current: false } : { ...session };
      }

      foundCurrent = true;
      const currentSession = { ...session, current: true };
      return this.sessionName && !currentSession.name
        ? { ...currentSession, name: this.sessionName }
        : currentSession;
    });

    if (foundCurrent) {
      this.fallbackSessionPaths.delete(currentPath);
      return merged;
    }

    if (!this.shouldShowCurrentSessionFallback()) {
      this.fallbackSessionPaths.delete(currentPath);
      return merged;
    }

    const fallback = createFallbackSessionItem(sessionFile);
    this.fallbackSessionPaths.add(currentPath);
    return [{
      ...fallback,
      current: true,
      isLast: merged.length === 0,
      name: this.sessionName || undefined,
      firstMessage: this.sessionName || 'New session'
    }, ...merged];
  }

  private shouldShowCurrentSessionFallback(): boolean {
    return Boolean(this.sessionName || this.options.hasStartedCurrentSession());
  }

  private removeFallbackSession(normalizedPath: string, isCurrentSession: boolean): void {
    this.fallbackSessionPaths.delete(normalizedPath);
    this.sessions = this.sessions.filter((entry) => normalizeSessionPath(entry.path) !== normalizedPath);
    this.sessionSearchIndex.setSessions(this.sessions);
    this.refreshSessionSearchState({ post: false });

    if (isCurrentSession) {
      this.options.startNewSession({ lane: 'sessions' });
      return;
    }

    this.options.postState();
  }

  private applySessionItemName(sessionPath: string, name: string | undefined): boolean {
    const normalizedPath = normalizeSessionPath(sessionPath);
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : undefined;
    let changed = false;

    this.sessions = this.sessions.map((session) => {
      if (normalizeSessionPath(session.path) !== normalizedPath || session.name === nextName) {
        return session;
      }

      changed = true;
      return { ...session, name: nextName };
    });

    if (changed) {
      this.sessionSearchIndex.setSessions(this.sessions);
      this.refreshSessionSearchState({ post: false });
    }

    return changed;
  }

  private applySessionNameToCurrentSession(name: string): boolean {
    const nextName = name.trim() || undefined;
    let changed = false;

    this.sessions = this.sessions.map((session) => {
      const isCurrent = Boolean(this.sessionFile)
        ? normalizeSessionPath(session.path) === normalizeSessionPath(this.sessionFile)
        : session.current;

      if (!isCurrent || session.name === nextName) {
        return session;
      }

      changed = true;
      return { ...session, name: nextName };
    });

    if (changed) {
      this.sessionSearchIndex.setSessions(this.sessions);
      this.refreshSessionSearchState({ post: false });
    }

    return changed;
  }

  private isCurrentTreeRefresh(refreshId: number, sessionFile: string | undefined): boolean {
    return refreshId === this.treeRefreshSequence
      && sessionFile === this.sessionFile;
  }

  private getSessionClientActionUi(): SessionClientActionUi {
    return {
      extensionUi: this.options.extensionUi,
      showNotification: (message, notifyType) => this.options.showNotification(message, notifyType),
      showToast: (message, kind) => this.options.showToast?.(message, kind)
    };
  }

  private getBackgroundSessionClientOptions(): BackgroundSessionClientOptions {
    return {
      createClient: this.options.createClient,
      getCwd: () => this.options.getCwd?.(),
      onError: (message) => {
        this.sessionsError = message;
        this.options.postState();
      }
    };
  }
}

function omitTreeItemLabel(item: WebviewTreeItem): WebviewTreeItem {
  const { label: _label, ...rest } = item;
  return rest;
}

async function defaultListSessions(): Promise<WebviewSessionItem[]> {
  return [];
}
