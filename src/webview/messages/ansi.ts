export function containsAnsiEscape(value: string): boolean {
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

type AnsiRenderOptions = {
  suppressBackgrounds?: boolean;
};

export type AnsiBlockImageCell = {
  top: string | undefined;
  bottom: string | undefined;
};

export function getAnsiLineBackground(value: string, outputColors: boolean): string | undefined {
  if (!outputColors) {
    return undefined;
  }

  const lineBackground = getUniformAnsiLineBackground(value);
  return lineBackground.hasVisibleText ? lineBackground.background : undefined;
}

export function isAnsiBlockImageLine(value: string): boolean {
  const stripped = stripAnsiSequences(value);
  return containsAnsiEscape(value)
    && /[▀▄█]/.test(stripped)
    && /^[▀▄█ ]+$/.test(stripped);
}

export function getAnsiBlockImageCells(value: string, outputColors: boolean): AnsiBlockImageCell[] | undefined {
  if (!outputColors || !isAnsiBlockImageLine(value)) {
    return undefined;
  }

  const cells: AnsiBlockImageCell[] = [];
  const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
  let style: AnsiStyle = {};
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = csiPattern.exec(value)) !== null) {
    appendAnsiBlockImageCells(cells, value.slice(index, match.index), style);

    if (match[3] === 'm') {
      style = applyAnsiSgr(match[1], style);
    }

    index = match.index + match[0].length;
  }

  appendAnsiBlockImageCells(cells, value.slice(index), style);
  return cells.length > 0 ? cells : undefined;
}

export function renderAnsiBlockImageLineInto(element: HTMLElement, value: string, outputColors: boolean): boolean {
  const cells = getAnsiBlockImageCells(value, outputColors);

  if (!cells) {
    return false;
  }

  element.replaceChildren();

  for (const cell of cells) {
    const cellElement = document.createElement('span');
    cellElement.className = 'tauren-ansi-block-image-cell';
    cellElement.setAttribute('aria-hidden', 'true');
    applyAnsiBlockImageCellStyle(cellElement, cell);
    element.append(cellElement);
  }

  return true;
}

export function getAnsiFullWidgetBackground(lines: readonly string[], outputColors: boolean): string | undefined {
  if (!outputColors) {
    return undefined;
  }

  let widgetBackground: string | undefined;
  let hasVisibleLine = false;

  for (const line of lines) {
    const lineBackground = getUniformAnsiLineBackground(line);

    if (!lineBackground.hasVisibleText) {
      continue;
    }

    if (!lineBackground.background) {
      return undefined;
    }

    hasVisibleLine = true;

    if (widgetBackground === undefined) {
      widgetBackground = lineBackground.background;
      continue;
    }

    if (widgetBackground !== lineBackground.background) {
      return undefined;
    }
  }

  return hasVisibleLine ? widgetBackground : undefined;
}

export function renderAnsiTextInto(element: HTMLElement, value: string, outputColors: boolean, options: AnsiRenderOptions = {}): void {
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
    appendAnsiText(element, value.slice(index, match.index), style, options);

    if (match[3] === 'm') {
      style = applyAnsiSgr(match[1], style);
    }

    index = match.index + match[0].length;
  }

  appendAnsiText(element, value.slice(index), style, options);
}

const ansiSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ansiSpinnerPattern = new RegExp(`(^|\\n)([\\t ]*)([${ansiSpinnerFrames.join('')}])(?=$|[\\t ])`, 'g');
let ansiSpinnerFrameIndex = 0;
let ansiSpinnerTimer: number | undefined;

export function renderAnsiSpinnersInto(element: HTMLElement, animationsEnabled: boolean): void {
  if (!animationsEnabled) {
    return;
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (ansiSpinnerPattern.test(textNode.data)) {
        textNodes.push(textNode);
      }
    }
    ansiSpinnerPattern.lastIndex = 0;
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    replaceAnsiSpinnerTextNode(textNode);
  }

  if (textNodes.length > 0) {
    startAnsiSpinnerTimer();
  }
}

function replaceAnsiSpinnerTextNode(textNode: Text): void {
  const value = textNode.data;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ansiSpinnerPattern.lastIndex = 0;

  while ((match = ansiSpinnerPattern.exec(value)) !== null) {
    fragment.append(document.createTextNode(value.slice(lastIndex, match.index)));

    if (match[1] || match[2]) {
      fragment.append(document.createTextNode(`${match[1] ?? ''}${match[2] ?? ''}`));
    }

    const spinner = document.createElement('span');
    spinner.className = 'tauren-ansi-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    spinner.textContent = ansiSpinnerFrames[ansiSpinnerFrameIndex] ?? match[3];
    fragment.append(spinner);
    lastIndex = match.index + match[0].length;
  }

  fragment.append(document.createTextNode(value.slice(lastIndex)));
  textNode.replaceWith(fragment);
}

function startAnsiSpinnerTimer(): void {
  if (ansiSpinnerTimer !== undefined) {
    return;
  }

  ansiSpinnerTimer = window.setInterval(() => {
    const spinners = document.querySelectorAll<HTMLElement>('.tauren-ansi-spinner');

    if (spinners.length === 0) {
      window.clearInterval(ansiSpinnerTimer);
      ansiSpinnerTimer = undefined;
      return;
    }

    if (document.body.classList.contains('tauren-animations-disabled') || document.body.classList.contains('vscode-reduce-motion')) {
      return;
    }

    ansiSpinnerFrameIndex = (ansiSpinnerFrameIndex + 1) % ansiSpinnerFrames.length;
    const frame = ansiSpinnerFrames[ansiSpinnerFrameIndex];

    for (const spinner of spinners) {
      spinner.textContent = frame;
    }
  }, 80);
}

