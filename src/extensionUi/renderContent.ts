import type { WebviewExtensionRenderBlock } from '../webviewProtocol/types';

export type ExtensionRenderContent = {
  lines: string[];
  blocks: WebviewExtensionRenderBlock[];
};

export type ExtensionCellDimensions = {
  widthPx: number;
  heightPx: number;
};

type ComponentLike = {
  render?(width: number): unknown;
};

type ImageLike = {
  base64Data: string;
  mimeType: string;
  dimensions?: {
    widthPx?: number;
    heightPx?: number;
  };
  options?: {
    maxWidthCells?: number;
    maxHeightCells?: number;
    filename?: string;
  };
};

export const defaultCellDimensions: ExtensionCellDimensions = { widthPx: 9, heightPx: 18 };
const fallbackImageDimensions = { widthPx: 800, heightPx: 600 };

export function renderTextContent(lines: unknown): ExtensionRenderContent {
  const normalizedLines = normalizeLines(lines);
  return {
    lines: normalizedLines,
    blocks: normalizedLines.length > 0 ? [{ type: 'text', lines: normalizedLines }] : []
  };
}

export function renderComponentContent(component: unknown, width: number, cellDimensions?: ExtensionCellDimensions): ExtensionRenderContent {
  const normalizedCellDimensions = normalizeCellDimensions(cellDimensions);
  const blocks = renderComponentBlocks(component, width, 0, new Set<unknown>(), normalizedCellDimensions);

  if (blocks.length > 0) {
    return { lines: linesForBlocks(blocks), blocks };
  }

  return renderTextContent(isComponentLike(component) ? component.render?.(width) : []);
}

function isComponentLike(value: unknown): value is ComponentLike {
  return isRecord(value) && typeof value.render === 'function';
}

function renderComponentBlocks(
  component: unknown,
  width: number,
  indentColumns: number,
  seen: Set<unknown>,
  cellDimensions: ExtensionCellDimensions | undefined
): WebviewExtensionRenderBlock[] {
  if (!isRecord(component) || seen.has(component)) {
    return [];
  }

  seen.add(component);

  const image = imageBlockForComponent(component, width, indentColumns, cellDimensions);
  if (image) {
    return [image];
  }

  const children = Array.isArray(component.children) ? component.children : undefined;
  if (!children || children.length === 0 || !children.some((child) => containsImageLikeDescendant(child, new Set<unknown>()))) {
    return [];
  }

  const paddingX = integerField(component, 'paddingX', 0);
  const paddingY = integerField(component, 'paddingY', 0);
  const childWidth = Math.max(1, width - (paddingX * 2));
  const childIndent = indentColumns + paddingX;
  const blocks: WebviewExtensionRenderBlock[] = [];

  if (paddingY > 0) {
    blocks.push({ type: 'text', lines: Array.from({ length: paddingY }, () => '') });
  }

  for (const child of children) {
    const childBlocks = renderComponentBlocks(child, childWidth, childIndent, seen, cellDimensions);
    if (childBlocks.length > 0) {
      blocks.push(...childBlocks);
      continue;
    }

    if (isRecord(child) && typeof child.render === 'function') {
      const lines = normalizeLines(child.render(childWidth)).map((line) => `${' '.repeat(childIndent)}${line}`);
      if (lines.length > 0) {
        blocks.push({ type: 'text', lines });
      }
    }
  }

  if (paddingY > 0) {
    blocks.push({ type: 'text', lines: Array.from({ length: paddingY }, () => '') });
  }

  return blocks;
}

