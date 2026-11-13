import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CancellationTokenSource, ResponseError, type CancellationToken } from 'vscode-jsonrpc';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createProtocolConnection, Requests, UiRequests, Notifications, PROTOCOL_VERSION,
  TaurenErrorCodes, type EventParams, type CustomParams, type JsonValue
} from '../protocol/index.js';

const deadline = 10_000;
const options = { timeout: 30_000 };
async function bounded<T>(work: PromiseLike<T>, description: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), deadline);
    })]);
  } finally { clearTimeout(timer); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Isolated real dist/main.js + installed SDK. Register every host callback before
 * initialize: session_start may call UI before initialize has returned. Never
 * import registerServer or replace SDK sessions, tools, or extension discovery.
 */
async function fixture(startupDialog = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tauren-ui-'));
  const workspace = path.join(directory, 'workspace');
  const agent = path.join(directory, 'agent');
  const sessionDirectory = path.join(directory, 'sessions');
  await Promise.all([workspace, agent, sessionDirectory].map(dir => mkdir(dir)));
  const extension = fileURLToPath(new URL('./fixtures/ui-extension.js', import.meta.url));
  const provider = fileURLToPath(new URL('./fixtures/offline-provider.js', import.meta.url));
  await writeFile(path.join(agent, 'settings.json'), JSON.stringify({
    defaultProvider: 'offline', defaultModel: 'scripted', extensions: [provider, extension],
    compaction: { enabled: false }, retry: { enabled: false }
  }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../main.js', import.meta.url))], {
    cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, TMPDIR: directory,
      NO_COLOR: '1', PI_CODING_AGENT_DIR: agent, UI_FIXTURE_STARTUP: startupDialog ? 'dialog' : '' }
  });
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
  const notifications: { method: string; value: unknown }[] = [];
  const changes = new Set<() => void>();
  const changed = () => { for (const change of changes) change(); };
  client.onNotification(Notifications.event, value => { events.push(value); changed(); });
  for (const method of [Notifications.notify, Notifications.status, Notifications.clearStatuses,
    Notifications.widget, Notifications.clearWidgets, Notifications.footer, Notifications.invalidate,
    Notifications.setToolsExpanded, Notifications.setEditorText, Notifications.pasteToEditor,
    Notifications.terminalInputSubscription]) {
    client.onNotification(method.method, value => { notifications.push({ method: method.method, value }); changed(); });
  }
  const dialogs: { method: string; value: unknown; token: CancellationToken; dismiss: () => void }[] = [];
  let answerDialogs = !startupDialog;
  for (const [method, answer] of [[UiRequests.select.method, 'two'], [UiRequests.confirm.method, true],
    [UiRequests.input.method, 'typed'], [UiRequests.editor.method, 'edited']] as const) {
    client.onRequest(method, (value, token) => {
      const pending = deferred<null>();
      dialogs.push({ method, value, token, dismiss: () => pending.resolve(null) }); changed();
      // Returning a pending promise models the host dialog staying open. A
      // cancellation token is observable even if a host ignores cancellation.
      return answerDialogs ? answer : pending.promise;
    });
  }
  const surfaces: { params: CustomParams; token: CancellationToken; dismiss: () => void }[] = [];
  client.onRequest(UiRequests.custom, (params, token) => {
    const pending = deferred<null>();
    surfaces.push({ params, token, dismiss: () => pending.resolve(null) }); changed();
    return pending.promise;
  });
  client.listen();
  async function request<T>(work: PromiseLike<T>) {
    try { return await bounded(work, 'wire response'); }
    catch (error) { throw new Error(`${String(error)}\nstderr: ${stderr}`, { cause: error }); }
  }
  async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
    let check: (() => void) | undefined;
    try {
      return await bounded(new Promise<T>(resolve => {
        check = () => { const value = get(); if (value !== undefined) resolve(value); };
        changes.add(check); check();
      }), description);
    } catch (error) { throw new Error(`${String(error)}\nstderr: ${stderr}`); }
    finally { if (check) changes.delete(check); }
  }
  const server = {
    client, child, events, notifications, dialogs, surfaces, workspace,
    set answerDialogs(value: boolean) { answerDialogs = value; },
    request, waitFor,
    initialize: () => request(client.sendRequest(Requests.initialize, {
      protocolVersion: PROTOCOL_VERSION, clientVersion: 'ui-integration', workspace, sessionDirectory
    })),
    prompt: (message: string) => request(client.sendRequest(Requests.prompt, { message })),
    notification: (method: string, predicate: (value: any) => boolean = () => true, start = 0) => waitFor(
      () => notifications.slice(start).find(entry => entry.method === method && predicate(entry.value)), method),
    async cancelled(token: CancellationToken) {
      await bounded(token.isCancellationRequested ? Promise.resolve() : new Promise<void>(resolve => {
        const subscription = token.onCancellationRequested(() => { subscription.dispose(); resolve(); });
      }), 'reverse request cancellation');
    },
    async shutdown() {
      assert.equal(await request(client.sendRequest(Requests.shutdown, null)), null);
      child.stdin.end();
      assert.deepEqual(await bounded(exited, 'clean shutdown'), { code: 0, signal: null }, stderr);
      assert.deepEqual(errors, [], `stdout must be framed protocol only: ${stderr}`);
    },
    async disconnect() {
      client.dispose(); child.stdin.end();
      assert.deepEqual(await bounded(exited, 'disconnect cleanup'), { code: 0, signal: null }, stderr);
    },
    async close() {
      client.dispose();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      try { await bounded(exited, 'child cleanup'); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
  return server;
}
async function fileEventually(file: string, expected: string) {
  const until = Date.now() + 5_000;
  while (await readFile(file, 'utf8').catch(() => '') !== expected) {
    if (Date.now() > until) assert.fail(`Timed out waiting for ${file}`);
    await delay(10);
  }
}
type Server = Awaited<ReturnType<typeof fixture>>;
async function custom(s: Server) {
  const start = s.surfaces.length;
  const prompt = s.prompt('/ui-custom');
  // Install rejection handling immediately, including tests that disconnect.
  void prompt.catch(() => undefined);
  const surface = await s.waitFor(() => s.surfaces[start], 'custom reverse request');
  return { ...surface, prompt };
}
async function render(s: Server, surfaceId: string) {
  return s.request(s.client.sendRequest(UiRequests.render, { surfaceId, width: 43, height: 12 }));
}

test('cancelling session.clone cancels a session_before_fork dialog and releases the mutation', options, async () => {
  const s = await fixture();
  const source = new CancellationTokenSource();
  try {
    await s.initialize();
    const start = s.events.length;
    await s.prompt('persist-before-clone');
    await s.waitFor(() => s.events.slice(start).find(entry => entry.event.type === 'agent_settled'), 'persist before clone');
    const before = await s.request(s.client.sendRequest(Requests.getState, null));
    await s.prompt('/ui-arm-fork-dialog'); s.answerDialogs = false;
    const operation = s.client.sendRequest(Requests.clone, null, source.token);
    void operation.catch(() => undefined);
    const dialog = await s.waitFor(() => s.dialogs.find(entry => (entry.value as { title: string }).title === 'before-fork-dialog'), 'clone fork hook');
    source.cancel();
    await s.cancelled(dialog.token);
    // Cancellation cannot roll back a committed mutation. This fixture vetoes
    // on undefined, but the wire may return a result or cancellation error.
    const outcome = await bounded(Promise.resolve(operation).then(value => ({ value }), error => ({ error })), 'clone cancellation settles');
    if ('error' in outcome) {
      assert.ok(outcome.error instanceof ResponseError);
      assert.equal(outcome.error.code, TaurenErrorCodes.Cancelled);
    }
    await s.notification('ui.notify', value => value.message === 'before-fork-result:undefined');
    const after = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.equal(after.sessionFile, before.sessionFile, 'undefined dialog answer vetoes fork');
    s.answerDialogs = true;
    await s.prompt('/ui-dialogs'); // mutation reservation must have been released
    await s.shutdown();
  } finally { source.dispose(); await s.close(); }
});

test('extension ctx.reload gates prompts and cleans shutdown-created UI/providers before fresh session_start', options, async () => {
  const s = await fixture();
  try {
    await s.initialize(); s.answerDialogs = false;
    const start = s.notifications.length;
    const eventStart = s.events.length;
    const reload = s.prompt('/ui-reload-dialog'); void reload.catch(() => undefined);
    const dialog = await s.waitFor(() => s.dialogs.find(entry => (entry.value as { title: string }).title === 'shutdown-reload-dialog'), 'reload shutdown hook');
    await assert.rejects(Promise.resolve(s.client.sendRequest(Requests.prompt, { message: 'must-not-start-during-reload' })), error => {
      assert.ok(error instanceof ResponseError);
      assert.equal(error.code, TaurenErrorCodes.NotInitialized);
      return true;
    });
    dialog.dismiss();
    await reload;
    await s.notification('ui.notify', value => value.message === 'shutdown-artifacts:created', start);
    const widget = await s.notification('ui.widget', value => value.key === 'shutdown-widget' && value.content !== null, start);
    const surfaceId = (widget.value as { content: { surfaceId: string } }).content.surfaceId;
    const fresh = await s.notification('ui.notify', value => value.message === 'ui-fixture:session-start', start);
    const disposed = await s.notification('ui.notify', value => value.message === 'shutdown-widget:disposed', start);
    const cleared = await s.notification('ui.clearWidgets', () => true, s.notifications.indexOf(widget));
    assert.ok(s.notifications.indexOf(disposed) < s.notifications.indexOf(fresh), 'dispose before fresh session_start');
    assert.ok(s.notifications.indexOf(cleared) < s.notifications.indexOf(fresh), 'clear before fresh session_start');
    assert.deepEqual((await render(s, surfaceId)).lines, [], 'old shutdown surface removed');
    const capabilities = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
    assert.ok(!capabilities.triggerCharacters.includes('^'), 'shutdown provider must not survive');
    assert.ok(capabilities.triggerCharacters.includes('%'), 'fresh session_start provider rebound');
    const completion = await s.request(s.client.sendRequest(Requests.getCompletions, { id: 'shutdown-old', revision: 1, text: '^old', selectionStart: 4, selectionEnd: 4 }));
    assert.ok(!completion.items.some(item => item.label === 'Stale shutdown provider'));
    assert.deepEqual(s.events.slice(eventStart).filter(entry => entry.event.type === 'extension_error'), []);
    assert.ok(!s.events.slice(eventStart).some(entry => entry.event.type === 'agent_start'));
    const state = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.equal(state.isStreaming, false);
    s.answerDialogs = true;
    await s.prompt('/ui-dialogs');
    await s.shutdown();
    assert.equal(s.notifications.filter(entry => entry.method === 'ui.notify' && (entry.value as { message: string }).message === 'shutdown-widget:disposed').length, 1);
  } finally { await s.close(); }
});

test('synchronous done returns an actual function by identity without opening a host surface', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    await s.prompt('/ui-sync-done');
    await s.notification('ui.notify', value => value.message === 'sync-done:true:callable-result:disposed=1');
    assert.equal(s.surfaces.length, 0);
    await s.shutdown();
  } finally { await s.close(); }
});

