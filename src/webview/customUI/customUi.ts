import { renderAnsiTextInto } from '../messages/ansi';
import type { WebviewApi } from '../types';

type CustomUiHostMessage =
  | { type: 'customUiShow'; id: string }
  | { type: 'customUiRender'; id: string; lines: string[]; outputColors?: boolean }
  | { type: 'customUiHide'; id: string };

type CustomUiControllerOptions = {
  vscode: WebviewApi;
  customUiElement: HTMLElement;
  customUiOutputElement: HTMLElement;
  customUiCloseButton: HTMLButtonElement;
  form: HTMLFormElement;
  onClose?: () => void;
};

const cursorMarkerPattern = /\x1b_pi:c\x07/g;
const nonCsiEscapePattern = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|_[^\x07]*(?:\x07|\x1b\\)|\^[^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*(?:\x1b\\)?)/g;

export class CustomUiController {
  private activeId: string | undefined;
  private lastDimensionSignature = '';
  private resizeFrame: number | undefined;
  private inputCaptureElement: HTMLTextAreaElement | undefined;
  private isComposing = false;
  private lastTextInputValue = '';
  private lastTextInputTime = 0;
  private compositionFallbackTimer: number | undefined;

  public constructor(private readonly options: CustomUiControllerOptions) {}

  public attachEventListeners(): void {
    const inputCaptureElement = this.ensureInputCaptureElement();

    this.options.customUiCloseButton.addEventListener('click', () => this.cancel());
    this.options.customUiElement.addEventListener('keydown', (event) => {
      this.handleKeydown(event);
    });
    this.options.customUiElement.addEventListener('keyup', (event) => {
      this.handleKeyup(event);
    });
    this.options.customUiElement.addEventListener('paste', (event) => {
      this.handlePaste(event);
    });
    inputCaptureElement.addEventListener('beforeinput', (event) => {
      this.handleBeforeInput(event);
    });
    inputCaptureElement.addEventListener('compositionstart', () => {
      this.handleCompositionStart();
    });
    inputCaptureElement.addEventListener('compositionend', (event) => {
      this.handleCompositionEnd(event);
    });
  }

  public handleHostMessage(message: unknown): boolean {
    if (!isCustomUiHostMessage(message)) {
      return false;
    }

    if (message.type === 'customUiShow') {
      this.show(message.id);
      return true;
    }

    if (message.type === 'customUiRender') {
      this.render(message.id, message.lines, message.outputColors !== false);
      return true;
    }

    this.hide(message.id);
    return true;
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (!this.activeId) {
      return false;
    }

    if (event.target === this.options.customUiCloseButton) {
      return false;
    }

    this.handleKeydown(event);
    return true;
  }

  public handleGlobalKeyup(event: KeyboardEvent): boolean {
    if (!this.activeId) {
      return false;
    }

    if (event.target === this.options.customUiCloseButton) {
      return false;
    }

    this.handleKeyup(event);
    return true;
  }

  public syncForRender(isListView: boolean): void {
    const active = Boolean(this.activeId) && !isListView;
    this.options.customUiElement.hidden = !active;
    this.options.customUiElement.inert = !active;
    this.options.form.classList.toggle('composer--custom-hidden', Boolean(this.activeId));

    if (this.activeId) {
      this.options.form.setAttribute('aria-hidden', 'true');
      this.options.form.inert = true;
      this.scheduleDimensionsPost();
    }
  }

  public handleResize(): void {
    if (!this.activeId) {
      return;
    }

    this.scheduleDimensionsPost();
  }

  public isActive(): boolean {
    return Boolean(this.activeId);
  }

  private show(id: string): void {
    this.activeId = id;
    this.lastDimensionSignature = '';
    this.options.customUiOutputElement.replaceChildren();
    this.options.customUiElement.hidden = false;
    this.options.customUiElement.inert = false;
    this.options.form.classList.add('composer--custom-hidden');
    this.options.form.setAttribute('aria-hidden', 'true');
    this.options.form.inert = true;
    this.focusInputCapture();
    this.scheduleDimensionsPost();
  }

