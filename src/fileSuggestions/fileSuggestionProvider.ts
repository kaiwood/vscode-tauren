import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { WebviewFileSuggestion } from '../webviewProtocol/types';

const maxWalkEntries = 3000;
const maxSuggestions = 20;
const walkCacheLifetimeMs = 1500;
const maxCachedWalks = 4;
const excludedDirectoryNames = new Set(['.git', 'node_modules']);
const walkCache = new Map<string, { promise: Promise<WalkEntry[]>; expiresAt: number }>();

export async function getAtFileSuggestions(options: { cwd: string | undefined; prefix: string }): Promise<WebviewFileSuggestion[]> {
  const cwd = options.cwd?.trim();

  if (!cwd || !options.prefix.startsWith('@')) {
    return [];
  }

  const parsed = parsePathPrefix(options.prefix);
  const scoped = await resolveScopedFuzzyQuery(parsed.rawPrefix, cwd);

  if (scoped?.outsideCwd) {
    return [];
  }

  const baseDir = scoped?.baseDir ?? cwd;
  const query = scoped?.query ?? parsed.rawPrefix;
  const entries = await getCachedDirectoryWalk(baseDir);
  const normalizedQuery = toDisplayPath(query).toLowerCase();
  const scoredEntries = entries
    .map((entry) => ({
      ...entry,
      score: normalizedQuery ? scoreEntry(entry.path, normalizedQuery, entry.isDirectory) : 1
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.isDirectory) - Number(left.isDirectory) || left.path.localeCompare(right.path))
    .slice(0, maxSuggestions);

  return scoredEntries.map((entry) => {
    const pathWithoutSlash = entry.isDirectory ? entry.path.slice(0, -1) : entry.path;
    const displayPath = scoped
      ? scopedPathForDisplay(scoped.displayBase, pathWithoutSlash)
      : pathWithoutSlash;
    const completionPath = entry.isDirectory ? `${displayPath}/` : displayPath;

    return {
      value: buildCompletionValue(completionPath, {
        isAtPrefix: true,
        isQuotedPrefix: parsed.isQuotedPrefix
      }),
      label: path.basename(pathWithoutSlash) + (entry.isDirectory ? '/' : ''),
      description: displayPath,
      directory: entry.isDirectory
    };
  });
}

type ParsedPathPrefix = {
  rawPrefix: string;
  isQuotedPrefix: boolean;
};

type WalkEntry = {
  path: string;
  isDirectory: boolean;
};

function parsePathPrefix(prefix: string): ParsedPathPrefix {
  if (prefix.startsWith('@"')) {
    return { rawPrefix: prefix.slice(2), isQuotedPrefix: true };
  }

  return { rawPrefix: prefix.slice(1), isQuotedPrefix: false };
}

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    const expanded = path.join(homedir(), value.slice(2));
    return value.endsWith('/') && !expanded.endsWith('/') ? `${expanded}/` : expanded;
  }

  return value;
}

async function resolveScopedFuzzyQuery(
  rawQuery: string,
  cwd: string
): Promise<{ baseDir: string; query: string; displayBase: string; outsideCwd?: false } | { outsideCwd: true } | undefined> {
  const normalizedQuery = toDisplayPath(rawQuery);
  const slashIndex = normalizedQuery.lastIndexOf('/');

  if (slashIndex === -1) {
    return undefined;
  }

  const displayBase = normalizedQuery.slice(0, slashIndex + 1);
  const query = normalizedQuery.slice(slashIndex + 1);
  const baseDir = resolveScopedBaseDir(displayBase, cwd);

  if (!isPathInsidePath(baseDir, cwd)) {
    return { outsideCwd: true };
  }

  try {
    const baseStat = await stat(baseDir);

    if (!baseStat.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return { baseDir, query, displayBase };
}

function resolveScopedBaseDir(displayBase: string, cwd: string): string {
  if (displayBase.startsWith('~/')) {
    return path.resolve(expandHomePath(displayBase));
  }

  if (path.isAbsolute(displayBase)) {
    return path.resolve(displayBase);
  }

  return path.resolve(cwd, displayBase);
}

function isPathInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function scopedPathForDisplay(displayBase: string, relativePath: string): string {
  const normalizedRelativePath = toDisplayPath(relativePath);

  if (displayBase === '/') {
    return `/${normalizedRelativePath}`;
  }

  return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function getCachedDirectoryWalk(baseDir: string): Promise<WalkEntry[]> {
  const cacheKey = path.resolve(baseDir);
  const now = Date.now();

  for (const [key, cached] of walkCache) {
    if (cached.expiresAt <= now) {
      walkCache.delete(key);
    }
  }

  const cached = walkCache.get(cacheKey);
  if (cached) {
    return cached.promise;
  }

  const promise = walkDirectory(baseDir, maxWalkEntries);
  walkCache.set(cacheKey, { promise, expiresAt: now + walkCacheLifetimeMs });

  while (walkCache.size > maxCachedWalks) {
    const oldestKey = walkCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    walkCache.delete(oldestKey);
  }

  return promise;
}

async function walkDirectory(baseDir: string, maxEntries: number): Promise<WalkEntry[]> {
  const results: WalkEntry[] = [];
  const queue = [''];
  let queueIndex = 0;

  while (queueIndex < queue.length && results.length < maxEntries) {
    const relativeDir = queue[queueIndex] ?? '';
    queueIndex += 1;
    const absoluteDir = path.join(baseDir, relativeDir);
    let entries;

    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) {
        break;
      }

      if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
        continue;
      }

      const relativePath = toDisplayPath(path.join(relativeDir, entry.name));
      const isDirectory = entry.isDirectory();
      results.push({ path: isDirectory ? `${relativePath}/` : relativePath, isDirectory });

      if (isDirectory) {
        queue.push(path.join(relativeDir, entry.name));
      }
    }
  }

  return results;
}

function scoreEntry(filePath: string, lowerQuery: string, isDirectory: boolean): number {
  const normalizedPath = toDisplayPath(filePath);
  const fileName = path.basename(normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath);
  const lowerFileName = fileName.toLowerCase();
  const lowerPath = normalizedPath.toLowerCase();
  let score = 0;

  if (lowerFileName === lowerQuery) {
    score = 100;
  } else if (lowerFileName.startsWith(lowerQuery)) {
    score = 80;
  } else if (lowerFileName.includes(lowerQuery)) {
    score = 50;
  } else if (lowerPath.includes(lowerQuery)) {
    score = 30;
  }

  if (isDirectory && score > 0) {
    score += 10;
  }

  return score;
}

function buildCompletionValue(completionPath: string, options: { isAtPrefix: boolean; isQuotedPrefix: boolean }): string {
  const needsQuotes = options.isQuotedPrefix || completionPath.includes(' ');
  const prefix = options.isAtPrefix ? '@' : '';

  if (!needsQuotes) {
    return `${prefix}${completionPath}`;
  }

  return `${prefix}"${completionPath}"`;
}
