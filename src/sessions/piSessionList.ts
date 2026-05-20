import { existsSync, type Stats } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import { extractPiMessageText } from '../pi/messageContent';
import { parseSessionJsonlFileRecords } from '../pi/sessionJsonl';
import type { ListPiSessionsOptions, PiSessionListItem, RawSessionInfo, SessionTreeNode } from './types';
export type { ListPiSessionsOptions, PiSessionListItem } from './types';

const piSessionDirEnvName = 'PI_CODING_AGENT_SESSION_DIR';
const maxConcurrentSessionFileReads = 8;
const maxCachedSessionInfos = 500;

const sessionInfoCache = new Map<string, { mtimeMs: number; size: number; session: RawSessionInfo }>();

export async function listPiSessions(options: ListPiSessionsOptions = {}): Promise<PiSessionListItem[]> {
  const env = options.env ?? process.env;
  const sessionDir = options.sessionDir
    ?? await resolveConfiguredSessionDir(options.cwd, options.currentSessionFile, env);
  const sessions = sessionDir ? await listSessionsFromDir(sessionDir) : [];

  return decorateSessions(sessions, options.currentSessionFile);
}

async function listSessionsFromDir(sessionDir: string): Promise<RawSessionInfo[]> {
  if (!existsSync(sessionDir)) {
    return [];
  }

  let names: string[];

  try {
    names = await readdir(sessionDir);
  } catch {
    return [];
  }

  const sessions = await mapWithConcurrency(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(sessionDir, name)),
    maxConcurrentSessionFileReads,
    buildSessionInfo
  );

  return sessions.filter((session): session is RawSessionInfo => Boolean(session));
}

function decorateSessions(
  sessions: RawSessionInfo[],
  currentSessionFile: string | undefined
): PiSessionListItem[] {
  const currentPath = canonicalizePath(currentSessionFile);

  return flattenSessionTree(buildSessionTree(sessions)).map((item) => ({
    ...item,
    current: currentPath !== undefined && canonicalizePath(item.path) === currentPath
  }));
}

async function resolveConfiguredSessionDir(
  cwd: string | undefined,
  currentSessionFile: string | undefined,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const envSessionDir = env[piSessionDirEnvName];

  if (envSessionDir) {
    return resolveSessionDirPath(envSessionDir, cwd);
  }

  const settingsSessionDir = await readConfiguredSessionDir(cwd);

  if (settingsSessionDir) {
    return resolveSessionDirPath(settingsSessionDir, cwd);
  }

  if (cwd) {
    return getDefaultSessionDir(cwd);
  }

  return currentSessionFile ? dirname(currentSessionFile) : undefined;
}

async function readConfiguredSessionDir(cwd: string | undefined): Promise<string | undefined> {
  const [globalSettings, projectSettings] = await Promise.all([
    readSettings(join(homedir(), '.pi', 'agent', 'settings.json')),
    cwd ? readSettings(join(cwd, '.pi', 'settings.json')) : Promise.resolve(undefined)
  ]);

  const value = projectSettings?.sessionDir ?? globalSettings?.sessionDir;
  return typeof value === 'string' && value ? value : undefined;
}

async function readSettings(path: string): Promise<{ sessionDir?: unknown } | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getDefaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return join(getDefaultSessionsRoot(), safePath);
}

function getDefaultSessionsRoot(): string {
  return join(homedir(), '.pi', 'agent', 'sessions');
}

function resolveSessionDirPath(path: string, cwd: string | undefined): string {
  const expanded = expandTildePath(path);
  return isAbsolute(expanded) || !cwd ? expanded : resolve(cwd, expanded);
}

function expandTildePath(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

async function buildSessionInfo(filePath: string): Promise<RawSessionInfo | undefined> {
  try {
    const stats = await stat(filePath);
    const cached = getCachedSessionInfo(filePath, stats);

    if (cached) {
      return cached;
    }

    let header: Record<string, unknown> | undefined;
    let messageCount = 0;
    let firstMessage = '';
    let name: string | undefined;
    let lastActivityTime: number | undefined;

    for await (const entry of parseSessionJsonlFileRecords(filePath)) {
      if (!isRecord(entry)) {
        continue;
      }

      if (!header) {
        if (entry.type !== 'session' || typeof entry.id !== 'string') {
          return undefined;
        }

        header = entry;
        continue;
      }

      if (entry.type === 'session_info') {
        name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined;
        continue;
      }

      if (entry.type !== 'message' || !isRecord(entry.message)) {
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
        firstMessage = extractPiMessageText(entry.message.content, { separator: ' ' }).trim();
      }
    }

    if (!header) {
      return undefined;
    }

    const created = parseDate(header.timestamp, stats.mtime);
    const modified = lastActivityTime !== undefined ? new Date(lastActivityTime) : created;
    const session = {
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

    rememberSessionInfo(filePath, stats, session);
    return session;
  } catch {
    return undefined;
  }
}

function getCachedSessionInfo(filePath: string, stats: Stats): RawSessionInfo | undefined {
  const cached = sessionInfoCache.get(filePath);

  if (!cached || cached.mtimeMs !== stats.mtimeMs || cached.size !== stats.size) {
    return undefined;
  }

  sessionInfoCache.delete(filePath);
  sessionInfoCache.set(filePath, cached);
  return { ...cached.session };
}

function rememberSessionInfo(filePath: string, stats: Stats, session: RawSessionInfo): void {
  if (sessionInfoCache.has(filePath)) {
    sessionInfoCache.delete(filePath);
  }

  sessionInfoCache.set(filePath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    session: { ...session }
  });

  if (sessionInfoCache.size <= maxCachedSessionInfos) {
    return;
  }

  const oldestKey = sessionInfoCache.keys().next().value;

  if (typeof oldestKey === 'string') {
    sessionInfoCache.delete(oldestKey);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await task(items[index]);
    }
  }

  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
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
  nodes.sort((left, right) => new Date(right.session.modified).getTime() - new Date(left.session.modified).getTime());

  for (const node of nodes) {
    sortSessionTree(node.children);
  }
}

function flattenSessionTree(roots: SessionTreeNode[]): Array<Omit<PiSessionListItem, 'current'>> {
  const result: Array<Omit<PiSessionListItem, 'current'>> = [];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
