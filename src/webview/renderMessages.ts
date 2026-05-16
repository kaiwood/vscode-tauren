import { renderHighlightedCodeInto, renderMarkdownInto, type RenderMarkdownOptions } from './markdown';
import type { Activity, ChatMessage } from './types';

const activityExpansion = new Map<string, boolean>();

export type MessageRenderOptions = RenderMarkdownOptions & {
  outputColors?: boolean;
};

export function createMessageElement(
  message: ChatMessage,
  showRole: boolean,
  messageIndex?: number,
  options: MessageRenderOptions = {}
): HTMLElement {
  const article = document.createElement('article');
  article.className = `message message--${message.role}${message.error ? ' message--error' : ''}${message.variant === 'thinking' ? ' message--thinking' : ''}`;

  const body = document.createElement('div');
  body.className = 'message__body';

  if (message.role === 'assistant' && !message.error) {
    renderMarkdownInto(body, message.text || '', options);
  } else {
    body.textContent = message.text || '';
  }

  if (showRole) {
    const role = document.createElement('div');
    role.className = 'message__role';
    role.textContent = roleLabel(message.role);
    article.append(role);
  }

  const activities = Array.isArray(message.activities) ? message.activities : [];
  const hasBody = Boolean(message.text || message.error || activities.length === 0);

  if (message.role !== 'assistant') {
    article.append(body);
    return article;
  }

  if (activities.length > 0) {
    article.append(createActivityListElement(activities, options));
  }

  if (hasBody) {
    if (activities.length > 0) {
      body.classList.add('message__body--after-activities');
    }

    article.append(body);
  }

  if (canCopyAssistantMessage(message) && typeof messageIndex === 'number') {
    article.append(createCopyButtonElement(messageIndex));
  }

  return article;
}

export function updateMessageBodyElement(
  article: HTMLElement,
  message: ChatMessage,
  options: MessageRenderOptions = {}
): boolean {
  const body = getDirectMessageBodyElement(article);

  if (!body) {
    return false;
  }

  body.className = 'message__body';

  if (message.role === 'assistant' && Array.isArray(message.activities) && message.activities.length > 0) {
    body.classList.add('message__body--after-activities');
  }

  if (message.role === 'assistant' && !message.error) {
    renderMarkdownInto(body, message.text || '', options);
  } else {
    body.textContent = message.text || '';
  }

  return true;
}

function getDirectMessageBodyElement(article: HTMLElement): HTMLElement | undefined {
  for (const child of Array.from(article.children)) {
    if (child instanceof HTMLElement && child.classList.contains('message__body')) {
      return child;
    }
  }

  return undefined;
}

function canCopyAssistantMessage(message: ChatMessage): boolean {
  return message.role === 'assistant'
    && !message.error
    && message.variant !== 'thinking'
    && Boolean(message.text);
}

function createCopyButtonElement(messageIndex: number): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'message__actions';

  const button = document.createElement('button');
  button.className = 'message__copy';
  button.type = 'button';
  button.title = 'Copy response';
  button.setAttribute('aria-label', 'Copy response');
  button.dataset.copyMessageIndex = String(messageIndex);
  button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 1.75A1.75 1.75 0 0 1 6.75 0h6.5A1.75 1.75 0 0 1 15 1.75v6.5A1.75 1.75 0 0 1 13.25 10h-1.5v1.25A1.75 1.75 0 0 1 10 13H3.75A1.75 1.75 0 0 1 2 11.25v-6.5A1.75 1.75 0 0 1 3.75 3H5V1.75Zm1.75-.25a.25.25 0 0 0-.25.25V3H10a1.75 1.75 0 0 1 1.75 1.75V8.5h1.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5ZM3.75 4.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H10a.25.25 0 0 0 .25-.25v-6.5A.25.25 0 0 0 10 4.5H3.75Z"/></svg>';

  actions.append(button);
  return actions;
}

function createActivityListElement(activities: Activity[], options: MessageRenderOptions): HTMLElement {
  const list = document.createElement('div');
  list.className = 'activity-list';

  for (const activity of activities) {
    list.append(createActivityElement(activity, options));
  }

  return list;
}

