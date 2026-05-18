import { readFile } from 'fs/promises';
import * as path from 'path';
import { listPiSessions } from '../sessions/piSessionList';

export type TraceOriginInput = {
  kind: 'file' | 'selection';
  path: string;
  absolutePath?: string;
  text?: string;
};

export type TraceOriginMatch = {
  sessionPath: string;
  sessionId?: string;
  timestamp?: string;
  recordId?: string;
  toolName: 'edit' | 'write';
  filePath: string;
};

export type TraceOriginOptions = {
  cwd?: string;
  currentSessionFile?: string;
  sessionFiles?: string[];
};

type SessionCandidate = {
  path: string;
  id?: string;
};

type ParsedToolCall = {
  toolName: 'edit' | 'write';
  args: Record<string, unknown>;
  recordId?: string;
  timestampMs: number;
  timestamp?: string;
};

export async function traceOrigin(
  inputs: TraceOriginInput[],
  options: TraceOriginOptions = {}
): Promise<TraceOriginMatch | undefined> {
  const normalizedInputs = inputs
    .map(normalizeInput)
    .filter((input): input is TraceOriginInput => Boolean(input));

  if (normalizedInputs.length === 0) {
    return undefined;
  }

  const sessions = await getSessionCandidates(options);
  let earliest: (TraceOriginMatch & { timestampMs: number }) | undefined;

  for (const session of sessions) {
    const match = await traceOriginInSession(session, normalizedInputs);

    if (!match) {
      continue;
    }

    if (!earliest || match.timestampMs < earliest.timestampMs) {
      earliest = match;
    }
  }

  if (!earliest) {
    return undefined;
  }

  const { timestampMs: _timestampMs, ...result } = earliest;
  return result;
}

