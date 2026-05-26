import * as assert from 'assert';
import { getVirtualSessionRange } from '../../webview/sessions/sessionVirtualization';

suite('webview session virtualization', () => {
  test('does not virtualize small session lists', () => {
    const range = getVirtualSessionRange({
      itemCount: 20,
      scrollTop: 0,
      viewportHeight: 300,
      listTopOffset: 70,
      itemHeight: 50,
      overscan: 2,
      threshold: 500
    });

    assert.deepStrictEqual(range, {
      enabled: false,
      start: 0,
      end: 20,
      topPadding: 0,
      bottomPadding: 0
    });
  });

  test('returns an overscanned window for large session lists', () => {
    const range = getVirtualSessionRange({
      itemCount: 1000,
      scrollTop: 570,
      viewportHeight: 300,
      listTopOffset: 70,
      itemHeight: 50,
      overscan: 2,
      threshold: 500
    });

    assert.strictEqual(range.enabled, true);
    assert.strictEqual(range.start, 8);
    assert.strictEqual(range.end, 18);
    assert.strictEqual(range.topPadding, 400);
    assert.strictEqual(range.bottomPadding, 49100);
  });
});
