import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { proposedEditScheme, ProposedEditProvider } from './proposedEditProvider';
import { isRecord } from '../shared/typeGuards';

/**
 * Pending diff waiting for an accept/reject decision.
 */
type PendingProposedEdit = {
  absolutePath: string;
  /** The content that was on disk before the agent ran the tool. */
  originalContent: string;
  proposedContent: string;
  originalUri: vscode.Uri;
  proposedUri: vscode.Uri;
  isNewFile: boolean;
};

/**
 * Content captured from a file just before a tool execution starts, keyed by
 * absolute path.  Used to restore the file after the agent writes it and to
 * build the "before" side of the diff.
 */
type PreExecutionSnapshot = {
  originalContent: string;
  isNewFile: boolean;
};

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolves the absolute path for a tool-call file argument, given the session
 * cwd.  Returns undefined if the path cannot be resolved.
 */
function resolveAbsolutePath(cwd: string | undefined, filePath: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  if (!cwd) {
    return undefined;
  }

  return path.resolve(cwd, filePath);
}

/**
 * Applies a sequence of `edit` tool edits (oldText → newText) to `original`
 * content, returning the resulting string.  Returns undefined if any
 * substitution cannot be applied uniquely.
 */
function applyEdits(
  original: string,
  edits: Array<{ oldText: string; newText: string }>
): string | undefined {
  let content = original;

  for (const edit of edits) {
    const index = content.indexOf(edit.oldText);

    if (index === -1) {
      return undefined;
    }

    // Ensure uniqueness – the same oldText must not appear a second time
    if (content.indexOf(edit.oldText, index + edit.oldText.length) !== -1) {
      return undefined;
    }

    content = `${content.slice(0, index)}${edit.newText}${content.slice(index + edit.oldText.length)}`;
  }

  return content;
}

/**
 * Manages the lifecycle of proposed-edit diff views.
 *
 * Flow:
 *  1. Call `captureBeforeToolExecution` at `tool_execution_start` to snapshot
 *     the file before the agent modifies it.
 *  2. Call `handleToolExecution` at `tool_execution_end`.  It reads the
 *     agent-written content from disk as the "proposed" side, restores the
 *     original file so the workspace is unchanged, then opens the diff.
 *  3. The user clicks Accept (→ `acceptPendingEdit`) to apply the proposed
 *     content, or Reject (→ `rejectPendingEdit`) to leave the restored
 *     original in place.
 *
 * Bind `acceptPendingEdit` / `rejectPendingEdit` to the Accept / Reject
 * commands registered in package.json.
 */
export class ProposedEditDiffService implements vscode.Disposable {
  private pendingEdits = new Map<string, PendingProposedEdit>();
  /** Snapshots keyed by absolute path, captured before each tool execution. */
  private preExecutionSnapshots = new Map<string, PreExecutionSnapshot>();
  private nonce = 0;

  public constructor(
    private readonly provider: ProposedEditProvider,
    private readonly getCwd: () => string | undefined
  ) {}

  public dispose(): void {
    this.pendingEdits.clear();
    this.preExecutionSnapshots.clear();
  }

  /**
   * Called at `tool_execution_start` to capture the file's current content
   * before the agent modifies it.  `input` is the raw event object.
   */
  public async captureBeforeToolExecution(input: unknown): Promise<void> {
    if (!isRecord(input)) {
      return;
    }

    const toolName = getRecordString(input, 'toolName');

    if (toolName !== 'write' && toolName !== 'edit') {
      return;
    }

    const args = isRecord(input.args) ? input.args : undefined;

    if (!args) {
      return;
    }

    const filePath = getRecordString(args, 'path') ?? getRecordString(args, 'file_path');

    if (!filePath) {
      return;
    }

    const cwd = this.getCwd();
    const absolutePath = resolveAbsolutePath(cwd, filePath);

    if (!absolutePath) {
      return;
    }

    let originalContent: string;
    let isNewFile: boolean;

    try {
      originalContent = await fs.readFile(absolutePath, 'utf8');
      isNewFile = false;
    } catch {
      // File does not exist yet
      originalContent = '';
      isNewFile = true;
    }

    this.preExecutionSnapshots.set(absolutePath, { originalContent, isNewFile });
  }

