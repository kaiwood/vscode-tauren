import { existsSync, type Stats } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import { readSessionJsonlHeader } from '../pi/sessionJsonl';
import { readSessionMetadataCache, writeSessionMetadataCache, type CachedSessionInfo } from './sessionMetadataCache';
import { readSessionSummary } from './sessionSummaryParser';
import type { ListPiSessionsOptions, PiSessionCandidate, RawSessionInfo, SessionListItem } from './types';
import { decorateSessionTree } from './sessionTree';
import { mapWithConcurrency } from '../shared/mapWithConcurrency';
import { isRecord } from '../shared/typeGuards';
export type { ListPiSessionsOptions, PiSessionCandidate, SessionListItem } from './types';

const piSessionDirEnvName = 'PI_CODING_AGENT_SESSION_DIR';
const maxConcurrentSessionFileReads = 8;
const maxCachedSessionInfos = 5000;
const sessionListProgressBatchSize = 50;

const sessionInfoCache = new Map<string, { mtimeMs: number; size: number; session: RawSessionInfo }>();

type SessionFileStats = {
  path: string;
  stats: Stats;
};

type SessionFileLoad = {
  file: SessionFileStats;
  stale?: CachedSessionInfo;
};

export async function listPiSessions(options: ListPiSessionsOptions = {}): Promise<SessionListItem[]> {
  const env = options.env ?? process.env;
  const sessionDir = options.sessionDir
    ?? await resolveConfiguredSessionDir(options.cwd, options.currentSessionFile, env);
  const sessions = sessionDir ? await listSessionsFromDir(sessionDir, options) : [];

  return decorateSessions(sessions, options.currentSessionFile);
}

export async function listPiSessionCandidates(options: ListPiSessionsOptions = {}): Promise<PiSessionCandidate[]> {
  const env = options.env ?? process.env;
  const sessionDir = options.sessionDir
    ?? await resolveConfiguredSessionDir(options.cwd, options.currentSessionFile, env);

  return sessionDir ? listSessionCandidatesFromDir(sessionDir) : [];
}

async function listSessionsFromDir(sessionDir: string, options: ListPiSessionsOptions): Promise<RawSessionInfo[]> {
  if (!existsSync(sessionDir)) {
    return [];
  }

  let names: string[];

  try {
    names = await readdir(sessionDir);
  } catch {
    return [];
  }

  const fileStats = await mapWithConcurrency(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(sessionDir, name)),
    maxConcurrentSessionFileReads,
    statSessionFile
  );
  const existingFiles = fileStats.filter((file): file is SessionFileStats => Boolean(file));
  const persistedCache = await readSessionMetadataCache(options.sessionMetadataCacheFile);
  const previousSessions = createPreviousSessionCache(options.previousSessions);
  const entriesByPath = new Map<string, CachedSessionInfo>();
  const readyEntries: CachedSessionInfo[] = [];
  const filesToLoadCheap: SessionFileLoad[] = [];
  const filesToParse: SessionFileStats[] = [];
  let cacheHits = 0;

  for (const file of existingFiles) {
    const cached = persistedCache.get(file.path);
    const stale = cached ?? previousSessions.get(file.path);

    if (cached && cached.mtimeMs === file.stats.mtimeMs && cached.size === file.stats.size) {
      const entry = {
        mtimeMs: cached.mtimeMs,
        size: cached.size,
        session: markSessionMetadataReady({ ...cached.session, path: file.path })
      };
      entriesByPath.set(file.path, entry);
      readyEntries.push(entry);
      cacheHits += 1;
    } else {
      filesToLoadCheap.push({ file, ...(stale ? { stale } : {}) });
    }
  }

  const publishProgress = (): void => {
    options.onProgress?.(decorateSessions(
      Array.from(entriesByPath.values()).map((entry) => entry.session),
      options.currentSessionFile
    ));
  };

  const cheapEntries = await mapWithConcurrency(
    filesToLoadCheap,
    maxConcurrentSessionFileReads,
    buildCheapSessionInfo
  );

  for (let index = 0; index < cheapEntries.length; index += 1) {
    const entry = cheapEntries[index];

    if (!entry) {
      continue;
    }

    entriesByPath.set(entry.session.path, entry);
    filesToParse.push(filesToLoadCheap[index].file);
  }

  if (entriesByPath.size > 0) {
    publishProgress();
  }

  let parsedCount = 0;
  await parseSessionInfoFiles(filesToParse, (entry) => {
    entriesByPath.set(entry.session.path, entry);
    readyEntries.push(entry);
    parsedCount += 1;

    if (parsedCount % sessionListProgressBatchSize === 0) {
      publishProgress();
    }
  });

  const entries = Array.from(entriesByPath.values());
  options.onMetrics?.({
    sessionCount: entries.length,
    totalBytes: existingFiles.reduce((total, file) => total + file.stats.size, 0),
    cacheHits,
    cacheMisses: filesToParse.length
  });

  if (parsedCount > 0 || persistedCache.size !== readyEntries.length) {
    await writeSessionMetadataCache(options.sessionMetadataCacheFile, readyEntries);
  }

  return entries.map((entry) => entry.session);
}

