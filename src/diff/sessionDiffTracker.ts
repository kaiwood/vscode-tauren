import { promises as fs } from 'fs';
import * as path from 'path';

export type SessionDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type SessionDiffSnapshot = {
  stats?: SessionDiffStats;
};

export type SessionFileDiff = {
  path: string;
  absolutePath: string;
  originalContent: string;
  modifiedContent: string;
};

export type SessionFileDiffsResult = {
  diffs: SessionFileDiff[];
  reconstructed: boolean;
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
  result?: unknown;
  isError?: unknown;
};

export function emptySessionDiffStats(): SessionDiffStats {
  return { addedLines: 0, removedLines: 0 };
}

export function getToolExecutionDiffStats(input: ToolExecutionInput): SessionDiffStats {
  if (input.isError === true || typeof input.toolName !== 'string') {
    return emptySessionDiffStats();
  }

  if (input.toolName === 'edit') {
    const resultStats = getToolResultDiffStats(input.result);

    if (resultStats) {
      return resultStats;
    }

    return isRecord(input.args) ? getEditDiffStats(input.args) : emptySessionDiffStats();
  }

  if (input.toolName === 'write') {
    const resultStats = getToolResultDiffStats(input.result);

    if (resultStats) {
      return resultStats;
    }

    return isRecord(input.args) ? getWriteDiffStats(input.args) : emptySessionDiffStats();
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

  return await parseSessionNetDiffStats(content) ?? parseSessionDiffStats(content);
}

export async function parseSessionFileDiffsFromFile(sessionFile: string): Promise<SessionFileDiff[] | undefined> {
  let content: string;

  try {
    content = await fs.readFile(sessionFile, 'utf8');
  } catch {
    return undefined;
  }

  return parseSessionFileDiffs(content);
}

export async function parseSessionBestEffortFileDiffsFromFile(sessionFile: string): Promise<SessionFileDiffsResult | undefined> {
  let content: string;

  try {
    content = await fs.readFile(sessionFile, 'utf8');
  } catch {
    return undefined;
  }

  const reconstructedDiffs = await parseSessionFileDiffs(content);

  if (reconstructedDiffs !== undefined) {
    return { diffs: reconstructedDiffs, reconstructed: true };
  }

  return { diffs: parseSessionMutationFileDiffs(content), reconstructed: false };
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

type FileMutation =
  | { toolName: 'edit'; path: string; edits: Array<{ oldText: string; newText: string }> }
  | { toolName: 'write'; path: string; content: string };

export async function parseSessionFileDiffs(content: string): Promise<SessionFileDiff[] | undefined> {
  const { cwd, mutations } = parseSessionMutationHistory(content);

  if (mutations.length === 0) {
    return [];
  }

  if (!cwd) {
    return undefined;
  }

  return computeSessionFileDiffs(cwd, mutations);
}

export function parseSessionMutationFileDiffs(content: string): SessionFileDiff[] {
  const { cwd, mutations } = parseSessionMutationHistory(content);
  return computeSyntheticSessionFileDiffs(cwd, mutations);
}

async function parseSessionNetDiffStats(content: string): Promise<SessionDiffStats | undefined> {
  const { cwd, mutations } = parseSessionMutationHistory(content);

  if (!cwd || mutations.length === 0) {
    return undefined;
  }

  const fileDiffs = await computeSessionFileDiffs(cwd, mutations);
  return fileDiffs === undefined ? undefined : sumStats(fileDiffs.map((diff) => getLineDiffStats(diff.originalContent, diff.modifiedContent)));
}

function parseSessionMutationHistory(content: string): { cwd: string | undefined; mutations: FileMutation[] } {
  const executionMutations: FileMutation[] = [];
  const toolCallMutations: FileMutation[] = [];
  let cwd: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as unknown;

      if (isRecord(record) && record.type === 'session') {
        cwd = getRecordString(record, 'cwd') ?? cwd;
      }

      collectToolMutations(record, executionMutations, toolCallMutations);
    } catch {
      // Ignore malformed session lines.
    }
  }

  return {
    cwd,
    mutations: executionMutations.length > 0 ? executionMutations : toolCallMutations
  };
}

