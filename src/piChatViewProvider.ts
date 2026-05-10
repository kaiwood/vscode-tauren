import * as vscode from 'vscode';
import {
  createWebviewHtml,
  parseWebviewMessage,
  type WebviewMessage
} from './chatWebview';
import {
  PiChatController,
  type PiRpcClientFactory
} from './piChatController';
import { PiRpcClient } from './piRpcClient';

export const chatViewType = 'piui.chatView';
export type { PiRpcClientLike } from './piChatController';

export class PiChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private pendingInputFocus = false;
  private webviewReady = false;
  private readonly controller: PiChatController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly webviewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    createClient: PiRpcClientFactory = (options) => new PiRpcClient(options)
  ) {
    this.controller = new PiChatController({
      createClient,
      getCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      postState: (message) => {
        void this.webviewView?.webview.postMessage(message);
      },
      showNotification: (message, notifyType) => this.showNotification(message, notifyType),
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
      fullRpcAgentCommunication: getFullRpcAgentCommunicationSetting()
    });

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('piui.fullRpcAgentCommunication')) {
          return;
        }

        this.controller.setFullRpcAgentCommunication(getFullRpcAgentCommunicationSetting());
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
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
    );
    const domPurifyUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'dompurify', 'dist', 'purify.min.js')
    );
    const highlightUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@highlightjs', 'cdn-assets', 'highlight.min.js')
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
      })
    );

    this.controller.postState();
  }

  public async focus(): Promise<void> {
    this.pendingInputFocus = true;

    if (this.webviewView?.visible) {
      this.webviewView.show(false);
    } else {
      await vscode.commands.executeCommand(`${chatViewType}.focus`);
    }

    this.postInputFocusSoon();
  }

  public async newSession(): Promise<void> {
    this.controller.startNewSession();
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
}

function getFullRpcAgentCommunicationSetting(): boolean {
  return vscode.workspace.getConfiguration('piui').get<boolean>(
    'fullRpcAgentCommunication',
    false
  );
}
