import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { taurenExportSkinStyleId } from '../../export/taurenExportSkin';
import { exportSessionHtml, forkSession, withSessionClient } from '../../sessions/sessionClientActions';
import type { PiClient } from '../../pi/clientTypes';
import type { PiClientOptions, PiEvent, PiExportHtmlResult } from '../../pi/types';

suite('sessionClientActions', () => {
  test('runs background actions against the selected session client', async () => {
    const client = createFakeClient();
    const clientOptions: PiClientOptions[] = [];

    const result = await withSessionClient('/sessions/background.jsonl', {
      createClient: (options) => {
        clientOptions.push(options);
        return client;
      },
      getCwd: () => '/workspace',
      onError: () => undefined
    }, async (backgroundClient) => {
      assert.strictEqual(backgroundClient, client);
      return 'done';
    });

    assert.strictEqual(result, 'done');
    assert.deepStrictEqual(clientOptions, [{
      cwd: '/workspace',
      sessionFile: '/sessions/background.jsonl'
    }]);
    assert.strictEqual(client.disposed, true);
  });

  test('forkSession returns selected fork text for callers to orchestrate', async () => {
    const client = createFakeClient({
      forkMessages: { messages: [{ entryId: 'entry-1', text: 'Original prompt' }] },
      forkResult: { cancelled: false, text: '  selected prompt  ' }
    });

    const result = await forkSession(client, {
      select: async (_title, options) => options[0]
    });

    assert.deepStrictEqual(result, { status: 'forked', text: 'selected prompt' });
  });

  test('exportSessionHtml applies Tauren export skin when enabled', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tauren-session-export-'));
    const filePath = path.join(tmpDir, 'session.html');

    try {
      await writeFile(filePath, '<html><head></head><body>session</body></html>', 'utf-8');
      const client = createFakeClient({ exportResult: { path: filePath } });

      const result = await exportSessionHtml(client, filePath, { useTaurenExportSkin: true });
      const html = await readFile(filePath, 'utf-8');

      assert.deepStrictEqual(result, { path: filePath });
      assert.ok(html.includes(`id="${taurenExportSkinStyleId}"`));
      assert.ok(html.includes('<body>session</body>'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('exportSessionHtml keeps Pi export untouched when Tauren skin is disabled', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tauren-session-export-'));
    const filePath = path.join(tmpDir, 'session.html');
    const originalHtml = '<html><head></head><body>session</body></html>';

    try {
      await writeFile(filePath, originalHtml, 'utf-8');
      const client = createFakeClient({ exportResult: { path: filePath } });

      await exportSessionHtml(client, filePath, { useTaurenExportSkin: false });

      assert.strictEqual(await readFile(filePath, 'utf-8'), originalHtml);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

});

type FakeClientOptions = {
  exportResult?: PiExportHtmlResult;
  forkMessages?: Awaited<ReturnType<PiClient['getForkMessages']>>;
  forkResult?: Awaited<ReturnType<PiClient['fork']>>;
};

type FakeClient = PiClient & {
  disposed: boolean;
  emit(event: PiEvent): void;
};

function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const eventListeners = new Set<(event: PiEvent) => void>();
  const client = {
    disposed: false,
    onEvent(listener: (event: PiEvent) => void) {
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
      return options.exportResult ?? {};
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
    async importFromJsonl() {
      return {};
    },
    async getSessionTree() {
      return [];
    },
    async setTreeEntryLabel() {},
    async navigateTree() {
      return {};
    },
    async getForkMessages() {
      return options.forkMessages ?? {};
    },
    async fork() {
      return options.forkResult ?? {};
    },
    async clone() {
      return {};
    },
    dispose() {
      client.disposed = true;
    },
    emit(event: PiEvent) {
      for (const listener of [...eventListeners]) {
        listener(event);
      }
    }
  } as FakeClient;

  return client;
}
