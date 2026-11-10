// Installation fixture for ADR 0004, step 1. This is not an SDK server.
// The smoke runner copies this file into files/home/ in a temporary v2 kit.
import assert from 'node:assert/strict';
import { accessSync, constants, statSync } from 'node:fs';

export const installationDirectory = '/home/agent/.tauren/server';

/** Check a staged file's exact permissions and agent ownership. */
function verifyPermissions(path, expectedMode) {
  const stat = statSync(path);
  assert.equal(stat.uid, 1000, `${path} must belong to agent (UID 1000)`);
  assert.equal(stat.gid, 1000, `${path} must belong to the agent group (GID 1000)`);
  assert.equal(stat.mode & 0o777, expectedMode, `${path} has incorrect permissions`);
}

/** Prove the installed JavaScript runs through Node as the non-root Pi user. */
function verifyInstallation() {
  assert.equal(process.getuid(), 1000, 'Run this probe as agent, not root');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || (major === 22 && minor >= 19), 'Pi requires Node >=22.19.0');
  verifyPermissions(installationDirectory, 0o755);
  verifyPermissions(`${installationDirectory}/installation-probe.mjs`, 0o644);
  accessSync(installationDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
  accessSync(`${installationDirectory}/installation-probe.mjs`, constants.R_OK);
  console.log(JSON.stringify({ directory: installationDirectory, node: process.versions.node, uid: process.getuid() }));
}

verifyInstallation();
