import { promises as fs } from 'fs';

export type SessionDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type SessionDiffSnapshot = {
  stats?: SessionDiffStats;
};

export class SessionDiffTracker {
  private stats: SessionDiffStats = emptySessionDiffStats();

  public constructor(snapshot?: SessionDiffSnapshot) {
    this.restore(snapshot);
  }

  public getStats(): SessionDiffStats {
    return { ...this.stats };
  }

  public snapshot(): SessionDiffSnapshot {
    return { stats: this.getStats() };
  }

  public restore(snapshot: SessionDiffSnapshot | undefined): void {
    this.stats = normalizeStats(snapshot?.stats);
  }

  public addToolExecution(input: ToolExecutionInput): SessionDiffStats {
    const diff = getToolExecutionDiffStats(input);
    this.stats = addStats(this.stats, diff);
    return this.getStats();
  }

  public async restoreFromSessionFile(sessionFile: string | undefined): Promise<SessionDiffStats> {
    if (!sessionFile) {
      return this.getStats();
    }

    const parsed = await parseSessionDiffStatsFromFile(sessionFile);

    if (parsed) {
      this.stats = parsed;
    }

    return this.getStats();
  }
}

export type ToolExecutionInput = {
  toolName?: unknown;
  args?: unknown;
  isError?: unknown;
};

export function emptySessionDiffStats(): SessionDiffStats {
  return { addedLines: 0, removedLines: 0 };
}

export function getToolExecutionDiffStats(input: ToolExecutionInput): SessionDiffStats {
  if (input.isError === true || typeof input.toolName !== 'string' || !isRecord(input.args)) {
    return emptySessionDiffStats();
  }

  if (input.toolName === 'edit') {
    return getEditDiffStats(input.args);
  }

  if (input.toolName === 'write') {
    return getWriteDiffStats(input.args);
  }

  return emptySessionDiffStats();
}

export async function parseSessionDiffStatsFromFile(sessionFile: string): Promise<SessionDiffStats | undefined> {
  let content: string;

  try {
    content = await fs.readFile(sessionFile, 'utf8');
  } catch {
    return undefined;
  }

  return parseSessionDiffStats(content);
}

export function parseSessionDiffStats(content: string): SessionDiffStats {
  const toolExecutionStats: SessionDiffStats[] = [];
  const toolCallStats: SessionDiffStats[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as unknown;
      collectToolStats(record, toolExecutionStats, toolCallStats);
    } catch {
      // Ignore malformed session lines.
    }
  }

  return sumStats(toolExecutionStats.length > 0 ? toolExecutionStats : toolCallStats);
}

function collectToolStats(value: unknown, toolExecutionStats: SessionDiffStats[], toolCallStats: SessionDiffStats[]): void {
  if (!isRecord(value)) {
    return;
  }

  if (value.type === 'tool_execution_end') {
    const stats = getToolExecutionDiffStats(value);

    if (stats.addedLines > 0 || stats.removedLines > 0) {
      toolExecutionStats.push(stats);
    }
  }

  const message = isRecord(value.message) ? value.message : undefined;
  const content = message?.content ?? value.content;

  if (Array.isArray(content)) {
    for (const item of content) {
      const toolCall = getToolCallRecord(item);

      if (!toolCall) {
        continue;
      }

      const stats = getToolExecutionDiffStats({
        toolName: getRecordString(toolCall, 'name'),
        args: toolCall.arguments ?? toolCall.args
      });

      if (stats.addedLines > 0 || stats.removedLines > 0) {
        toolCallStats.push(stats);
      }
    }
  }
}

function getToolCallRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === 'toolCall') {
    return value;
  }

  if (isRecord(value.toolCall)) {
    return value.toolCall;
  }

  return undefined;
}

function getEditDiffStats(args: Record<string, unknown>): SessionDiffStats {
  const edits = args.edits;

  if (!Array.isArray(edits)) {
    return emptySessionDiffStats();
  }

  let addedLines = 0;
  let removedLines = 0;

  for (const edit of edits) {
    if (!isRecord(edit)) {
      continue;
    }

    const oldText = getRecordString(edit, 'oldText');
    const newText = getRecordString(edit, 'newText');

    if (oldText !== undefined) {
      removedLines += countLines(oldText);
    }

    if (newText !== undefined) {
      addedLines += countLines(newText);
    }
  }

  return { addedLines, removedLines };
}

function getWriteDiffStats(args: Record<string, unknown>): SessionDiffStats {
  const content = getRecordString(args, 'content') ?? getRecordString(args, 'text');
  return content === undefined
    ? emptySessionDiffStats()
    : { addedLines: countLines(content), removedLines: 0 };
}

function countLines(value: string): number {
  if (!value) {
    return 0;
  }

  const lineBreaks = value.match(/\n/g)?.length ?? 0;
  return value.endsWith('\n') ? lineBreaks : lineBreaks + 1;
}

function sumStats(stats: SessionDiffStats[]): SessionDiffStats {
  return stats.reduce(addStats, emptySessionDiffStats());
}

function addStats(left: SessionDiffStats, right: SessionDiffStats): SessionDiffStats {
  return {
    addedLines: left.addedLines + right.addedLines,
    removedLines: left.removedLines + right.removedLines
  };
}

function normalizeStats(value: unknown): SessionDiffStats {
  if (!isRecord(value)) {
    return emptySessionDiffStats();
  }

  return {
    addedLines: normalizeLineCount(value.addedLines),
    removedLines: normalizeLineCount(value.removedLines)
  };
}

function normalizeLineCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
