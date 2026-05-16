import * as assert from 'node:assert';
import { ShikiCodeRenderer } from '../../shikiCodeRenderer';

suite('ShikiCodeRenderer', () => {
  test('highlights TypeScript using the active VS Code theme', async () => {
    const renderer = new ShikiCodeRenderer();

    try {
      const result = await renderer.highlightCode('const answer: number = 42;', 'ts');

      assert.ok(result);
      assert.strictEqual(result.language, 'typescript');
      assert.match(result.html, /<span style="color:/);
      assert.match(result.html, /const/);
    } finally {
      renderer.dispose();
    }
  });
});
