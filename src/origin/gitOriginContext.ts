import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import type { PiPromptTraceOriginLinkedCommit } from '../prompt/types';

const execFileAsync = promisify(execFile);
const maxCommitBodyLength = 2000;
const logRecordSeparator = '\x1e';
const logFieldSeparator = '\x1f';

export type FindTraceLinkedGitCommitInput = {
  cwd?: string;
  sessionCwd?: string;
  historicalPath: string;
  currentRelativePath: string;
  after?: string;
  runner?: GitCommandRunner;
};

export type FindCurrentPathGitCommitInput = {
  cwd?: string;
  currentRelativePath: string;
  runner?: GitCommandRunner;
};

export type GitCommandRunner = (args: string[], cwd: string) => Promise<string>;

export async function findCurrentPathGitCommit(
  input: FindCurrentPathGitCommitInput
): Promise<PiPromptTraceOriginLinkedCommit | undefined> {
  const cwd = input.cwd;

  if (!cwd) {
    return undefined;
  }

  const runner = input.runner ?? runGit;
  const repoRoot = await getRepoRoot(runner, cwd);

  if (!repoRoot) {
    return undefined;
  }

  const pathspecs = getTraceOriginPathspecs({
    cwd,
    historicalPath: input.currentRelativePath,
    currentRelativePath: input.currentRelativePath
  }, repoRoot);

  if (pathspecs.length === 0) {
    return undefined;
  }

  const commit = await getLatestPathCommit(runner, repoRoot, pathspecs);

  if (!commit) {
    return undefined;
  }

  const touchedPaths = await getTouchedPaths(runner, repoRoot, commit.sha, pathspecs);

  if (touchedPaths.length === 0) {
    return undefined;
  }

  return createTraceLinkedCommit(commit, touchedPaths);
}

export async function findTraceLinkedGitCommit(
  input: FindTraceLinkedGitCommitInput
): Promise<PiPromptTraceOriginLinkedCommit | undefined> {
  const after = normalizeAfter(input.after);
  const cwd = input.sessionCwd || input.cwd;

  if (!after || !cwd) {
    return undefined;
  }

  const runner = input.runner ?? runGit;
  const repoRoot = await getRepoRoot(runner, cwd);

  if (!repoRoot) {
    return undefined;
  }

  const pathspecs = getTraceOriginPathspecs(input, repoRoot);

  if (pathspecs.length === 0) {
    return undefined;
  }

  const commit = await getFirstPostTraceCommit(runner, repoRoot, after, pathspecs);

  if (!commit) {
    return undefined;
  }

  const touchedPaths = await getTouchedPaths(runner, repoRoot, commit.sha, pathspecs);

  if (touchedPaths.length === 0) {
    return undefined;
  }

  return createTraceLinkedCommit(commit, touchedPaths);
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024
  });
  return stdout;
}

async function getRepoRoot(runner: GitCommandRunner, cwd: string): Promise<string | undefined> {
  try {
    const output = await runner(['rev-parse', '--show-toplevel'], cwd);
    const repoRoot = output.trim();
    return repoRoot ? repoRoot : undefined;
  } catch {
    return undefined;
  }
}

async function getFirstPostTraceCommit(
  runner: GitCommandRunner,
  repoRoot: string,
  after: string,
  pathspecs: string[]
): Promise<ParsedGitCommit | undefined> {
  return getGitLogCommit(runner, repoRoot, [
    `--after=${after}`,
    '--reverse'
  ], pathspecs);
}

async function getLatestPathCommit(
  runner: GitCommandRunner,
  repoRoot: string,
  pathspecs: string[]
): Promise<ParsedGitCommit | undefined> {
  return getGitLogCommit(runner, repoRoot, ['-1'], pathspecs);
}

