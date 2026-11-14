import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  CancellationTokenSource, ErrorCodes, Requests, ResponseError, TaurenErrorCodes, type Snapshot
} from '../protocol/index.js';
import {
  createServerFixture, completeTurn, eventually, rejectsCode, serverTestOptions,
  type ServerFixture, type ServerProcess
} from './serverFixture.js';

/** Session lifecycle and persistence black-box acceptance tests. Build with npm run build in sandbox-server;
 * once sessionControls is registered, run node --test dist/test/sessions.test.js.
 * The sole provider is the ordinary offline extension loaded by isolated settings.
 * No SDK, session manager, runtime, tool, or server handlers are mocked.
 */
async function initialize(f: ServerFixture, sessionFile?: string) {
  const s = f.launch();
  const result = await s.request(s.client.sendRequest(Requests.initialize,
    { ...f.params, ...(sessionFile ? { sessionFile } : {}) }));
  return { s, result };
}

async function sessionFile(s: ServerProcess) {
  const state = await s.request(s.client.sendRequest(Requests.getState, null));
  assert.equal(typeof state.sessionFile, 'string');
  return state.sessionFile as string;
}

function assertWithin(directory: string, file: string) {
  const relative = path.relative(directory, file);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${file} must be within ${directory}`);
}

async function assertPinned(f: ServerFixture, s: ServerProcess) {
  assertWithin(f.sessionDirectory, await sessionFile(s));
  await completeTurn(s, 'source-check');
  const last = await s.request(s.client.sendRequest(Requests.getLastAssistantText, null));
  assert.equal(last.text, `fixture: source-check [source=rpc;cwd=${f.workspace};processCwd=${f.workspace}]`);
}

function entry(tree: Snapshot[], role: string, text: string) {
  const found = tree.find(node => node.role === role && node.text === text);
  assert.ok(found, `Missing ${role} tree entry: ${text}`);
  assert.equal(typeof found.entryId, 'string');
  return found.entryId as string;
}

async function records(file: string): Promise<Record<string, unknown>[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

const controls = [Requests.setSessionName, Requests.compact, Requests.exportHtml,
  Requests.switchSession, Requests.importJsonl, Requests.getTree, Requests.setTreeEntryLabel,
  Requests.navigateTree, Requests.getForkMessages, Requests.fork, Requests.clone,
  Requests.listSessions, Requests.traceOrigin];

test('session capabilities, names, tree labels and history survive a real process restart', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s, result } = await initialize(f);
    for (const control of controls) assert.ok(result.capabilities.includes(control.method), control.method);
    await completeTurn(s, 'first persisted turn');
    await completeTurn(s, 'second persisted turn');
    assert.equal(await s.request(s.client.sendRequest(Requests.setSessionName, { name: 'Persisted session history' })), null);
    const tree = await s.request(s.client.sendRequest(Requests.getTree, null));
    const first = entry(tree, 'user', 'first persisted turn');
    const second = entry(tree, 'user', 'second persisted turn');
    assert.equal(await s.request(s.client.sendRequest(Requests.setTreeEntryLabel,
      { entryId: first, label: 'keep this branch' })), null);
    await s.request(s.client.sendRequest(Requests.setTreeEntryLabel, { entryId: second, label: 'temporary' }));
    await s.request(s.client.sendRequest(Requests.setTreeEntryLabel, { entryId: second, label: null }));
    const labeled = await s.request(s.client.sendRequest(Requests.getTree, null));
    assert.equal(labeled.find(node => node.entryId === first)?.label, 'keep this branch');
    assert.ok(!labeled.find(node => node.entryId === second)?.label);
    const history = await s.request(s.client.sendRequest(Requests.getMessages, null));
    const file = await sessionFile(s);
    await s.shutdown();

    const { s: reopened } = await initialize(f, file);
    assert.deepEqual(await reopened.request(reopened.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await reopened.request(reopened.client.sendRequest(Requests.getLastAssistantText, null))).text,
      'fixture: second persisted turn');
    assert.equal((await reopened.request(reopened.client.sendRequest(Requests.getTree, null)))
      .find(node => node.entryId === first)?.label, 'keep this branch');
    const listed = await reopened.request(reopened.client.sendRequest(Requests.listSessions, { workspace: f.workspace }));
    assert.equal(listed.find(item => item.path === file)?.name, 'Persisted session history');
    await reopened.shutdown();
  } finally { await f.close(); }
});

test('fork at a user message excludes that turn; clone preserves history; switch restores the source', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    await completeTurn(s, 'fork predecessor');
    const beforeSelected = await s.request(s.client.sendRequest(Requests.getMessages, null));
    const originalHistory = await completeTurn(s, 'selected user turn');
    const original = await sessionFile(s);
    const tree = await s.request(s.client.sendRequest(Requests.getTree, null));
    const selected = entry(tree, 'user', 'selected user turn');
    const forkMessages = await s.request(s.client.sendRequest(Requests.getForkMessages, null));
    assert.ok(Array.isArray(forkMessages.messages));
    assert.ok(forkMessages.messages.some(item => (item as Snapshot).entryId === selected
      && (item as Snapshot).text === 'selected user turn'));
    const forked = await s.request(s.client.sendRequest(Requests.fork, { entryId: selected }));
    assert.notEqual(forked.cancelled, true);
    assert.equal(forked.text, 'selected user turn');
    const forkPath = await sessionFile(s);
    assert.notEqual(forkPath, original);
    assertWithin(f.sessionDirectory, forkPath);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), beforeSelected);
    await completeTurn(s, 'fork-only continuation');
    const forkHistory = await s.request(s.client.sendRequest(Requests.getMessages, null));
    const cloned = await s.request(s.client.sendRequest(Requests.clone, null));
    assert.notEqual(cloned.cancelled, true);
    const clonePath = await sessionFile(s);
    assert.notEqual(clonePath, forkPath);
    assertWithin(f.sessionDirectory, clonePath);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), forkHistory);
    await completeTurn(s, 'clone-only continuation');
    await s.request(s.client.sendRequest(Requests.switchSession, { sessionPath: original }));
    assert.equal(await sessionFile(s), original);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), originalHistory);
    await s.request(s.client.sendRequest(Requests.navigateTree,
      { entryId: entry(tree, 'assistant', 'fixture: fork predecessor'), summarize: false }));
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), beforeSelected);
    await assertPinned(f, s);
    await s.shutdown();
  } finally { await f.close(); }
});

test('JSONL import copies history into the initialized store and HTML export writes a real document', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    const history = await completeTurn(s, 'portable history marker');
    const original = await sessionFile(s);
    const foreignCwd = path.join(f.directory, 'foreign-workspace');
    await mkdir(foreignCwd);
    // Derive a portable file from actual SDK output, not fabricated messages.
    const sourceRecords = await records(original);
    sourceRecords[0] = { ...sourceRecords[0], cwd: foreignCwd };
    const input = path.join(f.directory, 'portable.jsonl');
    const source = sourceRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    await writeFile(input, source);
    const imported = await s.request(s.client.sendRequest(Requests.importJsonl, { inputPath: input }));
    assert.notEqual(imported.cancelled, true);
    const importedPath = await sessionFile(s);
    assert.notEqual(importedPath, original);
    assert.notEqual(importedPath, input);
    assertWithin(f.sessionDirectory, importedPath);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await records(importedPath))[0]!.cwd, f.workspace);
    assert.equal(await readFile(input, 'utf8'), source, 'Import must not rewrite the source file');
    await assertPinned(f, s);
    const htmlPath = path.join(f.workspace, 'session-export.html');
    const exported = await s.request(s.client.sendRequest(Requests.exportHtml, { outputPath: htmlPath }));
    assert.equal(exported.path, htmlPath);
    const html = await readFile(htmlPath, 'utf8');
    assert.match(html, /<!doctype html|<html/i);
    assert.equal(exported.html, html, 'Wire HTML must match the exported document');
    const encoded = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(html);
    assert.ok(encoded, 'Export must embed session data');
    const data = JSON.parse(Buffer.from(encoded[1]!, 'base64').toString('utf8')) as {
      header: { cwd: string }; entries: Record<string, unknown>[];
    };
    assert.equal(data.header.cwd, f.workspace);
    assert.ok(Array.isArray(data.entries));
    assert.deepEqual(data.entries.filter(record => record.type === 'message').map(record => record.message),
      (await s.request(s.client.sendRequest(Requests.getMessages, null))).messages);
    assert.match(JSON.stringify(data.entries), /portable history marker/);
    const defaultExport = await s.request(s.client.sendRequest(Requests.exportHtml, {}));
    assert.equal(typeof defaultExport.path, 'string');
    const defaultHtml = await readFile(defaultExport.path as string, 'utf8');
    assert.match(defaultHtml, /<html/i);
    assert.equal(defaultExport.html, defaultHtml);
    await s.shutdown();
    const { s: reopened } = await initialize(f, importedPath);
    assert.match(JSON.stringify(await reopened.request(reopened.client.sendRequest(Requests.getMessages, null))), /portable history marker/);
    await reopened.shutdown();
  } finally { await f.close(); }
});

test('switch rejects foreign sessions and import cannot override initialized cwd', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    const history = await completeTurn(s, 'configuration stays pinned');
    const original = await sessionFile(s);
    const foreignCwd = path.join(f.directory, 'foreign');
    await mkdir(foreignCwd);
    const foreignRecords = await records(original);
    foreignRecords[0] = { ...foreignRecords[0], cwd: foreignCwd };
    const inside = path.join(f.sessionDirectory, 'foreign-cwd.jsonl');
    const outside = path.join(f.directory, 'outside.jsonl');
    await writeFile(inside, foreignRecords.map(record => JSON.stringify(record)).join('\n') + '\n');
    await writeFile(outside, await readFile(original));
    for (const sessionPath of [inside, outside]) {
      await rejectsCode(s.request(s.client.sendRequest(Requests.switchSession, { sessionPath })), ErrorCodes.InvalidParams);
    }
    await rejectsCode(s.request(s.client.sendRequest(Requests.importJsonl,
      { inputPath: outside, cwdOverride: foreignCwd })), ErrorCodes.InvalidParams);
    assert.equal(await sessionFile(s), original);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), history);
    await assertPinned(f, s);
    await s.shutdown();
  } finally { await f.close(); }
});

test('sessions.list is store-scoped and traceOrigin finds real write/edit tool-call records', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    await completeTurn(s, 'tools-roundtrip');
    assert.equal(await readFile(path.join(f.workspace, 'roundtrip.txt'), 'utf8'), 'after\n');
    const file = await sessionFile(s);
    const persisted = await records(file);
    // A second valid session outside the configured store must not leak in.
    await mkdir(f.wrongSessions, { recursive: true });
    const decoy = path.join(f.wrongSessions, 'outside.jsonl');
    await writeFile(decoy, await readFile(file));
    for (const params of [{}, { workspace: f.workspace }]) {
      const listed = await s.request(s.client.sendRequest(Requests.listSessions, params));
      assert.ok(listed.some(item => item.path === file));
      assert.ok(!listed.some(item => item.path === decoy));
      for (const item of listed) {
        assert.equal(typeof item.path, 'string');
        assertWithin(f.sessionDirectory, item.path as string);
        assert.equal(item.cwd, f.workspace);
      }
    }
    for (const [content, toolName] of [['before', 'write'], ['after', 'edit']] as const) {
      const origin = await s.request(s.client.sendRequest(Requests.traceOrigin,
        { sessionFile: file, path: path.join(f.workspace, 'roundtrip.txt'), content }));
      assert.ok(origin, `traceOrigin must find ${toolName} content ${JSON.stringify(content)} in real SDK tool-call records`);
      assert.equal(origin.sessionPath, file);
      assert.equal(origin.toolName, toolName);
      assert.equal(typeof origin.recordId, 'string');
      const record = persisted.find(record => {
        const message = record.message as { content?: { id?: string; name?: string }[] } | undefined;
        return record.id === origin.recordId
          || (Array.isArray(message?.content) && message.content.some(call => call.id === origin.recordId));
      });
      assert.ok(record, 'Origin must identify a tool call in persisted SDK output');
      assert.match(JSON.stringify(record), new RegExp(`"name":"${toolName}"`));
    }
    const acrossStore = await s.request(s.client.sendRequest(Requests.traceOrigin, { inputs: [
      { kind: 'selection', path: 'different-name.txt', text: 'after' },
      { kind: 'file', path: 'roundtrip.txt' }
    ] }));
    assert.equal(acrossStore?.sessionPath, file);
    assert.equal(acrossStore?.toolName, 'write', 'A path match precedes a content-only selection match');
    assert.equal(await s.request(s.client.sendRequest(Requests.traceOrigin,
      { sessionFile: file, path: 'never-created.txt', content: 'unique missing content' })), null);
    await rejectsCode(s.request(s.client.sendRequest(Requests.traceOrigin,
      { sessionFile: decoy, path: 'roundtrip.txt' })), ErrorCodes.InvalidParams);
    await s.shutdown();
  } finally { await f.close(); }
});

test('manual compaction uses the real offline provider and persists a resumable summary', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    for (let index = 0; index < 4; index++) await completeTurn(s, `compaction history ${index}: ${'detail '.repeat(100)}`);
    const compacted = await s.request(s.client.sendRequest(Requests.compact, { customInstructions: 'Preserve the history markers.' }));
    assert.equal(typeof compacted.summary, 'string');
    assert.ok((compacted.summary as string).length > 0);
    assert.equal(typeof compacted.tokensBefore, 'number');
    const file = await sessionFile(s);
    const compaction = (await records(file)).find(record => record.type === 'compaction');
    assert.ok(compaction);
    assert.equal(compaction.summary, compacted.summary);
    await completeTurn(s, 'after manual compaction');
    const history = await s.request(s.client.sendRequest(Requests.getMessages, null));
    await s.shutdown();
    const { s: reopened } = await initialize(f, file);
    assert.deepEqual(await reopened.request(reopened.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await reopened.request(reopened.client.sendRequest(Requests.getLastAssistantText, null))).text,
      'fixture: after manual compaction');
    await reopened.shutdown();
  } finally { await f.close(); }
});

test('cancellation during compaction aborts the SDK signal and preserves history', serverTestOptions, async () => {
  const f = await createServerFixture();
  const cancellation = new CancellationTokenSource();
  try {
    const settingsPath = path.join(f.agent, 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    settings.extensions.push(fileURLToPath(new URL('./fixtures/slow-compaction.js', import.meta.url)));
    await writeFile(settingsPath, JSON.stringify(settings));
    const { s } = await initialize(f);
    const history = await completeTurn(s, 'history before cancellation');
    const file = await sessionFile(s);
    const before = await readFile(file, 'utf8');
    // Wait for the public fixture marker before cancelling: a pre-cancelled
    // synchronous mutation can legitimately finish before $/cancelRequest arrives.
    const response = s.request(s.client.sendRequest(Requests.compact,
      { customInstructions: 'wait for compaction cancellation' }, cancellation.token));
    const rejection = rejectsCode(response, TaurenErrorCodes.Cancelled);
    void rejection.catch(() => undefined);
    await eventually(async () => await readFile(path.join(f.workspace, 'compaction-entered'), 'utf8')
      .catch(() => '') === 'entered', 'SDK before-compaction hook entry');
    cancellation.cancel();
    await rejection;
    assert.equal(await readFile(path.join(f.workspace, 'compaction-aborted'), 'utf8'), 'aborted',
      'Cancellation must reach the actual SDK compaction AbortSignal');
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(await s.request(s.client.sendRequest(Requests.getMessages, null)), history);
    assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, false);
    await completeTurn(s, 'usable after cancellation');
    const recovered = await s.request(s.client.sendRequest(Requests.compact, {}));
    assert.equal(typeof recovered.summary, 'string', 'Cancellation must release the mutation guard and compaction state');
    assert.ok((await records(file)).some(record => record.type === 'compaction'));
    await s.shutdown();
  } finally { cancellation.dispose(); await f.close(); }
});

test('session mutations reject while streaming and leave the active session intact', serverTestOptions, async () => {
  const f = await createServerFixture();
  try {
    const { s } = await initialize(f);
    await completeTurn(s, 'before busy guard');
    const file = await sessionFile(s);
    const tree = await s.request(s.client.sendRequest(Requests.getTree, null));
    const entryId = entry(tree, 'user', 'before busy guard');
    const filesBefore = await readdir(f.sessionDirectory);
    const busyStart = s.events.length;
    await s.request(s.client.sendRequest(Requests.prompt, { message: 'wait-for-abort' }));
    await s.waitForEvent(({ event }) => (event.assistantMessageEvent as Snapshot | undefined)?.delta === 'fixture: waiting');
    const operations = [
      () => s.client.sendRequest(Requests.setSessionName, { name: 'busy rename' }),
      () => s.client.sendRequest(Requests.setTreeEntryLabel, { entryId, label: 'busy label' }),
      () => s.client.sendRequest(Requests.compact, {}),
      () => s.client.sendRequest(Requests.switchSession, { sessionPath: file }),
      () => s.client.sendRequest(Requests.importJsonl, { inputPath: file }),
      () => s.client.sendRequest(Requests.fork, { entryId }),
      () => s.client.sendRequest(Requests.clone, null),
      () => s.client.sendRequest(Requests.navigateTree, { entryId, summarize: false })
    ];
    for (const operation of operations) {
      await assert.rejects(s.request(operation()), error => {
        assert.ok(error instanceof ResponseError);
        assert.match(error.message, /busy|stream|running|idle/i);
        return true;
      });
    }
    assert.equal(await sessionFile(s), file);
    assert.deepEqual(await readdir(f.sessionDirectory), filesBefore);
    assert.equal((await s.request(s.client.sendRequest(Requests.getState, null))).isStreaming, true);
    await s.request(s.client.sendRequest(Requests.abort, null));
    await s.waitForEvent(event => s.events.indexOf(event) >= busyStart && event.event.type === 'agent_settled');
    await completeTurn(s, 'after busy guard');
    await s.shutdown();
  } finally { await f.close(); }
});
