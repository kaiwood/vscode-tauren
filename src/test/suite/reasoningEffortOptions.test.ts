import * as assert from 'assert';
import { getReasoningEffortOptions } from '../../webview/composer/reasoningEffortOptions';

suite('reasoningEffortOptions', () => {
  test('matches Codex effort choices to the selected model', () => {
    assert.deepStrictEqual(values('Codex', 'gpt-5.2-codex'), ['low', 'medium', 'high', 'xhigh']);
    assert.deepStrictEqual(values('Codex', 'gpt-5.6-sol'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepStrictEqual(values('Codex', 'gpt-6.1-sol'), ['low', 'medium', 'high', 'xhigh', 'max']);
  });

  test('uses model-specific ranges for other Kward providers', () => {
    assert.deepStrictEqual(values('Anthropic', 'claude-opus-4-5'), ['low', 'medium', 'high']);
    assert.deepStrictEqual(values('OpenRouter', 'openai/gpt-5.6'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  test('leaves Pi and unsupported models on the existing Tauren options', () => {
    assert.deepStrictEqual(values('openai-codex', 'gpt-5.6-sol'), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    assert.deepStrictEqual(values('Codex', 'gpt-4.1'), ['none', 'low', 'medium', 'high', 'xhigh']);
  });
});

function values(provider: string, modelId: string): string[] {
  return getReasoningEffortOptions(provider, modelId).map((option) => option.value);
}
