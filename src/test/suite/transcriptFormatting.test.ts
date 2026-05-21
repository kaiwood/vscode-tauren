import * as assert from 'assert';
import { formatAgentMessages } from '../../controller/transcriptFormatting';

suite('Transcript formatting', () => {
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
