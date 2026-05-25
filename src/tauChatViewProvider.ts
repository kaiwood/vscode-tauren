import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage
} from './sidebar/chatWebview';
import { parseWebviewCustomUiTheme } from './webviewProtocol/values';
import type { SettingValue, TauSettingId } from './settings/settingsRegistry';
import type { WebviewCustomUiTheme, WebviewMessage, WebviewStateMessage } from './webviewProtocol/types';
import { type PiClientFactory, type PiClient } from './pi/clientTypes';
import type { PiClientOptions } from './pi/types';
import { PiSdkClient } from './sdk/piSdkClient';
import type { CustomUiHostMessage } from './extensionUi/customUiHost';
import type { ExtensionEditorHostMessage, ExtensionUi } from './extensionUi/types';
import { createSessionDiffStatsFileWatcher, readSessionDiffSnapshot, writeSessionDiffSnapshot } from './diff/sessionDiffStorage';
import { SessionDiffViewer } from './diff/sessionDiffViewer';
import { ShikiCodeRenderer } from './highlighting/shikiCodeRenderer';
import { TauSessionManager } from './sessions/tauSessionManager';
import type { PiPromptImageAttachment } from './tauChatController';
import { listPiSessions } from './sessions/piSessionList';
import { runReadyScript } from './readyScript';
import { createPromptContextFromEditor } from './prompt/editorContext';
import {
  getPromptImageTooLargeMessage,
  getSupportedPromptImageMimeType,
  getUnsupportedPromptImageMessage,
  maxPromptImageBytes,
  supportedPromptImageExtensions
} from './prompt/imageAttachments';
import type { PiPromptContextInput, PiPromptTraceOriginLinkedCommit } from './prompt/types';
import { findCurrentPathGitCommit, findTraceLinkedGitCommit } from './origin/gitOriginContext';
import { traceOrigin, type TraceOriginInput, type TraceOriginMatch } from './origin/sessionOriginTracer';
import { readCachedSessionMeta, writeCachedSessionMeta } from './metadata/cache';
import { readSessionJsonlHeaderCwdSync } from './pi/sessionJsonl';
import { getPiStartupCwdState, isSafeWorkspaceCwd, getUnsafeCwdReason } from './workspace/cwdSafety';

export const tauChatViewType = 'tau.chatView';
export type { PiClient } from './pi/clientTypes';

const currentSessionFileStorageKey = 'tau.currentSessionFile';
const welcomeDismissedStorageKey = 'tau.welcomeDismissed';
const tauSidebarFocusContextKey = 'tau.sidebarFocus';
const tauBusyContextKey = 'tau.busy';
const contextUsagePollingIntervalMs = 2000;
const sessionDiffStatsRefreshDelayMs = 250;

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
    extensionUi: options.extensionUi ?? dependencies.extensionUi,
    showNotification: dependencies.showNotification,
    rejectEditWriteOutsideWorkspace: dependencies.getRejectEditWriteOutsideWorkspace
  });
}

