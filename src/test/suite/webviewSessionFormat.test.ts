import * as assert from 'assert';
import { getSessionIndicatorKinds } from '../../webview/sessions/sessionElements';
import { getSessionDisplayName, getSessionNameEditValue } from '../../webview/sessions/sessionFormat';
import type { SessionItem } from '../../webview/types';

suite('Webview session format', () => {
  test('uses the displayed fallback title as the session-list rename prefill', () => {
    const session = createSession({ firstMessage: 'Investigate failing tests' });

    assert.strictEqual(getSessionDisplayName(session), 'Investigate failing tests');
    assert.strictEqual(getSessionNameEditValue(session), 'Investigate failing tests');
  });

  test('keeps explicit session names as the rename prefill', () => {
    const session = createSession({ name: ' Feature work ', firstMessage: 'Investigate failing tests' });

    assert.strictEqual(getSessionNameEditValue(session), 'Feature work');
  });

  test('does not prefill loading metadata text', () => {
    const session = createSession({ metadataState: 'loading', firstMessage: 'Loading metadata…' });

    assert.strictEqual(getSessionDisplayName(session), 'Loading metadata…');
    assert.strictEqual(getSessionNameEditValue(session), '');
  });

  test('uses separate right-side indicators for live status', () => {
    assert.deepStrictEqual(getSessionIndicatorKinds(createSession({ liveStatus: 'running' })), ['running']);
    assert.deepStrictEqual(getSessionIndicatorKinds(createSession({ liveStatus: 'done' })), ['done']);
    assert.deepStrictEqual(getSessionIndicatorKinds(createSession({ current: true, liveStatus: 'done' })), ['done']);
    assert.deepStrictEqual(getSessionIndicatorKinds(createSession({ liveStatus: 'error' })), ['error']);
    assert.deepStrictEqual(getSessionIndicatorKinds(createSession({ liveStatus: 'idle' })), []);
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
    metadataState: overrides.metadataState,
    depth: overrides.depth ?? 0,
    isLast: overrides.isLast ?? true,
    ancestorContinues: overrides.ancestorContinues ?? [],
    current: overrides.current ?? false,
    liveStatus: overrides.liveStatus
  };
}
