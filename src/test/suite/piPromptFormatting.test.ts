import * as assert from 'assert';
import {
  formatPromptForPi,
  formatPromptWithIdeContext
} from '../../prompt/formatting';

suite('Pi prompt formatting helpers', () => {
  test('returns the user prompt unchanged without context', () => {
    assert.strictEqual(formatPromptForPi('plain prompt', []), 'plain prompt');
  });

  test('formats file and selection IDE context attachments', () => {
    const prompt = formatPromptWithIdeContext('explain this', [
      {
        kind: 'file',
        path: 'src/a&b.ts'
      },
      {
        kind: 'selection',
        path: 'src/foo.ts',
        languageId: 'typescript',
        startLine: 2,
        endLine: 4,
        text: 'const answer = 42;'
      }
    ]);

    assert.ok(prompt.startsWith('explain this\n\n<ide_context source="vscode-tauren">\n'));
    assert.ok(!prompt.includes('<!-- tau:ide-context'));
    assert.ok(prompt.includes('<file path="src/a&amp;b.ts" />'));
    assert.ok(prompt.includes('<selection path="src/foo.ts" start_line="2" end_line="4" language="typescript"><![CDATA[\nconst answer = 42;\n]]></selection>'));
    assert.ok(!prompt.includes('```typescript'));
    assert.ok(prompt.endsWith('\n</ide_context>'));
  });

  test('includes trace origin instructions and data before standard context attachments', () => {
    const prompt = formatPromptWithIdeContext('explain origin', [
      {
        kind: 'selection',
        path: 'src/features/NewComponent.ts',
        source: 'origin',
        traceOrigin: {
          historicalPath: 'src/components/OldComponent.ts',
          currentRelativePath: 'src/features/NewComponent.ts'
        },
        text: 'export const NewComponent = () => null;'
      }
    ]);

    assert.ok(prompt.includes('<trace_origin_instructions>\nThe attached metadata links historical agent work to the current code location.'));
    assert.ok(prompt.includes('<trace_origin_data>\n{\n  "historicalPath": "src/components/OldComponent.ts",\n  "currentRelativePath": "src/features/NewComponent.ts"\n}\n</trace_origin_data>'));
    assert.ok(prompt.indexOf('<trace_origin_data>') < prompt.indexOf('<selection path="src/features/NewComponent.ts">'));
  });

  test('includes trace origin git commit metadata when supplied', () => {
    const prompt = formatPromptWithIdeContext('explain origin', [
      {
        kind: 'selection',
        path: 'src/current.ts',
        source: 'origin',
        traceOrigin: {
          historicalPath: 'src/old.ts',
          currentRelativePath: 'src/current.ts',
          origin: {
            sessionId: 'session-1',
            toolName: 'edit',
            recordId: 'call-1',
            matchedAt: '2026-01-01T00:00:01.000Z',
            sessionEndedAt: '2026-01-01T00:00:02.000Z'
          },
          git: {
            traceLinkedCommit: {
              sha: 'abcdef1234567890',
              shortSha: 'abcdef1',
              subject: 'Explain traced change',
              body: 'Commit rationale.',
              commitDate: '2026-01-01T00:05:00.000Z',
              touchedTracedPath: true,
              touchedPaths: ['src/current.ts'],
              relation: 'commit_touches_traced_path',
              confidence: 'high'
            }
          }
        },
        text: 'export const current = true;'
      }
    ]);

    assert.ok(prompt.includes('"sessionEndedAt": "2026-01-01T00:00:02.000Z"'));
    assert.ok(prompt.includes('"traceLinkedCommit"'));
    assert.ok(prompt.includes('"subject": "Explain traced change"'));
    assert.ok(prompt.includes('"confidence": "high"'));
  });

  test('uses git-only trace origin instructions without session fields', () => {
    const prompt = formatPromptWithIdeContext('explain origin', [
      {
        kind: 'selection',
        path: 'src/current.ts',
        source: 'origin',
        traceOrigin: {
          currentRelativePath: 'src/current.ts',
          git: {
            traceLinkedCommit: {
              sha: 'abcdef1234567890',
              shortSha: 'abcdef1',
              subject: 'Explain current file',
              touchedTracedPath: true,
              touchedPaths: ['src/current.ts'],
              relation: 'commit_touches_traced_path',
              confidence: 'high'
            }
          }
        },
        text: 'export const current = true;'
      }
    ]);

    assert.ok(prompt.includes('The attached metadata links Git history to the current code location.'));
    assert.ok(!prompt.includes('historical agent work'));
    assert.ok(!prompt.includes('"historicalPath"'));
    assert.ok(!prompt.includes('"origin"'));
    assert.ok(prompt.includes('"currentRelativePath": "src/current.ts"'));
    assert.ok(prompt.includes('"traceLinkedCommit"'));
  });

  test('includes context notes for diff-view selections', () => {
    const prompt = formatPromptWithIdeContext('explain this change', [
      {
        kind: 'selection',
        path: 'src/foo.ts',
        startLine: 12,
        note: 'Line numbers are diff-view section lines, not current file lines.',
        text: 'const answer = 42;'
      }
    ]);

    assert.ok(prompt.includes('note="Line numbers are diff-view section lines, not current file lines."'));
  });

  test('escapes selection attributes and wraps text in CDATA', () => {
    const prompt = formatPromptWithIdeContext('review', [
      {
        kind: 'selection',
        path: 'src/"quoted"<&>.ts',
        languageId: 'bad language',
        text: 'before\n  const value = "<&>";\nafter ]]> marker'
      }
    ]);

    assert.ok(prompt.includes('<selection path="src/&quot;quoted&quot;&lt;&amp;&gt;.ts" language="bad language"><![CDATA[\nbefore\n  const value = "<&>";\nafter ]]]]><![CDATA[> marker\n]]></selection>'));
  });

  test('omits empty selection attachments', () => {
    assert.strictEqual(
      formatPromptWithIdeContext('only user text', [
        { kind: 'selection', path: 'src/empty.ts', text: '   ' }
      ]),
      'only user text'
    );
  });
});
