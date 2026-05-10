import * as assert from 'assert';
import * as vscode from 'vscode';
import { PiChatViewProvider, type PiRpcClientLike } from '../../piChatViewProvider';
import type { PiAvailableModels, PiModel, PiSessionState, PiSessionStats, RpcEvent } from '../../piRpcClient';

suite('Pi chat view provider', () => {
  test('webview ready does not create a Pi client', async () => {
    let createCalls = 0;
    const provider = new PiChatViewProvider(vscode.Uri.file('/test-extension'), () => {
      createCalls += 1;
      return new FakePiClient(defaultFakeClientOptions());
    });
    const internals = provider as unknown as ProviderInternals;

    await internals.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(createCalls, 0);
    provider.dispose();
  });

  test('first submitted prompt creates a Pi client', async () => {
    let createCalls = 0;
    const client = new FakePiClient(defaultFakeClientOptions());
    const provider = new PiChatViewProvider(vscode.Uri.file('/test-extension'), () => {
      createCalls += 1;
      return client;
    });
    const internals = provider as unknown as ProviderInternals;

    await internals.handleWebviewMessage({ type: 'submit', text: ' hello Pi ' });

    assert.strictEqual(createCalls, 1);
    assert.deepStrictEqual(client.prompts, ['hello Pi']);
    provider.dispose();
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
    const clients = [firstClient, secondClient];
    let createCalls = 0;
    const provider = new PiChatViewProvider(vscode.Uri.file('/test-extension'), () => {
      createCalls += 1;
      const client = clients.shift();
      assert.ok(client, 'Expected a fake client to be available');
      return client;
    });
    const internals = provider as unknown as ProviderInternals;

    await internals.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.strictEqual(createCalls, 1);
    assert.strictEqual(internals.modelProvider, 'openai');
    assert.strictEqual(internals.modelId, 'first-model');
    assert.strictEqual(firstClient.stateCalls, 1);

    internals.startNewSession();
    await flushPromises();

    assert.strictEqual(firstClient.disposed, true);
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(internals.modelProvider, '');
    assert.strictEqual(internals.modelId, '');
    assert.strictEqual(internals.modelReasoning, false);
    assert.strictEqual(internals.thinkingLevel, '');
    assert.deepStrictEqual(internals.modelOptions, []);
    assert.strictEqual(secondClient.stateCalls, 0);

    await internals.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.strictEqual(createCalls, 2);
    assert.strictEqual(internals.modelProvider, 'anthropic');
    assert.strictEqual(internals.modelId, 'second-model');
    assert.strictEqual(internals.modelReasoning, true);
    assert.strictEqual(internals.thinkingLevel, 'high');
    assert.deepStrictEqual(internals.modelOptions, [
      { provider: 'anthropic', id: 'second-model', name: 'Second Model', reasoning: true }
    ]);
    assert.strictEqual(secondClient.stateCalls, 1);
    assert.strictEqual(secondClient.modelsCalls, 1);
    assert.strictEqual(secondClient.statsCalls, 1);
    provider.dispose();
  });
});

type ProviderInternals = {
  handleWebviewMessage(message:
    | { type: 'ready' }
    | { type: 'submit'; text: string }
    | { type: 'refreshMetadata' }
  ): Promise<void>;
  startNewSession(): void;
  modelProvider: string;
  modelId: string;
  modelReasoning: boolean;
  thinkingLevel: string;
  modelOptions: { provider: string; id: string; name: string; reasoning: boolean }[];
};

type FakePiClientOptions = {
  state: PiSessionState;
  models: PiModel[];
};

class FakePiClient implements PiRpcClientLike {
  public disposed = false;
  public stateCalls = 0;
  public modelsCalls = 0;
  public statsCalls = 0;
  public prompts: string[] = [];

  public constructor(private readonly options: FakePiClientOptions) {}

  public isRunning(): boolean {
    return !this.disposed;
  }

  public onEvent(_listener: (event: RpcEvent) => void): () => void {
    return () => {};
  }

  public onError(_listener: (message: string) => void): () => void {
    return () => {};
  }

  public async prompt(message: string): Promise<void> {
    this.prompts.push(message);
  }

  public async getState(): Promise<PiSessionState> {
    this.stateCalls += 1;
    return this.options.state;
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    this.statsCalls += 1;
    return {};
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    this.modelsCalls += 1;
    return { models: this.options.models };
  }

  public async setModel(_provider: string, _modelId: string): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(_level: string): Promise<void> {}

  public async cancelExtensionUiRequest(_id: string): Promise<void> {}

  public dispose(): void {
    this.disposed = true;
  }
}

function defaultFakeClientOptions(): FakePiClientOptions {
  return {
    state: {
      model: { provider: 'openai', id: 'gpt-test', reasoning: false },
      thinkingLevel: 'off'
    },
    models: [{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: false }]
  };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