function containsImageLikeDescendant(value: unknown, seen: Set<unknown>): boolean {
  if (!isRecord(value) || seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (isImageLike(value)) {
    return true;
  }

  return Array.isArray(value.children) && value.children.some((child) => containsImageLikeDescendant(child, seen));
}

function imageBlockForComponent(
  component: Record<string, unknown>,
  width: number,
  indentColumns: number,
  cellDimensions: ExtensionCellDimensions | undefined
): WebviewExtensionRenderBlock | undefined {
  if (!isImageLike(component)) {
    return undefined;
  }

  const dimensions = normalizeImageDimensions(component.dimensions);
  const options = isRecord(component.options) ? component.options : {};
  const renderCellDimensions = cellDimensions ?? defaultCellDimensions;
  const maxWidthCells = clampPositiveInteger(options.maxWidthCells, Math.max(1, Math.min(width - 2, 60)));
  const defaultMaxHeight = Math.max(1, Math.ceil((maxWidthCells * renderCellDimensions.widthPx) / renderCellDimensions.heightPx));
  const maxHeightCells = clampPositiveInteger(options.maxHeightCells, defaultMaxHeight);
  const size = calculateImageCellSize(dimensions, maxWidthCells, maxHeightCells, renderCellDimensions);
  const filename = typeof options.filename === 'string' && options.filename ? options.filename : undefined;

  return {
    type: 'image',
    data: component.base64Data,
    mimeType: component.mimeType,
    columns: size.columns,
    rows: size.rows,
    widthPx: dimensions.widthPx,
    heightPx: dimensions.heightPx,
    ...(cellDimensions ? { cellWidthPx: cellDimensions.widthPx, cellHeightPx: cellDimensions.heightPx } : {}),
    ...(filename ? { alt: filename } : {}),
    ...(indentColumns > 0 ? { indentColumns } : {})
  };
}

function calculateImageCellSize(
  imageDimensions: { widthPx: number; heightPx: number },
  maxWidthCells: number,
  maxHeightCells: number,
  cellDimensions: ExtensionCellDimensions
): { columns: number; rows: number } {
  const maxWidth = Math.max(1, Math.floor(maxWidthCells));
  const maxHeight = Math.max(1, Math.floor(maxHeightCells));
  const imageWidth = Math.max(1, imageDimensions.widthPx);
  const imageHeight = Math.max(1, imageDimensions.heightPx);
  const widthScale = (maxWidth * cellDimensions.widthPx) / imageWidth;
  const heightScale = (maxHeight * cellDimensions.heightPx) / imageHeight;
  const scale = Math.min(widthScale, heightScale);
  const scaledWidthPx = imageWidth * scale;
  const scaledHeightPx = imageHeight * scale;
  const columns = Math.ceil(scaledWidthPx / cellDimensions.widthPx);
  const rows = Math.ceil(scaledHeightPx / cellDimensions.heightPx);

  return {
    columns: Math.max(1, Math.min(maxWidth, columns)),
    rows: Math.max(1, Math.min(maxHeight, rows))
  };
}

function linesForBlocks(blocks: WebviewExtensionRenderBlock[]): string[] {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      lines.push(...block.lines);
    } else if (block.rows > 0) {
      lines.push(...Array.from({ length: block.rows }, () => ''));
    }
  }

  return lines;
}

function normalizeLines(lines: unknown): string[] {
  return Array.isArray(lines) ? lines.map((line) => String(line)) : [];
}

function isImageLike(value: Record<string, unknown>): value is Record<string, unknown> & ImageLike {
  return typeof value.base64Data === 'string'
    && value.base64Data.length > 0
    && typeof value.mimeType === 'string'
    && isSupportedImageMimeType(value.mimeType);
}

function isSupportedImageMimeType(value: string): boolean {
  const mimeType = value.toLowerCase();
  return mimeType === 'image/png'
    || mimeType === 'image/jpeg'
    || mimeType === 'image/gif'
    || mimeType === 'image/webp';
}

function normalizeCellDimensions(value: ExtensionCellDimensions | undefined): ExtensionCellDimensions | undefined {
  if (!value) {
    return undefined;
  }

  const widthPx = clampPositiveNumber(value.widthPx, defaultCellDimensions.widthPx);
  const heightPx = clampPositiveNumber(value.heightPx, defaultCellDimensions.heightPx);
  return { widthPx, heightPx };
}

function normalizeImageDimensions(value: unknown): { widthPx: number; heightPx: number } {
  if (!isRecord(value)) {
    return fallbackImageDimensions;
  }

  return {
    widthPx: clampPositiveInteger(value.widthPx, fallbackImageDimensions.widthPx),
    heightPx: clampPositiveInteger(value.heightPx, fallbackImageDimensions.heightPx)
  };
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function clampPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function integerField(value: Record<string, unknown>, key: string, fallback: number): number {
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) && field > 0 ? Math.floor(field) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
