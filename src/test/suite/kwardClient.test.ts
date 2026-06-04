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

async function waitForWriteCount(child: FakeChildProcess, count: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (child.writes.length >= count) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.fail(`Expected ${count} writes, saw ${child.writes.length}.`);
}
