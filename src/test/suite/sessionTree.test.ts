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

  test('renders self-referential and cyclic sessions as roots', () => {
    const sessions: RawSessionInfo[] = [
      createSession('/sessions/first.jsonl', 'first', '2026-01-03T00:00:00.000Z', '/sessions/second.jsonl'),
      createSession('/sessions/second.jsonl', 'second', '2026-01-02T00:00:00.000Z', '/sessions/third.jsonl'),
      createSession('/sessions/third.jsonl', 'third', '2026-01-01T00:00:00.000Z', '/sessions/first.jsonl'),
      createSession('/sessions/self.jsonl', 'self', '2026-01-04T00:00:00.000Z', '/sessions/self.jsonl')
    ];

    const result = decorateSessionTree(sessions, undefined);

    assert.deepStrictEqual(result.map((session) => ({ id: session.id, depth: session.depth })), [
      { id: 'self', depth: 0 },
      { id: 'first', depth: 0 },
      { id: 'second', depth: 0 },
      { id: 'third', depth: 0 }
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
