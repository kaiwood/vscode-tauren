import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseSessionBestEffortFileDiffsFromFile } from './sessionDiffTracker';
import { sessionDiffScheme } from './sessionDiffUri';
import type { SessionDiffDocument, SessionDiffSnapshot, SessionFileDiff } from './types';

const retainedDiffViewGenerations = 3;
const maxRetainedDiffDocuments = 400;

type SessionDiffDocumentContent = {
  content: string;
  generation: number;
};

export class SessionDiffViewer implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, SessionDiffDocumentContent>();
  private readonly documentOrder: string[] = [];
  private readonly disposables: vscode.Disposable[];
  private documentSequence = 0;
  private diffViewGeneration = 0;

  public constructor(
    private readonly showNotification: (message: string, notifyType: string) => void
  ) {
    this.disposables = [
      vscode.workspace.registerTextDocumentContentProvider(sessionDiffScheme, this),
      vscode.workspace.onDidCloseTextDocument((document) => this.deleteDocumentContent(document.uri))
    ];
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.documents.clear();
    this.documentOrder.length = 0;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString())?.content ?? '';
  }

  public async showSessionChanges(sessionFile: string, displayName: string, snapshot?: SessionDiffSnapshot): Promise<void> {
    const fileDiffsResult = await parseSessionBestEffortFileDiffsFromFile(sessionFile, snapshot);

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
    const title = reconstructed ? `Tauren Changes: ${displayName}` : `Tauren Changes: ${displayName} (recorded edits)`;
    const generation = ++this.diffViewGeneration;
    const documents = fileDiffs.map((diff) => this.createDiffDocuments(diff, generation));
    const changesResources = documents.map(({ label, original, modified }) => [label, original.uri, modified.uri]);

    try {
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
    } finally {
      this.pruneDocumentContent();
    }
  }

  private createDiffDocuments(diff: SessionFileDiff, generation: number): { label: vscode.Uri; original: SessionDiffDocument; modified: SessionDiffDocument } {
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

    this.rememberDocumentContent(originalUri, diff.originalContent, generation);
    this.rememberDocumentContent(modifiedUri, diff.modifiedContent, generation);

    return {
      label: vscode.Uri.file(diff.absolutePath),
      original: { uri: originalUri, content: diff.originalContent },
      modified: { uri: modifiedUri, content: diff.modifiedContent }
    };
  }

  private rememberDocumentContent(uri: vscode.Uri, content: string, generation: number): void {
    const key = uri.toString();

    if (!this.documents.has(key)) {
      this.documentOrder.push(key);
    }

    this.documents.set(key, { content, generation });
  }

  private deleteDocumentContent(uri: vscode.Uri): void {
    if (uri.scheme !== sessionDiffScheme) {
      return;
    }

    this.documents.delete(uri.toString());
    this.compactDocumentOrder();
  }

  private pruneDocumentContent(): void {
    const openDocuments = new Set(vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === sessionDiffScheme)
      .map((document) => document.uri.toString()));
    const oldestRetainedGeneration = this.diffViewGeneration - retainedDiffViewGenerations + 1;

    for (const key of this.documentOrder) {
      const document = this.documents.get(key);

      if (!document || document.generation >= oldestRetainedGeneration || openDocuments.has(key)) {
        continue;
      }

      this.documents.delete(key);
    }

    if (this.documents.size > maxRetainedDiffDocuments) {
      for (const key of this.documentOrder) {
        if (this.documents.size <= maxRetainedDiffDocuments) {
          break;
        }

        const document = this.documents.get(key);

        if (!document || document.generation === this.diffViewGeneration || openDocuments.has(key)) {
          continue;
        }

        this.documents.delete(key);
      }
    }

    this.compactDocumentOrder();
  }

  private compactDocumentOrder(): void {
    for (let index = this.documentOrder.length - 1; index >= 0; index -= 1) {
      if (!this.documents.has(this.documentOrder[index])) {
        this.documentOrder.splice(index, 1);
      }
    }
  }
}

function normalizeDiffPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalizedPath || path.basename(filePath) || 'file.txt';
}
