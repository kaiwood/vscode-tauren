import * as assert from 'assert';
import type * as vscode from 'vscode';
import { affectsAnyTaurenExtensionSetting, affectsAnyTaurenSetting } from '../../settings/taurenSettings';
import { settingDefinitions } from '../../settings/settingsRegistry';

suite('Tauren settings', () => {
  test('detects every Tauren-owned setting change from the registry', () => {
    for (const setting of settingDefinitions) {
      if (setting.owner !== 'tauren') {
        continue;
      }

      assert.strictEqual(
        affectsAnyTaurenSetting(createConfigurationChangeEvent(setting.id)),
        true,
        `${setting.id} should trigger Tauren state refresh`
      );
    }
  });

  test('does not treat Pi-owned settings as Tauren-owned setting changes', () => {
    for (const setting of settingDefinitions) {
      if (setting.owner !== 'pi') {
        continue;
      }

      assert.strictEqual(
        affectsAnyTaurenSetting(createConfigurationChangeEvent(setting.id)),
        false,
        `${setting.id} should not trigger Tauren state refresh`
      );
    }
  });

  test('detects only Tauren extension setting changes for extension settings', () => {
    assert.strictEqual(
      affectsAnyTaurenExtensionSetting(createConfigurationChangeEvent('tauren.extensions.statusBarEnabled')),
      true
    );
    assert.strictEqual(
      affectsAnyTaurenExtensionSetting(createConfigurationChangeEvent('tauren.readyScript')),
      false
    );
  });
});

function createConfigurationChangeEvent(affectedSetting: string): vscode.ConfigurationChangeEvent {
  return {
    affectsConfiguration: (section: string) => section === affectedSetting
  } as vscode.ConfigurationChangeEvent;
}
