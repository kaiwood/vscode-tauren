import * as assert from 'assert';
import { getScopedModelPickerOptions, getScopedModelSelection, normalizeScopedModelSelection } from '../../webview/scopedModels';
import type { WebviewState } from '../../webview/types';

suite('Scoped model webview helpers', () => {
  test('treats missing enabledModels as all models enabled', () => {
    const state = createState(undefined);

    assert.strictEqual(getScopedModelSelection(state).allEnabled, true);
    assert.deepStrictEqual(getScopedModelPickerOptions(state).map((model) => `${model.provider}/${model.id}`), [
      'openai/gpt-test',
      'anthropic/claude-test'
    ]);
  });

  test('treats empty enabledModels as explicit empty selection', () => {
    const state = createState([]);

    assert.strictEqual(getScopedModelSelection(state).allEnabled, false);
    assert.deepStrictEqual(getScopedModelSelection(state).enabledIds, []);
    assert.deepStrictEqual(getScopedModelPickerOptions(state), []);
  });

  test('filters picker options to selected scoped models', () => {
    const state = createState(['anthropic/claude-test']);

    assert.deepStrictEqual(getScopedModelPickerOptions(state).map((model) => `${model.provider}/${model.id}`), [
      'anthropic/claude-test'
    ]);
  });

  test('preserves explicit empty and all-model selections', () => {
    const state = createState(undefined);

    assert.deepStrictEqual(normalizeScopedModelSelection([], state.modelOptions), []);
    assert.deepStrictEqual(normalizeScopedModelSelection(['openai/gpt-test', 'anthropic/claude-test'], state.modelOptions), [
      'openai/gpt-test',
      'anthropic/claude-test'
    ]);
  });
});

function createState(enabledModels: string[] | undefined): WebviewState {
  return {
    modelOptions: [
      { provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true },
      { provider: 'anthropic', id: 'claude-test', name: 'Claude Test', reasoning: false }
    ],
    settings: {
      values: enabledModels === undefined ? {} : { enabledModels }
    }
  } as WebviewState;
}
