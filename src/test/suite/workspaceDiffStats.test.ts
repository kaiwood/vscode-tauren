import * as assert from 'assert';
import { emptyWorkspaceDiffStats, parseGitNumstat } from '../../workspaceDiffStats';

suite('Workspace diff stats', () => {
  test('parses git numstat output', () => {
    assert.deepStrictEqual(
      parseGitNumstat('3\t2\tsrc/a.ts\n10\t0\tsrc/b.ts\n'),
      { addedLines: 13, removedLines: 2 }
    );
  });

  test('ignores binary and malformed numstat lines', () => {
    assert.deepStrictEqual(
      parseGitNumstat('-\t-\timage.png\nbad\t2\tfile.ts\n1\t4\tsrc/c.ts'),
      { addedLines: 1, removedLines: 4 }
    );
  });

  test('empty stats are zeroed', () => {
    assert.deepStrictEqual(emptyWorkspaceDiffStats(), { addedLines: 0, removedLines: 0 });
  });
});
