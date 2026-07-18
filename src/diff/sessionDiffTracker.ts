import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { parseJsonlFileRecords } from '../shared/jsonl';
import { normalizeDiffLineCount } from './lineCount';
import type {
  FileMutation,
  SessionDiffSnapshot,
  SessionDiffStats,
  SessionDiffTrackedFile,
  SessionFileDiff,
  SessionFileDiffsResult,
  ToolExecutionInput
} from './types';
import { isRecord } from '../shared/typeGuards';

const execFileAsync = promisify(execFile);
const ignoredTrackedPathSegments = new Set([
  '.git',
  '.vscode-test',
  'build',
  'dist',
  'node_modules',
  'out'
]);
const maxExactLineDiffCells = 4_000_000;
const ignoredTrackedPathPrefixes = [
  'resources/pi-sdk-runtime/',
  'resources/vendor/',
  'resources/webview/'
];

export class SessionDiffTracker {
  private stats: SessionDiffStats = emptySessionDiffStats();
  private readonly trackedFiles = new Map<string, SessionDiffTrackedFile>();

  public constructor(snapshot?: SessionDiffSnapshot) {
    this.restore(snapshot);
  }

  public getStats(): SessionDiffStats {
    return { ...this.stats };
  }

  public snapshot(): SessionDiffSnapshot {
    const files = Array.from(this.trackedFiles.values());
    return {
      stats: this.getStats(),
      ...(files.length > 0 ? { files } : {})
    };
  }

  public restore(snapshot: SessionDiffSnapshot | undefined): void {
    this.stats = normalizeStats(snapshot?.stats);
    this.trackedFiles.clear();

    for (const file of normalizeTrackedFiles(snapshot?.files)) {
      this.trackedFiles.set(file.path, file);
    }
  }

  public hasTrackedFile(filePath: string): boolean {
    return this.trackedFiles.has(filePath);
  }

  public addTrackedFile(file: SessionDiffTrackedFile): boolean {
    if (this.hasTrackedFile(file.path)) {
      return false;
    }

    this.trackedFiles.set(file.path, file);
    return true;
  }

  public addToolExecution(input: ToolExecutionInput): SessionDiffStats {
    const diff = getToolExecutionDiffStats(input);
    this.stats = addStats(this.stats, diff);
    return this.getStats();
  }

}

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
  const parsed = await parseSessionDiffRecordsFromFile(sessionFile);

  if (!parsed) {
    return undefined;
  }

  return await parseSessionNetDiffStatsFromParsed(parsed) ?? getParsedToolStats(parsed);
}

export async function parseSessionFileDiffsFromFile(sessionFile: string): Promise<SessionFileDiff[] | undefined> {
  const parsed = await parseSessionDiffRecordsFromFile(sessionFile);
  return parsed ? computeParsedSessionFileDiffs(parsed) : undefined;
}

export async function parseSessionBestEffortFileDiffsFromFile(
  sessionFile: string,
  snapshot?: SessionDiffSnapshot
): Promise<SessionFileDiffsResult | undefined> {
  const parsed = await parseSessionDiffRecordsFromFile(sessionFile);

  if (!parsed) {
    return undefined;
  }

  return computeParsedBestEffortSessionFileDiffs(parsed, snapshot);
}

export async function createTrackedSessionFile(cwd: string | undefined, absolutePath: string): Promise<SessionDiffTrackedFile | undefined> {
  const pathInCwd = getTrackedSessionPath(cwd, absolutePath);

  if (!cwd || !pathInCwd) {
    return undefined;
  }

  const resolvedPath = pathInCwd ? resolvePathWithinCwd(cwd, pathInCwd) : undefined;

  if (!resolvedPath || !await isRegularFile(resolvedPath)) {
    return undefined;
  }

  return {
    path: pathInCwd,
    originalContent: await readGitFileContent(cwd, pathInCwd) ?? ''
  };
}

export function getTrackedSessionPath(cwd: string | undefined, absolutePath: string): string | undefined {
  if (!cwd) {
    return undefined;
  }

  const pathInCwd = getPathWithinCwd(cwd, absolutePath);
  return pathInCwd && !shouldSkipTrackedSessionPath(pathInCwd) ? pathInCwd : undefined;
}

export function shouldSkipTrackedSessionPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  if (normalizedPath.endsWith('.vsix')) {
    return true;
  }

  if (ignoredTrackedPathPrefixes.some((prefix) => normalizedPath === prefix.slice(0, -1) || normalizedPath.startsWith(prefix))) {
    return true;
  }

  return normalizedPath.split('/').some((segment) => ignoredTrackedPathSegments.has(segment));
}

type ParsedSessionDiffRecords = {
  cwd: string | undefined;
  toolExecutionStats: SessionDiffStats[];
  toolCallStats: SessionDiffStats[];
  executionMutations: FileMutation[];
  toolCallMutations: FileMutation[];
  shellChangedFiles: string[];
};

async function parseSessionDiffRecordsFromFile(sessionFile: string): Promise<ParsedSessionDiffRecords | undefined> {
  const parsed = createParsedSessionDiffRecords();

  try {
    for await (const record of parseJsonlFileRecords(sessionFile)) {
      collectSessionDiffRecord(record, parsed);
    }
  } catch {
    return undefined;
  }

  return parsed;
}

