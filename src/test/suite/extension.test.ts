import * as assert from 'assert';
import * as vscode from 'vscode';

type PackageJson = {
  name?: unknown;
  contributes?: {
    menus?: {
      'view/title'?: Array<{ command?: unknown; when?: unknown }>;
    };
  };
};

suite('Tau extension', () => {
  test('activates the development extension', async () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the tau extension to be available');
    await extension.activate();

    assert.strictEqual(extension.isActive, true);
  });

  test('registers contributed commands', async () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the tau extension to be available');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('tau.newSession'));
    assert.ok(commands.includes('tau.resume'));
    assert.ok(commands.includes('tau.fork'));
    assert.ok(commands.includes('tau.clone'));
    assert.ok(commands.includes('tau.showSessionTree'));
    assert.ok(commands.includes('tau.toggleSessionList'));
    assert.ok(commands.includes('tau.openSessionDiff'));
    assert.ok(commands.includes('tau.renameSession'));
    assert.ok(commands.includes('tau.compactSession'));
    assert.ok(commands.includes('tau.exportSession'));
    assert.ok(commands.includes('tau.moveSessionToTrash'));
    assert.ok(commands.includes('tau.reloadPi'));
    assert.ok(commands.includes('tau.copyLastResponse'));
    assert.ok(commands.includes('tau.openModelPicker'));
    assert.ok(commands.includes('tau.toggleSettings'));
    assert.ok(commands.includes('tau.toggleHelp'));
    assert.ok(commands.includes('tau.stop'));
    assert.ok(commands.includes('tau.toggleSteerFollowUp'));
    assert.ok(commands.includes('tau.addContext'));
    assert.ok(commands.includes('tau.traceOrigin'));
  });

  test('keeps native new session action visible while busy', () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the tau extension to be available');

    const packageJson = extension.packageJSON as PackageJson;
    const newSessionMenu = packageJson.contributes?.menus?.['view/title']?.find((entry) => entry.command === 'tau.newSession');

    assert.ok(newSessionMenu, 'Expected tau.newSession in the native view title menu');
    assert.strictEqual(newSessionMenu.when, 'view == tau.chatView');
  });
});

function findTauExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((extension) => {
    const packageJson = extension.packageJSON as PackageJson;

    return packageJson.name === 'tau';
  });
}
