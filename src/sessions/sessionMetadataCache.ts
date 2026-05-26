import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { RawSessionInfo } from './types';

export type CachedSessionInfo = {
  mtimeMs: number;
  size: number;
  session: RawSessionInfo;
};

const sessionMetadataCacheVersion = 1;

type SessionMetadataCacheFile = {
  version: number;
  sessions: Record<string, CachedSessionInfo>;
};

export async function readSessionMetadataCache(cacheFile: string | undefined): Promise<Map<string, CachedSessionInfo>> {
  if (!cacheFile) {
    return new Map();
  }

  try {
    const content = await readFile(cacheFile, 'utf8');
    const parsed: unknown = JSON.parse(content);
    return parseSessionMetadataCache(parsed);
  } catch {
    return new Map();
  }
}

export async function writeSessionMetadataCache(
  cacheFile: string | undefined,
  entries: Iterable<CachedSessionInfo>
): Promise<void> {
  if (!cacheFile) {
    return;
  }

  const sessions: Record<string, CachedSessionInfo> = {};

  for (const entry of entries) {
    sessions[entry.session.path] = {
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      session: { ...entry.session }
    };
  }

  const cache: SessionMetadataCacheFile = {
    version: sessionMetadataCacheVersion,
    sessions
  };
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(tempFile, JSON.stringify(cache), 'utf8');
    await rename(tempFile, cacheFile);
  } catch {
    await unlink(tempFile).catch(() => undefined);
  }
}

function parseSessionMetadataCache(value: unknown): Map<string, CachedSessionInfo> {
  const result = new Map<string, CachedSessionInfo>();

  if (!isRecord(value) || value.version !== sessionMetadataCacheVersion || !isRecord(value.sessions)) {
    return result;
  }

  for (const [path, entry] of Object.entries(value.sessions)) {
    const cached = parseCachedSessionInfo(path, entry);

    if (cached) {
      result.set(path, cached);
    }
  }

  return result;
}

function parseCachedSessionInfo(path: string, value: unknown): CachedSessionInfo | undefined {
  if (!isRecord(value) || typeof value.mtimeMs !== 'number' || typeof value.size !== 'number') {
    return undefined;
  }

  const session = parseRawSessionInfo(path, value.session);

  return session ? {
    mtimeMs: value.mtimeMs,
    size: value.size,
    session
  } : undefined;
}

function parseRawSessionInfo(path: string, value: unknown): RawSessionInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = getString(value.id);
  const cwd = getString(value.cwd);
  const created = getString(value.created);
  const modified = getString(value.modified);
  const firstMessage = getString(value.firstMessage);
  const messageCount = value.messageCount;

  if (!id || cwd === undefined || !created || !modified || typeof messageCount !== 'number' || !firstMessage) {
    return undefined;
  }

  return {
    path,
    id,
    cwd,
    ...(getOptionalString(value.name) ? { name: getOptionalString(value.name) } : {}),
    ...(getOptionalString(value.parentSessionPath) ? { parentSessionPath: getOptionalString(value.parentSessionPath) } : {}),
    created,
    modified,
    messageCount,
    firstMessage
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
