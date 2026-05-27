import * as assert from 'assert';
import { formatAgentMessages } from '../../controller/transcriptFormatting';

suite('Transcript formatting', () => {
  test('includes compaction tokens in restored compaction summaries', () => {
    assert.deepStrictEqual(formatAgentMessages([
      { role: 'compactionSummary', summary: 'Important prior context.', tokensBefore: 123333 }
    ]), [{
      role: 'system',
      text: 'Compacted 123,333 tokens.\n\nImportant prior context.',
      variant: 'compactionSummary'
    }]);
  });

  test('preserves branch summary messages as boxed transcript variant', () => {
    assert.deepStrictEqual(formatAgentMessages([
      { role: 'branchSummary', summary: 'Summary of that exploration:\n\n## Goal\nFix PR #1.' }
    ]), [{
      role: 'system',
      text: 'Returned from branch.\n\nSummary of that exploration:\n\n## Goal\nFix PR #1.',
      variant: 'branchSummary'
    }]);
  });

  test('restores Tauren-rendered custom extension messages as activities', () => {
    assert.deepStrictEqual(formatAgentMessages([
      {
        role: 'custom',
        customType: 'subagent-result',
        content: 'fallback',
        taurenRenderedMessage: {
          body: '\u001b[34mSubagent summary\u001b[0m',
          expandedBody: '\u001b[34mSubagent summary\nmore detail\u001b[0m',
          code: true
        }
      }
    ]), [{
      role: 'system',
      text: '',
      activities: [{
        id: 'restored-custom-1',
        kind: 'message',
        title: 'subagent-result',
        status: 'info',
        body: '\u001b[34mSubagent summary\u001b[0m',
        expandedBody: '\u001b[34mSubagent summary\nmore detail\u001b[0m',
        code: true
      }]
    }]);
  });

  test('preserves supported image parts from restored messages', () => {
    assert.deepStrictEqual(formatAgentMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', data: 'abc', mimeType: 'image/png' }
        ]
      }
    ]), [{
      role: 'user',
      text: 'Look at this',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }]
    }]);
  });
});
