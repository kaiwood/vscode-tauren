import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { ReadyScriptProcess, RunReadyScriptOptions } from './types';

export function runReadyScript(
  scriptPath: string,
  cwd: string | undefined,
  options: RunReadyScriptOptions = {}
): boolean {
  const trimmedPath = scriptPath.trim();

  if (!trimmedPath) {
    return false;
  }

  const command = resolveReadyScriptPath(trimmedPath, cwd);
  let child: ReadyScriptProcess;

  try {
    child = (options.spawnFactory ?? spawn)(command, [], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        TAU_READY_CWD: cwd ?? '',
        TAU_READY_SCRIPT: command
      },
      stdio: 'ignore'
    });
  } catch (error) {
    options.onError?.(`Failed to run Tauren ready script: ${getErrorMessage(error)}`);
    return false;
  }

  child.once('error', (error) => {
    options.onError?.(`Failed to run Tauren ready script: ${error.message}`);
  });
  child.unref();

  return true;
}

export function resolveReadyScriptPath(scriptPath: string, cwd: string | undefined): string {
  const expandedPath = scriptPath === '~'
    ? homedir()
    : scriptPath.startsWith(`~${path.sep}`) || scriptPath.startsWith('~/')
      ? path.join(homedir(), scriptPath.slice(2))
      : scriptPath;

  if (path.isAbsolute(expandedPath)) {
    return path.normalize(expandedPath);
  }

  return path.resolve(cwd ?? process.cwd(), expandedPath);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