  private render(id: string, lines: string[], outputColors: boolean): void {
    if (this.activeId !== id) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const lineElement = document.createElement('div');
      lineElement.className = 'custom-ui__line';
      renderAnsiTextInto(lineElement, sanitizeTuiLine(line), outputColors);
      fragment.append(lineElement);
    }

    this.options.customUiOutputElement.replaceChildren(fragment);
    this.scheduleDimensionsPost();
  }

  private hide(id: string): void {
    if (this.activeId !== id) {
      return;
    }

    this.activeId = undefined;
    this.lastDimensionSignature = '';
    this.isComposing = false;
    this.clearCompositionFallback();
    this.clearInputCaptureValue();
    this.options.customUiElement.hidden = true;
    this.options.customUiElement.inert = true;
    this.options.customUiOutputElement.replaceChildren();
    this.options.form.classList.remove('composer--custom-hidden');
    this.options.form.removeAttribute('aria-hidden');
    this.options.form.inert = false;
    this.options.onClose?.();
  }

  private cancel(): void {
    if (!this.activeId) {
      return;
    }

    this.options.vscode.postMessage({ type: 'customUiCancel', id: this.activeId });
  }

  private handlePaste(event: ClipboardEvent): void {
    if (!this.activeId) {
      return;
    }

    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.postInput(text);
  }

  private handleBeforeInput(event: InputEvent): void {
    if (!this.activeId) {
      return;
    }

    if (!isTextInsertionInput(event)) {
      return;
    }

    if (event.isComposing || this.isComposing || event.inputType === 'insertCompositionText') {
      return;
    }

    const data = event.data ?? '';
    if (!data) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.postTextInput(data);
  }

  private handleCompositionStart(): void {
    this.isComposing = true;
  }

  private handleCompositionEnd(event: CompositionEvent): void {
    this.isComposing = false;
    this.clearInputCaptureValue();

    const data = event.data ?? '';
    if (!data || this.isRecentTextInput(data)) {
      return;
    }

    this.clearCompositionFallback();
    this.compositionFallbackTimer = window.setTimeout(() => {
      this.compositionFallbackTimer = undefined;
      if (!this.activeId || this.isRecentTextInput(data)) {
        return;
      }

      this.postTextInput(data);
    }, 0);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.activeId) {
      return;
    }

    if (event.target === this.options.customUiCloseButton) {
      return;
    }

    if (event.isComposing || this.isComposing || event.key === 'Process' || event.key === 'Dead') {
      return;
    }

    if (isTextInputKeyboardEvent(event)) {
      return;
    }

    const data = terminalDataForKeyboardEvent(event, event.repeat ? 'repeat' : 'press');
    if (data === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.postInput(data);
  }

  private handleKeyup(event: KeyboardEvent): void {
    if (!this.activeId) {
      return;
    }

    if (event.target === this.options.customUiCloseButton) {
      return;
    }

    if (event.isComposing || this.isComposing || event.key === 'Process' || event.key === 'Dead') {
      return;
    }

    const data = terminalDataForKeyboardEvent(event, 'release');
    if (data === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.postInput(data);
  }

  private ensureInputCaptureElement(): HTMLTextAreaElement {
    if (this.inputCaptureElement) {
      return this.inputCaptureElement;
    }

    const element = document.createElement('textarea');
    element.className = 'custom-ui__input-capture';
    element.setAttribute('aria-label', 'Extension UI keyboard input');
    element.autocapitalize = 'off';
    element.autocomplete = 'off';
    element.spellcheck = false;
    element.rows = 1;
    element.tabIndex = -1;
    this.options.customUiElement.append(element);
    this.inputCaptureElement = element;
    return element;
  }

  private focusInputCapture(): void {
    const element = this.ensureInputCaptureElement();
    element.value = '';
    element.focus({ preventScroll: true });
  }

  private clearInputCaptureValue(): void {
    if (this.inputCaptureElement) {
      this.inputCaptureElement.value = '';
    }
  }

  private clearCompositionFallback(): void {
    if (this.compositionFallbackTimer !== undefined) {
      window.clearTimeout(this.compositionFallbackTimer);
      this.compositionFallbackTimer = undefined;
    }
  }

  private postTextInput(data: string): void {
    this.clearCompositionFallback();
    this.lastTextInputValue = data;
    this.lastTextInputTime = Date.now();
    this.clearInputCaptureValue();
    this.postInput(data);
  }

  private isRecentTextInput(data: string): boolean {
    return this.lastTextInputValue === data && Date.now() - this.lastTextInputTime < 100;
  }

  private postInput(data: string): void {
    if (!this.activeId) {
      return;
    }

    this.options.vscode.postMessage({ type: 'customUiInput', id: this.activeId, data });
  }

  private scheduleDimensionsPost(): void {
    if (this.resizeFrame !== undefined) {
      return;
    }

    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = undefined;
      this.postDimensions();
    });
  }

  private postDimensions(): void {
    if (!this.activeId || this.options.customUiElement.hidden) {
      return;
    }

    const dimensions = measureTerminalDimensions(this.options.customUiOutputElement);
    const signature = `${dimensions.columns}x${dimensions.rows}`;
    if (signature === this.lastDimensionSignature) {
      return;
    }

    this.lastDimensionSignature = signature;
    this.options.vscode.postMessage({
      type: 'customUiDimensions',
      id: this.activeId,
      columns: dimensions.columns,
      rows: dimensions.rows
    });
  }
}

