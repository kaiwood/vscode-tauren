import * as vscode from 'vscode';
import { chatViewType, PiChatViewProvider } from './piChatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PiChatViewProvider(context.extensionUri, undefined, context.workspaceState);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(chatViewType, provider),
    vscode.commands.registerCommand('tau.focus', () => provider.focus()),
    vscode.commands.registerCommand('tau.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('tau.resume', () => provider.resume()),
    vscode.commands.registerCommand('tau.fork', () => provider.fork()),
    vscode.commands.registerCommand('tau.clone', () => provider.clone()),
    vscode.commands.registerCommand('tau.addContext', () => provider.addContext()),
    vscode.commands.registerCommand('tau.traceOrigin', () => provider.traceOrigin())
  );
}

export function deactivate(): void {}
