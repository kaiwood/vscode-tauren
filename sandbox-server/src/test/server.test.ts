import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createProtocolConnection, Requests, Notifications, PROTOCOL_VERSION, TaurenErrorCodes,
  ResponseError, type EventParams, type InitializeParams
} from '../protocol/index.js';

const deadlineMs = 12_000;
const testOptions = { timeout: 35_000 };
const main = fileURLToPath(new URL('../main.js', import.meta.url));
const extension = fileURLToPath(new URL('./fixtures/offline-provider.js', import.meta.url));

async function bounded<T>(promise: PromiseLike<T>, description: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve(promise), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), deadlineMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** The only runtime access is the child process's public framed connection. */
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'tauren-server-'));
  const workspace = path.join(directory, 'workspace');
  const agent = path.join(directory, 'agent');
  const sessionDirectory = path.join(directory, 'sessions');
  const wrongSessions = path.join(directory, 'wrong-environment-sessions');
  await Promise.all([workspace, agent, sessionDirectory].map(dir => mkdir(dir)));
  await writeFile(path.join(agent, 'settings.json'), JSON.stringify({
    defaultProvider: 'offline', defaultModel: 'scripted', extensions: [extension],
    compaction: { enabled: false }, retry: { enabled: false }
  }));
  const cleanups: (() => Promise<void>)[] = [];
  const params: InitializeParams = {
    protocolVersion: PROTOCOL_VERSION, clientVersion: 'offline-integration-test', workspace, sessionDirectory
  };

  function launch() {
    // Deliberately do not inherit credentials, provider endpoints, NODE_OPTIONS,
    // or the developer's Pi settings. No fixture switches enter production code.
    const child = spawn(process.execPath, [main], {
      cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory,
        TMPDIR: directory, NO_COLOR: '1', PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: wrongSessions }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { stderr += data; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    // Attach immediately, including when a request fails before awaiting exit.
    void exited.catch(() => undefined);
    const protocolErrors: unknown[] = [];
    const client = createProtocolConnection(child.stdout, child.stdin, {
      error: message => protocolErrors.push(message), warn() {}, info() {}, log() {}
    });
    client.onError(error => protocolErrors.push(error));
    const events: EventParams[] = [];
    const listeners = new Set<() => void>();
    client.onNotification(Notifications.event, event => {
      events.push(event);
      for (const listener of listeners) listener();
    });
    client.listen();
    const server = {
      child, client, events,
      get stderr() { return stderr; },
      async waitForEvent(predicate: (event: EventParams) => boolean) {
        let check: (() => void) | undefined;
        try {
          return await bounded(new Promise<EventParams>(resolve => {
            check = () => { const event = events.find(predicate); if (event) resolve(event); };
            listeners.add(check);
            check();
          }), 'agent event');
        } catch (error) { throw new Error(`${String(error)}\nstderr: ${stderr}`); }
        finally { if (check) listeners.delete(check); }
      },
      async request<T>(promise: PromiseLike<T>): Promise<T> {
        try { return await bounded(promise, 'protocol response'); }
        catch (error) {
          if (error instanceof ResponseError) throw error;
          throw new Error(`${String(error)}\nstderr: ${stderr}`);
        }
      },
      async exit() {
        const result = await bounded(exited, `child exit; stderr: ${stderr}`);
        assert.deepEqual(result, { code: 0, signal: null }, stderr);
        assert.deepEqual(protocolErrors, [], `stdout must contain only framed protocol messages; stderr: ${stderr}`);
      },
      async shutdown() {
        assert.equal(await server.request(client.sendRequest(Requests.shutdown, null)), null);
        child.stdin.end();
        await server.exit();
      },
      async close() {
        client.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await bounded(exited, 'forced child cleanup');
      }
    };
    cleanups.push(() => server.close());
    return server;
  }

  return { directory, workspace, sessionDirectory, wrongSessions, params, launch,
    async close() {
      try { await Promise.all(cleanups.map(close => close())); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
}

type Server = ReturnType<Awaited<ReturnType<typeof fixture>>['launch']>;

async function completeTurn(server: Server, message: string) {
  const start = server.events.length;
  assert.equal(await server.request(server.client.sendRequest(Requests.prompt, { message })), null);
  await server.waitForEvent(event => server.events.indexOf(event) >= start && event.event.type === 'agent_settled');
  // agent_settled means the SDK has cleared streaming state and automatic work.
  return server.request(server.client.sendRequest(Requests.getMessages, null));
}

async function rejectsCode(promise: PromiseLike<unknown>, code: number) {
  await assert.rejects(Promise.resolve(promise), error => {
    assert.ok(error instanceof ResponseError);
    assert.equal(error.code, code);
    return true;
  });
}

test('real SDK handshake, preinitialize guard, duplicate initialize, and acknowledged shutdown', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await rejectsCode(s.request(s.client.sendRequest(Requests.getState, null)), TaurenErrorCodes.NotInitialized);
    await rejectsCode(s.request(s.client.sendRequest(Requests.prompt, { message: 'not initialized' })), TaurenErrorCodes.NotInitialized);
    const result = await s.request(s.client.sendRequest(Requests.initialize, f.params));
    assert.equal(result.protocolVersion, PROTOCOL_VERSION);
    assert.match(result.serverVersion, /^\d+\.\d+\.\d+/);
    const sdkManifest = JSON.parse(await readFile(new URL('../../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url), 'utf8'));
    assert.equal(result.piVersion, sdkManifest.version);
    assert.equal(result.workspace, f.workspace);
    assert.equal(result.sessionDirectory, f.sessionDirectory);
    assert.match(s.stderr, /offline fixture loaded/);
    for (const method of ['initialize', 'shutdown', 'chat.prompt', 'runtime.getState',
      'runtime.getSessionStats', 'session.getMessages', 'session.getLastAssistantText']) {
      assert.ok(result.capabilities.includes(method), `Missing capability: ${method}`);
    }
    await rejectsCode(s.request(s.client.sendRequest(Requests.initialize, f.params)), TaurenErrorCodes.AlreadyInitialized);
    // Declared later-step methods are not advertised as working capabilities.
    assert.ok(!result.capabilities.includes(Requests.setModel.method));
    await rejectsCode(s.request(s.client.sendRequest(Requests.setModel, { provider: 'offline', modelId: 'scripted' })), -32601);
    await rejectsCode(s.request(s.client.sendRequest(Requests.prompt, { message: 'unsupported', streamingBehavior: 'steer' })), -32602);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), { messages: [] });
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getLastAssistantText, null)), { text: null });
    const state = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.equal(state.isStreaming, false);
    assert.deepEqual({ provider: (state.model as { provider: string }).provider,
      id: (state.model as { id: string }).id }, { provider: 'offline', id: 'scripted' });
    assert.equal(typeof await s.request(s.client.sendRequest(Requests.getSessionStats, null)), 'object');
    await s.shutdown();
  } finally { await f.close(); }
});

