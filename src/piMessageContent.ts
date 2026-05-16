export type ExtractPiMessageTextOptions = {
  separator?: string;
  includeImages?: boolean;
  imagePlaceholder?: string;
  includeToolCalls?: boolean;
};

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
