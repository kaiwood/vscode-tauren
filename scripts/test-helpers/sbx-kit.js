// Test-only helpers for SBX installation checks. Not production kit assembly.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const { piImageReference } = require('../sbx-kit-config.json');
const piVersion = require('../../package-lock.json').packages['node_modules/@earendil-works/pi-coding-agent'].version;

/** Allow patch differences between stable releases in the same major/minor line.
 * Prereleases require an exact match; malformed version output is never accepted.
 */
function piVersionsMatch(actual, expected) {
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const actualParts = stableVersion.exec(actual);
  const expectedParts = stableVersion.exec(expected);
  if (actualParts && expectedParts) {
    return actualParts[1] === expectedParts[1] && actualParts[2] === expectedParts[2];
  }
  const prereleaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[0-9A-Za-z.-]+$/;
  return prereleaseVersion.test(actual) && actual === expected;
}

/** Quote one argument for SSH's remote POSIX shell (not the local process). */
function quoteRemoteArgument(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Write fixture artifacts with explicit permissions, regardless of host umask. */
function writeFixture(file, contents, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  fs.chmodSync(file, mode);
}

/**
 * Stage a disposable installation-probe fixture, not the production SDK server.
 * Render the standalone Pi sandbox kit separately; SBX composes it with the mixin.
 * Source descriptors share resources/sbx-kit; each becomes spec.yaml in its
 * own temporary kit directory, with no generated files in Git.
 */
function stageProbeMixin(temporaryDirectory) {
  const kit = path.join(temporaryDirectory, 'tauren-mixin');
  const workspace = path.join(temporaryDirectory, 'workspace');
  const piKit = path.join(temporaryDirectory, 'pi-kit');
  // Render the image as a quoted YAML string before SBX loads the descriptor.
  const sandboxTemplate = fs.readFileSync(path.join(root, 'resources/sbx-kit/sandbox.yaml'), 'utf8');
  const sandboxDescriptor = sandboxTemplate.replaceAll('{{piImageReference}}', JSON.stringify(piImageReference));
  writeFixture(path.join(piKit, 'spec.yaml'), sandboxDescriptor);
  const probe = fs.readFileSync(path.join(__dirname, '../fixtures/sbx-installation-probe.mjs'), 'utf8');
  writeFixture(path.join(kit, 'spec.yaml'), fs.readFileSync(path.join(root, 'resources/sbx-kit/mixin.yaml')));
  const payload = path.join(kit, 'files/home/.tauren/server');
  writeFixture(path.join(payload, 'installation-probe.mjs'), probe);
  for (let directory = payload; directory !== kit; directory = path.dirname(directory)) {
    fs.chmodSync(directory, 0o755);
  }
  fs.mkdirSync(workspace);
  return { kit, piKit, workspace };
}

module.exports = { piVersion, piVersionsMatch, quoteRemoteArgument, stageProbeMixin };
