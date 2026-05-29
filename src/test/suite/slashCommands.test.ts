import * as assert from 'assert';
import {
  hiddenLocalSlashCommandNames,
  isBuiltinSlashCommand,
  isSupportedBuiltinSlashCommand,
  localSlashCommandNames,
  localSlashCommands,
  localSlashMenuCommands
} from '../../commands/slashCommands';

suite('Slash commands', () => {
  test('uses shared metadata for local menu commands and controller support checks', () => {
    const names = localSlashCommands.map((command) => command.name);

    assert.strictEqual(new Set(names).size, names.length);
    assert.ok(names.includes('model'));
    assert.ok(names.includes('settings'));
    assert.ok(names.includes('tree'));
    assert.ok(names.includes('login'));
    assert.ok(names.includes('logout'));
    assert.deepStrictEqual(localSlashCommandNames, names);
    assert.deepStrictEqual(hiddenLocalSlashCommandNames, []);

    for (const command of localSlashCommands) {
      assert.strictEqual(isBuiltinSlashCommand(command.name), true);
      assert.strictEqual('supported' in command, false);
      assert.strictEqual('hidden' in command, false);
    }

    const menuNames = localSlashMenuCommands.map((command) => command.name);
    assert.ok(menuNames.includes('model'));
    assert.ok(menuNames.includes('settings'));
    assert.ok(menuNames.includes('tree'));
    assert.ok(menuNames.includes('login'));
    assert.ok(menuNames.includes('logout'));

    for (const command of localSlashMenuCommands) {
      assert.strictEqual(isBuiltinSlashCommand(command.name), true);
      assert.strictEqual(isSupportedBuiltinSlashCommand(command.name), true);
      assert.strictEqual('supported' in command, false);
      assert.strictEqual('hidden' in command, false);
    }

    assert.strictEqual(isSupportedBuiltinSlashCommand('model'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('resume'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('tree'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('login'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('logout'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('settings'), true);
    assert.strictEqual(isSupportedBuiltinSlashCommand('unknown'), false);
    assert.strictEqual(isBuiltinSlashCommand('unknown'), false);
  });
});
