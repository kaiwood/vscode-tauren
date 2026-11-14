import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { buildServerLaunchCommand, quoteRemoteArgument } from '@tauren/shared/ssh/serverLaunch';
import {
  createProtocolConnection, Notifications, Requests, UiRequests, PROTOCOL_VERSION,
  type EventParams, type InitializeParams
} from '../protocol/index.js';
import { createSbxShellFixture } from './sbxShellFixture.js';

type SbxShellFixture = Awaited<ReturnType<typeof createSbxShellFixture>>;
const options = { timeout: 10 * 60_000 };

/** Bound every protocol/process wait without leaving a timer alive after success. */
async function bounded<T>(work: PromiseLike<T>, description: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Poll observable fixture files or OS process state, never runtime internals. */
async function eventually(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await delay(25);
  }
}

type ProcessIdentity = { pid: number; start: string };

/** Inspect and optionally signal only remote PIDs, validating Linux start time in the same SSH command. */
async function identity(ssh: SbxShellFixture, pid: number, killStart?: string): Promise<ProcessIdentity | undefined> {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, `Invalid fixture PID: ${pid}`);
  const script = `
    const { readFileSync } = require('node:fs');
    const pid = ${JSON.stringify(pid)};
    const killStart = ${JSON.stringify(killStart) ?? 'undefined'};
    let result = null;
    try {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] !== 'Z' && fields[19]) {
        result = { pid, start: fields[19] };
        if (killStart === result.start) process.kill(pid, 'SIGKILL');
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const result = await ssh.run(`${quoteRemoteArgument(ssh.nodePath ?? '/usr/bin/node')} -e ${quoteRemoteArgument(script)}`);
  return (JSON.parse(result) as ProcessIdentity | null) ?? undefined;
}

/** The only server access is SSH's framed public protocol; stderr is diagnostic-only. */
function connect(child: ChildProcessWithoutNullStreams) {
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  void exited.catch(() => undefined);
  const errors: unknown[] = [];
  const client = createProtocolConnection(child.stdout, child.stdin, {
    error: error => errors.push(error), warn() {}, info() {}, log() {}
  });
  client.onError(error => errors.push(error));
  const events: EventParams[] = [];
  const notices: { message: string }[] = [];
  client.onNotification(Notifications.event, event => { events.push(event); });
  client.onNotification(Notifications.notify, notice => { notices.push(notice); });
  client.onRequest(UiRequests.select, () => 'two');
  client.onRequest(UiRequests.confirm, () => true);
  client.onRequest(UiRequests.input, () => 'SSH typed');
  client.onRequest(UiRequests.editor, () => 'SSH edited');
  client.onRequest(UiRequests.custom, () => null);
  client.listen();
  const server = {
    child, client, events, notices, errors,
    get stderr() { return stderr; },
    async request<T>(work: PromiseLike<T>): Promise<T> {
      try { return await bounded(work, 'SSH protocol response'); }
      catch (cause) { throw new Error(`${String(cause)}\nSSH stderr: ${stderr}`, { cause }); }
    },
    async exit() { return bounded(exited, `SSH exit; stderr: ${stderr}`); },
    async shutdown() {
      assert.equal(await server.request(client.sendRequest(Requests.shutdown, null)), null);
      child.stdin.end();
      assert.deepEqual(await server.exit(), { code: 0, signal: null }, stderr);
      assert.deepEqual(errors, [], `stdout must contain only framed JSON-RPC; stderr: ${stderr}`);
    },
    async close() {
      client.dispose();
      child.stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await bounded(exited, 'SSH client cleanup');
    }
  };
  return server;
}

type Server = ReturnType<typeof connect>;

/** An ordinary turn through the installed offline provider and real SDK tools. */
async function turn(server: Server, message: string) {
  const start = server.events.length;
  assert.equal(await server.request(server.client.sendRequest(Requests.prompt, { message })), null);
  await eventually(async () => server.events.slice(start).some(({ event }) => event.type === 'agent_settled'),
    `SSH agent settled; stderr: ${server.stderr}`);
  return server.request(server.client.sendRequest(Requests.getMessages, null));
}

/**
 * env -i is on the remote side: SSH SendEnv is deliberately not involved. The
 * production launcher still supplies cd/exec/session env and quotes all paths.
 * The generated ESM wrapper records externally observable launch state then
 * imports dist/main.js, without adding production fixture modes or flags.
 */
async function fixture() {
  const ssh = await createSbxShellFixture();
  const nodePath = ssh.nodePath ?? '/usr/bin/node';
  const servers: Server[] = [];
  const tracked = new Map<number, ProcessIdentity>();
  // Unique marker filename that must never be created. noInjection() checks for
  // it to detect a remote shell executing path contents instead of treating them
  // literally; it is not a protocol message or a normal fixture output file.
  const sentinel = `SSH_INJECTED_${path.basename(ssh.directory)}`;
  // Append hostile-but-valid filename characters to fixture paths: spaces, a
  // quote, command separators, both command-substitution forms, and a newline.
  // Broken SSH quoting could execute these touch commands and create sentinel.
  // Correct quoting preserves the entire suffix as literal directory/file text.
  const poison = ` space ' ; touch ${sentinel}; $(touch ${sentinel}) \`touch ${sentinel}\`\nend`;
  const workspace = path.join(ssh.directory, `workspace${poison}`);
  const agent = path.join(ssh.directory, `agent${poison}`);
  const sessionDirectory = path.join(ssh.directory, `sessions${poison}`);
  const home = path.join(ssh.directory, `home${poison}`);
  const params: InitializeParams = {
    protocolVersion: PROTOCOL_VERSION, clientVersion: 'real-ssh-test', workspace, sessionDirectory
  };
  try {
    // The fixture mirrors this absolute path RW; only the code payload is read-only.
    assert.equal(ssh.remoteDirectory, ssh.directory);
    await Promise.all([workspace, agent, sessionDirectory, home].map(directory => mkdir(directory)));
    await writeFile(path.join(agent, 'settings.json'), JSON.stringify({
      defaultProvider: 'offline', defaultModel: 'scripted', extensions: ssh.extensions,
      compaction: { enabled: false }, retry: { enabled: false }
    }));
  } catch (error) { await ssh.close(); throw error; }

  /** Capture identity while a process is known to belong to this fixture. */
  async function track(pid: number): Promise<ProcessIdentity> {
    assert.ok(Number.isSafeInteger(pid) && pid > 1, `Invalid fixture PID: ${pid}`);
    const saved = await identity(ssh, pid);
    assert.ok(saved, `Fixture process ${pid} must be running before disconnect`);
    tracked.set(pid, saved);
    return saved;
  }

  /** Assert natural remote death BEFORE fixture close or emergency PID signals. */
  async function dead(processes: ProcessIdentity[]) {
    await eventually(async () => (await Promise.all(processes.map(async saved =>
      (await identity(ssh, saved.pid))?.start !== saved.start))).every(Boolean), 'remote server and tool descendants to die');
  }

  /** Build an independent remote entrypoint for each SSH connection. */
  async function launch(body = `await import(${JSON.stringify(pathToFileURL(ssh.serverPath).href)});`) {
    const number = servers.length;
    const marker = path.join(ssh.directory, `launch-${number}.json`);
    const wrapper = path.join(ssh.directory, `server-${number}${poison}.mjs`);
    await writeFile(wrapper, `import { writeFileSync } from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,cwd:process.cwd(),` +
      `home:process.env.HOME,agent:process.env.PI_CODING_AGENT_DIR,sessions:process.env.PI_CODING_AGENT_SESSION_DIR,` +
      `env:Object.keys(process.env)}));\n${body}\n`);
    const command = buildServerLaunchCommand({ nodePath, serverPath: wrapper, workspace, sessionDirectory });
    // The nested shell is needed so env -i also encloses the production cd && exec.
    const remote = `exec /usr/bin/env -i ${[
      `HOME=${home}`, `PI_CODING_AGENT_DIR=${agent}`, `PATH=${path.dirname(nodePath)}:/usr/bin:/bin`,
      `TMPDIR=${ssh.directory}`, 'NO_COLOR=1', 'LANG=C'
    ].map(quoteRemoteArgument).join(' ')} /bin/sh -c ${quoteRemoteArgument(command)}`;
    const server = connect(ssh.launch(remote));
    servers.push(server);
    await eventually(async () => {
      try { await access(marker); return true; } catch { return false; }
    }, `remote launcher marker; SBX/SSH diagnostics: ${ssh.stderr}`);
    const launchState = JSON.parse(await readFile(marker, 'utf8')) as {
      pid: number; cwd: string; home: string; agent: string; sessions: string; env: string[]
    };
    const processIdentity = await track(launchState.pid);
    return Object.assign(server, { launchState, processIdentity });
  }

  return {
    ssh, workspace, agent, home, sessionDirectory, params, launch, track, dead,
    async noInjection() {
      for (const directory of [ssh.directory, workspace, home]) {
        await assert.rejects(access(path.join(directory, sentinel)), { code: 'ENOENT' });
      }
      // SSH's initial cwd/home belong to the sandbox, not the test runner's host.
      await ssh.run(`${quoteRemoteArgument(nodePath)} -e ${quoteRemoteArgument(`
        const { existsSync } = require('node:fs');
        const { join } = require('node:path');
        for (const directory of [process.cwd(), require('node:os').homedir()]) {
          if (existsSync(join(directory, ${JSON.stringify(sentinel)}))) {
            throw new Error('Remote shell path injection detected');
          }
        }
      `)}`);
    },
    async close() {
      // Only last-resort cleanup. Lifecycle tests assert natural death before here;
      // signalling cannot turn a failed assertion into a passing lifecycle test.
      const failures: unknown[] = [];
      for (const server of servers) {
        try { await server.close(); } catch (error) { failures.push(error); }
      }
      for (const saved of [...tracked.values()].reverse()) {
        try { await identity(ssh, saved.pid, saved.start); }
        catch (error) { failures.push(error); }
      }
      try { await ssh.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'SSH test cleanup failed');
    }
  };
}