async function getSessionCandidates(options: TraceOriginOptions): Promise<SessionCandidate[]> {
  if (options.sessionFiles) {
    return dedupeSessions(options.sessionFiles.map((sessionPath) => ({ path: sessionPath })));
  }

  const [projectSessions, allSessions] = await Promise.all([
    listPiSessions({ cwd: options.cwd, currentSessionFile: options.currentSessionFile }),
    listPiSessions({ env: {} })
  ]);

  return dedupeSessions([...projectSessions, ...allSessions].map((session) => ({
    path: session.path,
    id: session.id
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

async function traceOriginInSession(
  session: SessionCandidate,
  inputs: TraceOriginInput[]
): Promise<(TraceOriginMatch & { timestampMs: number }) | undefined> {
  let content: string;

  try {
    content = await readFile(session.path, 'utf8');
  } catch {
    return undefined;
  }

  let sessionCwd: string | undefined;
  let sessionId = session.id;
  let earliest: (TraceOriginMatch & { timestampMs: number }) | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    let record: unknown;

    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(record)) {
      continue;
    }

    if (record.type === 'session') {
      sessionCwd = getString(record.cwd) ?? sessionCwd;
      sessionId = getString(record.id) ?? sessionId;
    }

    for (const toolCall of getMutationToolCalls(record)) {
      const filePath = getString(toolCall.args.path) ?? getString(toolCall.args.file_path);

      if (!filePath) {
        continue;
      }

      if (!inputs.some((input) => toolCallMatchesInput(toolCall, filePath, input, sessionCwd))) {
        continue;
      }

      const match = {
        sessionPath: session.path,
        sessionId,
        timestamp: toolCall.timestamp,
        recordId: toolCall.recordId,
        timestampMs: toolCall.timestampMs,
        toolName: toolCall.toolName,
        filePath
      };

      if (!earliest || match.timestampMs < earliest.timestampMs) {
        earliest = match;
      }
    }
  }

  return earliest;
}

function getMutationToolCalls(record: Record<string, unknown>): ParsedToolCall[] {
  const timestamp = getRecordTimestamp(record);
  const recordId = getString(record.id);

  if (record.type === 'tool_execution_end') {
    const toolName = getMutationToolName(getString(record.toolName));
    return toolName && isRecord(record.args)
      ? [{ toolName, args: record.args, recordId, ...timestamp }]
      : [];
  }

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  const toolCalls: ParsedToolCall[] = [];

  for (const item of content) {
    if (!isRecord(item) || item.type !== 'toolCall') {
      continue;
    }

    const toolName = getMutationToolName(getString(item.name));
    const args = isRecord(item.arguments) ? item.arguments : isRecord(item.args) ? item.args : undefined;

    if (toolName && args) {
      toolCalls.push({
        toolName,
        args,
        recordId: getString(item.id) ?? recordId,
        ...timestamp
      });
    }
  }

  return toolCalls;
}

function toolCallMatchesInput(
  toolCall: ParsedToolCall,
  filePath: string,
  input: TraceOriginInput,
  sessionCwd: string | undefined
): boolean {
  if (!pathsMatch(filePath, input.path, input.absolutePath, sessionCwd)) {
    return false;
  }

  if (input.kind === 'file') {
    return true;
  }

  const needle = normalizeText(input.text ?? '');

  if (!needle.trim()) {
    return false;
  }

  if (toolCall.toolName === 'write') {
    const content = getString(toolCall.args.content) ?? getString(toolCall.args.text);
    return contentMatches(content, needle);
  }

  const edits = Array.isArray(toolCall.args.edits) ? toolCall.args.edits : [];

  return edits.some((edit) => {
    if (!isRecord(edit)) {
      return false;
    }

    return contentMatches(getString(edit.newText), needle);
  });
}

function pathsMatch(
  recordedPath: string,
  targetPath: string,
  targetAbsolutePath: string | undefined,
  sessionCwd: string | undefined
): boolean {
  const recorded = normalizePath(recordedPath);
  const target = normalizePath(targetPath);

  if (recorded === target) {
    return true;
  }

  if (targetAbsolutePath) {
    const targetAbsolute = normalizePath(targetAbsolutePath);

    if (path.isAbsolute(recordedPath) && normalizePath(recordedPath) === targetAbsolute) {
      return true;
    }

    if (sessionCwd && normalizePath(path.resolve(sessionCwd, recordedPath)) === targetAbsolute) {
      return true;
    }
  }

  return false;
}

function contentMatches(content: string | undefined, needle: string): boolean {
  if (content === undefined) {
    return false;
  }

  const haystack = normalizeText(content);
  return haystack.includes(needle) || Boolean(needle.trim() && haystack.includes(needle.trim()));
}

function getRecordTimestamp(record: Record<string, unknown>): { timestampMs: number; timestamp?: string } {
  const timestamp = getString(record.timestamp);

  if (timestamp) {
    const timestampMs = Date.parse(timestamp);

    if (Number.isFinite(timestampMs)) {
      return { timestampMs, timestamp };
    }
  }

  const message = isRecord(record.message) ? record.message : undefined;
  const messageTimestamp = message?.timestamp;

  if (typeof messageTimestamp === 'number' && Number.isFinite(messageTimestamp)) {
    return { timestampMs: messageTimestamp, timestamp: new Date(messageTimestamp).toISOString() };
  }

  return { timestampMs: Number.MAX_SAFE_INTEGER };
}

function normalizeInput(input: TraceOriginInput): TraceOriginInput | undefined {
  const normalizedPath = input.path.trim();

  if (!normalizedPath) {
    return undefined;
  }

  if (input.kind === 'selection' && !input.text?.trim()) {
    return undefined;
  }

  return {
    ...input,
    path: normalizedPath,
    absolutePath: input.absolutePath?.trim()
  };
}

function getMutationToolName(value: string | undefined): 'edit' | 'write' | undefined {
  return value === 'edit' || value === 'write' ? value : undefined;
}

function normalizePath(value: string | undefined): string {
  return (value ?? '').replace(/\\/g, '/');
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
