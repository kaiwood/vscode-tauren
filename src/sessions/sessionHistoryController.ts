import type { ChatSession } from '../chat/chatSession';
import type { AgentClient } from '../agent/clientTypes';
import type { AgentSessionState, AgentSessionStats } from '../agent/types';
import { isStaleKwardSessionRequestError } from '../controller/errors';
import { formatAgentMessages } from '../controller/transcriptFormatting';
import type { AgentEventHandler } from '../controller/piEventHandler';
import { getSessionFile } from './sessionFormatting';
import type { SessionViewController } from './sessionViewController';

export type SessionHistoryControllerOptions = {
  initialSessionFile?: string;
  session: ChatSession;
  sessionView: SessionViewController;
  piEventHandler: AgentEventHandler;
  getClient: () => AgentClient;
  invalidateMetadata: () => void;
  resetSessionMeta: () => void;
  refreshSessionDiffStats: () => void;
  refreshSessionMeta: (options?: { startClient?: boolean; force?: boolean }) => Promise<void>;
  postState: () => void;
};

export class SessionHistoryController {
  private shouldRestoreInitialSessionHistory: boolean;
  private loading: boolean;

  public constructor(private readonly options: SessionHistoryControllerOptions) {
    this.shouldRestoreInitialSessionHistory = Boolean(options.initialSessionFile);
    this.loading = Boolean(options.initialSessionFile);
  }

  public get isLoading(): boolean {
    return this.loading;
  }

  public get needsInitialHistoryRestore(): boolean {
    return this.shouldRestoreInitialSessionHistory;
  }

  public setLoading(value: boolean): void {
    this.loading = value;
  }

  public startNewSession(): void {
    this.shouldRestoreInitialSessionHistory = false;
    this.loading = false;
  }

  public async adoptReplacedSession(options: { fallbackSessionFile?: string; refreshSessions?: boolean } = {}): Promise<void> {
    const client = this.options.getClient();

    this.options.piEventHandler.reset();
    this.options.invalidateMetadata();
    this.shouldRestoreInitialSessionHistory = false;
    this.loading = true;
    this.options.resetSessionMeta();

    let messagesResult: Awaited<ReturnType<AgentClient['getMessages']>>;
    let stateResult: Awaited<ReturnType<AgentClient['getState']>> | undefined;

    try {
      [messagesResult, stateResult] = await Promise.all([
        client.getMessages(),
        client.getState().catch((error) => isStaleKwardSessionRequestError(error) ? undefined : Promise.reject(error))
      ]);
    } catch (error) {
      this.loading = false;
      this.options.postState();
      if (isStaleKwardSessionRequestError(error)) {
        return;
      }
      throw error;
    }

    const sessionFile = stateResult
      ? getSessionFile(stateResult) ?? options.fallbackSessionFile
      : options.fallbackSessionFile;
    this.applyCurrentSessionFile(sessionFile);
    this.applyCurrentSessionName(stateResult?.sessionName);
    this.options.piEventHandler.clearLiveToolCalls();
    this.options.session.replaceMessages(formatAgentMessages(messagesResult.messages));
    this.loading = false;
    this.options.sessionView.showChat({ clearSessionsError: true, post: false });
    this.options.refreshSessionDiffStats();
    this.options.postState();

    void this.options.refreshSessionMeta({ startClient: true, force: true });

    if (options.refreshSessions) {
      void this.options.sessionView.refreshSessions();
    }
  }

  public async restoreInitialSessionHistory(
    client: Pick<AgentClient, 'getMessages'>,
    _sessionGeneration: number,
    isCurrent: () => boolean
  ): Promise<void> {
    if (!this.shouldRestoreInitialSessionHistory) {
      return;
    }

    let result: Awaited<ReturnType<AgentClient['getMessages']>>;

    try {
      result = await client.getMessages();
    } catch (error) {
      if (isStaleKwardSessionRequestError(error)) {
        return;
      }

      if (isCurrent()) {
        this.loading = false;
        this.options.postState();
      }

      throw error;
    }

    if (!isCurrent()) {
      return;
    }

    this.shouldRestoreInitialSessionHistory = false;
    this.loading = false;

    if (this.options.session.isEmpty) {
      const messages = formatAgentMessages(result.messages);

      if (messages.length > 0) {
        this.options.piEventHandler.clearLiveToolCalls();
        this.options.session.replaceMessages(messages);
      }
    }

    this.options.postState();
  }

  public applySessionStateIdentity(state: AgentSessionState): { sessionFileChanged: boolean; sessionNameChanged: boolean } {
    return {
      sessionFileChanged: this.applyCurrentSessionFile(getSessionFile(state)),
      sessionNameChanged: this.applyCurrentSessionName(state.sessionName)
    };
  }

  public applySessionStatsIdentity(stats: AgentSessionStats): { sessionFileChanged: boolean; sessionNameChanged: boolean } {
    const statsSessionFile = getSessionFile(stats);

    return {
      sessionFileChanged: Boolean(statsSessionFile && this.applyCurrentSessionFile(statsSessionFile)),
      sessionNameChanged: this.applyCurrentSessionName(stats.sessionName)
    };
  }

  private applyCurrentSessionFile(sessionFile: string | undefined): boolean {
    return this.options.sessionView.applyCurrentSessionFile(sessionFile);
  }

  private applyCurrentSessionName(name: string | undefined): boolean {
    return this.options.sessionView.applyCurrentSessionName(name);
  }
}
