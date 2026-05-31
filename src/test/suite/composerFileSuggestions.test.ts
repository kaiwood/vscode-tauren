import * as assert from 'assert';
import { extractAtFilePrefix } from '../../webview/composer/fileSuggestions';

suite('Composer @ file suggestions', () => {
  test('extracts @ prefix at token boundaries', () => {
    assert.deepStrictEqual(extractAtFilePrefix('@README'), { prefix: '@README', start: 0 });
    assert.deepStrictEqual(extractAtFilePrefix('review @src/foo'), { prefix: '@src/foo', start: 7 });
    assert.deepStrictEqual(extractAtFilePrefix('email@example.com'), undefined);
  });

  test('extracts quoted @ prefixes', () => {
    assert.deepStrictEqual(extractAtFilePrefix('open @"folder with spaces'), { prefix: '@"folder with spaces', start: 5 });
    assert.deepStrictEqual(extractAtFilePrefix('open x@"folder'), undefined);
  });
});