test('SSH real SDK handshake, streaming, quoted launch isolation, tools, UI replies and persisted reopen', options, async t => {
  const f = await fixture();
  t.after(() => f.close());
  {
    const first = await f.launch();
    // The remote shell can create PWD/OLDPWD while executing the launcher's cd;
    // these are not inherited credentials or developer runtime configuration.
    assert.deepEqual(first.launchState.env.filter(key => ![
      'HOME', 'PI_CODING_AGENT_DIR', 'PATH', 'TMPDIR', 'NO_COLOR', 'LANG', 'PWD', 'OLDPWD', 'PI_CODING_AGENT_SESSION_DIR'
    ].includes(key)), [], 'No inherited API keys, provider endpoints, NODE_OPTIONS or developer settings');
    // Initialize requires explicit storage too; the wrapper independently proves
    // the production launcher's remote environment survived shell interpretation.
    const initialized = await first.request(first.client.sendRequest(Requests.initialize, f.params));
    assert.equal(initialized.protocolVersion, PROTOCOL_VERSION);
    assert.match(initialized.serverVersion, /^\d+\.\d+\.\d+/);
    assert.match(initialized.piVersion, /^\d+\.\d+\.\d+/);
    assert.equal(initialized.workspace, f.workspace);
    assert.equal(initialized.sessionDirectory, f.sessionDirectory);
    assert.ok(initialized.capabilities.includes(Requests.prompt.method));
    // The fixture extension uses console.log(); main.ts redirects console output
    // to stderr so it cannot corrupt framed JSON-RPC on stdout. This captured SSH
    // diagnostic stream must contain the log while protocol requests still work.
    assert.match(first.stderr, /offline fixture loaded/);
    const expected = `fixture: source-check [source=rpc;cwd=${f.workspace};processCwd=${f.workspace}]`;
    await turn(first, 'source-check');
    assert.equal((await first.request(first.client.sendRequest(Requests.getLastAssistantText, null))).text, expected);
    const deltas = first.events.flatMap(({ event }) => {
      const update = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      return update?.type === 'text_delta' ? [update.delta] : [];
    });
    assert.ok(deltas.length >= 2, 'SSH must preserve incremental SDK text events');
    assert.equal(deltas.join(''), expected);
    const types = first.events.map(({ event }) => event.type);
    assert.ok(types.indexOf('agent_start') < types.indexOf('message_update'));
    assert.ok(types.indexOf('message_update') < types.indexOf('agent_end'));
    for (let index = 1; index < first.events.length; index++) {
      assert.equal(first.events[index]!.sequence, first.events[index - 1]!.sequence + 1);
    }

    const toolStart = first.events.length;
    await turn(first, 'tools-roundtrip');
    assert.equal(await readFile(path.join(f.workspace, 'roundtrip.txt'), 'utf8'), 'after\n');
    const tools = first.events.slice(toolStart).filter(({ event }) => event.type === 'tool_execution_end');
    assert.deepEqual(tools.map(({ event }) => event.toolName), ['write', 'read', 'edit', 'read']);
    assert.ok(tools.every(({ event }) => event.isError === false));
    assert.match(JSON.stringify(tools[1]), /before/);
    assert.match(JSON.stringify(tools[3]), /after/);

    const dialogs: string[] = [];
    first.client.onRequest(UiRequests.select, params => { dialogs.push(params.title); return 'two'; });
    first.client.onRequest(UiRequests.confirm, params => { dialogs.push(params.title); return true; });
    first.client.onRequest(UiRequests.input, params => { dialogs.push(params.title); return 'SSH typed'; });
    first.client.onRequest(UiRequests.editor, params => { dialogs.push(params.title); return 'SSH edited'; });
    assert.equal(await first.request(first.client.sendRequest(Requests.prompt, { message: '/ui-dialogs' })), null);
    await eventually(async () => first.notices.some(notice => notice.message ===
      'dialogs:{"select":"two","confirm":true,"input":"SSH typed","editor":"SSH edited"}'), 'reverse UI replies consumed by SDK');
    assert.deepEqual(dialogs, ['fixture-select', 'fixture-confirm', 'fixture-input', 'fixture-editor']);

    const history = await first.request(first.client.sendRequest(Requests.getMessages, null));
    const state = await first.request(first.client.sendRequest(Requests.getState, null));
    assert.equal(typeof state.sessionFile, 'string');
    const sessionFile = state.sessionFile as string;
    assert.equal(path.dirname(sessionFile), f.sessionDirectory);
    await first.shutdown();
    await f.dead([first.processIdentity]);
    const entries = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries[0].cwd, f.workspace);
    assert.ok(entries.some(entry => entry.type === 'message' && entry.message.role === 'assistant'));
    assert.ok((await readdir(f.sessionDirectory)).includes(path.basename(sessionFile)));

    const resumed = await f.launch();
    await resumed.request(resumed.client.sendRequest(Requests.initialize, { ...f.params, sessionFile }));
    assert.deepEqual(await resumed.request(resumed.client.sendRequest(Requests.getMessages, null)), history);
    assert.ok(!resumed.events.some(({ event }) => event.type === 'agent_start'), 'Reconnect must not replay prompts');
    await turn(resumed, 'after SSH reconnect');
    assert.equal((await resumed.request(resumed.client.sendRequest(Requests.getLastAssistantText, null))).text,
      'fixture: after SSH reconnect');
    assert.equal(resumed.events.filter(({ event }) => event.type === 'agent_start').length, 1);
    await resumed.shutdown();
    await f.noInjection();
  }
});

