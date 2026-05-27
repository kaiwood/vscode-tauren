import * as vscode from 'vscode';
import { taurenChatViewType, TaurenChatViewProvider } from './taurenChatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new TaurenChatViewProvider(
    context.extensionUri,
    undefined,
    context.workspaceState,
    context.globalState,
    undefined,
    context.extensionMode === vscode.ExtensionMode.Development,
    context.storageUri ?? context.globalStorageUri
  );

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(taurenChatViewType, provider),
    vscode.commands.registerCommand('tauren.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('tauren.resume', () => provider.resume()),
    vscode.commands.registerCommand('tauren.fork', () => provider.fork()),
    vscode.commands.registerCommand('tauren.clone', () => provider.clone()),
    vscode.commands.registerCommand('tauren.showSessionTree', () => provider.toggleSessionTree()),
    vscode.commands.registerCommand('tauren.toggleSessionList', () => provider.toggleSessionList()),
    vscode.commands.registerCommand('tauren.openSessionDiff', () => provider.openSessionDiff()),
    vscode.commands.registerCommand('tauren.renameSession', () => provider.renameSession()),
    vscode.commands.registerCommand('tauren.compactSession', () => provider.compactSession()),
    vscode.commands.registerCommand('tauren.exportSession', () => provider.exportSession()),
    vscode.commands.registerCommand('tauren.moveSessionToTrash', () => provider.moveSessionToTrash()),
    vscode.commands.registerCommand('tauren.reloadPi', () => provider.reloadPi()),
    vscode.commands.registerCommand('tauren.copyLastResponse', () => provider.copyLastResponse()),
    vscode.commands.registerCommand('tauren.searchTranscript', () => provider.searchTranscript()),
    vscode.commands.registerCommand('tauren.scrollTranscriptToTop', () => provider.scrollTranscriptToTop()),
    vscode.commands.registerCommand('tauren.scrollTranscriptToBottom', () => provider.scrollTranscriptToBottom()),
    vscode.commands.registerCommand('tauren.openModelPicker', () => provider.openModelPicker()),
    vscode.commands.registerCommand('tauren.raiseThinkingLevel', () => provider.raiseThinkingLevel()),
    vscode.commands.registerCommand('tauren.lowerThinkingLevel', () => provider.lowerThinkingLevel()),
    vscode.commands.registerCommand('tauren.toggleSettings', () => provider.toggleSettings()),
    vscode.commands.registerCommand('tauren.toggleHelp', () => provider.toggleHelp()),
    vscode.commands.registerCommand('tauren.stop', () => provider.stop()),
    vscode.commands.registerCommand('tauren.toggleSteerFollowUp', () => provider.toggleSteerFollowUp()),
    vscode.commands.registerCommand('tauren.addContext', () => provider.addContext()),
    vscode.commands.registerCommand('tauren.sendSelectionToComposer', () => provider.sendSelectionToComposer()),
    vscode.commands.registerCommand('tauren.traceOrigin', () => provider.traceOrigin()),
    vscode.commands.registerCommand('tauren.showDiagnostics', () => provider.showDiagnostics())
  );
}

export function deactivate(): void {}
