import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SessionListProgressOptions } from '../controller/types';
import { decorateSessionTree } from '../sessions/sessionTree';
import type { SessionListItem } from '../sessions/types';
import { parseJsonlFileRecords } from '../shared/jsonl';
import { mapWithConcurrency } from '../shared/mapWithConcurrency';
import { isRecord } from '../shared/typeGuards';
import { KwardCapabilityResolver } from './capabilities';
import { KwardRpcTransport } from './rpcTransport';

const maxCachedKwardSessionItems = 5000;
const maxConcurrentKwardSessionFileReads = 8;
const kwardSessionItemCache = new Map<string, { size: number; mtimeMs: number; item: SessionListItem | undefined }>();

export async function listKwardSessions(options: {
  cwd?: string;
  currentSessionFile?: string;
  kwardPath?: string;
  progress?: SessionListProgressOptions;
} = {}): Promise<SessionListItem[]> {
  const rpcSessions = await listKwardSessionsViaRpc(options).catch(() => undefined);
  if (rpcSessions) {
    return decorateSessions(rpcSessions, options.currentSessionFile);
  }

  const sessionDir = getKwardSessionDir(options.cwd);
  if (!sessionDir || !existsSync(sessionDir)) {
    return [];
  }

  const names = await readdir(sessionDir).catch(() => []);
  const files = names.filter((name) => name.endsWith('.jsonl')).map((name) => join(sessionDir, name));
  const sessions = (await mapWithConcurrency(files, maxConcurrentKwardSessionFileReads, readKwardSessionItem))
    .filter(isVisibleKwardSessionItem);

  sessions.sort((a, b) => Date.parse(b.modified || '') - Date.parse(a.modified || ''));
  return decorateSessions(sessions, options.currentSessionFile);
}

export async function listKwardSessionCandidates(options: {
  cwd?: string;
  currentSessionFile?: string;
  kwardPath?: string;
} = {}): Promise<Array<{ path: string; id?: string; cwd?: string }>> {
  const sessions = await listKwardSessions(options);
  const currentSession = options.currentSessionFile
    ? [{ path: options.currentSessionFile }]
    : [];

  return [...currentSession, ...sessions.map((session) => ({
    path: session.path,
    id: session.id,
    cwd: session.cwd
  }))];
}

async function listKwardSessionsViaRpc(options: {
  cwd?: string;
  currentSessionFile?: string;
  kwardPath?: string;
}): Promise<SessionListItem[] | undefined> {
  if (!options.cwd) {
    return undefined;
  }

  const transport = new KwardRpcTransport({ kwardPath: resolveKwardPath(options.kwardPath) });
  try {
    const initializeResult = await transport.request('initialize');
    const capabilities = isRecord(initializeResult) && isRecord(initializeResult.capabilities) ? initializeResult.capabilities : {};
    const capabilityResolver = new KwardCapabilityResolver(capabilities);
    if (!capabilityResolver.isMethodSupported('sessions', 'sessions/list')) {
      return undefined;
    }

    const result = await transport.request('sessions/list', {
      workspaceRoot: options.cwd,
      ...(options.currentSessionFile ? { currentSessionPath: options.currentSessionFile } : {})
    });
    return isRecord(result) && Array.isArray(result.sessions)
      ? result.sessions.map(readKwardSessionItemFromRpc).filter(isKwardSessionItem)
      : [];
  } finally {
    transport.dispose();
  }
}

function readKwardSessionItemFromRpc(value: unknown): SessionListItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const file = getString(value, 'path');
  const id = getString(value, 'id') ?? file;
  if (!file || !id) {
    return undefined;
  }

  const name = getString(value, 'name');
  const messageCount = getNumber(value, 'messageCount');
  const firstMessage = getString(value, 'firstMessage');

  if (isEmptyUnnamedKwardSessionFields(messageCount, name, firstMessage)) {
    return undefined;
  }

  const parentPath = getString(value, 'parentPath');

  return {
    path: file,
    id,
    cwd: getString(value, 'cwd') ?? getString(value, 'workspaceRoot') ?? '',
    ...(name ? { name } : {}),
    ...(parentPath ? { parentSessionPath: parentPath } : {}),
    created: getString(value, 'createdAt') ?? '',
    modified: getString(value, 'modifiedAt') ?? '',
    messageCount: messageCount ?? 0,
    firstMessage: firstMessage ?? '',
    depth: getNumber(value, 'depth') ?? 0,
    isLast: getBoolean(value, 'isLast') ?? false,
    ancestorContinues: getBooleanArray(value, 'ancestorContinues') ?? [],
    current: false,
    metadataState: 'ready'
  };
}

