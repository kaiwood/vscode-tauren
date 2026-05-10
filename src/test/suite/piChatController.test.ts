import * as assert from 'assert';
import { PiChatController, type PiChatControllerOptions, type PiRpcClientLike } from '../../piChatController';
import type { WebviewStateMessage } from '../../chatWebview';
import type { PiModel, PiRpcClientOptions, PiSessionState, PiSessionStats, RpcEvent } from '../../piRpcClient';

suite('PiChatController', () => {
  test('webview ready does not create a Pi client', async () => {
    const harness = createControllerHarness();

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 0);
    assert.strictEqual(harness.states.length, 1);
    harness.controller.dispose();
  });

  test('submit creates a client and sends the trimmed prompt', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client], { cwd: '/workspace' });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: ' hello Pi ' });

    assert.strictEqual(harness.createCalls, 1);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace' }]);
    assert.deepStrictEqual(client.prompts, ['hello Pi']);
    assert.deepStrictEqual(lastState(harness), {
      type: 'state',
      messages: [
        { role: 'user', text: 'hello Pi' },
        { role: 'assistant', text: '' }
      ],
      busy: true,
      modelLabel: '',
      modelProvider: '',
      modelId: '',
      modelReasoning: false,
      thinkingLevel: '',
      modelOptions: [],
      contextUsageLabel: '',
      contextUsageTitle: '',
      contextUsageLevel: ''
    });
    harness.controller.dispose();
  });

  test('submit failure marks the active assistant message as an error', async () => {
    const client = new FakePiClient({ promptError: new Error('Prompt failed') });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Prompt failed', error: true }
    ]);
    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('starting a new session clears metadata until explicit refresh', async () => {
    const firstClient = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'first-model', reasoning: false },
        thinkingLevel: 'off'
      },
      models: [{ provider: 'openai', id: 'first-model', name: 'First Model', reasoning: false }]
    });
    const secondClient = new FakePiClient({
      state: {
        model: { provider: 'anthropic', id: 'second-model', reasoning: true },
        thinkingLevel: 'high'
      },
      models: [{ provider: 'anthropic', id: 'second-model', name: 'Second Model', reasoning: true }]
    });
    const harness = createControllerHarness([firstClient, secondClient]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(lastState(harness).modelProvider, 'openai');
    assert.strictEqual(lastState(harness).modelId, 'first-model');
    assert.strictEqual(firstClient.stateCalls, 1);

    harness.controller.startNewSession();
    await flushPromises();

    assert.strictEqual(firstClient.disposed, true);
    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(lastState(harness).modelProvider, '');
    assert.strictEqual(lastState(harness).modelId, '');
    assert.strictEqual(lastState(harness).modelReasoning, false);
    assert.strictEqual(lastState(harness).thinkingLevel, '');
    assert.deepStrictEqual(lastState(harness).modelOptions, []);
    assert.strictEqual(secondClient.stateCalls, 0);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.strictEqual(harness.createCalls, 2);
    assert.strictEqual(lastState(harness).modelProvider, 'anthropic');
    assert.strictEqual(lastState(harness).modelId, 'second-model');
    assert.strictEqual(lastState(harness).modelReasoning, true);
    assert.strictEqual(lastState(harness).thinkingLevel, 'high');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'anthropic', id: 'second-model', name: 'Second Model', reasoning: true }
    ]);
    assert.strictEqual(secondClient.stateCalls, 1);
    assert.strictEqual(secondClient.modelsCalls, 1);
    assert.strictEqual(secondClient.statsCalls, 1);
    harness.controller.dispose();
  });

  test('stale prompt failure is ignored after a new session', async () => {
    const deferred = createDeferred<void>();
    const client = new FakePiClient({ promptResult: deferred.promise });
    const harness = createControllerHarness([client]);

    const submit = harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    assert.strictEqual(lastState(harness).busy, true);

    harness.controller.startNewSession();
    deferred.reject(new Error('late failure'));
    await submit;

    assert.deepStrictEqual(lastState(harness).messages, []);
    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('agent start and end events update busy state', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    client.emit({ type: 'agent_start' });

    assert.strictEqual(lastState(harness).busy, true);

    client.emit({ type: 'agent_end' });

    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('extension errors are added to the transcript', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    client.emit({ type: 'extension_error', extensionPath: 'test-extension', error: 'boom' });

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Pi test-extension error: boom', error: true }
    ]);
    harness.controller.dispose();
  });

  test('unmatched failed responses are added to the transcript', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    client.emit({ type: 'response', success: false, error: 'command failed' });

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'command failed', error: true }
    ]);
    harness.controller.dispose();
  });

  test('agent end refreshes metadata', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'old-model', reasoning: false },
        thinkingLevel: 'off'
      },
      models: [{ provider: 'openai', id: 'old-model', name: 'Old Model', reasoning: false }],
      stats: { contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 } }
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    const stateCallsBeforeEnd = client.stateCalls;
    client.state = {
      model: { provider: 'anthropic', id: 'new-model', reasoning: true },
      thinkingLevel: 'high'
    };
    client.models = [{ provider: 'anthropic', id: 'new-model', name: 'New Model', reasoning: true }];
    client.stats = { contextUsage: { tokens: 600, contextWindow: 1000 } };

    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end' });
    await flushPromises();

    assert.strictEqual(client.stateCalls, stateCallsBeforeEnd + 1);
    assert.strictEqual(lastState(harness).modelProvider, 'anthropic');
    assert.strictEqual(lastState(harness).modelId, 'new-model');
    assert.strictEqual(lastState(harness).modelReasoning, true);
    assert.strictEqual(lastState(harness).thinkingLevel, 'high');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'anthropic', id: 'new-model', name: 'New Model', reasoning: true }
    ]);
    assert.strictEqual(lastState(harness).contextUsageLabel, '60%');
    assert.strictEqual(lastState(harness).contextUsageLevel, 'medium');
    harness.controller.dispose();
  });
});

