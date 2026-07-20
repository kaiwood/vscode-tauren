import * as vscode from 'vscode';

/**
 * URI scheme used for the "after" side of proposed-edit diff views.
 * Virtual URIs have the form: `tauren-proposed:<absoluteFilePath>?<nonce>`
 */
export const proposedEditScheme = 'tauren-proposed';

/**
 * Provides read-only virtual document content for the "after" side of a
 * proposed-edit diff.  Content is stored in memory and cleaned up when the
 * associated text document is closed or when `delete` is called explicitly.
 */
export class ProposedEditProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor() {
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === proposedEditScheme) {
          this.contents.delete(document.uri.toString());
        }
      })
    );
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.contents.clear();
  }

  /** Store content for a URI, firing a change event so VS Code re-reads it. */
  public set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  /** Remove stored content. */
  public delete(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}
