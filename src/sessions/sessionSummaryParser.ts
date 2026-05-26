import { createReadStream, type Stats } from 'fs';
import { extractPiMessageText } from '../pi/messageContent';
import type { RawSessionInfo } from './types';

const maxSessionFirstMessageLength = 500;
const truncationMarker = '…';

type JsonValueSlice = {
  start: number;
  end: number;
};

type MessageSummary = {
  role?: string;
  timestamp?: number;
};

export async function readSessionSummary(filePath: string, stats: Stats): Promise<RawSessionInfo | undefined> {
  let header: Record<string, unknown> | undefined;
  let messageCount = 0;
  let firstMessage = '';
  let name: string | undefined;
  let lastActivityTime: number | undefined;

  for await (const line of iterSessionJsonlLines(filePath)) {
    if (!header) {
      const entry = parseJsonlRecord(line);

      if (!entry) {
        continue;
      }

      if (entry.type !== 'session' || typeof entry.id !== 'string') {
        return undefined;
      }

      header = entry;
      continue;
    }

    const type = getFastTopLevelType(line) ?? getObjectStringProperty(line, 'type');

    if (type === 'session_info') {
      const entry = parseJsonlRecord(line);
      name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined;
      continue;
    }

    if (type !== 'message') {
      continue;
    }

    const summary = readMessageSummary(line);

    if (!summary) {
      const entry = parseJsonlRecord(line);

      if (!entry || entry.type !== 'message' || !isRecord(entry.message)) {
        continue;
      }

      messageCount += 1;
      const role = entry.message.role;

      if (role === 'user' || role === 'assistant') {
        const activityTime = getMessageActivityTime(entry, entry.message);

        if (activityTime !== undefined) {
          lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
        }
      }

      if (role === 'user' && !firstMessage) {
        firstMessage = getFirstUserMessage(entry.message);
      }

      continue;
    }

    messageCount += 1;

    if ((summary.role === 'user' || summary.role === 'assistant') && summary.timestamp !== undefined) {
      lastActivityTime = Math.max(lastActivityTime ?? 0, summary.timestamp);
    }

    if (summary.role === 'user' && !firstMessage) {
      const fastFirstMessage = getFastFirstUserMessage(line);

      if (fastFirstMessage !== undefined) {
        firstMessage = fastFirstMessage;
      } else {
        const entry = parseJsonlRecord(line);

        if (entry?.type === 'message' && isRecord(entry.message) && entry.message.role === 'user') {
          firstMessage = getFirstUserMessage(entry.message);
        }
      }
    }
  }

  if (!header) {
    return undefined;
  }

  const created = parseDate(header.timestamp, stats.mtime);
  const modified = lastActivityTime !== undefined ? new Date(lastActivityTime) : created;
  return {
    path: filePath,
    id: header.id as string,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    name,
    parentSessionPath: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    created: created.toISOString(),
    modified: modified.toISOString(),
    messageCount,
    firstMessage: firstMessage || '(no messages)'
  };
}

async function* iterSessionJsonlLines(filePath: string): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
    buffer += chunk;

    for (;;) {
      const lineEnd = buffer.indexOf('\n');

      if (lineEnd === -1) {
        break;
      }

      yield buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
    }
  }

  if (buffer) {
    yield buffer;
  }
}

function readMessageSummary(line: string): MessageSummary | undefined {
  // Generated Pi JSONL should not contain trailing commas. Fall back to JSON.parse
  // instead of trusting the fast scanner for lines with common malformed markers.
  if (line.includes(',}') || line.includes(',]')) {
    return undefined;
  }

  const role = getFastMessageRole(line);

  if (!role) {
    return undefined;
  }

  const messageTimestamp = getFastMessageTimestamp(line);

  if (messageTimestamp === undefined && hasPotentialMessageTimestampAfterContent(line)) {
    return undefined;
  }

  return {
    role,
    timestamp: messageTimestamp ?? getFastTopLevelTimestamp(line)
  };
}