export class TauChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private pendingModelPickerOpen = false;
  private pendingStreamingBehaviorToggle = false;
  private pendingHelpToggle = false;
  private pendingSessionNameEditStart = false;
  private webviewReady = false;
  private readonly pendingToastMessages: Array<{ message: string; kind: 'success' | 'warning' | 'error' }> = [];
  private readonly controller: TauSessionManager;
  private readonly codeRenderer = new ShikiCodeRenderer();
  private readonly sessionDiffViewer = new SessionDiffViewer((message, notifyType) => this.showNotification(message, notifyType));
  private contextUsagePollTimer: NodeJS.Timeout | undefined;
  private sessionDiffStatsRefreshTimer: NodeJS.Timeout | undefined;
  private lastWorkspaceCwd: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];
  private sidebarFocusContext: boolean | undefined;
  private busyContext: boolean | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiClientFactory | undefined = undefined,
    private readonly workspaceState?: vscode.Memento,
    private readonly globalState?: vscode.Memento,
    private readonly workspaceCwdProvider: () => string | undefined = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    private readonly devRenderInstrumentation = false
  ) {
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
      })
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
      getRejectEditWriteOutsideWorkspace: () => getRejectEditWriteOutsideWorkspaceSetting(),
      getTauSettingValues: () => getTauSettingValues(this.globalState),
      updateTauSetting: (id, value) => this.updateTauSetting(id, value),
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
      inputSecret: (title, placeholder, prompt) => vscode.window.showInputBox({
        title,
        placeHolder: placeholder,
        prompt,
        password: true,
        ignoreFocusOut: true
      }),
      openExternalUrl: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      writeClipboard: (text) => vscode.env.clipboard.writeText(text),
      extensionUi,
      customUi: {
        isAvailable: () => Boolean(this.webviewReady && this.webviewView),
        postMessage: (message) => this.postCustomUiMessage(message),
        getOutputColors: () => getOutputColorsSetting()
      },
      extensionEditor: {
        isAvailable: () => Boolean(this.webviewReady && this.webviewView),
        postMessage: (message) => this.postExtensionEditorMessage(message)
      },
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

    const initialWorkspaceState = getPiStartupCwdState(this.workspaceCwdProvider(), getRejectEditWriteOutsideWorkspaceSetting());
    this.lastWorkspaceCwd = initialWorkspaceState.status === 'ready' ? initialWorkspaceState.cwd : undefined;

    this.setSidebarFocusContext(false);
    this.setBusyContext(false);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const affectsRemoteImages = event.affectsConfiguration('tau.blockHttpsImages');

        if (affectsRemoteImages) {
          this.refreshWebviewHtml();
        }

        const affectsWelcome = event.affectsConfiguration('tau.showWelcome');
        const affectsExtensionSettings = affectsAnyTauExtensionSetting(event);

        if (affectsExtensionSettings) {
          this.controller.refreshTauSettingValues();
        }

        if (affectsWelcome && hasConfiguredShowWelcomeSetting()) {
          void this.globalState?.update(welcomeDismissedStorageKey, undefined).then(undefined, () => undefined);
        }

        if (
          event.affectsConfiguration('tau.outputColors')
          || event.affectsConfiguration('tau.animationsEnabled')
          || affectsWelcome
          || event.affectsConfiguration('tau.customUiTheme')
          || affectsRemoteImages
          || affectsExtensionSettings
        ) {
          this.controller.postState();
        }

        if (event.affectsConfiguration('tau.rejectEditWriteOutsideWorkspace')) {
          this.handleWorkspaceFoldersChanged();
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
      localResourceRoots: getWebviewLocalResourceRoots(this.extensionUri)
    };

    this.renderWebviewHtml(webviewView);

    this.webviewDisposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView !== webviewView) {
          return;
        }

        this.controller.setCustomUiViewAttached(false);
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

  private refreshWebviewHtml(): void {
    if (!this.webviewView) {
      return;
    }

    this.webviewReady = false;
    this.controller.setCustomUiViewAttached(false);
    this.renderWebviewHtml(this.webviewView);
  }

  private renderWebviewHtml(webviewView: vscode.WebviewView): void {
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
      webviewScriptUri: webviewScriptUri.toString(),
      cspSource: webviewView.webview.cspSource
    }, {
      welcomeDismissed: this.isWelcomeDismissed(),
      devRenderInstrumentation: this.devRenderInstrumentation,
      allowRemoteImages: getAllowRemoteImagesSetting()
    });
  }

  public async focus(): Promise<void> {
    this.pendingInputFocus = true;

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${tauChatViewType}.focus`);
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
    await this.toggleSessionList();
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

  public async renameSession(): Promise<void> {
    this.controller.showChat();
    await this.revealView();
    this.pendingSessionNameEditStart = true;
    this.postSessionNameEditStartSoon();
  }

  public async compactSession(): Promise<void> {
    await this.controller.runLocalSlashCommand('compact');
    await this.focus();
  }

  public async exportSession(): Promise<void> {
    await this.controller.runLocalSlashCommand('export');
    await this.focus();
  }

  public async moveSessionToTrash(): Promise<void> {
    await this.controller.moveCurrentSessionToTrash();
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

  public async toggleSettings(): Promise<void> {
    this.controller.toggleSettings();

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${tauChatViewType}.focus`);
    }

    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
  }

  public async toggleHelp(): Promise<void> {
    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${tauChatViewType}.focus`);
    }

    this.pendingHelpToggle = true;
    this.postHelpToggleSoon();
    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
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
      this.showNotification('Open a file or select code before adding prompt context.', 'warning');
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

  private async selectPromptImages(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      title: 'Attach images to next Tau prompt',
      filters: {
        Images: supportedPromptImageExtensions,
        'All files': ['*']
      }
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const attachments: PiPromptImageAttachment[] = [];
    const rejected: string[] = [];

    for (const uri of uris) {
      const result = await this.createPromptImageAttachment(uri);

      if (typeof result === 'string') {
        rejected.push(result);
      } else {
        attachments.push(result);
      }
    }

    if (attachments.length > 0) {
      this.controller.addPromptImages(attachments);
      await this.focus();
      this.showToast(`${attachments.length === 1 ? 'Image' : `${attachments.length} images`} attached.`, 'success');
    }

    for (const message of rejected) {
      this.showToast(message, 'warning');
    }
  }

  private async createPromptImageAttachment(uri: vscode.Uri): Promise<PiPromptImageAttachment | string> {
    const mimeType = getSupportedPromptImageMimeType(uri.fsPath);
    const label = getPathBasename(uri.fsPath);

    if (!mimeType) {
      return getUnsupportedPromptImageMessage(label);
    }

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return `Cannot read attachment: ${label}.`;
    }

    if (stat.type !== vscode.FileType.File) {
      return `Unsupported attachment: ${label} is not a file.`;
    }

    if (stat.size > maxPromptImageBytes) {
      return getPromptImageTooLargeMessage(label);
    }

    let data: Uint8Array;
    try {
      data = await vscode.workspace.fs.readFile(uri);
    } catch {
      return `Cannot read attachment: ${label}.`;
    }

    return {
      id: createPromptImageId(),
      type: 'image',
      data: Buffer.from(data).toString('base64'),
      mimeType,
      label,
      title: uri.fsPath,
      sizeBytes: stat.size
    };
  }

  private async dropPromptImages(message: Extract<WebviewMessage, { type: 'dropPromptImages' }>): Promise<void> {
    if (message.rejections && message.rejections.length > 0) {
      for (const rejection of message.rejections) {
        this.showToast(rejection, 'warning');
      }

      return;
    }

    const attachments: PiPromptImageAttachment[] = [];
    const rejected: string[] = [];

    for (const droppedFile of message.files) {
      const result = this.createPromptImageAttachmentFromDroppedFile(droppedFile);

      if (typeof result === 'string') {
        rejected.push(result);
      } else {
        attachments.push(result);
      }
    }

    for (const uriText of message.uris) {
      const uri = parseDroppedPromptImageUri(uriText);

      if (!uri) {
        rejected.push('Cannot read dropped attachment.');
        continue;
      }

      const result = await this.createPromptImageAttachment(uri);

      if (typeof result === 'string') {
        rejected.push(result);
      } else {
        attachments.push(result);
      }
    }

    if (rejected.length > 0) {
      for (const rejection of rejected) {
        this.showToast(rejection, 'warning');
      }

      return;
    }

    if (attachments.length === 0) {
      this.showToast('No image files were dropped.', 'warning');
      return;
    }

    this.controller.addPromptImages(attachments);
    await this.focus();
    this.showToast(`${attachments.length === 1 ? 'Image' : `${attachments.length} images`} attached.`, 'success');
  }

  private createPromptImageAttachmentFromDroppedFile(file: Extract<WebviewMessage, { type: 'dropPromptImages' }>['files'][number]): PiPromptImageAttachment | string {
    const label = file.label;
    const mimeType = getSupportedPromptImageMimeType(label);

    if (!mimeType) {
      return getUnsupportedPromptImageMessage(label);
    }

    if (file.sizeBytes > maxPromptImageBytes) {
      return getPromptImageTooLargeMessage(label);
    }

    return {
      id: createPromptImageId(),
      type: 'image',
      data: file.data,
      mimeType,
      label,
      title: file.title || label,
      sizeBytes: file.sizeBytes
    };
  }

  public async sendSelectionToComposer(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.showNotification('Open a file before sending code to the Tau composer.', 'warning');
      return;
    }

    const text = getEditorLineTextForComposer(editor);
    clearEditorSelection(editor);
    this.controller.appendTextToComposer(text);
    await this.focus();
  }

  public async traceOrigin(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.showNotification('Open a file or select code before tracing its Tau origin.', 'warning');
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
        this.showNotification('No Tau session origin found for the selected code or file.', 'info');
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

    if (message.type === 'selectPromptImages') {
      await this.selectPromptImages();
      return;
    }

    if (message.type === 'dropPromptImages') {
      await this.dropPromptImages(message);
      return;
    }

    if (message.type === 'ready') {
      this.webviewReady = true;
      this.controller.setCustomUiViewAttached(true);
      this.codeRenderer.warmup();
      await this.controller.handleWebviewMessage(message);
      this.postInputFocusSoon();
      this.postModelPickerOpenSoon();
      this.postStreamingBehaviorToggleSoon();
      this.postHelpToggleSoon();
      this.postSessionNameEditStartSoon();
      this.postPendingToasts();
      return;
    }

    if (message.type === 'highlightCode') {
      await this.handleCodeHighlightRequest(message.id, message.code, message.language, message.themeId);
      return;
    }

    if (message.type === 'resolveLocalImage') {
      await this.handleLocalImageRequest(message.id, message.src);
      return;
    }

    await this.controller.handleWebviewMessage(message);
  }

  private withProviderState(message: WebviewStateMessage): WebviewStateMessage {
    return {
      ...message,
      customUiTheme: getCustomUiThemeSetting(),
      allowRemoteImages: getAllowRemoteImagesSetting(),
      welcomeDismissed: this.isWelcomeDismissed()
    };
  }

  private async dismissWelcome(): Promise<void> {
    await this.globalState?.update(welcomeDismissedStorageKey, true);
    this.controller.postState();

    try {
      await updateTauSetting('tau.showWelcome', false);
      await this.globalState?.update(welcomeDismissedStorageKey, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showNotification(`Failed to save Welcome message setting: ${message}`, 'warning');
    }
  }

  private async updateTauSetting(id: TauSettingId, value: SettingValue): Promise<void> {
    await updateTauSetting(id, value);

    if (id === 'tau.showWelcome' && typeof value === 'boolean') {
      await this.globalState?.update(welcomeDismissedStorageKey, undefined);
    }
  }

  private isWelcomeDismissed(): boolean {
    return !getShowWelcomeSetting(this.globalState);
  }

  private postCustomUiMessage(message: CustomUiHostMessage): boolean {
    if (!this.webviewReady || !this.webviewView) {
      return false;
    }

    void this.webviewView.webview.postMessage(message);
    return true;
  }

  private postExtensionEditorMessage(message: ExtensionEditorHostMessage): boolean {
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

  private async handleLocalImageRequest(id: string, src: string): Promise<void> {
    const webview = this.webviewView?.webview;

    if (!webview) {
      return;
    }

    const uri = await this.resolveLocalImageUri(src);

    void webview.postMessage({
      type: 'resolveLocalImageResult',
      id,
      ...(uri ? { uri: webview.asWebviewUri(uri).toString() } : { error: 'Image is outside the workspace or is not a supported local raster image.' })
    });
  }

  private async resolveLocalImageUri(src: string): Promise<vscode.Uri | undefined> {
    const uri = resolveWorkspaceImageUri(src);

    if (!uri || !isSupportedLocalImagePath(uri.fsPath) || !isUriInsideWorkspace(uri)) {
      return undefined;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.type === vscode.FileType.File ? uri : undefined;
    } catch {
      return undefined;
    }
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
    this.controller.setCustomUiViewAttached(false);

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
    if (getConfirmSessionDeletionSetting()) {
      const moveToTrash = 'Move to Trash';
      const selected = await vscode.window.showWarningMessage(
        `Move "${displayName}" to Trash?`,
        { modal: true, detail: sessionPath },
        moveToTrash
      );

      if (selected !== moveToTrash) {
        return false;
      }
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

  private async revealView(): Promise<void> {
    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${tauChatViewType}.focus`);
    }

    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
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

  private postHelpToggle(): void {
    if (!this.pendingHelpToggle || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingHelpToggle = false;
    void this.webviewView.webview.postMessage({ type: 'toggleHelpOverlay' });
  }

  private postHelpToggleSoon(): void {
    queueMicrotask(() => this.postHelpToggle());
  }

  private postSessionNameEditStart(): void {
    if (!this.pendingSessionNameEditStart || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingSessionNameEditStart = false;
    void this.webviewView.webview.postMessage({ type: 'startSessionNameEdit' });
  }

  private postSessionNameEditStartSoon(): void {
    if (!this.pendingSessionNameEditStart) {
      return;
    }

    setTimeout(() => this.postSessionNameEditStart(), 0);
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
    const startupState = getPiStartupCwdState(this.workspaceCwdProvider(), getRejectEditWriteOutsideWorkspaceSetting());

    if (startupState.status === 'ready') {
      this.lastWorkspaceCwd ??= startupState.cwd;
    }

    this.controller.refreshSessionMeta({ startClient: true });
  }

  private handleWorkspaceFoldersChanged(): void {
    this.scheduleSessionDiffStatsRefresh();
    if (this.webviewView) {
      this.webviewView.webview.options = {
        ...this.webviewView.webview.options,
        localResourceRoots: getWebviewLocalResourceRoots(this.extensionUri)
      };
    }

    const startupState = getPiStartupCwdState(this.workspaceCwdProvider(), getRejectEditWriteOutsideWorkspaceSetting());

    if (startupState.status === 'blocked') {
      this.lastWorkspaceCwd = undefined;
      this.controller.refreshSessionMeta({ startClient: true, force: true });
      return;
    }

    const previousCwd = this.lastWorkspaceCwd;
    const persistedSessionFile = readCurrentSessionFile(this.workspaceState);
    const sessionFile = this.sanitizeInitialSessionFile(persistedSessionFile);
    this.lastWorkspaceCwd = startupState.cwd;

    if (!previousCwd) {
      if (persistedSessionFile && !sessionFile) {
        this.controller.restartForWorkspaceChange(startupState.cwd, undefined);
      } else {
        this.controller.noteWorkspaceAvailable(startupState.cwd);
      }
      return;
    }

    if (previousCwd !== startupState.cwd) {
      this.controller.restartForWorkspaceChange(startupState.cwd, sessionFile);
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

    const sessionCwd = readSessionJsonlHeaderCwdSync(sessionFile);
    const unsafeReason = getUnsafeCwdReason(sessionCwd);

    if (!sessionCwd || !unsafeReason) {
      return sessionFile;
    }

    const message = `Tau ignored persisted session ${sessionFile} because ${unsafeReason}. Starting a new session in ${workspaceCwd}.`;
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

function getEditorLineTextForComposer(editor: vscode.TextEditor): string {
  const selectedLineRanges = editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => getSelectedLineIndexes(selection));

  if (selectedLineRanges.length === 0) {
    return editor.document.lineAt(editor.selection.active.line).text;
  }

  return mergeLineRanges(selectedLineRanges)
    .map((range) => getDocumentLineRangeText(editor.document, range))
    .join('\n');
}

function getSelectedLineIndexes(selection: vscode.Selection): { startLine: number; endLine: number } {
  let endLine = selection.end.line;

  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    endLine -= 1;
  }

  return {
    startLine: selection.start.line,
    endLine: Math.max(selection.start.line, endLine)
  };
}

function mergeLineRanges(ranges: Array<{ startLine: number; endLine: number }>): Array<{ startLine: number; endLine: number }> {
  const sorted = ranges.slice().sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  const merged: Array<{ startLine: number; endLine: number }> = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
      continue;
    }

    merged.push({ ...range });
  }

  return merged;
}