function sanitizeTuiLine(value: string): string {
  return value.replace(cursorMarkerPattern, '').replace(nonCsiEscapePattern, '');
}

let measurementCanvas: HTMLCanvasElement | undefined;

function measureTerminalDimensions(element: HTMLElement): { columns: number; rows: number } {
  const style = window.getComputedStyle(element);
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  const canvas = measurementCanvas ?? document.createElement('canvas');
  measurementCanvas = canvas;
  const context = canvas.getContext('2d');
  let charWidth = 8;

  if (context) {
    context.font = font;
    charWidth = Math.max(1, context.measureText('M').width);
  }

  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.35 || 18;
  const rect = element.getBoundingClientRect();
  const columns = Math.max(20, Math.floor(rect.width / charWidth));
  const targetHeight = Math.max(rect.height, Math.min(window.innerHeight * 0.7, window.innerHeight - 140));
  const rows = Math.max(4, Math.min(80, Math.floor(Math.max(120, targetHeight) / lineHeight)));

  return { columns, rows };
}

type CustomUiKeyEventType = 'press' | 'repeat' | 'release';

export function isTextInputKeyboardEvent(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && isSingleCodePoint(event.key);
}

export function terminalDataForKeyboardEvent(event: KeyboardEvent, eventType: CustomUiKeyEventType = 'press'): string | undefined {
  if (event.metaKey) {
    return undefined;
  }

  if (eventType !== 'press') {
    return kittyDataForKeyboardEvent(event, eventType);
  }

  if (event.ctrlKey && !event.altKey && event.key.length === 1) {
    const lower = event.key.toLowerCase();
    if (lower >= 'a' && lower <= 'z') {
      return String.fromCharCode(lower.charCodeAt(0) - 96);
    }
  }

  const special = specialKeyData(event);
  if (special !== undefined) {
    return event.altKey && special.length > 0 && !special.startsWith('\x1b') ? `\x1b${special}` : special;
  }

  if (isSingleCodePoint(event.key) && !event.ctrlKey) {
    return event.altKey ? `\x1b${event.key}` : event.key;
  }

  return undefined;
}

function kittyDataForKeyboardEvent(event: KeyboardEvent, eventType: Exclude<CustomUiKeyEventType, 'press'>): string | undefined {
  const modifier = kittyModifierForEvent(event);
  const eventCode = eventType === 'repeat' ? 2 : 3;
  const special = kittySpecialKeyData(event, modifier, eventCode);

  if (special !== undefined) {
    return special;
  }

  if (!isSingleCodePoint(event.key)) {
    return undefined;
  }

  const codepoint = event.key.codePointAt(0);
  return codepoint === undefined ? undefined : `\x1b[${codepoint};${modifier}:${eventCode}u`;
}

