// Pure text projection used by Tauren session tree and list metadata.
import { isRecord } from './records.js';
export function extractPiMessageText(content: unknown, options: { separator?: string; includeImages?: boolean; imagePlaceholder?: string; includeToolCalls?: boolean } = {}): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap(item => {
    if (!isRecord(item)) return [];
    if (item.type === 'text' && typeof item.text === 'string') return [item.text];
    if (options.includeImages && item.type === 'image') return [options.imagePlaceholder ?? '[Image]'];
    if (options.includeToolCalls && item.type === 'toolCall' && typeof item.name === 'string') return [item.name + '()'];
    return [];
  }).join(options.separator ?? '\n\n');
}
