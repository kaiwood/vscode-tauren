import { cloneWebviewExtensionRenderBlocks, hasWebviewExtensionImageBlock } from '../webviewProtocol/renderBlocks';
import type { WebviewExtensionRenderBlock } from '../webviewProtocol/types';
import type { ExtensionWidgetContent, ExtensionWidgetPlacement } from './types';
import {
  createTuiFacade,
  setComponentFocused,
  taurenTheme,
  type CustomUiComponent,
  type CustomUiTerminal
} from './customUiHost';
import { defaultCellDimensions, renderComponentContent, renderTextContent, type ExtensionCellDimensions } from './renderContent';
import { clampInteger, clampPositiveNumber } from './dimensions';

type ExtensionTerminalDimensions = CustomUiTerminal & ExtensionCellDimensions;

export type ExtensionWidgetEntry = {
  key: string;
  placement: ExtensionWidgetPlacement;
  lines: string[];
  blocks?: WebviewExtensionRenderBlock[];
};

type StoredWidget = {
  key: string;
  placement: ExtensionWidgetPlacement;
  order: number;
  lines: string[];
  blocks: WebviewExtensionRenderBlock[];
  terminal: ExtensionTerminalDimensions;
  component: CustomUiComponent | undefined;
  renderTimer: ReturnType<typeof setTimeout> | undefined;
  version: number;
};

export type ExtensionWidgetHostOptions = {
  notify(message: string, notifyType: string): void;
  onChange(): void;
};

const defaultColumns = 80;
const defaultRows = 4;
const renderFrameMs = 16;
const defaultTerminalDimensions: ExtensionTerminalDimensions = {
  columns: defaultColumns,
  rows: defaultRows,
  ...defaultCellDimensions
};

export class ExtensionWidgetHost {
  private readonly widgets = new Map<string, StoredWidget>();
  private nextOrder = 1;

  public constructor(private readonly options: ExtensionWidgetHostOptions) {}

  public setWidget(key: string, content: ExtensionWidgetContent | undefined, options?: { placement?: ExtensionWidgetPlacement }): void {
    const normalizedKey = key.trim();

    if (!normalizedKey) {
      return;
    }

    if (content === undefined) {
      this.clearWidgetByKey(normalizedKey);
      return;
    }

    const placement = normalizePlacement(options?.placement);
    const existing = this.widgets.get(normalizedKey);
    const terminal = existing?.terminal ?? { ...defaultTerminalDimensions };
    const order = existing?.order ?? this.nextOrder++;
    const version = (existing?.version ?? 0) + 1;

    // Dispose before installing the replacement. Some Pi widgets keep module-scoped
    // disposed flags and clear them immediately before calling setWidget().
    this.disposeWidget(existing);

    const widget: StoredWidget = {
      key: normalizedKey,
      placement,
      order,
      lines: [],
      blocks: [],
      terminal,
      component: undefined,
      renderTimer: undefined,
      version
    };

    this.widgets.set(normalizedKey, widget);

    if (Array.isArray(content)) {
      const rendered = renderTextContent(content);
      widget.lines = rendered.lines;
      widget.blocks = rendered.blocks;
      this.options.onChange();
      return;
    }

    this.mountComponentWidget(widget, content);
  }

