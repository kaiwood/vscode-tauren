const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { piVersionsMatch, quoteRemoteArgument, stageProbeMixin } = require('./test-helpers/sbx-kit');
const { piImageReference } = require('./sbx-kit-config.json');

test('staging creates separate sandbox and mixin kits with a disposable probe payload', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tauren-mixin-test-'));
  try {
    const { kit, piKit, workspace } = stageProbeMixin(temporaryDirectory);
    const sandboxDescriptor = fs.readFileSync(path.join(piKit, 'spec.yaml'), 'utf8');
    assert(sandboxDescriptor.includes(`  image: ${JSON.stringify(piImageReference)}`));
    assert(/^name: pi$/m.test(sandboxDescriptor), 'Base agent name must satisfy the mixin requires.agent: pi');
    assert(!sandboxDescriptor.includes('{{piImageReference}}'), 'Image placeholder must be rendered');
    assert(!/^extends\s*:/m.test(sandboxDescriptor), 'Sandbox must not require parent resolution');
    // SBX, not staging, expands credential templates. Preserve them verbatim.
    for (const token of ['AccessToken', 'RefreshToken', 'ExpiresAt']) {
      assert(sandboxDescriptor.includes(`{{.${token}}}`), `Missing credential template: ${token}`);
    }
    assert.deepEqual(fs.readdirSync(piKit), ['spec.yaml']);
    const descriptor = fs.readFileSync(path.join(kit, 'spec.yaml'), 'utf8');
    // Assert the installation contract, allowing unrelated declarations to evolve.
    const declarations = new Set(descriptor.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')));
    for (const required of ['schemaVersion: "2"', 'kind: mixin', 'name: tauren', 'requires:', 'agent: pi']) {
      assert(declarations.has(required), `Missing required declaration: ${required}`);
    }
    for (const declaration of declarations) {
      assert(!/^(?:["']?(?:install|startup)["']?)\s*:/.test(declaration),
        `Mixin must not declare install or startup hooks: ${declaration}`);
    }
    const payload = path.join(kit, 'files/home/.tauren/server');
    assert.equal(fs.statSync(path.join(payload, 'installation-probe.mjs')).mode & 0o777, 0o644);
    assert.equal(fs.statSync(payload).mode & 0o777, 0o755);
    assert.deepEqual(fs.readdirSync(workspace), []);
    assert.deepEqual(fs.readdirSync(path.resolve(__dirname, '../resources/sbx-kit')).sort(), ['mixin.yaml', 'sandbox.yaml']);
    assert.deepEqual(fs.readdirSync(temporaryDirectory).sort(), ['pi-kit', 'tauren-mixin', 'workspace']);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Pi version checks allow patch differences but reject different release lines', () => {
  for (const [actual, expected] of [['1.5.0', '1.5.1'], ['1.5.2', '1.5.1'], ['0.84.2', '0.84.3']]) {
    assert.equal(piVersionsMatch(actual, expected), true);
  }
  for (const actual of ['1.6.0', '2.5.1', '1.50.1', '1.5', 'garbage', '1.5.1-rc.1']) {
    assert.equal(piVersionsMatch(actual, '1.5.1'), false, actual);
  }
  assert.equal(piVersionsMatch('1.5.1-rc.1', '1.5.1-rc.1'), true);
  assert.equal(piVersionsMatch('1.5.0-rc.1', '1.5.1-rc.1'), false);
});

test('SSH remote arguments remain literal, including spaces and shell metacharacters', () => {
  // Test our quoting helper through sh, which parses SSH remote commands;
  // arguments must arrive unchanged rather than execute as shell syntax.
  const values = ['', 'path with spaces', "apostrophe's", '$(exit 19); * & `exit 21`', 'line\nbreak'];
  const result = spawnSync('sh', ['-c', `printf '%s\\0' ${values.map(quoteRemoteArgument).join(' ')}`], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.split('\0').slice(0, -1), values);
});