test('async custom factory completing after reload is disposed exactly once and never resurrected', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    await s.prompt('/ui-async-factory');
    await fileEventually(path.join(s.workspace, 'factory-entered'), 'entered');
    await s.request(s.client.sendRequest(Requests.reload, null));
    await writeFile(path.join(s.workspace, 'factory-release'), 'release');
    await fileEventually(path.join(s.workspace, 'factory-disposed'), 'disposed\n');
    // Subsequent lifecycle barriers flush teardown; no sleeping to infer absence.
    await s.request(s.client.sendRequest(Requests.reload, null));
    await s.shutdown();
    assert.equal(await readFile(path.join(s.workspace, 'factory-disposed'), 'utf8'), 'disposed\n');
    assert.equal(s.surfaces.length, 0, 'late factory must not send ui.custom');
  } finally { await s.close(); }
});

test('setSurfaceState gates render/input and propagates focus without disposing the component', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    const prompt = s.prompt('/ui-focus'); void prompt.catch(() => undefined);
    const { params: { surfaceId } } = await s.waitFor(() => s.surfaces[0], 'focus surface');
    const state = (attached: boolean, focused: boolean) => s.request(s.client.sendRequest(UiRequests.setSurfaceState, { surfaceId, attached, focused }));
    const input = () => s.request(s.client.sendRequest(UiRequests.surfaceInput, { surfaceId, input: 'x' }));
    await state(false, true); await input();
    assert.deepEqual((await render(s, surfaceId)).lines, []);
    await state(true, false); await input();
    assert.deepEqual((await render(s, surfaceId)).lines, ['focus:false;inputs:0']);
    await state(true, true); await input();
    assert.deepEqual((await render(s, surfaceId)).lines, ['focus:true;inputs:1']);
    await s.request(s.client.sendRequest(UiRequests.dispose, { surfaceId }));
    await prompt;
    assert.equal(await state(true, true), null, 'stale state is a no-op');
    assert.deepEqual((await render(s, surfaceId)).lines, []);
    await s.shutdown();
  } finally { await s.close(); }
});

