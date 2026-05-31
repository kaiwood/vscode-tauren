import * as assert from 'assert';
import { findDeepestLastChildTreeItemIndex, findParentTreeItemIndex } from '../../webview/sessions/sessionTreeController';

suite('Webview session tree navigation', () => {
  const items = [
    { depth: 0 },
    { depth: 1 },
    { depth: 2 },
    { depth: 2 },
    { depth: 1 },
    { depth: 2 },
    { depth: 3 },
    { depth: 0 }
  ];

  test('finds the nearest parent by depth', () => {
    assert.strictEqual(findParentTreeItemIndex(items, 6), 5);
    assert.strictEqual(findParentTreeItemIndex(items, 5), 4);
    assert.strictEqual(findParentTreeItemIndex(items, 4), 0);
  });

  test('does not find a parent for root items', () => {
    assert.strictEqual(findParentTreeItemIndex(items, 0), undefined);
    assert.strictEqual(findParentTreeItemIndex(items, 7), undefined);
  });

  test('finds the deepest visible last child', () => {
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, 0), 6);
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, 1), 3);
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, 4), 6);
  });

  test('does not find a child for leaf items', () => {
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, 3), undefined);
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, 6), undefined);
  });

  test('ignores missing selected items', () => {
    assert.strictEqual(findParentTreeItemIndex(items, -1), undefined);
    assert.strictEqual(findDeepestLastChildTreeItemIndex(items, items.length), undefined);
  });
});
