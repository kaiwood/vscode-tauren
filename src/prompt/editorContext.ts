import * as vscode from 'vscode';
import { getSessionDiffDocumentContext } from '../diff/sessionDiffUri';
import type { PiPromptContextInput } from './types';

export function createPromptContextFromEditor(editor: vscode.TextEditor): PiPromptContextInput[] {
  const document = editor.document;
  const diffContext = getSessionDiffDocumentContext(document.uri);
  const path = diffContext?.path ?? getDocumentContextPath(document);

  if (!path) {
    return [];
  }

  const selectedContexts = editor.selections.flatMap((selection): PiPromptContextInput[] => {
    if (selection.isEmpty) {
      return [];
    }

    const text = document.getText(selection);

    if (!text.trim()) {
      return [];
    }

    const lineRange = getSelectedLineRange(selection);
    const lineLabel = formatLineRange(lineRange.startLine, lineRange.endLine);
    const title = diffContext
      ? `${path}:${lineLabel} (${diffContext.side} side of Tauren session diff; lines are diff-view section lines)`
      : `${path}:${lineLabel}`;

    return [{
      kind: 'selection',
      path,
      label: diffContext
        ? `${getPathBasename(path)}:${lineLabel} (${diffContext.side} diff)`
        : `${getPathBasename(path)}:${lineLabel}`,
      title,
      languageId: document.languageId,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      ...(diffContext ? { note: getSessionDiffContextNote(diffContext.side) } : {}),
      text
    }];
  });

  if (selectedContexts.length > 0) {
    return selectedContexts;
  }

  return [{
    kind: 'file',
    path,
    label: diffContext ? `${getPathBasename(path)} (${diffContext.side} diff)` : getPathBasename(path),
    title: diffContext ? `${path} (${diffContext.side} side of Tauren session diff)` : path,
    ...(diffContext ? { note: getSessionDiffContextNote(diffContext.side) } : {})
  }];
}

function getDocumentContextPath(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'file') {
    return vscode.workspace.asRelativePath(document.uri, false);
  }

  return document.uri.toString(true);
}

function getSessionDiffContextNote(side: 'original' | 'modified'): string {
  return `This context comes from the ${side} side of a Tauren session diff view. The line numbers refer to the diff viewer's virtual section document, not to the current workspace file.`;
}

function getSelectedLineRange(selection: vscode.Selection): { startLine: number; endLine: number } {
  let endLine = selection.end.line;

  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    endLine -= 1;
  }

  endLine = Math.max(selection.start.line, endLine);

  return {
    startLine: selection.start.line + 1,
    endLine: endLine + 1
  };
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}
