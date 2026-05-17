import * as assert from 'assert';
import * as vscode from 'vscode';
import { PiChatViewProvider, type PiRpcClientLike } from '../../piChatViewProvider';
import type { WebviewStateMessage } from '../../webviewProtocol/types';
import type {
  ExtensionUiResponse,
  PiAgentMessage,
  PiModel,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from '../../rpc/types';

suite('PiChatViewProvider', () => {
  test('posts cached legacy model metadata and persists refreshed session metadata', async () => {
    const workspaceState = new FakeMemento({
      'tau.cachedModelMeta': {
        label: 'cached-model High',
        provider: 'anthropic',
        id: 'cached-model',
        reasoning: true,
        thinkingLevel: 'high'
      }
    });
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'live-model', reasoning: true },
        thinkingLevel: 'medium'
      },
      models: [{ provider: 'openai', id: 'live-model', name: 'Live Model', reasoning: true }],
      stats: { contextUsage: { tokens: 60, contextWindow: 100, percent: 60 } }
    });
    const provider = new PiChatViewProvider(
      vscode.Uri.file('/extension'),
      () => client,
      workspaceState
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());

    assert.strictEqual(lastPostedState(view).modelLabel, 'cached-model High');
    assert.strictEqual(lastPostedState(view).metadataRefreshing, true);
    assert.strictEqual(client.stateCalls, 1);
    assert.strictEqual(client.modelsCalls, 1);
    assert.strictEqual(client.statsCalls, 1);
    await flushPromises();

    assert.strictEqual(lastPostedState(view).modelLabel, 'live-model Medium');
    assert.strictEqual(lastPostedState(view).contextUsageLabel, '60%');
    assert.strictEqual(lastPostedState(view).metadataRefreshing, false);
    assert.deepStrictEqual(workspaceState.get<unknown>('tau.cachedSessionMeta'), {
      model: {
        label: 'live-model Medium',
        provider: 'openai',
        id: 'live-model',
        reasoning: true,
        thinkingLevel: 'medium'
      },
      modelOptions: [
        { provider: 'openai', id: 'live-model', name: 'Live Model', reasoning: true }
      ],
      contextUsage: {
        label: '60%',
        title: [
          'Context used: 60%',
          'Current context: 60 tokens',
          'Model context size: 100 tokens'
        ].join('\n'),
        level: 'medium'
      }
    });
    assert.strictEqual(workspaceState.get<unknown>('tau.cachedModelMeta'), undefined);
    provider.dispose();
  });

  test('restores and persists current session file through workspace state', async () => {
    const workspaceState = new FakeMemento({
      'tau.currentSessionFile': '/sessions/current.jsonl'
    });
    const clientOptions: unknown[] = [];
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'live-model', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/updated.jsonl'
      },
      messages: [{ role: 'user', content: 'Restored prompt' }]
    });
    const provider = new PiChatViewProvider(
      vscode.Uri.file('/extension'),
      (options) => {
        clientOptions.push(options);
        return client;
      },
      workspaceState
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    await flushPromises();

    assert.deepStrictEqual(clientOptions, [
      { cwd: undefined, sessionFile: '/sessions/current.jsonl' }
    ]);
    assert.deepStrictEqual(lastPostedState(view).messages, [
      { role: 'user', text: 'Restored prompt' }
    ]);
    assert.strictEqual(workspaceState.get<unknown>('tau.currentSessionFile'), '/sessions/updated.jsonl');
    provider.dispose();
  });

  test('clears webview-specific disposables when views are replaced, disposed, or provider is disposed', () => {
    const provider = new PiChatViewProvider(vscode.Uri.file('/extension'), () => {
      throw new Error('Unexpected Pi client creation');
    });

    const first = new FakeWebviewView();
    provider.resolveWebviewView(first.asWebviewView());

    assert.strictEqual(first.webviewDisposableCount, 3);
    assert.strictEqual(first.disposedWebviewDisposableCount, 0);

    const second = new FakeWebviewView();
    provider.resolveWebviewView(second.asWebviewView());

    assert.strictEqual(first.disposedWebviewDisposableCount, 3);
    assert.strictEqual(second.webviewDisposableCount, 3);
    assert.strictEqual(second.disposedWebviewDisposableCount, 0);

    first.fireDispose();
    assert.strictEqual(second.disposedWebviewDisposableCount, 0);

    second.fireDispose();
    assert.strictEqual(second.disposedWebviewDisposableCount, 3);

    const third = new FakeWebviewView();
    provider.resolveWebviewView(third.asWebviewView());
    provider.dispose();

    assert.strictEqual(third.disposedWebviewDisposableCount, 3);
  });
});

