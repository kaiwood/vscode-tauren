import * as assert from 'assert';
import { isExtensionPromptHostMessage } from '../../webview/extensionPrompt';

suite('Pi extension prompt', () => {
  test('accepts supported inline prompt host messages', () => {
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: 'extension-prompt-1',
      kind: 'select',
      title: 'Choose',
      options: ['A', 'B']
    }), true);
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: 'extension-prompt-2',
      kind: 'confirm',
      title: 'Continue?',
      message: 'Apply the changes now?'
    }), true);
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: 'extension-prompt-3',
      kind: 'input',
      title: 'Name',
      placeholder: 'Feature name'
    }), true);
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptHide',
      id: 'extension-prompt-3'
    }), true);
  });

  test('rejects malformed prompt host messages', () => {
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: '',
      kind: 'select',
      title: 'Choose',
      options: ['A']
    }), false);
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: 'extension-prompt-1',
      kind: 'select',
      title: 'Choose',
      options: ['A', 2]
    }), false);
    assert.strictEqual(isExtensionPromptHostMessage({
      type: 'extensionPromptShow',
      id: 'extension-prompt-1',
      kind: 'unknown',
      title: 'Choose'
    }), false);
  });
});
