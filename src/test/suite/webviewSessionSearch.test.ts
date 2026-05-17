import * as assert from 'assert';
import {
  ensureVisibleSessionSelection,
  getVisibleSessionIndexes,
  moveVisibleSessionSelection
} from '../../webview/sessions/sessionSearch';
import type { SessionItem } from '../../webview/types';

suite('Webview session search', () => {
  test('filters sessions by displayed title only', () => {
    const sessions = [
      createSession({ name: 'Alpha plan', firstMessage: 'ignored', cwd: '/workspace/needle' }),
      createSession({ name: 'Beta review', firstMessage: 'ignored', cwd: '/workspace/project' }),
      createSession({ name: '', firstMessage: 'Gamma fallback', cwd: '/workspace/project' })
    ];

    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, ''), [0, 1, 2]);
    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, 'ALPHA'), [0]);
    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, 'fallback'), [2]);
    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, 'needle'), []);
  });

  test('filters named sessions as a secondary filter', () => {
    const sessions = [
      createSession({ name: 'Alpha plan', firstMessage: 'ignored' }),
      createSession({ name: 'Beta review', firstMessage: 'ignored' }),
      createSession({ name: '', firstMessage: 'Alpha fallback' }),
      createSession({ name: '   ', firstMessage: 'Whitespace name' })
    ];

    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, '', { namedOnly: true }), [0, 1]);
    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, 'alpha', { namedOnly: true }), [0]);
    assert.deepStrictEqual(getVisibleSessionIndexes(sessions, 'fallback', { namedOnly: true }), []);
  });

  test('repairs selection to the first visible session', () => {
    assert.strictEqual(ensureVisibleSessionSelection(4, [2, 4, 7]), 4);
    assert.strictEqual(ensureVisibleSessionSelection(1, [2, 4, 7]), 2);
    assert.strictEqual(ensureVisibleSessionSelection(1, []), 0);
  });

  test('moves selection through visible sessions only', () => {
    const visibleIndexes = [2, 4, 7];

    assert.strictEqual(moveVisibleSessionSelection(2, visibleIndexes, 1), 4);
    assert.strictEqual(moveVisibleSessionSelection(4, visibleIndexes, -1), 2);
    assert.strictEqual(moveVisibleSessionSelection(7, visibleIndexes, 1), 7);
    assert.strictEqual(moveVisibleSessionSelection(2, visibleIndexes, -1), 2);
    assert.strictEqual(moveVisibleSessionSelection(99, visibleIndexes, 1), 2);
    assert.strictEqual(moveVisibleSessionSelection(99, visibleIndexes, -1), 7);
    assert.strictEqual(moveVisibleSessionSelection(0, [], 1), undefined);
  });
});

function createSession(overrides: Partial<SessionItem>): SessionItem {
  return {
    path: overrides.path ?? '/sessions/session.jsonl',
    id: overrides.id ?? 'session',
    cwd: overrides.cwd ?? '/workspace/project',
    name: overrides.name,
    parentSessionPath: overrides.parentSessionPath,
    created: overrides.created ?? '2026-01-01T00:00:00.000Z',
    modified: overrides.modified ?? '2026-01-01T00:00:00.000Z',
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? '',
    depth: overrides.depth ?? 0,
    isLast: overrides.isLast ?? true,
    ancestorContinues: overrides.ancestorContinues ?? [],
    current: overrides.current ?? false,
    liveStatus: overrides.liveStatus,
    unread: overrides.unread
  };
}
