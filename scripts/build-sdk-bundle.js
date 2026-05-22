#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const piPackageDir = path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
const outputDir = path.join(root, 'out', 'sdk');
const outputFile = path.join(outputDir, 'piSdkBundle.mjs');
const runtimeDir = path.join(root, 'resources', 'pi-sdk-runtime');
const extensionPeerPackages = [
  'typebox',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui'
];

function assertPiSdkInstalled() {
  if (!fs.existsSync(path.join(piPackageDir, 'package.json'))) {
    throw new Error('Missing @earendil-works/pi-coding-agent. Run npm install before building the SDK bundle.');
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
}

function copyFiles(sourceDir, targetDir, predicate) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyFiles(source, target, predicate);
      continue;
    }

    if (entry.isFile() && predicate(source)) {
      copyFile(source, target);
    }
  }
}

function getPackagePath(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

function copyPackageWithDependencies(packageName, copied = new Set()) {
  if (copied.has(packageName)) {
    return;
  }
  copied.add(packageName);

  const sourceNodeModules = path.join(piPackageDir, 'node_modules');
  const targetNodeModules = path.join(outputDir, 'node_modules');
  const sourcePath = getPackagePath(sourceNodeModules, packageName);
  const packageJsonPath = path.join(sourcePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    if (packageName.startsWith('@types/')) {
      return;
    }
    throw new Error(`Missing bundled SDK extension dependency: ${packageName}`);
  }

  copyDirectory(sourcePath, getPackagePath(targetNodeModules, packageName));

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyPackageWithDependencies(dependencyName, copied);
  }
}

function copyExtensionPeerPackages() {
  fs.rmSync(path.join(outputDir, 'node_modules'), { recursive: true, force: true });
  const copied = new Set();

  for (const packageName of extensionPeerPackages) {
    copyPackageWithDependencies(packageName, copied);
  }
}

function copySdkRuntimeAssets() {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  const piPackageJson = JSON.parse(fs.readFileSync(path.join(piPackageDir, 'package.json'), 'utf-8'));
  fs.writeFileSync(path.join(runtimeDir, 'package.json'), `${JSON.stringify({
    name: piPackageJson.name,
    version: piPackageJson.version,
    type: piPackageJson.type,
    piConfig: piPackageJson.piConfig
  }, null, 2)}\n`);

  const exportHtmlDir = path.join(piPackageDir, 'dist', 'core', 'export-html');
  const exportHtmlTargetDir = path.join(runtimeDir, 'dist', 'core', 'export-html');
  for (const fileName of ['template.html', 'template.css', 'template.js']) {
    copyFile(path.join(exportHtmlDir, fileName), path.join(exportHtmlTargetDir, fileName));
  }
  copyFiles(
    path.join(exportHtmlDir, 'vendor'),
    path.join(exportHtmlTargetDir, 'vendor'),
    (source) => source.endsWith('.min.js')
  );

  copyFiles(
    path.join(piPackageDir, 'dist', 'modes', 'interactive', 'theme'),
    path.join(runtimeDir, 'dist', 'modes', 'interactive', 'theme'),
    (source) => source.endsWith('.json')
  );
}

async function main() {
  assertPiSdkInstalled();

  await esbuild.build({
    entryPoints: [path.join(root, 'scripts', 'piSdkBundleEntry.ts')],
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __tauCreateRequire } from 'node:module';\nconst require = __tauCreateRequire(import.meta.url);"
    },
    logLevel: 'warning'
  });

  copySdkRuntimeAssets();
  copyExtensionPeerPackages();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