function getDocumentLineRangeText(document: vscode.TextDocument, range: { startLine: number; endLine: number }): string {
  const lastLine = document.lineAt(range.endLine);
  return document.getText(new vscode.Range(range.startLine, 0, range.endLine, lastLine.range.end.character));
}

function clearEditorSelection(editor: vscode.TextEditor): void {
  const active = editor.selection.active;
  editor.selections = [new vscode.Selection(active, active)];
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
    title: `${entry.title ?? entry.path}\nTraced to Tau session: ${match.sessionPath}`,
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

function getShowWelcomeSetting(globalState?: vscode.Memento): boolean {
  if (hasConfiguredShowWelcomeSetting()) {
    return vscode.workspace.getConfiguration('tau').get<boolean>('showWelcome', true);
  }

  return globalState?.get<boolean>(welcomeDismissedStorageKey) === true ? false : true;
}

function hasConfiguredShowWelcomeSetting(): boolean {
  const inspected = vscode.workspace.getConfiguration('tau').inspect<boolean>('showWelcome');

  return [
    inspected?.globalValue,
    inspected?.workspaceValue,
    inspected?.workspaceFolderValue,
    inspected?.globalLanguageValue,
    inspected?.workspaceLanguageValue,
    inspected?.workspaceFolderLanguageValue
  ].some((value) => typeof value === 'boolean');
}

function getConfirmSessionDeletionSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('confirmSessionDeletion', true);
}

