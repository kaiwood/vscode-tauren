import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getToolExecutionDiffStats, parseSessionBestEffortFileDiffsFromFile, parseSessionDiffStatsFromFile, parseSessionFileDiffsFromFile, SessionDiffTracker } from '../../diff/sessionDiffTracker';

suite('SessionDiffTracker', () => {
  test('counts actual changed edit lines and write tool content lines', () => {
    assert.deepStrictEqual(
      getToolExecutionDiffStats({
        toolName: 'edit',
        args: { edits: [{ oldText: 'one\ntwo\n', newText: 'one\nTWO\nthree\n' }] }
      }),
      { addedLines: 2, removedLines: 1 }
    );

    assert.deepStrictEqual(
      getToolExecutionDiffStats({ toolName: 'write', args: { content: 'a\nb\n' } }),
      { addedLines: 2, removedLines: 0 }
    );
  });

  test('prefers edit result unified diff stats over replacement text size', () => {
    assert.deepStrictEqual(
      getToolExecutionDiffStats({
        toolName: 'edit',
        args: { edits: [{ oldText: 'one\ntwo\nthree\n', newText: 'one\nTWO\nthree\n' }] },
        result: { details: { diff: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n' } }
      }),
      { addedLines: 1, removedLines: 1 }
    );
  });

  test('adds live tool executions cumulatively and restores snapshots', () => {
    const tracker = new SessionDiffTracker();
    tracker.addToolExecution({
      toolName: 'edit',
      args: { edits: [{ oldText: 'old\n', newText: 'new\nnext\n' }] }
    });
    tracker.addToolExecution({ toolName: 'write', args: { content: 'created\n' } });

    assert.deepStrictEqual(tracker.getStats(), { addedLines: 3, removedLines: 1 });
    assert.deepStrictEqual(new SessionDiffTracker(tracker.snapshot()).getStats(), { addedLines: 3, removedLines: 1 });
  });

  test('parses session JSONL tool execution events from session files', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-history-'));
    const sessionFile = path.join(cwd, 'session.jsonl');
    await fs.writeFile(sessionFile, [
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { edits: [{ oldText: 'old\n', newText: 'new\nnext\n' }] }
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'write',
        args: { content: 'created\n' }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionDiffStatsFromFile(sessionFile), { addedLines: 3, removedLines: 1 });
  });

  test('falls back to assistant tool calls when execution events are unavailable', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-tool-calls-'));
    const sessionFile = path.join(cwd, 'session.jsonl');
    await fs.writeFile(sessionFile, JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            name: 'edit',
            arguments: { edits: [{ oldText: 'old\n', newText: 'new\nnext\n' }] }
          }
        ]
      }
    }));

    assert.deepStrictEqual(await parseSessionDiffStatsFromFile(sessionFile), { addedLines: 2, removedLines: 1 });
  });

  test('reconstructs per-file session diffs', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-files-'));
    const sessionFile = path.join(cwd, 'session.jsonl');
    const editedFile = path.join(cwd, 'src', 'example.ts');
    await fs.mkdir(path.dirname(editedFile), { recursive: true });

    await fs.writeFile(editedFile, 'const value = 2;\n');
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: 'src/example.ts', edits: [{ oldText: 'const value = 1;\n', newText: 'const value = 2;\n' }] }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionFileDiffsFromFile(sessionFile), [{
      path: 'src/example.ts',
      absolutePath: editedFile,
      originalContent: 'const value = 1;\n',
      modifiedContent: 'const value = 2;\n'
    }]);
  });

  test('skips absolute session diff paths outside the session cwd', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-absolute-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const sessionFile = path.join(cwd, 'session.jsonl');

    await fs.writeFile(outsideFile, 'new\n');
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: outsideFile, edits: [{ oldText: 'old\n', newText: 'new\n' }] }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionFileDiffsFromFile(sessionFile), []);
  });

  test('skips traversal session diff paths outside the session cwd', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-parent-'));
    const cwd = path.join(parent, 'cwd');
    const outsideFile = path.join(parent, 'outside.txt');
    const sessionFile = path.join(cwd, 'session.jsonl');

    await fs.mkdir(cwd);
    await fs.writeFile(outsideFile, 'new\n');
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: '../outside.txt', edits: [{ oldText: 'old\n', newText: 'new\n' }] }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionFileDiffsFromFile(sessionFile), []);
  });

  test('keeps valid in-cwd session diffs when skipping outside paths', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-mixed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-mixed-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const sessionFile = path.join(cwd, 'session.jsonl');
    const editedFile = path.join(cwd, 'inside.txt');

    await fs.writeFile(editedFile, 'inside new\n');
    await fs.writeFile(outsideFile, 'outside new\n');
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: 'inside.txt', edits: [{ oldText: 'inside old\n', newText: 'inside new\n' }] }
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: outsideFile, edits: [{ oldText: 'outside old\n', newText: 'outside new\n' }] }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionFileDiffsFromFile(sessionFile), [{
      path: 'inside.txt',
      absolutePath: editedFile,
      originalContent: 'inside old\n',
      modifiedContent: 'inside new\n'
    }]);
  });

  test('skips outside paths in synthetic session diffs when cwd is known', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-synthetic-boundary-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-synthetic-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const sessionFile = path.join(cwd, 'session.jsonl');

    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: 'missing.txt', edits: [{ oldText: 'inside old\n', newText: 'inside new\n' }] }
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'edit',
        args: { path: outsideFile, edits: [{ oldText: 'outside old\n', newText: 'outside new\n' }] }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionBestEffortFileDiffsFromFile(sessionFile), {
      reconstructed: false,
      diffs: [{
        path: 'missing.txt',
        absolutePath: path.join(cwd, 'missing.txt'),
        originalContent: 'inside old\n',
        modifiedContent: 'inside new\n'
      }]
    });
  });

  test('falls back to recorded edit snippets when full file reconstruction is unavailable', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-synthetic-'));
    const sessionFile = path.join(cwd, 'session.jsonl');

    await fs.writeFile(sessionFile, JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'edit',
      args: { path: 'src/example.ts', edits: [{ oldText: 'const value = 1;\n', newText: 'const value = 2;\n' }] }
    }));

    assert.deepStrictEqual(await parseSessionBestEffortFileDiffsFromFile(sessionFile), {
      reconstructed: false,
      diffs: [{
        path: 'src/example.ts',
        absolutePath: path.resolve('/', 'src/example.ts'),
        originalContent: 'const value = 1;\n',
        modifiedContent: 'const value = 2;\n'
      }]
    });
  });

  test('restores net historical stats across repeated edits to the same file', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-net-'));
    const sessionFile = path.join(cwd, 'session.jsonl');
    const editedFile = path.join(cwd, 'example.txt');

    await fs.writeFile(editedFile, 'one\nTHREE\n');
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: 'session', cwd }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              name: 'edit',
              arguments: { path: 'example.txt', edits: [{ oldText: 'one\ntwo\n', newText: 'one\nTWO\n' }] }
            }
          ]
        }
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              name: 'edit',
              arguments: { path: 'example.txt', edits: [{ oldText: 'TWO\n', newText: 'THREE\n' }] }
            }
          ]
        }
      })
    ].join('\n'));

    assert.deepStrictEqual(await parseSessionDiffStatsFromFile(sessionFile), { addedLines: 1, removedLines: 1 });
  });
});
