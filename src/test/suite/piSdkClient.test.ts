import * as assert from 'assert';
import { PiSdkClient } from '../../sdk/piSdkClient';
import { createSdkExtensionUiContext } from '../../sdk/extensionUiBridge';
import { loadPiSdk, resetPiSdkLoaderForTests, type PiSdkModule } from '../../sdk/piSdkLoader';
import type { RpcEvent } from '../../rpc/types';

suite('PiSdkClient', () => {
  test('loads the bundled SDK runtime', async () => {
    const previousPackageDir = process.env.PI_PACKAGE_DIR;
    delete process.env.PI_PACKAGE_DIR;
    resetPiSdkLoaderForTests();

    try {
      const sdk = await loadPiSdk();

      assert.strictEqual(typeof sdk.createAgentSessionRuntime, 'function');
      assert.match(process.env.PI_PACKAGE_DIR ?? '', /resources[/\\]pi-sdk-runtime$/);
    } finally {
      if (previousPackageDir === undefined) {
        delete process.env.PI_PACKAGE_DIR;
      } else {
        process.env.PI_PACKAGE_DIR = previousPackageDir;
      }
      resetPiSdkLoaderForTests();
    }
  });

  test('starts lazily and maps SDK session events to RPC events', async () => {
    const harness = createSdkHarness();
    const events: RpcEvent[] = [];

    harness.client.onEvent((event) => events.push(event));

    assert.strictEqual(harness.client.isRunning(), false);

    const state = await harness.client.getState();

    assert.strictEqual(harness.client.isRunning(), true);
    assert.strictEqual(state.sessionFile, '/sessions/current.jsonl');
    assert.strictEqual(state.isStreaming, false);
    assert.strictEqual(state.autoCompactionEnabled, true);
    assert.deepStrictEqual(await harness.client.getSessionStats(), {
      sessionFile: '/sessions/current.jsonl',
      sessionId: 'session-id',
      sessionName: undefined,
      toolResults: 2,
      tokens: { input: 10, output: 20, cacheRead: 3, cacheWrite: 4, total: 37 },
      contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 }
    });
    assert.strictEqual(harness.session.bindCount, 1);
    assert.deepStrictEqual(harness.createdSessionManagers, [{ type: 'create', cwd: '/workspace', sessionDir: '/configured-sessions' }]);

    harness.session.emit({ type: 'agent_start' });

    assert.deepStrictEqual(events, [{ type: 'agent_start' }]);
    harness.client.dispose();
  });

  test('clears failed runtime startup so a later call can retry', async () => {
    const harness = createSdkHarness({ loadSdkFailures: 1 });

    await assert.rejects(harness.client.getState(), /SDK load failed/);

    assert.strictEqual(harness.client.isRunning(), false);

    const state = await harness.client.getState();

    assert.strictEqual(state.sessionFile, '/sessions/current.jsonl');
    assert.strictEqual(harness.client.isRunning(), true);
    harness.client.dispose();
  });

  test('opens the configured session file when provided', async () => {
    const harness = createSdkHarness({ sessionFile: '/sessions/resumed.jsonl' });

    await harness.client.getState();

    assert.deepStrictEqual(harness.createdSessionManagers, [{
      type: 'open',
      path: '/sessions/resumed.jsonl',
      sessionDir: '/configured-sessions'
    }]);
    harness.client.dispose();
  });

  test('resolves prompts after SDK preflight succeeds', async () => {
    const harness = createSdkHarness();
    const promptDeferred = createDeferred<void>();
    harness.session.promptImplementation = (_message, options) => {
      options?.preflightResult?.(true);
      return promptDeferred.promise;
    };

    await harness.client.prompt('hello', 'followUp');

    assert.deepStrictEqual(harness.session.promptCalls, [{ message: 'hello', streamingBehavior: 'followUp' }]);
    promptDeferred.resolve();
    harness.client.dispose();
  });

  test('implements model, command, and history metadata methods', async () => {
    const harness = createSdkHarness();

    assert.deepStrictEqual(await harness.client.getAvailableModels(), { models: harness.session.availableModels });
    assert.deepStrictEqual(await harness.client.getCommands(), {
      commands: [
        {
          name: 'fix-tests',
          description: 'Fix tests',
          source: 'extension',
          sourceInfo: { label: 'extension.ts' }
        },
        {
          name: 'review',
          description: 'Review code',
          source: 'prompt',
          sourceInfo: { label: 'prompt.md' }
        },
        {
          name: 'skill:typescript',
          description: 'TypeScript help',
          source: 'skill',
          sourceInfo: { label: 'SKILL.md' }
        }
      ]
    });

    assert.deepStrictEqual(await harness.client.getMessages(), { messages: harness.session.messages });
    assert.deepStrictEqual(await harness.client.getLastAssistantText(), { text: 'last answer' });

    const selectedModel = await harness.client.setModel('openai', 'gpt-test');
    assert.strictEqual(selectedModel, harness.session.availableModels[0]);
    assert.strictEqual(harness.session.selectedModel, harness.session.availableModels[0]);

    await harness.client.setThinkingLevel('high');
    assert.strictEqual(harness.session.thinkingLevel, 'high');

    await harness.client.setSessionName('  Renamed  ');
    assert.strictEqual(harness.session.sessionName, 'Renamed');

    harness.client.dispose();
  });

  test('rebinds extensions and listeners after session replacement', async () => {
    const replacement = new FakeSession({ sessionFile: '/sessions/replacement.jsonl' });
    const harness = createSdkHarness({ replacementSession: replacement });
    const events: RpcEvent[] = [];
    harness.client.onEvent((event) => events.push(event));

    await harness.client.getState();
    const result = await harness.client.switchSession('/sessions/replacement.jsonl');

    assert.deepStrictEqual(result, { cancelled: false });
    assert.strictEqual(harness.session.bindCount, 1);
    assert.strictEqual(replacement.bindCount, 1);

    harness.session.emit({ type: 'agent_start' });
    replacement.emit({ type: 'agent_end' });

    assert.deepStrictEqual(events, [{ type: 'agent_end' }]);
    harness.client.dispose();
  });

  test('maps extension UI bridge methods to Tau UI callbacks', async () => {
    const notifications: Array<{ message: string; notifyType: string }> = [];
    const ui = createSdkExtensionUiContext({
      notify: (message, notifyType) => notifications.push({ message, notifyType }),
      select: async (_title, options) => options[1],
      confirm: async () => true,
      input: async (_title, placeholder) => placeholder
    });

    assert.strictEqual(await ui.select('Pick', ['A', 'B']), 'B');
    assert.strictEqual(await ui.confirm('Confirm', 'Continue?'), true);
    assert.strictEqual(await ui.input('Input', 'value'), 'value');

    ui.notify('Saved', 'info');

    assert.deepStrictEqual(notifications, [{ message: 'Saved', notifyType: 'info' }]);
  });
});