test('real SDK Image component crosses ui.render as a structured image block, not terminal escapes', options, async () => {
  const s = await fixture();
  try {
    await s.initialize(); await s.prompt('/ui-image');
    const widget = await s.notification('ui.widget', value => value.key === 'image');
    const surfaceId = (widget.value as { content: { surfaceId: string } }).content.surfaceId;
    const result = await s.request(s.client.sendRequest(UiRequests.render, { surfaceId, width: 43, height: 12, cellWidth: 10, cellHeight: 20 }));
    assert.equal(result.blocks?.length, 1);
    assert.deepEqual(result.blocks?.[0], {
      type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      mimeType: 'image/png', columns: 4, rows: 2, widthPx: 1, heightPx: 1,
      cellWidthPx: 10, cellHeightPx: 20, alt: 'pixel.png'
    });
    assert.deepEqual(result.lines, ['', '']);
    await s.shutdown();
  } finally { await s.close(); }
});

test('terminal handlers transform in registration order, consume short circuits, and removal clears all handlers', options, async () => {
  const s = await fixture();
  try {
    await s.initialize(); await s.prompt('/ui-terminal-ordered');
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'go' })), { consume: false, input: 'go:first:second:third' });
    await s.notification('ui.notify', value => value.message === 'terminal-last:go:first:second');
    const start = s.notifications.length;
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'stop' })), { consume: true });
    await s.prompt('/ui-clear');
    assert.ok(!s.notifications.slice(start).some(entry => entry.method === 'ui.notify' && (entry.value as { message: string }).message.startsWith('terminal-last:')));
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'go' })), { consume: false, input: 'go' });
    await s.shutdown();
  } finally { await s.close(); }
});

