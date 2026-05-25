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

suite('Tauren extension', () => {
  test('activates the development extension', async () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the Tauren extension to be available');
    await extension.activate();

    assert.strictEqual(extension.isActive, true);
  });

  test('registers contributed commands', async () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the Tauren extension to be available');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('tauren.newSession'));
    assert.ok(commands.includes('tauren.resume'));
    assert.ok(commands.includes('tauren.fork'));
    assert.ok(commands.includes('tauren.clone'));
    assert.ok(commands.includes('tauren.showSessionTree'));
    assert.ok(commands.includes('tauren.toggleSessionList'));
    assert.ok(commands.includes('tauren.openSessionDiff'));
    assert.ok(commands.includes('tauren.renameSession'));
    assert.ok(commands.includes('tauren.compactSession'));
    assert.ok(commands.includes('tauren.exportSession'));
    assert.ok(commands.includes('tauren.moveSessionToTrash'));
    assert.ok(commands.includes('tauren.reloadPi'));
    assert.ok(commands.includes('tauren.copyLastResponse'));
    assert.ok(commands.includes('tauren.openModelPicker'));
    assert.ok(commands.includes('tauren.toggleSettings'));
    assert.ok(commands.includes('tauren.toggleHelp'));
    assert.ok(commands.includes('tauren.stop'));
    assert.ok(commands.includes('tauren.toggleSteerFollowUp'));
    assert.ok(commands.includes('tauren.addContext'));
    assert.ok(commands.includes('tauren.traceOrigin'));
  });

  test('keeps native new session action visible while busy', () => {
    const extension = findTauExtension();

    assert.ok(extension, 'Expected the Tauren extension to be available');

    const packageJson = extension.packageJSON as PackageJson;
    const newSessionMenu = packageJson.contributes?.menus?.['view/title']?.find((entry) => entry.command === 'tauren.newSession');

    assert.ok(newSessionMenu, 'Expected tauren.newSession in the native view title menu');
    assert.strictEqual(newSessionMenu.when, 'view == tauren.chatView');
  });
});

function findTauExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((extension) => {
    const packageJson = extension.packageJSON as PackageJson;

    return packageJson.name === 'tauren';
  });
}
