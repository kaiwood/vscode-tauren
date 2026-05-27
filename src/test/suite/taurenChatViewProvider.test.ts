import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { TaurenChatViewProvider, type PiClient } from '../../taurenChatViewProvider';
import { initialWebviewState, parseWebviewStateMessage } from '../../webview/state';
import type { WebviewFullStateMessage, WebviewStateMessage } from '../../webviewProtocol/types';
import type {
  PiAgentMessage,
  PiModel,
  PiSessionState,
  PiSessionStats,
  PiEvent
} from '../../pi/types';

type ProviderWithDeleteSession = {
  deleteSession(sessionPath: string, displayName: string): Promise<boolean>;
};

suite('TaurenChatViewProvider', () => {
  test('suppresses watcher diff refresh scheduling without a session file', () => {
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({ state: {} }),
      new FakeMemento(),
      undefined,
      () => '/workspace'
    );

    (provider as unknown as { scheduleSessionDiffStatsRefresh(): void }).scheduleSessionDiffStatsRefresh();

    assert.strictEqual((provider as unknown as { sessionDiffStatsRefreshTimer?: NodeJS.Timeout }).sessionDiffStatsRefreshTimer, undefined);
    provider.dispose();
  });

  test('coalesces watcher diff refresh scheduling when a session file is active', () => {
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({ state: {} }),
      new FakeMemento({ 'tauren.currentSessionFile': '/sessions/current.jsonl' }),
      undefined,
      () => '/workspace'
    );
    const providerWithRefresh = provider as unknown as {
      scheduleSessionDiffStatsRefresh(): void;
      sessionDiffStatsRefreshTimer?: NodeJS.Timeout;
    };

    providerWithRefresh.scheduleSessionDiffStatsRefresh();
    const firstTimer = providerWithRefresh.sessionDiffStatsRefreshTimer;
    providerWithRefresh.scheduleSessionDiffStatsRefresh();

    assert.ok(firstTimer);
    assert.ok(providerWithRefresh.sessionDiffStatsRefreshTimer);
    assert.notStrictEqual(providerWithRefresh.sessionDiffStatsRefreshTimer, firstTimer);
    provider.dispose();
  });

  test('posts cached legacy model metadata and persists refreshed session metadata', async () => {
    const workspaceState = new FakeMemento({
      'tauren.cachedModelMeta': {
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
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => client,
      workspaceState,
      undefined,
      () => '/workspace'
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
    assert.deepStrictEqual(workspaceState.get<unknown>('tauren.cachedSessionMeta'), {
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
        title: '60.0%/100',
        level: 'medium'
      }
    });
    assert.strictEqual(workspaceState.get<unknown>('tauren.cachedModelMeta'), undefined);
    provider.dispose();
  });

  test('ignores unsafe persisted root-cwd session and starts fresh', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-'));
    const sessionFile = path.join(tempDir, 'root-session.jsonl');

    try {
      await fs.writeFile(sessionFile, JSON.stringify({ type: 'session', cwd: '/' }) + '\n', 'utf8');
      const workspaceState = new FakeMemento({
        'tauren.currentSessionFile': sessionFile
      });
      const clientOptions: unknown[] = [];
      const client = new FakePiClient({
        state: {
          model: { provider: 'openai', id: 'live-model', reasoning: false },
          thinkingLevel: 'off',
          sessionFile: '/sessions/new.jsonl'
        },
        messages: []
      });
      const provider = new TaurenChatViewProvider(
        vscode.Uri.file('/extension'),
        (options) => {
          clientOptions.push(options);
          return client;
        },
        workspaceState,
        undefined,
        () => '/workspace'
      );
      const view = new FakeWebviewView();

      provider.resolveWebviewView(view.asWebviewView());
      await flushPromises();

      assert.deepStrictEqual(clientOptions.map(withoutExtensionUi), [{ cwd: '/workspace' }]);
      assert.strictEqual(workspaceState.get<unknown>('tauren.currentSessionFile'), '/sessions/new.jsonl');
      provider.dispose();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('starts with home cwd when no workspace folder is available', async () => {
    const clientOptions: unknown[] = [];
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'live-model', reasoning: false },
        thinkingLevel: 'off'
      }
    });
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      (options) => {
        clientOptions.push(options);
        return client;
      },
      undefined,
      undefined,
      () => undefined
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    await flushPromises();

    assert.deepStrictEqual(clientOptions.map(withoutExtensionUi), [{ cwd: os.homedir() }]);
    provider.dispose();
  });

  test('restores and persists current session file through workspace state', async () => {
    const workspaceState = new FakeMemento({
      'tauren.currentSessionFile': '/sessions/current.jsonl'
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
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      (options) => {
        clientOptions.push(options);
        return client;
      },
      workspaceState,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    await flushPromises();

    assert.deepStrictEqual(clientOptions.map(withoutExtensionUi), [
      { cwd: '/workspace', sessionFile: '/sessions/current.jsonl' }
    ]);
    assert.deepStrictEqual(lastPostedState(view).messages, [
      { role: 'user', text: 'Restored prompt' }
    ]);
    assert.strictEqual(workspaceState.get<unknown>('tauren.currentSessionFile'), '/sessions/updated.jsonl');
    provider.dispose();
  });

  test('persists dismissed welcome state as a setting and posts updated state', async () => {
    const configuration = vscode.workspace.getConfiguration('tauren');
    const previousValue = configuration.inspect<boolean>('showWelcome')?.globalValue;
    const globalState = new FakeMemento();
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => {
        throw new Error('Unexpected Pi client creation');
      },
      undefined,
      globalState
    );
    const view = new FakeWebviewView();

    try {
      await configuration.update('showWelcome', undefined, vscode.ConfigurationTarget.Global);
      provider.resolveWebviewView(view.asWebviewView());

      assert.strictEqual(lastPostedState(view).welcomeDismissed, false);
      assert.match(view.webview.html, /Don't show again/);

      view.webview.fireMessage({ type: 'dismissWelcome' });
      await waitForAssertion(() => {
        assert.strictEqual(vscode.workspace.getConfiguration('tauren').get<boolean>('showWelcome'), false);
        assert.strictEqual(globalState.get<unknown>('tauren.welcomeDismissed'), undefined);
        assert.strictEqual(lastPostedState(view).welcomeDismissed, true);
      });
    } finally {
      provider.dispose();
      await configuration.update('showWelcome', previousValue, vscode.ConfigurationTarget.Global);
    }
  });

  test('uses plain initial empty state after welcome is dismissed', async () => {
    const configuration = vscode.workspace.getConfiguration('tauren');
    const previousValue = configuration.inspect<boolean>('showWelcome')?.globalValue;
    const globalState = new FakeMemento({ 'tauren.welcomeDismissed': true });
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => {
        throw new Error('Unexpected Pi client creation');
      },
      undefined,
      globalState
    );
    const view = new FakeWebviewView();

    try {
      await configuration.update('showWelcome', undefined, vscode.ConfigurationTarget.Global);
      provider.resolveWebviewView(view.asWebviewView());

      assert.doesNotMatch(view.webview.html, /Don't show again/);
      assert.match(view.webview.html, /Ask Tauren about this workspace\./);
      assert.strictEqual(lastPostedState(view).welcomeDismissed, true);
      assert.strictEqual(lastPostedState(view).settings?.values['tauren.showWelcome'], false);
    } finally {
      provider.dispose();
      await configuration.update('showWelcome', previousValue, vscode.ConfigurationTarget.Global);
    }
  });

  test('can turn the welcome message back on from Tauren settings', async () => {
    const configuration = vscode.workspace.getConfiguration('tauren');
    const previousValue = configuration.inspect<boolean>('showWelcome')?.globalValue;
    const globalState = new FakeMemento({ 'tauren.welcomeDismissed': true });
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => {
        throw new Error('Unexpected Pi client creation');
      },
      undefined,
      globalState
    );
    const view = new FakeWebviewView();

    try {
      await configuration.update('showWelcome', undefined, vscode.ConfigurationTarget.Global);
      provider.resolveWebviewView(view.asWebviewView());
      assert.strictEqual(lastPostedState(view).welcomeDismissed, true);

      view.webview.fireMessage({ type: 'updateSetting', settingId: 'tauren.showWelcome', value: true });
      await waitForAssertion(() => {
        assert.strictEqual(vscode.workspace.getConfiguration('tauren').get<boolean>('showWelcome'), true);
        assert.strictEqual(lastPostedState(view).welcomeDismissed, false);
        assert.strictEqual(lastPostedState(view).settings?.values['tauren.showWelcome'], true);
      });
    } finally {
      provider.dispose();
      await configuration.update('showWelcome', previousValue, vscode.ConfigurationTarget.Global);
    }
  });

  test('posts help toggle messages to the webview', async () => {
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({ state: {} }),
      undefined,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    view.webview.fireMessage({ type: 'ready' });
    await flushPromises();
    view.webview.messages.length = 0;

    await provider.toggleHelp();
    await flushPromises();

    assert.ok(view.webview.messages.some((message) => isMessageType(message, 'toggleHelpOverlay')));
    provider.dispose();
  });

  test('adds dropped prompt images from the webview', async () => {
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({
        state: {
          model: { provider: 'openai', id: 'live-model', reasoning: false },
          thinkingLevel: 'off'
        }
      }),
      undefined,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    view.webview.fireMessage({
      type: 'dropPromptImages',
      files: [{ label: 'diagram.png', title: 'diagram.png', mimeType: 'image/png', sizeBytes: 4, data: 'AAAA' }],
      uris: []
    });

    await waitForAssertion(() => {
      assert.deepStrictEqual(findPostedPromptImages(view)?.map(withoutPromptImageId), [{
        label: 'diagram.png',
        title: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 4
      }]);
    });
    provider.dispose();
  });

  test('rejects dropped prompt image batches when any item is invalid', async () => {
    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({
        state: {
          model: { provider: 'openai', id: 'live-model', reasoning: false },
          thinkingLevel: 'off'
        }
      }),
      undefined,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    view.webview.fireMessage({
      type: 'dropPromptImages',
      files: [{ label: 'diagram.png', title: 'diagram.png', mimeType: 'image/png', sizeBytes: 4, data: 'AAAA' }],
      uris: [],
      rejections: ['Unsupported attachment: notes.txt. Tauren currently supports PNG, JPEG, GIF, and WebP images.']
    });
    await flushPromises();

    assert.strictEqual(findPostedPromptImages(view), undefined);
    provider.dispose();
  });

  test('sends selected editor lines to the composer and clears the editor selection', async () => {
    const document = await vscode.workspace.openTextDocument({
      content: 'alpha\nbeta\ngamma\ndelta',
      language: 'plaintext'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(new vscode.Position(1, 2), new vscode.Position(2, 3));

    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({ state: {} }),
      undefined,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    await provider.sendSelectionToComposer();

    assert.strictEqual(findPostedComposerText(view), 'beta\ngamma');
    assert.strictEqual(findPostedComposerTextMode(view), 'append');
    assert.strictEqual(editor.selection.isEmpty, true);
    assert.deepStrictEqual(editor.selection.active, new vscode.Position(2, 3));
    provider.dispose();
  });

  test('sends the current editor line when no text is selected', async () => {
    const document = await vscode.workspace.openTextDocument({
      content: 'alpha\nbeta\ngamma',
      language: 'plaintext'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(new vscode.Position(1, 1), new vscode.Position(1, 1));

    const provider = new TaurenChatViewProvider(
      vscode.Uri.file('/extension'),
      () => new FakePiClient({ state: {} }),
      undefined,
      undefined,
      () => '/workspace'
    );
    const view = new FakeWebviewView();

    provider.resolveWebviewView(view.asWebviewView());
    await provider.sendSelectionToComposer();

    assert.strictEqual(findPostedComposerText(view), 'beta');
    assert.strictEqual(findPostedComposerTextMode(view), 'append');
    assert.strictEqual(editor.selection.isEmpty, true);
    provider.dispose();
  });

  test('deletes sessions without confirmation when configured', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-delete-session-'));
    const sessionFile = path.join(tempDir, 'session.jsonl');
    const configuration = vscode.workspace.getConfiguration('tauren');
    const previousValue = configuration.inspect<boolean>('confirmSessionDeletion')?.globalValue;
    const provider = new TaurenChatViewProvider(vscode.Uri.file('/extension'), () => {
      throw new Error('Unexpected Pi client creation');
    });

    try {
      await fs.writeFile(sessionFile, JSON.stringify({ type: 'session', id: 'session' }) + '\n', 'utf8');
      await configuration.update('confirmSessionDeletion', false, vscode.ConfigurationTarget.Global);

      const deleted = await (provider as unknown as ProviderWithDeleteSession).deleteSession(sessionFile, 'Session');

      assert.strictEqual(deleted, true);
      await assert.rejects(fs.stat(sessionFile));
    } finally {
      provider.dispose();
      await configuration.update('confirmSessionDeletion', previousValue, vscode.ConfigurationTarget.Global);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('clears webview-specific disposables when views are replaced, disposed, or provider is disposed', () => {
    const provider = new TaurenChatViewProvider(vscode.Uri.file('/extension'), () => {
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

class FakePiClient implements PiClient {
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

  public onEvent(_listener: (event: PiEvent) => void): () => void {
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

  public async getSessionTree(): Promise<[]> {
    return [];
  }

  public async setTreeEntryLabel(_entryId: string, _label: string | undefined): Promise<void> {}

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

  public dispose(): void {
    this.disposed = true;
  }
}

function withoutExtensionUi(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const { extensionUi: _extensionUi, ...rest } = value as Record<string, unknown>;
  return rest;
}

function findPostedComposerText(view: FakeWebviewView): string | undefined {
  return view.webview.messages
    .filter(isWebviewStateMessage)
    .find((message) => typeof message.composerText === 'string')
    ?.composerText;
}

function findPostedComposerTextMode(view: FakeWebviewView): WebviewStateMessage['composerTextMode'] | undefined {
  return view.webview.messages
    .filter(isWebviewStateMessage)
    .find((message) => typeof message.composerText === 'string')
    ?.composerTextMode;
}

function findPostedPromptImages(view: FakeWebviewView): WebviewStateMessage['promptImages'] | undefined {
  return view.webview.messages
    .filter(isWebviewStateMessage)
    .find((message) => Array.isArray(message.promptImages) && message.promptImages.length > 0)
    ?.promptImages;
}

function withoutPromptImageId(value: NonNullable<WebviewStateMessage['promptImages']>[number]): Omit<NonNullable<WebviewStateMessage['promptImages']>[number], 'id'> {
  const { id: _id, ...rest } = value;
  return rest;
}

function lastPostedState(view: FakeWebviewView): WebviewFullStateMessage {
  let parsedState = { ...initialWebviewState };
  let lastState: WebviewStateMessage | undefined;

  for (const message of view.webview.messages) {
    if (isWebviewStateMessage(message)) {
      parsedState = parseWebviewStateMessage(message, parsedState);
      lastState = message;
    }
  }

  if (!lastState) {
    assert.fail('Expected a state message to be posted');
  }

  return {
    ...lastState,
    messages: stripWebviewMessageMetadata(parsedState.messages) as WebviewFullStateMessage['messages']
  } as WebviewFullStateMessage;
}

function stripWebviewMessageMetadata(messages: typeof initialWebviewState.messages): typeof initialWebviewState.messages {
  return messages.map((message) => {
    const { id: _id, revision: _revision, ...rest } = message;
    return rest;
  });
}

function isWebviewStateMessage(value: unknown): value is WebviewStateMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'state';
}

function isMessageType(value: unknown, type: string): boolean {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === type;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}
