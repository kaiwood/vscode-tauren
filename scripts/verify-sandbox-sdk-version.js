#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

/** Stable SDK patches may differ; prereleases must match exactly. */
function sdkVersionsCompatible(left, right) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const a = stable.exec(left);
  const b = stable.exec(right);
  if (a && b) return a[1] === b[1] && a[2] === b[2];
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[0-9A-Za-z.-]+$/.test(left) && left === right;
}

/** Check version drift without requiring the standalone dependencies to be installed. */
function verifySandboxSdkVersion(root = path.resolve(__dirname, '..')) {
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  const name = '@earendil-works/pi-coding-agent';
  const extension = read('package-lock.json').packages[`node_modules/${name}`].version;
  const manifest = read('sandbox-server/package.json').dependencies[name];
  const lock = read('sandbox-server/package-lock.json');
  const resolved = lock.packages[`node_modules/${name}`].version;
  // Pin each project reproducibly, but permit a patch difference between projects.
  if (manifest !== resolved || lock.packages[''].dependencies[name] !== manifest) {
    throw new Error('Sandbox SDK manifest/lock mismatch: pin an exact release and regenerate sandbox-server/package-lock.json.');
  }
  if (!sdkVersionsCompatible(extension, resolved)) {
    throw new Error(`Sandbox SDK ${resolved} is incompatible with extension SDK ${extension}; stable major/minor versions must match.`);
  }
  const installed = path.join(root, `sandbox-server/node_modules/${name}/package.json`);
  if (fs.existsSync(installed) && JSON.parse(fs.readFileSync(installed, 'utf8')).version !== resolved) {
    throw new Error('Installed sandbox SDK is stale. Run npm ci --prefix sandbox-server.');
  }
}

if (require.main === module) {
  try { verifySandboxSdkVersion(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { sdkVersionsCompatible, verifySandboxSdkVersion };
