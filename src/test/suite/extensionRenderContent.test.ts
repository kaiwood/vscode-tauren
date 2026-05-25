import * as assert from 'assert';
import { renderComponentContent } from '../../extensionUi/renderContent';

suite('Extension render content', () => {
  test('serializes pi-tui Image-like components as typed image blocks', () => {
    const rendered = renderComponentContent({
      base64Data: 'abc123',
      mimeType: 'image/png',
      dimensions: { widthPx: 18, heightPx: 18 },
      options: { maxWidthCells: 10, maxHeightCells: 4, filename: 'pic.png' },
      render: () => ['fallback'],
      invalidate: () => undefined
    }, 80);

    assert.deepStrictEqual(rendered.blocks, [{
      type: 'image',
      data: 'abc123',
      mimeType: 'image/png',
      columns: 8,
      rows: 4,
      widthPx: 18,
      heightPx: 18,
      alt: 'pic.png'
    }]);
    assert.deepStrictEqual(rendered.lines, ['', '', '', '']);
  });

  test('uses measured cell dimensions for typed image block sizing', () => {
    const rendered = renderComponentContent({
      base64Data: 'abc123',
      mimeType: 'image/png',
      dimensions: { widthPx: 20, heightPx: 40 },
      options: { maxWidthCells: 10 },
      render: () => ['fallback'],
      invalidate: () => undefined
    }, 80, { widthPx: 10, heightPx: 10 });

    assert.deepStrictEqual(rendered.blocks, [{
      type: 'image',
      data: 'abc123',
      mimeType: 'image/png',
      columns: 5,
      rows: 10,
      widthPx: 20,
      heightPx: 40,
      cellWidthPx: 10,
      cellHeightPx: 10
    }]);
    assert.deepStrictEqual(rendered.lines, Array.from({ length: 10 }, () => ''));
  });

  test('finds nested Image-like children without terminal image escapes', () => {
    const rendered = renderComponentContent({
      children: [
        {
          render: () => ['label'],
          invalidate: () => undefined
        },
        {
          base64Data: 'def456',
          mimeType: 'image/webp',
          dimensions: { widthPx: 90, heightPx: 36 },
          options: { maxWidthCells: 20 },
          render: () => ['terminal escape fallback'],
          invalidate: () => undefined
        }
      ],
      render: () => ['container fallback'],
      invalidate: () => undefined
    }, 80);

    assert.strictEqual(rendered.blocks.length, 2);
    assert.deepStrictEqual(rendered.blocks[0], { type: 'text', lines: ['label'] });
    assert.deepStrictEqual(rendered.blocks[1], {
      type: 'image',
      data: 'def456',
      mimeType: 'image/webp',
      columns: 20,
      rows: 4,
      widthPx: 90,
      heightPx: 36
    });
  });
});