function getKwardSessionDir(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined;
  }

  return join(getKwardConfigDir(), 'sessions', safeCwd(cwd));
}

function getKwardConfigDir(): string {
  const configPath = process.env.KWARD_CONFIG_PATH;
  return configPath ? resolve(configPath, '..') : join(homedir(), '.kward');
}

function resolveKwardPath(kwardPath: string | undefined): string | undefined {
  return kwardPath?.startsWith('~') ? join(homedir(), kwardPath.slice(1)) : kwardPath;
}

function safeCwd(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

async function readKwardSessionItem(file: string): Promise<SessionListItem | undefined> {
  try {
    const stats = await stat(file);
    const cached = kwardSessionItemCache.get(file);

    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.item ? { ...cached.item } : undefined;
    }

    const item = await readKwardSessionItemUncached(file, stats);
    rememberKwardSessionItem(file, stats.size, stats.mtimeMs, item);
    return item;
  } catch {
    return undefined;
  }
}

async function readKwardSessionItemUncached(file: string, stats: Awaited<ReturnType<typeof stat>>): Promise<SessionListItem | undefined> {
  let header: Record<string, unknown> | undefined;
  let latestInfo: Record<string, unknown> | undefined;
  let firstMessage = '';
  let messageCount = 0;

  for await (const record of parseJsonlFileRecords(file)) {
    if (!isRecord(record)) {
      continue;
    }

    if (record.type === 'session' && !header) {
      header = record;
    } else if (record.type === 'session_info') {
      latestInfo = record;
    } else if (record.type === 'message' && isRecord(record.message)) {
      messageCount += 1;
      firstMessage ||= getUserMessageText(record.message);
    }
  }

  if (!header) {
    return undefined;
  }

  const id = typeof header.id === 'string' ? header.id : file;
  const cwd = typeof header.cwd === 'string' ? header.cwd : '';
  const created = typeof header.timestamp === 'string' ? header.timestamp : stats.birthtime.toISOString();
  const modified = stats.mtime.toISOString();
  const name = isRecord(latestInfo) && typeof latestInfo.name === 'string' ? latestInfo.name : undefined;
  const parentPath = typeof header.parentPath === 'string' ? header.parentPath : undefined;

  return {
    path: file,
    id,
    cwd,
    ...(name ? { name } : {}),
    ...(parentPath ? { parentSessionPath: parentPath } : {}),
    created,
    modified,
    messageCount,
    firstMessage,
    depth: 0,
    isLast: false,
    ancestorContinues: [],
    current: false,
    metadataState: 'ready'
  };
}

function rememberKwardSessionItem(file: string, size: number, mtimeMs: number, item: SessionListItem | undefined): void {
  kwardSessionItemCache.set(file, {
    size,
    mtimeMs,
    item: item ? { ...item } : undefined
  });

  if (kwardSessionItemCache.size <= maxCachedKwardSessionItems) {
    return;
  }

  const oldestKey = kwardSessionItemCache.keys().next().value as string | undefined;
  if (oldestKey) {
    kwardSessionItemCache.delete(oldestKey);
  }
}

function getUserMessageText(message: Record<string, unknown>): string {
  if (message.role !== 'user') {
    return '';
  }

  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((entry) => isRecord(entry) && typeof entry.text === 'string' ? entry.text : '').join('').trim();
  }

  return '';
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getBooleanArray(record: Record<string, unknown>, key: string): boolean[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is boolean => typeof entry === 'boolean') : undefined;
}

function isKwardSessionItem(session: SessionListItem | undefined): session is SessionListItem {
  return session !== undefined;
}

function isVisibleKwardSessionItem(session: SessionListItem | undefined): session is SessionListItem {
  return isKwardSessionItem(session) && !isEmptyUnnamedKwardSessionItem(session);
}

function isEmptyUnnamedKwardSessionItem(session: SessionListItem): boolean {
  return isEmptyUnnamedKwardSessionFields(session.messageCount, session.name, session.firstMessage);
}

function isEmptyUnnamedKwardSessionFields(messageCount: number | undefined, name: string | undefined, firstMessage: string | undefined): boolean {
  return messageCount === 0
    && !name?.trim()
    && !firstMessage?.trim();
}

function decorateSessions(sessions: SessionListItem[], currentSessionFile: string | undefined): SessionListItem[] {
  return decorateSessionTree(sessions, currentSessionFile).map((session) => ({
    ...session,
    metadataState: 'ready'
  }));
}
