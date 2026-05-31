import * as vscode from 'vscode';
import { normalizeDiffLineCount } from './lineCount';
import type { SessionDiffSnapshot } from './types';
import { isRecord } from '../shared/typeGuards';

const sessionDiffSnapshotsStorageKey = 'tauren.sessionDiffSnapshots';
const maxSessionDiffSnapshots = 50;

type StoredSessionDiffSnapshot = {
  snapshot: SessionDiffSnapshot;
  updatedAt: number;
};

export function createSessionDiffStatsFileWatcher(onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const disposables = [
    watcher,
    watcher.onDidChange(onChange),
    watcher.onDidCreate(onChange),
    watcher.onDidDelete(onChange),
    vscode.workspace.onDidSaveTextDocument(onChange)
  ];

  return new vscode.Disposable(() => {
    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
}

export function readSessionDiffSnapshot(
  workspaceState: vscode.Memento | undefined,
  sessionFile: string
): SessionDiffSnapshot | undefined {
  return readStoredSessionDiffSnapshots(workspaceState)[sessionFile]?.snapshot;
}

export function writeSessionDiffSnapshot(
  workspaceState: vscode.Memento | undefined,
  sessionFile: string,
  snapshot: SessionDiffSnapshot
): void {
  if (!workspaceState) {
    return;
  }

  const snapshots = readStoredSessionDiffSnapshots(workspaceState);

  if (areSessionDiffSnapshotsEqual(snapshots[sessionFile]?.snapshot, snapshot)) {
    return;
  }

  snapshots[sessionFile] = {
    snapshot,
    updatedAt: getNextSnapshotUpdatedAt(snapshots)
  };

  void workspaceState.update(
    sessionDiffSnapshotsStorageKey,
    formatStoredSessionDiffSnapshots(pruneSessionDiffSnapshots(snapshots))
  ).then(undefined, () => undefined);
}

function readStoredSessionDiffSnapshots(workspaceState: vscode.Memento | undefined): Record<string, StoredSessionDiffSnapshot> {
  const value = workspaceState?.get<unknown>(sessionDiffSnapshotsStorageKey);

  if (!isRecord(value)) {
    return {};
  }

  const snapshots: Record<string, StoredSessionDiffSnapshot> = {};

  for (const [sessionFile, snapshot] of Object.entries(value)) {
    const parsed = parseStoredSessionDiffSnapshot(snapshot);

    if (parsed) {
      snapshots[sessionFile] = parsed;
    }
  }

  return snapshots;
}

function parseStoredSessionDiffSnapshot(value: unknown): StoredSessionDiffSnapshot | undefined {
  const snapshot = parseSessionDiffSnapshot(value);

  return snapshot ? { snapshot, updatedAt: isRecord(value) ? normalizeTimestamp(value.updatedAt) : 0 } : undefined;
}

function parseSessionDiffSnapshot(value: unknown): SessionDiffSnapshot | undefined {
  if (!isRecord(value) || !isRecord(value.stats)) {
    return undefined;
  }

  const addedLines = normalizeDiffLineCount(value.stats.addedLines);
  const removedLines = normalizeDiffLineCount(value.stats.removedLines);

  return { stats: { addedLines, removedLines } };
}

function pruneSessionDiffSnapshots(
  snapshots: Record<string, StoredSessionDiffSnapshot>
): Record<string, StoredSessionDiffSnapshot> {
  const entries = Object.entries(snapshots)
    .sort(([leftSessionFile, left], [rightSessionFile, right]) => {
      const timeSort = right.updatedAt - left.updatedAt;
      return timeSort === 0 ? leftSessionFile.localeCompare(rightSessionFile) : timeSort;
    })
    .slice(0, maxSessionDiffSnapshots);

  return Object.fromEntries(entries);
}

function formatStoredSessionDiffSnapshots(
  snapshots: Record<string, StoredSessionDiffSnapshot>
): Record<string, SessionDiffSnapshot & { updatedAt: number }> {
  const formatted: Record<string, SessionDiffSnapshot & { updatedAt: number }> = {};

  for (const [sessionFile, stored] of Object.entries(snapshots)) {
    formatted[sessionFile] = { ...stored.snapshot, updatedAt: stored.updatedAt };
  }

  return formatted;
}

function getNextSnapshotUpdatedAt(snapshots: Record<string, StoredSessionDiffSnapshot>): number {
  const latestStoredTimestamp = Math.max(0, ...Object.values(snapshots).map((snapshot) => snapshot.updatedAt));
  return Math.max(Date.now(), latestStoredTimestamp + 1);
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function areSessionDiffSnapshotsEqual(left: SessionDiffSnapshot | undefined, right: SessionDiffSnapshot): boolean {
  return normalizeSnapshotStats(left?.stats).addedLines === normalizeSnapshotStats(right.stats).addedLines
    && normalizeSnapshotStats(left?.stats).removedLines === normalizeSnapshotStats(right.stats).removedLines;
}

function normalizeSnapshotStats(stats: SessionDiffSnapshot['stats'] | undefined): { addedLines: number; removedLines: number } {
  return {
    addedLines: normalizeDiffLineCount(stats?.addedLines),
    removedLines: normalizeDiffLineCount(stats?.removedLines)
  };
}
