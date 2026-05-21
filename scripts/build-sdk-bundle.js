#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const piPackageDir = path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
const outputFile = path.join(root, 'out', 'sdk', 'piSdkBundle.mjs');
const runtimeDir = path.join(root, 'resources', 'pi-sdk-runtime');

function assertPiSdkInstalled() {
  if (!fs.existsSync(path.join(piPackageDir, 'package.json'))) {
    throw new Error('Missing @earendil-works/pi-coding-agent. Run npm install before building the SDK bundle.');
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