for (const mode of ['chat.abort', 'jsonrpc'] as const) {
  test(`${mode} cancels a pending dialog host token and settles the prompt without model I/O`, options, async () => {
    const s = await fixture();
    const source = new CancellationTokenSource();
    try {
      await s.initialize(); s.answerDialogs = false;
      const prompt = s.client.sendRequest(Requests.prompt, { message: '/ui-wait' }, source.token);
      const rejected = assert.rejects(Promise.resolve(prompt), error => {
        assert.ok(error instanceof ResponseError); assert.equal(error.code, TaurenErrorCodes.Cancelled); return true;
      });
      const dialog = await s.waitFor(() => s.dialogs[0], 'pending cancellation dialog');
      if (mode === 'chat.abort') await s.request(s.client.sendRequest(Requests.abort, null));
      else source.cancel();
      await s.cancelled(dialog.token); await bounded(rejected, 'cancelled prompt');
      await s.notification('ui.notify', value => value.message === 'wait-result:undefined');
      assert.ok(!s.events.some(entry => entry.event.type === 'agent_start'));
      s.answerDialogs = true;
      await s.prompt('/ui-dialogs');
      await s.shutdown();
    } finally { source.dispose(); await s.close(); }
  });
}

test('disconnect during session_start dialog tears down initialization without host response', options, async () => {
  const s = await fixture(true);
  try {
    const initialize = s.initialize(); void initialize.catch(() => undefined);
    const dialog = await s.waitFor(() => s.dialogs[0], 'startup dialog before initialize resolves');
    assert.equal((dialog.value as { title: string }).title, 'startup-dialog');
    await s.disconnect();
    await assert.rejects(initialize);
  } finally { await s.close(); }
});

