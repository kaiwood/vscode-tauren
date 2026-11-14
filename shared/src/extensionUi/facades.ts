// Shared Custom UI facades, not a terminal/TUI runtime.
export type CustomUiComponent = { render(width: number): string[]; handleInput?(data: string): void; wantsKeyRelease?: boolean; focused?: boolean; invalidate(): void; dispose?(): void };
export type CustomUiTerminal = { columns: number; rows: number; widthPx: number; heightPx: number };
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

export function createOverlayHandle(cancel: () => void) {
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
    },
    getBounds() {
      return undefined;
    }
  };
}

export function setComponentFocused(component: CustomUiComponent, focused: boolean): void {
  if ('focused' in component) {
    component.focused = focused;
  }
}

export function isKeyRelease(data: string): boolean {
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

export { taurenTheme } from '../rendering/theme.js';

export const taurenKeybindings = {
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
    return String.fromCharCode(ctrlMatch[1]!.charCodeAt(0) - 96);
  }

  const altMatch = /^alt\+(.+)$/.exec(key);
  if (altMatch && altMatch[1]!.length === 1) {
    return `\x1b${altMatch[1]}`;
  }

  return key.length === 1 ? key : undefined;
}
