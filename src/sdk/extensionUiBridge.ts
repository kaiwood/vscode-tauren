import type { Theme } from '@earendil-works/pi-coding-agent';
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import { createCancellingExtensionUi, type ExtensionCustomUiFactory, type ExtensionCustomUiOptions, type ExtensionUi } from '../extensionUi/types';

const emptyTheme = {} as Theme;

export function createSdkExtensionUiContext(ui?: ExtensionUi): ExtensionUIContext {
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
    onTerminalInput(handler) {
      return resolvedUi.onTerminalInput?.(handler) ?? (() => {});
    },
    setStatus(key, text) {
      resolvedUi.setStatus?.(key, text);
    },
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget(key, content, options) {
      resolvedUi.setWidget?.(key, content, options);
    },
    setFooter(factory) {
      resolvedUi.setFooter?.(factory);
    },
    setHeader() {},
    setTitle() {},
    async custom<T>(factory: ExtensionCustomUiFactory<T>, opts?: ExtensionCustomUiOptions) {
      return await resolvedUi.custom?.(factory, opts) as T;
    },
    pasteToEditor(text) {
      if (resolvedUi.pasteToEditor) {
        resolvedUi.pasteToEditor(text);
        return;
      }

      this.setEditorText(text);
    },
    setEditorText(text) {
      resolvedUi.setEditorText?.(text);
    },
    getEditorText() {
      return '';
    },
    editor(title, prefill) {
      return withDialogFallback(undefined, undefined, () => resolvedUi.editor?.(title, prefill));
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
      return { success: false, error: 'Theme switching is not supported in Tauren' };
    },
    getToolsExpanded() {
      return resolvedUi.getToolsExpanded?.() ?? false;
    },
    setToolsExpanded(expanded) {
      resolvedUi.setToolsExpanded?.(expanded);
    }
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
