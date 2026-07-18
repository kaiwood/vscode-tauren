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
    context.storageUri ?? context.globalStorageUri,
    context.globalStorageUri
  );

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(taurenChatViewType, provider, { webviewOptions: { retainContextWhenHidden: true } }),
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
    vscode.commands.registerCommand('tauren.scroll', (options?: unknown) => provider.scrollPane(options)),
    vscode.commands.registerCommand('tauren.scrollLineUp', () => provider.scrollPane({ direction: 'up', amount: 'line' })),
    vscode.commands.registerCommand('tauren.scrollLineDown', () => provider.scrollPane({ direction: 'down', amount: 'line' })),
    vscode.commands.registerCommand('tauren.openModelPicker', () => provider.openModelPicker()),
    vscode.commands.registerCommand('tauren.raiseThinkingLevel', () => provider.raiseThinkingLevel()),
    vscode.commands.registerCommand('tauren.lowerThinkingLevel', () => provider.lowerThinkingLevel()),
    vscode.commands.registerCommand('tauren.toggleSettings', () => provider.toggleSettings()),
    vscode.commands.registerCommand('tauren.memory.status', () => provider.runMemoryAction('status')),
    vscode.commands.registerCommand('tauren.memory.enable', () => provider.runMemoryAction('enable')),
    vscode.commands.registerCommand('tauren.memory.disable', () => provider.runMemoryAction('disable')),
    vscode.commands.registerCommand('tauren.memory.toggleAutoSummary', () => provider.runMemoryAction('auto-summary')),
    vscode.commands.registerCommand('tauren.memory.list', () => provider.runMemoryAction('list')),
    vscode.commands.registerCommand('tauren.memory.add', () => provider.runMemoryAction('add')),
    vscode.commands.registerCommand('tauren.memory.addCore', () => provider.runMemoryAction('add-core')),
    vscode.commands.registerCommand('tauren.memory.forget', () => provider.runMemoryAction('forget')),
    vscode.commands.registerCommand('tauren.memory.promote', () => provider.runMemoryAction('promote')),
    vscode.commands.registerCommand('tauren.memory.relax', () => provider.runMemoryAction('relax')),
    vscode.commands.registerCommand('tauren.memory.inspect', () => provider.runMemoryAction('inspect')),
    vscode.commands.registerCommand('tauren.memory.why', () => provider.runMemoryAction('why')),
    vscode.commands.registerCommand('tauren.memory.summarize', () => provider.runMemoryAction('summarize')),
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
