const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { buildServerLaunchCommand, quoteRemoteArgument } = require('../dist/cjs/ssh/serverLaunch.js');

test('remote argument quoting preserves shell metacharacters and empty values', () => {
  for (const value of ['', "space and 'quote'", '$(printf injected); `id` & | > <', 'two\nlines', '\\backslash']) {
    assert.equal(execFileSync('/bin/sh', ['-c', `printf %s ${quoteRemoteArgument(value)}`], { encoding: 'utf8' }), value);
  }
  assert.throws(() => quoteRemoteArgument('bad\0argument'), /NUL/);
});

test('server launch fixes remote cwd and session environment without shell interpolation', () => {
  const options = { nodePath: '/usr/bin/node', serverPath: "/opt/server's dir/main.js",
    workspace: '/project with spaces; $HOME', sessionDirectory: '/session store/`id`' };
  assert.equal(buildServerLaunchCommand(options),
    "cd '/project with spaces; $HOME' && exec env 'PI_CODING_AGENT_SESSION_DIR=/session store/`id`' '/usr/bin/node' '/opt/server'\\''s dir/main.js'");
  for (const key of Object.keys(options)) {
    assert.throws(() => buildServerLaunchCommand({ ...options, [key]: 'relative/path' }), /absolute remote POSIX path/);
    assert.throws(() => buildServerLaunchCommand({ ...options, [key]: '/bad\0path' }), /absolute remote POSIX path/);
  }
});