test('extension newSession and switchSession reset UI and rebind SDK autocomplete', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    // Pi persists a newly-created session after an assistant turn, not a UI-only command.
    const turnStart = s.events.length;
    await s.prompt('persist-ui-origin');
    await s.waitFor(() => s.events.slice(turnStart).find(entry => entry.event.type === 'agent_settled'), 'persisted origin');
    const original = await s.request(s.client.sendRequest(Requests.getState, null));
    assert.equal(typeof original.sessionFile, 'string');
    for (const command of ['/ui-new-session', `/ui-switch-session ${original.sessionFile}`]) {
      const surfaceStart = s.surfaces.length;
      await s.prompt('/ui-background');
      const pending = await s.waitFor(() => s.surfaces[surfaceStart], 'background before replacement');
      const before = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
      const start = s.notifications.length;
      const eventStart = s.events.length;
      await s.prompt(command);
      assert.deepEqual(s.events.slice(eventStart).filter(entry => entry.event.type === 'extension_error'), [], `extension failed: ${command}`);
      await s.cancelled(pending.token);
      assert.deepEqual((await render(s, pending.params.surfaceId)).lines, []);
      await s.notification('ui.notify', value => value.message === 'ui-fixture:session-start', start);
      await s.notification('ui.notify', value => value.message === (command.startsWith('/ui-new') ? 'new-session:fresh-context' : 'switch-session:fresh-context'), start);
      const after = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
      assert.ok(after.generation > before.generation);
      assert.ok(after.triggerCharacters.includes('%'));
      const completion = await s.request(s.client.sendRequest(Requests.getCompletions, { id: command, revision: 1, text: '%ui', selectionStart: 3, selectionEnd: 3 }));
      assert.equal(completion.items[0]?.label, 'UI completion');
    }
    await s.shutdown();
  } finally { await s.close(); }
});

// A command is prompt_handled, not an assistant turn. UI timeouts never fall
// through to a provider or depend on network/service credentials.
test('SDK session_start UI and dialog reverse request payloads, notifications and surfaces', options, async () => {
  const s = await fixture();
  try {
    const initialized = await s.initialize();
    for (const method of [UiRequests.render, UiRequests.surfaceInput, UiRequests.dispose, UiRequests.terminalInput]) {
      assert.ok(initialized.capabilities.includes(method.method), `missing ${method.method}`);
    }
    await s.notification(Notifications.notify.method, value => value.message === 'ui-fixture:session-start');
    await s.prompt('/ui-dialogs');
    assert.deepEqual(s.dialogs.map(({ method, value }) => ({ method, value })), [
      { method: 'ui.select', value: { title: 'fixture-select', options: ['one', 'two'] } },
      { method: 'ui.confirm', value: { title: 'fixture-confirm', message: 'Continue?' } },
      { method: 'ui.input', value: { title: 'fixture-input', placeholder: 'placeholder' } },
      { method: 'ui.editor', value: { title: 'fixture-editor', prefill: 'prefill' } }
    ]);
    await s.notification('ui.notify', value => value.message === 'dialogs:{"select":"two","confirm":true,"input":"typed","editor":"edited"}');
    await s.prompt('/ui-notifications');
    await s.notification('ui.notify', value => value.message === 'fixture-warning' && value.notifyType === 'warning');
    await s.notification('ui.status', value => value.key === 'fixture' && value.text === 'ready');
    await s.notification('ui.widget', value => value.key === 'lines' && value.placement === 'aboveEditor' && value.content[0] === 'above');
    const widget = await s.notification('ui.widget', value => value.key === 'component');
    const widgetId = (widget.value as { content: { surfaceId: string } }).content.surfaceId;
    assert.deepEqual((await render(s, widgetId)).lines, ['below-component']);
    const footer = await s.notification('ui.footer', value => typeof value.surfaceId === 'string');
    const footerId = (footer.value as { surfaceId: string }).surfaceId;
    assert.deepEqual((await render(s, footerId)).lines, ['footer:ready']);
    await s.notification('ui.setEditorText', value => value.text === 'fixture editor');
    await s.notification('ui.pasteToEditor', value => value.text === ' pasted');
    await s.notification('ui.setToolsExpanded', value => value.expanded === true);
    await s.notification('ui.notify', value => value.message === 'editor:;expanded:true');
    await s.prompt('/ui-clear');
    await s.notification('ui.status', value => value.key === 'fixture' && value.text === null);
    await s.notification('ui.widget', value => value.key === 'component' && value.content === null);
    await s.notification('ui.footer', value => value.surfaceId === null);
    assert.deepEqual((await render(s, widgetId)).lines, []);
    assert.deepEqual((await render(s, footerId)).lines, []);
    assert.ok(s.events.some(entry => entry.event.type === 'prompt_handled'));
    assert.ok(!s.events.some(entry => entry.event.type === 'agent_start'));
    await s.shutdown();
  } finally { await s.close(); }
});