type PromptOptions = {
  streamingBehavior?: 'steer' | 'followUp';
  preflightResult?: (success: boolean) => void;
};

type SessionManagerCall =
  | { type: 'create'; cwd: string; sessionDir: string | undefined }
  | { type: 'open'; path: string; sessionDir: string | undefined };

type HarnessOptions = {
  sessionFile?: string;
  replacementSession?: FakeSession;
  loadSdkFailures?: number;
};

class FakeSession {
  public model = { provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true };
  public selectedModel: unknown;
  public thinkingLevel = 'medium';
  public isStreaming = false;
  public isCompacting = false;
  public steeringMode = 'all';
  public followUpMode = 'all';
  public sessionId = 'session-id';
  public sessionName: string | undefined;
  public autoCompactionEnabled = true;
  public pendingMessageCount = 0;
  public bindCount = 0;
  public readonly messages = [{ role: 'assistant', content: 'last answer' }];
  public readonly availableModels = [this.model];
  public readonly promptCalls: Array<{ message: string; streamingBehavior?: string }> = [];
  public promptImplementation: (message: string, options?: PromptOptions) => Promise<void> = async (_message, options) => {
    options?.preflightResult?.(true);
  };
  public readonly modelRegistry = {
    getAvailable: () => this.availableModels
  };
  public readonly extensionRunner = {
    getRegisteredCommands: () => [{
      invocationName: 'fix-tests',
      description: 'Fix tests',
      sourceInfo: { label: 'extension.ts' }
    }]
  };
  public readonly promptTemplates = [{
    name: 'review',
    description: 'Review code',
    sourceInfo: { label: 'prompt.md' }
  }];
  public readonly resourceLoader = {
    getSkills: () => ({
      skills: [{
        name: 'typescript',
        description: 'TypeScript help',
        sourceInfo: { label: 'SKILL.md' }
      }]
    })
  };
  public readonly sessionManager = {
    getLeafId: () => 'leaf-1'
  };
  public readonly agent = {
    waitForIdle: async () => undefined
  };
  private readonly listeners = new Set<(event: RpcEvent) => void>();