  /**
   * Called at `tool_execution_end`.  Reads the agent-written content as the
   * "proposed" side, restores the original file so the workspace is unchanged,
   * then opens the diff view.
   */
  public async handleToolExecution(input: unknown): Promise<void> {
    if (!isRecord(input)) {
      return;
    }

    const toolName = getRecordString(input, 'toolName');

    if (toolName !== 'write' && toolName !== 'edit') {
      return;
    }

    if (input.isError === true) {
      return;
    }

    const args = isRecord(input.args) ? input.args : undefined;

    if (!args) {
      return;
    }

    const filePath = getRecordString(args, 'path') ?? getRecordString(args, 'file_path');

    if (!filePath) {
      return;
    }

    const cwd = this.getCwd();
    const absolutePath = resolveAbsolutePath(cwd, filePath);

    if (!absolutePath) {
      return;
    }

    // Retrieve (and remove) the pre-execution snapshot
    const snapshot = this.preExecutionSnapshots.get(absolutePath);
    this.preExecutionSnapshots.delete(absolutePath);

    if (toolName === 'write') {
      const proposedContent = getRecordString(args, 'content') ?? getRecordString(args, 'text');

      if (proposedContent === undefined) {
        return;
      }

      const originalContent = snapshot?.originalContent ?? '';
      const isNewFile = snapshot?.isNewFile ?? true;
      await this.revertFileThenOpenDiff(absolutePath, originalContent, proposedContent, isNewFile);
      return;
    }

    // toolName === 'edit'
    const rawEdits = args.edits;

    if (!Array.isArray(rawEdits)) {
      return;
    }

    const edits: Array<{ oldText: string; newText: string }> = [];

    for (const rawEdit of rawEdits) {
      if (!isRecord(rawEdit)) {
        continue;
      }

      const oldText = getRecordString(rawEdit, 'oldText');
      const newText = getRecordString(rawEdit, 'newText');

      if (oldText !== undefined && newText !== undefined) {
        edits.push({ oldText, newText });
      }
    }

    if (edits.length === 0) {
      return;
    }

    // Use the pre-execution snapshot as the original.  If no snapshot was
    // captured (e.g. tool_execution_start was missed), fall back to reading
    // the current file and computing proposed from the edits the usual way.
    if (snapshot) {
      const { originalContent, isNewFile } = snapshot;
      const proposedContent = applyEdits(originalContent, edits);

      if (proposedContent === undefined) {
        // Cannot reconstruct (non-unique match), restore original and skip diff
        await this.writeFileContent(absolutePath, originalContent, isNewFile);
        return;
      }

      await this.revertFileThenOpenDiff(absolutePath, originalContent, proposedContent, isNewFile);
      return;
    }

    // Fallback: no pre-execution snapshot available.
    // Read the already-edited file content and compute original by reversing edits.
    let currentContent: string;

    try {
      currentContent = await fs.readFile(absolutePath, 'utf8');
    } catch {
      return;
    }

    // We cannot reliably reverse edits, so show the diff with the current
    // (already-edited) file as "proposed" and skip restoration.
    const nonce = ++this.nonce;
    const proposedUri = vscode.Uri.parse(
      `${proposedEditScheme}:${encodeURIComponent(absolutePath)}?${nonce}`
    );
    this.provider.set(proposedUri, currentContent);

    const pending: PendingProposedEdit = {
      absolutePath,
      originalContent: currentContent,
      proposedContent: currentContent,
      originalUri: vscode.Uri.file(absolutePath),
      proposedUri,
      isNewFile: false
    };
    this.pendingEdits.set(absolutePath, pending);

    const filename = path.basename(absolutePath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(absolutePath),
      proposedUri,
      `${filename} ↔ AI Suggestion`,
      { preview: true }
    );
  }

