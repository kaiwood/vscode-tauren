import type { WebviewExtensionRenderBlock } from '../webviewProtocol/types';
import { isRecord } from '../shared/typeGuards';

export function normalizeExtensionRenderBlocks(blocks: unknown, fallbackLines: string[]): WebviewExtensionRenderBlock[] {
  if (Array.isArray(blocks)) {
    const normalized = blocks.map(normalizeExtensionRenderBlock).filter((block): block is WebviewExtensionRenderBlock => Boolean(block));
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return fallbackLines.length > 0 ? [{ type: 'text', lines: fallbackLines }] : [];
}

export function createExtensionImageElement(block: Extract<WebviewExtensionRenderBlock, { type: 'image' }>): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'extension-render-image';
  if (block.cellWidthPx && block.cellHeightPx) {
    wrapper.style.width = `${block.columns * block.cellWidthPx}px`;
    wrapper.style.height = `${block.rows * block.cellHeightPx}px`;
  } else {
    wrapper.style.width = `calc(${block.columns} * 1ch)`;
    wrapper.style.height = `calc(${block.rows} * 1lh)`;
  }

  if (block.indentColumns && block.indentColumns > 0) {
    wrapper.style.marginLeft = block.cellWidthPx
      ? `${block.indentColumns * block.cellWidthPx}px`
      : `calc(${block.indentColumns} * 1ch)`;
  }

  const image = document.createElement('img');
  image.className = 'extension-render-image__img';
  image.alt = block.alt || 'Image';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = `data:${block.mimeType};base64,${block.data}`;
  wrapper.append(image);

  return wrapper;
}

function normalizeExtensionRenderBlock(value: unknown): WebviewExtensionRenderBlock | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === 'text' && Array.isArray(value.lines)) {
    return { type: 'text', lines: value.lines.map((line) => String(line)) };
  }

  if (value.type === 'image'
    && typeof value.data === 'string'
    && value.data.length > 0
    && typeof value.mimeType === 'string'
    && isSupportedImageMimeType(value.mimeType)
  ) {
    const columns = clampPositiveInteger(value.columns, 1);
    const rows = clampPositiveInteger(value.rows, 1);
    return {
      type: 'image',
      data: value.data,
      mimeType: value.mimeType.toLowerCase(),
      columns,
      rows,
      ...(typeof value.widthPx === 'number' && Number.isFinite(value.widthPx) && value.widthPx > 0 ? { widthPx: Math.floor(value.widthPx) } : {}),
      ...(typeof value.heightPx === 'number' && Number.isFinite(value.heightPx) && value.heightPx > 0 ? { heightPx: Math.floor(value.heightPx) } : {}),
      ...(typeof value.cellWidthPx === 'number' && Number.isFinite(value.cellWidthPx) && value.cellWidthPx > 0 ? { cellWidthPx: value.cellWidthPx } : {}),
      ...(typeof value.cellHeightPx === 'number' && Number.isFinite(value.cellHeightPx) && value.cellHeightPx > 0 ? { cellHeightPx: value.cellHeightPx } : {}),
      ...(typeof value.alt === 'string' && value.alt ? { alt: value.alt } : {}),
      ...(typeof value.indentColumns === 'number' && Number.isFinite(value.indentColumns) && value.indentColumns > 0 ? { indentColumns: Math.floor(value.indentColumns) } : {})
    };
  }

  return undefined;
}

function isSupportedImageMimeType(value: string): boolean {
  const mimeType = value.toLowerCase();
  return mimeType === 'image/png'
    || mimeType === 'image/jpeg'
    || mimeType === 'image/gif'
    || mimeType === 'image/webp';
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