function getCustomUiThemeSetting(): WebviewCustomUiTheme {
  const value = vscode.workspace.getConfiguration('tau').get<string>('customUiTheme', 'default');
  return parseWebviewCustomUiTheme(value);
}

function getBlockHttpsImagesSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('blockHttpsImages', true);
}

function getAllowRemoteImagesSetting(): boolean {
  return !getBlockHttpsImagesSetting();
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

function affectsAnyTauExtensionSetting(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('tau.extensions.aboveWidgetsEnabled')
    || event.affectsConfiguration('tau.extensions.belowWidgetsEnabled')
    || event.affectsConfiguration('tau.extensions.statusBarEnabled')
    || event.affectsConfiguration('tau.extensions.backgroundColorsEnabled')
    || event.affectsConfiguration('tau.extensions.monospaceFontEnabled');
}

function getExtensionAboveWidgetsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('extensions.aboveWidgetsEnabled', true);
}

function getExtensionBelowWidgetsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('extensions.belowWidgetsEnabled', true);
}

function getExtensionStatusBarEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('extensions.statusBarEnabled', true);
}

function getExtensionBackgroundColorsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('extensions.backgroundColorsEnabled', true);
}

function getExtensionMonospaceFontEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tau').get<boolean>('extensions.monospaceFontEnabled', true);
}

