import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const maxGitOutputBuffer = 10 * 1024 * 1024;
const maxUntrackedFileBytes = 5 * 1024 * 1024;

export type WorkspaceDiffStats = {
  addedLines: number;
  removedLines: number;
};

export async function getWorkspaceDiffStats(cwd: string | undefined): Promise<WorkspaceDiffStats> {
  if (!cwd) {
    return emptyWorkspaceDiffStats();
  }

  const [numstat, untrackedFiles] = await Promise.all([
    getGitDiffNumstat(cwd).catch(() => ''),
    getUntrackedFiles(cwd).catch(() => [])
  ]);
  const trackedStats = parseGitNumstat(numstat);
  const untrackedAddedLines = await countUntrackedFileLines(cwd, untrackedFiles);

  return {
    addedLines: trackedStats.addedLines + untrackedAddedLines,
    removedLines: trackedStats.removedLines
  };
}

export function parseGitNumstat(output: string): WorkspaceDiffStats {
  const stats = emptyWorkspaceDiffStats();

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [added, removed] = line.split('\t');

    if (!isIntegerText(added) || !isIntegerText(removed)) {
      continue;
    }

    stats.addedLines += Number(added);
    stats.removedLines += Number(removed);
  }

  return stats;
}

export function emptyWorkspaceDiffStats(): WorkspaceDiffStats {
  return { addedLines: 0, removedLines: 0 };
}

async function getGitDiffNumstat(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', '--numstat', 'HEAD', '--', '.'], {
    cwd,
    maxBuffer: maxGitOutputBuffer
  });

  return stdout;
}

async function getUntrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd,
    maxBuffer: maxGitOutputBuffer
  });

  return stdout.split('\0').filter(Boolean);
}

async function countUntrackedFileLines(cwd: string, files: string[]): Promise<number> {
  let total = 0;

  for (const file of files) {
    total += await countTextFileLines(path.resolve(cwd, file));
  }

  return total;
}

async function countTextFileLines(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);

    if (!stat.isFile() || stat.size > maxUntrackedFileBytes) {
      return 0;
    }

    const buffer = await fs.readFile(filePath);

    if (buffer.includes(0)) {
      return 0;
    }

    return countLines(buffer.toString('utf8'));
  } catch {
    return 0;
  }
}

function countLines(value: string): number {
  if (!value) {
    return 0;
  }

  const lineBreaks = value.match(/\n/g)?.length ?? 0;
  return value.endsWith('\n') ? lineBreaks : lineBreaks + 1;
}

function isIntegerText(value: string | undefined): boolean {
  return typeof value === 'string' && /^\d+$/.test(value);
}