function createActivityElement(activity: Activity, options: MessageRenderOptions): HTMLElement {
  const details = document.createElement('details');
  details.className = `activity activity--${activity.kind || 'rpc'} activity--${activity.status || 'info'}`;

  const activityId = typeof activity.id === 'string' ? activity.id : '';
  const savedOpenState = activityExpansion.get(activityId);
  details.open = typeof savedOpenState === 'boolean'
    ? savedOpenState
    : activity.status === 'running' || shouldKeepActivityOpen(activity);

  details.addEventListener('toggle', () => {
    if (activityId) {
      activityExpansion.set(activityId, details.open);
    }
  });

  const summary = document.createElement('summary');
  summary.className = 'activity__summary';

  const title = document.createElement('span');
  title.className = 'activity__title';
  title.textContent = typeof activity.title === 'string' ? activity.title : 'Activity';

  const status = document.createElement('span');
  status.className = 'activity__status';
  status.textContent = activityStatusLabel(activity.status);

  summary.append(title, status);

  if (typeof activity.summary === 'string' && activity.summary.length > 0) {
    const description = document.createElement('span');
    description.className = 'activity__description';
    description.textContent = activity.summary;
    summary.append(description);
  }

  details.append(summary);

  if (typeof activity.body === 'string' && activity.body.length > 0) {
    const body = document.createElement(activity.code ? 'pre' : 'div');
    body.className = `activity__body${activity.code ? ' activity__body--code' : ' activity__body--markdown'}`;

    if (activity.code) {
      if (options.outputColors === false || !renderReadActivityCodeInto(body, activity)) {
        renderAnsiTextInto(body, activity.body, options.outputColors !== false);
      }
    } else {
      renderMarkdownInto(body, activity.body);
    }

    details.append(body);
  }

  return details;
}

function renderReadActivityCodeInto(element: HTMLElement, activity: Activity): boolean {
  if (activity.kind !== 'tool_execution' || typeof activity.title !== 'string' || typeof activity.body !== 'string') {
    return false;
  }

  const filePath = parseReadActivityPath(activity.title);

  if (!filePath || containsAnsiEscape(activity.body)) {
    return false;
  }

  return renderHighlightedCodeInto(element, activity.body, filePath);
}

function parseReadActivityPath(title: string): string | undefined {
  const match = title.match(/^read\s+(.+?)(?::\d+(?:-\d+)?)?$/);
  return match?.[1];
}

function containsAnsiEscape(value: string): boolean {
  return /\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/.test(value);
}

function stripAnsiSequences(value: string): string {
  return value.replace(/\x1b\[[0-?]*(?:[ -/][0-?]*)?[@-~]/g, '');
}

type AnsiStyle = {
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
};

function renderAnsiTextInto(element: HTMLElement, value: string, outputColors: boolean): void {
  element.replaceChildren();

  if (!outputColors) {
    element.textContent = stripAnsiSequences(value);
    return;
  }

  const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
  let style: AnsiStyle = {};
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = csiPattern.exec(value)) !== null) {
    appendAnsiText(element, value.slice(index, match.index), style);

    if (match[3] === 'm') {
      style = applyAnsiSgr(match[1], style);
    }

    index = match.index + match[0].length;
  }

  appendAnsiText(element, value.slice(index), style);
}

function appendAnsiText(element: HTMLElement, value: string, style: AnsiStyle): void {
  if (!value) {
    return;
  }

  if (isEmptyAnsiStyle(style)) {
    element.append(document.createTextNode(value));
    return;
  }

  const span = document.createElement('span');
  span.textContent = value;
  applyAnsiStyle(span, style);
  element.append(span);
}

function applyAnsiSgr(parameters: string, current: AnsiStyle): AnsiStyle {
  const codes = parseAnsiCodes(parameters);
  let next: AnsiStyle = { ...current };

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];

    if (code === 0) {
      next = {};
    } else if (code === 1) {
      next.bold = true;
      next.dim = false;
    } else if (code === 2) {
      next.dim = true;
      next.bold = false;
    } else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 23) {
      delete next.italic;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 24) {
      delete next.underline;
    } else if (code === 7) {
      next.inverse = true;
    } else if (code === 27) {
      delete next.inverse;
    } else if (code === 9) {
      next.strikethrough = true;
    } else if (code === 29) {
      delete next.strikethrough;
    } else if (code === 39) {
      delete next.foreground;
    } else if (code === 49) {
      delete next.background;
    } else if (isBasicAnsiForeground(code)) {
      next.foreground = ansiBasicColor(code - 30, false);
    } else if (isBrightAnsiForeground(code)) {
      next.foreground = ansiBasicColor(code - 90, true);
    } else if (isBasicAnsiBackground(code)) {
      next.background = ansiBasicColor(code - 40, false);
    } else if (isBrightAnsiBackground(code)) {
      next.background = ansiBasicColor(code - 100, true);
    } else if ((code === 38 || code === 48) && codes[index + 1] === 5 && codes[index + 2] !== undefined) {
      const color = ansi256Color(codes[index + 2]);

      if (color) {
        if (code === 38) {
          next.foreground = color;
        } else {
          next.background = color;
        }
      }

      index += 2;
    } else if (
      (code === 38 || code === 48)
      && codes[index + 1] === 2
      && codes[index + 2] !== undefined
      && codes[index + 3] !== undefined
      && codes[index + 4] !== undefined
    ) {
      const color = ansiRgbColor(
        clampColor(codes[index + 2]),
        clampColor(codes[index + 3]),
        clampColor(codes[index + 4])
      );

      if (code === 38) {
        next.foreground = color;
      } else {
        next.background = color;
      }

      index += 4;
    }
  }

  return next;
}