function collectToolMutations(value: unknown, executionMutations: FileMutation[], toolCallMutations: FileMutation[]): void {
  if (!isRecord(value)) {
    return;
  }

  if (value.type === 'tool_execution_end') {
    const mutation = getFileMutation(getRecordString(value, 'toolName'), value.args);

    if (mutation) {
      executionMutations.push(mutation);
    }
  }

  const message = isRecord(value.message) ? value.message : undefined;
  const content = message?.content ?? value.content;

  if (!Array.isArray(content)) {
    return;
  }

  for (const item of content) {
    const toolCall = getToolCallRecord(item);

    if (!toolCall) {
      continue;
    }

    const mutation = getFileMutation(getRecordString(toolCall, 'name'), toolCall.arguments ?? toolCall.args);

    if (mutation) {
      toolCallMutations.push(mutation);
    }
  }
}

function getFileMutation(toolName: string | undefined, args: unknown): FileMutation | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const filePath = getRecordString(args, 'path') ?? getRecordString(args, 'file_path');

  if (!filePath) {
    return undefined;
  }

  if (toolName === 'edit') {
    const edits = getEditMutations(args.edits);
    return edits.length > 0 ? { toolName, path: filePath, edits } : undefined;
  }

  if (toolName === 'write') {
    const content = getRecordString(args, 'content') ?? getRecordString(args, 'text');
    return content === undefined ? undefined : { toolName, path: filePath, content };
  }

  return undefined;
}

function getEditMutations(value: unknown): Array<{ oldText: string; newText: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const edits: Array<{ oldText: string; newText: string }> = [];

  for (const edit of value) {
    if (!isRecord(edit)) {
      continue;
    }

    const oldText = getRecordString(edit, 'oldText');
    const newText = getRecordString(edit, 'newText');

    if (oldText !== undefined && newText !== undefined) {
      edits.push({ oldText, newText });
    }
  }

  return edits;
}

async function computeSessionFileDiffs(cwd: string, mutations: FileMutation[]): Promise<SessionFileDiff[] | undefined> {
  const mutationsByPath = new Map<string, FileMutation[]>();

  for (const mutation of mutations) {
    const existing = mutationsByPath.get(mutation.path);

    if (existing) {
      existing.push(mutation);
    } else {
      mutationsByPath.set(mutation.path, [mutation]);
    }
  }

  const fileDiffs: SessionFileDiff[] = [];

  for (const [filePath, fileMutations] of mutationsByPath) {
    const absolutePath = path.resolve(cwd, filePath);
    const currentContent = await readCurrentFileContent(cwd, filePath);

    if (currentContent === undefined) {
      return undefined;
    }

    const baselineContent = reverseFileMutations(currentContent, fileMutations);

    if (baselineContent === undefined) {
      return undefined;
    }

    if (baselineContent !== currentContent) {
      fileDiffs.push({
        path: filePath,
        absolutePath,
        originalContent: baselineContent,
        modifiedContent: currentContent
      });
    }
  }

  return fileDiffs;
}