test('version mismatch is rejected before initialization and a compatible retry succeeds', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await assert.rejects(s.request(s.client.sendRequest(Requests.initialize, { ...f.params, protocolVersion: 99 })), error => {
      assert.ok(error instanceof ResponseError);
      assert.equal(error.code, TaurenErrorCodes.VersionMismatch);
      assert.deepEqual(error.data, { supportedVersion: PROTOCOL_VERSION });
      return true;
    });
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    await s.shutdown();
  } finally { await f.close(); }
});

test('initialize validates JSON parameter types and permits correction without a restart', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    for (const params of [null, {}, { ...f.params, protocolVersion: '1' }, { ...f.params, clientVersion: false }]) {
      await rejectsCode(s.request(s.client.sendRequest('initialize', params)), -32602);
    }
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    await s.shutdown();
  } finally { await f.close(); }
});

for (const invalid of ['relative workspace', 'missing workspace', 'relative sessions', 'sessions inside workspace',
  'relative sessionFile', 'missing sessionFile', 'sessionFile outside sessions'] as const) {
  test(`initialize rejects ${invalid}`, testOptions, async () => {
    const f = await fixture();
    try {
      const s = f.launch();
      const params = { ...f.params };
      switch (invalid) {
        case 'relative workspace': params.workspace = 'workspace'; break;
        case 'missing workspace': params.workspace = path.join(f.directory, 'missing'); break;
        case 'relative sessions': params.sessionDirectory = 'sessions'; break;
        case 'sessions inside workspace': params.sessionDirectory = path.join(f.workspace, 'sessions'); break;
        case 'relative sessionFile': params.sessionFile = 'session.jsonl'; break;
        case 'missing sessionFile': params.sessionFile = path.join(f.sessionDirectory, 'missing.jsonl'); break;
        case 'sessionFile outside sessions': {
          params.sessionFile = path.join(f.directory, 'outside.jsonl');
          await writeFile(params.sessionFile, JSON.stringify({ type: 'session', version: 3, id: 'outside',
            timestamp: new Date().toISOString(), cwd: f.workspace }) + '\n');
          break;
        }
      }
      await rejectsCode(s.request(s.client.sendRequest(Requests.initialize, params)), TaurenErrorCodes.IncompatibleRuntime);
    } finally { await f.close(); }
  });
}

