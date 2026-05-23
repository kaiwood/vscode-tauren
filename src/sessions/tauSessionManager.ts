import { PiChatController } from '../piChatController';
import { ExtensionCustomUiHost, type CustomUiHostMessage } from '../extensionUi/customUiHost';
import type { ExtensionUi } from '../extensionUi/types';
import type { PiChatControllerOptions } from '../controller/types';
import type { PiChatSessionMetaSnapshot } from '../metadata/types';
import type { PiPromptContextInput } from '../prompt/types';
import type { WebviewMessage, WebviewSessionItem, WebviewStateMessage } from '../webviewProtocol/types';

export type TauSessionManagerOptions = PiChatControllerOptions & {
  customUi?: {
    isAvailable(): boolean;
    postMessage(message: CustomUiHostMessage): boolean;
    getOutputColors(): boolean;
  };
};

type OpenSessionStatus = 'idle' | 'running' | 'done' | 'error';

const inactiveSessionDisposeAfterMs = 30 * 60 * 1000;
const maxInactiveOpenSessions = 3;

type OpenSession = {
  id: string;
  controller: PiChatController;
  state: WebviewStateMessage | undefined;
  sessionFile: string | undefined;
  status: OpenSessionStatus;
  unread: boolean;
  title: string;
  customUiOpen: boolean;
  customUiHost: ExtensionCustomUiHost | undefined;
  inactiveSince: number | undefined;
  inactiveDisposeTimer: ReturnType<typeof setTimeout> | undefined;
};

export class TauSessionManager {
  private readonly sessions: OpenSession[] = [];
  private sessionCatalog: WebviewSessionItem[] = [];
  private customUiViewAttached = false;
  private activeSessionId = '';
  private sessionSequence = 0;

  public constructor(private readonly options: TauSessionManagerOptions) {
    this.createSession({ initial: true });
  }

  public dispose(): void {
    for (const session of this.sessions.splice(0)) {
      this.clearInactiveDisposal(session);
      session.customUiHost?.dispose();
      session.controller.dispose();
    }
  }

