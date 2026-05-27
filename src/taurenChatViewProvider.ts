import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage
} from './sidebar/chatWebview';
import type { SettingValue, TaurenSettingId } from './settings/settingsRegistry';
import type { WebviewLane, WebviewMessage, WebviewPerfEvent, WebviewSessionItem, WebviewStateMessage } from './webviewProtocol/types';
import { type PiClientFactory, type PiClient } from './pi/clientTypes';
import type { PiClientOptions } from './pi/types';
import { PiSdkClient } from './sdk/piSdkClient';
import type { CustomUiHostMessage } from './extensionUi/customUiHost';
import type { ExtensionEditorHostMessage, ExtensionUi } from './extensionUi/types';
import { createSessionDiffStatsFileWatcher, readSessionDiffSnapshot, writeSessionDiffSnapshot } from './diff/sessionDiffStorage';
import { SessionDiffViewer } from './diff/sessionDiffViewer';
import { ShikiCodeRenderer } from './highlighting/shikiCodeRenderer';
import { TaurenSessionManager } from './sessions/taurenSessionManager';
import type { PiPromptImageAttachment } from './taurenChatController';
import { listPiSessions } from './sessions/piSessionList';
import { runReadyScript } from './readyScript';
import { createPromptContextFromEditor } from './prompt/editorContext';
import { supportedPromptImageExtensions } from './prompt/imageAttachments';
import {
  createPromptImageAttachment,
  createPromptImageAttachmentFromDroppedFile,
  parseDroppedPromptImageUri
} from './prompt/imageAttachmentFactory';
import { findCurrentPathGitCommit, findTraceLinkedGitCommit } from './origin/gitOriginContext';
import { traceOrigin } from './origin/sessionOriginTracer';
import {
  createGitOriginPromptContext,
  createOriginPromptContext,
  createTraceOriginInputs
} from './origin/originPromptContext';
import { readCachedSessionMeta, writeCachedSessionMeta } from './metadata/cache';
import { readSessionJsonlHeaderCwdSync } from './pi/sessionJsonl';
import { getPiStartupCwdState, isSafeWorkspaceCwd, getUnsafeCwdReason } from './workspace/cwdSafety';
import {
  isSupportedLocalImagePath,
  isUriInsideWorkspace,
  resolveWorkspaceFileUri,
  resolveWorkspaceImageUri
} from './workspace/workspaceUris';
import { getAtFileSuggestions } from './fileSuggestions/fileSuggestionProvider';
import { TaurenPerfRecorder, type TaurenPerfTimer } from './perf/taurenPerf';
import {
  affectsAnyTaurenExtensionSetting,
  getAllowRemoteImagesSetting,
  getAnimationsEnabledSetting,
  getConfirmSessionDeletionSetting,
  getCustomUiThemeSetting,
  getDebugPerformanceSetting,
  getOutputColorsSetting,
  getReadyScriptEnabledSetting,
  getReadyScriptSetting,
  getRejectEditWriteOutsideWorkspaceSetting,
  getShowWelcomeSetting,
  getTaurenSettingValues,
  hasConfiguredShowWelcomeSetting,
  updateTaurenSetting,
  welcomeDismissedStorageKey
} from './settings/taurenSettings';

export const taurenChatViewType = 'tauren.chatView';
export type { PiClient } from './pi/clientTypes';

const currentSessionFileStorageKey = 'tauren.currentSessionFile';
const taurenSidebarFocusContextKey = 'tauren.sidebarFocus';
const taurenBusyContextKey = 'tauren.busy';
const contextUsagePollingIntervalMs = 2000;
const sessionDiffStatsRefreshDelayMs = 250;
const sessionMetadataCacheFileName = 'sessionMetadataCache.json';

type ConfiguredPiClientDependencies = {
  extensionUi: ExtensionUi;
  showNotification: (message: string, notifyType: string) => void;
  getRejectEditWriteOutsideWorkspace: () => boolean;
};

