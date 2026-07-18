import * as assert from 'assert';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { listKwardSessionCandidates, listKwardSessions } from '../../kward/sessionList';

type WrittenRequest = {
  id?: number;
  method?: string;
  params?: unknown;
};

class FakeChildProcess {
  public readonly stdin = {
    write: (chunk: Buffer, callback?: (error?: Error | null) => void) => {
      this.writes.push(chunk);
      callback?.();
      return true;
    },
    end: () => {}
  };
  public readonly stdout = {
    on: (event: string, handler: (chunk: Buffer) => void) => {
      if (event === 'data') {
        this.stdoutDataHandler = handler;
      }
    }
  };
  public readonly stderr = { on: () => {} };
  public readonly writes: Buffer[] = [];
  public killed = false;
  private stdoutDataHandler: ((chunk: Buffer) => void) | undefined;

  public on(): void {}
  public kill(): void {
    this.killed = true;
  }

  public respond(id: number, result: unknown): void {
    const body = JSON.stringify({ jsonrpc: '2.0', id, result });
    this.stdoutDataHandler?.(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8'));
  }
}

suite('Kward session list', () => {
  test('uses RPC sessions/list when capability is supported', async () => {
    const child = new FakeChildProcess();
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const sessionsPromise = listKwardSessions({ cwd: '/workspace', currentSessionFile: '/sessions/one.jsonl', kwardPath: tmpdir() });

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      child.respond(1, { capabilities: { sessions: { supported: true, methods: ['sessions/list'] } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], {
        method: 'sessions/list',
        params: { workspaceRoot: '/workspace', currentSessionPath: '/sessions/one.jsonl' }
      });
      child.respond(2, {
        sessions: [
          {
            path: '/sessions/one.jsonl',
            id: 'one',
            workspaceRoot: '/workspace',
            createdAt: '2026-01-01T00:00:00Z',
            modifiedAt: '2026-01-01T00:00:01Z',
            messageCount: 1,
            firstMessage: 'Hello'
          }
        ]
      });

      const sessions = await sessionsPromise;
      assert.deepStrictEqual(sessions.map((session) => ({ path: session.path, current: session.current })), [
        { path: '/sessions/one.jsonl', current: true }
      ]);
      assert.strictEqual(child.writes.length, 2);
    } finally {
      spawned.spawn = originalSpawn;
    }
  });

  test('falls back to local Kward session files when RPC sessions/list is unsupported', async () => {
    const child = new FakeChildProcess();
    const dir = await mkdtemp(join(tmpdir(), 'tauren-kward-rpc-list-fallback-'));
    const originalConfigPath = process.env.KWARD_CONFIG_PATH;
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;
      const cwd = join(dir, 'workspace');
      const configPath = join(dir, '.kward', 'config.json');
      const sessionDir = join(dir, '.kward', 'sessions', safeCwd(cwd));
      await mkdir(sessionDir, { recursive: true });
      process.env.KWARD_CONFIG_PATH = configPath;

      const sessionPath = join(sessionDir, 'local.jsonl');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', id: 'local', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'Local fallback' } })
      ].join('\n') + '\n');

      const sessionsPromise = listKwardSessions({ cwd, kwardPath: tmpdir() });

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      child.respond(1, { capabilities: { sessions: { supported: true, methods: [] } } });

      const sessions = await sessionsPromise;
      assert.deepStrictEqual(sessions.map((session) => session.path), [sessionPath]);
      assert.strictEqual(child.writes.length, 1);
    } finally {
      spawned.spawn = originalSpawn;
      if (originalConfigPath === undefined) {
        delete process.env.KWARD_CONFIG_PATH;
      } else {
        process.env.KWARD_CONFIG_PATH = originalConfigPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('structures local sessions by parent path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-kward-session-tree-'));
    const originalConfigPath = process.env.KWARD_CONFIG_PATH;

    try {
      const cwd = join(dir, 'workspace');
      const configPath = join(dir, '.kward', 'config.json');
      const sessionDir = join(dir, '.kward', 'sessions', safeCwd(cwd));
      await mkdir(sessionDir, { recursive: true });
      process.env.KWARD_CONFIG_PATH = configPath;

      const parentPath = join(sessionDir, 'parent.jsonl');
      const childPath = join(sessionDir, 'child.jsonl');

      await writeFile(parentPath, [
        JSON.stringify({ type: 'session', id: 'parent', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'Parent session' } })
      ].join('\n') + '\n');
      await writeFile(childPath, [
        JSON.stringify({ type: 'session', id: 'child', timestamp: '2026-01-01T00:00:00.000Z', cwd, parentPath }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'Child session' } })
      ].join('\n') + '\n');

      const sessions = await listKwardSessions({ cwd, currentSessionFile: childPath, kwardPath: join(dir, 'missing-kward-rpc') });

