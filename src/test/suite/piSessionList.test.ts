import * as assert from 'assert';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listPiSessions } from '../../piSessionList';

suite('Pi session list', () => {
  test('falls back to current session file directory when cwd is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tau-sessions-'));

    try {
      const sessionPath = join(dir, 'current.jsonl');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'current', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'Current prompt' } })
      ].join('\n') + '\n');

      const sessions = await listPiSessions({ currentSessionFile: sessionPath, env: {} });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].path, sessionPath);
      assert.strictEqual(sessions[0].current, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to all default sessions when the workspace session directory is empty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tau-home-'));

    try {
      const sessionDir = join(home, '.pi', 'agent', 'sessions', '--project--');
      const sessionPath = join(sessionDir, 'other.jsonl');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'other', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/other' }),
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'Other prompt' } })
      ].join('\n') + '\n');

      const originalHome = process.env.HOME;
      process.env.HOME = home;
      try {
        const sessions = await listPiSessions({ cwd: '/workspace', env: {} });
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].path, sessionPath);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('lists sessions with names, message counts, current marker, and fork tree metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tau-sessions-'));

    try {
      const parentPath = join(dir, 'parent.jsonl');
      const childPath = join(dir, 'child.jsonl');

      await writeFile(parentPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'parent', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'Parent prompt', timestamp: Date.parse('2026-01-01T00:00:01.000Z') } }),
        JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Parent answer' }], timestamp: Date.parse('2026-01-01T00:00:02.000Z') } }),
        JSON.stringify({ type: 'session_info', id: 'n1', parentId: 'a1', timestamp: '2026-01-01T00:00:03.000Z', name: 'Parent work' })
      ].join('\n') + '\n');

      await writeFile(childPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'child', timestamp: '2026-01-01T00:01:00.000Z', cwd: '/workspace', parentSession: parentPath }),
        JSON.stringify({ type: 'message', id: 'u2', parentId: null, timestamp: '2026-01-01T00:01:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Child prompt' }] } })
      ].join('\n') + '\n');

      const sessions = await listPiSessions({ sessionDir: dir, currentSessionFile: childPath });

      assert.strictEqual(sessions.length, 2);
      assert.strictEqual(sessions[0].path, parentPath);
      assert.strictEqual(sessions[0].name, 'Parent work');
      assert.strictEqual(sessions[0].firstMessage, 'Parent prompt');
      assert.strictEqual(sessions[0].messageCount, 2);
      assert.strictEqual(sessions[0].depth, 0);
      assert.strictEqual(sessions[0].current, false);
      assert.strictEqual(sessions[1].path, childPath);
      assert.strictEqual(sessions[1].firstMessage, 'Child prompt');
      assert.strictEqual(sessions[1].messageCount, 1);
      assert.strictEqual(sessions[1].depth, 1);
      assert.strictEqual(sessions[1].isLast, true);
      assert.deepStrictEqual(sessions[1].ancestorContinues, [false]);
      assert.strictEqual(sessions[1].current, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