test('custom done(T) stays local while host render/input proceeds with reverse request pending', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    const surface = await custom(s);
    assert.equal(surface.token.isCancellationRequested, false);
    assert.equal(typeof surface.params.surfaceId, 'string');
    assert.equal(surface.params.options.overlay, true);
    assert.deepEqual((await render(s, surface.params.surfaceId)).lines, ['custom:initial:43']);
    await s.request(s.client.sendRequest(UiRequests.surfaceInput, { surfaceId: surface.params.surfaceId, input: 'updated' }));
    await s.notification('ui.invalidate', value => value.surfaceId === surface.params.surfaceId);
    assert.deepEqual((await render(s, surface.params.surfaceId)).lines, ['custom:updated:43']);
    assert.equal(surface.token.isCancellationRequested, false);
    await s.request(s.client.sendRequest(UiRequests.surfaceInput, { surfaceId: surface.params.surfaceId, input: 'done' }));
    await s.cancelled(surface.token);
    await surface.prompt;
    await s.notification('ui.notify', value => value.message === 'custom-result:{"local":"secret-result","functionStayedLocal":true}');
    assert.deepEqual((await render(s, surface.params.surfaceId)).lines, []);
    // Stale input/dispose are safe no-ops, never forwarded to another component.
    assert.equal(await s.request(s.client.sendRequest(UiRequests.surfaceInput, { surfaceId: surface.params.surfaceId, input: 'done' })), null);
    assert.equal(await s.request(s.client.sendRequest(UiRequests.dispose, { surfaceId: surface.params.surfaceId })), null);
    await s.shutdown();
  } finally { await s.close(); }
});

test('host dismissal and explicit disposal resolve custom UI without transporting done value', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    const first = await custom(s);
    first.dismiss();
    await first.prompt;
    await s.notification('ui.notify', value => value.message === 'custom-result:null');
    assert.deepEqual((await render(s, first.params.surfaceId)).lines, []);
    const second = await custom(s);
    assert.notEqual(first.params.surfaceId, second.params.surfaceId);
    await s.request(s.client.sendRequest(UiRequests.dispose, { surfaceId: second.params.surfaceId }));
    await s.cancelled(second.token);
    await second.prompt;
    assert.deepEqual((await render(s, second.params.surfaceId)).lines, []);
    await s.shutdown();
  } finally { await s.close(); }
});

test('dialog timeout and AbortSignal cancel host tokens and return SDK dismissal values offline', options, async () => {
  const s = await fixture();
  try {
    await s.initialize(); s.answerDialogs = false;
    for (const [command, title, result] of [['/ui-timeout', 'fixture-timeout', 'timeout:undefined'],
      ['/ui-abort', 'fixture-abort', 'abort:undefined']]) {
      const prompt = s.prompt(command!); void prompt.catch(() => undefined);
      const dialog = await s.waitFor(() => s.dialogs.find(entry => (entry.value as { title: string }).title === title), title!);
      if (command === '/ui-timeout') assert.equal((dialog.value as { timeoutMs: number }).timeoutMs, 120);
      await s.cancelled(dialog.token);
      await prompt;
      await s.notification('ui.notify', value => value.message === result);
    }
    assert.equal(s.events.filter(entry => entry.event.type === 'prompt_handled').length, 2);
    assert.ok(!s.events.some(entry => entry.event.type === 'agent_start'));
    await s.shutdown();
  } finally { await s.close(); }
});

test('terminal input subscription consume/transform/removal and SDK autocomplete factory registration', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    await s.prompt('/ui-terminal');
    await s.notification('ui.terminalInputSubscription', value => value.enabled === true);
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'consume' })), { consume: true });
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'transform' })), { consume: false, input: 'transformed' });
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'plain' })), { consume: false, input: 'plain' });
    const capabilities = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
    assert.ok(capabilities.triggerCharacters.includes('%'));
    const completions = await s.request(s.client.sendRequest(Requests.getCompletions, {
      id: 'ui', revision: 7, text: '%ui', selectionStart: 3, selectionEnd: 3
    }));
    assert.equal(completions.items[0]?.label, 'UI completion');
    const itemId = completions.items[0]!.id;
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.applyCompletion, { id: 'ui', revision: 7, itemId })), {
      id: 'ui', revision: 7, text: '%ui-complete', selectionStart: 12, selectionEnd: 12
    });
    assert.equal(await s.request(s.client.sendRequest(Requests.applyCompletion, { id: 'ui', revision: 7, itemId })), null);
    const start = s.notifications.length;
    await s.prompt('/ui-clear');
    await s.notification('ui.terminalInputSubscription', value => value.enabled === false, start);
    assert.deepEqual(await s.request(s.client.sendRequest(UiRequests.terminalInput, { input: 'consume' })), { consume: false, input: 'consume' });
    await s.shutdown();
  } finally { await s.close(); }
});