async function listSessionCandidatesFromDir(sessionDir: string): Promise<PiSessionCandidate[]> {
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
    buildSessionCandidate
  );

  return sessions.filter((session): session is PiSessionCandidate => Boolean(session));
}

function createPreviousSessionCache(sessions: ListPiSessionsOptions['previousSessions']): Map<string, CachedSessionInfo> {
  const cache = new Map<string, CachedSessionInfo>();

  for (const session of sessions ?? []) {
    cache.set(session.path, {
      mtimeMs: Number.NaN,
      size: Number.NaN,
      session: { ...session }
    });
  }

  return cache;
}

function decorateSessions(
  sessions: RawSessionInfo[],
  currentSessionFile: string | undefined
): SessionListItem[] {
  return decorateSessionTree(sessions, currentSessionFile);
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

async function buildSessionCandidate(filePath: string): Promise<PiSessionCandidate | undefined> {
  try {
    const stats = await stat(filePath);
    const header = await readSessionJsonlHeader(filePath);

    if (!header || typeof header.id !== 'string') {
      return undefined;
    }

    return {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
      mtimeMs: stats.mtimeMs,
      size: stats.size
    };
  } catch {
    return undefined;
  }
}

async function buildSessionInfo(filePath: string, knownStats?: Stats): Promise<RawSessionInfo | undefined> {
  try {
    const stats = knownStats ?? await stat(filePath);
    const cached = getCachedSessionInfo(filePath, stats);

    if (cached) {
      return markSessionMetadataReady(cached);
    }

    const session = await readSessionSummary(filePath, stats);

    if (!session) {
      return undefined;
    }

    const readySession = markSessionMetadataReady(session);
    rememberSessionInfo(filePath, stats, readySession);
    return readySession;
  } catch {
    return undefined;
  }
}

async function buildCheapSessionInfo(load: SessionFileLoad): Promise<CachedSessionInfo | undefined> {
  const { file, stale } = load;

  try {
    const header = await readSessionJsonlHeader(file.path);

    if (!header || typeof header.id !== 'string') {
      return undefined;
    }

    const created = parseDate(header.timestamp, file.stats.mtime);
    const staleSession = stale?.session.id === header.id ? stale.session : undefined;
    return {
      mtimeMs: file.stats.mtimeMs,
      size: file.stats.size,
      session: {
        path: file.path,
        id: header.id,
        cwd: typeof header.cwd === 'string' ? header.cwd : staleSession?.cwd ?? '',
        parentSessionPath: typeof header.parentSession === 'string' ? header.parentSession : staleSession?.parentSessionPath,
        created: staleSession?.created ?? created.toISOString(),
        modified: staleSession?.modified ?? file.stats.mtime.toISOString(),
        messageCount: staleSession?.messageCount ?? 0,
        firstMessage: staleSession?.firstMessage ?? 'Loading metadata…',
        ...(staleSession?.name ? { name: staleSession.name } : {}),
        metadataState: 'loading'
      }
    };
  } catch {
    return undefined;
  }
}

async function statSessionFile(filePath: string): Promise<SessionFileStats | undefined> {
  try {
    return { path: filePath, stats: await stat(filePath) };
  } catch {
    return undefined;
  }
}

async function parseSessionInfoFiles(
  files: SessionFileStats[],
  onSession: (entry: CachedSessionInfo) => void
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= files.length) {
        return;
      }

      const file = files[index];
      const session = await buildSessionInfo(file.path, file.stats);

      if (session) {
        onSession({
          mtimeMs: file.stats.mtimeMs,
          size: file.stats.size,
          session
        });
      }
    }
  }

  const workerCount = Math.min(maxConcurrentSessionFileReads, files.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
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

function markSessionMetadataReady(session: RawSessionInfo): RawSessionInfo {
  return { ...session, metadataState: 'ready' };
}

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') {
    return fallback;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? fallback : new Date(time);
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
