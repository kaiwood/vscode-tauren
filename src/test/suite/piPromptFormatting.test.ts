import * as assert from 'assert';
import {
  formatPromptForPi,
  formatPromptWithIdeContext,
  formatPromptWithVisibleSystemPrompt
} from '../../piPromptFormatting';

suite('Pi prompt formatting helpers', () => {
  test('returns the user prompt unchanged without context or system prompt', () => {
    assert.strictEqual(formatPromptForPi('plain prompt', [], undefined), 'plain prompt');
  });

  test('wraps visible system prompt and trims configured whitespace', () => {
    assert.strictEqual(
      formatPromptWithVisibleSystemPrompt('user prompt', '  Use short answers.\n'),
      [
        '<!-- tau:visible-system-prompt:start -->',
        '<system_prompt source="vscode-tau-settings" visibility="user-editable">',
        'Use short answers.',
        '</system_prompt>',
        '<!-- tau:visible-system-prompt:end -->',
        '',
        'user prompt'
      ].join('\n')
    );
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

    assert.ok(prompt.includes('<!-- tau:ide-context:start -->'));
    assert.ok(prompt.includes('<file path="src/a&amp;b.ts" />'));
    assert.ok(prompt.includes('<selection path="src/foo.ts" start_line="2" end_line="4" language="typescript">'));
    assert.ok(prompt.includes('```typescript\nconst answer = 42;\n```'));
    assert.ok(prompt.endsWith('\n\nexplain this'));
  });

  test('escapes selection attributes and chooses a safe markdown fence', () => {
    const prompt = formatPromptWithIdeContext('review', [
      {
        kind: 'selection',
        path: 'src/"quoted"<&>.ts',
        languageId: 'bad language',
        text: 'before\n```\nafter'
      }
    ]);

    assert.ok(prompt.includes('<selection path="src/&quot;quoted&quot;&lt;&amp;&gt;.ts" language="bad language">'));
    assert.ok(prompt.includes('````\nbefore\n```\nafter\n````'));
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
