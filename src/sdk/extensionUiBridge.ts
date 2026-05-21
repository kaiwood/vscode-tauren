import type { Theme } from '@earendil-works/pi-coding-agent';
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import { createCancellingExtensionUi, type ExtensionUiRequestUi } from '../extensionUi/requestHandler';

const emptyTheme = {} as Theme;

export function createSdkExtensionUiContext(ui?: ExtensionUiRequestUi): ExtensionUIContext {
  const resolvedUi = ui ?? createCancellingExtensionUi(() => undefined);

  return {
    select: (title, options, opts) => withDialogFallback(opts, undefined, () => resolvedUi.select(title, options)),
    confirm: async (title, message, opts) => {
      const confirmed = await withDialogFallback(opts, false, () => resolvedUi.confirm(title, message));
      return confirmed === true;
    },
    input: (title, placeholder, opts) => withDialogFallback(opts, undefined, () => resolvedUi.input(title, placeholder)),
    notify(message, type = 'info') {
      resolvedUi.notify(message, type);
    },
    onTerminalInput() {
      return () => {};
    },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom<T>() {
      return undefined as T;
    },
    pasteToEditor(text) {
      this.setEditorText(text);
    },
    setEditorText() {},
    getEditorText() {
      return '';
    },
    editor(_title, prefill) {
      return Promise.resolve(prefill);
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    get theme() {
      return emptyTheme;
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: 'Theme switching not supported in Tau SDK mode' };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {}
  };
}

async function withDialogFallback<T>(
  opts: ExtensionUIDialogOptions | undefined,
  fallback: T,
  run: () => PromiseLike<T | undefined> | T | undefined
): Promise<T | undefined> {
  if (opts?.signal?.aborted) {
    return fallback;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: Promise<T> | undefined;

  if (opts?.timeout !== undefined) {
    abort = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(fallback), opts.timeout);
    });
  }

  if (opts?.signal) {
    abort = Promise.race([
      abort ?? new Promise<T>(() => undefined),
      new Promise<T>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(fallback), { once: true });
      })
    ]);
  }

  try {
    const result = abort ? await Promise.race([Promise.resolve(run()), abort]) : await run();
    return result === undefined ? fallback : result;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
