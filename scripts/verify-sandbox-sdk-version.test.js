const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { sdkVersionsCompatible, verifySandboxSdkVersion } = require('./verify-sandbox-sdk-version');

test('stable patches may differ but release lines and prereleases cannot drift', () => {
  assert(sdkVersionsCompatible('1.5.0', '1.5.1'));
  assert(sdkVersionsCompatible('1.5.2', '1.5.1'));
  assert(!sdkVersionsCompatible('1.6.0', '1.5.1'));
  assert(!sdkVersionsCompatible('2.5.1', '1.5.1'));
  assert(sdkVersionsCompatible('1.5.1-rc.1', '1.5.1-rc.1'));
  assert(!sdkVersionsCompatible('1.5.1-rc.1', '1.5.1'));
  assert(!sdkVersionsCompatible('^1.5.1', '1.5.1'));
});

test('version guard detects manifest, lockfile, and installed dependency drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tauren-sdk-version-'));
  const name = '@earendil-works/pi-coding-agent';
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const serverLock = version => ({ packages: { '': { dependencies: { [name]: version } }, [`node_modules/${name}`]: { version } } });
  try {
    write('package-lock.json', { packages: { [`node_modules/${name}`]: { version: '1.5.1' } } });
    write('sandbox-server/package.json', { dependencies: { [name]: '1.5.0' } });
    write('sandbox-server/package-lock.json', serverLock('1.5.0'));
    verifySandboxSdkVersion(root);
    write('sandbox-server/package-lock.json', serverLock('1.6.0'));
    assert.throws(() => verifySandboxSdkVersion(root), /manifest\/lock mismatch/);
    write('sandbox-server/package.json', { dependencies: { [name]: '1.6.0' } });
    assert.throws(() => verifySandboxSdkVersion(root), /incompatible/);
    write('sandbox-server/package.json', { dependencies: { [name]: '1.5.0' } });
    write('sandbox-server/package-lock.json', serverLock('1.5.0'));
    write(`sandbox-server/node_modules/${name}/package.json`, { version: '1.5.1' });
    assert.throws(() => verifySandboxSdkVersion(root), /stale/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