function parseAnsiCodes(parameters: string): number[] {
  if (!parameters || parameters === '?') {
    return [0];
  }

  return parameters
    .split(';')
    .map((part) => part === '' ? 0 : Number(part))
    .filter((part) => Number.isInteger(part));
}

function applyAnsiStyle(element: HTMLElement, style: AnsiStyle): void {
  const foreground = style.inverse ? style.background : style.foreground;
  const background = style.inverse ? style.foreground : style.background;

  if (foreground) {
    element.style.color = foreground;
  } else if (style.inverse && background) {
    element.style.color = 'var(--tau-code-background, var(--vscode-sideBar-background))';
  }

  if (background) {
    element.style.backgroundColor = background;
  } else if (style.inverse && foreground) {
    element.style.backgroundColor = foreground;
  }

  if (style.bold) {
    element.style.fontWeight = '700';
  }

  if (style.dim) {
    element.style.opacity = '0.72';
  }

  if (style.italic) {
    element.style.fontStyle = 'italic';
  }

  const textDecoration = [
    style.underline ? 'underline' : '',
    style.strikethrough ? 'line-through' : ''
  ].filter(Boolean).join(' ');

  if (textDecoration) {
    element.style.textDecoration = textDecoration;
  }
}

function isEmptyAnsiStyle(style: AnsiStyle): boolean {
  return !style.foreground
    && !style.background
    && !style.bold
    && !style.dim
    && !style.italic
    && !style.underline
    && !style.inverse
    && !style.strikethrough;
}

function isBasicAnsiForeground(code: number): boolean {
  return code >= 30 && code <= 37;
}

function isBrightAnsiForeground(code: number): boolean {
  return code >= 90 && code <= 97;
}

function isBasicAnsiBackground(code: number): boolean {
  return code >= 40 && code <= 47;
}

function isBrightAnsiBackground(code: number): boolean {
  return code >= 100 && code <= 107;
}

const ANSI_COLOR_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const ANSI_BRIGHT_COLOR_NAMES = ['BrightBlack', 'BrightRed', 'BrightGreen', 'BrightYellow', 'BrightBlue', 'BrightMagenta', 'BrightCyan', 'BrightWhite'];
const ANSI_COLOR_FALLBACK_VARIABLES = [
  '--tau-ansi-black-fallback',
  '--tau-ansi-red-fallback',
  '--tau-ansi-green-fallback',
  '--tau-ansi-yellow-fallback',
  '--tau-ansi-blue-fallback',
  '--tau-ansi-magenta-fallback',
  '--tau-ansi-cyan-fallback',
  '--tau-ansi-white-fallback'
];
const ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES = [
  '--tau-ansi-bright-black-fallback',
  '--tau-ansi-bright-red-fallback',
  '--tau-ansi-bright-green-fallback',
  '--tau-ansi-bright-yellow-fallback',
  '--tau-ansi-bright-blue-fallback',
  '--tau-ansi-bright-magenta-fallback',
  '--tau-ansi-bright-cyan-fallback',
  '--tau-ansi-bright-white-fallback'
];
const ANSI_COLOR_FALLBACKS = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5'];
const ANSI_BRIGHT_COLOR_FALLBACKS = ['#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'];

function ansiBasicColor(index: number, bright: boolean): string {
  const names = bright ? ANSI_BRIGHT_COLOR_NAMES : ANSI_COLOR_NAMES;
  const fallbackVariables = bright ? ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES : ANSI_COLOR_FALLBACK_VARIABLES;
  const fallbacks = bright ? ANSI_BRIGHT_COLOR_FALLBACKS : ANSI_COLOR_FALLBACKS;
  const fallbackVariable = fallbackVariables[index] ?? '--tau-ansi-white-fallback';
  const fallback = fallbacks[index] ?? '#e5e5e5';

  return `var(--vscode-terminal-ansi${names[index] ?? 'White'}, var(${fallbackVariable}, ${fallback}))`;
}

