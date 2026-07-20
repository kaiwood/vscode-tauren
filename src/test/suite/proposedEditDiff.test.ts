import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProposedEditDiffService } from '../../diff/proposedEditDiff';
import { ProposedOriginalProvider, ProposedEditProvider, proposedOriginalScheme, proposedEditScheme } from '../../diff/proposedEditProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DiffOpenCall = {
  originalUri: vscode.Uri;
  proposedUri: vscode.Uri;
  title: string;
};

/**
 * Creates a `ProposedEditDiffService` with all VS Code side-effects stubbed
 * out.  Returns the service, the two providers (so tests can inspect virtual
 * document content), and a list of recorded `openDiffEditor` calls.
 */
function makeService(
  cwd: string | undefined,
  onReject?: (absolutePath: string) => void
): {
  service: ProposedEditDiffService;
  originalProvider: ProposedOriginalProvider;
  proposedProvider: ProposedEditProvider;
  diffOpenCalls: DiffOpenCall[];
  closedProposedUris: vscode.Uri[];
  /** Simulate a user edit in the virtual proposed document. */
  setDocumentText: (uri: vscode.Uri, text: string) => void;
} {
  const originalProvider = new ProposedOriginalProvider();
  const proposedProvider = new ProposedEditProvider();
  const diffOpenCalls: DiffOpenCall[] = [];
  const closedProposedUris: vscode.Uri[] = [];
  const documentTexts = new Map<string, string>();

  const service = new ProposedEditDiffService(
    originalProvider,
    proposedProvider,
    () => cwd,
    {
      onReject,
      openDiffEditor: async (originalUri, proposedUri, title) => {
        diffOpenCalls.push({ originalUri, proposedUri, title });
      },
      closeEditorByProposedUri: async (proposedUri) => {
        closedProposedUris.push(proposedUri);
      },
      closeRealFileEditors: async () => {
        // no-op in tests
      },
      getDocumentText: (uriString) => documentTexts.get(uriString)
    }
  );

  return {
    service,
    originalProvider,
    proposedProvider,
    diffOpenCalls,
    closedProposedUris,
    setDocumentText: (uri, text) => documentTexts.set(uri.toString(), text)
  };
}

/** Read a file from disk and return its content, or undefined if it does not exist. */
async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

