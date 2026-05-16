import * as assert from 'assert';
import { TauSessionManager, type TauSessionManagerOptions } from '../../sessions/tauSessionManager';
import type { WebviewSessionItem, WebviewStateMessage, WebviewTreeItem } from '../../sidebar/types';
import type { PiRpcClientLike } from '../../rpc/clientTypes';
import type {
  ExtensionUiResponse,
  PiAgentMessage,
  PiCommand,
  PiModel,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from '../../rpc/types';

suite('TauSessionManager', () => {
  test('tracks background session live status, unread state, and active persistence', async () => {
    const firstClient = new FakePiClient({
      state: {
        sessionFile: '/sessions/one.jsonl',
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off'
      }
    });
    const secondClient = new FakePiClient();
    const sessionFiles: Array<string | undefined> = [];
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile),
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'run in the background' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'showSessions' });

    let backgroundSession = findSession(lastState(harness), '/sessions/one.jsonl');
    assert.strictEqual(backgroundSession?.liveStatus, 'running');
    assert.strictEqual(backgroundSession?.unread, false);
    assert.strictEqual(sessionFiles.at(-1), undefined);

    const persistenceCountBeforeBackgroundEnd = sessionFiles.length;
    firstClient.emit({ type: 'agent_end' });
    await flushPromises();

    backgroundSession = findSession(lastState(harness), '/sessions/one.jsonl');
    assert.strictEqual(backgroundSession?.liveStatus, 'done');
    assert.strictEqual(backgroundSession?.unread, true);
    assert.strictEqual(sessionFiles.length, persistenceCountBeforeBackgroundEnd);

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/one.jsonl' });
    await flushPromises();

    assert.strictEqual(sessionFiles.at(-1), '/sessions/one.jsonl');
    assert.strictEqual(lastState(harness).currentSessionFile, '/sessions/one.jsonl');
    harness.manager.dispose();
  });

  test('shows restored per-session diff stats when selecting a resumed session', async () => {
    const sessionPath = '/sessions/resumed.jsonl';
    const harness = createManagerHarness([new FakePiClient({ state: { sessionFile: sessionPath } })], {
      loadSessionDiffSnapshot: (requestedSessionPath) => requestedSessionPath === sessionPath
        ? { stats: { addedLines: 2, removedLines: 1 } }
        : undefined
    });

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath });
    await flushPromises();
    await wait(20);

    assert.deepStrictEqual(lastState(harness).workspaceDiffStats, { addedLines: 2, removedLines: 1 });
    harness.manager.dispose();
  });

  test('blocks forks while a background session is running', async () => {
    const firstClient = new FakePiClient();
    const secondClient = new FakePiClient();
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl'
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'keep running' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'submit', text: '/fork' });

    assert.deepStrictEqual(harness.notifications, [
      { message: 'Wait for background sessions to finish before forking.', type: 'warning' }
    ]);
    assert.deepStrictEqual(secondClient.forkedEntries, []);
    harness.manager.dispose();
  });
});

type ManagerHarness = {
  manager: TauSessionManager;
  states: WebviewStateMessage[];
  notifications: { message: string; type: string }[];
  clientOptions: PiRpcClientOptions[];
  readonly createCalls: number;
};

type ManagerHarnessOptions = {
  cwd?: string;
  initialSessionFile?: string;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  listSessions?: TauSessionManagerOptions['listSessions'];
  listSessionTree?: (sessionFile: string | undefined) => Promise<WebviewTreeItem[]>;
  loadSessionDiffSnapshot?: TauSessionManagerOptions['loadSessionDiffSnapshot'];
};

