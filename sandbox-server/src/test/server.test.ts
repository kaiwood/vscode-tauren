import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CancellationTokenSource } from 'vscode-jsonrpc';
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

  return { directory, workspace, agent, sessionDirectory, wrongSessions, params, launch,
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

/** Poll only observable fixture files/process state, never server internals. */
async function eventually(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await delay(25);
  }
}

/** Linux zombies are no longer executing; kill(0) alone also reports zombies as alive. */
async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform !== 'linux') return true;
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return !/^\d+ \(.*\) Z /.test(stat);
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

/** Ensure the actual bash command has spawned before testing abort/termination. */
async function toolPids(workspace: string): Promise<number[]> {
  const files = ['tool-shell.pid', 'tool-child.pid'].map(name => path.join(workspace, name));
  await eventually(async () => (await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => ''))))
    .every(value => /^\d+\s*$/.test(value)), 'bash PID markers');
  return Promise.all(files.map(async file => Number((await readFile(file, 'utf8')).trim())));
}

/** Last-resort cleanup prevents a failed process-lifecycle assertion leaking fixture tools. */
async function killToolPids(workspace: string): Promise<void> {
  for (const name of ['tool-shell.pid', 'tool-child.pid']) {
    const pid = Number(await readFile(path.join(workspace, name), 'utf8').catch(() => ''));
    if (Number.isSafeInteger(pid) && pid > 1) {
      try { process.kill(pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  }
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
    for (const request of [Requests.abort, Requests.reload, Requests.getAvailableModels, Requests.getCommands,
      Requests.getStartupResources, Requests.setModel, Requests.setThinkingLevel, Requests.updateSetting,
      Requests.getAuthProviders]) {
      assert.ok(result.capabilities.includes(request.method), `Missing step 4 capability: ${request.method}`);
    }
    // Session mutation belongs to a later step, not the step 4 runtime surface.
    assert.ok(!result.capabilities.includes(Requests.setSessionName.method));
    await rejectsCode(s.request(s.client.sendRequest(Requests.setSessionName, { name: 'later' })), -32601);
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

test('runtime models, commands, resources, reload, and credential policy use the real SDK', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    const models = await s.request(s.client.sendRequest(Requests.getAvailableModels, null));
    assert.ok(Array.isArray(models.models));
    for (const id of ['scripted', 'alternate']) {
      assert.ok(models.models.some(model => typeof model === 'object' && model !== null && !Array.isArray(model)
        && model.provider === 'offline' && model.id === id));
    }
    const selected = await s.request(s.client.sendRequest(Requests.setModel, { provider: 'offline', modelId: 'alternate' }));
    assert.equal(selected.id, 'alternate');
    assert.equal(selected.provider, 'offline');
    assert.equal(await s.request(s.client.sendRequest(Requests.setThinkingLevel, { level: 'low' })), null);
    const state = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.equal((state.model as { id: string }).id, 'alternate');
    assert.equal(state.thinkingLevel, 'low');
    const commands = await s.request(s.client.sendRequest(Requests.getCommands, null));
    assert.ok(Array.isArray(commands.commands));
    assert.ok(commands.commands.some(command => typeof command === 'object' && command !== null && !Array.isArray(command)
      && command.name === 'offline-status' && command.source === 'extension'));
    const resources = await s.request(s.client.sendRequest(Requests.getStartupResources, null));
    assert.ok(Array.isArray(resources.sections));
    assert.match(JSON.stringify(resources), /offline-provider/);
    const authBefore = await readFile(path.join(f.agent, 'auth.json'), 'utf8').catch(() => null);
    const providers = await s.request(s.client.sendRequest(Requests.getAuthProviders, null));
    assert.ok(Array.isArray(providers.providers));
    assert.ok(!JSON.stringify(providers).includes('offline-fixture-not-a-secret'));
    assert.ok(!JSON.stringify(providers).includes(f.agent), 'Readiness must not disclose credential source paths');
    for (const request of [Requests.loginWithApiKey, Requests.loginWithOAuth, Requests.logout]) {
      await rejectsCode(s.request(s.client.sendRequest(request, { providerId: 'offline' })), TaurenErrorCodes.CredentialPolicy);
    }
    assert.equal(await readFile(path.join(f.agent, 'auth.json'), 'utf8').catch(() => null), authBefore);
    await completeTurn(s, 'before reload');
    const history = await s.request(s.client.sendRequest(Requests.getMessages, null));
    const sessionFile = (await s.request(s.client.sendRequest(Requests.getState, null))).sessionFile;
    assert.equal(await s.request(s.client.sendRequest(Requests.reload, null)), null);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).sessionFile, sessionFile);
    await completeTurn(s, 'after reload');
    assert.equal((await s.request(s.client.sendRequest(Requests.getLastAssistantText, null))).text, 'fixture: after reload');
    assert.equal(s.events.filter(({ event }) => event.type === 'agent_start').length, 2, 'Reload must not replay history');
    await s.shutdown();
  } finally { await f.close(); }
});