function kittyModifierForEvent(event: KeyboardEvent): number {
  return 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
}

function kittySpecialKeyData(event: KeyboardEvent, modifier: number, eventCode: 2 | 3): string | undefined {
  const arrowCode = arrowKittyCode(event.key);
  if (arrowCode !== undefined) {
    return `\x1b[1;${modifier}:${eventCode}${arrowCode}`;
  }

  if (event.key === 'Home') return `\x1b[1;${modifier}:${eventCode}H`;
  if (event.key === 'End') return `\x1b[1;${modifier}:${eventCode}F`;

  const functional = functionalKittyCode(event.key);
  if (functional !== undefined) {
    return `\x1b[${functional};${modifier}:${eventCode}~`;
  }

  const codepoint = csiUCodepoint(event.key);
  return codepoint === undefined ? undefined : `\x1b[${codepoint};${modifier}:${eventCode}u`;
}

function arrowKittyCode(key: string): string | undefined {
  if (key === 'ArrowUp') return 'A';
  if (key === 'ArrowDown') return 'B';
  if (key === 'ArrowRight') return 'C';
  if (key === 'ArrowLeft') return 'D';
  return undefined;
}

function functionalKittyCode(key: string): number | undefined {
  if (key === 'Insert') return 2;
  if (key === 'Delete') return 3;
  if (key === 'PageUp') return 5;
  if (key === 'PageDown') return 6;
  return undefined;
}

function csiUCodepoint(key: string): number | undefined {
  if (key === 'Escape') return 27;
  if (key === 'Tab') return 9;
  if (key === 'Enter') return 13;
  if (key === 'Backspace') return 127;
  return undefined;
}

function specialKeyData(event: KeyboardEvent): string | undefined {
  if (event.key === 'Escape') return '\x1b';
  if (event.key === 'Enter') return event.shiftKey ? '\x1b\r' : '\r';
  if (event.key === 'Tab') return event.shiftKey ? '\x1b[Z' : '\t';
  if (event.key === 'Backspace') return event.altKey ? '\x1b\x7f' : '\x7f';
  if (event.key === 'Delete') return '\x1b[3~';
  if (event.key === 'Home') return '\x1b[H';
  if (event.key === 'End') return '\x1b[F';
  if (event.key === 'PageUp') return '\x1b[5~';
  if (event.key === 'PageDown') return '\x1b[6~';
  if (event.key === 'ArrowUp') return event.shiftKey ? '\x1b[a' : event.ctrlKey ? '\x1bOa' : '\x1b[A';
  if (event.key === 'ArrowDown') return event.shiftKey ? '\x1b[b' : event.ctrlKey ? '\x1bOb' : '\x1b[B';
  if (event.key === 'ArrowRight') return event.shiftKey ? '\x1b[c' : event.ctrlKey ? '\x1bOc' : '\x1b[C';
  if (event.key === 'ArrowLeft') return event.shiftKey ? '\x1b[d' : event.ctrlKey ? '\x1bOd' : '\x1b[D';
  return undefined;
}

function isTextInsertionInput(event: InputEvent): boolean {
  return event.inputType === 'insertText'
    || event.inputType === 'insertCompositionText'
    || event.inputType === 'insertFromComposition';
}

function isSingleCodePoint(value: string): boolean {
  return Array.from(value).length === 1;
}

function isCustomUiHostMessage(value: unknown): value is CustomUiHostMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const message = value as Record<string, unknown>;

  if (message.type === 'customUiShow' || message.type === 'customUiHide') {
    return typeof message.id === 'string' && message.id.length > 0;
  }

  return message.type === 'customUiRender'
    && typeof message.id === 'string'
    && message.id.length > 0
    && Array.isArray(message.lines)
    && message.lines.every((line) => typeof line === 'string');
}
