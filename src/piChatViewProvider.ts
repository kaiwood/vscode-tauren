import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage,
  type WebviewMessage
} from './chatWebview';
import {
  PiChatController,
  type PiChatContextUsage,
  type PiChatModelMeta,
  type PiPromptContextInput,
  type PiChatSessionMetaSnapshot,
  type PiRpcClientFactory
} from './piChatController';
import { PiRpcClient } from './piRpcClient';
import { listPiSessions } from './piSessionList';
import type { WebviewModelOption } from './chatWebview';

export const chatViewType = 'piui.chatView';
export type { PiRpcClientLike } from './piChatController';

const cachedSessionMetaStorageKey = 'piui.cachedSessionMeta';
const cachedModelMetaStorageKey = 'piui.cachedModelMeta';
const currentSessionFileStorageKey = 'piui.currentSessionFile';

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private webviewReady = false;
  private readonly controller: PiChatController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiRpcClientFactory = (options) => new PiRpcClient(options),
    private readonly workspaceState?: vscode.Memento
  ) {
    this.controller = new PiChatController({
      createClient,
      getCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      getPiPath: () => getPiPathSetting(),
      postState: (message) => {
        void this.webviewView?.webview.postMessage(message);
      },
      showNotification: (message, notifyType) => this.showNotification(message, notifyType),
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
      fullRpcAgentCommunication: getFullRpcAgentCommunicationSetting(),
      initialSessionMeta: readCachedSessionMeta(this.workspaceState),
      initialSessionFile: readCurrentSessionFile(this.workspaceState),
      onSessionMetaChange: (metadata) => this.writeCachedSessionMeta(metadata),
      onSessionFileChange: (sessionFile) => this.writeCurrentSessionFile(sessionFile),
      listSessions: (cwd, currentSessionFile) => listPiSessions({ cwd, currentSessionFile })
    });

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('piui.fullRpcAgentCommunication')) {
          this.controller.setFullRpcAgentCommunication(getFullRpcAgentCommunicationSetting());
        }

        if (event.affectsConfiguration('piui.piPath')) {
          this.controller.handlePiPathChanged();
        }
      })
    );
  }

  public dispose(): void {
    this.disposeWebviewDisposables();

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }

    this.controller.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
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
    const highlightUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'vendor', 'highlight.min.js')
    );

    webviewView.webview.html = createWebviewHtml({
      markdownItScriptUri: markdownItUri.toString(),
      domPurifyScriptUri: domPurifyUri.toString(),
      highlightScriptUri: highlightUri.toString()
    });

    this.webviewDisposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView !== webviewView) {
          return;
        }

        this.webviewView = undefined;
        this.webviewReady = false;
        this.disposeWebviewDisposables();
      }),
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(parseWebviewMessage(message));
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.refreshLiveMetadata();
        }
      })
    );

    this.controller.postState();
    this.refreshLiveMetadata();
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
  }

  public async newSession(): Promise<void> {
    this.controller.startNewSession();
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
    if (message.type === 'ready') {
      this.webviewReady = true;
      await this.controller.handleWebviewMessage(message);
      this.postInputFocusSoon();
      return;
    }

    await this.controller.handleWebviewMessage(message);
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
    void this.controller.refreshSessionMeta({ startClient: true }).then(undefined, () => undefined);
  }

  private writeCachedSessionMeta(metadata: PiChatSessionMetaSnapshot): void {
    if (!this.workspaceState) {
      return;
    }

    const value = hasCachedSessionMeta(metadata) ? metadata : undefined;
    void this.workspaceState.update(cachedSessionMetaStorageKey, value).then(undefined, () => undefined);
    void this.workspaceState.update(cachedModelMetaStorageKey, undefined).then(undefined, () => undefined);
  }

  private writeCurrentSessionFile(sessionFile: string | undefined): void {
    if (!this.workspaceState) {
      return;
    }

    void this.workspaceState.update(currentSessionFileStorageKey, sessionFile || undefined).then(undefined, () => undefined);
  }
}

