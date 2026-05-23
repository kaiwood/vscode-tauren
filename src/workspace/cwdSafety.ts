import * as path from 'node:path';

export type WorkspaceCwdState =
  | { status: 'pending'; reason: string }
  | { status: 'unsafe'; reason: string }
  | { status: 'ready'; cwd: string };

export function getWorkspaceCwdState(cwd: string | undefined): WorkspaceCwdState {
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

export function assertSafeWorkspaceCwd(cwd: string | undefined): string {
  const state = getWorkspaceCwdState(cwd);

  if (state.status !== 'ready') {
    throw new Error(`Tau cannot start Pi because ${state.reason}. Open a project folder and try again.`);
  }

  return state.cwd;
}

export function isSafeWorkspaceCwd(cwd: string | undefined): boolean {
  return getWorkspaceCwdState(cwd).status === 'ready';
}
