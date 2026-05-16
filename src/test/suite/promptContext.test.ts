import * as assert from 'assert';
import { PromptContextStore } from '../../prompt/contextStore';

suite('PromptContextStore', () => {
  test('adds file and selection context for the webview', () => {
    const store = new PromptContextStore();

    assert.strictEqual(store.add([
      { kind: 'file', path: 'src/example.ts' },
      {
        kind: 'selection',
        path: 'src/other.ts',
        languageId: 'typescript',
        startLine: 3,
        endLine: 5,
        text: 'const value = 1;\n'
      }
    ]), true);

    assert.deepStrictEqual(store.getWebviewAttachments(), [
      {
        id: 'context-1',
        kind: 'file',
        label: 'example.ts',
        title: 'src/example.ts'
      },
      {
        id: 'context-2',
        kind: 'selection',
        label: 'other.ts:3-5',
        title: 'src/other.ts:3-5'
      }
    ]);
  });

  test('ignores empty context and restores consumed context before existing attachments', () => {
    const store = new PromptContextStore();

    assert.strictEqual(store.add({ kind: 'selection', path: 'src/empty.ts', text: '   ' }), false);
    assert.deepStrictEqual(store.getWebviewAttachments(), []);

    store.add({ kind: 'file', path: 'first.ts' });
    const consumed = store.consume();
    store.add({ kind: 'file', path: 'second.ts' });
    store.restore(consumed);

    assert.deepStrictEqual(store.getWebviewAttachments().map((attachment) => attachment.label), [
      'first.ts',
      'second.ts'
    ]);
  });
});