function createPromptContextFromEditor(editor: vscode.TextEditor): PiPromptContextInput[] {
  const document = editor.document;
  const path = getDocumentContextPath(document);

  if (!path) {
    return [];
  }

  const selectedContexts = editor.selections.flatMap((selection): PiPromptContextInput[] => {
    if (selection.isEmpty) {
      return [];
    }

    const text = document.getText(selection);

    if (!text.trim()) {
      return [];
    }

    const lineRange = getSelectedLineRange(selection);
    const lineLabel = formatLineRange(lineRange.startLine, lineRange.endLine);
    const title = `${path}:${lineLabel}`;

    return [{
      kind: 'selection',
      path,
      label: `${getPathBasename(path)}:${lineLabel}`,
      title,
      languageId: document.languageId,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      text
    }];
  });

  if (selectedContexts.length > 0) {
    return selectedContexts;
  }

  return [{
    kind: 'file',
    path,
    label: getPathBasename(path),
    title: path
  }];
}

function getDocumentContextPath(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'file') {
    return vscode.workspace.asRelativePath(document.uri, false);
  }

  return document.uri.toString(true);
}

function getSelectedLineRange(selection: vscode.Selection): { startLine: number; endLine: number } {
  let endLine = selection.end.line;

  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    endLine -= 1;
  }

  endLine = Math.max(selection.start.line, endLine);

  return {
    startLine: selection.start.line + 1,
    endLine: endLine + 1
  };
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

function getFullRpcAgentCommunicationSetting(): boolean {
  return vscode.workspace.getConfiguration('piui').get<boolean>(
    'fullRpcAgentCommunication',
    false
  );
}

function getPiPathSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('piui').get<string>('piPath', 'pi').trim();
  return value && value !== 'pi' ? value : undefined;
}

function readCachedSessionMeta(workspaceState: vscode.Memento | undefined): PiChatSessionMetaSnapshot | undefined {
  const value = workspaceState?.get<unknown>(cachedSessionMetaStorageKey);
  const snapshot = parseCachedSessionMeta(value);

  if (snapshot) {
    return snapshot;
  }

  const legacyModelMeta = parseCachedModelMeta(workspaceState?.get<unknown>(cachedModelMetaStorageKey));

  return legacyModelMeta ? { model: legacyModelMeta } : undefined;
}

function readCurrentSessionFile(workspaceState: vscode.Memento | undefined): string | undefined {
  const value = workspaceState?.get<unknown>(currentSessionFileStorageKey);
  return typeof value === 'string' && value ? value : undefined;
}

function parseCachedSessionMeta(value: unknown): PiChatSessionMetaSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const model = parseCachedModelMeta(value.model);
  const modelOptions = parseCachedModelOptions(value.modelOptions);
  const contextUsage = parseCachedContextUsage(value.contextUsage);
  const snapshot: PiChatSessionMetaSnapshot = {};

  if (model) {
    snapshot.model = model;
  }

  if (modelOptions) {
    snapshot.modelOptions = modelOptions;
  }

  if (contextUsage) {
    snapshot.contextUsage = contextUsage;
  }

  return hasCachedSessionMeta(snapshot) ? snapshot : undefined;
}

function parseCachedModelMeta(value: unknown): PiChatModelMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = getRecordString(value, 'id');

  if (!id) {
    return undefined;
  }

  return {
    label: getRecordString(value, 'label') || id,
    provider: getRecordString(value, 'provider') ?? '',
    id,
    reasoning: value.reasoning === true,
    thinkingLevel: getRecordString(value, 'thinkingLevel') ?? ''
  };
}

function parseCachedModelOptions(value: unknown): WebviewModelOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const modelOptions = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const provider = getRecordString(item, 'provider');
    const id = getRecordString(item, 'id');

    if (!provider || !id) {
      return [];
    }

    return [{
      provider,
      id,
      name: getRecordString(item, 'name') || id,
      reasoning: item.reasoning === true
    }];
  });

  return modelOptions.length > 0 ? modelOptions : undefined;
}

function parseCachedContextUsage(value: unknown): PiChatContextUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const label = getRecordString(value, 'label');

  if (!label) {
    return undefined;
  }

  return {
    label,
    title: getRecordString(value, 'title') ?? '',
    level: getRecordString(value, 'level') ?? ''
  };
}

function hasCachedSessionMeta(snapshot: PiChatSessionMetaSnapshot): boolean {
  return Boolean(
    snapshot.model
    || (snapshot.modelOptions && snapshot.modelOptions.length > 0)
    || snapshot.contextUsage
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
