import { requestCodeHighlight, requestCodeHighlightsIn } from './codeHighlighting';
import type { MarkdownRenderer } from './types';

export type RenderMarkdownOptions = {
  animateFromText?: string;
};

const markdownRenderer: MarkdownRenderer | undefined = window.markdownit
  ? window.markdownit({
    html: false,
    linkify: true,
    breaks: false
  })
  : undefined;

export function renderMarkdownInto(element: HTMLElement, text: string, options: RenderMarkdownOptions = {}): void {
  if (!markdownRenderer || !window.DOMPurify) {
    element.textContent = text;
    animateNewVisibleText(element, options.animateFromText);
    return;
  }

  element.classList.add('message__body--markdown');

  const rendered = markdownRenderer.render(text);
  element.innerHTML = window.DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true }
  });
  linkifyFileReferences(element);
  requestCodeHighlightsIn(element);
  animateNewVisibleText(element, options.animateFromText);
}

export function renderHighlightedCodeInto(element: HTMLElement, code: string, filePath: string): boolean {
  const language = getPathLanguageHint(filePath);

  if (!language) {
    return false;
  }

  element.dataset.shikiLanguage = language;
  element.textContent = code;
  return requestCodeHighlight(element, code, language);
}

function linkifyFileReferences(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => shouldLinkifyTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    replaceFileReferences(node);
  }
}

function shouldLinkifyTextNode(node: Node): boolean {
  const parent = node.parentElement;

  if (!parent || !node.textContent?.trim()) {
    return false;
  }

  return !parent.closest('a, pre, kbd, samp');
}

function replaceFileReferences(node: Text): void {
  const text = node.textContent ?? '';
  const pattern = /((?:\.{1,2}\/|\/|[A-Za-z0-9_-]+\/)[^\s`"'<>()[\]{}]+?\.[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)(?::(\d+)(?::(\d+))?)?/g;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let changed = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const before = text.slice(lastIndex, match.index);

    if (!isSafeFileReferenceBoundary(before, text, pattern.lastIndex)) {
      continue;
    }

    const parsed = parseFileReferenceMatch(match[0], match[1], match[2], match[3]);

    if (!parsed) {
      continue;
    }

    if (match.index > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    fragment.append(createFileReferenceLink(parsed));
    changed = true;
    lastIndex = match.index + parsed.linkText.length;
    pattern.lastIndex = lastIndex;
  }

  if (!changed) {
    return;
  }

  if (lastIndex < text.length) {
    fragment.append(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function isSafeFileReferenceBoundary(before: string, text: string, endIndex: number): boolean {
  const previous = before.charAt(before.length - 1);
  const next = text.charAt(endIndex);

  return !/[A-Za-z0-9_@:\/.-]/.test(previous) && !/[A-Za-z0-9_\/-]/.test(next);
}

function parseFileReferenceMatch(fullMatch: string, pathMatch: string, lineMatch: string | undefined, columnMatch: string | undefined): { path: string; line?: number; column?: number; linkText: string } | undefined {
  const trailing = pathMatch.match(/[.,;:!?]+$/)?.[0] ?? '';
  const filePath = trailing ? pathMatch.slice(0, -trailing.length) : pathMatch;

  if (!filePath || filePath.endsWith('/')) {
    return undefined;
  }

  const line = lineMatch ? Number(lineMatch) : undefined;
  const column = columnMatch ? Number(columnMatch) : undefined;

  if ((line !== undefined && (!Number.isInteger(line) || line < 1)) || (column !== undefined && (!Number.isInteger(column) || column < 1))) {
    return undefined;
  }

  return {
    path: filePath,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    linkText: fullMatch.slice(0, fullMatch.length - trailing.length)
  };
}

function createFileReferenceLink(reference: { path: string; line?: number; column?: number; linkText: string }): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'tau-file-link';
  link.textContent = reference.linkText;
  link.dataset.filePath = reference.path;

  if (reference.line) {
    link.dataset.line = String(reference.line);
  }

  if (reference.column) {
    link.dataset.column = String(reference.column);
  }

  return link;
}

function animateNewVisibleText(root: HTMLElement, previousVisibleText: string | undefined): void {
  if (previousVisibleText === undefined) {
    return;
  }

  const nextVisibleText = root.textContent ?? '';
  const startOffset = getCommonPrefixLength(previousVisibleText, nextVisibleText);

  if (startOffset >= nextVisibleText.length || (previousVisibleText.length > 0 && startOffset === 0)) {
    return;
  }

  wrapVisibleTextRange(root, startOffset, nextVisibleText.length);
}

function getCommonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }

  return index;
}

function wrapVisibleTextRange(root: HTMLElement, rangeStart: number, rangeEnd: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const ranges: Array<{ node: Text; start: number; end: number }> = [];
  let visibleOffset = 0;
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const textLength = node.textContent?.length ?? 0;
    const nodeStart = visibleOffset;
    const nodeEnd = nodeStart + textLength;

    if (nodeEnd > rangeStart && nodeStart < rangeEnd && !shouldSkipStreamingTextNode(node)) {
      ranges.push({
        node,
        start: Math.max(0, rangeStart - nodeStart),
        end: Math.min(textLength, rangeEnd - nodeStart)
      });
    }

    visibleOffset = nodeEnd;
    current = walker.nextNode();
  }

  let wordIndex = 0;

  for (const range of ranges) {
    wordIndex = wrapTextNodeRange(range.node, range.start, range.end, wordIndex);
  }
}

function shouldSkipStreamingTextNode(node: Text): boolean {
  const parent = node.parentElement;

  return !parent || Boolean(parent.closest('a, code, pre, kbd, samp, svg, math, annotation'));
}

function wrapTextNodeRange(node: Text, start: number, end: number, initialWordIndex: number): number {
  const text = node.textContent ?? '';

  if (start >= end) {
    return initialWordIndex;
  }

  const fragment = document.createDocumentFragment();
  let wordIndex = initialWordIndex;

  if (start > 0) {
    fragment.append(document.createTextNode(text.slice(0, start)));
  }

  wordIndex = appendAnimatedText(fragment, text.slice(start, end), wordIndex);

  if (end < text.length) {
    fragment.append(document.createTextNode(text.slice(end)));
  }

  node.replaceWith(fragment);
  return wordIndex;
}

function appendAnimatedText(fragment: DocumentFragment, text: string, initialWordIndex: number): number {
  const tokens = text.match(/\s+|\S+/g) ?? [];
  let wordIndex = initialWordIndex;

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      fragment.append(document.createTextNode(token));
      continue;
    }

    const span = document.createElement('span');
    span.className = 'tau-stream-word';
    span.textContent = token;

    if (wordIndex > 0) {
      span.style.animationDelay = Math.min(wordIndex * 16, 120) + 'ms';
    }

    fragment.append(span);
    wordIndex += 1;
  }

  return wordIndex;
}

function getPathLanguageHint(filePath: string): string {
  const basename = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';

  if (basename === 'dockerfile') {
    return 'dockerfile';
  }

  if (basename === 'makefile') {
    return 'makefile';
  }

  const extensionMatch = basename.match(/\.([a-z0-9]+)$/);
  return extensionMatch?.[1] ?? '';
}
