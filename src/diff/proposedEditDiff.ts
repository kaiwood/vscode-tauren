import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { proposedOriginalScheme, proposedEditScheme, ProposedOriginalProvider, ProposedEditProvider } from './proposedEditProvider';
import { isRecord } from '../shared/typeGuards';

/**
 * Pending diff waiting for an accept/reject decision.
 *
 * Left side  (originalUri) – read-only virtual showing the "before" content.
 * Right side (proposedUri) – writable virtual showing the "after" content;
 *                             the user may edit this before accepting.
 */
type PendingProposedEdit = {
  absolutePath: string;
  /** The content that was on disk before the agent ran the tool. */
  originalContent: string;
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
 *     - Left side  (tauren-original:) – read-only, shows "before"
 *     - Right side (tauren-proposed:) – editable virtual file, shows "after"
 *  3. The user optionally edits the right side, then:
 *     - Accept (→ `acceptPendingEdit`): reads the current virtual-FS content
 *       (including any user edits) and writes it to the real file on disk.
 *     - Reject (→ `rejectPendingEdit`): leaves the original file untouched,
 *       closes the diff tab, and notifies the AI.
 */
type ProposedEditDiffServiceOptions = {
  onReject?: (absolutePath: string) => void;
};

export class ProposedEditDiffService implements vscode.Disposable {
  private pendingEdits = new Map<string, PendingProposedEdit>();
  /** Snapshots keyed by absolute path, captured before each tool execution. */
  private preExecutionSnapshots = new Map<string, PreExecutionSnapshot>();
  private nonce = 0;
  private readonly onReject: ((absolutePath: string) => void) | undefined;

  public constructor(
    private readonly originalProvider: ProposedOriginalProvider,
    private readonly proposedProvider: ProposedEditProvider,
    private readonly getCwd: () => string | undefined,
    options: ProposedEditDiffServiceOptions = {}
  ) {
    this.onReject = options.onReject;
  }

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
    // Read the already-edited file and show a diff with itself on both sides
    // (degenerate case — user can still review and accept/reject).
    let currentContent: string;

    try {
      currentContent = await fs.readFile(absolutePath, 'utf8');
    } catch {
      return;
    }

    await this.openDiff(absolutePath, currentContent, currentContent, false);
  }

  /**
   * Reads the current content of the writable virtual file (including any
   * user edits), writes it to the real file on disk, closes the diff tab,
   * and cleans up.
   */
  public async acceptPendingEdit(absolutePath: string): Promise<void> {
    const pending = this.pendingEdits.get(absolutePath);

    if (!pending) {
      return;
    }

    // Read the live content from the virtual FS – the user may have edited it
    const acceptedContent = this.proposedProvider.get(pending.proposedUri);
    await this.writeFileContent(absolutePath, acceptedContent, pending.isNewFile);
    await this.closeDiffEditor(pending.proposedUri);
    this.cleanupPending(pending);
  }

  /**
   * Leaves the original (already-restored) file in place, closes the diff
   * editor, notifies the AI that the edit was rejected, and cleans up.
   */
  public async rejectPendingEdit(absolutePath: string): Promise<void> {
    const pending = this.pendingEdits.get(absolutePath);

    if (!pending) {
      return;
    }

    await this.closeDiffEditor(pending.proposedUri);
    this.cleanupPending(pending);
    this.onReject?.(absolutePath);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  /**
   * Restores the file to `originalContent` on disk (undoing the agent's write),
   * seeds both virtual providers, then opens the side-by-side diff.
   *
   * Left  (tauren-original:) – read-only, shows originalContent
   * Right (tauren-proposed:) – writable virtual file, shows proposedContent
   */
  private async revertFileThenOpenDiff(
    absolutePath: string,
    originalContent: string,
    proposedContent: string,
    isNewFile: boolean
  ): Promise<void> {
    // Close any dirty VS Code editors for the real file BEFORE reverting,
    // so that VS Code does not auto-save the proposed content back on top of
    // our revert.
    await this.closeRealFileEditors(absolutePath);

    // Restore the file so the workspace reflects the original state
    if (isNewFile) {
      try {
        await fs.unlink(absolutePath);
      } catch {
        // Already gone or couldn't delete — not fatal
      }
    } else {
      await this.writeFileContent(absolutePath, originalContent, false);
    }

    await this.openDiff(absolutePath, originalContent, proposedContent, isNewFile);
  }

  /**
   * Closes all VS Code editor tabs that have the real file open, saving or
   * discarding changes as needed so that no dirty document can undo our revert.
   */
  private async closeRealFileEditors(absolutePath: string): Promise<void> {
    const realUri = vscode.Uri.file(absolutePath);
    const realUriStr = realUri.toString();

    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputText &&
          input.uri.toString() === realUriStr
        ) {
          // Close without saving — we are about to overwrite the file
          await vscode.window.tabGroups.close(tab, true);
        }
      }
    }
  }

  /**
   * Seeds both virtual providers and opens the diff editor.
   * Does NOT touch the real file on disk.
   */
  private async openDiff(
    absolutePath: string,
    originalContent: string,
    proposedContent: string,
    isNewFile: boolean
  ): Promise<void> {
    const nonce = ++this.nonce;

    // Left side: read-only virtual showing the original content
    const originalUri = vscode.Uri.parse(
      `${proposedOriginalScheme}:${encodeURIComponent(absolutePath)}?${nonce}`
    );
    this.originalProvider.set(originalUri, originalContent);

    // Right side: writable virtual showing the proposed content
    const proposedUri = vscode.Uri.parse(
      `${proposedEditScheme}:${encodeURIComponent(absolutePath)}?${nonce}`
    );
    this.proposedProvider.set(proposedUri, proposedContent);

    const pending: PendingProposedEdit = {
      absolutePath,
      originalContent,
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
   * Uses raw fs writes so VS Code's workspace/document layer does not
   * auto-save the file as a side-effect.
   */
  private async writeFileContent(absolutePath: string, content: string, isNewFile: boolean): Promise<void> {
    if (isNewFile && !content) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    } catch {
      vscode.window.showWarningMessage(`Tauren: Could not write file ${path.basename(absolutePath)}.`);
    }
  }

  /**
   * Closes any visible diff editor tab whose right-hand (proposed) URI matches
   * `proposedUri`.
   */
  private async closeDiffEditor(proposedUri: vscode.Uri): Promise<void> {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputTextDiff &&
          input.modified.toString() === proposedUri.toString()
        ) {
          await vscode.window.tabGroups.close(tab, true);
          return;
        }
      }
    }
  }

  private cleanupPending(pending: PendingProposedEdit): void {
    this.originalProvider.delete(pending.originalUri);
    this.proposedProvider.delete(pending.proposedUri);
    this.pendingEdits.delete(pending.absolutePath);
  }
}
