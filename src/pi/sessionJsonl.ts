import { createReadStream } from 'fs';

export function parseSessionJsonlRecords(content: string): unknown[] {
  return Array.from(iterSessionJsonlRecords(content));
}

export function* iterSessionJsonlRecords(content: string): Generator<unknown> {
  let lineStart = 0;

  for (;;) {
    const lineEnd = content.indexOf('\n', lineStart);

    if (lineEnd === -1) {
      yield* yieldParsedSessionLine(content.slice(lineStart));
      return;
    }

    yield* yieldParsedSessionLine(content.slice(lineStart, lineEnd));
    lineStart = lineEnd + 1;
  }
}

export async function* parseSessionJsonlFileRecords(filePath: string): AsyncGenerator<unknown> {
  let buffer = '';

  for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
    buffer += chunk;

    for (;;) {
      const lineEnd = buffer.indexOf('\n');

      if (lineEnd === -1) {
        break;
      }

      yield* yieldParsedSessionLine(buffer.slice(0, lineEnd));
      buffer = buffer.slice(lineEnd + 1);
    }
  }

  if (buffer) {
    yield* yieldParsedSessionLine(buffer);
  }
}

function* yieldParsedSessionLine(line: string): Generator<unknown> {
  const parsed = parseSessionJsonlLine(line);

  if (parsed !== undefined) {
    yield parsed;
  }
}

function parseSessionJsonlLine(line: string): unknown | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Skip malformed session lines. Pi session readers are intentionally tolerant.
    return undefined;
  }
}
