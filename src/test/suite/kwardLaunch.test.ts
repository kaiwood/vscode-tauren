import * as assert from 'assert';
import { dirname, join } from 'node:path';
import { resolveKwardLaunch } from '../../kward/launch';

suite('Kward launch', () => {
  test('resolves empty Kward paths to the global kward command', () => {
    assert.deepStrictEqual(resolveKwardLaunch(), {
      command: 'kward',
      args: ['rpc'],
      cwd: process.cwd()
    });
  });

  test('resolves configured Kward binary paths as direct commands', () => {
    const executable = join('/repo', 'bin', 'kward');

    assert.deepStrictEqual(resolveKwardLaunch(executable), {
      command: executable,
      args: ['rpc'],
      cwd: dirname(executable)
    });
  });
});
