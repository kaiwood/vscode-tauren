import { existsSync } from 'fs';
import * as path from 'path';
import { listKwardSessionCandidates } from '../kward/sessionList';
import { parseJsonlFileRecords } from '../shared/jsonl';
import { listPiSessionCandidates } from '../sessions/piSessionList';
import { isRecord } from '../shared/typeGuards';

export type TraceOriginInput = {
  kind: 'file' | 'selection';
  path: string;
  absolutePath?: string;
  text?: string;
};

export type TraceOriginMatch = {
  sessionPath: string;
  sessionId?: string;
  sessionCwd?: string;
  timestamp?: string;
  sessionEndedAt?: string;
  recordId?: string;
  toolName: 'edit' | 'write';
  filePath: string;
};

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

type ParsedToolCall = {
  toolName: 'edit' | 'write';
  args: Record<string, unknown>;
  recordId?: string;
  timestampMs: number;
  timestamp?: string;
};

type TraceOriginMatchWithTimestamp = TraceOriginMatch & { timestampMs: number };

type TraceOriginScanResult = {
  pathScoped?: TraceOriginMatchWithTimestamp;
  contentOnly?: TraceOriginMatchWithTimestamp;
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
  const earliest = pickTraceOriginResult(await traceOriginInSessions(sessions, normalizedInputs));

  if (!earliest) {
    return undefined;
  }

  const { timestampMs: _timestampMs, ...result } = earliest;
  return result;
}

async function traceOriginInSessions(
  sessions: SessionCandidate[],
  inputs: TraceOriginInput[]
): Promise<TraceOriginScanResult> {
  if (sessions.length === 0 || inputs.length === 0) {
    return {};
  }

  const selectionInputs = inputs.filter((input) => input.kind === 'selection');
  const result: TraceOriginScanResult = {};

  for (const session of sessions) {
    mergeTraceOriginResult(result, await traceOriginInSession(session, inputs, selectionInputs));
  }

  return result;
}

function pickTraceOriginResult(result: TraceOriginScanResult): TraceOriginMatchWithTimestamp | undefined {
  return result.pathScoped ?? result.contentOnly;
}

function mergeTraceOriginResult(target: TraceOriginScanResult, source: TraceOriginScanResult | undefined): void {
  if (!source) {
    return;
  }

  target.pathScoped = getEarlierTraceOriginMatch(target.pathScoped, source.pathScoped);
  target.contentOnly = getEarlierTraceOriginMatch(target.contentOnly, source.contentOnly);
}

function getEarlierTraceOriginMatch(
  current: TraceOriginMatchWithTimestamp | undefined,
  candidate: TraceOriginMatchWithTimestamp | undefined
): TraceOriginMatchWithTimestamp | undefined {
  if (!candidate) {
    return current;
  }

  return !current || candidate.timestampMs < current.timestampMs ? candidate : current;
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

async function traceOriginInSession(
  session: SessionCandidate,
  inputs: TraceOriginInput[],
  selectionInputs: TraceOriginInput[]
): Promise<TraceOriginScanResult | undefined> {
  let sessionCwd: string | undefined;
  let sessionId = session.id;
  let sessionEndedAtMs = Number.NEGATIVE_INFINITY;
  const result: TraceOriginScanResult = {};

  try {
    for await (const record of parseJsonlFileRecords(session.path)) {
      if (!isRecord(record)) {
        continue;
      }

      const recordTimestamp = getRecordTimestamp(record);

      if (Number.isFinite(recordTimestamp.timestampMs) && recordTimestamp.timestampMs > sessionEndedAtMs) {
        sessionEndedAtMs = recordTimestamp.timestampMs;
      }

      if (record.type === 'session') {
        sessionCwd = getString(record.cwd) ?? session.cwd ?? sessionCwd;
        sessionId = getString(record.id) ?? sessionId;

        if (sessionCwd && !existsSync(sessionCwd)) {
          return undefined;
        }
      }

      for (const toolCall of getMutationToolCalls(record)) {
        const filePath = getString(toolCall.args.path) ?? getString(toolCall.args.file_path);

        if (!filePath) {
          continue;
        }

        const pathScoped = inputs.some((input) => toolCallMatchesInput(
          toolCall,
          filePath,
          input,
          sessionCwd,
          { allowContentOnly: false }
        ));
        const contentOnly = selectionInputs.length > 0 && selectionInputs.some((input) => toolCallMatchesInput(
          toolCall,
          filePath,
          input,
          sessionCwd,
          { allowContentOnly: true }
        ));

        if (!pathScoped && !contentOnly) {
          continue;
        }

        const match = {
          sessionPath: session.path,
          sessionId,
          sessionCwd,
          timestamp: toolCall.timestamp,
          recordId: toolCall.recordId,
          timestampMs: toolCall.timestampMs,
          toolName: toolCall.toolName,
          filePath
        };

        if (pathScoped) {
          result.pathScoped = getEarlierTraceOriginMatch(result.pathScoped, match);
        }

        if (contentOnly) {
          result.contentOnly = getEarlierTraceOriginMatch(result.contentOnly, match);
        }
      }
    }
  } catch {
    return undefined;
  }

  if (!result.pathScoped && !result.contentOnly) {
    return undefined;
  }

  if (Number.isFinite(sessionEndedAtMs)) {
    const sessionEndedAt = new Date(sessionEndedAtMs).toISOString();

    if (result.pathScoped) {
      result.pathScoped = { ...result.pathScoped, sessionEndedAt };
    }

    if (result.contentOnly) {
      result.contentOnly = { ...result.contentOnly, sessionEndedAt };
    }
  }

  return result;
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
  sessionCwd: string | undefined,
  options: { allowContentOnly: boolean }
): boolean {
  const pathMatches = pathsMatch(filePath, input.path, input.absolutePath, sessionCwd);

  if (!pathMatches && (!options.allowContentOnly || input.kind !== 'selection')) {
    return false;
  }

  if (input.kind === 'file') {
    return pathMatches;
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
