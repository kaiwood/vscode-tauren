import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage
} from './sidebar/chatWebview';
import type { WebviewCustomUiTheme, WebviewMessage, WebviewStateMessage } from './webviewProtocol/types';
import { type PiClientFactory, type PiClient } from './pi/clientTypes';
import type { PiClientOptions } from './pi/types';
import { PiSdkClient } from './sdk/piSdkClient';
import { ExtensionCustomUiHost, type CustomUiHostMessage } from './extensionUi/customUiHost';
import type { ExtensionUi } from './extensionUi/types';
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
import { getWorkspaceCwdState, isSafeWorkspaceCwd, getUnsafeCwdReason } from './workspace/cwdSafety';

export const chatViewType = 'tau.chatView';
export type { PiClient } from './pi/clientTypes';

const currentSessionFileStorageKey = 'tau.currentSessionFile';
const welcomeDismissedStorageKey = 'tau.welcomeDismissed';
const tauSidebarFocusContextKey = 'tau.sidebarFocus';
const tauBusyContextKey = 'tau.busy';
const contextUsagePollingIntervalMs = 2000;
const sessionDiffStatsRefreshDelayMs = 250;
const workspacePendingWarningDelayMs = 5000;

type ConfiguredPiClientDependencies = {
  extensionUi: ExtensionUi;
  showNotification: (message: string, notifyType: string) => void;
  getRejectEditWriteOutsideWorkspace: () => boolean;
};

