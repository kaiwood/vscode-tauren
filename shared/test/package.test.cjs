const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

/** Resolve the installed package in both real consumers, not relative source paths. */
test('local consumers resolve CommonJS and ESM shared package exports', async () => {
  const root = path.resolve(__dirname, '../..');
  for (const [cwd, mode] of [[root, 'commonjs'], [path.join(root, 'sandbox-server'), 'module']]) {
    const code = mode === 'module'
      ? "import { PiAutocompleteRegistry } from '@tauren/shared/completion/piAutocompleteRegistry'; console.log(new PiAutocompleteRegistry().getCapabilities().triggerCharacters[0]);"
      : "const { PiAutocompleteRegistry } = require('@tauren/shared/completion/piAutocompleteRegistry'); console.log(new PiAutocompleteRegistry().getCapabilities().triggerCharacters[0]);";
    assert.equal(execFileSync(process.execPath, [`--input-type=${mode}`, '-e', code], { cwd, encoding: 'utf8' }).trim(), '@');
  }
});

/** A copied package must work with no checkout, SDK, VS Code, or node_modules. */
test('packed shared helpers contain both formats and need no runtime dependencies', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tauren-shared-package-'));
  try {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }))[0];
    assert.ok(packed.files.some(file => file.path === 'dist/esm/package.json'));
    assert.ok(!packed.files.some(file => file.path.startsWith('src/')));
    const installed = path.join(directory, 'node_modules/@tauren/shared');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(directory, packed.filename), '--strip-components=1', '-C', installed]);
    writeFileSync(path.join(directory, 'check.cjs'), "require('@tauren/shared/rendering/piSdkRendering'); require('@tauren/shared/sessions/sessionSummaryParser');");
    writeFileSync(path.join(directory, 'check.mjs'), "import '@tauren/shared/rendering/piSdkRendering'; import '@tauren/shared/sessions/sessionSummaryParser';");
    for (const file of ['check.cjs', 'check.mjs']) execFileSync(process.execPath, [file], { cwd: directory });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