function createManagerHarness(
  clients: FakePiClient[],
  options: ManagerHarnessOptions = {}
): ManagerHarness {
  const states: WebviewStateMessage[] = [];
  const notifications: { message: string; type: string }[] = [];
  const clientOptions: PiRpcClientOptions[] = [];
  const pendingClients = [...clients];
  let createCalls = 0;

  const manager = new TauSessionManager({
    createClient: (clientOption) => {
      createCalls += 1;
      clientOptions.push(clientOption);
      const client = pendingClients.shift();
      assert.ok(client, 'Expected a fake client to be available');
      return client;
    },
    postState: (message) => states.push(message),
    showNotification: (message, type) => notifications.push({ message, type }),
    getCwd: () => options.cwd,
    initialSessionFile: options.initialSessionFile,
    onSessionFileChange: options.onSessionFileChange,
    listSessions: options.listSessions,
    listSessionTree: options.listSessionTree,
    loadSessionDiffSnapshot: options.loadSessionDiffSnapshot,
    extensionUi: {
      notify: (message, type) => notifications.push({ message, type }),
      select: async () => undefined,
      confirm: async () => undefined,
      input: async () => undefined
    }
  });

  return {
    manager,
    states,
    notifications,
    clientOptions,
    get createCalls(): number {
      return createCalls;
    }
  };
}

function createSessionItems(currentSessionFile: string | undefined): WebviewSessionItem[] {
  return [
    createSessionItem('/sessions/one.jsonl', 'one', currentSessionFile),
    createSessionItem('/sessions/two.jsonl', 'two', currentSessionFile)
  ];
}

function createSessionItem(path: string, id: string, currentSessionFile: string | undefined): WebviewSessionItem {
  return {
    path,
    id,
    cwd: '/workspace',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:01:00.000Z',
    messageCount: 1,
    firstMessage: `${id} question`,
    depth: 0,
    isLast: id === 'two',
    ancestorContinues: [],
    current: path === currentSessionFile
  };
}

function findSession(state: WebviewStateMessage, path: string): WebviewSessionItem | undefined {
  return state.sessions?.find((session) => session.path === path);
}

function lastState(harness: ManagerHarness): WebviewStateMessage {
  assert.ok(harness.states.length > 0, 'Expected at least one posted state');
  return harness.states[harness.states.length - 1];
}

class FakePiClient implements PiRpcClientLike {
  public disposed = false;
  public readonly prompts: string[] = [];
  public readonly forkedEntries: string[] = [];
  public readonly extensionUiResponses: ExtensionUiResponse[] = [];
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: { state?: PiSessionState } = {}) {}

  public isRunning(): boolean {
    return !this.disposed;
  }

  public onEvent(listener: (event: RpcEvent) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);

    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public async prompt(message: string): Promise<void> {
    this.prompts.push(message);
  }

  public async abort(): Promise<void> {}

  public async reload(): Promise<void> {}

  public async getState(): Promise<PiSessionState> {
    return this.options.state ?? {
      model: { provider: 'openai', id: 'gpt-test', reasoning: false },
      thinkingLevel: 'off'
    };
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    return {};
  }

  public async getAvailableModels(): Promise<{ models?: PiModel[] }> {
    return { models: [{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: false }] };
  }

  public async getCommands(): Promise<{ commands?: PiCommand[] }> {
    return { commands: [] };
  }

  public async setModel(): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(): Promise<void> {}

  public async setSessionName(): Promise<void> {}

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportHtml(): Promise<{}> {
    return {};
  }

  public async getLastAssistantText(): Promise<{ text?: string | null }> {
    return { text: null };
  }

  public async getMessages(): Promise<{ messages?: PiAgentMessage[] }> {
    return { messages: [] };
  }

  public async switchSession(): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async navigateTree(): Promise<{ editorText?: string; cancelled?: boolean; aborted?: boolean }> {
    return { cancelled: false };
  }

  public async getForkMessages(): Promise<{ messages?: Array<{ entryId?: string; text?: string }> }> {
    return { messages: [] };
  }

  public async fork(entryId: string): Promise<{ text?: string; cancelled?: boolean }> {
    this.forkedEntries.push(entryId);
    return { cancelled: false };
  }

  public async clone(): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async respondExtensionUiRequest(response: ExtensionUiResponse): Promise<void> {
    this.extensionUiResponses.push(response);
  }

  public dispose(): void {
    this.disposed = true;
  }

  public emit(event: RpcEvent): void {
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  public emitError(message: string): void {
    for (const listener of [...this.errorListeners]) {
      listener(message);
    }
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
