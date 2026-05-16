import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  parseSessionBestEffortFileDiffsFromFile,
  type SessionFileDiff
} from './sessionDiffTracker';

export const sessionDiffScheme = 'tau-session-diff';

export type SessionDiffDocumentContext = {
  path: string;
  side: 'original' | 'modified';
};

type SessionDiffDocument = {
  uri: vscode.Uri;
  content: string;
};

export class SessionDiffViewer implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly providerDisposable: vscode.Disposable;
  private documentSequence = 0;

  public constructor(
    private readonly showNotification: (message: string, notifyType: string) => void
  ) {
    this.providerDisposable = vscode.workspace.registerTextDocumentContentProvider(sessionDiffScheme, this);
  }

  public dispose(): void {
    this.providerDisposable.dispose();
    this.documents.clear();
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  public async showSessionChanges(sessionFile: string, displayName: string): Promise<void> {
    const fileDiffsResult = await parseSessionBestEffortFileDiffsFromFile(sessionFile);

    if (!fileDiffsResult) {
      this.showNotification('Could not read changes for this session.', 'warning');
      return;
    }

    if (fileDiffsResult.diffs.length === 0) {
      this.showNotification('No changes found for this session.', 'info');
      return;
    }

    try {
      await this.openMultiFileDiff(displayName, fileDiffsResult.diffs, fileDiffsResult.reconstructed);
    } catch {
      this.showNotification('Could not open the session changes view in this VS Code version.', 'warning');
    }
  }

  private async openMultiFileDiff(displayName: string, fileDiffs: SessionFileDiff[], reconstructed: boolean): Promise<void> {
    const title = reconstructed ? `Tau Changes: ${displayName}` : `Tau Changes: ${displayName} (recorded edits)`;
    const documents = fileDiffs.map((diff) => this.createDiffDocuments(diff));
    const changesResources = documents.map(({ label, original, modified }) => [label, original.uri, modified.uri]);

    try {
      await vscode.commands.executeCommand('vscode.changes', title, changesResources);
      return;
    } catch {
      await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
        title,
        resources: documents.map(({ original, modified }) => ({
          originalUri: original.uri,
          modifiedUri: modified.uri
        }))
      });
    }
  }

  private createDiffDocuments(diff: SessionFileDiff): { label: vscode.Uri; original: SessionDiffDocument; modified: SessionDiffDocument } {
    const id = String(++this.documentSequence);
    const normalizedPath = normalizeDiffPath(diff.path || diff.absolutePath);
    const originalUri = vscode.Uri.from({
      scheme: sessionDiffScheme,
      authority: 'original',
      path: `/${id}/${normalizedPath}`
    });
    const modifiedUri = vscode.Uri.from({
      scheme: sessionDiffScheme,
      authority: 'modified',
      path: `/${id}/${normalizedPath}`
    });

    this.documents.set(originalUri.toString(), diff.originalContent);
    this.documents.set(modifiedUri.toString(), diff.modifiedContent);

    return {
      label: vscode.Uri.file(diff.absolutePath),
      original: { uri: originalUri, content: diff.originalContent },
      modified: { uri: modifiedUri, content: diff.modifiedContent }
    };
  }
}

export function getSessionDiffDocumentContext(uri: vscode.Uri): SessionDiffDocumentContext | undefined {
  if (uri.scheme !== sessionDiffScheme || (uri.authority !== 'original' && uri.authority !== 'modified')) {
    return undefined;
  }

  const pathParts = uri.path.replace(/^\/+/, '').split('/').filter(Boolean);

  if (pathParts.length < 2) {
    return undefined;
  }

  return {
    path: pathParts.slice(1).join('/'),
    side: uri.authority
  };
}

function normalizeDiffPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalizedPath || path.basename(filePath) || 'file.txt';
}
