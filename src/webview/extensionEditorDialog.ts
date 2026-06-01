import type { WebviewApi } from './types';

type ExtensionEditorHostMessage =
  | { type: 'extensionEditorShow'; id: string; title: string; prefill?: string }
  | { type: 'extensionEditorHide'; id: string };

export type ExtensionEditorDialogOptions = {
  vscode: WebviewApi;
  element: HTMLElement;
  titleElement: HTMLElement;
  inputElement: HTMLTextAreaElement;
  saveButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
};

export class ExtensionEditorDialogController {
  private activeId: string | undefined;

  public constructor(private readonly options: ExtensionEditorDialogOptions) {}

  public attachEventListeners(): void {
    this.options.saveButton.addEventListener('click', () => this.save());
    this.options.cancelButton.addEventListener('click', () => this.cancel());
    this.options.closeButton.addEventListener('click', () => this.cancel());
  }

  public handleHostMessage(message: unknown): boolean {
    if (!isExtensionEditorHostMessage(message)) {
      return false;
    }

    if (message.type === 'extensionEditorShow') {
      this.show(message.id, message.title, message.prefill ?? '');
      return true;
    }

    if (!this.activeId || message.id === this.activeId) {
      this.hide();
    }

    return true;
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (!this.activeId || this.options.element.hidden) {
      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return true;
    }

    return false;
  }

  public isActive(): boolean {
    return Boolean(this.activeId) && !this.options.element.hidden;
  }

  private show(id: string, title: string, prefill: string): void {
    this.activeId = id;
    this.options.titleElement.textContent = title || 'Edit text';
    this.options.inputElement.value = prefill;
    this.options.element.hidden = false;
    this.options.element.inert = false;

    requestAnimationFrame(() => {
      this.options.inputElement.focus();
      this.options.inputElement.selectionStart = this.options.inputElement.value.length;
      this.options.inputElement.selectionEnd = this.options.inputElement.value.length;
    });
  }

  private save(): void {
    if (!this.activeId) {
      return;
    }

    const id = this.activeId;
    const text = this.options.inputElement.value;
    this.hide();
    this.options.vscode.postMessage({ type: 'extensionEditorSave', id, text });
  }

  private cancel(): void {
    if (!this.activeId) {
      return;
    }

    const id = this.activeId;
    this.hide();
    this.options.vscode.postMessage({ type: 'extensionEditorCancel', id });
  }

  private hide(): void {
    this.activeId = undefined;
    this.options.element.hidden = true;
    this.options.element.inert = true;
    this.options.inputElement.value = '';
  }
}

function isExtensionEditorHostMessage(message: unknown): message is ExtensionEditorHostMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const value = message as Record<string, unknown>;

  if (value.type === 'extensionEditorShow') {
    return typeof value.id === 'string' && value.id.length > 0
      && typeof value.title === 'string'
      && (value.prefill === undefined || typeof value.prefill === 'string');
  }

  return value.type === 'extensionEditorHide'
    && typeof value.id === 'string'
    && value.id.length > 0;
}
