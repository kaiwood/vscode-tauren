#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const requireBanner = "import { createRequire as __taurenCreateRequire } from 'node:module';\nconst require = __taurenCreateRequire(import.meta.url);";
const { verifySandboxSdkVersion } = require('./verify-sandbox-sdk-version');

/** Read build metadata without loading code from either SDK installation. */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Write generated JSON metadata with stable formatting. */
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Render only the image placeholder; preserve SBX credential Go templates. */
function renderSandbox(template, image) {
  if (typeof image !== 'string' || !/^\S+@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('scripts/sbx-kit-config.json must pin piImageReference to an image SHA-256 digest.');
  }
  if (!template.includes('{{piImageReference}}')) {
    throw new Error('Sandbox template is missing {{piImageReference}}.');
  }
  return template.replaceAll('{{piImageReference}}', JSON.stringify(image));
}

/**
 * Stage the server adapter and pinned sandbox descriptor, not a second Pi SDK.
 * The packaged adapter resolves the sandbox's installed Pi public SDK via PATH.
 * Build in an isolated sibling directory, preserving prior output on errors.
 */
async function buildSandboxKit(root = path.resolve(__dirname, '..')) {
  const resources = path.join(root, 'resources');
  const project = path.join(root, 'sandbox-server');
  const outputDir = path.join(resources, 'generated-sbx-kit');
  const sandboxDir = path.join(resources, 'generated-sbx-sandbox');
  const main = path.join(project, 'dist', 'main.js');
  if (!fs.existsSync(main)) {
    throw new Error('Missing sandbox-server/dist/main.js. Build sandbox-server before staging the kit.');
  }
  verifySandboxSdkVersion(root);
  const { piImageReference } = readJson(path.join(root, 'scripts', 'sbx-kit-config.json'));
  const sandboxSpec = renderSandbox(fs.readFileSync(path.join(resources, 'sbx-kit', 'sandbox.yaml'), 'utf8'), piImageReference);
  const serverPackage = readJson(path.join(project, 'package.json'));
  const extensionPackage = readJson(path.join(root, 'package.json'));
  const work = fs.mkdtempSync(path.join(resources, '.build-sandbox-kit-'));
  try {
    const kit = path.join(work, 'kit');
    const sandbox = path.join(work, 'sandbox');
    const server = path.join(kit, 'files', 'home', '.tauren', 'server');
    fs.mkdirSync(server, { recursive: true });
    fs.mkdirSync(sandbox, { recursive: true });
    fs.copyFileSync(path.join(resources, 'sbx-kit', 'mixin.yaml'), path.join(kit, 'spec.yaml'));
    fs.writeFileSync(path.join(sandbox, 'spec.yaml'), sandboxSpec);
    // main.js reads ../package.json; retain the entrypoint's dist/ depth and
    // discard development scripts/dependencies rather than copying the project.
    const sdkVersion = readJson(path.join(project, 'node_modules/@earendil-works/pi-coding-agent/package.json')).version;
    writeJson(path.join(server, 'package.json'), {
      name: serverPackage.name, version: serverPackage.version,
      private: true, type: 'module', main: './dist/main.js', engines: serverPackage.engines,
      sandboxPiSdkVersion: sdkVersion
    });
    await esbuild.build({
      entryPoints: { main, sandboxPi: path.join(project, 'dist/sandboxPi.js') }, outdir: path.join(server, 'dist'),
      bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node22',
      // Splitting preserves the awaited server.js import after Console is
      // redirected to stderr. Keep chunks beside main for relative SDK imports.
      chunkNames: '[name]-[hash]', sourcemap: false, legalComments: 'none',
      banner: { js: requireBanner }, logLevel: 'warning',
      plugins: [{
        name: 'standalone-packaged-sdk',
        setup(build) {
          build.onResolve({ filter: /^@earendil-works\/pi-coding-agent$/ }, () => ({
            path: './sandboxPi.js', external: true
          }));
        }
      }]
    });
    const manifest = {
      formatVersion: 1,
      extensionVersion: extensionPackage.version,
      serverVersion: serverPackage.version,
      piSdkVersion: sdkVersion,
      runtimeSource: 'sandbox-pi',
      piImageReference,
      entrypoint: 'files/home/.tauren/server/dist/main.js'
    };
    writeJson(path.join(kit, 'build-manifest.json'), manifest);
    // Destinations are fixed children of resources, never caller-supplied paths.
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    fs.renameSync(kit, outputDir);
    fs.renameSync(sandbox, sandboxDir);
    return { outputDir, sandboxDir, manifest };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  buildSandboxKit().then(({ outputDir, sandboxDir }) => {
    console.log(`Sandbox kit: ${outputDir}`);
    console.log(`Sandbox descriptor: ${path.join(sandboxDir, 'spec.yaml')}`);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { buildSandboxKit };
