import { execFile } from 'node:child_process';
import type { ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent';
import {
  createTuiFacade,
  taurenTheme,
  type CustomUiComponent,
  type CustomUiTerminal
} from './customUiHost';
import { defaultCellDimensions } from './renderContent';
import type { ExtensionFooterFactory } from './types';

export type ExtensionFooterEntry = {
  line: string;
};

type ExtensionTerminalDimensions = CustomUiTerminal;

type StoredFooter = {
  component: CustomUiComponent | undefined;
  line: string;
  terminal: ExtensionTerminalDimensions;
  renderTimer: ReturnType<typeof setTimeout> | undefined;
  version: number;
};

export type ExtensionFooterHostOptions = {
  notify(message: string, notifyType: string): void;
  onChange(): void;
  getCwd?(): string | undefined;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getAvailableProviderCount?(): number;
};

const defaultColumns = 80;
const defaultRows = 1;
const renderFrameMs = 16;
const branchRefreshMs = 30_000;
const gitTimeoutMs = 2_000;
const defaultTerminalDimensions: ExtensionTerminalDimensions = {
  columns: defaultColumns,
  rows: defaultRows,
  ...defaultCellDimensions
};

export class ExtensionFooterHost {
  private footer: StoredFooter | undefined;
  private nextVersion = 1;
  private readonly footerData: TaurenFooterDataProvider;

  public constructor(private readonly options: ExtensionFooterHostOptions) {
    this.footerData = new TaurenFooterDataProvider({
      getCwd: options.getCwd,
      getExtensionStatuses: options.getExtensionStatuses,
      getAvailableProviderCount: options.getAvailableProviderCount,
      onChange: () => this.scheduleRender()
    });
  }

  public setFooter(factory: ExtensionFooterFactory | undefined): void {
    if (!factory) {
      this.clearFooter();
      return;
    }

    const previous = this.footer;
    const terminal = previous?.terminal ?? { ...defaultTerminalDimensions };
    const version = this.nextVersion++;

    this.disposeFooter(previous);

    const footer: StoredFooter = {
      component: undefined,
      line: '',
      terminal,
      renderTimer: undefined,
      version
    };

    this.footer = footer;
    this.footerData.start();
    this.options.onChange();

    const tui = createTuiFacade(terminal, () => this.scheduleRender());

    Promise.resolve()
      .then(() => factory(tui as never, taurenTheme as never, this.footerData as never))
      .then((component) => {
        if (this.footer?.version !== version) {
          safeDispose(component as CustomUiComponent | undefined);
          return;
        }

        this.footer.component = component as CustomUiComponent;
        this.render();
      })
      .catch((error) => {
        this.options.notify(`Pi extension footer failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        if (this.footer?.version === version) {
          this.clearFooter();
        }
      });
  }

  public updateDimensions(columns: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void {
    const footer = this.footer;

    if (!footer) {
      return;
    }

    const nextColumns = clampInteger(columns, 20, 240, defaultColumns);
    const nextRows = clampInteger(rows, 1, 4, defaultRows);
    const nextCellWidthPx = clampPositiveNumber(cellWidthPx, footer.terminal.widthPx);
    const nextCellHeightPx = clampPositiveNumber(cellHeightPx, footer.terminal.heightPx);

    if (
      footer.terminal.columns === nextColumns
      && footer.terminal.rows === nextRows
      && footer.terminal.widthPx === nextCellWidthPx
      && footer.terminal.heightPx === nextCellHeightPx
    ) {
      return;
    }

    footer.terminal.columns = nextColumns;
    footer.terminal.rows = nextRows;
    footer.terminal.widthPx = nextCellWidthPx;
    footer.terminal.heightPx = nextCellHeightPx;
    this.scheduleRender();
  }

  public handleStatusesChanged(): void {
    this.scheduleRender();
  }

  public getEntry(): ExtensionFooterEntry | undefined {
    return this.footer ? { line: this.footer.line } : undefined;
  }

  public clearFooter(): void {
    if (!this.footer) {
      return;
    }

    this.disposeFooter(this.footer);
    this.footer = undefined;
    this.footerData.stop();
    this.options.onChange();
  }

  public dispose(): void {
    this.disposeFooter(this.footer);
    this.footer = undefined;
    this.footerData.dispose();
  }

  private scheduleRender(): void {
    const footer = this.footer;

    if (!footer || footer.renderTimer) {
      return;
    }

    footer.renderTimer = setTimeout(() => {
      footer.renderTimer = undefined;
      this.render();
    }, renderFrameMs);
  }

  private render(): void {
    const footer = this.footer;

    if (!footer?.component) {
      return;
    }

    try {
      const lines = footer.component.render(footer.terminal.columns);
      footer.line = typeof lines[0] === 'string' ? lines[0] : '';
      this.options.onChange();
    } catch (error) {
      this.options.notify(`Pi extension footer render failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.clearFooter();
    }
  }

  private disposeFooter(footer: StoredFooter | undefined): void {
    if (!footer) {
      return;
    }

    if (footer.renderTimer) {
      clearTimeout(footer.renderTimer);
      footer.renderTimer = undefined;
    }

    safeDispose(footer.component);
  }
}

class TaurenFooterDataProvider implements ReadonlyFooterDataProvider {
  private branch: string | null = null;
  private callbacks = new Set<() => void>();
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private refreshInFlight = false;
  private disposed = false;

  public constructor(private readonly options: {
    getCwd?(): string | undefined;
    getExtensionStatuses(): ReadonlyMap<string, string>;
    getAvailableProviderCount?(): number;
    onChange(): void;
  }) {}

  public getGitBranch(): string | null {
    return this.branch;
  }

  public getExtensionStatuses(): ReadonlyMap<string, string> {
    return this.options.getExtensionStatuses();
  }

  public getAvailableProviderCount(): number {
    return this.options.getAvailableProviderCount?.() ?? 0;
  }

  public onBranchChange(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  public start(): void {
    if (this.disposed || this.refreshTimer) {
      return;
    }

    void this.refreshGitBranch();
    this.refreshTimer = setInterval(() => {
      void this.refreshGitBranch();
    }, branchRefreshMs);
  }

  public stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.stop();
    this.callbacks.clear();
  }

  private async refreshGitBranch(): Promise<void> {
    if (this.refreshInFlight || this.disposed) {
      return;
    }

    const cwd = this.options.getCwd?.();

    if (!cwd) {
      this.updateBranch(null);
      return;
    }

    this.refreshInFlight = true;

    try {
      const branch = await resolveGitBranch(cwd);
      this.updateBranch(branch);
    } finally {
      this.refreshInFlight = false;
    }
  }

  private updateBranch(branch: string | null): void {
    if (this.branch === branch || this.disposed) {
      return;
    }

    this.branch = branch;

    for (const callback of this.callbacks) {
      try {
        callback();
      } catch {
        // Ignore extension callback failures from footer-data subscriptions.
      }
    }

    this.options.onChange();
  }
}

function resolveGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', timeout: gitTimeoutMs },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const branch = stdout.trim();
        resolve(branch ? branch === 'HEAD' ? 'detached' : branch : null);
      }
    );
  });
}

function safeDispose(component: CustomUiComponent | undefined): void {
  try {
    component?.dispose?.();
  } catch {
    // Ignore disposal failures from extension-owned components.
  }
}

function clampPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(value), min), max);
}
