import * as vscode from 'vscode';
import { chatViewType, PiChatViewProvider } from './piChatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PiChatViewProvider(context.extensionUri, undefined, context.workspaceState);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(chatViewType, provider),
    vscode.commands.registerCommand('piui.focus', () => provider.focus()),
    vscode.commands.registerCommand('piui.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('piui.addContext', () => provider.addContext())
  );
}

export function deactivate(): void {}
