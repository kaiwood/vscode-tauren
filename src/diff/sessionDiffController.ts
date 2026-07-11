import { normalizeDiffLineCount } from './lineCount';
import { createTrackedSessionFile, emptySessionDiffStats, getTrackedSessionPath, parseSessionDiffStatsFromFile, SessionDiffTracker } from './sessionDiffTracker';
import type {
  SessionDiffControllerOptions,
  SessionDiffSnapshot,
  SessionDiffStats,
  ToolExecutionInput
} from './types';

export class SessionDiffController {
  private currentSessionFile: string | undefined;
  private stats = emptySessionDiffStats();
  private refreshInFlight: RefreshInFlight | undefined;
  private refreshToken = 0;
  private readonly pendingTrackedPaths = new Set<string>();
  private readonly tracker: SessionDiffTracker;

  public constructor(private readonly options: SessionDiffControllerOptions) {
    this.currentSessionFile = options.initialSessionFile;
    this.tracker = new SessionDiffTracker(this.loadSnapshot(this.currentSessionFile));
    this.stats = this.tracker.getStats();
  }

  public getStats(): SessionDiffStats {
    return { ...this.stats };
  }

  public hasSessionFile(): boolean {
    return Boolean(this.currentSessionFile);
  }

  public async refresh(): Promise<void> {
    const identity = this.getRefreshIdentity();

    if (this.refreshInFlight?.key === identity.key) {
      return this.refreshInFlight.promise;
    }

    const refresh = this.restoreStats(identity.sessionFile)
      .then((stats) => {
        if (!this.isCurrentRefresh(identity)) {
          return;
        }

        if (stats) {
          this.tracker.restore({ stats });
        }

        this.applyStats(this.tracker.getStats());
      })
      .finally(() => {
        if (this.refreshInFlight?.promise === refresh) {
          this.refreshInFlight = undefined;
        }
      });

    this.refreshInFlight = { key: identity.key, promise: refresh };
    return refresh;
  }

  public reset(sessionFile: string | undefined): void {
    this.refreshToken += 1;
    this.currentSessionFile = sessionFile;
    this.tracker.restore(this.loadSnapshot(sessionFile));
    this.stats = this.tracker.getStats();
    void this.refresh();
  }

  public applySessionFile(sessionFile: string | undefined): void {
    const previousSessionFile = this.currentSessionFile;
    const currentSnapshot = this.tracker.snapshot();
    this.currentSessionFile = sessionFile;

    if (sessionFile !== previousSessionFile) {
      this.refreshToken += 1;
    }

    if (sessionFile && !previousSessionFile && hasSessionDiffStats(currentSnapshot.stats) && !this.loadSnapshot(sessionFile)) {
      this.saveSnapshot();
      return;
    }

    this.tracker.restore(this.loadSnapshot(sessionFile));
    this.stats = this.tracker.getStats();
    void this.refresh();
  }

  public addToolExecution(input: unknown): void {
    const stats = this.tracker.addToolExecution(input as ToolExecutionInput);
    this.applyStats(stats);
  }

  public async recordWorkspaceFileChange(absolutePath: string): Promise<void> {
    if (!this.currentSessionFile) {
      return;
    }

    const cwd = this.options.getCwd?.();
    const trackedPath = getTrackedSessionPath(cwd, absolutePath);

    if (!trackedPath || this.tracker.hasTrackedFile(trackedPath) || this.pendingTrackedPaths.has(trackedPath)) {
      return;
    }

    this.pendingTrackedPaths.add(trackedPath);

    try {
      const trackedFile = await createTrackedSessionFile(cwd, absolutePath);

      if (!trackedFile || !this.tracker.addTrackedFile(trackedFile)) {
        return;
      }

      this.saveSnapshot();
    } finally {
      this.pendingTrackedPaths.delete(trackedPath);
    }
  }

  private applyStats(stats: SessionDiffStats): void {
    const addedLines = normalizeDiffLineCount(stats.addedLines);
    const removedLines = normalizeDiffLineCount(stats.removedLines);

    if (addedLines === this.stats.addedLines && removedLines === this.stats.removedLines) {
      return;
    }

    this.stats = { addedLines, removedLines };
    this.saveSnapshot();
    this.options.postState();
  }

  private loadSnapshot(sessionFile: string | undefined): SessionDiffSnapshot | undefined {
    return sessionFile ? this.options.loadSnapshot?.(sessionFile) : undefined;
  }

  private async restoreStats(sessionFile: string | undefined): Promise<SessionDiffStats | undefined> {
    if (!sessionFile) {
      return undefined;
    }

    return this.options.restoreStatsFromSessionFile?.(sessionFile) ?? parseSessionDiffStatsFromFile(sessionFile);
  }

  private getRefreshIdentity(): RefreshIdentity {
    const sessionFile = this.currentSessionFile;
    const sessionGeneration = this.options.getSessionGeneration();
    const token = this.refreshToken;

    return {
      sessionFile,
      sessionGeneration,
      token,
      key: JSON.stringify([sessionFile, sessionGeneration, token])
    };
  }

  private isCurrentRefresh(identity: RefreshIdentity): boolean {
    return identity.sessionFile === this.currentSessionFile
      && identity.sessionGeneration === this.options.getSessionGeneration()
      && identity.token === this.refreshToken;
  }

  private saveSnapshot(): void {
    if (!this.currentSessionFile) {
      return;
    }

    this.options.saveSnapshot?.(this.currentSessionFile, this.tracker.snapshot());
  }
}

type RefreshIdentity = {
  key: string;
  sessionFile: string | undefined;
  sessionGeneration: number;
  token: number;
};

type RefreshInFlight = {
  key: string;
  promise: Promise<void>;
};

function hasSessionDiffStats(stats: SessionDiffStats | undefined): boolean {
  return Boolean(stats && (stats.addedLines > 0 || stats.removedLines > 0));
}