test('reload resets pending surfaces, tokens and completion handles; disconnect exits with interaction open', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    await s.prompt('/ui-background');
    const pending = await s.waitFor(() => s.surfaces[0], 'background custom request');
    const capabilities = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
    const completions = await s.request(s.client.sendRequest(Requests.getCompletions, {
      id: 'old', revision: 1, text: '%ui', selectionStart: 3, selectionEnd: 3
    }));
    const resetStart = s.notifications.length;
    await s.request(s.client.sendRequest(Requests.reload, null));
    await s.notification('ui.clearStatuses', () => true, resetStart);
    await s.notification('ui.clearWidgets', () => true, resetStart);
    await s.notification('ui.terminalInputSubscription', value => value.enabled === false, resetStart);
    await s.cancelled(pending.token);
    assert.deepEqual((await render(s, pending.params.surfaceId)).lines, []);
    const updated = await s.request(s.client.sendRequest(Requests.getCompletionCapabilities, null));
    assert.ok(updated.generation > capabilities.generation);
    assert.ok(updated.triggerCharacters.includes('%'));
    assert.equal(await s.request(s.client.sendRequest(Requests.applyCompletion, {
      id: 'old', revision: 1, itemId: completions.items[0]!.id
    })), null);
    const next = await custom(s);
    assert.notEqual(next.params.surfaceId, pending.params.surfaceId);
    await s.disconnect();
    await assert.rejects(next.prompt);
  } finally { await s.close(); }
});

test('shutdown resets a pending dialog and cancels its host token without waiting for host response', options, async () => {
  const s = await fixture();
  try {
    await s.initialize(); s.answerDialogs = false;
    const prompt = s.prompt('/ui-dialogs'); void prompt.catch(() => undefined);
    const dialog = await s.waitFor(() => s.dialogs[0], 'pending select');
    await s.shutdown();
    await s.cancelled(dialog.token);
    // Teardown may resolve or reject the already-dispatched prompt, but must
    // never wait for the host's deliberately unresolved reverse request.
    await bounded(prompt.catch(() => null), 'pending prompt teardown');
  } finally { await s.close(); }
});

test('custom message and registered read-tool renderers enrich real SDK wire events', options, async () => {
  const s = await fixture();
  try {
    await s.initialize();
    await s.prompt('/ui-message');
    const message = await s.waitFor(() => s.events.find(entry => entry.event.type === 'message_end'
      && (entry.event.message as { customType?: string } | undefined)?.customType === 'ui-fixture'), 'rendered custom message');
    assert.deepEqual((message.event.message as Record<string, JsonValue>).taurenRenderedMessage, {
      body: 'message:fixture payload:collapsed', expandedBody: 'message:fixture payload:expanded', code: true
    });
    const start = s.events.length;
    await s.prompt('tools-roundtrip');
    await s.waitFor(() => s.events.slice(start).find(entry => entry.event.type === 'agent_settled'), 'offline tool turn');
    const reads = s.events.slice(start).filter(entry => entry.event.toolName === 'read');
    assert.equal(reads.filter(entry => entry.event.type === 'tool_execution_start').length, 2);
    for (const entry of reads.filter(entry => entry.event.type === 'tool_execution_start')) {
      assert.deepEqual(entry.event.taurenRenderedTool, { body: 'read-call:roundtrip.txt', code: true });
    }
    for (const entry of reads.filter(entry => entry.event.type === 'tool_execution_end')) {
      assert.deepEqual(entry.event.taurenRenderedTool, {
        body: 'read-result:collapsed', expandedBody: 'read-result:expanded', code: true
      });
    }
    assert.equal(reads.filter(entry => entry.event.type === 'tool_execution_end').length, 2);
    await s.shutdown();
  } finally { await s.close(); }
});