      assert.deepStrictEqual(sessions.map((session) => session.path), [parentPath, childPath]);
      assert.strictEqual(sessions[0].depth, 0);
      assert.strictEqual(sessions[0].isLast, true);
      assert.deepStrictEqual(sessions[0].ancestorContinues, []);
      assert.strictEqual(sessions[1].depth, 1);
      assert.strictEqual(sessions[1].isLast, true);
      assert.deepStrictEqual(sessions[1].ancestorContinues, [false]);
      assert.strictEqual(sessions[1].parentSessionPath, parentPath);
      assert.strictEqual(sessions[1].current, true);
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.KWARD_CONFIG_PATH;
      } else {
        process.env.KWARD_CONFIG_PATH = originalConfigPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('lists local session candidates for trace origin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-kward-session-candidates-'));
    const originalConfigPath = process.env.KWARD_CONFIG_PATH;

    try {
      const cwd = join(dir, 'workspace');
      const configPath = join(dir, '.kward', 'config.json');
      const sessionDir = join(dir, '.kward', 'sessions', safeCwd(cwd));
      await mkdir(sessionDir, { recursive: true });
      process.env.KWARD_CONFIG_PATH = configPath;

      const sessionPath = join(sessionDir, 'traceable.jsonl');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', id: 'traceable', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'Trace this session' } })
      ].join('\n') + '\n');

      const candidates = await listKwardSessionCandidates({ cwd, kwardPath: join(dir, 'missing-kward-rpc') });

      assert.deepStrictEqual(candidates, [{ path: sessionPath, id: 'traceable', cwd }]);
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.KWARD_CONFIG_PATH;
      } else {
        process.env.KWARD_CONFIG_PATH = originalConfigPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reads local records that cross stream chunk boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-kward-streamed-session-'));
    const originalConfigPath = process.env.KWARD_CONFIG_PATH;

    try {
      const cwd = join(dir, 'workspace');
      const configPath = join(dir, '.kward', 'config.json');
      const sessionDir = join(dir, '.kward', 'sessions', safeCwd(cwd));
      await mkdir(sessionDir, { recursive: true });
      process.env.KWARD_CONFIG_PATH = configPath;

      const sessionPath = join(sessionDir, 'large.jsonl');
      await writeFile(sessionPath, [
        JSON.stringify({ type: 'session', id: 'large', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'x'.repeat(70 * 1024) } }),
        JSON.stringify({ type: 'session_info', name: 'Latest name' })
      ].join('\n') + '\n');

      const sessions = await listKwardSessions({ cwd, kwardPath: join(dir, 'missing-kward-rpc') });

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].messageCount, 1);
      assert.strictEqual(sessions[0].name, 'Latest name');
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.KWARD_CONFIG_PATH;
      } else {
        process.env.KWARD_CONFIG_PATH = originalConfigPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('filters unnamed empty sessions while keeping named or non-empty sessions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tauren-kward-sessions-'));
    const originalConfigPath = process.env.KWARD_CONFIG_PATH;

    try {
      const cwd = join(dir, 'workspace');
      const configPath = join(dir, '.kward', 'config.json');
      const sessionDir = join(dir, '.kward', 'sessions', safeCwd(cwd));
      await mkdir(sessionDir, { recursive: true });
      process.env.KWARD_CONFIG_PATH = configPath;

      const emptyUnnamedPath = join(sessionDir, 'empty-unnamed.jsonl');
      const emptyNamedPath = join(sessionDir, 'empty-named.jsonl');
      const nonEmptyUnnamedPath = join(sessionDir, 'non-empty-unnamed.jsonl');

      await writeFile(emptyUnnamedPath, [
        JSON.stringify({ type: 'session', id: 'empty-unnamed', timestamp: '2026-01-01T00:00:00.000Z', cwd })
      ].join('\n') + '\n');
      await writeFile(emptyNamedPath, [
        JSON.stringify({ type: 'session', id: 'empty-named', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'session_info', name: 'Named draft' })
      ].join('\n') + '\n');
      await writeFile(nonEmptyUnnamedPath, [
        JSON.stringify({ type: 'session', id: 'non-empty-unnamed', timestamp: '2026-01-01T00:00:00.000Z', cwd }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'Keep this session' } })
      ].join('\n') + '\n');

      const sessions = await listKwardSessions({ cwd, kwardPath: join(dir, 'missing-kward-rpc') });

      assert.deepStrictEqual(sessions.map((session) => session.path).sort(), [
        emptyNamedPath,
        nonEmptyUnnamedPath
      ].sort());
      assert.strictEqual(sessions.find((session) => session.path === emptyNamedPath)?.name, 'Named draft');
      assert.strictEqual(sessions.find((session) => session.path === nonEmptyUnnamedPath)?.firstMessage, 'Keep this session');
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.KWARD_CONFIG_PATH;
      } else {
        process.env.KWARD_CONFIG_PATH = originalConfigPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function assertWrittenRequest(chunk: Buffer, expected: { method: string; params?: unknown }): void {
  const request = parseWrittenRequest(chunk);
  assert.strictEqual(request.method, expected.method);
  if ('params' in expected) {
    assert.deepStrictEqual(request.params, expected.params);
  }
}

function parseWrittenRequest(chunk: Buffer): WrittenRequest {
  const text = chunk.toString('utf8');
  const [, body] = text.split('\r\n\r\n');
  return JSON.parse(body) as WrittenRequest;
}

async function waitForWriteCount(child: FakeChildProcess, count: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (child.writes.length >= count) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.fail(`Expected ${count} writes, saw ${child.writes.length}.`);
}

function safeCwd(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}
