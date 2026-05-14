import type { MarkdownRenderer } from './types';

const markdownRenderer: MarkdownRenderer | undefined = window.markdownit
  ? window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    highlight: highlightCode
  })
  : undefined;

export function renderMarkdownInto(element: HTMLElement, text: string): void {
  if (!markdownRenderer || !window.DOMPurify) {
    element.textContent = text;
    return;
  }

  element.classList.add('message__body--markdown');

  const rendered = markdownRenderer.render(text);
  element.innerHTML = window.DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true }
  });
  linkifyFileReferences(element);
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

function highlightCode(code: string, language: string): string {
  if (!window.hljs || typeof language !== 'string' || language.length === 0) {
    return escapeHtml(code);
  }

  const normalizedLanguage = normalizeCodeLanguage(language);

  if (!window.hljs.getLanguage(normalizedLanguage)) {
    return escapeHtml(code);
  }

  try {
    return window.hljs.highlight(code, {
      language: normalizedLanguage,
      ignoreIllegals: true
    }).value;
  } catch {
    return escapeHtml(code);
  }
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.toLowerCase().trim();
  const aliases: Record<string, string> = {
    cjs: 'javascript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    shell: 'bash',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml'
  };

  return aliases[normalized] || normalized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