function getFastFirstUserMessage(line: string): string | undefined {
  const messageIndex = line.indexOf('"message"');

  if (messageIndex < 0) {
    return undefined;
  }

  const contentIndex = line.indexOf('"content"', messageIndex);

  if (contentIndex < 0) {
    return undefined;
  }

  let valueStart = skipWhitespace(line, contentIndex + '"content"'.length);

  if (line[valueStart] !== ':') {
    return undefined;
  }

  valueStart = skipWhitespace(line, valueStart + 1);

  if (line[valueStart] === '"') {
    const token = readStringToken(line, valueStart);
    const value = token ? readStringValue(line, valueStart, token.end) : undefined;
    return value === undefined ? undefined : truncateSessionFirstMessage(value.trim());
  }

  if (line[valueStart] !== '[') {
    return undefined;
  }

  const valueEnd = skipBalancedJsonContainer(line, valueStart);

  if (valueEnd === undefined) {
    return undefined;
  }

  const textParts: string[] = [];
  let searchIndex = valueStart;

  for (;;) {
    const textKeyIndex = line.indexOf('"text"', searchIndex);

    if (textKeyIndex < 0 || textKeyIndex >= valueEnd) {
      break;
    }

    let textStart = skipWhitespace(line, textKeyIndex + '"text"'.length);

    if (line[textStart] !== ':') {
      return undefined;
    }

    textStart = skipWhitespace(line, textStart + 1);

    if (line[textStart] !== '"') {
      searchIndex = textStart + 1;
      continue;
    }

    const token = readStringToken(line, textStart);

    if (!token) {
      return undefined;
    }

    const value = readStringValue(line, textStart, token.end);

    if (value === undefined) {
      return undefined;
    }

    textParts.push(value);
    searchIndex = token.end;
  }

  return truncateSessionFirstMessage(textParts.join(' ').trim());
}

function getFirstUserMessage(message: Record<string, unknown>): string {
  return truncateSessionFirstMessage(extractPiMessageText(message.content, { separator: ' ' }).trim());
}

function getMessageActivityTime(entry: Record<string, unknown>, message: Record<string, unknown>): number | undefined {
  if (typeof message.timestamp === 'number') {
    return message.timestamp;
  }

  if (typeof entry.timestamp === 'string') {
    const time = new Date(entry.timestamp).getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  return undefined;
}

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') {
    return fallback;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? fallback : new Date(time);
}

function truncateSessionFirstMessage(value: string): string {
  const chars = Array.from(value);

  if (chars.length <= maxSessionFirstMessageLength) {
    return value;
  }

  return chars.slice(0, maxSessionFirstMessageLength - truncationMarker.length).join('').trimEnd() + truncationMarker;
}

function parseJsonlRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getFastTopLevelType(line: string): string | undefined {
  const match = /^\s*\{\s*"type"\s*:\s*"([^"\\]*)"/.exec(line);
  return match?.[1];
}

function getFastMessageRole(line: string): string | undefined {
  const match = /"message"\s*:\s*\{\s*"role"\s*:\s*"([^"\\]*)"/.exec(line);
  return match?.[1];
}

function hasPotentialMessageTimestampAfterContent(line: string): boolean {
  const messageIndex = line.indexOf('"message"');

  if (messageIndex < 0) {
    return false;
  }

  const contentIndex = line.indexOf('"content"', messageIndex);

  if (contentIndex < 0) {
    return false;
  }

  const arrayTimestampIndex = line.indexOf('],"timestamp"', contentIndex);
  const objectTimestampIndex = line.indexOf('},"timestamp"', contentIndex);
  return arrayTimestampIndex >= 0 || objectTimestampIndex >= 0;
}

function getFastMessageTimestamp(line: string): number | undefined {
  const messageIndex = line.indexOf('"message"');

  if (messageIndex < 0) {
    return undefined;
  }

  const timestampIndex = line.indexOf('"timestamp"', messageIndex);

  if (timestampIndex < 0) {
    return undefined;
  }

  const contentIndex = line.indexOf('"content"', messageIndex);

  if (contentIndex >= 0 && contentIndex < timestampIndex) {
    return undefined;
  }

  return readNumberAfterColon(line, timestampIndex + '"timestamp"'.length);
}

function getFastTopLevelTimestamp(line: string): number | undefined {
  const timestampIndex = line.indexOf('"timestamp"');

  if (timestampIndex < 0) {
    return undefined;
  }

  const messageIndex = line.indexOf('"message"');

  if (messageIndex >= 0 && messageIndex < timestampIndex) {
    return undefined;
  }

  const stringValue = readStringAfterColon(line, timestampIndex + '"timestamp"'.length);
  return getDateStringTime(stringValue);
}

