import * as os from 'node:os';
import * as path from 'node:path';

type WorkspaceCwdState =
  | { status: 'pending'; reason: string }
  | { status: 'unsafe'; reason: string }
  | { status: 'ready'; cwd: string };

export type PiStartupCwdState =
  | { status: 'blocked'; reason: string }
  | { status: 'ready'; cwd: string; source: 'workspace' | 'home' };

function getWorkspaceCwdState(cwd: string | undefined): WorkspaceCwdState {
  const trimmed = cwd?.trim();

  if (!trimmed) {
    return { status: 'pending', reason: 'no workspace folder is available yet' };
  }

  const resolved = path.resolve(trimmed);
  const root = path.parse(resolved).root;

  if (resolved === root) {
    return { status: 'unsafe', reason: `the workspace folder resolves to the filesystem root (${resolved})` };
  }

  return { status: 'ready', cwd: resolved };
}

export function getUnsafeCwdReason(cwd: string | undefined): string | undefined {
  const state = getWorkspaceCwdState(cwd);
  return state.status === 'unsafe' ? state.reason : undefined;
}

export function getPiStartupCwdState(cwd: string | undefined, rejectWithoutWorkspace: boolean): PiStartupCwdState {
  const workspaceState = getWorkspaceCwdState(cwd);

  if (workspaceState.status === 'ready') {
    return { status: 'ready', cwd: workspaceState.cwd, source: 'workspace' };
  }

  if (workspaceState.status === 'unsafe') {
    return { status: 'blocked', reason: workspaceState.reason };
  }

  if (rejectWithoutWorkspace) {
    return {
      status: 'blocked',
      reason: 'no workspace folder is available while tauren.rejectEditWriteOutsideWorkspace is enabled'
    };
  }

  const home = os.homedir().trim();

  if (!home) {
    return { status: 'blocked', reason: 'no workspace folder is available and the user home directory is unavailable' };
  }

  const resolvedHome = path.resolve(home);
  const root = path.parse(resolvedHome).root;

  if (resolvedHome === root) {
    return {
      status: 'blocked',
      reason: `no workspace folder is available and the user home directory resolves to the filesystem root (${resolvedHome})`
    };
  }

  return { status: 'ready', cwd: resolvedHome, source: 'home' };
}

export function assertPiStartupCwd(cwd: string | undefined, rejectWithoutWorkspace: boolean): string {
  const state = getPiStartupCwdState(cwd, rejectWithoutWorkspace);

  if (state.status !== 'ready') {
    throw new Error(`Tauren cannot start Pi engine because ${state.reason}. Open a project folder and try again.`);
  }

  return state.cwd;
}

export function isSafeWorkspaceCwd(cwd: string | undefined): boolean {
  return getWorkspaceCwdState(cwd).status === 'ready';
}
