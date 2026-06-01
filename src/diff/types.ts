import type * as vscode from 'vscode';

export type SessionDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type SessionDiffSnapshot = {
  stats?: SessionDiffStats;
  files?: SessionDiffTrackedFile[];
};

export type SessionDiffTrackedFile = {
  path: string;
  originalContent: string;
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

export type ToolExecutionInput = {
  toolName?: unknown;
  args?: unknown;
  result?: unknown;
  isError?: unknown;
};

export type FileMutation =
  | { toolName: 'edit'; path: string; edits: Array<{ oldText: string; newText: string }> }
  | { toolName: 'write'; path: string; content: string };

export type SessionDiffControllerOptions = {
  initialSessionFile?: string;
  getSessionGeneration: () => number;
  getCwd?: () => string | undefined;
  postState: () => void;
  loadSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
  restoreStatsFromSessionFile?: (sessionFile: string) => Promise<SessionDiffStats | undefined>;
};

export type SessionDiffDocumentContext = {
  path: string;
  side: 'original' | 'modified';
};

export type SessionDiffDocument = {
  uri: vscode.Uri;
  content: string;
};
