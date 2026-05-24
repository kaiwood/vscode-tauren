import * as vscode from 'vscode';
import { tauChatViewType, TauChatViewProvider } from './tauChatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new TauChatViewProvider(
    context.extensionUri,
    undefined,
    context.workspaceState,
    context.globalState,
    undefined,
    context.extensionMode === vscode.ExtensionMode.Development
  );

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(tauChatViewType, provider),
    vscode.commands.registerCommand('tau.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('tau.resume', () => provider.resume()),
    vscode.commands.registerCommand('tau.fork', () => provider.fork()),
    vscode.commands.registerCommand('tau.clone', () => provider.clone()),
    vscode.commands.registerCommand('tau.showSessionTree', () => provider.toggleSessionTree()),
    vscode.commands.registerCommand('tau.toggleSessionList', () => provider.toggleSessionList()),
    vscode.commands.registerCommand('tau.openSessionDiff', () => provider.openSessionDiff()),
    vscode.commands.registerCommand('tau.renameSession', () => provider.renameSession()),
    vscode.commands.registerCommand('tau.compactSession', () => provider.compactSession()),
    vscode.commands.registerCommand('tau.exportSession', () => provider.exportSession()),
    vscode.commands.registerCommand('tau.moveSessionToTrash', () => provider.moveSessionToTrash()),
    vscode.commands.registerCommand('tau.reloadPi', () => provider.reloadPi()),
    vscode.commands.registerCommand('tau.copyLastResponse', () => provider.copyLastResponse()),
    vscode.commands.registerCommand('tau.openModelPicker', () => provider.openModelPicker()),
    vscode.commands.registerCommand('tau.toggleSettings', () => provider.toggleSettings()),
    vscode.commands.registerCommand('tau.toggleHelp', () => provider.toggleHelp()),
    vscode.commands.registerCommand('tau.stop', () => provider.stop()),
    vscode.commands.registerCommand('tau.toggleSteerFollowUp', () => provider.toggleSteerFollowUp()),
    vscode.commands.registerCommand('tau.addContext', () => provider.addContext()),
    vscode.commands.registerCommand('tau.sendSelectionToComposer', () => provider.sendSelectionToComposer()),
    vscode.commands.registerCommand('tau.traceOrigin', () => provider.traceOrigin())
  );
}

export function deactivate(): void {}