type ControllerHarness = {
  controller: PiChatController;
  states: WebviewStateMessage[];
  notifications: { message: string; type: string }[];
  clientOptions: PiRpcClientOptions[];
  readonly createCalls: number;
};

type ControllerHarnessOptions = {
  cwd?: string;
  fullRpcAgentCommunication?: boolean;
};

function createControllerHarness(
  clients: FakePiClient[] = [new FakePiClient()],
  options: ControllerHarnessOptions = {}
): ControllerHarness {
  const states: WebviewStateMessage[] = [];
  const notifications: { message: string; type: string }[] = [];
  const clientOptions: PiRpcClientOptions[] = [];
  const pendingClients = [...clients];
  let createCalls = 0;

  const controllerOptions: PiChatControllerOptions = {
    createClient: (clientOption) => {
      createCalls += 1;
      clientOptions.push(clientOption);
      const client = pendingClients.shift();
      assert.ok(client, 'Expected a fake client to be available');
      return client;
    },
    getCwd: () => options.cwd,
    postState: (message) => {
      states.push(message);
    },
    showNotification: (message, type) => {
      notifications.push({ message, type });
    },
    fullRpcAgentCommunication: options.fullRpcAgentCommunication ?? false
  };

  const controller = new PiChatController(controllerOptions);

  return {
    controller,
    states,
    notifications,
    clientOptions,
    get createCalls(): number {
      return createCalls;
    }
  };
}

type FakePiClientOptions = {
  state?: PiSessionState;
  models?: PiModel[];
  stats?: PiSessionStats;
  promptResult?: Promise<void>;
  promptError?: unknown;
};

class FakePiClient implements PiRpcClientLike {
  public disposed = false;
  public stateCalls = 0;
  public modelsCalls = 0;
  public statsCalls = 0;
  public prompts: string[] = [];
  public state: PiSessionState;
  public models: PiModel[];
  public stats: PiSessionStats;
  public promptResult: Promise<void> | undefined;
  public promptError: unknown;
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(options: FakePiClientOptions = {}) {
    this.state = options.state ?? {
      model: { provider: 'openai', id: 'gpt-test', reasoning: false },
      thinkingLevel: 'off'
    };
    this.models = options.models ?? [{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: false }];
    this.stats = options.stats ?? {};
    this.promptResult = options.promptResult;
    this.promptError = options.promptError;
  }

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

    if (this.promptResult) {
      await this.promptResult;
    }

    if (this.promptError) {
      throw this.promptError;
    }
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

  public async setModel(_provider: string, _modelId: string): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(_level: string): Promise<void> {}

  public async cancelExtensionUiRequest(_id: string): Promise<void> {}

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

function lastState(harness: ControllerHarness): WebviewStateMessage {
  assert.ok(harness.states.length > 0, 'Expected at least one posted state');
  return harness.states[harness.states.length - 1];
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
