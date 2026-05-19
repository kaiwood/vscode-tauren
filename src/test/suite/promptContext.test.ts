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
        title: 'src/example.ts',
        xml: '<ide_context source="vscode-tau">\nUser-attached IDE context.\n\n<file path="src/example.ts" />\n</ide_context>'
      },
      {
        id: 'context-2',
        kind: 'selection',
        label: 'other.ts:3-5',
        title: 'src/other.ts:3-5',
        xml: '<ide_context source="vscode-tau">\nUser-attached IDE context.\n\n<selection path="src/other.ts" start_line="3" end_line="5" language="typescript"><![CDATA[\nconst value = 1;\n\n]]></selection>\n</ide_context>'
      }
    ]);
  });

  test('includes complete IDE context XML for origin attachments', () => {
    const store = new PromptContextStore();

    store.add({
      kind: 'file',
      path: 'src/current.ts',
      source: 'origin',
      traceOrigin: {
        historicalPath: 'src/old.ts',
        currentRelativePath: 'src/current.ts',
        origin: {
          sessionId: 'session-1',
          toolName: 'write',
          sessionEndedAt: '2026-01-01T00:00:02.000Z'
        },
        git: {
          traceLinkedCommit: {
            sha: 'abcdef1234567890',
            shortSha: 'abcdef1',
            subject: 'Explain traced change',
            touchedTracedPath: true,
            relation: 'commit_touches_traced_path',
            confidence: 'high'
          }
        }
      }
    });

    const attachment = store.getWebviewAttachments()[0];

    assert.strictEqual(attachment.source, 'origin');
    assert.ok(attachment.xml?.startsWith('<ide_context source="vscode-tau">\nUser-attached IDE context.'));
    assert.ok(attachment.xml?.includes('<trace_origin_instructions>'));
    assert.ok(attachment.xml?.includes('<trace_origin_data>'));
    assert.ok(attachment.xml?.includes('"historicalPath": "src/old.ts"'));
    assert.ok(attachment.xml?.includes('"sessionEndedAt": "2026-01-01T00:00:02.000Z"'));
    assert.ok(attachment.xml?.includes('"subject": "Explain traced change"'));
    assert.ok(attachment.xml?.includes('<file path="src/current.ts" />'));
    assert.ok(attachment.xml?.endsWith('\n</ide_context>'));
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