test('live and reload settings are flushed to temporary settings and survive a server restart', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    for (const [settingId, value, applied] of [
      ['hideThinkingBlock', true, 'live'], ['quietStartup', true, 'live'],
      ['steeringMode', 'all', 'live'], ['followUpMode', 'all', 'live'],
      ['images.blockImages', true, 'reload'], ['transport', 'sse', 'reload']
    ] as const) {
      assert.equal((await s.request(s.client.sendRequest(Requests.updateSetting, { settingId, value }))).applied, applied);
    }
    const saved = JSON.parse(await readFile(path.join(f.agent, 'settings.json'), 'utf8'));
    assert.equal(saved.hideThinkingBlock, true);
    assert.equal(saved.images.blockImages, true);
    await s.shutdown();
    const restarted = f.launch();
    await restarted.request(restarted.client.sendRequest(Requests.initialize, f.params));
    const state = await restarted.request(restarted.client.sendRequest(Requests.getState, null));
    assert.equal(state.hideThinkingBlock, true);
    assert.equal(state.quietStartup, true);
    assert.equal(state.steeringMode, 'all');
    assert.equal(state.followUpMode, 'all');
    assert.equal(state.blockImages, true);
    assert.equal(state.transport, 'sse');
    await restarted.shutdown();
  } finally { await f.close(); }
});

test('step 4 rejects malformed and unsupported runtime/chat parameters without mutating state', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    const before = await s.request(s.client.sendRequest(Requests.getState, null));
    for (const [method, params] of [
      ['runtime.setModel', null], ['runtime.setModel', { provider: 'offline', modelId: 5 }],
      ['runtime.setModel', { provider: 'offline', modelId: 'missing' }],
      ['runtime.setThinkingLevel', { level: 'invented' }], ['runtime.setThinkingLevel', { level: false }],
      ['runtime.updateSetting', { settingId: 'quietStartup', value: 'true' }],
      ['runtime.updateSetting', { settingId: 'steeringMode', value: 'invented' }],
      ['runtime.updateSetting', { settingId: 'unknown', value: true }],
      ['runtime.updateSetting', { settingId: 'enabledModels', value: [42] }],
      ['chat.prompt', { message: 1 }], ['chat.prompt', { message: 'bad', streamingBehavior: 'queue' }],
      ['chat.prompt', { message: 'bad', images: [{ type: 'image', data: 123, mimeType: 'image/png' }] }],
      ['chat.abort', { unexpected: true }], ['runtime.reload', []]
    ] as const) {
      await rejectsCode(s.request(s.client.sendRequest(method, params)), -32602);
    }
    const after = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.deepEqual(after.model, before.model);
    assert.equal(after.thinkingLevel, before.thinkingLevel);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), { messages: [] });
    await s.shutdown();
  } finally { await f.close(); }
});

test('image attachments use the normal SDK prompt and persist in user history', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    // Exercise transport/history rather than platform-native image codecs.
    await s.request(s.client.sendRequest(Requests.updateSetting, { settingId: 'images.autoResize', value: false }));
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    await s.request(s.client.sendRequest(Requests.prompt, { message: 'image turn',
      images: [{ type: 'image', mimeType: 'image/png', data }] }));
    await s.waitForEvent(({ event }) => event.type === 'agent_settled');
    const history = await s.request(s.client.sendRequest(Requests.getMessages, null));
    assert.match(JSON.stringify(history.messages.find(message => (message as { role: string }).role === 'user')), /image\/png/);
    await s.shutdown();
  } finally { await f.close(); }
});

test('EOF while an input hook is pending rejects the request and bounds late SDK work', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    const response = s.client.sendRequest(Requests.prompt, { message: 'delayed-preflight' });
    const rejected = assert.rejects(response);
    await eventually(async () => await readFile(path.join(f.workspace, 'preflight-entered'), 'utf8').catch(() => '') === 'entered', 'pending input hook');
    s.child.stdin.end();
    await s.exit();
    await rejected;
  } finally { await f.close(); }
});

