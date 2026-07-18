import * as assert from 'assert';
import { decorateSessionTree } from '../../sessions/sessionTree';
import type { RawSessionInfo } from '../../sessions/types';

suite('sessionTree', () => {
  test('sorts roots and preserves nested session layout', () => {
    const sessions: RawSessionInfo[] = [
      createSession('/sessions/parent.jsonl', 'parent', '2026-01-02T00:00:00.000Z'),
      createSession('/sessions/child.jsonl', 'child', '2026-01-01T00:00:00.000Z', '/sessions/parent.jsonl'),
      createSession('/sessions/newer-root.jsonl', 'newer-root', '2026-01-03T00:00:00.000Z')
    ];

    const result = decorateSessionTree(sessions, '/sessions/child.jsonl');

    assert.deepStrictEqual(result.map((session) => ({
      id: session.id,
      depth: session.depth,
      isLast: session.isLast,
      ancestorContinues: session.ancestorContinues,
      current: session.current
    })), [
      { id: 'newer-root', depth: 0, isLast: false, ancestorContinues: [], current: false },
      { id: 'parent', depth: 0, isLast: true, ancestorContinues: [], current: false },
      { id: 'child', depth: 1, isLast: true, ancestorContinues: [false], current: true }
    ]);
  });
});

function createSession(path: string, id: string, modified: string, parentSessionPath?: string): RawSessionInfo {
  return {
    path,
    id,
    cwd: '/workspace',
    ...(parentSessionPath ? { parentSessionPath } : {}),
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id
  };
}
