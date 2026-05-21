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
});
