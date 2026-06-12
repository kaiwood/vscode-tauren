import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { KwardClient } from '../../kward/kwardClient';

type WrittenRequest = {
  jsonrpc?: string;
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
  public readonly stdout = { on: () => {} };
  public readonly stderr = { on: () => {} };
  public readonly writes: Buffer[] = [];
  public killed = false;

  public on(): void {}
  public kill(): void {
    this.killed = true;
  }
}

suite('KwardClient', () => {
  test('compact is gated by initialize capabilities', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const compactPromise = assert.rejects(
        client.compact('Keep decisions.'),
        /Kward backend does not support compaction from Tauren yet\./
      );

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { sessions: { compact: { supported: false } } } });

      await compactPromise;
      assert.strictEqual(child.writes.length, 1);
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('answerQuestion initializes and sends ui/answerQuestion without requiring an existing session', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const answerPromise = client.answerQuestion('session-1', 'question-1', [{ question: 'Continue?', answer: 'Yes' }]);

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { extensionUi: { uiQuestion: { supported: true } } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], {
        method: 'ui/answerQuestion',
        params: {
          sessionId: 'session-1',
          questionRequestId: 'question-1',
          answers: [{ question: 'Continue?', answer: 'Yes' }]
        }
      });
      respond(client, 2, { ok: true });
      await answerPromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('uses sessions/list ancestry as tree fallback when sessions/tree is unsupported', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ cwd: '/workspace', kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const treePromise = client.getSessionTree();

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { sessions: { tree: { supported: false } } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], {
        method: 'sessions/create',
        params: { workspaceRoot: '/workspace' }
      });
      respond(client, 2, { id: 'session-1', persistentId: 'parent-id', path: '/sessions/parent.jsonl' });

      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'sessions/list',
        params: { workspaceRoot: '/workspace', limit: 100 }
      });
      respond(client, 3, {
        sessions: [
          { path: '/sessions/parent.jsonl', name: 'Parent', depth: 0, isLast: true, ancestorContinues: [] },
          { path: '/sessions/child.jsonl', firstMessage: 'Child prompt', depth: 1, isLast: true, ancestorContinues: [false] }
        ]
      });

      assert.deepStrictEqual(await treePromise, [
        {
          entryId: '/sessions/parent.jsonl',
          role: 'session',
          text: 'Parent',
          current: true,
          depth: 0,
          isLast: true,
          ancestorContinues: [],
          activePath: true,
          prefix: ''
        },
        {
          entryId: '/sessions/child.jsonl',
          role: 'session',
          text: 'Child prompt',
          current: false,
          depth: 1,
          isLast: true,
          ancestorContinues: [false],
          activePath: false,
          prefix: '└─ '
        }
      ]);
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('navigates Kward session ancestry tree by switching sessions when sessions/tree navigation is unsupported', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ cwd: '/workspace', kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const navigatePromise = client.navigateTree('/sessions/child.jsonl');

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { sessions: { tree: { supported: false } } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], {
        method: 'sessions/resume',
        params: { path: '/sessions/child.jsonl', workspaceRoot: '/workspace' }
      });
      respond(client, 2, { id: 'session-2', persistentId: 'child-id', path: '/sessions/child.jsonl' });

      assert.deepStrictEqual(await navigatePromise, {});
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('surfaces Kward footer notifications through the extension footer bridge', async () => {
    const child = new FakeChildProcess();
    const footers: Array<unknown> = [];
    const client = new KwardClient({
      kwardPath: createKwardPath(),
      extensionUi: {
        notify: () => undefined,
        select: async () => undefined,
        confirm: async () => undefined,
        input: async () => undefined,
        setFooter: (factory) => footers.push(factory)
      }
    });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const statePromise = client.getState();
      await waitForWriteCount(child, 1);
      respond(client, 1, { capabilities: {} });
      await waitForWriteCount(child, 2);
      respond(client, 2, { id: 'session-1', persistentId: 'persisted-1', path: '/tmp/session.jsonl' });
      await waitForWriteCount(child, 3);

      notify(client, 'ui/footer', { sessionId: 'other-session', text: 'Ignored footer' });
      assert.deepStrictEqual(footers, []);

      notify(client, 'ui/footer', { sessionId: 'session-1', text: 'Kward footer' });
      assert.strictEqual(footers.length, 1);
      assert.deepStrictEqual((footers[0] as () => { render(): string[] })().render(), ['Kward footer']);

      notify(client, 'ui/footer', { sessionId: 'session-1', text: '' });
      assert.deepStrictEqual(footers.slice(1), [undefined]);

      respond(client, 3, { sessionId: 'persisted-1' });
      await statePromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('maps Kward session/event compaction notifications for the active session', async () => {
    const child = new FakeChildProcess();
    const events: unknown[] = [];
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;
      client.onEvent((event) => events.push(event));

      const statePromise = client.getState();
      await waitForWriteCount(child, 1);
      respond(client, 1, { capabilities: {} });
      await waitForWriteCount(child, 2);
      respond(client, 2, { id: 'session-1', persistentId: 'persisted-1', path: '/tmp/session.jsonl' });
      await waitForWriteCount(child, 3);

      notify(client, 'session/event', { sessionId: 'other-session', type: 'compactionStart', payload: {} });
      assert.deepStrictEqual(events, []);

      notify(client, 'session/event', { sessionId: 'session-1', type: 'compactionStart', payload: {} });
      notify(client, 'session/event', {
        sessionId: 'session-1',
        type: 'compactionEnd',
        payload: {
          result: { summary: 'Compacted' },
          aborted: false,
          willRetry: false,
          errorMessage: null
        }
      });

      assert.deepStrictEqual(events, [
        { type: 'compaction_start' },
        {
          type: 'compaction_end',
          result: { summary: 'Compacted' },
          aborted: false,
          willRetry: false,
          errorMessage: undefined
        }
      ]);

      respond(client, 3, { sessionId: 'persisted-1' });
      await statePromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('prompt command expansion calls prompts/expand before prompt sends turns/start', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const expandPromise = client.expandPromptCommand('plan', 'fix bug');

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { commands: { supported: true } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], { method: 'sessions/create' });
      respond(client, 2, { id: 'session-1', persistentId: 'persisted-1', path: '/tmp/session.jsonl' });

      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'prompts/expand',
        params: {
          command: 'plan',
          arguments: 'fix bug'
        }
      });
      respond(client, 3, { input: 'expanded plan prompt' });
      assert.strictEqual(await expandPromise, 'expanded plan prompt');

      const promptPromise = client.prompt(await expandPromise);
      await waitForWriteCount(child, 4);
      assertWrittenRequest(child.writes[3], {
        method: 'turns/start',
        params: {
          sessionId: 'session-1',
          input: 'expanded plan prompt'
        }
      });
      respond(client, 4, { id: 'turn-1', sessionId: 'session-1', status: 'running' });
      await promptPromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('shares initial session resume across concurrent startup requests', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ cwd: '/workspace', sessionFile: '/tmp/resumed.jsonl', kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const messagesPromise = client.getMessages();
      const statePromise = client.getState();
      const statsPromise = client.getSessionStats();

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: {} });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], {
        method: 'sessions/resume',
        params: { path: '/tmp/resumed.jsonl', workspaceRoot: '/workspace' }
      });
      respond(client, 2, { id: 'rpc-resumed', persistentId: 'persist-resumed', path: '/tmp/resumed.jsonl' });

      await waitForWriteCount(child, 5);
      const startupRequests = child.writes.map(parseWrittenRequest);
      assert.strictEqual(startupRequests.filter((request) => request.method === 'sessions/resume').length, 1);

      for (const request of startupRequests.slice(2)) {
        assert.deepStrictEqual(request.params, { sessionId: 'rpc-resumed' });

        if (request.method === 'sessions/transcript') {
          respond(client, request.id ?? 0, {
            session: { id: 'rpc-resumed', persistentId: 'persist-resumed', path: '/tmp/resumed.jsonl' },
            messages: [{ role: 'user', content: 'Restored prompt' }]
          });
        } else if (request.method === 'runtime/state') {
          respond(client, request.id ?? 0, {
            rpcSessionId: 'rpc-resumed',
            persistentSessionId: 'persist-resumed',
            sessionFile: '/tmp/resumed.jsonl'
          });
        } else if (request.method === 'runtime/stats') {
          respond(client, request.id ?? 0, {
            rpcSessionId: 'rpc-resumed',
            persistentSessionId: 'persist-resumed',
            sessionFile: '/tmp/resumed.jsonl'
          });
        } else {
          assert.fail(`Unexpected startup request: ${request.method}`);
        }
      }

      assert.deepStrictEqual(await messagesPromise, { messages: [{ role: 'user', content: 'Restored prompt' }] });
      assert.strictEqual((await statePromise).sessionFile, '/tmp/resumed.jsonl');
      assert.strictEqual((await statsPromise).sessionFile, '/tmp/resumed.jsonl');
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('maps active persona label from runtime state', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const statePromise = client.getState();

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: {} });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], { method: 'sessions/create' });
      respond(client, 2, { id: 'rpc-session', persistentId: 'persist-session', path: '/tmp/session.jsonl' });

      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'runtime/state',
        params: { sessionId: 'rpc-session' }
      });
      respond(client, 3, {
        rpcSessionId: 'rpc-session',
        persistentSessionId: 'persist-session',
        sessionFile: '/tmp/session.jsonl',
        activePersonaLabel: 'Samantha'
      });

      assert.strictEqual((await statePromise).activePersonaLabel, 'Samantha');
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('ignores stale runtime state success after switching sessions', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const statePromise = client.getState();

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: {} });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], { method: 'sessions/create' });
      respond(client, 2, { id: 'rpc-old', persistentId: 'persist-old', path: '/tmp/old.jsonl' });

      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'runtime/state',
        params: { sessionId: 'rpc-old' }
      });

      const switchPromise = client.switchSession('/tmp/new.jsonl');
      await waitForWriteCount(child, 4);
      assertWrittenRequest(child.writes[3], {
        method: 'sessions/resume',
        params: { path: '/tmp/new.jsonl' }
      });
      respond(client, 4, { id: 'rpc-new', persistentId: 'persist-new', path: '/tmp/new.jsonl' });
      await switchPromise;

      respond(client, 3, {
        rpcSessionId: 'rpc-old',
        persistentSessionId: 'persist-old',
        sessionId: 'persist-old',
        sessionFile: '/tmp/old.jsonl',
        model: { provider: 'openai', id: 'old-model' }
      });

      await assert.rejects(statePromise, (error: unknown) => {
        assert.strictEqual((error as Error).name, 'StaleKwardSessionRequestError');
        return true;
      });

      const statsPromise = client.getSessionStats();
      await waitForWriteCount(child, 5);
      assertWrittenRequest(child.writes[4], {
        method: 'runtime/stats',
        params: { sessionId: 'rpc-new' }
      });
      respond(client, 5, { sessionId: 'persist-new' });
      await statsPromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('ignores stale Unknown session errors but surfaces current Unknown session errors', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const oldStatsPromise = client.getSessionStats();
      await waitForWriteCount(child, 1);
      respond(client, 1, { capabilities: {} });
      await waitForWriteCount(child, 2);
      respond(client, 2, { id: 'rpc-old', persistentId: 'persist-old', path: '/tmp/old.jsonl' });
      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'runtime/stats',
        params: { sessionId: 'rpc-old' }
      });

      const switchPromise = client.switchSession('/tmp/new.jsonl');
      await waitForWriteCount(child, 4);
      respond(client, 4, { id: 'rpc-new', persistentId: 'persist-new', path: '/tmp/new.jsonl' });
      await switchPromise;

      respondError(client, 3, 'Unknown session: rpc-old');
      await assert.rejects(oldStatsPromise, (error: unknown) => {
        assert.strictEqual((error as Error).name, 'StaleKwardSessionRequestError');
        return true;
      });

      const currentStatsPromise = client.getSessionStats();
      await waitForWriteCount(child, 5);
      assertWrittenRequest(child.writes[4], {
        method: 'runtime/stats',
        params: { sessionId: 'rpc-new' }
      });
      respondError(client, 5, 'Unknown session: rpc-new');
      await assert.rejects(currentStatsPromise, /Unknown session: rpc-new/);
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('uses active rpcSessionId for RPC requests instead of persistent IDs', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;

    try {
      spawned.spawn = () => child;

      const statePromise = client.getState();
      await waitForWriteCount(child, 1);
      respond(client, 1, { capabilities: { commands: { supported: true }, startupResources: { supported: true } } });
      await waitForWriteCount(child, 2);
      respond(client, 2, { id: 'rpc-created', persistentId: 'persist-created', path: '/tmp/session.jsonl' });
      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'runtime/state',
        params: { sessionId: 'rpc-created' }
      });
      respond(client, 3, {
        rpcSessionId: 'rpc-runtime',
        persistentSessionId: 'persist-runtime',
        sessionId: 'legacy-persist-runtime',
        sessionFile: '/tmp/session.jsonl'
      });
      const state = await statePromise;
      assert.strictEqual(state.sessionId, 'persist-runtime');

      const statsPromise = client.getSessionStats();
      await waitForWriteCount(child, 4);
      assertWrittenRequest(child.writes[3], {
        method: 'runtime/stats',
        params: { sessionId: 'rpc-runtime' }
      });
      respond(client, 4, { sessionId: 'legacy-persist-runtime' });
      await statsPromise;

      const commandsPromise = client.getCommands();
      await waitForWriteCount(child, 5);
      assertWrittenRequest(child.writes[4], {
        method: 'commands/list',
        params: { sessionId: 'rpc-runtime' }
      });
      respond(client, 5, { commands: [] });
      await commandsPromise;

      const resourcesPromise = client.getStartupResources();
      await waitForWriteCount(child, 6);
      assertWrittenRequest(child.writes[5], {
        method: 'resources/startup',
        params: { sessionId: 'rpc-runtime' }
      });
      respond(client, 6, { sections: [] });
      await resourcesPromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }
  });

  test('compact sends sessions/compact with custom instructions and normalizes result when capability is supported', async () => {
    const child = new FakeChildProcess();
    const client = new KwardClient({ kwardPath: createKwardPath() });
    const spawned = require('node:child_process') as { spawn: unknown };
    const originalSpawn = spawned.spawn;
    let compactResult: unknown;

    try {
      spawned.spawn = () => child;

      const compactPromise = client.compact('Keep decisions.').then((result) => {
        compactResult = result;
      });

      await waitForWriteCount(child, 1);
      assertWrittenRequest(child.writes[0], { method: 'initialize' });
      respond(client, 1, { capabilities: { sessions: { compact: { supported: true } } } });

      await waitForWriteCount(child, 2);
      assertWrittenRequest(child.writes[1], { method: 'sessions/create' });
      respond(client, 2, { id: 'session-1', persistentId: 'persisted-1', path: '/tmp/session.jsonl' });

      await waitForWriteCount(child, 3);
      assertWrittenRequest(child.writes[2], {
        method: 'sessions/compact',
        params: {
          sessionId: 'session-1',
          customInstructions: 'Keep decisions.'
        }
      });
      respond(client, 3, {
        summary: 'Prior context',
        firstKeptEntryId: 'entry-2',
        tokensBefore: 1234,
        details: { source: 'test' }
      });

      await compactPromise;
    } finally {
      spawned.spawn = originalSpawn;
      client.dispose();
    }

    assert.deepStrictEqual(compactResult, {
      summary: 'Prior context',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 1234,
      details: { source: 'test' }
    });
  });
});

function createKwardPath(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tauren-kward-client-test-'));
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  return dir;
}

function assertWrittenRequest(chunk: Buffer, expected: { method: string; params?: unknown }): void {
  const request = parseWrittenRequest(chunk);
  assert.strictEqual(request.jsonrpc, '2.0');
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

function respond(client: KwardClient, id: number, result: unknown): void {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  const message = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8');
  (client as unknown as { transport: { handleStdout(chunk: Buffer): void } }).transport.handleStdout(message);
}

function respondError(client: KwardClient, id: number, messageText: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', id, error: { message: messageText } });
  const message = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8');
  (client as unknown as { transport: { handleStdout(chunk: Buffer): void } }).transport.handleStdout(message);
}

function notify(client: KwardClient, method: string, params: unknown): void {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params });
  const message = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8');
  (client as unknown as { transport: { handleStdout(chunk: Buffer): void } }).transport.handleStdout(message);
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
