import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { CompletionParams } from '../protocol/contract.js';
import type { PiAutocompleteSuggestions } from './baseProvider.js';
import { PiAutocompleteRegistry } from './piAutocompleteRegistry.js';

/** Real filesystem fixture, isolated from both the user's workspace and the Pi CLI. */
async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'tauren-completion-'));
  await mkdir(path.join(cwd, 'src'));
  await mkdir(path.join(cwd, 'node_modules'));
  await writeFile(path.join(cwd, 'node_modules', 'hidden.ts'), '');
  await writeFile(path.join(cwd, 'src', 'Alpha.ts'), '');
  await writeFile(path.join(cwd, 'My Notes.md'), '');
  return { cwd, close: () => rm(cwd, { recursive: true, force: true }) };
}

function request(text: string, revision = 1): CompletionParams {
  return { id: 'request', revision, text, selectionStart: text.length, selectionEnd: text.length };
}

const liveSignal = () => new AbortController().signal;

/** A controlled provider lets tests exercise reset/cancellation without timing sleeps. */
function deferredRegistry() {
  const registry = new PiAutocompleteRegistry();
  let finish!: (result: PiAutocompleteSuggestions) => void;
  registry.add(previous => ({
    ...previous,
    triggerCharacters: ['#'],
    getSuggestions: () => new Promise(resolve => { finish = resolve; })
  }));
  return { registry, finish: () => finish({ prefix: '@', items: [{ value: '@file.ts', label: 'file.ts' }] }) };
}

test('real @ suggestions preserve fuzzy matching, scoped paths, exclusions and quoting', async () => {
  const f = await fixture();
  try {
    const registry = new PiAutocompleteRegistry();
    const fuzzy = await registry.complete(request('@LPH'), f.cwd, liveSignal());
    assert.deepEqual(fuzzy.items.map(item => item.value), ['@src/Alpha.ts']);
    const scoped = await registry.complete(request('@src/al'), f.cwd, liveSignal());
    assert.deepEqual(scoped.items.map(item => item.value), ['@src/Alpha.ts']);
    const all = await registry.complete(request('@'), f.cwd, liveSignal());
    assert.ok(all.items.some(item => item.value === '@src/'));
    assert.ok(all.items.some(item => item.value === '@"My Notes.md"'));
    assert.ok(all.items.every(item => !item.value.includes('node_modules')));
    assert.deepEqual((await registry.complete(request('@../'), f.cwd, liveSignal())).items, []);
  } finally { await f.close(); }
});

test('opaque handles apply once, inserting spaces for files and keeping directory cursors open', async () => {
  const f = await fixture();
  try {
    const registry = new PiAutocompleteRegistry();
    const result = await registry.complete(request('read @alp'), f.cwd, liveSignal());
    const item = result.items[0]!;
    assert.notEqual(item.id, item.value);
    const application = { id: result.id, revision: result.revision, itemId: item.id };
    const text = 'read @src/Alpha.ts ';
    assert.deepEqual(registry.apply(application), {
      id: result.id, revision: result.revision, text, selectionStart: text.length, selectionEnd: text.length
    });
    assert.equal(registry.apply(application), undefined);
    const directory = await registry.complete(request('@sr'), f.cwd, liveSignal());
    const applied = registry.apply({ id: directory.id, revision: directory.revision, itemId: directory.items[0]!.id });
    assert.equal(applied?.text, '@src/');
    assert.equal(applied?.selectionStart, 5);
    const quoted = await registry.complete(request('@"My'), f.cwd, liveSignal());
    assert.equal(registry.apply({ id: quoted.id, revision: quoted.revision, itemId: quoted.items[0]!.id })?.text, '@"My Notes.md" ');
  } finally { await f.close(); }
});

test('stale revision, superseded handles and reset reject application', async () => {
  const f = await fixture();
  try {
    const registry = new PiAutocompleteRegistry();
    const first = await registry.complete(request('@alp'), f.cwd, liveSignal());
    assert.equal(registry.apply({ id: first.id, revision: 2, itemId: first.items[0]!.id }), undefined);
    const second = await registry.complete(request('@alp', 2), f.cwd, liveSignal());
    await registry.complete(request('@alp', 3), f.cwd, liveSignal());
    assert.equal(registry.apply({ id: second.id, revision: 2, itemId: second.items[0]!.id }), undefined);
    const current = await registry.complete(request('@alp', 4), f.cwd, liveSignal());
    registry.reset();
    assert.equal(registry.getCapabilities().generation, 1);
    assert.equal(registry.apply({ id: current.id, revision: 4, itemId: current.items[0]!.id }), undefined);
  } finally { await f.close(); }
});

test('reset invalidates in-flight provider results and restores base capabilities', async () => {
  const { registry, finish } = deferredRegistry();
  assert.deepEqual(registry.getCapabilities(), { triggerCharacters: ['@', '#'], generation: 0 });
  const pending = registry.complete(request('@'), undefined, liveSignal());
  registry.reset();
  finish();
  assert.deepEqual((await pending).items, []);
  assert.deepEqual(registry.getCapabilities(), { triggerCharacters: ['@'], generation: 1 });
});

test('aborted requests return no suggestions and aborted handles cannot apply', async () => {
  const { registry, finish } = deferredRegistry();
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual((await registry.complete(request('@'), undefined, controller.signal)).items, []);
  const active = new AbortController();
  const pending = registry.complete(request('@'), undefined, active.signal);
  active.abort();
  finish();
  assert.deepEqual((await pending).items, []);

  const f = await fixture();
  try {
    const base = new PiAutocompleteRegistry();
    const signal = new AbortController();
    const result = await base.complete(request('@alp'), f.cwd, signal.signal);
    signal.abort();
    assert.equal(base.apply({ id: result.id, revision: result.revision, itemId: result.items[0]!.id }), undefined);
  } finally { await f.close(); }
});

test('a newer request prevents an older in-flight result from restoring handles', async () => {
  const { registry, finish } = deferredRegistry();
  const older = registry.complete(request('@'), undefined, liveSignal());
  const newer = registry.complete(request('@', 2), undefined, AbortSignal.abort());
  finish();
  assert.deepEqual((await older).items, []);
  assert.deepEqual((await newer).items, []);
});
