import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SessionDiffController } from '../../diff/sessionDiffController';
import type { SessionDiffSnapshot, SessionDiffStats } from '../../diff/types';

suite('SessionDiffController', () => {
  test('does not save or post unchanged refreshed stats', async () => {
    const sessionFile = '/tmp/tauren-session.jsonl';
    const savedSnapshots: Array<{ sessionFile: string; snapshot: SessionDiffSnapshot }> = [];
    let postStateCount = 0;

    const controller = new SessionDiffController({
      initialSessionFile: sessionFile,
      getSessionGeneration: () => 0,
      postState: () => {
        postStateCount += 1;
      },
      loadSnapshot: () => ({ stats: { addedLines: 2, removedLines: 1 } }),
      saveSnapshot: (savedSessionFile, snapshot) => {
        savedSnapshots.push({ sessionFile: savedSessionFile, snapshot });
      },
      restoreStatsFromSessionFile: async () => ({ addedLines: 2, removedLines: 1 })
    });

    await controller.refresh();

    assert.deepStrictEqual(controller.getStats(), { addedLines: 2, removedLines: 1 });
    assert.deepStrictEqual(savedSnapshots, []);
    assert.strictEqual(postStateCount, 0);
  });

  test('saves and posts changed refreshed stats', async () => {
    const sessionFile = '/tmp/tauren-session.jsonl';
    const savedSnapshots: Array<{ sessionFile: string; snapshot: SessionDiffSnapshot }> = [];
    let postStateCount = 0;

    const controller = new SessionDiffController({
      initialSessionFile: sessionFile,
      getSessionGeneration: () => 0,
      postState: () => {
        postStateCount += 1;
      },
      loadSnapshot: () => ({ stats: { addedLines: 2, removedLines: 1 } }),
      saveSnapshot: (savedSessionFile, snapshot) => {
        savedSnapshots.push({ sessionFile: savedSessionFile, snapshot });
      },
      restoreStatsFromSessionFile: async () => ({ addedLines: 3, removedLines: 1 })
    });

    await controller.refresh();

    assert.deepStrictEqual(controller.getStats(), { addedLines: 3, removedLines: 1 });
    assert.deepStrictEqual(savedSnapshots, [{ sessionFile, snapshot: { stats: { addedLines: 3, removedLines: 1 } } }]);
    assert.strictEqual(postStateCount, 1);
  });

  test('records a workspace file baseline only once', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-controller-'));
    const filePath = path.join(cwd, 'new-file.ts');
    const savedSnapshots: SessionDiffSnapshot[] = [];
    await fs.writeFile(filePath, 'const value = 1;\n');

    const controller = new SessionDiffController({
      initialSessionFile: '/tmp/tauren-session.jsonl',
      getSessionGeneration: () => 0,
      getCwd: () => cwd,
      postState: () => undefined,
      saveSnapshot: (_sessionFile, snapshot) => savedSnapshots.push(snapshot),
      restoreStatsFromSessionFile: async () => undefined
    });

    await controller.recordWorkspaceFileChange(filePath);
    await controller.recordWorkspaceFileChange(filePath);

    assert.strictEqual(savedSnapshots.length, 1);
    assert.deepStrictEqual(savedSnapshots[0].files, [{ path: 'new-file.ts', originalContent: '' }]);
  });

  test('ignores stale in-flight refresh after switching session files', async () => {
    const oldSessionFile = '/tmp/tauren-old-session.jsonl';
    const newSessionFile = '/tmp/tauren-new-session.jsonl';
    const pendingRestores = new Map<string, Deferred<SessionDiffStats | undefined>>();
    const savedSnapshots = new Map<string, SessionDiffSnapshot>();
    let postStateCount = 0;

    const controller = new SessionDiffController({
      initialSessionFile: oldSessionFile,
      getSessionGeneration: () => 0,
      postState: () => {
        postStateCount += 1;
      },
      saveSnapshot: (sessionFile, snapshot) => {
        savedSnapshots.set(sessionFile, snapshot);
      },
      restoreStatsFromSessionFile: (sessionFile) => {
        const deferred = createDeferred<SessionDiffStats | undefined>();
        pendingRestores.set(sessionFile, deferred);
        return deferred.promise;
      }
    });

    const oldRefresh = controller.refresh();
    assert.ok(pendingRestores.has(oldSessionFile));

    controller.applySessionFile(newSessionFile);
    const newRefresh = controller.refresh();
    assert.ok(pendingRestores.has(newSessionFile));

    pendingRestores.get(newSessionFile)?.resolve({ addedLines: 1, removedLines: 0 });
    await newRefresh;

    assert.deepStrictEqual(controller.getStats(), { addedLines: 1, removedLines: 0 });
    assert.strictEqual(postStateCount, 1);

    pendingRestores.get(oldSessionFile)?.resolve({ addedLines: 9, removedLines: 9 });
    await oldRefresh;

    assert.deepStrictEqual(controller.getStats(), { addedLines: 1, removedLines: 0 });
    assert.deepStrictEqual(savedSnapshots.get(newSessionFile), { stats: { addedLines: 1, removedLines: 0 } });
    assert.strictEqual(savedSnapshots.has(oldSessionFile), false);
    assert.strictEqual(postStateCount, 1);
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}
