import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage
} from './sidebar/chatWebview';
import type { WebviewMessage } from './webviewProtocol/types';
import { type PiRpcClientFactory } from './rpc/clientTypes';
import { PiRpcClient } from './rpc/client';
import { createSessionDiffStatsFileWatcher, readSessionDiffSnapshot, writeSessionDiffSnapshot } from './diff/sessionDiffStorage';
import { SessionDiffViewer } from './diff/sessionDiffViewer';
import { ShikiCodeRenderer } from './highlighting/shikiCodeRenderer';
import { TauSessionManager } from './sessions/tauSessionManager';
import { listPiSessions } from './sessions/piSessionList';
import { runReadyScript } from './readyScript';
import { createPromptContextFromEditor } from './prompt/editorContext';
import { readCachedSessionMeta, writeCachedSessionMeta } from './metadata/cache';

export const chatViewType = 'tau.chatView';
export type { PiRpcClientLike } from './rpc/clientTypes';

const currentSessionFileStorageKey = 'tau.currentSessionFile';
const contextUsagePollingIntervalMs = 2000;
const sessionDiffStatsRefreshDelayMs = 250;

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private webviewReady = false;
  private readonly controller: TauSessionManager;
  private readonly codeRenderer = new ShikiCodeRenderer();
  private readonly sessionDiffViewer = new SessionDiffViewer((message, notifyType) => this.showNotification(message, notifyType));
  private contextUsagePollTimer: NodeJS.Timeout | undefined;
  private sessionDiffStatsRefreshTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiRpcClientFactory = (options) => new PiRpcClient(options),
    private readonly workspaceState?: vscode.Memento
  ) {
    this.controller = new TauSessionManager({
      createClient,
      getCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      getPiPath: () => getPiPathSetting(),
      getOutputColors: () => getOutputColorsSetting(),
      getReadyScript: () => getReadyScriptSetting(),
      getReadyScriptEnabled: () => getReadyScriptEnabledSetting(),
      runReadyScript: (scriptPath, cwd) => {
        runReadyScript(scriptPath, cwd, {
          onError: (message) => this.showNotification(message, 'warning')
        });
      },
      postState: (message) => {
        void this.webviewView?.webview.postMessage(message);
      },
      showNotification: (message, notifyType) => this.showNotification(message, notifyType),
      showToast: (message) => {
        void this.webviewView?.webview.postMessage({ type: 'toast', message });
      },
      writeClipboard: (text) => vscode.env.clipboard.writeText(text),
      extensionUi: {
        notify: (message, notifyType) => this.showNotification(message, notifyType),
        select: (title, options) => vscode.window.showQuickPick(options, {
          title,
          placeHolder: title
        }),
        confirm: (title, message) => this.showConfirmation(title, message),
        input: (title, placeholder) => vscode.window.showInputBox({
          title,
          placeHolder: placeholder
        })
      },
      initialSessionMeta: readCachedSessionMeta(this.workspaceState),
      initialSessionFile: readCurrentSessionFile(this.workspaceState),
      onSessionMetaChange: (metadata) => writeCachedSessionMeta(this.workspaceState, metadata),
      onSessionFileChange: (sessionFile) => this.writeCurrentSessionFile(sessionFile),
      loadSessionDiffSnapshot: (sessionFile) => readSessionDiffSnapshot(this.workspaceState, sessionFile),
      saveSessionDiffSnapshot: (sessionFile, snapshot) => writeSessionDiffSnapshot(this.workspaceState, sessionFile, snapshot),
      listSessions: (cwd, currentSessionFile) => listPiSessions({ cwd, currentSessionFile }),
      deleteSession: (sessionPath, displayName) => this.deleteSession(sessionPath, displayName),
      showSessionChanges: (sessionPath, displayName) => this.sessionDiffViewer.showSessionChanges(sessionPath, displayName)
    });

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('tau.piPath')) {
          this.controller.handlePiPathChanged();
        }

        if (event.affectsConfiguration('tau.outputColors')) {
          this.controller.postState();
        }

        if (event.affectsConfiguration('editor.tokenColorCustomizations') || event.affectsConfiguration('editor.semanticTokenColorCustomizations')) {
          this.resetCodeRenderer();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.resetCodeRenderer()),
      createSessionDiffStatsFileWatcher(() => this.scheduleSessionDiffStatsRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleSessionDiffStatsRefresh())
    );
  }

  public dispose(): void {
    this.stopContextUsagePolling();
    this.stopSessionDiffStatsRefreshTimer();
    this.disposeWebviewDisposables();

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }

    this.codeRenderer.dispose();
    this.sessionDiffViewer.dispose();
    this.controller.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.stopContextUsagePolling();
    this.disposeWebviewDisposables();
    this.webviewView = webviewView;
    this.webviewReady = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    const markdownItUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'vendor', 'markdown-it.min.js')
    );
    const domPurifyUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'vendor', 'purify.min.js')
    );
    const webviewScriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'chat.js')
    );

    webviewView.webview.html = createWebviewHtml({
      markdownItScriptUri: markdownItUri.toString(),
      domPurifyScriptUri: domPurifyUri.toString(),
      webviewScriptUri: webviewScriptUri.toString()
    });

    this.webviewDisposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView !== webviewView) {
          return;
        }

        this.webviewView = undefined;
        this.webviewReady = false;
        this.stopContextUsagePolling();
        this.disposeWebviewDisposables();
      }),
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(parseWebviewMessage(message));
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.refreshLiveMetadata();
          this.controller.refreshSessionDiffStats();
          this.startContextUsagePolling();
        } else {
          this.stopContextUsagePolling();
        }
      })
    );

    this.controller.postState();
    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
  }

  public async focus(): Promise<void> {
    this.pendingInputFocus = true;

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${chatViewType}.focus`);
    }

    this.postInputFocusSoon();
    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
  }

  public async newSession(): Promise<void> {
    this.controller.newSession();
    await this.focus();
  }

  public async resume(): Promise<void> {
    await this.controller.runLocalSlashCommand('resume');
    await this.focus();
  }

  public async fork(): Promise<void> {
    await this.controller.runLocalSlashCommand('fork');
    await this.focus();
  }

  public async clone(): Promise<void> {
    await this.controller.runLocalSlashCommand('clone');
    await this.focus();
  }

  public async addContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.showNotification('Open a file or select code before adding Pi context.', 'warning');
      return;
    }

    const context = createPromptContextFromEditor(editor);

    if (context.length === 0) {
      this.showNotification('No file context is available for the active editor.', 'warning');
      return;
    }

    this.controller.addPromptContext(context);
    await this.focus();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'openFile') {
      await this.openFileReference(message.path, message.line, message.column);
      return;
    }

    if (message.type === 'ready') {
      this.webviewReady = true;
      this.codeRenderer.warmup();
      await this.controller.handleWebviewMessage(message);
      this.postInputFocusSoon();
      return;
    }

    if (message.type === 'highlightCode') {
      await this.handleCodeHighlightRequest(message.id, message.code, message.language, message.themeId);
      return;
    }

    await this.controller.handleWebviewMessage(message);
  }

  private async handleCodeHighlightRequest(id: string, code: string, language: string, themeId?: string): Promise<void> {
    const result = await this.codeRenderer.highlightCode(code, language, themeId);
    void this.webviewView?.webview.postMessage({
      type: 'highlightCodeResult',
      id,
      html: result?.html,
      language: result?.language
    });
  }

  private resetCodeRenderer(): void {
    this.codeRenderer.reset();
    void this.webviewView?.webview.postMessage({ type: 'codeThemeChanged' });
  }

  private async openFileReference(filePath: string, line?: number, column?: number): Promise<void> {
    const uri = resolveWorkspaceFileUri(filePath);

    if (!uri) {
      this.showNotification(`No workspace is open for ${filePath}.`, 'warning');
      return;
    }

    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      this.showNotification(`File not found: ${filePath}`, 'warning');
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const targetLine = Math.min(Math.max((line ?? 1) - 1, 0), Math.max(document.lineCount - 1, 0));
    const targetColumn = Math.min(Math.max((column ?? 1) - 1, 0), document.lineAt(targetLine).text.length);
    const position = new vscode.Position(targetLine, targetColumn);
    const selection = new vscode.Selection(position, position);
    await vscode.window.showTextDocument(document, {
      selection,
      preview: true
    });
  }

  private disposeWebviewDisposables(): void {
    for (const disposable of this.webviewDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  private showNotification(message: string, notifyType: string): void {
    if (notifyType === 'error') {
      void vscode.window.showErrorMessage(message);
      return;
    }

    if (notifyType === 'warning') {
      void vscode.window.showWarningMessage(message);
      return;
    }

    void vscode.window.showInformationMessage(message);
  }

  private async showConfirmation(title: string, message: string | undefined): Promise<boolean | undefined> {
    const yes = 'Yes';
    const no = 'No';
    const selected = await vscode.window.showWarningMessage(
      title,
      { modal: true, ...(message ? { detail: message } : {}) },
      yes,
      no
    );

    if (selected === yes) {
      return true;
    }

    if (selected === no) {
      return false;
    }

    return undefined;
  }

  private async deleteSession(sessionPath: string, displayName: string): Promise<boolean> {
    const moveToTrash = 'Move to Trash';
    const selected = await vscode.window.showWarningMessage(
      `Move "${displayName}" to Trash?`,
      { modal: true, detail: sessionPath },
      moveToTrash
    );

    if (selected !== moveToTrash) {
      return false;
    }

    await vscode.workspace.fs.delete(vscode.Uri.file(sessionPath), { useTrash: true });
    return true;
  }

  private postInputFocus(): void {
    if (!this.pendingInputFocus || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingInputFocus = false;
    void this.webviewView.webview.postMessage({ type: 'focusInput' });
  }

  private postInputFocusSoon(): void {
    setTimeout(() => this.postInputFocus(), 0);
  }

  private refreshLiveMetadata(): void {
    this.controller.refreshSessionMeta({ startClient: true });
  }

  private scheduleSessionDiffStatsRefresh(): void {
    this.stopSessionDiffStatsRefreshTimer();
    this.sessionDiffStatsRefreshTimer = setTimeout(() => {
      this.sessionDiffStatsRefreshTimer = undefined;
      this.controller.refreshSessionDiffStats();
    }, sessionDiffStatsRefreshDelayMs);
  }

  private stopSessionDiffStatsRefreshTimer(): void {
    if (!this.sessionDiffStatsRefreshTimer) {
      return;
    }

    clearTimeout(this.sessionDiffStatsRefreshTimer);
    this.sessionDiffStatsRefreshTimer = undefined;
  }

  private startContextUsagePolling(): void {
    if (this.contextUsagePollTimer || !this.webviewView?.visible) {
      return;
    }

    this.contextUsagePollTimer = setInterval(() => {
      if (!this.webviewView?.visible) {
        this.stopContextUsagePolling();
        return;
      }

      this.controller.refreshContextUsage({ silent: true });
    }, contextUsagePollingIntervalMs);
  }

  private stopContextUsagePolling(): void {
    if (!this.contextUsagePollTimer) {
      return;
    }

    clearInterval(this.contextUsagePollTimer);
    this.contextUsagePollTimer = undefined;
  }

  private writeCurrentSessionFile(sessionFile: string | undefined): void {
    if (!this.workspaceState) {
      return;
    }

    void this.workspaceState.update(currentSessionFileStorageKey, sessionFile || undefined).then(undefined, () => undefined);
  }

}

function getPiPathSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tau').get<string>('piPath', 'pi').trim();
  return value && value !== 'pi' ? value : undefined;
}

function getOutputColorsSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('outputColors', true);
}

function getReadyScriptSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tau').get<string>('readyScript', '').trim();
  return value || undefined;
}

function getReadyScriptEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('readyScriptEnabled', true);
}

function resolveWorkspaceFileUri(filePath: string): vscode.Uri | undefined {
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(path.normalize(filePath));
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return undefined;
  }

  return vscode.Uri.file(path.resolve(workspaceFolder.uri.fsPath, filePath));
}

function readCurrentSessionFile(workspaceState: vscode.Memento | undefined): string | undefined {
  const value = workspaceState?.get<unknown>(currentSessionFileStorageKey);
  return typeof value === 'string' && value ? value : undefined;
}