function createParsedSessionDiffRecords(): ParsedSessionDiffRecords {
  return {
    cwd: undefined,
    toolExecutionStats: [],
    toolCallStats: [],
    executionMutations: [],
    toolCallMutations: [],
    shellChangedFiles: []
  };
}

function collectSessionDiffRecord(record: unknown, parsed: ParsedSessionDiffRecords): void {
  if (isRecord(record) && record.type === 'session') {
    parsed.cwd = getRecordString(record, 'cwd') ?? parsed.cwd;
  }

  collectToolStats(record, parsed.toolExecutionStats, parsed.toolCallStats);
  collectToolMutations(record, parsed.executionMutations, parsed.toolCallMutations);
  collectShellChangedFiles(record, parsed.shellChangedFiles);
}

function getParsedToolStats(parsed: ParsedSessionDiffRecords): SessionDiffStats {
  return sumStats(parsed.toolExecutionStats.length > 0 ? parsed.toolExecutionStats : parsed.toolCallStats);
}

function getParsedMutations(parsed: ParsedSessionDiffRecords): FileMutation[] {
  return parsed.executionMutations.length > 0 ? parsed.executionMutations : parsed.toolCallMutations;
}

async function computeParsedSessionFileDiffs(parsed: ParsedSessionDiffRecords): Promise<SessionFileDiff[] | undefined> {
  const mutations = getParsedMutations(parsed);

  if (mutations.length === 0) {
    return [];
  }

  if (!parsed.cwd) {
    return undefined;
  }

  return computeSessionFileDiffs(parsed.cwd, mutations);
}