function getTauSettingValues(globalState?: vscode.Memento): Partial<Record<TauSettingId, SettingValue>> {
  return {
    'tau.outputColors': getOutputColorsSetting(),
    'tau.animationsEnabled': getAnimationsEnabledSetting(),
    'tau.showWelcome': getShowWelcomeSetting(globalState),
    'tau.customUiTheme': getCustomUiThemeSetting(),
    'tau.extensions.aboveWidgetsEnabled': getExtensionAboveWidgetsEnabledSetting(),
    'tau.extensions.belowWidgetsEnabled': getExtensionBelowWidgetsEnabledSetting(),
    'tau.extensions.statusBarEnabled': getExtensionStatusBarEnabledSetting(),
    'tau.extensions.backgroundColorsEnabled': getExtensionBackgroundColorsEnabledSetting(),
    'tau.extensions.monospaceFontEnabled': getExtensionMonospaceFontEnabledSetting(),
    'tau.blockHttpsImages': getBlockHttpsImagesSetting(),
    'tau.confirmSessionDeletion': getConfirmSessionDeletionSetting(),
    'tau.rejectEditWriteOutsideWorkspace': getRejectEditWriteOutsideWorkspaceSetting(),
    'tau.readyScript': getReadyScriptSetting() ?? '',
    'tau.readyScriptEnabled': getReadyScriptEnabledSetting()
  };
}

