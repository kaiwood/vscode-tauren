import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { resolveReadyScriptPath, runReadyScript, type ReadyScriptProcess, type ReadyScriptSpawnFactory } from '../../readyScript';

suite('readyScript', () => {
  test('resolves relative paths from cwd', () => {
    assert.strictEqual(resolveReadyScriptPath('scripts/ready.sh', '/workspace'), path.join('/workspace', 'scripts', 'ready.sh'));
  });

  test('runs a configured script with cwd and environment', () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: unknown; env: NodeJS.ProcessEnv | undefined }> = [];
    const process = new FakeReadyScriptProcess();
    const spawnFactory: ReadyScriptSpawnFactory = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return process;
    };

    const ran = runReadyScript('scripts/ready.sh', '/workspace', { spawnFactory });

    assert.strictEqual(ran, true);
    assert.deepStrictEqual(calls, [{
      command: path.join('/workspace', 'scripts', 'ready.sh'),
      args: [],
      cwd: '/workspace',
      env: calls[0].env
    }]);
    assert.strictEqual(calls[0].env?.TAU_READY_CWD, '/workspace');
    assert.strictEqual(calls[0].env?.TAU_READY_SCRIPT, path.join('/workspace', 'scripts', 'ready.sh'));
    assert.strictEqual(process.unrefCalls, 1);
  });

  test('does not run for blank paths', () => {
    let spawnCalls = 0;
    const ran = runReadyScript('   ', '/workspace', {
      spawnFactory: () => {
        spawnCalls += 1;
        return new FakeReadyScriptProcess();
      }
    });

    assert.strictEqual(ran, false);
    assert.strictEqual(spawnCalls, 0);
  });

  test('reports spawn errors', () => {
    const errors: string[] = [];
    const process = new FakeReadyScriptProcess();

    runReadyScript('/workspace/ready.sh', '/workspace', {
      spawnFactory: () => process,
      onError: (message) => errors.push(message)
    });
    process.emit('error', new Error('permission denied'));

    assert.deepStrictEqual(errors, ['Failed to run Tauren ready script: permission denied']);
  });

  test('reports synchronous spawn failures', () => {
    const errors: string[] = [];
    const ran = runReadyScript('/workspace/ready.sh', '/workspace', {
      spawnFactory: () => {
        throw new Error('bad path');
      },
      onError: (message) => errors.push(message)
    });

    assert.strictEqual(ran, false);
    assert.deepStrictEqual(errors, ['Failed to run Tauren ready script: bad path']);
  });
});

class FakeReadyScriptProcess extends EventEmitter implements ReadyScriptProcess {
  public unrefCalls = 0;

  public unref(): void {
    this.unrefCalls += 1;
  }
}