test('file completions cross stdio as revision-bound single-use handles invalidated by reload', testOptions, async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.workspace, 'completion target.txt'), 'local file');
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    const request = { id: 'composer', revision: 1, text: '@completion', selectionStart: 11, selectionEnd: 11 };
    const capabilities = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
    assert.ok(capabilities.triggerCharacters.includes('@'));
    const suggestions = await s.request(s.client.sendRequest(Requests.getCompletions, request));
    const item = suggestions.items.find(item => item.label === 'completion target.txt');
    assert.ok(item);
    const application = { id: request.id, revision: request.revision, itemId: item.id };
    const applied = await s.request(s.client.sendRequest(Requests.applyCompletion, application));
    assert.equal(applied?.text, '@"completion target.txt" ');
    assert.equal(await s.request(s.client.sendRequest(Requests.applyCompletion, application)), null);
    const fresh = await s.request(s.client.sendRequest(Requests.getCompletions, request));
    await s.request(s.client.sendRequest(Requests.reload, null));
    assert.equal(await s.request(s.client.sendRequest(Requests.applyCompletion,
      { ...application, itemId: fresh.items[0]!.id })), null);
    assert.ok((await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null))).generation > capabilities.generation);
    await rejectsCode(s.request(s.client.sendRequest('completion.get', { text: 1 })), -32602);
    await s.shutdown();
  } finally { await f.close(); }
});

test('real write/read/edit/read tools emit correlated ordered events and persist tool results', testOptions, async () => {
  const f = await fixture();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    const history = await completeTurn(s, 'tools-roundtrip');
    assert.equal(await readFile(path.join(f.workspace, 'roundtrip.txt'), 'utf8'), 'after\n');
    const starts = s.events.filter(({ event }) => event.type === 'tool_execution_start');
    assert.deepEqual(starts.map(({ event }) => event.toolName), ['write', 'read', 'edit', 'read']);
    for (const start of starts) {
      const ends = s.events.filter(({ event }) => event.type === 'tool_execution_end' && event.toolCallId === start.event.toolCallId);
      assert.equal(ends.length, 1);
      assert.equal(ends[0]!.event.isError, false);
      assert.ok(start.sequence < ends[0]!.sequence);
      const nextStart = starts[starts.indexOf(start) + 1];
      if (nextStart) assert.ok(ends[0]!.sequence < nextStart.sequence);
      for (const update of s.events.filter(({ event }) => event.type === 'tool_execution_update' && event.toolCallId === start.event.toolCallId)) {
        assert.ok(start.sequence < update.sequence && update.sequence < ends[0]!.sequence);
      }
    }
    const results = history.messages.filter(message => (message as { role: string }).role === 'toolResult');
    assert.equal(results.length, 4);
    assert.match(JSON.stringify(results[1]), /before/);
    assert.match(JSON.stringify(results[3]), /after/);
    for (let i = 1; i < s.events.length; i++) assert.equal(s.events[i]!.sequence, s.events[i - 1]!.sequence + 1);
    await s.shutdown();
  } finally { await f.close(); }
});

for (const streamingBehavior of ['steer', 'followUp'] as const) {
  test(`prompt acknowledges preflight and delivers ${streamingBehavior} while busy`, testOptions, async () => {
    const f = await fixture();
    try {
      const s = f.launch();
      await s.request(s.client.sendRequest(Requests.initialize, f.params));
      assert.equal(await s.request(s.client.sendRequest(Requests.prompt, { message: 'queue-window' })), null);
      await s.waitForEvent(({ event }) => (event.assistantMessageEvent as { delta?: string } | undefined)?.delta === 'fixture: waiting');
      assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, true);
      assert.equal(await s.request(s.client.sendRequest(Requests.prompt, { message: `queued-${streamingBehavior}`, streamingBehavior })), null);
      await s.waitForEvent(({ event }) => event.type === 'agent_settled');
      const history = await s.request(s.client.sendRequest(Requests.getMessages, null));
      const users = history.messages.filter(message => (message as { role: string }).role === 'user');
      assert.equal(users.length, 2);
      assert.match(JSON.stringify(users[1]), new RegExp(`queued-${streamingBehavior}`));
      assert.equal((await s.request(s.client.sendRequest(Requests.getLastAssistantText, null))).text, `fixture: queued-${streamingBehavior}`);
      await s.shutdown();
    } finally { await f.close(); }
  });
}

