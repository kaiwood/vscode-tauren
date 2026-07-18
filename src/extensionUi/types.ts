import type { ExtensionUIContext, ExtensionUIDialogOptions, ExtensionWidgetOptions, TerminalInputHandler } from '@earendil-works/pi-coding-agent';

export type MaybePromise<T> = T | PromiseLike<T>;

type SdkExtensionCustomUiFactory = Parameters<ExtensionUIContext['custom']>[0];
type SdkExtensionCustomUiFactoryArgs = Parameters<SdkExtensionCustomUiFactory>;
type SdkExtensionFooterFactory = NonNullable<Parameters<ExtensionUIContext['setFooter']>[0]>;

export type ExtensionCustomUiFactory<T> = (
  tui: SdkExtensionCustomUiFactoryArgs[0],
  theme: SdkExtensionCustomUiFactoryArgs[1],
  keybindings: SdkExtensionCustomUiFactoryArgs[2],
  done: (result: T) => void
) => ReturnType<SdkExtensionCustomUiFactory>;
export type ExtensionCustomUiOptions = Parameters<ExtensionUIContext['custom']>[1];
export type ExtensionWidgetPlacement = NonNullable<ExtensionWidgetOptions['placement']>;
export type ExtensionWidgetContent =
  | string[]
  | ((tui: SdkExtensionCustomUiFactoryArgs[0], theme: SdkExtensionCustomUiFactoryArgs[1]) => { render(width: number): string[]; invalidate(): void; dispose?(): void; focused?: boolean });
export type ExtensionWidgetSetOptions = Pick<ExtensionWidgetOptions, 'placement'>;
export type ExtensionFooterFactory = SdkExtensionFooterFactory;

export type ExtensionEditorHostMessage =
  | { type: 'extensionEditorShow'; id: string; title: string; prefill: string }
  | { type: 'extensionEditorHide'; id: string };

export type ExtensionPromptKind = 'select' | 'confirm' | 'input';

export type ExtensionPromptHostMessage =
  | {
    type: 'extensionPromptShow';
    id: string;
    kind: ExtensionPromptKind;
    title: string;
    message?: string;
    placeholder?: string;
    options?: string[];
  }
  | { type: 'extensionPromptHide'; id: string };

export type ExtensionUi = {
  notify(message: string, notifyType: string): void;
  select(title: string, options: string[], dialogOptions?: ExtensionUIDialogOptions): MaybePromise<string | undefined>;
  confirm(title: string, message: string | undefined, dialogOptions?: ExtensionUIDialogOptions): MaybePromise<boolean | undefined>;
  input(title: string, placeholder: string | undefined, dialogOptions?: ExtensionUIDialogOptions): MaybePromise<string | undefined>;
  editor?(title: string, prefill: string | undefined): MaybePromise<string | undefined>;
  custom?<T>(factory: ExtensionCustomUiFactory<T>, options?: ExtensionCustomUiOptions): MaybePromise<T | undefined>;
  setStatus?(key: string, text: string | undefined): void;
  clearStatuses?(): void;
  setFooter?(factory: ExtensionFooterFactory | undefined): void;
  setFooterText?(text: string | undefined): void;
  setWidget?(key: string, content: ExtensionWidgetContent | undefined, options?: ExtensionWidgetSetOptions): void;
  clearWidgets?(): void;
  onTerminalInput?(handler: TerminalInputHandler): () => void;
  getToolsExpanded?(): boolean;
  setToolsExpanded?(expanded: boolean): void;
  setEditorText?(text: string): void;
  pasteToEditor?(text: string): void;
};

export function createCancellingExtensionUi(
  notify: (message: string, notifyType: string) => void
): ExtensionUi {
  return {
    notify,
    select: async () => undefined,
    confirm: async () => undefined,
    input: async () => undefined,
    custom: async () => undefined
  };
}
