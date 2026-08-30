import * as assert from 'assert';
import { getBashActivityCommand, getFileActivityPath, getReadActivityPath } from '../../webview/messages/activityActions';

suite('Webview activity actions', () => {
  test('preserves bash commands verbatim', () => {
    const command = '\n  printf "hello"  \n';
    const activity = {
      kind: 'tool_execution',
      title: '$ printf "hello"',
      command
    };

    assert.strictEqual(getBashActivityCommand(activity), command);
  });

  test('preserves numeric suffixes in edit and write paths', () => {
    assert.strictEqual(getFileActivityPath({
      kind: 'tool_execution',
      title: 'edit fixtures/case:12'
    }), 'fixtures/case:12');
    assert.strictEqual(getFileActivityPath({
      kind: 'tool_execution',
      title: 'write notes/release:2026'
    }), 'notes/release:2026');
  });

  test('removes only the displayed line range from read paths', () => {
    const activity = {
      kind: 'tool_execution',
      title: 'read src/example.ts:12-20'
    };

    assert.strictEqual(getFileActivityPath(activity), 'src/example.ts');
    assert.strictEqual(getReadActivityPath(activity), 'src/example.ts');
  });
});