async function getGitLogCommit(
  runner: GitCommandRunner,
  repoRoot: string,
  logOptions: string[],
  pathspecs: string[]
): Promise<ParsedGitCommit | undefined> {
  const format = `%H${logFieldSeparator}%h${logFieldSeparator}%cI${logFieldSeparator}%aI${logFieldSeparator}%s${logFieldSeparator}%b${logRecordSeparator}`;

  try {
    const output = await runner([
      'log',
      ...logOptions,
      `--format=${format}`,
      '--',
      ...pathspecs
    ], repoRoot);
    return parseFirstGitCommit(output);
  } catch {
    return undefined;
  }
}

async function getTouchedPaths(
  runner: GitCommandRunner,
  repoRoot: string,
  sha: string,
  pathspecs: string[]
): Promise<string[]> {
  try {
    const output = await runner([
      'show',
      '--format=',
      '--name-only',
      '--no-renames',
      sha,
      '--',
      ...pathspecs
    ], repoRoot);
    return dedupe(output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0));
  } catch {
    return [];
  }
}

type ParsedGitCommit = {
  sha: string;
  shortSha: string;
  commitDate?: string;
  authorDate?: string;
  subject: string;
  body?: string;
};

function parseFirstGitCommit(output: string): ParsedGitCommit | undefined {
  const record = output.split(logRecordSeparator).find((entry) => entry.trim());

  if (!record) {
    return undefined;
  }

  const [sha, shortSha, commitDate, authorDate, subject, body = ''] = record.split(logFieldSeparator);

  if (!sha?.trim() || !shortSha?.trim() || !subject?.trim()) {
    return undefined;
  }

  const normalizedBody = truncate(body.trim(), maxCommitBodyLength);

  return {
    sha: sha.trim(),
    shortSha: shortSha.trim(),
    ...(normalizeAfter(commitDate) ? { commitDate: normalizeAfter(commitDate) } : {}),
    ...(normalizeAfter(authorDate) ? { authorDate: normalizeAfter(authorDate) } : {}),
    subject: subject.trim(),
    ...(normalizedBody ? { body: normalizedBody } : {})
  };
}

function createTraceLinkedCommit(
  commit: ParsedGitCommit,
  touchedPaths: string[]
): PiPromptTraceOriginLinkedCommit {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    ...(commit.body ? { body: commit.body } : {}),
    ...(commit.authorDate ? { authorDate: commit.authorDate } : {}),
    ...(commit.commitDate ? { commitDate: commit.commitDate } : {}),
    touchedTracedPath: true,
    touchedPaths,
    relation: 'commit_touches_traced_path',
    confidence: 'high'
  };
}

function getTraceOriginPathspecs(input: FindTraceLinkedGitCommitInput, repoRoot: string): string[] {
  const baseCwds = dedupe([
    input.sessionCwd,
    input.cwd,
    repoRoot
  ].flatMap((value) => value ? [value] : []));
  const candidates = [input.historicalPath, input.currentRelativePath];
  const pathspecs: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      continue;
    }

    if (path.isAbsolute(trimmed)) {
      addPathspec(pathspecs, repoRelativePath(repoRoot, trimmed));
      continue;
    }

    addPathspec(pathspecs, normalizePath(trimmed));

    for (const baseCwd of baseCwds) {
      addPathspec(pathspecs, repoRelativePath(repoRoot, path.resolve(baseCwd, trimmed)));
    }
  }

  return dedupe(pathspecs);
}

function addPathspec(pathspecs: string[], pathspec: string | undefined): void {
  if (pathspec && isRepoRelativePathspec(pathspec)) {
    pathspecs.push(pathspec);
  }
}

function repoRelativePath(repoRoot: string, absolutePath: string): string | undefined {
  const relativePath = normalizePath(path.relative(repoRoot, absolutePath));

  if (!relativePath || relativePath === '.' || relativePath.startsWith('../') || relativePath === '..') {
    return undefined;
  }

  return relativePath;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isRepoRelativePathspec(value: string): boolean {
  const normalized = normalizePath(value);
  return normalized !== '..' && !normalized.startsWith('../') && !path.isAbsolute(normalized);
}

function normalizeAfter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function dedupe(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizePath(value.trim());

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
