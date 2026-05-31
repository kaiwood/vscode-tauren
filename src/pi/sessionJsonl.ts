import { closeSync, createReadStream, openSync, readSync } from 'fs';
import { isRecord } from '../shared/typeGuards';

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

export async function readSessionJsonlHeader(filePath: string): Promise<Record<string, unknown> | undefined> {
  for await (const entry of parseSessionJsonlFileRecords(filePath)) {
    if (!isRecord(entry)) {
      continue;
    }

    return entry.type === 'session' ? entry : undefined;
  }

  return undefined;
}

export function readSessionJsonlHeaderCwdSync(filePath: string): string | undefined {
  const header = readSessionJsonlHeaderSync(filePath);
  return typeof header?.cwd === 'string' ? header.cwd : undefined;
}

function readSessionJsonlHeaderSync(filePath: string): Record<string, unknown> | undefined {
  let fd: number | undefined;

  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
    const record = parseSessionJsonlLine(firstLine);

    return isRecord(record) && record.type === 'session' ? record : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures for best-effort session header inspection.
      }
    }
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