function appendAnsiText(element: HTMLElement, value: string, style: AnsiStyle, options: AnsiRenderOptions): void {
  if (!value) {
    return;
  }

  if (isEmptyAnsiStyle(style)) {
    element.append(document.createTextNode(value));
    return;
  }

  const span = document.createElement('span');
  span.textContent = value;
  applyAnsiStyle(span, style, options);
  element.append(span);
}

function appendAnsiBlockImageCells(cells: AnsiBlockImageCell[], value: string, style: AnsiStyle): void {
  for (const character of Array.from(value)) {
    const foreground = effectiveForeground(style);
    const background = effectiveBackground(style);

    if (character === '▀') {
      cells.push({ top: foreground, bottom: background });
    } else if (character === '▄') {
      cells.push({ top: background, bottom: foreground });
    } else if (character === '█') {
      cells.push({ top: foreground, bottom: foreground });
    } else if (character === ' ') {
      cells.push({ top: background, bottom: background });
    }
  }
}

function applyAnsiBlockImageCellStyle(element: HTMLElement, cell: AnsiBlockImageCell): void {
  const top = cell.top ?? 'transparent';
  const bottom = cell.bottom ?? 'transparent';

  if (top === bottom) {
    element.style.background = top;
    return;
  }

  element.style.background = `linear-gradient(to bottom, ${top} 0 50%, ${bottom} 50% 100%)`;
}

function getUniformAnsiLineBackground(value: string): { hasVisibleText: boolean; background: string | undefined } {
  const csiPattern = /\x1b\[([0-?]*)([ -/]*)?([@-~])/g;
  let style: AnsiStyle = {};
  let index = 0;
  let match: RegExpExecArray | null;
  let lineBackground: string | undefined;
  let hasVisible = false;

  while ((match = csiPattern.exec(value)) !== null) {
    const segmentBackground = visibleSegmentBackground(value.slice(index, match.index), style);

    if (segmentBackground.visible) {
      hasVisible = true;

      if (!segmentBackground.background) {
        return { hasVisibleText: true, background: undefined };
      }

      if (lineBackground === undefined) {
        lineBackground = segmentBackground.background;
      } else if (lineBackground !== segmentBackground.background) {
        return { hasVisibleText: true, background: undefined };
      }
    }

    if (match[3] === 'm') {
      style = applyAnsiSgr(match[1], style);
    }

    index = match.index + match[0].length;
  }

  const trailingBackground = visibleSegmentBackground(value.slice(index), style);

  if (trailingBackground.visible) {
    hasVisible = true;

    if (!trailingBackground.background) {
      return { hasVisibleText: true, background: undefined };
    }

    if (lineBackground === undefined) {
      lineBackground = trailingBackground.background;
    } else if (lineBackground !== trailingBackground.background) {
      return { hasVisibleText: true, background: undefined };
    }
  }

  return { hasVisibleText: hasVisible, background: lineBackground };
}

function visibleSegmentBackground(value: string, style: AnsiStyle): { visible: boolean; background: string | undefined } {
  const background = effectiveBackground(style);

  return {
    visible: background ? hasVisibleText(value) : hasNonWhitespaceText(value),
    background
  };
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

function applyAnsiStyle(element: HTMLElement, style: AnsiStyle, options: AnsiRenderOptions): void {
  const foreground = effectiveForeground(style);
  const background = effectiveBackground(style);

  if (foreground) {
    element.style.color = foreground;
  } else if (style.inverse && background) {
    element.style.color = 'var(--tauren-code-background, var(--vscode-sideBar-background))';
  }

  if (!options.suppressBackgrounds) {
    if (background) {
      element.style.backgroundColor = background;
    } else if (style.inverse && foreground) {
      element.style.backgroundColor = foreground;
    }
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

function effectiveForeground(style: AnsiStyle): string | undefined {
  return style.inverse ? style.background : style.foreground;
}

function effectiveBackground(style: AnsiStyle): string | undefined {
  return style.inverse ? style.foreground : style.background;
}

function hasVisibleText(value: string): boolean {
  return stripAnsiSequences(value).length > 0;
}

function hasNonWhitespaceText(value: string): boolean {
  return stripAnsiSequences(value).trim().length > 0;
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
  '--tauren-ansi-black-fallback',
  '--tauren-ansi-red-fallback',
  '--tauren-ansi-green-fallback',
  '--tauren-ansi-yellow-fallback',
  '--tauren-ansi-blue-fallback',
  '--tauren-ansi-magenta-fallback',
  '--tauren-ansi-cyan-fallback',
  '--tauren-ansi-white-fallback'
];
const ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES = [
  '--tauren-ansi-bright-black-fallback',
  '--tauren-ansi-bright-red-fallback',
  '--tauren-ansi-bright-green-fallback',
  '--tauren-ansi-bright-yellow-fallback',
  '--tauren-ansi-bright-blue-fallback',
  '--tauren-ansi-bright-magenta-fallback',
  '--tauren-ansi-bright-cyan-fallback',
  '--tauren-ansi-bright-white-fallback'
];
const ANSI_COLOR_FALLBACKS = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5'];
const ANSI_BRIGHT_COLOR_FALLBACKS = ['#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'];

function ansiBasicColor(index: number, bright: boolean): string {
  const names = bright ? ANSI_BRIGHT_COLOR_NAMES : ANSI_COLOR_NAMES;
  const fallbackVariables = bright ? ANSI_BRIGHT_COLOR_FALLBACK_VARIABLES : ANSI_COLOR_FALLBACK_VARIABLES;
  const fallbacks = bright ? ANSI_BRIGHT_COLOR_FALLBACKS : ANSI_COLOR_FALLBACKS;
  const fallbackVariable = fallbackVariables[index] ?? '--tauren-ansi-white-fallback';
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

