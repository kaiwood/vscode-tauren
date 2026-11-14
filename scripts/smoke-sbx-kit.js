#!/usr/bin/env node

// Opt-in real-SBX gate for Tauren's standalone Pi sandbox kit and server mixin.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { piVersion, piVersionsMatch, quoteRemoteArgument, stageProbeMixin } = require('./test-helpers/sbx-kit');

const installationDirectory = '/home/agent/.tauren/server';

/** Run a local executable directly, with bounded execution and no local shell. */
function run(executable, args, timeout = 120_000) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Cannot run ${executable}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout.trim();
}

/** SBX owns creation/removal only. All in-sandbox observations use SSH. */
function sbx(args, timeout) {
  return run('sbx', ['--no-input', ...args], timeout);
}

/** Use the same non-PTY pipe shape intended for the future SDK server. */
function ssh(name, args) {
  return run('ssh', [
    '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
    `${name}.sbx`, args.map(quoteRemoteArgument).join(' '),
  ]);
}

/** Create one mixin-equipped sandbox, verify over SSH, and remove it afterward. */
function main() {
  console.log(sbx(['--version']));
  run('ssh', ['-V']);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tauren-sbx-kit-'));
  const name = `tauren-probe-${randomUUID().slice(0, 8)}`;
  let creationAttempted = false;
  let failure;
  try {
    const { kit, piKit, workspace } = stageProbeMixin(temporaryDirectory);
    creationAttempted = true; // Also clean up a partially created sandbox.
    sbx([
      'run', '-d', '--name', name, '--kit', kit, piKit, workspace,
    ], 600_000);
    const actualPiVersion = ssh(name, ['pi', '--version']);
    assert.ok(piVersionsMatch(actualPiVersion, piVersion),
      `Pi version mismatch: sandbox image contains ${JSON.stringify(actualPiVersion)}; extension SDK is ${JSON.stringify(piVersion)}. Stable versions must share major/minor (patch differences allowed); prereleases must match exactly. Update piImageReference to a compatible image digest.`);
    const report = JSON.parse(ssh(name, [
      'node', installationDirectory + '/installation-probe.mjs',
    ]));
    assert.equal(report.directory, installationDirectory);
    console.log(`PASS: sandbox Pi ${actualPiVersion}, extension SDK ${piVersion}, Node ${report.node}; overlay verified at ${report.directory}.`);
  } catch (error) {
    failure = error;
  } finally {
    if (creationAttempted) {
      try { sbx(['rm', '--force', name]); }
      catch (error) {
        // Kit resolution can fail before a sandbox exists. Still attempt removal
        // after partial creation, but do not report an absent sandbox as a leak.
        if (!error.message.includes(`error: sandbox '${name}' not found`)) {
          console.error(`Cleanup failed for ${name}: ${error.message}`);
          failure ||= error;
        }
      }
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  if (failure) throw failure;
}

try { main(); }
catch (error) {
  console.error("FAILED: ", error.message);
  process.exitCode = 1;
}