class FakeWebviewView {
  public readonly webview = new FakeWebview();
  public visible = true;
  private readonly disposeListeners = new Set<() => void>();
  private readonly visibilityListeners = new Set<() => void>();
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

  public onDidChangeVisibility(listener: () => void): vscode.Disposable {
    this.visibilityListeners.add(listener);
    const disposable = new TrackableDisposable(() => {
      this.visibilityListeners.delete(listener);
    });
    this.disposables.push(disposable);

    return disposable;
  }

  public show(_preserveFocus?: boolean): void {}

  public fireVisibilityChange(visible: boolean): void {
    this.visible = visible;

    for (const listener of [...this.visibilityListeners]) {
      listener();
    }
  }

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

  public readonly messages: unknown[] = [];

  public postMessage(message: unknown): Promise<boolean> {
    this.messages.push(message);
    return Promise.resolve(true);
  }

  public fireMessage(message: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(message);
    }
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

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();

  public constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.data.set(key, value);
    }
  }

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }

    return defaultValue;
  }

  public update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }

    return Promise.resolve();
  }

  public keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

class FakePiClient implements PiRpcClientLike {
  public stateCalls = 0;
  public modelsCalls = 0;
  public statsCalls = 0;
  private disposed = false;
  private readonly state: PiSessionState;
  private readonly models: PiModel[];
  private readonly stats: PiSessionStats;
  private readonly messages: PiAgentMessage[];

  public constructor(options: { state: PiSessionState; models?: PiModel[]; stats?: PiSessionStats; messages?: PiAgentMessage[] }) {
    this.state = options.state;
    this.models = options.models ?? [];
    this.stats = options.stats ?? {};
    this.messages = options.messages ?? [];
  }

  public onEvent(_listener: (event: RpcEvent) => void): () => void {
    return () => {};
  }

  public onError(_listener: (message: string) => void): () => void {
    return () => {};
  }

  public async prompt(_message: string): Promise<void> {}

  public async abort(): Promise<void> {}

  public async reload(): Promise<void> {}

  public isRunning(): boolean {
    return !this.disposed;
  }

  public async getState(): Promise<PiSessionState> {
    this.stateCalls += 1;
    return this.state;
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    this.statsCalls += 1;
    return this.stats;
  }

  public async getAvailableModels(): Promise<{ models?: PiModel[] }> {
    this.modelsCalls += 1;
    return { models: this.models };
  }

  public async getCommands(): Promise<{ commands?: [] }> {
    return { commands: [] };
  }

  public async getMessages(): Promise<{ messages?: PiAgentMessage[] }> {
    return { messages: this.messages };
  }

  public async switchSession(_sessionPath: string): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async navigateTree(_entryId: string): Promise<{ editorText?: string; cancelled?: boolean; aborted?: boolean }> {
    return { cancelled: false };
  }

  public async getForkMessages(): Promise<{ messages?: [] }> {
    return { messages: [] };
  }

  public async fork(_entryId: string): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async clone(): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async setModel(_provider: string, _modelId: string): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(_level: string): Promise<void> {}

  public async setSessionName(_name: string): Promise<void> {}

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportHtml(): Promise<{}> {
    return {};
  }

  public async getLastAssistantText(): Promise<{ text: null }> {
    return { text: null };
  }

  public async respondExtensionUiRequest(_response: ExtensionUiResponse): Promise<void> {}

  public dispose(): void {
    this.disposed = true;
  }
}

function lastPostedState(view: FakeWebviewView): WebviewStateMessage {
  for (let index = view.webview.messages.length - 1; index >= 0; index -= 1) {
    const message = view.webview.messages[index];

    if (isWebviewStateMessage(message)) {
      return message;
    }
  }

  assert.fail('Expected a state message to be posted');
}

function isWebviewStateMessage(value: unknown): value is WebviewStateMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'state';
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
