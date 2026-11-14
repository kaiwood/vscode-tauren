import { execFile, type ChildProcess } from 'node:child_process';
import type { ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent';

/** One provider per footer: replacing/dismissing a footer also removes its subscriptions. */
export class RemoteFooterData implements ReadonlyFooterDataProvider {
  private branch: string | null = null;
  private callbacks = new Set<() => void>();
  private stopped = false;
  private refreshing = false;
  private child: ChildProcess | undefined;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly options: {
    getCwd(): string;
    getStatuses(): ReadonlyMap<string, string>;
    getAvailableProviderCount?(): number;
    changed(): void;
    diagnostic(message: string): void;
  }) {
    this.timer = setInterval(() => this.refresh(), 30_000);
    this.timer.unref();
    this.refresh();
  }
  getGitBranch(): string | null { return this.branch; }
  getExtensionStatuses(): ReadonlyMap<string, string> { return new Map(this.options.getStatuses()); }
  getAvailableProviderCount(): number { return this.options.getAvailableProviderCount?.() ?? 0; }
  onBranchChange(callback: () => void): () => void {
    if (!this.stopped) this.callbacks.add(callback);
    return () => { this.callbacks.delete(callback); };
  }
  dispose(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.callbacks.clear();
    this.child?.kill();
    this.child = undefined;
  }
  private refresh(): void {
    if (this.stopped || this.refreshing) return;
    this.refreshing = true;
    try {
      this.child = execFile('git', ['-C', this.options.getCwd(), 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf8', timeout: 2_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
          this.refreshing = false;
          this.child = undefined;
          if (this.stopped) return;
          const value = error ? null : stdout.trim() || null;
          const branch = value === 'HEAD' ? 'detached' : value;
          if (branch === this.branch) return;
          this.branch = branch;
          for (const callback of [...this.callbacks]) {
            if (this.stopped) break;
            try { callback(); } catch { this.options.diagnostic('Extension footer branch callback failed'); }
          }
          if (!this.stopped) this.options.changed();
        });
    } catch {
      this.refreshing = false;
      this.options.diagnostic('Extension footer branch refresh failed');
    }
  }
}
