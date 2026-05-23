import * as assert from 'assert';
import { extractPiMessageImages, extractPiMessageText } from '../../pi/messageContent';

suite('Pi message content helpers', () => {
  test('returns string content unchanged', () => {
    assert.strictEqual(extractPiMessageText('Plain text'), 'Plain text');
  });

  test('extracts text parts from structured message content', () => {
    const content = [
      { type: 'text', text: 'First' },
      { type: 'unknown', text: 'Ignored' },
      { type: 'text', text: 'Second' }
    ];

    assert.strictEqual(extractPiMessageText(content, { separator: ' ' }), 'First Second');
  });

  test('can include image placeholders and tool call summaries', () => {
    const content = [
      { type: 'text', text: 'Look' },
      { type: 'image' },
      { type: 'toolCall', name: 'read' }
    ];

    assert.strictEqual(
      extractPiMessageText(content, { separator: ' ', includeImages: true, includeToolCalls: true }),
      'Look [Image] read()'
    );
  });

  test('extracts supported raster image parts', () => {
    const content = [
      { type: 'image', data: 'abc', mimeType: 'image/png', alt: 'Screenshot' },
      { type: 'image', data: 'svg', mimeType: 'image/svg+xml' },
      { type: 'image', data: 1, mimeType: 'image/png' }
    ];

    assert.deepStrictEqual(extractPiMessageImages(content), [
      { type: 'image', data: 'abc', mimeType: 'image/png', alt: 'Screenshot' }
    ]);
  });

  test('ignores malformed or unsupported content', () => {
    assert.strictEqual(extractPiMessageText(undefined), '');
    assert.strictEqual(extractPiMessageText([{ type: 'text', text: 1 }, null, { type: 'toolCall' }]), '');
    assert.deepStrictEqual(extractPiMessageImages(undefined), []);
  });
});
