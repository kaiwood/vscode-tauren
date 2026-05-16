import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getToolExecutionDiffStats, parseSessionDiffStats, SessionDiffTracker } from '../../sessionDiffTracker';

suite('SessionDiffTracker', () => {
  test('counts historical edit and write tool changes', () => {
    assert.deepStrictEqual(
      getToolExecutionDiffStats({
        toolName: 'edit',
        args: { edits: [{ oldText: 'one\ntwo\n', newText: 'one\nTWO\nthree\n' }] }
      }),
      { addedLines: 3, removedLines: 2 }
    );

    assert.deepStrictEqual(
      getToolExecutionDiffStats({ toolName: 'write', args: { content: 'a\nb\n' } }),
      { addedLines: 2, removedLines: 0 }
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

  test('parses session JSONL tool execution events', () => {
    const content = [
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
    ].join('\n');

    assert.deepStrictEqual(parseSessionDiffStats(content), { addedLines: 3, removedLines: 1 });
  });

  test('falls back to assistant tool calls when execution events are unavailable', () => {
    const content = JSON.stringify({
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
    });

    assert.deepStrictEqual(parseSessionDiffStats(content), { addedLines: 2, removedLines: 1 });
  });

  test('restores historical stats from session files', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tau-session-diff-history-'));
    const sessionFile = path.join(cwd, 'session.jsonl');
    await fs.writeFile(sessionFile, JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'edit',
      args: { edits: [{ oldText: 'old\n', newText: 'new\nnext\n' }] }
    }));

    const tracker = new SessionDiffTracker({ stats: { addedLines: 10, removedLines: 10 } });

    assert.deepStrictEqual(await tracker.restoreFromSessionFile(sessionFile), { addedLines: 2, removedLines: 1 });
  });
});
