import * as assert from 'assert';
import { getSettingsForSection, normalizeSettingValue, settingDefinitions } from '../../settings/settingsRegistry';

suite('Settings registry', () => {
  test('keeps Tau and Pi settings in requested product sections', () => {
    assert.deepStrictEqual(
      getSettingsForSection('appearance').map((setting) => setting.id),
      ['tau.outputColors', 'tau.animationsEnabled', 'tau.showWelcome', 'tau.customUiTheme']
    );
    assert.deepStrictEqual(
      getSettingsForSection('extensions').map((setting) => setting.id),
      ['tau.extensions.aboveWidgetsEnabled', 'tau.extensions.belowWidgetsEnabled', 'tau.extensions.statusBarEnabled', 'tau.extensions.backgroundColorsEnabled', 'tau.extensions.monospaceFontEnabled']
    );
    assert.deepStrictEqual(
      getSettingsForSection('runtime').map((setting) => setting.id),
      ['defaultProvider', 'defaultModel', 'defaultThinkingLevel', 'compaction.enabled', 'retry.enabled', 'steeringMode', 'followUpMode']
    );
    assert.deepStrictEqual(
      getSettingsForSection('workspaceSafety').map((setting) => setting.id),
      ['tau.blockHttpsImages', 'tau.confirmSessionDeletion', 'tau.rejectEditWriteOutsideWorkspace']
    );
  });

  test('does not surface explicitly excluded settings', () => {
    const ids = settingDefinitions.map((setting) => setting.id);

    for (const excluded of ['theme', 'quietStartup', 'terminal.showImages', 'shellPath', 'httpIdleTimeoutMs']) {
      assert.ok(!ids.includes(excluded as never), `${excluded} should not be in Tau settings`);
    }
  });

  test('validates setting values conservatively', () => {
    assert.strictEqual(normalizeSettingValue('tau.outputColors', true), true);
    assert.strictEqual(normalizeSettingValue('tau.outputColors', 'true'), undefined);
    assert.strictEqual(normalizeSettingValue('tau.showWelcome', false), false);
    assert.strictEqual(normalizeSettingValue('tau.extensions.aboveWidgetsEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tau.extensions.belowWidgetsEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tau.extensions.monospaceFontEnabled', false), false);
    assert.strictEqual(normalizeSettingValue('tau.customUiTheme', 'matrix'), 'matrix');
    assert.strictEqual(normalizeSettingValue('tau.customUiTheme', 'random'), undefined);
    assert.strictEqual(normalizeSettingValue('enabledModels', ['gpt-*', ' claude-* '])?.toString(), 'gpt-*,claude-*');
  });
});
