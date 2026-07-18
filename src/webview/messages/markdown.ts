import { requestCodeHighlight, requestCodeHighlightsIn } from '../codeHighlighting';
import { createIconActionButton } from './actionButtons';
import type { LocalImageResolveResult, MarkdownRenderer } from '../types';
import { isRecord } from '../../shared/typeGuards';

export type RenderMarkdownOptions = {
  animationsEnabled?: boolean;
  allowRemoteImages?: boolean;
};

const supportedDataImagePattern = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const localImageRequests = new Map<string, { placeholder: HTMLElement; alt: string }>();
let postMessage: ((message: unknown) => void) | undefined;
let nextLocalImageRequestId = 1;

const markdownRenderer: MarkdownRenderer | undefined = window.markdownit
  ? window.markdownit({
    html: false,
    linkify: true,
    breaks: false
  })
  : undefined;

export function configureMarkdownImageRendering(post: (message: unknown) => void): void {
  postMessage = post;
}

export function handleMarkdownImageMessage(message: unknown): boolean {
  if (!isLocalImageResolveResult(message)) {
    return false;
  }

  applyLocalImageResolveResult(message);
  return true;
}

export function pruneDisconnectedLocalImageRequests(): void {
  for (const [id, pending] of Array.from(localImageRequests.entries())) {
    if (!pending.placeholder.isConnected) {
      localImageRequests.delete(id);
    }
  }
}

export function renderMarkdownInto(element: HTMLElement, text: string, options: RenderMarkdownOptions = {}): void {
  if (!markdownRenderer || !window.DOMPurify) {
    element.textContent = text;
    return;
  }

  element.classList.add('message__body--markdown');

  const rendered = markdownRenderer.render(normalizeRawImageTags(text));
  element.innerHTML = window.DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true }
  });
  processImages(element, options);
  linkifyFileReferences(element);
  addCodeBlockActions(element);
  requestCodeHighlightsIn(element);
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

function normalizeRawImageTags(text: string): string {
  return text.replace(/<img\b[^>]*>/gi, (tag) => {
    const template = document.createElement('template');
    template.innerHTML = tag;
    const image = template.content.querySelector('img');
    const src = image?.getAttribute('src')?.trim();

    if (!src) {
      return tag;
    }

    const alt = image?.getAttribute('alt') ?? '';
    const title = image?.getAttribute('title')?.trim() ?? '';
    return `![${escapeMarkdownImageLabel(alt)}](<${escapeMarkdownImageDestination(src)}>${title ? ` "${escapeMarkdownImageTitle(title)}"` : ''})`;
  });
}

function escapeMarkdownImageLabel(value: string): string {
  return value.replace(/[\\\]]/g, '\\$&').replace(/\n/g, ' ');
}

function escapeMarkdownImageDestination(value: string): string {
  return value.replace(/[>\n\r]/g, (character) => encodeURIComponent(character));
}

function escapeMarkdownImageTitle(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ');
}

function processImages(root: HTMLElement, options: RenderMarkdownOptions): void {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    if (!(image instanceof HTMLImageElement)) {
      continue;
    }

    processImageElement(image, options);
  }
}

function processImageElement(image: HTMLImageElement, options: RenderMarkdownOptions): void {
  const src = image.getAttribute('src')?.trim() ?? '';
  const alt = image.getAttribute('alt') ?? 'Image';

  if (!src) {
    image.replaceWith(createImageFallback('Image source is missing.'));
    return;
  }

  if (isSupportedDataImage(src)) {
    markRenderableImage(image);
    return;
  }

  if (isHttpsImage(src)) {
    if (options.allowRemoteImages === true) {
      markRenderableImage(image);
      return;
    }

    image.replaceWith(createImageFallback('Remote image blocked.'));
    return;
  }

  if (isLocalImageReference(src)) {
    requestLocalImage(image, src, alt);
    return;
  }

  image.replaceWith(createImageFallback('Unsupported image source.'));
}

function markRenderableImage(image: HTMLImageElement): void {
  image.classList.add('tauren-image');
  image.loading = 'lazy';
  image.decoding = 'async';
}

function requestLocalImage(image: HTMLImageElement, src: string, alt: string): void {
  if (!postMessage) {
    image.replaceWith(createImageFallback('Local image unavailable.'));
    return;
  }

  const id = `local-image-${nextLocalImageRequestId++}`;
  const placeholder = createImageFallback('Loading image…');
  placeholder.classList.add('tauren-image--pending');
  placeholder.dataset.localImageRequestId = id;
  localImageRequests.set(id, { placeholder, alt });
  image.replaceWith(placeholder);
  postMessage({ type: 'resolveLocalImage', id, src });
}

function applyLocalImageResolveResult(message: LocalImageResolveResult): void {
  const pending = localImageRequests.get(message.id);
  localImageRequests.delete(message.id);

  if (!pending || !pending.placeholder.isConnected) {
    return;
  }

  if (!message.uri) {
    pending.placeholder.replaceWith(createImageFallback(message.error || 'Local image unavailable.'));
    return;
  }

  const image = document.createElement('img');
  image.src = message.uri;
  image.alt = pending.alt;
  markRenderableImage(image);
  pending.placeholder.replaceWith(image);
}

function createImageFallback(text: string): HTMLElement {
  const fallback = document.createElement('span');
  fallback.className = 'tauren-image-fallback';
  fallback.textContent = text;
  return fallback;
}

function isSupportedDataImage(src: string): boolean {
  return supportedDataImagePattern.test(src);
}

function isHttpsImage(src: string): boolean {
  try {
    return new URL(src).protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalImageReference(src: string): boolean {
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src)
    && /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(src);
}

function isLocalImageResolveResult(message: unknown): message is LocalImageResolveResult {
  if (!isRecord(message) || message.type !== 'resolveLocalImageResult') {
    return false;
  }

  return typeof message.id === 'string'
    && (!('uri' in message) || typeof message.uri === 'string')
    && (!('error' in message) || typeof message.error === 'string');
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
  link.className = 'tauren-file-link';
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

function addCodeBlockActions(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (!(pre instanceof HTMLElement) || pre.closest('.tauren-code-block')) {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tauren-code-block';

    const actions = document.createElement('div');
    actions.className = 'tauren-code-block__actions';

    const copyButton = createIconActionButton('tauren-code-block__action', 'Copy code');
    copyButton.dataset.copyCodeBlock = 'true';
    actions.append(copyButton);

    pre.replaceWith(wrapper);
    wrapper.append(actions, pre);
  }
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
