import type { ChatImage } from '../chat/chatSession';

export type ExtractPiMessageTextOptions = {
  separator?: string;
  includeImages?: boolean;
  imagePlaceholder?: string;
  includeToolCalls?: boolean;
};

const supportedRasterImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

export function extractPiMessageText(
  content: unknown,
  options: ExtractPiMessageTextOptions = {}
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const separator = options.separator ?? '\n\n';
  const parts = content.flatMap((item) => extractContentPart(item, options));
  return parts.join(separator);
}

export function extractPiMessageImages(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((item): ChatImage[] => {
    const image = parsePiImageContent(item);
    return image ? [image] : [];
  });
}

export function parsePiImageContent(value: unknown): ChatImage | undefined {
  if (!isRecord(value) || value.type !== 'image' || typeof value.data !== 'string') {
    return undefined;
  }

  const mimeType = normalizeImageMimeType(value.mimeType);

  if (!mimeType) {
    return undefined;
  }

  return {
    type: 'image',
    data: value.data,
    mimeType,
    ...(typeof value.alt === 'string' && value.alt ? { alt: value.alt } : {})
  };
}

export function isSupportedRasterImageMimeType(value: unknown): value is string {
  return typeof value === 'string' && supportedRasterImageMimeTypes.has(value.toLowerCase());
}

function normalizeImageMimeType(value: unknown): string | undefined {
  if (!isSupportedRasterImageMimeType(value)) {
    return undefined;
  }

  return value.toLowerCase();
}

function extractContentPart(item: unknown, options: ExtractPiMessageTextOptions): string[] {
  if (!isRecord(item)) {
    return [];
  }

  if (item.type === 'text' && typeof item.text === 'string') {
    return [item.text];
  }

  if (options.includeImages && item.type === 'image') {
    return [options.imagePlaceholder ?? '[Image]'];
  }

  if (options.includeToolCalls && item.type === 'toolCall' && typeof item.name === 'string') {
    return [`${item.name}()`];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