  public async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      await this.active().controller.handleWebviewMessage(message);
      return;
    }

    if (message.type === 'newSession') {
      this.createSession({ activate: true });
      return;
    }

    if (message.type === 'selectSession') {
      const openSession = this.findOpenSessionBySessionFile(message.sessionPath);

      if (openSession) {
        this.activateSession(openSession.id);
        return;
      }

      this.createSession({ activate: true, sessionFile: message.sessionPath });
      return;
    }

    if (message.type === 'submit' && isForkCommand(message.text) && this.hasRunningBackgroundSession()) {
      this.options.showNotification('Wait for background sessions to finish before forking.', 'warning');
      return;
    }

    if (message.type === 'sessionItemCommand' && message.command === 'fork' && this.hasRunningBackgroundSession()) {
      this.options.showNotification('Wait for background sessions to finish before forking.', 'warning');
      return;
    }

    if (message.type === 'customUiInput') {
      this.active().customUiHost?.handleInput(message.id, message.data);
      return;
    }

    if (message.type === 'customUiCancel') {
      this.active().customUiHost?.cancel(message.id);
      return;
    }

    if (message.type === 'customUiDimensions') {
      this.active().customUiHost?.updateDimensions(message.id, message.columns, message.rows);
      return;
    }

    await this.active().controller.handleWebviewMessage(message);
  }

  public newSession(): void {
    this.createSession({ activate: true });
  }

  public async runLocalSlashCommand(name: string): Promise<void> {
    if (name === 'fork' && this.hasRunningBackgroundSession()) {
      this.options.showNotification('Wait for background sessions to finish before forking.', 'warning');
      return;
    }

    await this.active().controller.runLocalSlashCommand(name);
  }

  public toggleSessionList(): void {
    this.active().controller.toggleSessionList();
  }

  public toggleSessionTree(): void {
    this.active().controller.toggleSessionTree();
  }

  public toggleSettings(): void {
    this.active().controller.toggleSettings();
  }

  public addPromptContext(context: PiPromptContextInput | PiPromptContextInput[]): void {
    this.active().controller.addPromptContext(context);
  }

  public postState(): void {
    this.postActiveState();
  }

  public refreshSessionMeta(options: { startClient?: boolean; force?: boolean } = {}): void {
    void this.active().controller.refreshSessionMeta(options);
  }

  public refreshContextUsage(options: { startClient?: boolean; silent?: boolean } = {}): void {
    void this.active().controller.refreshContextUsage(options);
  }

  public refreshSessionDiffStats(): void {
    void this.active().controller.refreshSessionDiffStats();
  }

  public setCustomUiViewAttached(attached: boolean): void {
    if (this.customUiViewAttached === attached) {
      return;
    }

    this.customUiViewAttached = attached;
    this.syncCustomUiAttachment();
  }

  public noteWorkspacePending(): void {
    this.active().controller.noteWorkspacePending();
  }

  public noteWorkspacePendingWarning(): void {
    this.active().controller.noteWorkspacePendingWarning();
  }

  public noteWorkspaceAvailable(cwd: string): void {
    this.active().controller.noteWorkspaceAvailable(cwd);
  }

  public restartForWorkspaceChange(cwd: string, sessionFile: string | undefined): void {
    for (const session of this.sessions) {
      if (session.id !== this.activeSessionId) {
        this.clearInactiveDisposal(session);
        session.customUiHost?.dispose();
        session.controller.dispose();
      }
    }

    const active = this.active();
    this.sessions.splice(0, this.sessions.length, active);
    this.sessionCatalog = [];
    active.sessionFile = sessionFile;
    active.title = sessionFile ? 'Loading session' : 'New session';
    active.unread = false;
    active.status = 'idle';
    active.customUiHost?.cancelActive();
    active.customUiOpen = false;
    active.inactiveSince = undefined;
    active.controller.restartForWorkspaceChange(cwd, sessionFile);
  }

  private createSession(options: { initial?: boolean; activate?: boolean; sessionFile?: string } = {}): OpenSession {
    const previousActive = this.activeSessionId ? this.active() : undefined;
    const id = `open-${++this.sessionSequence}`;
    const initialSessionFile = options.initial ? this.options.initialSessionFile : options.sessionFile;
    const customUiHost = this.createCustomUiHost(id);
    const extensionUi = this.createSessionExtensionUi(customUiHost);
    const session: OpenSession = {
      id,
      controller: new PiChatController({
        ...this.options,
        extensionUi,
        initialSessionFile,
        initialSessionMeta: this.options.initialSessionMeta,
        renameOpenSession: (sessionPath, name) => this.renameOpenSessionFrom(id, sessionPath, name),
        postState: (message) => this.handleSessionState(id, message),
        onSessionMetaChange: (metadata) => this.handleSessionMetaChange(id, metadata),
        onSessionFileChange: (sessionFile) => this.handleSessionFileChange(id, sessionFile)
      }),
      state: undefined,
      sessionFile: initialSessionFile,
      status: 'idle',
      unread: false,
      title: options.initial ? 'Current session' : options.sessionFile ? 'Loading session' : 'New session',
      customUiOpen: false,
      customUiHost,
      inactiveSince: undefined,
      inactiveDisposeTimer: undefined
    };

    this.sessions.push(session);

    if (!this.activeSessionId || options.activate) {
      this.activeSessionId = id;

      if (previousActive && previousActive.id !== session.id) {
        this.movePromptContext(previousActive, session);
      }

      if (!options.initial) {
        this.updateActivePersistence(session);
      }
    }

    this.syncCustomUiAttachment();
    this.reconcileSessionDisposal();
    session.controller.postState();
    void session.controller.refreshSessionDiffStats();

    if (!options.initial) {
      void session.controller.refreshSessionMeta({ startClient: true });
    }

    this.postState();
    return session;
  }

  private activateSession(id: string): void {
    const session = this.sessions.find((entry) => entry.id === id);

    if (!session) {
      return;
    }

    const previousActive = this.active();

    this.activeSessionId = id;
    session.unread = false;

    if (previousActive.id !== session.id) {
      this.movePromptContext(previousActive, session);
    }

    this.updateActivePersistence(session);
    this.syncCustomUiAttachment();
    this.reconcileSessionDisposal();
    void session.controller.refreshSessionDiffStats();
    void session.controller.handleWebviewMessage({ type: 'hideSessions' });
    this.postState();
  }

  private createCustomUiHost(id: string): ExtensionCustomUiHost | undefined {
    const customUi = this.options.customUi;

    if (!customUi) {
      return undefined;
    }

    const host = new ExtensionCustomUiHost({
      isAvailable: customUi.isAvailable,
      postMessage: customUi.postMessage,
      getOutputColors: customUi.getOutputColors,
      notify: (message, notifyType) => this.options.showNotification(message, notifyType),
      onActiveChange: (active) => this.handleCustomUiActiveChange(id, active),
      idPrefix: `custom-ui-${id}`
    });
    host.setAttached(false);
    return host;
  }

  private createSessionExtensionUi(customUiHost: ExtensionCustomUiHost | undefined): ExtensionUi | undefined {
    const baseUi = this.options.extensionUi;

    if (!customUiHost) {
      return baseUi;
    }

    return {
      ...baseUi,
      notify: baseUi?.notify ?? ((message, notifyType) => this.options.showNotification(message, notifyType)),
      select: baseUi?.select ?? (async () => undefined),
      confirm: baseUi?.confirm ?? (async () => undefined),
      input: baseUi?.input ?? (async () => undefined),
      custom: (factory, options) => customUiHost.custom(factory, options)
    };
  }

  private syncCustomUiAttachment(): void {
    for (const session of this.sessions) {
      session.customUiHost?.setAttached(this.customUiViewAttached && session.id === this.activeSessionId);
    }
  }

  private handleCustomUiActiveChange(id: string, active: boolean): void {
    const session = this.sessions.find((entry) => entry.id === id);

    if (!session) {
      return;
    }

    session.customUiOpen = active;

    if (active && id !== this.activeSessionId) {
      session.unread = true;
    }

    const disposedInactiveSession = this.reconcileSessionDisposal();

    if (id === this.activeSessionId || this.active().state?.viewMode === 'sessions' || disposedInactiveSession) {
      this.postState();
    }
  }

  private active(): OpenSession {
    return this.sessions.find((session) => session.id === this.activeSessionId) ?? this.sessions[0];
  }

  private handleSessionState(id: string, message: WebviewStateMessage): void {
    const session = this.sessions.find((entry) => entry.id === id);

    if (!session) {
      return;
    }

    const wasBusy = session.state?.busy ?? false;
    const previousSessionFile = getSessionFile(session.sessionFile);
    const nextSessionFile = getSessionFile(message.currentSessionFile);
    const resetToEmptySession = Boolean(previousSessionFile) && !nextSessionFile && message.messages.length === 0;
    session.state = message;
    if (message.sessions && message.sessions.length > 0) {
      this.sessionCatalog = message.sessions;
    }
    session.sessionFile = nextSessionFile;
    session.status = getStatus(message, session.status);
    session.title = getOpenSessionTitle(message, resetToEmptySession ? 'New session' : session.title);

    if (id !== this.activeSessionId && (message.busy || wasBusy !== message.busy || message.messages.length > 0)) {
      session.unread = true;
    }

    if (id === this.activeSessionId) {
      this.updateActivePersistence(session);
    }

    const disposedInactiveSession = this.reconcileSessionDisposal();

    if (id === this.activeSessionId || this.active().state?.viewMode === 'sessions' || disposedInactiveSession) {
      this.postState();
    }
  }

  private updateActivePersistence(session: OpenSession): void {
    this.options.onSessionFileChange?.(session.state?.currentSessionFile || undefined);
  }

  private movePromptContext(from: OpenSession, to: OpenSession): void {
    const context = from.controller.takePromptContext();
    to.controller.replacePromptContext(context);
  }

  private handleSessionMetaChange(id: string, metadata: PiChatSessionMetaSnapshot): void {
    if (id === this.activeSessionId) {
      this.options.onSessionMetaChange?.(metadata);
    }
  }

  private handleSessionFileChange(id: string, sessionFile: string | undefined): void {
    const session = this.sessions.find((entry) => entry.id === id);

    if (session) {
      session.sessionFile = getSessionFile(sessionFile) ?? session.sessionFile;
    }

    if (id === this.activeSessionId) {
      this.options.onSessionFileChange?.(sessionFile);
    }
  }

  private postActiveState(): void {
    const active = this.active();
    const state = active.state ?? createEmptyState();

    const sessions = state.sessions && state.sessions.length > 0 ? state.sessions : this.sessionCatalog;

    this.options.postState({
      ...state,
      sessions: augmentSessions(sessions ?? [], this.sessions, this.activeSessionId),
      currentSessionName: state.currentSessionName || active.title,
      outputColors: this.options.getOutputColors?.() ?? true,
      animationsEnabled: this.options.getAnimationsEnabled?.() ?? true,
      customUiTheme: this.options.getCustomUiTheme?.() ?? 'default'
    });
  }

  private async renameOpenSessionFrom(sourceSessionId: string, sessionFile: string, name: string): Promise<boolean> {
    const session = this.findOpenSessionBySessionFile(sessionFile);

    if (!session || session.id === sourceSessionId) {
      return false;
    }

    await session.controller.setCurrentSessionName(name);
    session.title = name.trim() || session.title;
    return true;
  }

  private findOpenSessionBySessionFile(sessionFile: string): OpenSession | undefined {
    const normalizedPath = normalizeSessionPath(sessionFile);

    if (!normalizedPath) {
      return undefined;
    }

    return this.sessions.find((session) => {
      const openSessionFile = getSessionFile(session.sessionFile) ?? getSessionFile(session.state?.currentSessionFile);
      return normalizeSessionPath(openSessionFile) === normalizedPath;
    });
  }

  private hasRunningBackgroundSession(): boolean {
    return this.sessions.some((session) => session.id !== this.activeSessionId && session.status === 'running');
  }

  private reconcileSessionDisposal(): boolean {
    const now = Date.now();

    for (const session of this.sessions) {
      this.updateSessionInactivity(session, now);
    }

    return this.disposeExcessInactiveSessions();
  }

  private updateSessionInactivity(session: OpenSession, now: number): void {
    if (!this.isInactiveSession(session)) {
      this.clearInactiveDisposal(session);
      return;
    }

    session.inactiveSince ??= now;
    this.armInactiveDisposalTimer(session, now);
  }

  private armInactiveDisposalTimer(session: OpenSession, now: number): void {
    if (session.inactiveDisposeTimer) {
      return;
    }

    const inactiveSince = session.inactiveSince ?? now;
    const delayMs = Math.max(0, inactiveSince + inactiveSessionDisposeAfterMs - now);
    const timer = setTimeout(() => {
      session.inactiveDisposeTimer = undefined;
      this.disposeExpiredInactiveSession(session.id);
    }, delayMs);

    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }

    session.inactiveDisposeTimer = timer;
  }

  private disposeExpiredInactiveSession(id: string): void {
    const session = this.sessions.find((entry) => entry.id === id);

    if (!session || !this.isInactiveSession(session)) {
      return;
    }

    const inactiveSince = session.inactiveSince;
    const now = Date.now();

    if (inactiveSince === undefined || now - inactiveSince < inactiveSessionDisposeAfterMs) {
      this.updateSessionInactivity(session, now);
      return;
    }

    if (this.disposeInactiveSession(session)) {
      this.postState();
    }
  }

  private disposeExcessInactiveSessions(): boolean {
    const inactiveSessions = this.sessions
      .map((session, index) => ({ session, index }))
      .filter(({ session }) => this.isInactiveSession(session))
      .sort((left, right) => {
        const timeComparison = (right.session.inactiveSince ?? 0) - (left.session.inactiveSince ?? 0);
        return timeComparison !== 0 ? timeComparison : right.index - left.index;
      });

    if (inactiveSessions.length <= maxInactiveOpenSessions) {
      return false;
    }

    let disposed = false;

    for (const { session } of inactiveSessions.slice(maxInactiveOpenSessions)) {
      disposed = this.disposeInactiveSession(session) || disposed;
    }

    return disposed;
  }

  private disposeInactiveSession(session: OpenSession): boolean {
    if (!this.isInactiveSession(session)) {
      return false;
    }

    const index = this.sessions.indexOf(session);

    if (index === -1) {
      return false;
    }

    this.clearInactiveDisposal(session);
    this.sessions.splice(index, 1);
    session.customUiHost?.dispose();
    session.controller.dispose();
    return true;
  }

  private clearInactiveDisposal(session: OpenSession): void {
    if (session.inactiveDisposeTimer) {
      clearTimeout(session.inactiveDisposeTimer);
      session.inactiveDisposeTimer = undefined;
    }

    session.inactiveSince = undefined;
  }

  private isInactiveSession(session: OpenSession): boolean {
    return session.id !== this.activeSessionId && session.status !== 'running' && !session.customUiOpen;
  }
}

