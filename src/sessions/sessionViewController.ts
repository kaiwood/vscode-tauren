import { listPiSessionTree } from './piSessionTree';
import type {
  WebviewSessionItem,
  WebviewSessionItemCommand,
  WebviewTreeItem
} from '../webviewProtocol/types';
import type { PiChatControllerOptions } from '../controller/types';
import type { PiRpcClientLike } from '../rpc/clientTypes';
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

export type SessionViewMode = 'chat' | 'sessions' | 'tree';

export type SessionViewState = {
  viewMode?: 'sessions' | 'tree';
  sessions: WebviewSessionItem[];
  refreshing: boolean;
  error: string;
  currentSessionFile?: string;
  currentSessionName: string;
  treeItems: WebviewTreeItem[];
  treeRefreshing: boolean;
  treeError: string;
  sessionLoading: boolean;
};

type SessionViewControllerOptions = Pick<
  PiChatControllerOptions,
  | 'createClient'
  | 'deleteSession'
  | 'extensionUi'
  | 'getCwd'
  | 'getPiPath'
  | 'supportsSessionTree'
  | 'listSessions'
  | 'listSessionTree'
  | 'onSessionFileChange'
  | 'showNotification'
  | 'showSessionChanges'
  | 'showToast'
> & {
  initialSessionFile?: string;
  applySessionFile: (sessionFile: string | undefined) => void;
  adoptReplacedSession: (options?: { fallbackSessionFile?: string; refreshSessions?: boolean }) => Promise<void>;
  getClient: () => PiRpcClientLike;
  handleCompactCurrentSession: () => Promise<void>;
  isBusy: () => boolean;
  postState: () => void;
  setComposerText: (text: string) => void;
  setCurrentSessionName: (name: string, options: { announce: boolean }) => Promise<void>;
  setSessionHistoryLoading: (value: boolean) => void;
  hasStartedCurrentSession: () => boolean;
  startNewSession: (options?: { viewMode?: 'chat' | 'sessions' }) => void;
};

export class SessionViewController {
  private viewMode: SessionViewMode = 'chat';
  private sessions: WebviewSessionItem[] = [];
  private sessionsRefreshing = false;
  private sessionsError = '';
  private treeItems: WebviewTreeItem[] = [];
  private treeRefreshing = false;
  private treeError = '';
  private sessionsRefreshSequence = 0;
  private treeRefreshSequence = 0;
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

  public getWebviewState(sessionLoading: boolean): SessionViewState | undefined {
    if (!this.shouldPublish(sessionLoading)) {
      return undefined;
    }

    return {
      viewMode: this.viewMode === 'sessions' || this.viewMode === 'tree' ? this.viewMode : undefined,
      sessions: this.sessions,
      refreshing: this.sessionsRefreshing,
      error: this.sessionsError,
      currentSessionFile: this.sessionFile,
      currentSessionName: this.sessionName,
      treeItems: this.treeItems,
      treeRefreshing: this.treeRefreshing,
      treeError: this.treeError,
      sessionLoading
    };
  }

  public shouldPublish(sessionLoading: boolean): boolean {
    return this.viewMode === 'sessions'
      || this.viewMode === 'tree'
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
    this.viewMode = 'sessions';
    this.sessionsError = '';
    this.options.postState();
    void this.refreshSessions();
  }

  public canNavigateTree(): boolean {
    return this.options.supportsSessionTree?.() ?? false;
  }

  public showTree(): void {
    this.viewMode = 'tree';
    this.treeError = '';
    this.options.postState();
    void this.refreshTree();
  }

  public showChat(options: { clearSessionsError?: boolean; clearTreeError?: boolean } = {}): void {
    this.viewMode = 'chat';

    if (options.clearSessionsError) {
      this.sessionsError = '';
    }

    if (options.clearTreeError) {
      this.treeError = '';
    }
  }

  public hideSessions(): void {
    if (this.viewMode === 'chat') {
      return;
    }

    this.showChat({ clearSessionsError: true, clearTreeError: true });
    this.options.postState();
  }

