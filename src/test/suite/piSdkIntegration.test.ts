import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssistantMessage, Model, Api, SimpleStreamOptions, AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { PiSdkClient } from '../../sdk/piSdkClient';
import { loadPiSdk, type PiSdkModule } from '../../sdk/piSdkLoader';
import type { PiEvent } from '../../pi/types';
import { createCancellingExtensionUi } from '../../extensionUi/types';

const provider = 'tauren-offline-fixture';
const modelId = 'scripted';

type Reply = { text: string } | { tool: string; args: Record<string, string> } | { waitForAbort: true };

/** A bounded event latch: tests wait for actual SDK completion, not prompt preflight. */
function nextEvent(client: PiSdkClient, type: string): Promise<PiEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out waiting for ${type}`)); }, 8000);
    const unsubscribe = client.onEvent(event => {
      if (event.type === type) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

/**
 * Keep the real bundled runtime, sessions, tools, persistence, and client adapter.
 * Only isolate resource paths and replace model I/O with a scripted provider.
 */
async function createFixture(replies: Reply[], extensionFactories: import('@earendil-works/pi-coding-agent').ExtensionFactory[] = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-sdk-integration-'));
  const workspace = path.join(directory, 'workspace');
  const agentDir = path.join(directory, 'agent');
  const sessionDir = path.join(directory, 'sessions');
  await fs.mkdir(workspace);
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: provider, defaultModel: modelId, sessionDir,
    compaction: { enabled: false }, retry: { enabled: false }
  }));
  const sdk = await loadPiSdk();
  // Use the packaged peer so stream objects share the bundled SDK's implementation.
  const importEsm = new Function('specifier', 'return import(specifier);') as
    (specifier: string) => Promise<typeof import('@earendil-works/pi-ai')>;
  const ai = await importEsm(pathToFileURL(path.resolve(__dirname,
    '../../../resources/pi-sdk-runtime/sdk/node_modules/@earendil-works/pi-ai/index.mjs')).href);
  const clients: PiSdkClient[] = [];
  const runtimes: Awaited<ReturnType<PiSdkModule['createAgentSessionRuntime']>>[] = [];
  let requests = 0;

  /** Emit balanced SDK streaming events, or hold the stream until cancellation. */
  function stream(model: Model<Api>, _context: unknown, options?: SimpleStreamOptions): AssistantMessageEventStream {
    const events = ai.createAssistantMessageEventStream();
    const reply = replies[requests++];
    const message: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), stopReason: 'pending', content: [],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
    queueMicrotask(() => {
      events.push({ type: 'start', partial: message });
      if (!reply) {
        message.stopReason = 'error';
        message.errorMessage = 'Unexpected model request: fixture script exhausted';
        events.push({ type: 'error', reason: 'error', error: message });
      } else if ('waitForAbort' in reply) {
        message.content.push({ type: 'text', text: 'Waiting' });
        events.push({ type: 'text_start', contentIndex: 0, partial: message });
        events.push({ type: 'text_delta', contentIndex: 0, delta: 'Waiting', partial: message });
        const abort = () => {
          message.stopReason = 'aborted';
          message.errorMessage = 'Fixture cancelled';
          events.push({ type: 'error', reason: 'aborted', error: message });
          events.end();
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener('abort', abort, { once: true });
        return;
      } else if ('tool' in reply) {
        const toolCall = { type: 'toolCall' as const, id: `call-${requests}`, name: reply.tool, arguments: reply.args };
        message.content.push(toolCall);
        events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        message.stopReason = 'toolUse';
        events.push({ type: 'done', reason: 'toolUse', message });
      } else {
        const block = { type: 'text' as const, text: '' };
        message.content.push(block);
        events.push({ type: 'text_start', contentIndex: 0, partial: message });
        for (const delta of [reply.text.slice(0, 3), reply.text.slice(3)]) {
          block.text += delta;
          events.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
        }
        events.push({ type: 'text_end', contentIndex: 0, content: block.text, partial: message });
        message.stopReason = 'stop';
        events.push({ type: 'done', reason: 'stop', message });
      }
      events.end();
    });
    return events;
  }

  const isolatedSdk: PiSdkModule = {
    ...sdk,
    getAgentDir: () => agentDir,
    // Ignore any inherited PI_CODING_AGENT_SESSION_DIR without changing process.env.
    SessionManager: new Proxy(sdk.SessionManager, {
      get(target, property, receiver) {
        if (property === 'create') {
          return (...args: Parameters<typeof target.create>) => target.create(args[0], sessionDir, args[2]);
        }
        if (property === 'open') {
          return (...args: Parameters<typeof target.open>) => target.open(args[0], sessionDir, args[2]);
        }
        return Reflect.get(target, property, receiver);
      }
    }),
    createAgentSessionServices: async options => {
      const modelRuntime = await sdk.ModelRuntime.create({
        authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'),
        refreshOnCreate: false, allowModelNetwork: false
      });
      modelRuntime.registerProvider(provider, {
        api: 'tauren-fixture', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-fixture-key', streamSimple: stream,
        models: [{ id: modelId, name: 'Offline fixture', reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }]
      });
      return sdk.createAgentSessionServices({ ...options, modelRuntime, resourceLoaderOptions: {
        noExtensions: true, extensionFactories, disabledBuiltinExtensions: ['mcp'], noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Offline test fixture.'
      } });
    },
    createAgentSessionRuntime: async (factory, options) => {
      const runtime = await sdk.createAgentSessionRuntime(factory, options);
      runtimes.push(runtime);
      return runtime;
    }
  };

  /** Await shutdown before reopening session files or removing fixture directories. */
  async function disposeClients() {
    for (const client of clients.splice(0)) client.dispose();
    // Client disposal is fire-and-forget; await the real runtimes as well.
    await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  }

  return {
    workspace,
    disposeClients,
    get requests() { return requests; },
    client(sessionFile?: string, showNotification?: (message: string, type: string) => void) {
      const client = new PiSdkClient({ cwd: workspace, sessionFile,
        extensionUi: createCancellingExtensionUi(showNotification ?? (() => undefined)),
        loadSdk: async () => isolatedSdk });
      clients.push(client);
      return client;
    },
    async close() {
      await disposeClients();
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

async function completeTurn(client: PiSdkClient, prompt: string): Promise<void> {
  // agent_settled follows agent_end after the SDK clears its streaming state.
  const completed = nextEvent(client, 'agent_settled');
  await client.prompt(prompt);
  await completed;
  assert.equal((await client.getState()).isStreaming, false);
}

suite('Pi SDK offline integration', () => {
  test('streams a complete turn through the real bundled SDK and Tauren adapter', async () => {
    const fixture = await createFixture([{ text: 'Hello from the fixture' }]);
    try {
      const client = fixture.client();
      const events: PiEvent[] = [];
      client.onEvent(event => events.push(event));
      await completeTurn(client, 'Say hello');
      assert.equal(fixture.requests, 1);
      assert.equal(events[0].type, 'agent_start');
      assert.equal(events.at(-1)?.type, 'agent_settled');
      assert.ok(events.findIndex(event => event.type === 'agent_end') > 0);
      assert.ok(events.some(event => event.type === 'message_update'));
      assert.match(JSON.stringify((await client.getMessages()).messages), /Hello from the fixture/);
      assert.equal((await client.getLastAssistantText()).text, 'Hello from the fixture');
    } finally { await fixture.close(); }
  });

  test('reopens persisted history and continues without replaying the earlier prompt', async () => {
    const fixture = await createFixture([{ text: 'First answer' }, { text: 'Second answer' }]);
    try {
      const first = fixture.client();
      await completeTurn(first, 'First prompt');
      const sessionFile = (await first.getState()).sessionFile;
      assert.ok(sessionFile);
      assert.equal(path.dirname(sessionFile), path.join(path.dirname(fixture.workspace), 'sessions'));
      const history = (await first.getMessages()).messages;
      assert.match(await fs.readFile(sessionFile, 'utf8'), /First answer/);
      await fixture.disposeClients();
      const resumed = fixture.client(sessionFile);
      assert.deepEqual((await resumed.getMessages()).messages, history);
      assert.equal(fixture.requests, 1, 'Restoring history must not call the model');
      await completeTurn(resumed, 'Second prompt');
      assert.equal(fixture.requests, 2);
      assert.match(JSON.stringify((await resumed.getMessages()).messages), /Second answer/);
    } finally { await fixture.close(); }
  });

  test('executes real write, read, and edit tools against temporary files', async () => {
    const fixture = await createFixture([
      { tool: 'write', args: { path: 'sample.txt', content: 'before\n' } },
      { tool: 'read', args: { path: 'sample.txt' } },
      { tool: 'edit', args: { path: 'sample.txt', oldText: 'before', newText: 'after' } },
      { text: 'Tools finished' }
    ]);
    try {
      const client = fixture.client();
      const events: PiEvent[] = [];
      client.onEvent(event => events.push(event));
      await completeTurn(client, 'Exercise the tools');
      assert.equal(fixture.requests, 4);
      assert.equal(await fs.readFile(path.join(fixture.workspace, 'sample.txt'), 'utf8'), 'after\n');
      const completed = events.filter(event => event.type === 'tool_execution_end');
      assert.deepEqual(completed.map(event => event.toolName), ['write', 'read', 'edit']);
      assert.ok(completed.every(event => !event.isError), JSON.stringify(completed));
      assert.match(JSON.stringify(completed[1]), /before/);
    } finally { await fixture.close(); }
  });

  test('loads a real extension and delivers input source and UI notifications', async () => {
    const sources: string[] = [];
    const notifications: string[] = [];
    const fixture = await createFixture([{ text: 'Extension active' }], [pi => {
      pi.on('input', (event, ctx) => {
        sources.push(event.source);
        ctx.ui.notify('Fixture extension received input', 'info');
        return { action: 'continue' };
      });
    }]);
    try {
      const client = fixture.client(undefined, message => notifications.push(message));
      await completeTurn(client, 'Exercise the extension bridge');
      assert.deepEqual(sources, ['rpc']);
      assert.deepEqual(notifications, ['Fixture extension received input']);
    } finally { await fixture.close(); }
  });

  test('aborts generation and can run a subsequent turn', async () => {
    const fixture = await createFixture([{ waitForAbort: true }, { text: 'Recovered' }]);
    try {
      const client = fixture.client();
      const streaming = nextEvent(client, 'message_update');
      const completed = nextEvent(client, 'agent_settled');
      await client.prompt('Wait for cancellation');
      await streaming;
      await client.abort();
      await completed;
      assert.equal((await client.getState()).isStreaming, false);
      assert.match(JSON.stringify((await client.getMessages()).messages), /aborted/);
      await completeTurn(client, 'Try again');
      assert.equal((await client.getLastAssistantText()).text, 'Recovered');
    } finally { await fixture.close(); }
  });
});
