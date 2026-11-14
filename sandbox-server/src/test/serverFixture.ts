import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createProtocolConnection, Notifications, Requests, UiRequests, PROTOCOL_VERSION, ResponseError,
  type EventParams, type InitializeParams
} from '../protocol/index.js';

const main = fileURLToPath(new URL('../main.js', import.meta.url));
const extension = fileURLToPath(new URL('./fixtures/offline-provider.js', import.meta.url));
export const serverTestOptions = { timeout: 60_000 };

export async function bounded<T>(promise: PromiseLike<T>, description: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve(promise), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Real dist/main.js + framed JSON-RPC + real SDK, never an in-process server.
 * launch() installs noninteractive host capability handlers. UI tests can replace
 * any handler through server.client.onRequest(UiRequests.*, handler) BEFORE init.
 * Each launch has independent events/process state; paths/settings are shared so
 * a second launch can initialize with {...params, sessionFile} to test reopening.
 */
export async function createServerFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'tauren-server-fixture-'));
  const workspace = path.join(directory, 'workspace');
  const agent = path.join(directory, 'agent');
  const sessionDirectory = path.join(directory, 'sessions');
  const wrongSessions = path.join(directory, 'wrong-environment-sessions');
  await Promise.all([workspace, agent, sessionDirectory].map(dir => mkdir(dir)));
  await writeFile(path.join(agent, 'settings.json'), JSON.stringify({
    defaultProvider: 'offline', defaultModel: 'scripted', extensions: [extension],
    compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false }
  }));
  const cleanups: (() => Promise<void>)[] = [];
  const params: InitializeParams = {
    protocolVersion: PROTOCOL_VERSION, clientVersion: 'server-integration-test', workspace, sessionDirectory
  };
  function launch() {
    const child = spawn(process.execPath, [main], {
      cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
      // No credentials, endpoints, NODE_OPTIONS or developer Pi configuration.
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
    void exited.catch(() => undefined);
    const protocolErrors: unknown[] = [];
    const client = createProtocolConnection(child.stdout, child.stdin, {
      error: message => protocolErrors.push(message), warn() {}, info() {}, log() {}
    });
    client.onError(error => protocolErrors.push(error));
    // Host capability replies are not SDK mocks; they are the host half of the
    // public protocol and prevent accidental modal dialogs hanging a subprocess.
    client.onRequest(UiRequests.select, () => null);
    client.onRequest(UiRequests.confirm, () => false);
    client.onRequest(UiRequests.input, () => null);
    client.onRequest(UiRequests.editor, () => null);
    client.onRequest(UiRequests.custom, () => null);
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
      async request<T>(promise: PromiseLike<T>): Promise<T> {
        try { return await bounded(promise, 'protocol response'); }
        catch (error) {
          if (error instanceof ResponseError) throw error;
          throw new Error(`${String(error)}\nstderr: ${stderr}`);
        }
      },
      async waitForEvent(predicate: (event: EventParams) => boolean) {
        let check: (() => void) | undefined;
        try {
          return await bounded(new Promise<EventParams>(resolve => {
            check = () => { const found = events.find(predicate); if (found) resolve(found); };
            listeners.add(check);
            check();
          }), `agent event; stderr: ${stderr}`);
        } finally { if (check) listeners.delete(check); }
      },
      async shutdown() {
        assert.equal(await server.request(client.sendRequest(Requests.shutdown, null)), null);
        child.stdin.end();
        assert.deepEqual(await bounded(exited, `child exit; stderr: ${stderr}`), { code: 0, signal: null });
        assert.deepEqual(protocolErrors, [], `stdout must be framed JSON-RPC; stderr: ${stderr}`);
      },
      async close() {
        client.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await bounded(exited, 'child cleanup');
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

export type ServerFixture = Awaited<ReturnType<typeof createServerFixture>>;
export type ServerProcess = ReturnType<ServerFixture['launch']>;

export async function completeTurn(server: ServerProcess, message: string) {
  const start = server.events.length;
  assert.equal(await server.request(server.client.sendRequest(Requests.prompt, { message })), null);
  await server.waitForEvent(event => server.events.indexOf(event) >= start && event.event.type === 'agent_settled');
  return server.request(server.client.sendRequest(Requests.getMessages, null));
}

/** Poll only externally observable state; no access to the child SDK internals. */
export async function eventually(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 15_000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await delay(25);
  }
}

export async function rejectsCode(promise: PromiseLike<unknown>, code: number) {
  await assert.rejects(Promise.resolve(promise), error => {
    assert.ok(error instanceof ResponseError);
    assert.equal(error.code, code);
    return true;
  });
}