suite('ProposedEditDiffService', () => {
  let cwd: string;

  setup(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-proposed-edit-'));
  });

  teardown(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  // ── 1. Diff view opens; left = original, right = proposed ──────────────────

  test('opens a diff view with original content on the left and proposed content on the right for a write tool', async () => {
    const filePath = path.join(cwd, 'hello.ts');
    await fs.writeFile(filePath, 'const greeting = "hello";\n', 'utf8');

    const { service, originalProvider, proposedProvider, diffOpenCalls } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const greeting = "hi";\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const greeting = "hi";\n' }
    });

    assert.strictEqual(diffOpenCalls.length, 1, 'Expected exactly one diff editor to open');

    const { originalUri, proposedUri, title } = diffOpenCalls[0];

    assert.strictEqual(originalUri.scheme, proposedOriginalScheme, 'Left URI must use the tauren-original scheme');
    assert.strictEqual(proposedUri.scheme, proposedEditScheme, 'Right URI must use the tauren-proposed scheme');
    assert.ok(title.includes('hello.ts'), 'Diff title must include the filename');

    const originalContent = originalProvider.provideTextDocumentContent(originalUri);
    assert.strictEqual(originalContent, 'const greeting = "hello";\n', 'Left side must show original file content');

    const proposedContent = proposedProvider.get(proposedUri);
    assert.strictEqual(proposedContent, 'const greeting = "hi";\n', 'Right side must show the AI-proposed content');
  });

  test('opens a diff view with original content on the left and proposed content on the right for an edit tool', async () => {
    const filePath = path.join(cwd, 'example.ts');
    await fs.writeFile(filePath, 'const x = 1;\n', 'utf8');

    const { service, originalProvider, proposedProvider, diffOpenCalls } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const x = 1;\n', newText: 'const x = 42;\n' }] }
    });

    await service.handleToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const x = 1;\n', newText: 'const x = 42;\n' }] }
    });

    assert.strictEqual(diffOpenCalls.length, 1, 'Expected exactly one diff editor to open');

    const { originalUri, proposedUri } = diffOpenCalls[0];
    assert.strictEqual(originalProvider.provideTextDocumentContent(originalUri), 'const x = 1;\n');
    assert.strictEqual(proposedProvider.get(proposedUri), 'const x = 42;\n');
  });

  // ── 2. File on disk is NOT modified while the diff is open ─────────────────

  test('file on disk is restored to original content when the diff view opens (write tool)', async () => {
    const filePath = path.join(cwd, 'target.ts');
    await fs.writeFile(filePath, 'original content\n', 'utf8');

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'proposed content\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'proposed content\n' }
    });

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(
      diskContent,
      'original content\n',
      'Disk must show original content while the diff is pending'
    );
  });

  test('new file does not exist on disk while the diff is open', async () => {
    const filePath = path.join(cwd, 'brand-new.ts');
    // File does NOT exist on disk before the tool runs

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'brand new content\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'brand new content\n' }
    });

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, undefined, 'New file must not exist on disk while the diff is pending');
  });

  // ── 3. Reject does not write to disk ───────────────────────────────────────

  test('rejecting a write proposal leaves the original file unchanged on disk', async () => {
    const filePath = path.join(cwd, 'keep.ts');
    await fs.writeFile(filePath, 'original\n', 'utf8');

    const { service, diffOpenCalls } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'proposed\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'proposed\n' }
    });

    assert.strictEqual(diffOpenCalls.length, 1);
    await service.rejectPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, 'original\n', 'Disk must be unchanged after rejecting');
  });

  test('rejecting a write proposal for a new file leaves the file absent from disk', async () => {
    const filePath = path.join(cwd, 'new-rejected.ts');

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'new content\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'new content\n' }
    });

    await service.rejectPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, undefined, 'New file must not be created on disk after rejecting');
  });

  test('rejecting an edit proposal calls the onReject callback', async () => {
    const filePath = path.join(cwd, 'callback.ts');
    await fs.writeFile(filePath, 'const v = 1;\n', 'utf8');

    const rejectedPaths: string[] = [];
    const { service } = makeService(cwd, (p) => rejectedPaths.push(p));

    await service.captureBeforeToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const v = 1;\n', newText: 'const v = 2;\n' }] }
    });

    await service.handleToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const v = 1;\n', newText: 'const v = 2;\n' }] }
    });

    await service.rejectPendingEdit(filePath);

    assert.deepStrictEqual(rejectedPaths, [filePath], 'onReject must be called with the file path');
  });

  // ── 4. Accept writes the proposed content to disk ──────────────────────────

  test('accepting a write proposal writes the proposed content to disk', async () => {
    const filePath = path.join(cwd, 'accept.ts');
    await fs.writeFile(filePath, 'old content\n', 'utf8');

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'new content\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'new content\n' }
    });

    await service.acceptPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, 'new content\n', 'Disk must contain the proposed content after accepting');
  });

  test('accepting an edit proposal writes the result of applied edits to disk', async () => {
    const filePath = path.join(cwd, 'edited.ts');
    await fs.writeFile(filePath, 'const a = 1;\n', 'utf8');

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const a = 1;\n', newText: 'const a = 99;\n' }] }
    });

    await service.handleToolExecution({
      toolName: 'edit',
      args: { path: filePath, edits: [{ oldText: 'const a = 1;\n', newText: 'const a = 99;\n' }] }
    });

    await service.acceptPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, 'const a = 99;\n', 'Disk must contain the edited content after accepting');
  });

  test('accepting a new-file proposal creates the file on disk', async () => {
    const filePath = path.join(cwd, 'created.ts');

    const { service } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'export const created = true;\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'export const created = true;\n' }
    });

    await service.acceptPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(diskContent, 'export const created = true;\n', 'New file must be created on disk after accepting');
  });

  // ── 5. Accept uses the live document text (user edits before accepting) ─────

  test('if the user edits the proposed virtual document before accepting, the edited content is written to disk', async () => {
    const filePath = path.join(cwd, 'user-edits.ts');
    await fs.writeFile(filePath, 'const original = true;\n', 'utf8');

    const { service, diffOpenCalls, setDocumentText } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const aiProposed = true;\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const aiProposed = true;\n' }
    });

    assert.strictEqual(diffOpenCalls.length, 1, 'Expected diff to open before user edits');

    // Simulate the user typing into the right-hand (proposed) virtual document
    const proposedUri = diffOpenCalls[0].proposedUri;
    setDocumentText(proposedUri, 'const userModified = true;\n');

    await service.acceptPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.strictEqual(
      diskContent,
      'const userModified = true;\n',
      'Disk must contain the user-modified content, not the original AI proposal'
    );
  });

  test('if the user edits the proposed document before accepting, the AI proposal is NOT written to disk', async () => {
    const filePath = path.join(cwd, 'override-check.ts');
    await fs.writeFile(filePath, 'const v = 0;\n', 'utf8');

    const { service, diffOpenCalls, setDocumentText } = makeService(cwd);

    await service.captureBeforeToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const v = 1;\n' }
    });

    await service.handleToolExecution({
      toolName: 'write',
      args: { path: filePath, content: 'const v = 1;\n' }
    });

    const proposedUri = diffOpenCalls[0].proposedUri;
    setDocumentText(proposedUri, 'const v = 999;\n');

    await service.acceptPendingEdit(filePath);

    const diskContent = await readFileOrUndefined(filePath);
    assert.notStrictEqual(diskContent, 'const v = 1;\n', 'AI proposal must not be written when user edited the document');
    assert.strictEqual(diskContent, 'const v = 999;\n', 'User-edited content must be on disk');
  });
});
