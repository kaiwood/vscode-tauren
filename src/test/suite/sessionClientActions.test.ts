import * as assert from 'assert';
import { withSessionClient } from '../../sessions/sessionClientActions';
import type { PiRpcClientLike } from '../../rpc/clientTypes';
import type { ExtensionUiResponse, PiRpcClientOptions, RpcEvent } from '../../rpc/types';

suite('sessionClientActions', () => {
  test('runs background actions against the selected session client', async () => {
    const client = createFakeClient();
    const clientOptions: PiRpcClientOptions[] = [];

    const result = await withSessionClient('/sessions/background.jsonl', {
      createClient: (options) => {
        clientOptions.push(options);
        return client;
      },
      getCwd: () => '/workspace',
      getPiPath: () => '/opt/pi',
      showNotification: () => undefined,
      onError: () => undefined
    }, async (backgroundClient) => {
      assert.strictEqual(backgroundClient, client);
      return 'done';
    });

    assert.strictEqual(result, 'done');
    assert.deepStrictEqual(clientOptions, [{
      cwd: '/workspace',
      piPath: '/opt/pi',
      sessionFile: '/sessions/background.jsonl'
    }]);
    assert.strictEqual(client.disposed, true);
  });

  test('forwards background extension UI requests through the temporary client', async () => {
    const client = createFakeClient();
    const selected: string[] = [];

    await withSessionClient('/sessions/background.jsonl', {
      createClient: () => client,
      extensionUi: {
        notify: () => undefined,
        select: async (_title, options) => {
          selected.push(options[0]);
          return options[0];
        },
        confirm: async () => undefined,
        input: async () => undefined
      },
      showNotification: () => undefined,
      onError: () => undefined
    }, async () => {
      client.emit({
        type: 'extension_ui_request',
        id: 'select-1',
        method: 'select',
        title: 'Pick one',
        options: ['Allow']
      });
      await flushPromises();
    });

    assert.deepStrictEqual(selected, ['Allow']);
    assert.deepStrictEqual(client.extensionUiResponses, [{ id: 'select-1', value: 'Allow' }]);
    assert.strictEqual(client.disposed, true);
  });
});

type FakeClient = PiRpcClientLike & {
  disposed: boolean;
  extensionUiResponses: ExtensionUiResponse[];
  emit(event: RpcEvent): void;
};

function createFakeClient(): FakeClient {
  const eventListeners = new Set<(event: RpcEvent) => void>();
  const client = {
    disposed: false,
    extensionUiResponses: [] as ExtensionUiResponse[],
    onEvent(listener: (event: RpcEvent) => void) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onError() {
      return () => undefined;
    },
    async prompt() {},
    async abort() {},
    async reload() {},
    isRunning() {
      return !client.disposed;
    },
    async getState() {
      return {};
    },
    async getSessionStats() {
      return {};
    },
    async getAvailableModels() {
      return {};
    },
    async getCommands() {
      return {};
    },
    async setModel() {
      return {};
    },
    async setThinkingLevel() {},
    async setSessionName() {},
    async compact() {
      return {};
    },
    async exportHtml() {
      return {};
    },
    async getLastAssistantText() {
      return {};
    },
    async getMessages() {
      return {};
    },
    async switchSession() {
      return {};
    },
    async navigateTree() {
      return {};
    },
    async getForkMessages() {
      return {};
    },
    async fork() {
      return {};
    },
    async clone() {
      return {};
    },
    async respondExtensionUiRequest(response: ExtensionUiResponse) {
      client.extensionUiResponses.push(response);
    },
    dispose() {
      client.disposed = true;
    },
    emit(event: RpcEvent) {
      for (const listener of [...eventListeners]) {
        listener(event);
      }
    }
  } as FakeClient;

  return client;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