function ansi256Color(value: number): string | undefined {
  if (value < 0 || value > 255) {
    return undefined;
  }

  if (value < 8) {
    return ansiBasicColor(value, false);
  }

  if (value < 16) {
    return ansiBasicColor(value - 8, true);
  }

  if (value >= 232) {
    const level = 8 + ((value - 232) * 10);
    return `rgb(${level}, ${level}, ${level})`;
  }

  const offset = value - 16;
  const red = Math.floor(offset / 36);
  const green = Math.floor((offset % 36) / 6);
  const blue = offset % 6;
  const terminalColor = ansiCubeTerminalColor(red, green, blue);

  if (terminalColor) {
    return terminalColor;
  }

  return `rgb(${ansi256Channel(red)}, ${ansi256Channel(green)}, ${ansi256Channel(blue)})`;
}

function ansiCubeTerminalColor(red: number, green: number, blue: number): string | undefined {
  if (red === 0 && green === 0 && blue === 0) {
    return ansiBasicColor(0, false);
  }

  if (red > 0 && green === 0 && blue === 0) {
    return ansiBasicColor(1, red >= 5);
  }

  if (red === 0 && green > 0 && blue === 0) {
    return ansiBasicColor(2, green >= 5);
  }

  if (red > 0 && green > 0 && blue === 0 && Math.abs(red - green) <= 1) {
    return ansiBasicColor(3, red >= 5 || green >= 5);
  }

  if (red === 0 && green === 0 && blue > 0) {
    return ansiBasicColor(4, blue >= 5);
  }

  if (red > 0 && green === 0 && blue > 0 && Math.abs(red - blue) <= 1) {
    return ansiBasicColor(5, red >= 5 || blue >= 5);
  }

  if (red === 0 && green > 0 && blue > 0 && Math.abs(green - blue) <= 1) {
    return ansiBasicColor(6, green >= 5 || blue >= 5);
  }

  if (red === green && green === blue) {
    if (red >= 5) {
      return ansiBasicColor(7, true);
    }

    if (red >= 3) {
      return ansiBasicColor(7, false);
    }

    return ansiBasicColor(0, true);
  }

  return undefined;
}

function ansi256Channel(value: number): number {
  return value === 0 ? 0 : 55 + (value * 40);
}

function ansiRgbColor(red: number, green: number, blue: number): string {
  const terminalColor = ansiRgbTerminalColor(red, green, blue);

  if (terminalColor) {
    return terminalColor;
  }

  return `rgb(${red}, ${green}, ${blue})`;
}

function ansiRgbTerminalColor(red: number, green: number, blue: number): string | undefined {
  const low = 32;
  const high = 128;
  const bright = 220;

  if (red <= low && green <= low && blue <= low) {
    return ansiBasicColor(0, false);
  }

  if (red >= high && green <= low && blue <= low) {
    return ansiBasicColor(1, red >= bright);
  }

  if (red <= low && green >= high && blue <= low) {
    return ansiBasicColor(2, green >= bright);
  }

  if (red >= high && green >= high && blue <= low && Math.abs(red - green) <= 80) {
    return ansiBasicColor(3, red >= bright || green >= bright);
  }

  if (red <= low && green <= low && blue >= high) {
    return ansiBasicColor(4, blue >= bright);
  }

  if (red >= high && green <= low && blue >= high && Math.abs(red - blue) <= 80) {
    return ansiBasicColor(5, red >= bright || blue >= bright);
  }

  if (red <= low && green >= high && blue >= high && Math.abs(green - blue) <= 80) {
    return ansiBasicColor(6, green >= bright || blue >= bright);
  }

  if (Math.abs(red - green) <= 16 && Math.abs(green - blue) <= 16) {
    if (red >= 220) {
      return ansiBasicColor(7, true);
    }

    if (red >= 160) {
      return ansiBasicColor(7, false);
    }

    if (red >= 80) {
      return ansiBasicColor(0, true);
    }
  }

  return undefined;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function shouldKeepActivityOpen(activity: Activity): boolean {
  return typeof activity.body === 'string' && activity.body.length > 0;
}

function roleLabel(role: string): string {
  if (role === 'user') {
    return 'You';
  }

  if (role === 'assistant') {
    return 'Pi';
  }

  return 'System';
}

function activityStatusLabel(status: string | undefined): string {
  if (status === 'running') {
    return 'Running';
  }

  if (status === 'completed') {
    return 'Done';
  }

  if (status === 'error') {
    return 'Error';
  }

  return 'Info';
}
