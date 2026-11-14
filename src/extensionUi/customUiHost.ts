import { hasWebviewExtensionImageBlock } from '../webviewProtocol/renderBlocks';
import type { WebviewExtensionRenderBlock } from '../webviewProtocol/types';
import type { ExtensionCustomUiFactory, ExtensionCustomUiOptions } from './types';
import { defaultCellDimensions, renderComponentContent } from '@tauren/shared/rendering/renderContent';
import { clampInteger, clampPositiveNumber } from './dimensions';

import {
  createTuiFacade,
  createOverlayHandle,
  setComponentFocused,
  isKeyRelease,
  taurenTheme,
  taurenKeybindings,
  type CustomUiComponent,
  type CustomUiTerminal
} from '@tauren/shared/extensionUi/facades';

export { createTuiFacade, taurenTheme, setComponentFocused } from '@tauren/shared/extensionUi/facades';
export type { CustomUiComponent, CustomUiTerminal } from '@tauren/shared/extensionUi/facades';

type ActiveCustomUi<T = unknown> = {
  id: string;
  terminal: CustomUiTerminal;
  component: CustomUiComponent;
  resolve: (value: T | undefined) => void;
  renderTimer?: ReturnType<typeof setTimeout>;
  overlay: boolean;
  finished: boolean;
};

export type CustomUiHostMessage =
  | { type: 'customUiShow'; id: string; overlay?: boolean }
  | { type: 'customUiRender'; id: string; lines: string[]; blocks?: WebviewExtensionRenderBlock[]; outputColors: boolean }
  | { type: 'customUiHide'; id: string };

export type ExtensionCustomUiHostOptions = {
  isAvailable(): boolean;
  postMessage(message: CustomUiHostMessage): boolean;
  getOutputColors(): boolean;
  notify(message: string, notifyType: string): void;
  onActiveChange?(active: boolean): void;
  idPrefix?: string;
};

const defaultColumns = 80;
const defaultRows = 12;
const renderFrameMs = 16;
const defaultTerminalDimensions: CustomUiTerminal = {
  columns: defaultColumns,
  rows: defaultRows,
  ...defaultCellDimensions
};

export class ExtensionCustomUiHost {
  private active: ActiveCustomUi | undefined;
  private nextId = 1;
  private attached = true;

  public constructor(private readonly options: ExtensionCustomUiHostOptions) {}