function createEmptyState(): WebviewStateMessage {
  return {
    type: 'state',
    messages: [],
    busy: false,
    modelLabel: '',
    modelProvider: '',
    modelId: '',
    modelReasoning: false,
    thinkingLevel: '',
    modelOptions: [],
    contextUsageLabel: '',
    contextUsageTitle: '',
    contextUsageLevel: '',
    metadataRefreshing: false,
    workspaceDiffStats: { addedLines: 0, removedLines: 0 },
    slashCommands: [],
    slashCommandsRefreshing: false,
    outputColors: true,
    animationsEnabled: true,
    customUiTheme: 'default',
    promptContext: [],
    viewMode: 'chat',
    sessions: [],
    sessionsRefreshing: false,
    sessionsError: '',
    currentSessionFile: '',
    currentSessionName: '',
    treeItems: [],
    treeRefreshing: false,
    treeError: ''
  };
}

function getStatus(message: WebviewStateMessage, previous: OpenSessionStatus): OpenSessionStatus {
  if (message.busy) {
    return 'running';
  }

  if (message.messages.some((entry) => entry.error)) {
    return 'error';
  }

  if (previous === 'running' || message.messages.length > 0) {
    return 'done';
  }

  return 'idle';
}

function getOpenSessionTitle(message: WebviewStateMessage, fallback: string): string {
  const namedSession = message.currentSessionName?.trim();

  if (namedSession) {
    return namedSession;
  }

  const firstUserMessage = message.messages.find((entry) => entry.role === 'user')?.text?.trim();

  if (firstUserMessage) {
    return firstUserMessage.length > 60 ? firstUserMessage.slice(0, 57) + '...' : firstUserMessage;
  }

  return fallback;
}

