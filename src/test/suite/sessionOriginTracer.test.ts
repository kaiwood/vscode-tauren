import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { traceOrigin } from '../../origin/sessionOriginTracer';

suite('SessionOriginTracer', () => {
  test('finds the earliest edit introducing selected text', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tau-origin-'));

    try {
      const laterSession = path.join(dir, 'later.jsonl');
      const earlierSession = path.join(dir, 'earlier.jsonl');

      await fs.writeFile(laterSession, [
        JSON.stringify({ type: 'session', id: 'later', cwd: dir, timestamp: '2026-01-02T00:00:00.000Z' }),
        JSON.stringify({
          type: 'message',
          id: 'later-message',
          timestamp: '2026-01-02T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'later-call',
              name: 'edit',
              arguments: { path: 'src/example.ts', edits: [{ oldText: '', newText: 'const traced = "value";\n' }] }
            }]
          }
        })
      ].join('\n'));

      await fs.writeFile(earlierSession, [
        JSON.stringify({ type: 'session', id: 'earlier', cwd: dir, timestamp: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({
          type: 'message',
          id: 'earlier-message',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'earlier-call',
              name: 'edit',
              arguments: { path: 'src/example.ts', edits: [{ oldText: '', newText: 'const traced = "value";\n' }] }
            }]
          }
        })
      ].join('\n'));

      const match = await traceOrigin([{
        kind: 'selection',
        path: 'src/example.ts',
        absolutePath: path.join(dir, 'src', 'example.ts'),
        text: 'const traced = "value";'
      }], { sessionFiles: [laterSession, earlierSession] });

      assert.strictEqual(match?.sessionPath, earlierSession);
      assert.strictEqual(match?.recordId, 'earlier-call');
      assert.strictEqual(match?.toolName, 'edit');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('finds file origin from write tool calls by path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tau-origin-write-'));

    try {
      const sessionFile = path.join(dir, 'session.jsonl');
      await fs.writeFile(sessionFile, [
        JSON.stringify({ type: 'session', id: 'session', cwd: dir, timestamp: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({
          type: 'message',
          id: 'write-message',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'write-call',
              name: 'write',
              arguments: { path: 'src/new.ts', content: 'export const value = 1;\n' }
            }]
          }
        })
      ].join('\n'));

      const match = await traceOrigin([{
        kind: 'file',
        path: 'src/new.ts',
        absolutePath: path.join(dir, 'src', 'new.ts')
      }], { sessionFiles: [sessionFile] });

      assert.strictEqual(match?.sessionPath, sessionFile);
      assert.strictEqual(match?.recordId, 'write-call');
      assert.strictEqual(match?.toolName, 'write');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
