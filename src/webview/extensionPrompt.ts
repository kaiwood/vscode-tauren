import type { WebviewApi } from './types';

type ExtensionPromptKind = 'select' | 'confirm' | 'input';

type ExtensionPromptHostMessage =
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

export type ExtensionPromptControllerOptions = {
  vscode: WebviewApi;
  element: HTMLElement;
  onShow(): void;
};

export class ExtensionPromptController {
  private activeId: string | undefined;

  public constructor(private readonly options: ExtensionPromptControllerOptions) {}

  public handleHostMessage(message: unknown): boolean {
    if (!isExtensionPromptHostMessage(message)) {
      return false;
    }

    if (message.type === 'extensionPromptShow') {
      this.show(message);
      return true;
    }

    if (!this.activeId || message.id === this.activeId) {
      this.hide();
    }

    return true;
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (!this.isActive() || event.key !== 'Escape') {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cancel();
    return true;
  }

  public isActive(): boolean {
    return Boolean(this.activeId) && !this.options.element.hidden;
  }

  private show(message: Extract<ExtensionPromptHostMessage, { type: 'extensionPromptShow' }>): void {
    this.activeId = message.id;
    const header = document.createElement('header');
    header.className = 'extension-prompt__header';
    const headingGroup = document.createElement('div');
    headingGroup.className = 'extension-prompt__heading-group';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'extension-prompt__eyebrow';
    eyebrow.textContent = 'Pi needs your input';
    const title = document.createElement('h3');
    title.className = 'extension-prompt__title';
    title.textContent = message.title || 'Choose a response';
    headingGroup.append(eyebrow, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'extension-prompt__close';
    close.setAttribute('aria-label', 'Cancel Pi prompt');
    close.textContent = '×';
    close.addEventListener('click', () => this.cancel());
    header.append(headingGroup, close);

    const body = document.createElement('div');
    body.className = 'extension-prompt__body';
    if (message.message) {
      const detail = document.createElement('p');
      detail.className = 'extension-prompt__message';
      detail.textContent = message.message;
      body.append(detail);
    }

    if (message.kind === 'select') {
      body.append(this.createChoiceList(message.id, message.options ?? []));
    } else if (message.kind === 'confirm') {
      body.append(this.createConfirmActions(message.id));
    } else {
      body.append(this.createInputForm(message.id, message.placeholder));
    }

    this.options.element.replaceChildren(header, body);
    this.options.element.hidden = false;
    this.options.element.inert = false;
    this.options.onShow();
    requestAnimationFrame(() => {
      this.options.element.querySelector<HTMLElement>('button:not(.extension-prompt__close), input')?.focus({ preventScroll: true });
    });
  }

  private createChoiceList(id: string, choices: string[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'extension-prompt__choices';
    list.setAttribute('role', 'list');

    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'extension-prompt__choice';
      button.textContent = choice;
      button.addEventListener('click', () => this.answer(id, choice));
      button.addEventListener('keydown', (event) => this.moveChoiceFocus(event));
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.append(button);
      list.append(item);
    }

    if (choices.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'extension-prompt__message';
      empty.textContent = 'No choices are available.';
      list.append(empty);
    }

    return list;
  }

  private createConfirmActions(id: string): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'extension-prompt__actions';
    const no = this.createActionButton('No', false, () => this.answer(id, false));
    const yes = this.createActionButton('Yes', true, () => this.answer(id, true));
    actions.append(no, yes);
    return actions;
  }

  private createInputForm(id: string, placeholder: string | undefined): HTMLElement {
    const form = document.createElement('form');
    form.className = 'extension-prompt__input-form';
    const input = document.createElement('input');
    input.className = 'extension-prompt__input';
    input.type = 'text';
    input.placeholder = placeholder ?? '';
    input.setAttribute('aria-label', placeholder || 'Response');
    const actions = document.createElement('div');
    actions.className = 'extension-prompt__actions';
    const cancel = this.createActionButton('Cancel', false, () => this.cancel());
    const submit = this.createActionButton('Submit', true);
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(input, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.answer(id, input.value);
    });
    return form;
  }

  private createActionButton(label: string, primary: boolean, onClick?: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `extension-prompt__button${primary ? ' extension-prompt__button--primary' : ''}`;
    button.textContent = label;
    if (onClick) {
      button.addEventListener('click', onClick);
    }
    return button;
  }

  private moveChoiceFocus(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const buttons = Array.from(this.options.element.querySelectorAll<HTMLButtonElement>('.extension-prompt__choice'));
    const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    if (currentIndex < 0 || buttons.length === 0) {
      return;
    }

    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(currentIndex + delta + buttons.length) % buttons.length]?.focus();
  }

  private answer(id: string, value: string | boolean): void {
    if (this.activeId !== id) {
      return;
    }

    this.hide();
    this.options.vscode.postMessage({ type: 'extensionPromptAnswer', id, value });
  }

  private cancel(): void {
    if (!this.activeId) {
      return;
    }

    const id = this.activeId;
    this.hide();
    this.options.vscode.postMessage({ type: 'extensionPromptCancel', id });
  }

  private hide(): void {
    this.activeId = undefined;
    this.options.element.hidden = true;
    this.options.element.inert = true;
    this.options.element.replaceChildren();
  }
}

export function isExtensionPromptHostMessage(message: unknown): message is ExtensionPromptHostMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const value = message as Record<string, unknown>;
  if (value.type === 'extensionPromptHide') {
    return typeof value.id === 'string' && value.id.length > 0;
  }

  if (value.type !== 'extensionPromptShow'
    || typeof value.id !== 'string' || !value.id
    || (value.kind !== 'select' && value.kind !== 'confirm' && value.kind !== 'input')
    || typeof value.title !== 'string') {
    return false;
  }

  return (value.message === undefined || typeof value.message === 'string')
    && (value.placeholder === undefined || typeof value.placeholder === 'string')
    && (value.options === undefined || (Array.isArray(value.options) && value.options.every((option) => typeof option === 'string')));
}