function computeSyntheticSessionFileDiffs(cwd: string | undefined, mutations: FileMutation[]): SessionFileDiff[] {
  const fileDiffs = new Map<string, { originalParts: string[]; modifiedParts: string[]; editCount: number }>();

  for (const mutation of mutations) {
    const diff = fileDiffs.get(mutation.path) ?? { originalParts: [], modifiedParts: [], editCount: 0 };
    diff.editCount += 1;

    if (mutation.toolName === 'write') {
      appendSyntheticSnippet(diff.originalParts, '');
      appendSyntheticSnippet(diff.modifiedParts, mutation.content);
    } else {
      for (const edit of mutation.edits) {
        appendSyntheticSnippet(diff.originalParts, edit.oldText);
        appendSyntheticSnippet(diff.modifiedParts, edit.newText);
      }
    }

    fileDiffs.set(mutation.path, diff);
  }

  const result: SessionFileDiff[] = [];

  for (const [filePath, diff] of fileDiffs) {
    const originalContent = diff.originalParts.join('');
    const modifiedContent = diff.modifiedParts.join('');

    if (originalContent === modifiedContent) {
      continue;
    }

    result.push({
      path: filePath,
      absolutePath: cwd ? path.resolve(cwd, filePath) : path.resolve('/', filePath),
      originalContent,
      modifiedContent
    });
  }

  return result;
}

function appendSyntheticSnippet(parts: string[], text: string): void {
  if (!text) {
    return;
  }

  parts.push(text.endsWith('\n') ? text : `${text}\n`);
}

async function readCurrentFileContent(cwd: string, filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.resolve(cwd, filePath), 'utf8');
  } catch {
    return undefined;
  }
}

function reverseFileMutations(currentContent: string, mutations: FileMutation[]): string | undefined {
  let content = currentContent;

  for (const mutation of [...mutations].reverse()) {
    if (mutation.toolName === 'write') {
      content = '';
      continue;
    }

    for (const edit of [...mutation.edits].reverse()) {
      const replaced = replaceUnique(content, edit.newText, edit.oldText);

      if (replaced === undefined) {
        return undefined;
      }

      content = replaced;
    }
  }

  return content;
}

function replaceUnique(value: string, oldText: string, newText: string): string | undefined {
  const index = value.indexOf(oldText);

  if (index === -1 || value.indexOf(oldText, index + oldText.length) !== -1) {
    return undefined;
  }

  return `${value.slice(0, index)}${newText}${value.slice(index + oldText.length)}`;
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

    if (oldText === undefined || newText === undefined) {
      continue;
    }

    const stats = getLineDiffStats(oldText, newText);
    addedLines += stats.addedLines;
    removedLines += stats.removedLines;
  }

  return { addedLines, removedLines };
}

function getWriteDiffStats(args: Record<string, unknown>): SessionDiffStats {
  const content = getRecordString(args, 'content') ?? getRecordString(args, 'text');
  return content === undefined
    ? emptySessionDiffStats()
    : { addedLines: countLines(content), removedLines: 0 };
}

function getToolResultDiffStats(result: unknown): SessionDiffStats | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  const details = isRecord(result.details) ? result.details : undefined;
  const diff = getRecordString(details ?? result, 'diff');
  return diff === undefined ? undefined : parseUnifiedDiffStats(diff);
}

function parseUnifiedDiffStats(diff: string): SessionDiffStats {
  let addedLines = 0;
  let removedLines = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }

    if (line.startsWith('+')) {
      addedLines += 1;
    } else if (line.startsWith('-')) {
      removedLines += 1;
    }
  }

  return { addedLines, removedLines };
}

function getLineDiffStats(oldText: string, newText: string): SessionDiffStats {
  const oldLines = splitLinesForDiff(oldText);
  const newLines = splitLinesForDiff(newText);
  const commonLines = getLongestCommonSubsequenceLength(oldLines, newLines);

  return {
    addedLines: newLines.length - commonLines,
    removedLines: oldLines.length - commonLines
  };
}

function splitLinesForDiff(value: string): string[] {
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  if (normalized.endsWith('\n')) {
    lines.pop();
  }

  return lines;
}

function getLongestCommonSubsequenceLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);

  for (const leftLine of left) {
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = leftLine === right[column - 1]
        ? previous[column - 1] + 1
        : Math.max(previous[column], current[column - 1]);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  return previous[right.length];
}

function countLines(value: string): number {
  return splitLinesForDiff(value).length;
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
