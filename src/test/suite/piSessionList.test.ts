import * as assert from 'assert';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listPiSessionCandidates, listPiSessions } from '../../sessions/piSessionList';
import { readSessionMetadataCache, writeSessionMetadataCache } from '../../sessions/sessionMetadataCache';

suite('Pi session list', () => {
  test('lists lightweight session candidates from headers only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-session-candidates-'));

    try {
      const sessionPath = join(dir, 'candidate.jsonl');
      const ignoredPath = join(dir, 'ignored.txt');
      const malformedPath = join(dir, 'malformed.jsonl');

      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'candidate', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
        '{not-json',
        JSON.stringify({ type: 'message', id: 'u1', message: { role: 'user', content: 'Should not be needed' } })
      ].join('\n') + '\n');
      await writeFile(ignoredPath, JSON.stringify({ type: 'session', id: 'ignored', cwd: '/workspace' }));
      await writeFile(malformedPath, JSON.stringify({ type: 'message', id: 'not-a-session' }) + '\n');

      const candidates = await listPiSessionCandidates({ sessionDir: dir });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].path, sessionPath);
      assert.strictEqual(candidates[0].id, 'candidate');
      assert.strictEqual(candidates[0].cwd, '/workspace');
      assert.ok(candidates[0].mtimeMs > 0);
      assert.ok(candidates[0].size > 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to current session file directory when cwd is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-'));

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

  test('does not fall back to other default workspace session directories', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tauren-home-'));

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
        assert.strictEqual(sessions.length, 0);
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

  test('truncates long first messages in session list metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-'));

    try {
      const sessionPath = join(dir, 'long-message.jsonl');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'long-message', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'A'.repeat(600) } })
      ].join('\n') + '\n');

      const sessions = await listPiSessions({ sessionDir: dir });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].firstMessage.length, 500);
      assert.strictEqual(sessions[0].firstMessage, 'A'.repeat(499) + '…');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('ignores corrupt persisted metadata cache files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-cache-corrupt-'));

    try {
      const cacheFile = join(dir, 'storage', 'sessionMetadataCache.json');
      await mkdir(join(dir, 'storage'), { recursive: true });
      await writeFile(cacheFile, '{not-json\n');

      const cache = await readSessionMetadataCache(cacheFile);

      assert.strictEqual(cache.size, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('uses persisted metadata for unchanged session files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-cache-'));

    try {
      const sessionPath = join(dir, 'cached.jsonl');
      const cacheFile = join(dir, 'storage', 'sessionMetadataCache.json');
      await writeFile(sessionPath, '{not-json\n');
      const sessionStats = await stat(sessionPath);

      await writeSessionMetadataCache(cacheFile, [{
        mtimeMs: sessionStats.mtimeMs,
        size: sessionStats.size,
        session: {
          path: sessionPath,
          id: 'cached',
          cwd: '/workspace',
          name: 'Cached work',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:00:01.000Z',
          messageCount: 3,
          firstMessage: 'Cached prompt'
        }
      }]);

      const progress: number[] = [];
      const metrics: Array<{ sessionCount: number; totalBytes: number; cacheHits: number; cacheMisses: number }> = [];
      const sessions = await listPiSessions({
        sessionDir: dir,
        sessionMetadataCacheFile: cacheFile,
        onProgress: (items) => progress.push(items.length),
        onMetrics: (entry) => metrics.push(entry)
      });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].name, 'Cached work');
      assert.deepStrictEqual(progress, [1]);
      assert.strictEqual(metrics.length, 1);
      assert.strictEqual(metrics[0].sessionCount, 1);
      assert.strictEqual(metrics[0].cacheHits, 1);
      assert.strictEqual(metrics[0].cacheMisses, 0);
      assert.ok(metrics[0].totalBytes > 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('invalidates persisted metadata when session file stats change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-cache-stale-'));

    try {
      const sessionPath = join(dir, 'stale.jsonl');
      const cacheFile = join(dir, 'storage', 'sessionMetadataCache.json');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'stale', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'Fresh prompt' } })
      ].join('\n') + '\n');
      const sessionStats = await stat(sessionPath);

      await writeSessionMetadataCache(cacheFile, [{
        mtimeMs: sessionStats.mtimeMs - 1,
        size: sessionStats.size,
        session: {
          path: sessionPath,
          id: 'stale',
          cwd: '/workspace',
          name: 'Stale cached work',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:00:01.000Z',
          messageCount: 99,
          firstMessage: 'Stale prompt'
        }
      }]);

      const sessions = await listPiSessions({ sessionDir: dir, sessionMetadataCacheFile: cacheFile });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].name, undefined);
      assert.strictEqual(sessions[0].messageCount, 1);
      assert.strictEqual(sessions[0].firstMessage, 'Fresh prompt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('publishes parsed session progress in batches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-progress-'));

    try {
      for (let index = 0; index < 50; index += 1) {
        await writeFile(join(dir, `session-${index}.jsonl`), [
          JSON.stringify({ type: 'session', version: 3, id: `session-${index}`, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/workspace' }),
          JSON.stringify({ type: 'message', id: `u${index}`, parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: `Prompt ${index}` } })
        ].join('\n') + '\n');
      }

      const progress: number[] = [];
      const sessions = await listPiSessions({
        sessionDir: dir,
        onProgress: (items) => progress.push(items.length)
      });

      assert.strictEqual(sessions.length, 50);
      assert.ok(progress.includes(50));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('lists sessions with names, message counts, current marker, and fork tree metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-sessions-'));

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