async function computeParsedBestEffortSessionFileDiffs(
  parsed: ParsedSessionDiffRecords,
  snapshot: SessionDiffSnapshot | undefined
): Promise<SessionFileDiffsResult> {
  const mutations = getParsedMutations(parsed);
  const { diffs, failedMutations } = parsed.cwd
    ? await computeSessionFileDiffsBestEffort(parsed.cwd, mutations)
    : { diffs: [], failedMutations: mutations };
  const syntheticDiffs = computeSyntheticSessionFileDiffs(parsed.cwd, failedMutations);
  const existingDiffs = [...diffs, ...syntheticDiffs];
  const shellDiffs = await computeTrackedPathSessionFileDiffs(parsed.cwd, parsed.shellChangedFiles, existingDiffs);
  const snapshotDiffs = await computeSnapshotSessionFileDiffs(parsed.cwd, snapshot?.files, [...existingDiffs, ...shellDiffs]);

  return {
    diffs: [...existingDiffs, ...shellDiffs, ...snapshotDiffs],
    reconstructed: syntheticDiffs.length === 0
  };
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

async function parseSessionNetDiffStatsFromParsed(parsed: ParsedSessionDiffRecords): Promise<SessionDiffStats | undefined> {
  const mutations = getParsedMutations(parsed);

  if (!parsed.cwd || mutations.length === 0) {
    return undefined;
  }

  const fileDiffs = await computeSessionFileDiffs(parsed.cwd, mutations);
  return fileDiffs === undefined ? undefined : sumStats(fileDiffs.map((diff) => getLineDiffStats(diff.originalContent, diff.modifiedContent)));
}

function collectShellChangedFiles(value: unknown, shellChangedFiles: string[]): void {
  if (!isRecord(value)) {
    return;
  }

  const message = isRecord(value.message) ? value.message : value;

  if (message.toolName !== 'bash') {
    return;
  }

  const content = message.content;

  if (!Array.isArray(content)) {
    return;
  }

  for (const item of content) {
    if (!isRecord(item) || typeof item.text !== 'string') {
      continue;
    }

    for (const line of item.text.split('\n')) {
      const changedPath = parseGitStatusShortPath(line);

      if (changedPath) {
        shellChangedFiles.push(changedPath);
      }
    }
  }
}

function parseGitStatusShortPath(line: string): string | undefined {
  const match = /^[ MADRCU?!]{2} (.+)$/.exec(line);
  const changedPath = match?.[1]?.trim();

  if (!changedPath) {
    return undefined;
  }

  const renamedPath = changedPath.split(' -> ').pop()?.trim();
  return renamedPath || undefined;
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
  const { diffs, failedMutations } = await computeSessionFileDiffsBestEffort(cwd, mutations);
  return failedMutations.length > 0 ? undefined : diffs;
}

async function computeSessionFileDiffsBestEffort(
  cwd: string,
  mutations: FileMutation[]
): Promise<{ diffs: SessionFileDiff[]; failedMutations: FileMutation[] }> {
  const mutationsByPath = groupMutationsByPath(mutations);
  const fileDiffs: SessionFileDiff[] = [];
  const failedMutations: FileMutation[] = [];

  for (const [filePath, fileMutations] of mutationsByPath) {
    const absolutePath = resolvePathWithinCwd(cwd, filePath);

    if (!absolutePath) {
      continue;
    }

    const currentContent = await readCurrentFileContent(absolutePath);

    if (currentContent === undefined) {
      failedMutations.push(...fileMutations);
      continue;
    }

    const baselineContent = reverseFileMutations(currentContent, fileMutations);

    if (baselineContent === undefined) {
      failedMutations.push(...fileMutations);
      continue;
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

  return { diffs: fileDiffs, failedMutations };
}

async function computeTrackedPathSessionFileDiffs(
  cwd: string | undefined,
  filePaths: string[],
  existingDiffs: SessionFileDiff[]
): Promise<SessionFileDiff[]> {
  if (!cwd || filePaths.length === 0) {
    return [];
  }

  const trackedFiles: SessionDiffTrackedFile[] = [];

  for (const filePath of new Set(filePaths)) {
    const absolutePath = resolvePathWithinCwd(cwd, filePath);

    if (!absolutePath) {
      continue;
    }

    trackedFiles.push({
      path: filePath,
      originalContent: await readGitFileContent(cwd, filePath) ?? ''
    });
  }

  return computeSnapshotSessionFileDiffs(cwd, trackedFiles, existingDiffs);
}

async function computeSnapshotSessionFileDiffs(
  cwd: string | undefined,
  files: SessionDiffTrackedFile[] | undefined,
  existingDiffs: SessionFileDiff[]
): Promise<SessionFileDiff[]> {
  if (!cwd || !files?.length) {
    return [];
  }

  const existingPaths = new Set(existingDiffs.map((diff) => path.resolve(diff.absolutePath)));
  const diffs: SessionFileDiff[] = [];

  for (const file of normalizeTrackedFiles(files)) {
    const absolutePath = resolvePathWithinCwd(cwd, file.path);

    if (!absolutePath || existingPaths.has(path.resolve(absolutePath))) {
      continue;
    }

    const currentContent = await readCurrentFileContent(absolutePath) ?? '';

    if (file.originalContent === currentContent) {
      continue;
    }

    diffs.push({
      path: file.path,
      absolutePath,
      originalContent: file.originalContent,
      modifiedContent: currentContent
    });
  }

  return diffs;
}

function groupMutationsByPath(mutations: FileMutation[]): Map<string, FileMutation[]> {
  const mutationsByPath = new Map<string, FileMutation[]>();

  for (const mutation of mutations) {
    const existing = mutationsByPath.get(mutation.path);

    if (existing) {
      existing.push(mutation);
    } else {
      mutationsByPath.set(mutation.path, [mutation]);
    }
  }

  return mutationsByPath;
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

    const absolutePath = cwd ? resolvePathWithinCwd(cwd, filePath) : path.resolve('/', filePath);

    if (!absolutePath) {
      continue;
    }

    result.push({
      path: filePath,
      absolutePath,
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

function resolvePathWithinCwd(cwd: string, filePath: string): string | undefined {
  const resolvedCwd = path.resolve(cwd);
  const absolutePath = path.resolve(resolvedCwd, filePath);
  return isPathWithinCwd(resolvedCwd, absolutePath) ? absolutePath : undefined;
}

function getPathWithinCwd(cwd: string, filePath: string): string | undefined {
  const resolvedCwd = path.resolve(cwd);
  const absolutePath = path.resolve(filePath);

  if (!isPathWithinCwd(resolvedCwd, absolutePath)) {
    return undefined;
  }

  return path.relative(resolvedCwd, absolutePath).replace(/\\/g, '/');
}

function isPathWithinCwd(resolvedCwd: string, absolutePath: string): boolean {
  const relativePath = path.relative(resolvedCwd, absolutePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function readCurrentFileContent(absolutePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    return (await fs.stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function readGitFileContent(cwd: string, filePath: string): Promise<string | undefined> {
  try {
    const { stdout: rootStdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    const gitRoot = await resolveRealPath(rootStdout.trim());
    const absolutePath = resolvePathWithinCwd(cwd, filePath);

    if (!gitRoot || !absolutePath) {
      return undefined;
    }

    const realAbsolutePath = await resolveRealPath(absolutePath) ?? absolutePath;
    const gitPath = path.relative(gitRoot, realAbsolutePath).replace(/\\/g, '/');
    const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'show', `HEAD:${gitPath}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    return stdout;
  } catch {
    return undefined;
  }
}

async function resolveRealPath(filePath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return filePath || undefined;
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

  if (oldLines.length * newLines.length > maxExactLineDiffCells) {
    return {
      addedLines: newLines.length,
      removedLines: oldLines.length
    };
  }

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
    addedLines: normalizeDiffLineCount(value.addedLines),
    removedLines: normalizeDiffLineCount(value.removedLines)
  };
}

function normalizeTrackedFiles(value: unknown): SessionDiffTrackedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const files: SessionDiffTrackedFile[] = [];

  for (const file of value) {
    if (!isRecord(file)) {
      continue;
    }

    const filePath = getRecordString(file, 'path');
    const originalContent = getRecordString(file, 'originalContent');

    if (filePath && originalContent !== undefined) {
      files.push({ path: filePath, originalContent });
    }
  }

  return files;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
