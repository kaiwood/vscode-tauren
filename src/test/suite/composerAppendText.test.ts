import * as assert from 'assert';
import { appendComposerText } from '../../webview/composer/appendText';

suite('appendComposerText', () => {
  test('uses appended text when composer is empty', () => {
    const result = appendComposerText('', 'selected line');

    assert.strictEqual(result.text, 'selected line');
    assert.strictEqual(result.cursor, result.text.length);
  });

  test('inserts one newline between existing and appended text', () => {
    const result = appendComposerText('existing prompt', 'selected line');

    assert.strictEqual(result.text, 'existing prompt\nselected line');
    assert.strictEqual(result.cursor, result.text.length);
  });

  test('does not add an extra newline after trailing newline', () => {
    const result = appendComposerText('existing prompt\n', 'selected line');

    assert.strictEqual(result.text, 'existing prompt\nselected line');
    assert.strictEqual(result.cursor, result.text.length);
  });
});