  /**
   * Writes the accepted proposed content to disk and cleans up the diff view.
   */
  public async acceptPendingEdit(absolutePath: string): Promise<void> {
    const pending = this.pendingEdits.get(absolutePath);

    if (!pending) {
      return;
    }

    await this.writeFileContent(absolutePath, pending.proposedContent, pending.isNewFile);
    this.cleanupPending(pending);
  }

  /**
   * Leaves the original (already-restored) file in place and cleans up the
   * diff view.
   */
  public rejectPendingEdit(absolutePath: string): void {
    const pending = this.pendingEdits.get(absolutePath);

    if (!pending) {
      return;
    }

    this.cleanupPending(pending);
    vscode.window.showInformationMessage(`Tauren: Proposed edit to ${path.basename(absolutePath)} was rejected.`);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  /**
   * Restores the file to `originalContent` on disk (undoing the agent's write),
   * then opens the side-by-side diff.
   */
  private async revertFileThenOpenDiff(
    absolutePath: string,
    originalContent: string,
    proposedContent: string,
    isNewFile: boolean
  ): Promise<void> {
    // Restore the file so the workspace reflects the original state
    if (isNewFile) {
      // Delete the newly created file so the left side of the diff is truly empty
      try {
        await fs.unlink(absolutePath);
      } catch {
        // Already gone or couldn't delete — not fatal
      }
    } else {
      await this.writeFileContent(absolutePath, originalContent, false);
    }

    const nonce = ++this.nonce;

    // Left side: original file URI (existing file) or empty virtual URI (new file)
    let originalUri: vscode.Uri;

    if (isNewFile) {
      const emptyUri = vscode.Uri.parse(`${proposedEditScheme}:${encodeURIComponent(absolutePath)}?empty`);
      this.provider.set(emptyUri, '');
      originalUri = emptyUri;
    } else {
      originalUri = vscode.Uri.file(absolutePath);
    }

    // Right side: proposed content via virtual URI
    const proposedUri = vscode.Uri.parse(
      `${proposedEditScheme}:${encodeURIComponent(absolutePath)}?${nonce}`
    );
    this.provider.set(proposedUri, proposedContent);

    const pending: PendingProposedEdit = {
      absolutePath,
      originalContent,
      proposedContent,
      originalUri,
      proposedUri,
      isNewFile
    };
    this.pendingEdits.set(absolutePath, pending);

    const filename = path.basename(absolutePath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `${filename} ↔ AI Suggestion`,
      { preview: true }
    );
  }

  /**
   * Writes content to a file, creating parent directories as needed.
   */
  private async writeFileContent(absolutePath: string, content: string, isNewFile: boolean): Promise<void> {
    if (isNewFile && !content) {
      // Nothing to write for an empty new file
      return;
    }

    try {
      const uri = vscode.Uri.file(absolutePath);
      // Try via VS Code workspace API first so open editors stay in sync
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      edit.replace(uri, fullRange, content);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    } catch {
      // Fall back to direct fs write (e.g. file does not exist in workspace)
      try {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf8');
      } catch {
        vscode.window.showWarningMessage(`Tauren: Could not write file ${path.basename(absolutePath)}.`);
      }
    }
  }

  private cleanupPending(pending: PendingProposedEdit): void {
    this.provider.delete(pending.proposedUri);
    if (pending.isNewFile) {
      // Also clean up the empty virtual URI used for the left side
      const emptyUri = vscode.Uri.parse(`${proposedEditScheme}:${encodeURIComponent(pending.absolutePath)}?empty`);
      this.provider.delete(emptyUri);
    }
    this.pendingEdits.delete(pending.absolutePath);
  }
}
