import * as assert from 'assert';
import { flattenPiSessionTree } from '../../sessions/piSessionTree';

suite('Pi session tree', () => {
  test('keeps single-child chains visually flat', () => {
    const items = flattenPiSessionTree([
      {
        entry: { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'First prompt' } },
        children: [{
          entry: { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'First answer' } },
          children: [{
            entry: { id: 't1', parentId: 'a1', type: 'message', message: { role: 'toolResult', content: 'Tool result' } },
            children: []
          }]
        }]
      }
    ], 't1');

    assert.deepStrictEqual(items.map((item) => item.depth), [0, 0, 0]);
    assert.deepStrictEqual(items.map((item) => item.ancestorContinues), [[], [], []]);
    assert.deepStrictEqual(items.map((item) => item.activePath), [true, true, true]);
  });

  test('hides Pi tree bookkeeping entries', () => {
    const items = flattenPiSessionTree([
      {
        entry: { id: 's1', parentId: null, type: 'session_info', name: 'Feature work' },
        children: [{
          entry: { id: 'm1', parentId: 's1', type: 'model_change', modelId: 'gpt-test' },
          children: [{
            entry: { id: 'u1', parentId: 'm1', type: 'message', message: { role: 'user', content: 'Visible prompt' } },
            children: []
          }]
        }]
      }
    ], 'u1');

    assert.deepStrictEqual(items.map((item) => item.entryId), ['u1']);
  });

  test('formats branch summaries as returned-from-branch callouts', () => {
    const items = flattenPiSessionTree([
      {
        entry: { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'Main branch' } },
        children: [{
          entry: { id: 's1', parentId: 'u1', type: 'branch_summary', summary: 'Summary of that exploration:\n\n## Goal\nFix PR #1.' },
          children: []
        }]
      }
    ], 's1');

    assert.strictEqual(items[1].role, 'summary');
    assert.strictEqual(items[1].text, 'Returned from branch.\n\nSummary of that exploration:\n\n## Goal\nFix PR #1.');
  });

  test('formats tool results like Pi tree entries and hides assistant tool-call placeholders', () => {
    const items = flattenPiSessionTree([
      {
        entry: { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'Run tests' } },
        children: [{
          entry: {
            id: 'a1',
            parentId: 'u1',
            type: 'message',
            message: {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'npm test -- --grep "Chat webview"' } }]
            }
          },
          children: [{
            entry: { id: 't1', parentId: 'a1', type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', content: 'ok' } },
            children: []
          }]
        }]
      }
    ], 't1');

    assert.deepStrictEqual(items.map((item) => ({ entryId: item.entryId, role: item.role, text: item.text })), [
      { entryId: 'u1', role: 'user', text: 'Run tests' },
      { entryId: 't1', role: 'tool', text: '[bash: npm test -- --grep "Chat webview"]' }
    ]);
  });

  test('indents only at branch points', () => {
    const items = flattenPiSessionTree([
      {
        entry: { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'First prompt' } },
        children: [
          {
            entry: { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'First answer' } },
            children: []
          },
          {
            entry: { id: 'u2', parentId: 'u1', type: 'message', message: { role: 'user', content: 'Second prompt' } },
            label: 'retry',
            children: [{
              entry: { id: 'a2', parentId: 'u2', type: 'message', message: { role: 'assistant', content: 'Second answer' } },
              children: []
            }]
          }
        ]
      }
    ], 'a2');

    assert.deepStrictEqual(items, [
      {
        entryId: 'u1',
        role: 'user',
        text: 'First prompt',
        current: false,
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        activePath: true,
        prefix: ''
      },
      {
        entryId: 'u2',
        role: 'user',
        text: 'Second prompt',
        current: false,
        depth: 1,
        isLast: false,
        ancestorContinues: [],
        activePath: true,
        prefix: '├⊟ ',
        label: 'retry'
      },
      {
        entryId: 'a2',
        role: 'assistant',
        text: 'Second answer',
        current: true,
        depth: 2,
        isLast: true,
        ancestorContinues: [true],
        activePath: true,
        prefix: '│     '
      },
      {
        entryId: 'a1',
        role: 'assistant',
        text: 'First answer',
        current: false,
        depth: 1,
        isLast: true,
        ancestorContinues: [],
        activePath: false,
        prefix: '└─ '
      }
    ]);
  });
});