  public constructor(public readonly options: { sessionFile: string } = { sessionFile: '/sessions/current.jsonl' }) {}

  public get sessionFile(): string {
    return this.options.sessionFile;
  }

  public async bindExtensions(_bindings: unknown): Promise<void> {
    this.bindCount += 1;
  }

  public subscribe(listener: (event: RpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: RpcEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  public async prompt(message: string, options?: PromptOptions): Promise<void> {
    this.promptCalls.push({ message, ...(options?.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}) });
    await this.promptImplementation(message, options);
  }

  public async abort(): Promise<void> {}

  public async reload(): Promise<void> {}

  public async setModel(model: unknown): Promise<void> {
    this.selectedModel = model;
  }

  public setThinkingLevel(level: string): void {
    this.thinkingLevel = level;
  }

  public setSessionName(name: string): void {
    this.sessionName = name;
  }

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportToHtml(): Promise<string> {
    return '/sessions/current.html';
  }

  public getLastAssistantText(): string {
    return 'last answer';
  }

  public getSessionStats(): {} {
    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      toolResults: 2,
      tokens: { input: 10, output: 20, cacheRead: 3, cacheWrite: 4, total: 37 },
      contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 }
    };
  }

  public getUserMessagesForForking(): [] {
    return [];
  }

  public async navigateTree(): Promise<{ cancelled: boolean }> {
    return { cancelled: false };
  }
}

class FakeRuntime {
  public diagnostics = [];
  public modelFallbackMessage: string | undefined;
  private rebindSession: (() => Promise<void>) | undefined;

  public constructor(public session: FakeSession, private readonly replacementSession?: FakeSession) {}

  public setRebindSession(rebindSession?: () => Promise<void>): void {
    this.rebindSession = rebindSession;
  }

  public async switchSession(_sessionPath: string): Promise<{ cancelled: boolean }> {
    this.session = this.replacementSession ?? new FakeSession({ sessionFile: '/sessions/switched.jsonl' });
    await this.rebindSession?.();
    return { cancelled: false };
  }

  public async fork(_entryId: string): Promise<{ cancelled: boolean; selectedText?: string }> {
    this.session = this.replacementSession ?? new FakeSession({ sessionFile: '/sessions/forked.jsonl' });
    await this.rebindSession?.();
    return { cancelled: false, selectedText: 'selected text' };
  }

  public async dispose(): Promise<void> {}
}

function createSdkHarness(options: HarnessOptions = {}): {
  client: PiSdkClient;
  session: FakeSession;
  createdSessionManagers: SessionManagerCall[];
} {
  const session = new FakeSession();
  const createdSessionManagers: SessionManagerCall[] = [];
  let remainingLoadSdkFailures = options.loadSdkFailures ?? 0;
  const sdk = {
    getAgentDir: () => '/agent',
    SettingsManager: {
      create: () => ({ getSessionDir: () => '/configured-sessions' })
    },
    SessionManager: {
      create: (cwd: string, sessionDir?: string) => {
        createdSessionManagers.push({ type: 'create', cwd, sessionDir });
        return { getCwd: () => cwd };
      },
      open: (path: string, sessionDir?: string) => {
        createdSessionManagers.push({ type: 'open', path, sessionDir });
        return { getCwd: () => '/workspace' };
      }
    },
    createAgentSessionServices: async (serviceOptions: { cwd: string; agentDir: string }) => ({
      ...serviceOptions,
      diagnostics: []
    }),
    createAgentSessionFromServices: async () => ({ session }),
    createAgentSessionRuntime: async (createRuntime: (runtimeOptions: unknown) => Promise<{ session: FakeSession }>, runtimeOptions: unknown) => {
      const created = await createRuntime(runtimeOptions);
      return new FakeRuntime(created.session, options.replacementSession);
    }
  } as unknown as PiSdkModule;

  return {
    client: new PiSdkClient({
      cwd: '/workspace',
      sessionFile: options.sessionFile,
      loadSdk: async () => {
        if (remainingLoadSdkFailures > 0) {
          remainingLoadSdkFailures -= 1;
          throw new Error('SDK load failed');
        }
        return sdk;
      }
    }),
    session,
    createdSessionManagers
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] | undefined;
  let reject: Deferred<T>['reject'] | undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve: resolve ?? (() => undefined),
    reject: reject ?? (() => undefined)
  };
}
