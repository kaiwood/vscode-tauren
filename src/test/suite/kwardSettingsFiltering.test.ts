import * as assert from 'assert';
import { getVisibleSettingsForSection } from '../../webview/settings/settingsPane';
import { initialWebviewState } from '../../webview/state';
import type { WebviewState } from '../../webview/types';

suite('Kward settings filtering', () => {
  test('keeps all Pi settings visible for the Pi backend', () => {
    const state = createState({ 'tauren.backend': 'pi' });
    const runtimeIds = getVisibleSettingsForSection('runtime', state).map((setting) => setting.id);

    assert.ok(runtimeIds.includes('defaultModel'));
    assert.ok(runtimeIds.includes('quietStartup'));
    assert.ok(runtimeIds.includes('tauren.backend'));
  });

  test('shows only reported Pi settings for the Kward backend', () => {
    const state = createState({
      'tauren.backend': 'kward',
      defaultModel: 'Codex/gpt-test',
      defaultThinkingLevel: 'medium'
    });
    const runtimeIds = getVisibleSettingsForSection('runtime', state).map((setting) => setting.id);

    assert.ok(runtimeIds.includes('tauren.backend'));
    assert.ok(runtimeIds.includes('tauren.kward.path'));
    assert.ok(runtimeIds.includes('defaultModel'));
    assert.ok(runtimeIds.includes('defaultThinkingLevel'));
    assert.ok(!runtimeIds.includes('transport'));
    assert.ok(!runtimeIds.includes('quietStartup'));
  });
});

function createState(values: WebviewState['settings']['values']): WebviewState {
  return {
    ...initialWebviewState,
    settings: { values }
  };
}