  public async custom<T>(factory: ExtensionCustomUiFactory<T>, customOptions?: ExtensionCustomUiOptions): Promise<T | undefined> {
    if (!this.options.isAvailable()) {
      this.options.notify('Pi extension UI is not available in the sidebar.', 'warning');
      return undefined;
    }

    this.cancelActive();

    const id = `${this.options.idPrefix ?? 'custom-ui'}-${this.nextId++}`;
    const terminal: CustomUiTerminal = { ...defaultTerminalDimensions };

    return new Promise<T | undefined>((resolve) => {
      let completedBeforeMount = false;
      let completedBeforeMountResult: T | undefined;
      const finish = (result: T) => {
        if (this.active?.id === id) {
          this.finish(id, result);
          return;
        }

        completedBeforeMount = true;
        completedBeforeMountResult = result;
      };
      const tui = createTuiFacade(terminal, () => this.scheduleRender(id));

      Promise.resolve()
        .then(() => factory(tui as never, taurenTheme as never, taurenKeybindings as never, finish))
        .then((component) => {
          if (completedBeforeMount) {
            try {
              (component as CustomUiComponent).dispose?.();
            } catch {
              // Ignore disposal failures from extension-owned components.
            }
            resolve(completedBeforeMountResult);
            return;
          }

          const active: ActiveCustomUi<T> = {
            id,
            terminal,
            component: component as CustomUiComponent,
            resolve,
            overlay: customOptions?.overlay === true,
            finished: false
          };
          this.active = active as ActiveCustomUi;
          setComponentFocused(active.component, this.attached);
          customOptions?.onHandle?.(createOverlayHandle(() => this.cancel(id)) as never);
          this.options.onActiveChange?.(true);
          if (this.attached) {
            this.postShow(active);
            this.render(id);
          }
        })
        .catch((error) => {
          this.options.notify(`Pi extension UI failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
          resolve(undefined);
        });
    });
  }

  public setAttached(attached: boolean): void {
    if (this.attached === attached) {
      return;
    }

    this.attached = attached;
    const active = this.active;

    if (!active || active.finished) {
      return;
    }

    if (active.renderTimer) {
      clearTimeout(active.renderTimer);
      active.renderTimer = undefined;
    }

    setComponentFocused(active.component, attached);

    if (attached) {
      this.postShow(active);
      this.render(active.id);
    } else {
      this.options.postMessage({ type: 'customUiHide', id: active.id });
    }
  }

  public handleInput(id: string, data: string): void {
    const active = this.active;

    if (!active || active.id !== id || active.finished) {
      return;
    }

    if (isKeyRelease(data) && !active.component.wantsKeyRelease) {
      return;
    }

    try {
      active.component.handleInput?.(data);
      this.scheduleRender(id);
    } catch (error) {
      this.options.notify(`Pi extension UI input failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.finish(id, undefined);
    }
  }

  public updateDimensions(id: string, columns: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void {
    const active = this.active;

    if (!active || active.id !== id || active.finished) {
      return;
    }

    const nextColumns = clampInteger(columns, 20, 240, defaultColumns);
    const nextRows = clampInteger(rows, 4, 80, defaultRows);
    const nextCellWidthPx = clampPositiveNumber(cellWidthPx, active.terminal.widthPx);
    const nextCellHeightPx = clampPositiveNumber(cellHeightPx, active.terminal.heightPx);

    if (
      active.terminal.columns === nextColumns
      && active.terminal.rows === nextRows
      && active.terminal.widthPx === nextCellWidthPx
      && active.terminal.heightPx === nextCellHeightPx
    ) {
      return;
    }

    active.terminal.columns = nextColumns;
    active.terminal.rows = nextRows;
    active.terminal.widthPx = nextCellWidthPx;
    active.terminal.heightPx = nextCellHeightPx;
    this.scheduleRender(id);
  }

  public cancel(id: string): void {
    this.finish(id, undefined);
  }

  public cancelActive(): void {
    if (this.active) {
      this.finish(this.active.id, undefined);
    }
  }

  public dispose(): void {
    this.cancelActive();
  }

  private postShow(active: Pick<ActiveCustomUi, 'id' | 'overlay'>): void {
    this.options.postMessage({
      type: 'customUiShow',
      id: active.id,
      ...(active.overlay ? { overlay: true } : {})
    });
  }

  private scheduleRender(id: string): void {
    const active = this.active;

    if (!active || active.id !== id || active.renderTimer || active.finished || !this.attached) {
      return;
    }

    active.renderTimer = setTimeout(() => {
      active.renderTimer = undefined;
      this.render(id);
    }, renderFrameMs);
  }

  private render(id: string): void {
    const active = this.active;

    if (!active || active.id !== id || active.finished || !this.attached) {
      return;
    }

    try {
      const rendered = renderComponentContent(active.component, active.terminal.columns, active.terminal);
      this.options.postMessage({
        type: 'customUiRender',
        id,
        lines: rendered.lines,
        ...(hasWebviewExtensionImageBlock(rendered.blocks) ? { blocks: rendered.blocks } : {}),
        outputColors: this.options.getOutputColors()
      });
    } catch (error) {
      this.options.notify(`Pi extension UI render failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.finish(id, undefined);
    }
  }

  private finish<T>(id: string, result: T | undefined): void {
    const active = this.active as ActiveCustomUi<T> | undefined;

    if (!active || active.id !== id || active.finished) {
      return;
    }

    active.finished = true;

    if (active.renderTimer) {
      clearTimeout(active.renderTimer);
    }

    setComponentFocused(active.component, false);

    try {
      active.component.dispose?.();
    } catch {
      // Ignore disposal failures from extension-owned components.
    }

    this.active = undefined;
    this.options.onActiveChange?.(false);
    if (this.attached) {
      this.options.postMessage({ type: 'customUiHide', id });
    }
    active.resolve(result);
  }

}