test('SSH remote exit 23 preserves diagnostic stderr and rejects an outstanding public RPC', options, async t => {
  const f = await fixture();
  t.after(() => f.close());
  {
    // Waiting for bytes proves initialize is outstanding when the remote exits.
    const server = await f.launch(`process.stdin.once('data', () => {\n` +
      `process.stderr.write('remote fixture exit 23\\n', () => process.exit(23));\n}); process.stdin.resume();`);
    const pending = server.client.sendRequest(Requests.initialize, f.params);
    const rejected = assert.rejects(Promise.resolve(pending), /disposed|closed/i);
    await bounded(rejected, 'outstanding initialize rejected after SSH remote exit');
    assert.deepEqual(await server.exit(), { code: 23, signal: null });
    assert.match(server.stderr, /remote fixture exit 23/);
    assert.deepEqual(server.errors, [], 'Remote stderr is never parsed as protocol');
    await f.dead([server.processIdentity]);
  }
});

test('SIGKILL of SSH client aborts the remote server and real bash descendants, then reopens without replay', options, async t => {
  const f = await fixture();
  t.after(() => f.close());
  {
    const server = await f.launch();
    await server.request(server.client.sendRequest(Requests.initialize, f.params));
    await turn(server, 'persist before disconnect');
    assert.equal(await server.request(server.client.sendRequest(Requests.prompt, { message: 'hang-tool' })), null);
    const pids: ProcessIdentity[] = [server.processIdentity];
    for (const name of ['tool-shell.pid', 'tool-child.pid']) {
      const file = path.join(f.workspace, name);
      await eventually(async () => /^\d+\s*$/.test(await readFile(file, 'utf8').catch(() => '')), `${name} started`);
      pids.push(await f.track(Number((await readFile(file, 'utf8')).trim())));
    }
    const state = await server.request(server.client.sendRequest(Requests.getState, null));
    const sessionFile = state.sessionFile as string;
    assert.equal(path.dirname(sessionFile), f.sessionDirectory);
    assert.equal(server.child.kill('SIGKILL'), true);
    assert.deepEqual(await server.exit(), { code: null, signal: 'SIGKILL' });
    // Assert before sandbox removal or emergency signals can conceal a leak.
    await f.dead(pids);
    const markers = await Promise.all(['tool-shell.pid', 'tool-child.pid'].map(name => readFile(path.join(f.workspace, name), 'utf8')));

    const resumed = await f.launch();
    await resumed.request(resumed.client.sendRequest(Requests.initialize, { ...f.params, sessionFile }));
    const history = await resumed.request(resumed.client.sendRequest(Requests.getMessages, null));
    const users = history.messages.filter(message => (message as { role?: string }).role === 'user');
    assert.equal(users.length, 2, 'Persisted prompts survive exactly once');
    assert.match(JSON.stringify(history), /persist before disconnect/);
    assert.match(JSON.stringify(history), /hang-tool/);
    assert.ok(!resumed.events.some(({ event }) => ['agent_start', 'tool_execution_start'].includes(String(event.type))));
    await turn(resumed, 'safe continuation');
    assert.deepEqual(await Promise.all(['tool-shell.pid', 'tool-child.pid'].map(name => readFile(path.join(f.workspace, name), 'utf8'))), markers,
      'Reopening must not restart the interrupted bash tool');
    assert.equal(resumed.events.filter(({ event }) => event.type === 'agent_start').length, 1);
    assert.ok(!resumed.events.some(({ event }) => event.type === 'tool_execution_start'));
    await resumed.shutdown();
  }
});

test('SSH stdin EOF releases a pending reverse dialog and exits without a host response', options, async t => {
  const f = await fixture();
  // After hooks preserve the original assertion failure if cleanup also fails.
  t.after(() => f.close());
  let dismiss: (() => void) | undefined;
  try {
    const server = await f.launch();
    await server.request(server.client.sendRequest(Requests.initialize, f.params));
    let title: string | undefined;
    server.client.onRequest(UiRequests.input, params => {
      title = params.title;
      return new Promise<null>(resolve => { dismiss = () => resolve(null); });
    });
    const pending = server.client.sendRequest(Requests.prompt, { message: '/ui-wait' });
    // Teardown may reject or settle a dispatched prompt, but cannot await the UI.
    const settled = Promise.resolve(pending).then(() => undefined, () => undefined);
    await eventually(async () => title === 'fixture-wait', 'open reverse dialog');
    server.child.stdin.end();
    assert.deepEqual(await server.exit(), { code: 0, signal: null }, server.stderr);
    await bounded(settled, 'pending dialog prompt settles after EOF');
    await f.dead([server.processIdentity]);
    assert.deepEqual(server.errors, []);
  } finally {
    // Release the test-host promise only AFTER asserting natural remote teardown.
    dismiss?.();
  }
});
