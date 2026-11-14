import { listKwardSessionCandidates } from '../kward/sessionList';
import { listPiSessionCandidates } from '../sessions/piSessionList';
import {
  traceOrigin as scanSessionOrigins,
  type TraceOriginInput,
  type TraceOriginMatch
} from '@tauren/shared/sessions/sessionOriginTracer';

export type { TraceOriginInput, TraceOriginMatch } from '@tauren/shared/sessions/sessionOriginTracer';

export type TraceOriginOptions = {
  backend?: 'pi' | 'kward';
  cwd?: string;
  currentSessionFile?: string;
  kwardPath?: string;
  sessionFiles?: string[];
};

type SessionCandidate = {
  path: string;
  id?: string;
  cwd?: string;
};

export async function traceOrigin(
  inputs: TraceOriginInput[],
  options: TraceOriginOptions = {}
): Promise<TraceOriginMatch | undefined> {
  // Preserve the no-discovery fast path for empty or invalid inputs.
  if (!inputs.some((input) => input.path.trim() && (input.kind !== 'selection' || input.text?.trim()))) {
    return undefined;
  }

  const sessions = await getSessionCandidates(options);
  return scanSessionOrigins(inputs, {
    sessionFiles: sessions.map((session) => session.path),
    sessionMetadata: new Map(sessions.map((session) => [session.path, session]))
  });
}

async function getSessionCandidates(options: TraceOriginOptions): Promise<SessionCandidate[]> {
  if (options.sessionFiles) {
    return dedupeSessions(options.sessionFiles.map((sessionPath) => ({ path: sessionPath })));
  }

  const sessions = options.backend === 'kward'
    ? await listKwardSessionCandidates({
      cwd: options.cwd,
      currentSessionFile: options.currentSessionFile,
      kwardPath: options.kwardPath
    })
    : await listPiSessionCandidates({ cwd: options.cwd, currentSessionFile: options.currentSessionFile });

  return dedupeSessions(sessions.map((session) => ({
    path: session.path,
    id: session.id,
    cwd: session.cwd
  })));
}

function dedupeSessions(sessions: SessionCandidate[]): SessionCandidate[] {
  const result: SessionCandidate[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    const normalizedPath = normalizePath(session.path);

    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    result.push(session);
  }

  return result;
}

function normalizePath(value: string | undefined): string {
  return (value ?? '').replace(/\\/g, '/');
}
