import * as assert from 'assert';
import {
  canOpenSessionItemMenu,
  getSessionItemCommandIcon,
  getSessionItemCommandLabel,
  parseSessionItemCommand,
  sessionItemMenuCommands
} from '../../webview/sessions/sessionItemCommands';

suite('Webview session item commands', () => {
  test('orders session item menu commands', () => {
    assert.deepStrictEqual(sessionItemMenuCommands, ['rename', 'showChanges', 'fork', 'clone', 'compact', 'export', 'delete']);
  });

  test('parses only supported session item commands', () => {
    for (const command of sessionItemMenuCommands) {
      assert.strictEqual(parseSessionItemCommand(command), command);
      assert.ok(getSessionItemCommandLabel(command));
      assert.ok(getSessionItemCommandIcon(command).includes('<svg'));
    }

    assert.strictEqual(parseSessionItemCommand('showChanges'), 'showChanges');
    assert.strictEqual(parseSessionItemCommand('unknown'), undefined);
    assert.strictEqual(parseSessionItemCommand(null), undefined);
  });

  test('opens session item menus based on session identity, not busy command state', () => {
    assert.strictEqual(canOpenSessionItemMenu({ path: '/sessions/running.jsonl' }), true);
    assert.strictEqual(canOpenSessionItemMenu({ path: '' }), false);
  });
});
