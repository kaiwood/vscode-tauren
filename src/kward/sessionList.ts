import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WebviewSessionItem } from '../webviewProtocol/types';
import type { SessionListProgressOptions } from '../controller/types';
import type { RawSessionInfo, SessionTreeNode } from '../sessions/types';
import { isRecord } from '../shared/typeGuards';
import { KwardCapabilityResolver } from './capabilities';
import { KwardRpcTransport } from './rpcTransport';

const maxCachedKwardSessionItems = 5000;
const kwardSessionItemCache = new Map<string, { size: number; mtimeMs: number; item: WebviewSessionItem | undefined }>();

export async function listKwardSessions(options: {
  cwd?: string;
  currentSessionFile?: string;
  kwardPath?: string;
  progress?: SessionListProgressOptions;
} = {}): Promise<WebviewSessionItem[]> {
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
  const sessions = (await Promise.all(files.map(readKwardSessionItem))).filter(isVisibleKwardSessionItem);

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
}): Promise<WebviewSessionItem[] | undefined> {
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

function readKwardSessionItemFromRpc(value: unknown): WebviewSessionItem | undefined {
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

async function readKwardSessionItem(file: string): Promise<WebviewSessionItem | undefined> {
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

async function readKwardSessionItemUncached(file: string, stats: Awaited<ReturnType<typeof stat>>): Promise<WebviewSessionItem | undefined> {
  const content = await readFile(file, 'utf8');
  let header: Record<string, unknown> | undefined;
  let latestInfo: Record<string, unknown> | undefined;
  let firstMessage = '';
  let messageCount = 0;

  for (const line of content.split('\n')) {
    if (!line) {
      continue;
    }

    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

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

function rememberKwardSessionItem(file: string, size: number, mtimeMs: number, item: WebviewSessionItem | undefined): void {
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

function isKwardSessionItem(session: WebviewSessionItem | undefined): session is WebviewSessionItem {
  return session !== undefined;
}

function isVisibleKwardSessionItem(session: WebviewSessionItem | undefined): session is WebviewSessionItem {
  return isKwardSessionItem(session) && !isEmptyUnnamedKwardSessionItem(session);
}

function isEmptyUnnamedKwardSessionItem(session: WebviewSessionItem): boolean {
  return isEmptyUnnamedKwardSessionFields(session.messageCount, session.name, session.firstMessage);
}

function isEmptyUnnamedKwardSessionFields(messageCount: number | undefined, name: string | undefined, firstMessage: string | undefined): boolean {
  return messageCount === 0
    && !name?.trim()
    && !firstMessage?.trim();
}

function decorateSessions(sessions: WebviewSessionItem[], currentSessionFile: string | undefined): WebviewSessionItem[] {
  const currentPath = canonicalizePath(currentSessionFile);

  return flattenSessionTree(buildSessionTree(sessions)).map((session) => ({
    ...session,
    current: currentPath !== undefined && canonicalizePath(session.path) === currentPath,
    metadataState: 'ready'
  }));
}

function buildSessionTree(sessions: RawSessionInfo[]): SessionTreeNode[] {
  const byPath = new Map<string, SessionTreeNode>();

  for (const session of sessions) {
    byPath.set(canonicalizePath(session.path) ?? session.path, { session, children: [] });
  }

  const roots: SessionTreeNode[] = [];

  for (const session of sessions) {
    const sessionPath = canonicalizePath(session.path) ?? session.path;
    const node = byPath.get(sessionPath);

    if (!node) {
      continue;
    }

    const parentPath = canonicalizePath(session.parentSessionPath);

    if (parentPath && byPath.has(parentPath)) {
      byPath.get(parentPath)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortSessionTree(roots);
  return roots;
}

function sortSessionTree(nodes: SessionTreeNode[]): void {
  nodes.sort((left, right) => Date.parse(right.session.modified || '') - Date.parse(left.session.modified || ''));

  for (const node of nodes) {
    sortSessionTree(node.children);
  }
}

function flattenSessionTree(roots: SessionTreeNode[]): Array<Omit<WebviewSessionItem, 'current'>> {
  const result: Array<Omit<WebviewSessionItem, 'current'>> = [];

  const walk = (
    node: SessionTreeNode,
    depth: number,
    ancestorContinues: boolean[],
    isLast: boolean
  ): void => {
    result.push({
      ...node.session,
      depth,
      isLast,
      ancestorContinues
    });

    node.children.forEach((child, index) => {
      walk(child, depth + 1, [...ancestorContinues, depth > 0 ? !isLast : false], index === node.children.length - 1);
    });
  };

  roots.forEach((root, index) => {
    walk(root, 0, [], index === roots.length - 1);
  });

  return result;
}

function canonicalizePath(path: string | undefined): string | undefined {
  return path ? resolve(path) : undefined;
}
