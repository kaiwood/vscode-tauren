import * as vscode from 'vscode';

/**
 * URI scheme for the read-only "before" (original) side of proposed-edit diffs.
 */
export const proposedOriginalScheme = 'tauren-original';

/**
 * URI scheme for the writable "after" (proposed) side of proposed-edit diffs.
 * Uses a FileSystemProvider so VS Code treats the document as editable.
 */
export const proposedEditScheme = 'tauren-proposed';

// ─── Read-only original provider (left side) ────────────────────────────────

/**
 * Provides read-only virtual document content for the "before" side of a
 * proposed-edit diff.  Content is stored in memory.
 */
export class ProposedOriginalProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
    this.contents.clear();
  }

  public set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  public delete(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

// ─── Writable proposed-edit filesystem provider (right side) ─────────────────

/**
 * A `FileSystemProvider` that backs virtual proposed-edit documents with
 * in-memory storage.  Because it implements the full `FileSystemProvider`
 * interface, VS Code allows the user to edit the document in the diff editor.
 */
export class ProposedEditProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly files = new Map<string, Uint8Array>();
  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  public readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  public dispose(): void {
    this.onDidChangeFileEmitter.dispose();
    this.files.clear();
  }

  /** Seed content for a given virtual URI. */
  public set(uri: vscode.Uri, content: string): void {
    this.files.set(uri.toString(), Buffer.from(content, 'utf8'));
    this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /** Get the current content of a virtual file (includes any user edits). */
  public get(uri: vscode.Uri): string {
    const data = this.files.get(uri.toString());
    return data ? Buffer.from(data).toString('utf8') : '';
  }

  /** Remove stored content. */
  public delete(uri: vscode.Uri): void {
    if (this.files.has(uri.toString())) {
      this.files.delete(uri.toString());
      this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }
  }

  // ─── FileSystemProvider interface ──────────────────────────────────────────

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public stat(uri: vscode.Uri): vscode.FileStat {
    const data = this.files.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: data.byteLength
    };
  }

  public readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  public createDirectory(): void {}

  public readFile(uri: vscode.Uri): Uint8Array {
    const data = this.files.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return data;
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array): void {
    this.files.set(uri.toString(), content);
    this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  public rename(): void {}
}
