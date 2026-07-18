import { closeSync, openSync, readSync } from 'fs';
import { parseJsonlFileRecords } from '../shared/jsonl';
import { isRecord } from '../shared/typeGuards';

export async function readSessionJsonlHeader(filePath: string): Promise<Record<string, unknown> | undefined> {
  for await (const entry of parseJsonlFileRecords(filePath)) {
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

function parseSessionJsonlLine(line: string): unknown | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
