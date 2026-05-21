import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage
} from './sidebar/chatWebview';
import type { WebviewMessage, WebviewStateMessage } from './webviewProtocol/types';
import { type PiRpcClientFactory, type PiRpcClientLike } from './rpc/clientTypes';
import { PiRpcClient } from './rpc/client';
import type { PiRpcClientOptions } from './rpc/types';
import { PiSdkClient } from './sdk/piSdkClient';
import type { ExtensionUiRequestUi } from './extensionUi/requestHandler';
import { createSessionDiffStatsFileWatcher, readSessionDiffSnapshot, writeSessionDiffSnapshot } from './diff/sessionDiffStorage';
import { SessionDiffViewer } from './diff/sessionDiffViewer';
import { ShikiCodeRenderer } from './highlighting/shikiCodeRenderer';
import { TauSessionManager } from './sessions/tauSessionManager';
import { listPiSessions } from './sessions/piSessionList';
import { runReadyScript } from './readyScript';
import { createPromptContextFromEditor } from './prompt/editorContext';
import type { PiPromptContextInput, PiPromptTraceOriginLinkedCommit } from './prompt/types';
import { findCurrentPathGitCommit, findTraceLinkedGitCommit } from './origin/gitOriginContext';
import { traceOrigin, type TraceOriginInput, type TraceOriginMatch } from './origin/sessionOriginTracer';
import { readCachedSessionMeta, writeCachedSessionMeta } from './metadata/cache';

export const chatViewType = 'tau.chatView';
export type { PiRpcClientLike } from './rpc/clientTypes';

const currentSessionFileStorageKey = 'tau.currentSessionFile';
const welcomeDismissedStorageKey = 'tau.welcomeDismissed';
const tauSidebarFocusContextKey = 'tau.sidebarFocus';
const tauBusyContextKey = 'tau.busy';
const contextUsagePollingIntervalMs = 2000;
const sessionDiffStatsRefreshDelayMs = 250;

type ConfiguredPiClientDependencies = {
  extensionUi: ExtensionUiRequestUi;
  showNotification: (message: string, notifyType: string) => void;
};