type PendingPerfBoundary = {
  timer: TaurenPerfTimer;
  target?: string;
  timeout: ReturnType<typeof setTimeout>;
};

function getSessionMetadataCacheFile(storageUri: vscode.Uri | undefined): string | undefined {
  return storageUri ? path.join(storageUri.fsPath, sessionMetadataCacheFileName) : undefined;
}

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

export class TaurenChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private pendingModelPickerOpen = false;
  private pendingTranscriptSearchOpen = false;
  private pendingStreamingBehaviorToggle = false;
  private pendingHelpToggle = false;
  private pendingSessionNameEditStart = false;
  private webviewReady = false;
  private readonly pendingToastMessages: Array<{ message: string; kind: 'success' | 'warning' | 'error' }> = [];
  private readonly controller: TaurenSessionManager;
  private readonly codeRenderer = new ShikiCodeRenderer();
  private readonly sessionDiffViewer = new SessionDiffViewer((message, notifyType) => this.showNotification(message, notifyType));
  private contextUsagePollTimer: NodeJS.Timeout | undefined;
  private sessionDiffStatsRefreshTimer: NodeJS.Timeout | undefined;
  private lastWorkspaceCwd: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];
  private sidebarFocusContext: boolean | undefined;
  private busyContext: boolean | undefined;
  private perfOutputChannel: vscode.OutputChannel | undefined;
  private debugPerformanceEnabled = getDebugPerformanceSetting();
  private readonly perf = new TaurenPerfRecorder({
    isEnabled: () => this.debugPerformanceEnabled,
    writeLine: (line) => this.writePerfLine(line)
  });
  private pendingLaneSwitch: PendingPerfBoundary | undefined;
  private pendingSessionSwitch: PendingPerfBoundary | undefined;
  private lastWebviewLane: WebviewLane = 'chat';

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiClientFactory | undefined = undefined,
    private readonly workspaceState?: vscode.Memento,
    private readonly globalState?: vscode.Memento,
    private readonly workspaceCwdProvider: () => string | undefined = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    private readonly devRenderInstrumentation = false,
    private readonly sessionMetadataStorageUri?: vscode.Uri
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

    this.controller = new TaurenSessionManager({
      createClient: configuredCreateClient,
      getCwd: () => this.workspaceCwdProvider(),
      getOutputColors: () => getOutputColorsSetting(),
      getAnimationsEnabled: () => getAnimationsEnabledSetting(),
      getCustomUiTheme: () => getCustomUiThemeSetting(),
      getReadyScript: () => getReadyScriptSetting(),
      getReadyScriptEnabled: () => getReadyScriptEnabledSetting(),
      getRejectEditWriteOutsideWorkspace: () => getRejectEditWriteOutsideWorkspaceSetting(),
      getTaurenSettingValues: () => getTaurenSettingValues(this.globalState),
      updateTaurenSetting: (id, value) => this.updateTaurenSetting(id, value),
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
      listSessions: (cwd, currentSessionFile, options) => this.listSessionsWithPerf(cwd, currentSessionFile, options?.onProgress),
      deleteSession: (sessionPath, displayName) => this.deleteSession(sessionPath, displayName),
      showSessionChanges: (sessionPath, displayName) => this.sessionDiffViewer.showSessionChanges(sessionPath, displayName)
    });

    const initialWorkspaceState = getPiStartupCwdState(this.workspaceCwdProvider(), getRejectEditWriteOutsideWorkspaceSetting());
    this.lastWorkspaceCwd = initialWorkspaceState.status === 'ready' ? initialWorkspaceState.cwd : undefined;

    this.setSidebarFocusContext(false);
    this.setBusyContext(false);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const affectsRemoteImages = event.affectsConfiguration('tauren.blockHttpsImages');

        if (affectsRemoteImages) {
          this.refreshWebviewHtml();
        }

        const affectsWelcome = event.affectsConfiguration('tauren.showWelcome');
        const affectsDebugPerformance = event.affectsConfiguration('tauren.debugPerformance');
        const affectsExtensionSettings = affectsAnyTaurenExtensionSetting(event);

        if (affectsDebugPerformance) {
          this.debugPerformanceEnabled = getDebugPerformanceSetting();
        }

        if (affectsExtensionSettings) {
          this.controller.refreshTaurenSettingValues();
        }

        if (affectsWelcome && hasConfiguredShowWelcomeSetting()) {
          void this.globalState?.update(welcomeDismissedStorageKey, undefined).then(undefined, () => undefined);
        }

        if (
          event.affectsConfiguration('tauren.outputColors')
          || event.affectsConfiguration('tauren.animationsEnabled')
          || affectsWelcome
          || event.affectsConfiguration('tauren.customUiTheme')
          || affectsDebugPerformance
          || affectsRemoteImages
          || affectsExtensionSettings
        ) {
          this.controller.postState();
        }

        if (event.affectsConfiguration('tauren.rejectEditWriteOutsideWorkspace')) {
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

  private async listSessionsWithPerf(
    cwd: string | undefined,
    currentSessionFile: string | undefined,
    onProgress: ((sessions: WebviewSessionItem[]) => void) | undefined
  ): Promise<WebviewSessionItem[]> {
    const timer = this.perf.start('sessionList.load');
    let metrics: { sessionCount: number; totalBytes: number; cacheHits: number; cacheMisses: number } | undefined;
    const sessions = await listPiSessions({
      cwd,
      currentSessionFile,
      sessionMetadataCacheFile: getSessionMetadataCacheFile(this.sessionMetadataStorageUri),
      onProgress,
      ...(this.perf.enabled ? {
        onMetrics: (nextMetrics) => {
          metrics = nextMetrics;
        }
      } : {})
    });

    this.perf.finish(timer, {
      sessionCount: metrics?.sessionCount ?? sessions.length,
      totalBytes: metrics?.totalBytes,
      cacheHits: metrics?.cacheHits,
      cacheMisses: metrics?.cacheMisses
    });
    return sessions;
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

    this.clearPendingPerfBoundary(this.pendingLaneSwitch);
    this.clearPendingPerfBoundary(this.pendingSessionSwitch);
    this.pendingLaneSwitch = undefined;
    this.pendingSessionSwitch = undefined;
    this.perfOutputChannel?.dispose();
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
      await vscode.commands.executeCommand(`${taurenChatViewType}.focus`);
    }

    this.postInputFocusSoon();
    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
  }

  public async newSession(): Promise<void> {
    void this.webviewView?.webview.postMessage({ type: 'optimisticNewSession' });
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
    this.startLaneSwitchTiming(this.lastWebviewLane === 'sessions' ? 'chat' : 'sessions');
    this.controller.toggleSessionList();
    await this.focus();
  }

  public async toggleSessionTree(): Promise<void> {
    this.startLaneSwitchTiming(this.lastWebviewLane === 'tree' ? 'chat' : 'tree');
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

  public async searchTranscript(): Promise<void> {
    this.controller.showChat();
    await this.revealView();
    this.pendingTranscriptSearchOpen = true;
    this.postTranscriptSearchOpenSoon();
  }

  public scrollTranscriptToTop(): void {
    this.postTranscriptScroll('top');
  }

  public scrollTranscriptToBottom(): void {
    this.postTranscriptScroll('bottom');
  }

  public async toggleSettings(): Promise<void> {
    this.controller.toggleSettings();

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${taurenChatViewType}.focus`);
    }

    this.refreshLiveMetadata();
    this.controller.refreshSessionDiffStats();
    this.startContextUsagePolling();
  }

  public async toggleHelp(): Promise<void> {
    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${taurenChatViewType}.focus`);
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
      title: 'Attach images to next Tauren prompt',
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
      const result = await createPromptImageAttachment(uri);

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

  private async requestFileSuggestions(message: Extract<WebviewMessage, { type: 'requestFileSuggestions' }>): Promise<void> {
    const startupState = getPiStartupCwdState(this.workspaceCwdProvider(), getRejectEditWriteOutsideWorkspaceSetting());
    const items = await getAtFileSuggestions({
      cwd: startupState.status === 'ready' ? startupState.cwd : undefined,
      prefix: message.prefix
    });

    void this.webviewView?.webview.postMessage({
      type: 'fileSuggestionsResult',
      id: message.id,
      prefix: message.prefix,
      items
    });
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
      const result = createPromptImageAttachmentFromDroppedFile(droppedFile);

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

      const result = await createPromptImageAttachment(uri);

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

  public async sendSelectionToComposer(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.showNotification('Open a file before sending code to the Tauren composer.', 'warning');
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
      this.showNotification('Open a file or select code before tracing its Tauren origin.', 'warning');
      return;
    }

    const context = createPromptContextFromEditor(editor);

    if (context.length === 0) {
      this.showNotification('No file context is available for the active editor.', 'warning');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Tracing Tauren origin…',
        cancellable: false
      },
      async () => {
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
            this.showNotification('No Tauren session origin found for the selected code or file.', 'info');
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

        this.startSessionSwitchTiming(match.sessionPath);
        await this.controller.handleWebviewMessage({ type: 'selectSession', sessionPath: match.sessionPath });
        this.controller.addPromptContext(createOriginPromptContext(context, match, traceLinkedCommit));
        await this.focus();
      }
    );
  }

  public async showDiagnostics(): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: this.perf.formatDiagnostics(),
      language: 'plaintext'
    });
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'perfEvent') {
      this.handlePerfEvent(message.event);
      return;
    }

    if (message.type === 'showLane') {
      this.startLaneSwitchTiming(message.lane);
    }

    if (message.type === 'selectSession') {
      this.startSessionSwitchTiming(message.sessionPath);
    }

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

    if (message.type === 'requestFileSuggestions') {
      await this.requestFileSuggestions(message);
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
      this.postTranscriptSearchOpenSoon();
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

  private handlePerfEvent(event: WebviewPerfEvent): void {
    this.perf.record(event.name, event.durationMs, {
      lane: event.lane,
      messageCount: event.messageCount,
      sessionCount: event.sessionCount,
      visibleItemCount: event.visibleItemCount,
      currentSessionFile: event.currentSessionFile,
      sessionLoading: event.sessionLoading
    });

    if (this.pendingLaneSwitch && this.pendingLaneSwitch.target === event.lane) {
      const pending = this.pendingLaneSwitch;
      this.pendingLaneSwitch = undefined;
      this.clearPendingPerfBoundary(pending);
      this.perf.finish(pending.timer, {
        lane: event.lane,
        renderEvent: event.name,
        messageCount: event.messageCount,
        visibleItemCount: event.visibleItemCount
      });
    }

    if (this.pendingSessionSwitch
      && event.currentSessionFile === this.pendingSessionSwitch.target
      && event.sessionLoading !== true) {
      const pending = this.pendingSessionSwitch;
      this.pendingSessionSwitch = undefined;
      this.clearPendingPerfBoundary(pending);
      this.perf.finish(pending.timer, {
        sessionPath: event.currentSessionFile,
        renderEvent: event.name,
        messageCount: event.messageCount
      });
    }
  }

  private startLaneSwitchTiming(lane: WebviewLane): void {
    const timer = this.perf.start('lane.switch', { lane });

    if (!timer) {
      return;
    }

    this.pendingLaneSwitch = this.replacePendingPerfBoundary(this.pendingLaneSwitch, timer, lane);
  }

  private startSessionSwitchTiming(sessionPath: string): void {
    const timer = this.perf.start('session.switch', { sessionPath });

    if (!timer) {
      return;
    }

    this.pendingSessionSwitch = this.replacePendingPerfBoundary(this.pendingSessionSwitch, timer, sessionPath);
  }

  private replacePendingPerfBoundary(
    previous: PendingPerfBoundary | undefined,
    timer: TaurenPerfTimer,
    target: string
  ): PendingPerfBoundary {
    this.clearPendingPerfBoundary(previous);
    const pending: PendingPerfBoundary = {
      timer,
      target,
      timeout: setTimeout(() => {
        if (this.pendingLaneSwitch === pending) {
          this.pendingLaneSwitch = undefined;
        }

        if (this.pendingSessionSwitch === pending) {
          this.pendingSessionSwitch = undefined;
        }
      }, 30_000)
    };
    return pending;
  }

  private clearPendingPerfBoundary(pending: PendingPerfBoundary | undefined): void {
    if (pending) {
      clearTimeout(pending.timeout);
    }
  }

  private withProviderState(message: WebviewStateMessage): WebviewStateMessage {
    if (message.lane) {
      this.lastWebviewLane = message.lane;
    }

    return {
      ...message,
      customUiTheme: getCustomUiThemeSetting(),
      allowRemoteImages: getAllowRemoteImagesSetting(),
      welcomeDismissed: this.isWelcomeDismissed(),
      perfEnabled: this.debugPerformanceEnabled
    };
  }

  private async dismissWelcome(): Promise<void> {
    await this.globalState?.update(welcomeDismissedStorageKey, true);
    this.controller.postState();

    try {
      await updateTaurenSetting('tauren.showWelcome', false);
      await this.globalState?.update(welcomeDismissedStorageKey, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showNotification(`Failed to save Welcome message setting: ${message}`, 'warning');
    }
  }

  private async updateTaurenSetting(id: TaurenSettingId, value: SettingValue): Promise<void> {
    await updateTaurenSetting(id, value);

    if (id === 'tauren.showWelcome' && typeof value === 'boolean') {
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

  private writePerfLine(line: string): void {
    if (!this.perfOutputChannel) {
      this.perfOutputChannel = vscode.window.createOutputChannel('Tauren Performance');
    }

    this.perfOutputChannel.appendLine(line);
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
      await vscode.commands.executeCommand(`${taurenChatViewType}.focus`);
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

  private postTranscriptSearchOpen(): void {
    if (!this.pendingTranscriptSearchOpen || !this.webviewView || !this.webviewReady) {
      return;
    }

    this.pendingTranscriptSearchOpen = false;
    void this.webviewView.webview.postMessage({ type: 'openTranscriptSearch' });
  }

  private postTranscriptSearchOpenSoon(): void {
    setTimeout(() => this.postTranscriptSearchOpen(), 0);
  }

  private postTranscriptScroll(position: 'top' | 'bottom'): void {
    if (!this.webviewView?.visible || !this.webviewReady) {
      return;
    }

    void this.webviewView.webview.postMessage({ type: 'scrollTranscript', position });
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

    const message = `Tauren ignored persisted session ${sessionFile} because ${unsafeReason}. Starting a new session in ${workspaceCwd}.`;
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
    void vscode.commands.executeCommand('setContext', taurenSidebarFocusContextKey, focused).then(undefined, () => undefined);
  }

  private setBusyContext(busy: boolean): void {
    if (this.busyContext === busy) {
      return;
    }

    this.busyContext = busy;
    void vscode.commands.executeCommand('setContext', taurenBusyContextKey, busy).then(undefined, () => undefined);
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

function getWebviewLocalResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [
    extensionUri,
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)
  ];
}

function readCurrentSessionFile(workspaceState: vscode.Memento | undefined): string | undefined {
  const value = workspaceState?.get<unknown>(currentSessionFileStorageKey);
  return typeof value === 'string' && value ? value : undefined;
}