function createConfiguredPiClient(
  options: PiClientOptions,
  dependencies: ConfiguredPiClientDependencies
): PiClient {
  return new PiSdkClient({
    ...options,
    extensionUi: dependencies.extensionUi,
    showNotification: dependencies.showNotification,
    rejectEditWriteOutsideWorkspace: dependencies.getRejectEditWriteOutsideWorkspace
  });
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
  private workspacePendingWarningTimer: NodeJS.Timeout | undefined;
  private lastWorkspaceCwd: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];
  private sidebarFocusContext: boolean | undefined;
  private busyContext: boolean | undefined;
  private readonly customUiHost: ExtensionCustomUiHost;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiClientFactory | undefined = undefined,
    private readonly workspaceState?: vscode.Memento,
    private readonly globalState?: vscode.Memento,
    private readonly workspaceCwdProvider: () => string | undefined = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  ) {
    this.customUiHost = new ExtensionCustomUiHost({
      isAvailable: () => Boolean(this.webviewReady && this.webviewView),
      postMessage: (message) => this.postCustomUiMessage(message),
      getOutputColors: () => getOutputColorsSetting(),
      notify: (message, notifyType) => this.showNotification(message, notifyType)
    });

    const extensionUi: ExtensionUi = {
      notify: (message, notifyType) => this.showNotification(message, notifyType),
      select: (title, options) => vscode.window.showQuickPick(options, {
        title,
        placeHolder: title
      }),
      confirm: (title, message) => this.showConfirmation(title, message),
      input: (title, placeholder) => vscode.window.showInputBox({
        title,
        placeHolder: placeholder
      }),
      custom: (factory, options) => this.customUiHost.custom(factory, options)
    };
    const configuredCreateClient = createClient ?? ((options: PiClientOptions) => createConfiguredPiClient(options, {
      extensionUi,
      showNotification: (message, notifyType) => this.showNotification(message, notifyType),
      getRejectEditWriteOutsideWorkspace: () => getRejectEditWriteOutsideWorkspaceSetting()
    }));
    const initialSessionFile = this.sanitizeInitialSessionFile(readCurrentSessionFile(this.workspaceState));

    this.controller = new TauSessionManager({
      createClient: configuredCreateClient,
      getCwd: () => this.workspaceCwdProvider(),
      getOutputColors: () => getOutputColorsSetting(),
      getAnimationsEnabled: () => getAnimationsEnabledSetting(),
      getCustomUiTheme: () => getCustomUiThemeSetting(),
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
      initialSessionFile,
      onSessionMetaChange: (metadata) => writeCachedSessionMeta(this.workspaceState, metadata),
      onSessionFileChange: (sessionFile) => this.writeCurrentSessionFile(sessionFile),
      loadSessionDiffSnapshot: (sessionFile) => readSessionDiffSnapshot(this.workspaceState, sessionFile),
      saveSessionDiffSnapshot: (sessionFile, snapshot) => writeSessionDiffSnapshot(this.workspaceState, sessionFile, snapshot),
      listSessions: (cwd, currentSessionFile) => listPiSessions({ cwd, currentSessionFile }),
      deleteSession: (sessionPath, displayName) => this.deleteSession(sessionPath, displayName),
      showSessionChanges: (sessionPath, displayName) => this.sessionDiffViewer.showSessionChanges(sessionPath, displayName)
    });

    const initialWorkspaceState = getWorkspaceCwdState(this.workspaceCwdProvider());
    this.lastWorkspaceCwd = initialWorkspaceState.status === 'ready' ? initialWorkspaceState.cwd : undefined;

    this.setSidebarFocusContext(false);
    this.setBusyContext(false);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('tau.outputColors')
          || event.affectsConfiguration('tau.animationsEnabled')
          || event.affectsConfiguration('tau.customUiTheme')
        ) {
          this.controller.postState();
        }

        if (event.affectsConfiguration('editor.tokenColorCustomizations') || event.affectsConfiguration('editor.semanticTokenColorCustomizations')) {
          this.resetCodeRenderer();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.resetCodeRenderer()),
      createSessionDiffStatsFileWatcher(() => this.scheduleSessionDiffStatsRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.handleWorkspaceFoldersChanged())
    );
  }

  public dispose(): void {
    this.setSidebarFocusContext(false);
    this.setBusyContext(false);
    this.stopContextUsagePolling();
    this.stopSessionDiffStatsRefreshTimer();
    this.stopWorkspacePendingWarningTimer();
    this.disposeWebviewDisposables();

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }

    this.customUiHost.dispose();
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

        this.customUiHost.cancelActive();
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

  public async toggleSessionList(): Promise<void> {
    this.controller.toggleSessionList();
    await this.focus();
  }

  public async toggleSessionTree(): Promise<void> {
    this.controller.toggleSessionTree();
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

    if (message.type === 'customUiInput') {
      this.customUiHost.handleInput(message.id, message.data);
      return;
    }

    if (message.type === 'customUiCancel') {
      this.customUiHost.cancel(message.id);
      return;
    }

    if (message.type === 'customUiDimensions') {
      this.customUiHost.updateDimensions(message.id, message.columns, message.rows);
      return;
    }

    await this.controller.handleWebviewMessage(message);
  }

  private withProviderState(message: WebviewStateMessage): WebviewStateMessage {
    return {
      ...message,
      customUiTheme: getCustomUiThemeSetting(),
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

  private postCustomUiMessage(message: CustomUiHostMessage): boolean {
    if (!this.webviewReady || !this.webviewView) {
      return false;
    }

    void this.webviewView.webview.postMessage(message);
    return true;
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
    this.customUiHost.cancelActive();

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
    const workspaceState = getWorkspaceCwdState(this.workspaceCwdProvider());

    if (workspaceState.status === 'pending') {
      this.controller.noteWorkspacePending();
      this.startWorkspacePendingWarningTimer();
      return;
    }

    if (workspaceState.status === 'ready') {
      this.lastWorkspaceCwd ??= workspaceState.cwd;
      this.stopWorkspacePendingWarningTimer();
    }

    this.controller.refreshSessionMeta({ startClient: true });
  }

  private handleWorkspaceFoldersChanged(): void {
    this.scheduleSessionDiffStatsRefresh();
    const workspaceState = getWorkspaceCwdState(this.workspaceCwdProvider());

    if (workspaceState.status === 'pending') {
      this.controller.noteWorkspacePending();
      this.startWorkspacePendingWarningTimer();
      return;
    }

    this.stopWorkspacePendingWarningTimer();

    if (workspaceState.status === 'unsafe') {
      this.lastWorkspaceCwd = undefined;
      this.controller.refreshSessionMeta({ startClient: true, force: true });
      return;
    }

    const previousCwd = this.lastWorkspaceCwd;
    const persistedSessionFile = readCurrentSessionFile(this.workspaceState);
    const sessionFile = this.sanitizeInitialSessionFile(persistedSessionFile);
    this.lastWorkspaceCwd = workspaceState.cwd;

    if (!previousCwd) {
      if (persistedSessionFile && !sessionFile) {
        this.controller.restartForWorkspaceChange(workspaceState.cwd, undefined);
      } else {
        this.controller.noteWorkspaceAvailable(workspaceState.cwd);
      }
      return;
    }

    if (previousCwd !== workspaceState.cwd) {
      this.controller.restartForWorkspaceChange(workspaceState.cwd, sessionFile);
    }
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

  private startWorkspacePendingWarningTimer(): void {
    if (this.workspacePendingWarningTimer) {
      return;
    }

    this.workspacePendingWarningTimer = setTimeout(() => {
      this.workspacePendingWarningTimer = undefined;

      if (getWorkspaceCwdState(this.workspaceCwdProvider()).status === 'pending') {
        this.controller.noteWorkspacePendingWarning();
      }
    }, workspacePendingWarningDelayMs);
  }

  private stopWorkspacePendingWarningTimer(): void {
    if (!this.workspacePendingWarningTimer) {
      return;
    }

    clearTimeout(this.workspacePendingWarningTimer);
    this.workspacePendingWarningTimer = undefined;
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

  private sanitizeInitialSessionFile(sessionFile: string | undefined): string | undefined {
    if (!sessionFile) {
      return undefined;
    }

    const workspaceCwd = this.workspaceCwdProvider();

    if (!isSafeWorkspaceCwd(workspaceCwd)) {
      return sessionFile;
    }

    const sessionCwd = readSessionHeaderCwd(sessionFile);
    const unsafeReason = getUnsafeCwdReason(sessionCwd);

    if (!sessionCwd || !unsafeReason) {
      return sessionFile;
    }

    const message = `Tau ignored persisted Pi session ${sessionFile} because ${unsafeReason}. Starting a new session in ${workspaceCwd}.`;
    void this.workspaceState?.update(currentSessionFileStorageKey, undefined).then(undefined, () => undefined);
    this.showNotification(message, 'warning');
    this.pendingToastMessages.push({ message, kind: 'warning' });
    return undefined;
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

function getOutputColorsSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('outputColors', true);
}

function getAnimationsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('animationsEnabled', true);
}

function getCustomUiThemeSetting(): WebviewCustomUiTheme {
  const value = vscode.workspace.getConfiguration('tau').get<string>('customUiTheme', 'default');
  return value === 'modern' || value === 'crt' || value === 'amber' || value === 'matrix' ? value : 'default';
}

function getReadyScriptSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tau').get<string>('readyScript', '').trim();
  return value || undefined;
}

function getReadyScriptEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('readyScriptEnabled', true);
}

function getRejectEditWriteOutsideWorkspaceSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('rejectEditWriteOutsideWorkspace', false);
}

function readSessionHeaderCwd(sessionFile: string): string | undefined {
  let fd: number | undefined;

  try {
    fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0]?.trim();

    if (!firstLine) {
      return undefined;
    }

    const record = JSON.parse(firstLine) as unknown;

    if (isRecord(record) && record.type === 'session' && typeof record.cwd === 'string') {
      return record.cwd;
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures for best-effort session header inspection.
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
