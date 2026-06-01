import { hasWebviewExtensionImageBlock } from '../webviewProtocol/renderBlocks';
import type { WebviewExtensionRenderBlock } from '../webviewProtocol/types';
import type { ExtensionCustomUiFactory, ExtensionCustomUiOptions } from './types';
import { defaultCellDimensions, renderComponentContent, type ExtensionCellDimensions } from './renderContent';
import { clampInteger, clampPositiveNumber } from './dimensions';

export type CustomUiComponent = {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  focused?: boolean;
  invalidate(): void;
  dispose?(): void;
};

export type CustomUiTerminal = {
  columns: number;
  rows: number;
} & ExtensionCellDimensions;

type ActiveCustomUi<T = unknown> = {
  id: string;
  terminal: CustomUiTerminal;
  component: CustomUiComponent;
  resolve: (value: T | undefined) => void;
  renderTimer?: ReturnType<typeof setTimeout>;
  finished: boolean;
};

export type CustomUiHostMessage =
  | { type: 'customUiShow'; id: string }
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
            finished: false
          };
          this.active = active as ActiveCustomUi;
          setComponentFocused(active.component, this.attached);
          customOptions?.onHandle?.(createOverlayHandle(() => this.cancel(id)) as never);
          this.options.onActiveChange?.(true);
          if (this.attached) {
            this.options.postMessage({ type: 'customUiShow', id });
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
      this.options.postMessage({ type: 'customUiShow', id: active.id });
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

export function createTuiFacade(terminal: CustomUiTerminal, requestRender: () => void) {
  return {
    terminal,
    requestRender,
    addChild() {},
    removeChild() {},
    clear() {},
    invalidate() {
      requestRender();
    },
    render() {
      return [];
    }
  };
}

function createOverlayHandle(cancel: () => void) {
  let hidden = false;
  let focused = true;

  return {
    hide: cancel,
    setHidden(value: boolean) {
      hidden = value;
    },
    isHidden() {
      return hidden;
    },
    focus() {
      focused = true;
    },
    unfocus() {
      focused = false;
    },
    isFocused() {
      return focused;
    }
  };
}

export function setComponentFocused(component: CustomUiComponent, focused: boolean): void {
  if ('focused' in component) {
    component.focused = focused;
  }
}

function isKeyRelease(data: string): boolean {
  if (data.includes('\x1b[200~')) {
    return false;
  }

  return data.includes(':3u')
    || data.includes(':3~')
    || data.includes(':3A')
    || data.includes(':3B')
    || data.includes(':3C')
    || data.includes(':3D')
    || data.includes(':3H')
    || data.includes(':3F');
}

const colorCodes: Record<string, number> = {
  accent: 36,
  border: 90,
  borderAccent: 36,
  borderMuted: 90,
  success: 32,
  error: 31,
  warning: 33,
  muted: 90,
  dim: 90,
  text: 37,
  thinkingText: 35,
  userMessageText: 36,
  customMessageText: 37,
  customMessageLabel: 36,
  toolTitle: 36,
  toolOutput: 37,
  mdHeading: 36,
  mdLink: 34,
  mdLinkUrl: 34,
  mdCode: 33,
  mdCodeBlock: 37,
  mdCodeBlockBorder: 90,
  mdQuote: 90,
  mdQuoteBorder: 90,
  mdHr: 90,
  mdListBullet: 36,
  toolDiffAdded: 32,
  toolDiffRemoved: 31,
  toolDiffContext: 90,
  syntaxComment: 90,
  syntaxKeyword: 35,
  syntaxFunction: 36,
  syntaxVariable: 37,
  syntaxString: 32,
  syntaxNumber: 33,
  syntaxType: 36,
  syntaxOperator: 37,
  syntaxPunctuation: 37,
  thinkingOff: 90,
  thinkingMinimal: 36,
  thinkingLow: 34,
  thinkingMedium: 33,
  thinkingHigh: 31,
  thinkingXhigh: 35,
  bashMode: 32
};

const bgCodes: Record<string, number> = {
  selectedBg: 44,
  userMessageBg: 44,
  customMessageBg: 45,
  toolPendingBg: 43,
  toolSuccessBg: 42,
  toolErrorBg: 41
};

export const taurenTheme = {
  fg(color: string, text: string) {
    return wrap(colorCodes[color] ?? 37, text);
  },
  bg(color: string, text: string) {
    return wrap(bgCodes[color] ?? 44, text);
  },
  bold(text: string) {
    return wrap(1, text);
  },
  italic(text: string) {
    return wrap(3, text);
  },
  underline(text: string) {
    return wrap(4, text);
  },
  inverse(text: string) {
    return wrap(7, text);
  },
  strikethrough(text: string) {
    return wrap(9, text);
  },
  getFgAnsi(color: string) {
    return `\x1b[${colorCodes[color] ?? 37}m`;
  },
  getBgAnsi(color: string) {
    return `\x1b[${bgCodes[color] ?? 44}m`;
  },
  getColorMode() {
    return '256color';
  },
  getThinkingBorderColor(level: string) {
    return (text: string) => wrap(colorCodes[`thinking${capitalize(level)}`] ?? 36, text);
  },
  getBashModeBorderColor() {
    return (text: string) => wrap(colorCodes.bashMode, text);
  }
};

const taurenKeybindings = {
  matches(data: string, keybinding: string) {
    const keys = keybindingDefaults[keybinding] ?? [];
    return keys.some((key) => terminalDataForKey(key) === data);
  },
  getKeys(keybinding: string) {
    return keybindingDefaults[keybinding] ?? [];
  },
  getDefinition(keybinding: string) {
    return { defaultKeys: keybindingDefaults[keybinding] ?? [], description: keybinding };
  },
  getConflicts() {
    return [];
  },
  setUserBindings() {},
  getUserBindings() {
    return {};
  },
  getResolvedBindings() {
    return keybindingDefaults;
  }
};

const keybindingDefaults: Record<string, string[]> = {
  'tui.editor.cursorUp': ['up'],
  'tui.editor.cursorDown': ['down'],
  'tui.editor.cursorLeft': ['left', 'ctrl+b'],
  'tui.editor.cursorRight': ['right', 'ctrl+f'],
  'tui.editor.cursorWordLeft': ['alt+left', 'ctrl+left', 'alt+b'],
  'tui.editor.cursorWordRight': ['alt+right', 'ctrl+right', 'alt+f'],
  'tui.editor.cursorLineStart': ['home', 'ctrl+a'],
  'tui.editor.cursorLineEnd': ['end', 'ctrl+e'],
  'tui.editor.pageUp': ['pageUp'],
  'tui.editor.pageDown': ['pageDown'],
  'tui.editor.deleteCharBackward': ['backspace'],
  'tui.editor.deleteCharForward': ['delete', 'ctrl+d'],
  'tui.editor.deleteWordBackward': ['ctrl+w', 'alt+backspace'],
  'tui.editor.deleteWordForward': ['alt+d', 'alt+delete'],
  'tui.editor.deleteToLineStart': ['ctrl+u'],
  'tui.editor.deleteToLineEnd': ['ctrl+k'],
  'tui.input.newLine': ['shift+enter'],
  'tui.input.submit': ['enter'],
  'tui.input.tab': ['tab'],
  'tui.input.copy': ['ctrl+c'],
  'tui.select.up': ['up'],
  'tui.select.down': ['down'],
  'tui.select.pageUp': ['pageUp'],
  'tui.select.pageDown': ['pageDown'],
  'tui.select.confirm': ['enter'],
  'tui.select.cancel': ['escape', 'ctrl+c']
};

function terminalDataForKey(key: string): string | undefined {
  const special: Record<string, string> = {
    escape: '\x1b',
    enter: '\r',
    tab: '\t',
    'shift+tab': '\x1b[Z',
    backspace: '\x7f',
    delete: '\x1b[3~',
    home: '\x1b[H',
    end: '\x1b[F',
    pageUp: '\x1b[5~',
    pageDown: '\x1b[6~',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    'shift+enter': '\x1b\r',
    'alt+backspace': '\x1b\x7f'
  };

  if (special[key]) {
    return special[key];
  }

  const ctrlMatch = /^ctrl\+([a-z])$/.exec(key);
  if (ctrlMatch) {
    return String.fromCharCode(ctrlMatch[1].charCodeAt(0) - 96);
  }

  const altMatch = /^alt\+(.+)$/.exec(key);
  if (altMatch && altMatch[1].length === 1) {
    return `\x1b${altMatch[1]}`;
  }

  return key.length === 1 ? key : undefined;
}

function wrap(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
