import type { FileSuggestion, FileSuggestionsResult } from '../types';

const fileSuggestionDelimiters = new Set([' ', '\t', '\n', '\r', '"', "'", '=']);

export function extractAtFilePrefix(textBeforeCursor: string): { prefix: string; start: number } | undefined {
  const quotedPrefix = extractQuotedAtFilePrefix(textBeforeCursor);

  if (quotedPrefix) {
    return quotedPrefix;
  }

  const lastDelimiterIndex = findLastFileSuggestionDelimiter(textBeforeCursor);
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;

  if (textBeforeCursor[tokenStart] === '@') {
    return { prefix: textBeforeCursor.slice(tokenStart), start: tokenStart };
  }

  return undefined;
}

export function getFileSuggestionPrefixInfo(textarea: HTMLTextAreaElement): { prefix: string; start: number } | undefined {
  const cursor = textarea.selectionStart;

  if (cursor !== textarea.selectionEnd) {
    return undefined;
  }

  return extractAtFilePrefix(textarea.value.slice(0, cursor));
}

export function acceptFileSuggestion(textarea: HTMLTextAreaElement, file: FileSuggestion): boolean {
  const prefixInfo = getFileSuggestionPrefixInfo(textarea);

  if (!prefixInfo) {
    return false;
  }

  const cursor = textarea.selectionStart;
  const beforePrefix = textarea.value.slice(0, prefixInfo.start);
  const afterCursor = textarea.value.slice(cursor);
  const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
  const hasTrailingQuoteInItem = file.value.endsWith('"');
  const adjustedAfterCursor = hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
  const suffix = file.directory ? '' : ' ';
  const nextValue = beforePrefix + file.value + suffix + adjustedAfterCursor;
  const cursorOffset = file.directory && hasTrailingQuoteInItem ? file.value.length - 1 : file.value.length;
  const nextCursor = beforePrefix.length + cursorOffset + suffix.length;

  textarea.value = nextValue;
  textarea.setSelectionRange(nextCursor, nextCursor);
  return true;
}

export function isFileSuggestionsResult(message: unknown): message is FileSuggestionsResult {
  if (!isRecord(message) || message.type !== 'fileSuggestionsResult') {
    return false;
  }

  return typeof message.id === 'string'
    && typeof message.prefix === 'string'
    && Array.isArray(message.items)
    && message.items.every(isFileSuggestion);
}

function extractQuotedAtFilePrefix(textBeforeCursor: string): { prefix: string; start: number } | undefined {
  let inQuotes = false;
  let quoteStart = -1;

  for (let index = 0; index < textBeforeCursor.length; index += 1) {
    if (textBeforeCursor[index] === '"') {
      inQuotes = !inQuotes;

      if (inQuotes) {
        quoteStart = index;
      }
    }
  }

  if (!inQuotes || quoteStart <= 0 || textBeforeCursor[quoteStart - 1] !== '@') {
    return undefined;
  }

  const atStart = quoteStart - 1;

  if (atStart > 0 && !fileSuggestionDelimiters.has(textBeforeCursor[atStart - 1] ?? '')) {
    return undefined;
  }

  return { prefix: textBeforeCursor.slice(atStart), start: atStart };
}

function findLastFileSuggestionDelimiter(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (fileSuggestionDelimiters.has(text[index] ?? '')) {
      return index;
    }
  }

  return -1;
}

function isFileSuggestion(value: unknown): value is FileSuggestion {
  return isRecord(value)
    && typeof value.value === 'string'
    && typeof value.label === 'string'
    && ('description' in value ? typeof value.description === 'string' : true)
    && typeof value.directory === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