function augmentSessions(sessions: WebviewSessionItem[], openSessions: OpenSession[], activeSessionId: string): WebviewSessionItem[] {
  return sessions.map((session) => {
    const sessionPath = normalizeSessionPath(session.path);
    const openSession = openSessions.find((entry) => {
      const openSessionFile = getSessionFile(entry.sessionFile) ?? getSessionFile(entry.state?.currentSessionFile);
      return normalizeSessionPath(openSessionFile) === sessionPath;
    });

    if (!openSession) {
      return session;
    }

    const name = openSession.state?.currentSessionName?.trim() || session.name;

    return {
      ...session,
      name,
      liveStatus: openSession.status,
      unread: openSession.unread || (openSession.customUiOpen && openSession.id !== activeSessionId),
      customUiOpen: openSession.customUiOpen
    };
  });
}

function getSessionFile(sessionFile: string | undefined): string | undefined {
  return typeof sessionFile === 'string' && sessionFile.trim() ? sessionFile : undefined;
}

function normalizeSessionPath(sessionFile: string | undefined): string {
  return getSessionFile(sessionFile)?.replace(/\\/g, '/') ?? '';
}

function isForkCommand(text: string): boolean {
  const command = text.trim().match(/^\/(\w+)\b/)?.[1];
  return command === 'fork';
}