function createConfiguredPiClient(
  options: PiRpcClientOptions,
  dependencies: ConfiguredPiClientDependencies
): PiRpcClientLike {
  if (getUseSdkInsteadOfRpcSetting()) {
    return new PiSdkClient({
      ...options,
      extensionUi: dependencies.extensionUi,
      showNotification: dependencies.showNotification
    });
  }

  return new PiRpcClient(options);
}

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private pendingModelPickerOpen = false;
  private pendingStreamingBehaviorToggle = false;
  private webviewReady = false;
  private readonly pendingToastMessages: Array<{ message: string; kind: 'success' | 'warning' | 'error' }> = [];
  private readonly controller: TauSessionManager;
  private readonly codeRenderer = new ShikiCodeRenderer();
  private readonly sessionDiffViewer = new SessionDiffViewer((message, notifyType) => this.showNotification(message, notifyType));
  private contextUsagePollTimer: NodeJS.Timeout | undefined;
  private sessionDiffStatsRefreshTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];
  private sidebarFocusContext: boolean | undefined;
  private busyContext: boolean | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiRpcClientFactory | undefined = undefined,
    private readonly workspaceState?: vscode.Memento,
    private readonly globalState?: vscode.Memento
  ) {
    const extensionUi: ExtensionUiRequestUi = {
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
    };
    const configuredCreateClient = createClient ?? ((options: PiRpcClientOptions) => createConfiguredPiClient(options, {
      extensionUi,
      showNotification: (message, notifyType) => this.showNotification(message, notifyType)
    }));

    this.controller = new TauSessionManager({
      createClient: configuredCreateClient,
      getCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      getPiPath: () => getPiPathSetting(),
      getOutputColors: () => getOutputColorsSetting(),
      getAnimationsEnabled: () => getAnimationsEnabledSetting(),
      getReadyScript: () => getReadyScriptSetting(),
      getReadyScriptEnabled: () => getReadyScriptEnabledSetting(),
      runReadyScript: (scriptPath, cwd) => {
        runReadyScript(scriptPath, cwd, {
          onError: (message) => this.showNotification(message, 'warning')
        });
      },
      postState: (message) => {
        this.setBusyContext(message.busy);
        void this.webviewView?.webview.postMessage(this.withProviderState(message));
      },
      showNotification: (message, notifyType) => this.showNotification(message, notifyType),
      showToast: (message, kind) => this.showToast(message, kind),
      writeClipboard: (text) => vscode.env.clipboard.writeText(text),
      extensionUi,
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

    this.setSidebarFocusContext(false);
    this.setBusyContext(false);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('tau.piPath') || event.affectsConfiguration('tau.useSdkInsteadOfRpc')) {
          this.controller.handleClientConfigurationChanged();
        }

        if (event.affectsConfiguration('tau.outputColors') || event.affectsConfiguration('tau.animationsEnabled')) {
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
    this.setSidebarFocusContext(false);
    this.setBusyContext(false);
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
    }, {
      welcomeDismissed: this.isWelcomeDismissed()
    });

    this.webviewDisposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView !== webviewView) {
          return;
        }

        this.webviewView = undefined;
        this.webviewReady = false;
        this.setSidebarFocusContext(false);
        this.stopContextUsagePolling();
        this.disposeWebviewDisposables();
      }),
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(parseWebviewMessage(message));
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.pendingInputFocus = true;
          this.postInputFocusSoon();
          this.refreshLiveMetadata();
          this.controller.refreshSessionDiffStats();
          this.startContextUsagePolling();
        } else {
          this.setSidebarFocusContext(false);
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

  public async showSessionTree(): Promise<void> {
    await this.controller.runLocalSlashCommand('tree');
    await this.focus();
  }

  public async openSessionDiff(): Promise<void> {
    await this.controller.handleWebviewMessage({ type: 'showCurrentChanges' });
  }

  public async compactSession(): Promise<void> {
    await this.controller.runLocalSlashCommand('compact');
    await this.focus();
  }

  public async exportSession(): Promise<void> {
    await this.controller.runLocalSlashCommand('export');
    await this.focus();
  }

  public async reloadPi(): Promise<void> {
    await this.controller.runLocalSlashCommand('reload');
    await this.focus();
  }

  public async copyLastResponse(): Promise<void> {
    await this.controller.runLocalSlashCommand('copy');
  }

  public async openModelPicker(): Promise<void> {
    await this.focus();
    this.pendingModelPickerOpen = true;
    this.postModelPickerOpenSoon();
  }

  public async stop(): Promise<void> {
    await this.controller.handleWebviewMessage({ type: 'abort' });
  }

  public async toggleSteerFollowUp(): Promise<void> {
    await this.focus();
    this.pendingStreamingBehaviorToggle = true;
    this.postStreamingBehaviorToggleSoon();
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

  public async traceOrigin(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.showNotification('Open a file or select code before tracing its Pi origin.', 'warning');
      return;
    }

    const context = createPromptContextFromEditor(editor);

    if (context.length === 0) {
      this.showNotification('No file context is available for the active editor.', 'warning');
      return;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const match = await traceOrigin(createTraceOriginInputs(context, editor.document), {
      cwd,
      currentSessionFile: readCurrentSessionFile(this.workspaceState)
    });

    if (!match) {
      const traceLinkedCommit = await findCurrentPathGitCommit({
        cwd,
        currentRelativePath: context[0].path
      });

      if (!traceLinkedCommit) {
        this.showNotification('No Pi session origin found for the selected code or file.', 'info');
        return;
      }

      this.controller.newSession();
      this.controller.addPromptContext(createGitOriginPromptContext(context, traceLinkedCommit));
      await this.focus();
      this.showToast('No agent session found. Opened a new session with Git context.', 'warning');
      return;
    }

    const traceLinkedCommit = await findTraceLinkedGitCommit({
      cwd,
      sessionCwd: match.sessionCwd,
      historicalPath: match.filePath,
      currentRelativePath: context[0]?.path ?? match.filePath,
      after: match.timestamp
    });

    await this.controller.handleWebviewMessage({ type: 'selectSession', sessionPath: match.sessionPath });
    this.controller.addPromptContext(createOriginPromptContext(context, match, traceLinkedCommit));
    await this.focus();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'focusChanged') {
      this.setSidebarFocusContext(Boolean(message.focused && this.webviewView?.visible));
      return;
    }

    if (message.type === 'openFile') {
      await this.openFileReference(message.path, message.line, message.column);
      return;
    }

    if (message.type === 'dismissWelcome') {
      await this.dismissWelcome();
      return;
    }

    if (message.type === 'ready') {
      this.webviewReady = true;
      this.codeRenderer.warmup();
      await this.controller.handleWebviewMessage(message);
      this.postInputFocusSoon();
      this.postModelPickerOpenSoon();
      this.postStreamingBehaviorToggleSoon();
      this.postPendingToasts();
      return;
    }

    if (message.type === 'highlightCode') {
      await this.handleCodeHighlightRequest(message.id, message.code, message.language, message.themeId);
      return;
    }

    await this.controller.handleWebviewMessage(message);
  }

  private withProviderState(message: WebviewStateMessage): WebviewStateMessage {
    return {
      ...message,
      welcomeDismissed: this.isWelcomeDismissed()
    };
  }

  private async dismissWelcome(): Promise<void> {
    await this.globalState?.update(welcomeDismissedStorageKey, true);
    this.controller.postState();
  }

  private isWelcomeDismissed(): boolean {
    return this.globalState?.get<boolean>(welcomeDismissedStorageKey) === true;
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

  private showToast(message: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    if (!this.webviewView || !this.webviewReady) {
      this.pendingToastMessages.push({ message, kind });
      return;
    }

    void this.webviewView.webview.postMessage({ type: 'toast', message, kind });
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

  private postModelPickerOpen(): void {
    if (!this.pendingModelPickerOpen || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingModelPickerOpen = false;
    void this.webviewView.webview.postMessage({ type: 'openModelPicker' });
  }

  private postModelPickerOpenSoon(): void {
    setTimeout(() => this.postModelPickerOpen(), 0);
  }

  private postStreamingBehaviorToggle(): void {
    if (!this.pendingStreamingBehaviorToggle || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingStreamingBehaviorToggle = false;
    void this.webviewView.webview.postMessage({ type: 'toggleStreamingBehavior' });
  }

  private postStreamingBehaviorToggleSoon(): void {
    setTimeout(() => this.postStreamingBehaviorToggle(), 0);
  }

  private postPendingToasts(): void {
    if (!this.webviewView || !this.webviewReady) {
      return;
    }

    for (const { message, kind } of this.pendingToastMessages.splice(0)) {
      void this.webviewView.webview.postMessage({ type: 'toast', message, kind });
    }
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

  private setSidebarFocusContext(focused: boolean): void {
    if (this.sidebarFocusContext === focused) {
      return;
    }

    this.sidebarFocusContext = focused;
    void vscode.commands.executeCommand('setContext', tauSidebarFocusContextKey, focused).then(undefined, () => undefined);
  }

  private setBusyContext(busy: boolean): void {
    if (this.busyContext === busy) {
      return;
    }

    this.busyContext = busy;
    void vscode.commands.executeCommand('setContext', tauBusyContextKey, busy).then(undefined, () => undefined);
  }

}

function createTraceOriginInputs(context: PiPromptContextInput[], document: vscode.TextDocument): TraceOriginInput[] {
  const absolutePath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;

  return context.map((entry) => ({
    kind: entry.kind,
    path: entry.path,
    absolutePath,
    text: entry.text
  }));
}

function createGitOriginPromptContext(
  context: PiPromptContextInput[],
  traceLinkedCommit: PiPromptTraceOriginLinkedCommit
): PiPromptContextInput[] {
  return context.map((entry) => ({
    ...entry,
    source: 'origin',
    label: `Origin: ${entry.label ?? getPathBasename(entry.path)}`,
    title: `${entry.title ?? entry.path}\nGit commit: ${traceLinkedCommit.shortSha} ${traceLinkedCommit.subject}`,
    traceOrigin: {
      currentRelativePath: entry.path,
      git: { traceLinkedCommit }
    }
  }));
}

function createOriginPromptContext(
  context: PiPromptContextInput[],
  match: TraceOriginMatch,
  traceLinkedCommit: PiPromptTraceOriginLinkedCommit | undefined
): PiPromptContextInput[] {
  return context.map((entry) => ({
    ...entry,
    source: 'origin',
    label: `Origin: ${entry.label ?? getPathBasename(entry.path)}`,
    title: `${entry.title ?? entry.path}\nTraced to Pi session: ${match.sessionPath}`,
    traceOrigin: {
      historicalPath: match.filePath,
      currentRelativePath: entry.path,
      origin: {
        ...(match.sessionId ? { sessionId: match.sessionId } : {}),
        toolName: match.toolName,
        ...(match.recordId ? { recordId: match.recordId } : {}),
        ...(match.timestamp ? { matchedAt: match.timestamp } : {}),
        ...(match.sessionEndedAt ? { sessionEndedAt: match.sessionEndedAt } : {})
      },
      ...(traceLinkedCommit ? { git: { traceLinkedCommit } } : {})
    }
  }));
}

function getPathBasename(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

function getPiPathSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tau').get<string>('piPath', 'pi').trim();
  return value && value !== 'pi' ? value : undefined;
}

export function getUseSdkInsteadOfRpcSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('useSdkInsteadOfRpc', false);
}

function getOutputColorsSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('outputColors', true);
}

function getAnimationsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('animationsEnabled', true);
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
