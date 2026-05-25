import * as assert from 'assert';
import type * as vscode from 'vscode';
import { readSessionDiffSnapshot, writeSessionDiffSnapshot } from '../../diff/sessionDiffStorage';

const sessionDiffSnapshotsStorageKey = 'tauren.sessionDiffSnapshots';

suite('SessionDiffStorage', () => {
  test('prunes stored snapshots to the most recent 50', () => {
    const workspaceState = new FakeMemento();

    for (let index = 0; index < 55; index += 1) {
      writeSessionDiffSnapshot(workspaceState, `/sessions/${index}.jsonl`, {
        stats: { addedLines: index, removedLines: 0 }
      });
    }

    const stored = workspaceState.get<Record<string, unknown>>(sessionDiffSnapshotsStorageKey);

    assert.ok(stored);
    assert.strictEqual(Object.keys(stored).length, 50);
    assert.strictEqual(readSessionDiffSnapshot(workspaceState, '/sessions/0.jsonl'), undefined);
    assert.strictEqual(readSessionDiffSnapshot(workspaceState, '/sessions/4.jsonl'), undefined);
    assert.deepStrictEqual(readSessionDiffSnapshot(workspaceState, '/sessions/5.jsonl'), {
      stats: { addedLines: 5, removedLines: 0 }
    });
    assert.deepStrictEqual(readSessionDiffSnapshot(workspaceState, '/sessions/54.jsonl'), {
      stats: { addedLines: 54, removedLines: 0 }
    });
  });

  test('reads legacy snapshots without timestamps', () => {
    const workspaceState = new FakeMemento({
      [sessionDiffSnapshotsStorageKey]: {
        '/sessions/legacy.jsonl': { stats: { addedLines: 2.9, removedLines: -1 } }
      }
    });

    assert.deepStrictEqual(readSessionDiffSnapshot(workspaceState, '/sessions/legacy.jsonl'), {
      stats: { addedLines: 2, removedLines: 0 }
    });
  });

  test('drops malformed snapshots when writing', () => {
    const workspaceState = new FakeMemento({
      [sessionDiffSnapshotsStorageKey]: {
        '/sessions/bad.jsonl': { stats: 'bad' },
        '/sessions/good.jsonl': { stats: { addedLines: 1, removedLines: 2 }, updatedAt: 10 }
      }
    });

    writeSessionDiffSnapshot(workspaceState, '/sessions/new.jsonl', {
      stats: { addedLines: 3, removedLines: 4 }
    });

    const stored = workspaceState.get<Record<string, unknown>>(sessionDiffSnapshotsStorageKey);

    assert.ok(stored);
    assert.deepStrictEqual(Object.keys(stored).sort(), ['/sessions/good.jsonl', '/sessions/new.jsonl']);
  });
});

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();

  public constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.data.set(key, value);
    }
  }

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }

    return defaultValue;
  }

  public update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }

    return Promise.resolve();
  }

  public keys(): readonly string[] {
    return [...this.data.keys()];
  }
}