function readNumberAfterColon(text: string, index: number): number | undefined {
  index = skipWhitespace(text, index);

  if (text[index] !== ':') {
    return undefined;
  }

  const start = skipWhitespace(text, index + 1);
  let end = start;

  while (end < text.length && /[0-9.+\-eE]/.test(text[end])) {
    end += 1;
  }

  if (end === start) {
    return undefined;
  }

  const value = Number(text.slice(start, end));
  return Number.isFinite(value) ? value : undefined;
}

function readStringAfterColon(text: string, index: number): string | undefined {
  index = skipWhitespace(text, index);

  if (text[index] !== ':') {
    return undefined;
  }

  const start = skipWhitespace(text, index + 1);
  const token = readStringToken(text, start);
  return token ? readStringValue(text, start, token.end) : undefined;
}

function getObjectStringProperty(text: string, key: string): string | undefined {
  const slice = getObjectPropertySlice(text, key);

  if (!slice || text[slice.start] !== '"') {
    return undefined;
  }

  return readStringValue(text, slice.start, slice.end);
}

function getObjectPropertySlice(text: string, wantedKey: string): JsonValueSlice | undefined {
  let index = skipWhitespace(text, 0);

  if (text[index] !== '{') {
    return undefined;
  }

  index += 1;

  for (;;) {
    index = skipWhitespace(text, index);

    if (index >= text.length || text[index] === '}') {
      return undefined;
    }

    const key = readPropertyKey(text, index);

    if (!key) {
      return undefined;
    }

    index = skipWhitespace(text, key.end);

    if (text[index] !== ':') {
      return undefined;
    }

    const valueStart = skipWhitespace(text, index + 1);
    const valueEnd = skipJsonValueShallow(text, valueStart);

    if (valueEnd === undefined) {
      return undefined;
    }

    if (key.value === wantedKey) {
      return { start: valueStart, end: valueEnd };
    }

    index = skipWhitespace(text, valueEnd);

    if (text[index] === ',') {
      index += 1;
      continue;
    }

    if (text[index] === '}') {
      return undefined;
    }

    return undefined;
  }
}

function readPropertyKey(text: string, index: number): { value: string; end: number } | undefined {
  const token = readStringToken(text, index);

  if (!token) {
    return undefined;
  }

  if (!token.hasEscape) {
    return { value: text.slice(index + 1, token.end - 1), end: token.end };
  }

  const value = readStringValue(text, index, token.end);
  return value === undefined ? undefined : { value, end: token.end };
}

function readStringValue(text: string, start: number, end: number): string | undefined {
  if (text[start] !== '"' || text[end - 1] !== '"') {
    return undefined;
  }

  const raw = text.slice(start, end);

  if (!raw.includes('\\')) {
    return raw.slice(1, -1);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringToken(text: string, index: number): { end: number; hasEscape: boolean } | undefined {
  if (text[index] !== '"') {
    return undefined;
  }

  let cursor = index + 1;
  let escaped = false;
  let hasEscape = false;

  while (cursor < text.length) {
    const char = text[cursor];

    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      hasEscape = true;
      cursor += 1;
      continue;
    }

    if (char === '"') {
      return { end: cursor + 1, hasEscape };
    }

    cursor += 1;
  }

  return undefined;
}

function skipJsonValueShallow(text: string, index: number): number | undefined {
  const char = text[index];

  if (char === '"') {
    return readStringToken(text, index)?.end;
  }

  if (char === '{' || char === '[') {
    return skipBalancedJsonContainer(text, index);
  }

  return skipJsonPrimitive(text, index);
}

function skipBalancedJsonContainer(text: string, index: number): number | undefined {
  const stack: string[] = [text[index] === '{' ? '}' : ']'];
  let cursor = index + 1;

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === '"') {
      const token = readStringToken(text, cursor);

      if (!token) {
        return undefined;
      }

      cursor = token.end;
      continue;
    }

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === stack[stack.length - 1]) {
      stack.pop();

      if (stack.length === 0) {
        return cursor + 1;
      }
    }

    cursor += 1;
  }

  return undefined;
}

function skipJsonPrimitive(text: string, index: number): number | undefined {
  let cursor = index;

  while (cursor < text.length && text[cursor] !== ',' && text[cursor] !== '}' && text[cursor] !== ']') {
    cursor += 1;
  }

  return cursor > index ? skipTrailingPrimitiveWhitespace(text, index, cursor) : undefined;
}

function skipTrailingPrimitiveWhitespace(text: string, start: number, end: number): number | undefined {
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1;
  }

  return end > start ? end : undefined;
}

function getDateStringTime(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }

  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
