import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSettingsForSection, normalizeSettingValue, settingDefinitions } from '../../settings/settingsRegistry';

suite('Settings registry', () => {
  test('keeps Tauren and Pi settings in requested product sections', () => {
    assert.deepStrictEqual(
      getSettingsForSection('appearance').map((setting) => setting.id),
      ['tauren.outputColors', 'tauren.animationsEnabled', 'tauren.showWelcome', 'tauren.useTaurenShareViewer', 'tauren.customUiTheme']
    );
    assert.deepStrictEqual(
      getSettingsForSection('extensions').map((setting) => setting.id),
      ['tauren.extensions.aboveWidgetsEnabled', 'tauren.extensions.belowWidgetsEnabled', 'tauren.extensions.statusBarEnabled', 'tauren.extensions.backgroundColorsEnabled', 'tauren.extensions.monospaceFontEnabled']
    );
    assert.deepStrictEqual(
      getSettingsForSection('runtime').map((setting) => setting.id),
      ['tauren.backend', 'tauren.kward.path', 'defaultProvider', 'defaultModel', 'defaultThinkingLevel', 'hideThinkingBlock', 'quietStartup', 'compaction.enabled', 'retry.enabled', 'steeringMode', 'followUpMode']
    );
    assert.deepStrictEqual(
      getSettingsForSection('scopedModels').map((setting) => setting.id),
      ['enabledModels']
    );
    assert.deepStrictEqual(
      getSettingsForSection('workspaceSafety').map((setting) => setting.id),
      ['tauren.blockHttpsImages', 'tauren.confirmSessionDeletion', 'tauren.restrictFileReferencesToWorkspace', 'tauren.rejectEditWriteOutsideWorkspace']
    );
  });

  test('does not surface explicitly excluded settings', () => {
    const ids = settingDefinitions.map((setting) => setting.id);

    for (const excluded of ['theme', 'terminal.showImages', 'shellPath', 'httpIdleTimeoutMs']) {
      assert.ok(!ids.includes(excluded as never), `${excluded} should not be in Tauren settings`);
    }
  });

  test('contributes every Tauren-owned setting to VS Code configuration', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      contributes?: { configuration?: { properties?: Record<string, unknown> } };
    };
    const contributedSettings = Object.keys(packageJson.contributes?.configuration?.properties ?? {});

    for (const setting of settingDefinitions) {
      if (setting.owner === 'tauren') {
        assert.ok(contributedSettings.includes(setting.id), `${setting.id} should be contributed in package.json`);
      }
    }
  });

  test('validates setting values conservatively', () => {
    assert.strictEqual(normalizeSettingValue('tauren.outputColors', true), true);
    assert.strictEqual(normalizeSettingValue('tauren.outputColors', 'true'), undefined);
    assert.strictEqual(normalizeSettingValue('tauren.showWelcome', false), false);
    assert.strictEqual(normalizeSettingValue('tauren.useTaurenShareViewer', false), false);
    assert.strictEqual(normalizeSettingValue('tauren.extensions.aboveWidgetsEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tauren.extensions.belowWidgetsEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tauren.extensions.monospaceFontEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tauren.backend', 'kward'), 'kward');
    assert.strictEqual(normalizeSettingValue('tauren.backend', 'unknown'), undefined);
    assert.strictEqual(normalizeSettingValue('tauren.kward.path', ' /tmp/kward '), '/tmp/kward');
    assert.strictEqual(normalizeSettingValue('tauren.customUiTheme', 'matrix'), 'matrix');
    assert.strictEqual(normalizeSettingValue('tauren.customUiTheme', 'random'), undefined);
    assert.strictEqual(normalizeSettingValue('enabledModels', ['gpt-*', ' claude-* '])?.toString(), 'gpt-*,claude-*');
  });
});
