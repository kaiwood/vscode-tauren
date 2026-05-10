import * as assert from 'assert';
import * as vscode from 'vscode';

type PackageJson = {
  name?: unknown;
};

suite('Pi UI extension', () => {
  test('activates the development extension', async () => {
    const extension = findPiuiExtension();

    assert.ok(extension, 'Expected the piui extension to be available');
    await extension.activate();

    assert.strictEqual(extension.isActive, true);
  });

  test('registers contributed commands', async () => {
    const extension = findPiuiExtension();

    assert.ok(extension, 'Expected the piui extension to be available');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('piui.focus'));
    assert.ok(commands.includes('piui.newSession'));
    assert.ok(commands.includes('piui.addContext'));
  });
});

function findPiuiExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((extension) => {
    const packageJson = extension.packageJSON as PackageJson;

    return packageJson.name === 'piui';
  });
}