async function updateTauSetting(id: TauSettingId, value: SettingValue): Promise<void> {
  const configKey = id.slice('tau.'.length);

  if (Array.isArray(value)) {
    throw new Error(`Unsupported Tau setting value for ${id}.`);
  }

  await vscode.workspace.getConfiguration('tau').update(configKey, value, vscode.ConfigurationTarget.Global);
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

function getWebviewLocalResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [
    extensionUri,
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)
  ];
}

function resolveWorkspaceImageUri(src: string): vscode.Uri | undefined {
  const decodedPath = decodeImagePath(src);

  if (!decodedPath) {
    return undefined;
  }

  if (decodedPath.startsWith('file:')) {
    try {
      const uri = vscode.Uri.parse(decodedPath);
      return resolveAbsoluteWorkspaceUri(uri.fsPath) ?? uri;
    } catch {
      return undefined;
    }
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decodedPath)) {
    return undefined;
  }

  if (path.isAbsolute(decodedPath)) {
    return resolveAbsoluteWorkspaceUri(decodedPath);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return undefined;
  }

  return resolveRelativeWorkspaceUri(workspaceFolder, decodedPath);
}

function decodeImagePath(src: string): string | undefined {
  const withoutFragment = src.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? '';

  if (!withoutFragment) {
    return undefined;
  }

  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function resolveAbsoluteWorkspaceUri(filePath: string): vscode.Uri | undefined {
  const normalizedPath = path.normalize(filePath);
  const workspaceFolder = (vscode.workspace.workspaceFolders ?? []).find((folder) => isPathInsidePath(normalizedPath, folder.uri.fsPath));

  if (!workspaceFolder) {
    return undefined;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, normalizedPath);
  return resolveRelativeWorkspaceUri(workspaceFolder, relativePath);
}

function resolveRelativeWorkspaceUri(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): vscode.Uri {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter((part) => part.length > 0);
  return vscode.Uri.joinPath(workspaceFolder.uri, ...parts);
}

function isSupportedLocalImagePath(filePath: string): boolean {
  return /\.(?:png|jpe?g|gif|webp)$/i.test(filePath);
}

function createPromptImageId(): string {
  return `prompt-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseDroppedPromptImageUri(value: string): vscode.Uri | undefined {
  try {
    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
      return vscode.Uri.file(value);
    }

    const uri = vscode.Uri.parse(value, true);
    return uri.scheme === 'file' || uri.scheme === 'vscode-remote' ? uri : undefined;
  } catch {
    return undefined;
  }
}

function isUriInsideWorkspace(uri: vscode.Uri): boolean {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  if (workspaceFolder) {
    return true;
  }

  return (vscode.workspace.workspaceFolders ?? []).some((folder) => isPathInsidePath(uri.fsPath, folder.uri.fsPath));
}

function isPathInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function readCurrentSessionFile(workspaceState: vscode.Memento | undefined): string | undefined {
  const value = workspaceState?.get<unknown>(currentSessionFileStorageKey);
  return typeof value === 'string' && value ? value : undefined;
}