for (const mode of ['wait-for-abort', 'hang-tool'] as const) {
  test(`chat.abort stops ${mode}, settles, and permits a recovery turn`, testOptions, async () => {
    const f = await fixture();
    try {
      const s = f.launch();
      await s.request(s.client.sendRequest(Requests.initialize, f.params));
      assert.equal(await s.request(s.client.sendRequest(Requests.prompt, { message: mode })), null);
      const pids = mode === 'hang-tool' ? await toolPids(f.workspace) : [];
      await s.waitForEvent(({ event }) => mode === 'hang-tool'
        ? event.type === 'tool_execution_update' && event.toolName === 'bash'
        : (event.assistantMessageEvent as { delta?: string } | undefined)?.delta === 'fixture: waiting');
      assert.equal(await s.request(s.client.sendRequest(Requests.abort, null)), null);
      await s.waitForEvent(({ event }) => event.type === 'agent_settled');
      for (const pid of pids) await eventually(async () => !await processIsRunning(pid), `aborted tool PID ${pid}`);
      assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, false);
      if (mode === 'hang-tool') {
        const start = s.events.find(({ event }) => event.type === 'tool_execution_start' && event.toolName === 'bash')!;
        const end = s.events.find(({ event }) => event.type === 'tool_execution_end' && event.toolCallId === start.event.toolCallId);
        assert.ok(end && end.sequence > start.sequence);
      }
      await completeTurn(s, 'recovered');
      assert.equal((await s.request(s.client.sendRequest(Requests.getLastAssistantText, null))).text, 'fixture: recovered');
      assert.equal(await s.request(s.client.sendRequest(Requests.abort, null)), null, 'Idle abort is harmless');
      await s.shutdown();
    } finally { await killToolPids(f.workspace); await f.close(); }
  });
}

test('request cancellation during ordinary delayed input preflight returns Cancelled and aborts SDK work', testOptions, async () => {
  const f = await fixture();
  const cancellation = new CancellationTokenSource();
  try {
    const s = f.launch();
    await s.request(s.client.sendRequest(Requests.initialize, f.params));
    // Normal prompt preflight acknowledges immediately; cancel only while the
    // ordinary extension hook is still awaiting its bounded, signal-less delay.
    const response = s.request(s.client.sendRequest(Requests.prompt, { message: 'delayed-preflight' }, cancellation.token));
    const rejection = rejectsCode(response, TaurenErrorCodes.Cancelled);
    void rejection.catch(() => undefined);
    await eventually(async () => await readFile(path.join(f.workspace, 'preflight-entered'), 'utf8').catch(() => '') === 'entered', 'input hook entry');
    cancellation.cancel();
    await rejection;
    await eventually(async () => await readFile(path.join(f.workspace, 'preflight-finished'), 'utf8').catch(() => '') === 'finished', 'input hook completion');
    // Cross the preflight continuation, then verify cancelled SDK work cannot
    // leave a stream running or contaminate the next turn.
    await delay(100);
    await eventually(async () => !(await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, 'cancelled SDK settles');
    await completeTurn(s, 'after cancellation');
    assert.equal((await s.request(s.client.sendRequest(Requests.getLastAssistantText, null))).text, 'fixture: after cancellation');
    await s.shutdown();
  } finally { cancellation.dispose(); await f.close(); }
});

for (const termination of ['shutdown', 'EOF', 'SIGTERM'] as const) {
  test(`${termination} kills real bash descendants and reopening does not replay tools`, testOptions, async () => {
    const f = await fixture();
    try {
      const s = f.launch();
      await s.request(s.client.sendRequest(Requests.initialize, f.params));
      assert.equal(await s.request(s.client.sendRequest(Requests.prompt, { message: 'hang-tool' })), null);
      const pids = await toolPids(f.workspace);
      for (const pid of pids) assert.ok(await processIsRunning(pid));
      const state = await s.request(s.client.sendRequest(Requests.getState, null));
      assert.equal(typeof state.sessionFile, 'string');
      if (termination === 'shutdown') await s.shutdown();
      else {
        if (termination === 'EOF') s.child.stdin.end();
        else s.child.kill('SIGTERM');
        await s.exit();
      }
      for (const pid of pids) await eventually(async () => !await processIsRunning(pid), `terminated tool PID ${pid}`);
      const marker = await readFile(path.join(f.workspace, 'tool-shell.pid'), 'utf8');
      const resumed = f.launch();
      await resumed.request(resumed.client.sendRequest(Requests.initialize, { ...f.params, sessionFile: state.sessionFile as string }));
      const history = await resumed.request(resumed.client.sendRequest(Requests.getMessages, null));
      assert.match(JSON.stringify(history), /hang-tool/);
      assert.equal((await resumed.request(resumed.client.sendRequest(Requests.getState, null))).isStreaming, false);
      await completeTurn(resumed, 'after tool restart');
      assert.ok(!resumed.events.some(({ event }) => event.type === 'tool_execution_start'), 'Persisted tool call must never replay');
      assert.equal(await readFile(path.join(f.workspace, 'tool-shell.pid'), 'utf8'), marker);
      assert.equal((await resumed.request(resumed.client.sendRequest(Requests.getLastAssistantText, null))).text, 'fixture: after tool restart');
      await resumed.shutdown();
    } finally { await killToolPids(f.workspace); await f.close(); }
  });
}

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
