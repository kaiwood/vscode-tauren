import * as assert from 'assert';
import * as vscode from 'vscode';
import { PiChatViewProvider } from '../../piChatViewProvider';

suite('PiChatViewProvider', () => {
  test('clears webview-specific disposables when views are replaced, disposed, or provider is disposed', () => {
    const provider = new PiChatViewProvider(vscode.Uri.file('/extension'), () => {
      throw new Error('Unexpected Pi client creation');
    });

    const first = new FakeWebviewView();
    provider.resolveWebviewView(first.asWebviewView());

    assert.strictEqual(first.webviewDisposableCount, 2);
    assert.strictEqual(first.disposedWebviewDisposableCount, 0);

    const second = new FakeWebviewView();
    provider.resolveWebviewView(second.asWebviewView());

    assert.strictEqual(first.disposedWebviewDisposableCount, 2);
    assert.strictEqual(second.webviewDisposableCount, 2);
    assert.strictEqual(second.disposedWebviewDisposableCount, 0);

    first.fireDispose();
    assert.strictEqual(second.disposedWebviewDisposableCount, 0);

    second.fireDispose();
    assert.strictEqual(second.disposedWebviewDisposableCount, 2);

    const third = new FakeWebviewView();
    provider.resolveWebviewView(third.asWebviewView());
    provider.dispose();

    assert.strictEqual(third.disposedWebviewDisposableCount, 2);
  });
});

class FakeWebviewView {
  public readonly webview = new FakeWebview();
  public visible = true;
  private readonly disposeListeners = new Set<() => void>();
  private readonly disposables: TrackableDisposable[] = [];

  public asWebviewView(): vscode.WebviewView {
    return this as unknown as vscode.WebviewView;
  }

  public onDidDispose(listener: () => void): vscode.Disposable {
    this.disposeListeners.add(listener);
    const disposable = new TrackableDisposable(() => {
      this.disposeListeners.delete(listener);
    });
    this.disposables.push(disposable);

    return disposable;
  }

  public show(_preserveFocus?: boolean): void {}

  public fireDispose(): void {
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }

  public get webviewDisposableCount(): number {
    return this.disposables.length + this.webview.disposableCount;
  }

  public get disposedWebviewDisposableCount(): number {
    return this.disposables.filter((disposable) => disposable.disposed).length + this.webview.disposedDisposableCount;
  }
}

class FakeWebview {
  public options: vscode.WebviewOptions | undefined;
  public html = '';
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disposables: TrackableDisposable[] = [];

  public asWebviewUri(uri: vscode.Uri): vscode.Uri {
    return uri;
  }

  public onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable {
    this.messageListeners.add(listener);
    const disposable = new TrackableDisposable(() => {
      this.messageListeners.delete(listener);
    });
    this.disposables.push(disposable);

    return disposable;
  }

  public postMessage(_message: unknown): Promise<boolean> {
    return Promise.resolve(true);
  }

  public get disposableCount(): number {
    return this.disposables.length;
  }

  public get disposedDisposableCount(): number {
    return this.disposables.filter((disposable) => disposable.disposed).length;
  }
}

class TrackableDisposable implements vscode.Disposable {
  public disposed = false;

  public constructor(private readonly onDispose: () => void) {}

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.onDispose();
  }
}
