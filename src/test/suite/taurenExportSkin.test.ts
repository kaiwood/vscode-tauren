import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyTaurenExportSkinToFile,
  injectTaurenExportSkin,
  taurenExportSkinStyleId
} from '../../export/taurenExportSkin';

suite('Tauren export skin', () => {
  test('injects the skin into document head', () => {
    const html = '<html><head><title>Session</title></head><body>hello</body></html>';
    const result = injectTaurenExportSkin(html);

    assert.match(result, new RegExp(`<style id="${taurenExportSkinStyleId}">`));
    assert.ok(result.indexOf(`<style id="${taurenExportSkinStyleId}">`) < result.indexOf('</head>'));
    assert.ok(result.includes('<body>hello</body>'));
  });

  test('does not inject the skin twice', () => {
    const once = injectTaurenExportSkin('<html><head></head><body></body></html>');
    const twice = injectTaurenExportSkin(once);

    assert.strictEqual(twice, once);
    assert.strictEqual(twice.match(new RegExp(taurenExportSkinStyleId, 'g'))?.length, 1);
  });

  test('replaces stale Tauren skin blocks', () => {
    const html = '<html><head><style id="tauren-export-skin">old</style></head><body></body></html>';
    const result = injectTaurenExportSkin(html);

    assert.ok(!result.includes('>old</style>'));
    assert.ok(result.includes('background-color:#005f00'));
    assert.strictEqual(result.match(new RegExp(taurenExportSkinStyleId, 'g'))?.length, 1);
  });

  test('updates export files in place', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tauren-export-skin-'));
    const filePath = path.join(tmpDir, 'session.html');

    try {
      await writeFile(filePath, '<html><head></head><body>session</body></html>', 'utf-8');
      await applyTaurenExportSkinToFile(filePath);

      const result = await readFile(filePath, 'utf-8');
      assert.ok(result.includes(`id="${taurenExportSkinStyleId}"`));
      assert.ok(result.includes('<body>session</body>'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