test('streams ordered SDK events, preserves rpc source and cwd, persists JSONL, and reopens without replay', testOptions, async () => {
  const f = await fixture();
  try {
    const first = f.launch();
    await first.request(first.client.sendRequest(Requests.initialize, f.params));
    const expected = `fixture: source-check [source=rpc;cwd=${f.workspace};processCwd=${f.workspace}]`;
    const history = await completeTurn(first, 'source-check');
    assert.equal((await first.request(first.client.sendRequest(Requests.getLastAssistantText, null))).text, expected);
    // Pi includes system/context messages in its active transcript; assert the
    // conversation roles without assuming those SDK-owned entries are absent.
    assert.deepEqual(history.messages.map(message => (message as { role: string }).role)
      .filter(role => role === 'user' || role === 'assistant'), ['user', 'assistant']);
    const types = first.events.map(event => event.event.type);
    assert.ok(types.indexOf('agent_start') < types.indexOf('message_update'));
    assert.ok(types.indexOf('message_update') < types.indexOf('agent_end'));
    for (let i = 1; i < first.events.length; i++) {
      assert.equal(first.events[i]!.sequence, first.events[i - 1]!.sequence + 1);
    }
    const deltas = first.events.flatMap(({ event }) => {
      const update = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      return update?.type === 'text_delta' ? [update.delta] : [];
    });
    assert.ok(deltas.length >= 2, 'Assistant text must arrive in chunks');
    assert.equal(deltas.join(''), expected);
    const state = await first.request(first.client.sendRequest(Requests.getState, null));
    assert.equal(typeof state.sessionFile, 'string');
    const sessionFile = state.sessionFile as string;
    assert.equal(path.dirname(sessionFile), f.sessionDirectory, 'Explicit session directory overrides environment');
    await first.shutdown();
    const entries = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries[0].type, 'session');
    assert.equal(entries[0].cwd, f.workspace);
    assert.ok(entries.some(entry => entry.type === 'message' && entry.message.role === 'assistant'));
    assert.match(JSON.stringify(entries), /fixture: source-check/);
    assert.deepEqual(await readdir(f.wrongSessions).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }), []);

    const resumed = f.launch();
    await resumed.request(resumed.client.sendRequest(Requests.initialize, { ...f.params, sessionFile }));
    assert.deepEqual(await resumed.request(resumed.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await resumed.request(resumed.client.sendRequest(Requests.getLastAssistantText, null))).text, expected);
    assert.ok(!resumed.events.some(({ event }) => event.type === 'agent_start'), 'Reopening must not replay generation');
    const continued = await completeTurn(resumed, 'second turn');
    assert.equal(continued.messages.filter(message => ['user', 'assistant'].includes(
      (message as { role: string }).role)).length, 4);
    assert.equal((await resumed.request(resumed.client.sendRequest(Requests.getLastAssistantText, null))).text, 'fixture: second turn');
    assert.equal(resumed.events.filter(({ event }) => event.type === 'agent_start').length, 1);
    await resumed.shutdown();
  } finally { await f.close(); }
});

for (const termination of ['shutdown', 'EOF', 'SIGTERM'] as const) {
  test(`${termination} aborts active SDK generation and exits without forced termination`, testOptions, async () => {
    const f = await fixture();
    try {
      const s = f.launch();
      await s.request(s.client.sendRequest(Requests.initialize, f.params));
      // Some implementations acknowledge preflight, others await the whole turn.
      // Handle either public timing without leaving a rejected promise unobserved.
      const prompt = s.request(s.client.sendRequest(Requests.prompt, { message: 'wait-for-abort' })).catch(() => null);
      await s.waitForEvent(({ event }) => {
        const update = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        return update?.type === 'text_delta' && update.delta === 'fixture: waiting';
      });
      assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, true);
      if (termination === 'shutdown') await s.shutdown();
      else {
        if (termination === 'EOF') s.child.stdin.end();
        else s.child.kill('SIGTERM');
        await s.exit();
      }
      await prompt;
    } finally { await f.close(); }
  });
}