  public startNewSession(viewMode: 'chat' | 'sessions' = 'chat'): void {
    this.viewMode = viewMode;
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

  public async refreshSessions(): Promise<void> {
    const refreshId = ++this.sessionsRefreshSequence;
    this.sessionsRefreshing = true;
    this.sessionsError = '';
    this.options.postState();

    try {
      const listSessions = this.options.listSessions ?? defaultListSessions;
      const sessions = await listSessions(this.options.getCwd?.(), this.sessionFile);

      if (refreshId !== this.sessionsRefreshSequence) {
        return;
      }

      this.sessions = this.mergeCurrentSessionFallback(sessions);
      const currentSession = this.sessions.find((session) => this.sessionFile
        ? normalizeSessionPath(session.path) === normalizeSessionPath(this.sessionFile)
        : session.current);
      this.applyCurrentSessionName(currentSession?.name);
    } catch (error) {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsError = getErrorMessage(error);
      }
    } finally {
      if (refreshId === this.sessionsRefreshSequence) {
        this.sessionsRefreshing = false;
        this.options.postState();
      }
    }
  }

  public async refreshTree(): Promise<void> {
    const refreshId = ++this.treeRefreshSequence;
    const sessionFile = this.sessionFile;
    this.treeRefreshing = true;
    this.treeError = '';
    this.options.postState();

    try {
      const client = this.options.getClient();
      const treeItems = typeof client.getSessionTree === 'function'
        ? await client.getSessionTree()
        : await (this.options.listSessionTree ?? listPiSessionTree)(sessionFile);

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

  public async navigateTree(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string } = {}
  ): Promise<void> {
    if (this.options.isBusy()) {
      this.options.showNotification('Wait for Pi to finish before navigating the session tree.', 'warning');
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
        ? 'This Pi version does not expose session tree navigation over RPC yet.'
        : message;
      this.options.postState();
    } finally {
      this.treeRefreshing = false;
      if (this.viewMode === 'tree') {
        this.options.postState();
      }
    }
  }

  public async switchSession(sessionPath: string): Promise<void> {
    if (this.options.isBusy()) {
      this.options.showNotification('Wait for Pi to finish before switching sessions.', 'warning');
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
      if (this.viewMode === 'sessions') {
        this.options.postState();
      }
    }
  }

  public async deleteSession(sessionPath: string): Promise<void> {
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

    if (this.fallbackSessionPaths.has(normalizedPath)) {
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
        this.options.startNewSession({ viewMode: 'sessions' });
        return;
      }

      await this.refreshSessions();
    } catch (error) {
      this.sessionsError = getErrorMessage(error);
      this.options.postState();
    } finally {
      this.sessionsRefreshing = false;
      if (this.viewMode === 'sessions') {
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

    if (session.liveStatus === 'running' || (isCurrentSession && this.options.isBusy())) {
      this.options.showNotification('Wait for the session to finish before running this command.', 'warning');
      return;
    }

    const trimmedName = name.trim();
    const previousName = typeof session.name === 'string' ? session.name : undefined;
    const renameSequence = (this.sessionItemNameRenameSequences.get(normalizedPath) ?? 0) + 1;
    this.sessionItemNameRenameSequences.set(normalizedPath, renameSequence);
    this.sessionsError = '';

    if (!isCurrentSession) {
      this.applySessionItemName(trimmedPath, trimmedName || undefined);
      this.options.postState();
    }

    try {
      if (isCurrentSession) {
        await this.options.setCurrentSessionName(trimmedName, { announce: false });
      } else {
        await withSessionClient(session.path, this.getBackgroundSessionClientOptions(), async (client) => {
          await client.setSessionName(trimmedName);
        });
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
      }
    }
  }

  public async runSessionItemCommand(sessionPath: string, command: WebviewSessionItemCommand): Promise<void> {
    if (command === 'rename' || command === 'delete') {
      return;
    }

    await this.runSessionAction(sessionPath, async (session, isCurrentSession) => {
      if (command === 'showChanges') {
        await this.showSessionChanges(session);
        return;
      }

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

      if (this.viewMode === 'sessions') {
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

    if (isCurrentSession) {
      this.options.startNewSession({ viewMode: 'sessions' });
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
      ...this.getSessionClientActionUi(),
      createClient: this.options.createClient,
      getCwd: () => this.options.getCwd?.(),
      getPiPath: () => this.options.getPiPath?.(),
      onError: (message) => {
        this.sessionsError = message;
        this.options.postState();
      }
    };
  }
}

async function defaultListSessions(): Promise<WebviewSessionItem[]> {
  return [];
}