  public updateDimensions(key: string, columns: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void {
    const widget = this.widgets.get(key.trim());

    if (!widget) {
      return;
    }

    const nextColumns = clampInteger(columns, 20, 240, defaultColumns);
    const nextRows = clampInteger(rows, 1, 80, defaultRows);
    const nextCellWidthPx = clampPositiveNumber(cellWidthPx, widget.terminal.widthPx);
    const nextCellHeightPx = clampPositiveNumber(cellHeightPx, widget.terminal.heightPx);

    if (
      widget.terminal.columns === nextColumns
      && widget.terminal.rows === nextRows
      && widget.terminal.widthPx === nextCellWidthPx
      && widget.terminal.heightPx === nextCellHeightPx
    ) {
      return;
    }

    widget.terminal.columns = nextColumns;
    widget.terminal.rows = nextRows;
    widget.terminal.widthPx = nextCellWidthPx;
    widget.terminal.heightPx = nextCellHeightPx;

    if (widget.component) {
      this.scheduleRender(widget.key);
    }
  }

  public clearWidgets(placement?: ExtensionWidgetPlacement): void {
    const widgets = placement
      ? [...this.widgets.values()].filter((widget) => widget.placement === placement)
      : [...this.widgets.values()];

    if (widgets.length === 0) {
      return;
    }

    for (const widget of widgets) {
      this.disposeWidget(widget);
      this.widgets.delete(widget.key);
    }

    this.options.onChange();
  }

  public clearWidget(key: string): void {
    this.clearWidgetByKey(key.trim());
  }

  public getEntries(): ExtensionWidgetEntry[] {
    return [...this.widgets.values()]
      .sort((left, right) => left.order - right.order)
      .map((widget) => {
        const blocks = cloneWebviewExtensionRenderBlocks(widget.blocks);
        return {
          key: widget.key,
          placement: widget.placement,
          lines: widget.lines.slice(),
          ...(hasWebviewExtensionImageBlock(blocks) ? { blocks } : {})
        };
      });
  }

  public dispose(): void {
    for (const widget of this.widgets.values()) {
      this.disposeWidget(widget);
    }

    this.widgets.clear();
  }

  private mountComponentWidget(
    widget: StoredWidget,
    factory: Exclude<ExtensionWidgetContent, string[]>
  ): void {
    const version = widget.version;
    const tui = createTuiFacade(widget.terminal, () => this.scheduleRender(widget.key));

    Promise.resolve()
      .then(() => factory(tui as never, taurenTheme as never))
      .then((component) => {
        const current = this.widgets.get(widget.key);

        if (!current || current.version !== version) {
          safeDispose(component as CustomUiComponent | undefined);
          return;
        }

        current.component = component as CustomUiComponent;
        setComponentFocused(current.component, false);
        this.render(current.key);
      })
      .catch((error) => {
        this.options.notify(`Pi extension widget failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        const current = this.widgets.get(widget.key);

        if (current?.version === version) {
          this.clearWidgetByKey(widget.key);
        }
      });
  }

  private clearWidgetByKey(key: string): void {
    const widget = this.widgets.get(key);

    if (!widget) {
      return;
    }

    this.disposeWidget(widget);
    this.widgets.delete(key);
    this.options.onChange();
  }

  private scheduleRender(key: string): void {
    const widget = this.widgets.get(key);

    if (!widget || widget.renderTimer) {
      return;
    }

    widget.renderTimer = setTimeout(() => {
      widget.renderTimer = undefined;
      this.render(key);
    }, renderFrameMs);
  }

  private render(key: string): void {
    const widget = this.widgets.get(key);

    if (!widget?.component) {
      return;
    }

    try {
      const rendered = renderComponentContent(widget.component, widget.terminal.columns, widget.terminal);
      widget.lines = rendered.lines;
      widget.blocks = rendered.blocks;
      this.options.onChange();
    } catch (error) {
      this.options.notify(`Pi extension widget render failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.clearWidgetByKey(key);
    }
  }

  private disposeWidget(widget: StoredWidget | undefined): void {
    if (!widget) {
      return;
    }

    if (widget.renderTimer) {
      clearTimeout(widget.renderTimer);
      widget.renderTimer = undefined;
    }

    if (widget.component) {
      setComponentFocused(widget.component, false);
      safeDispose(widget.component);
      widget.component = undefined;
    }
  }
}

function normalizePlacement(value: ExtensionWidgetPlacement | undefined): ExtensionWidgetPlacement {
  return value === 'belowEditor' ? 'belowEditor' : 'aboveEditor';
}

function safeDispose(component: CustomUiComponent | undefined): void {
  try {
    component?.dispose?.();
  } catch {
    // Ignore disposal failures from extension-owned components.
  }
}
