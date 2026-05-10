import * as assert from 'assert';
import {
  PiChatController,
  type PiChatControllerOptions,
  type PiChatSessionMetaSnapshot,
  type PiRpcClientLike
} from '../../piChatController';
import type { WebviewSessionItem, WebviewStateMessage } from '../../chatWebview';
import type { StatePublisherScheduler } from '../../statePublisher';
import type {
  ExtensionUiResponse,
  PiAgentMessage,
  PiCommand,
  PiModel,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  RpcEvent
} from '../../piRpcClient';

suite('PiChatController', () => {
  test('webview ready starts one live metadata refresh and dedupes repeated ready messages', async () => {
    const stateDeferred = createDeferred<PiSessionState>();
    const statsDeferred = createDeferred<PiSessionStats>();
    const modelsDeferred = createDeferred<PiModel[]>();
    const client = new FakePiClient({
      stateResult: stateDeferred.promise,
      statsResult: statsDeferred.promise,
      modelsResult: modelsDeferred.promise
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(client.stateCalls, 1);
    assert.strictEqual(client.statsCalls, 1);
    assert.strictEqual(client.modelsCalls, 1);
    assert.strictEqual(lastState(harness).metadataRefreshing, true);

    stateDeferred.resolve({
      model: { provider: 'openai', id: 'live-model', reasoning: false },
      thinkingLevel: 'off'
    });
    statsDeferred.resolve({ contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 } });
    modelsDeferred.resolve([{ provider: 'openai', id: 'live-model', name: 'Live Model', reasoning: false }]);
    await flushPromises();

    assert.strictEqual(lastState(harness).modelId, 'live-model');
    assert.strictEqual(lastState(harness).contextUsageLabel, '10%');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'openai', id: 'live-model', name: 'Live Model', reasoning: false }
    ]);
    assert.strictEqual(lastState(harness).metadataRefreshing, false);
    harness.controller.dispose();
  });

  test('initial cached session metadata is visible before live refresh completes', async () => {
    const client = new FakePiClient({
      stateResult: createDeferred<PiSessionState>().promise,
      statsResult: createDeferred<PiSessionStats>().promise,
      modelsResult: createDeferred<PiModel[]>().promise
    });
    const harness = createControllerHarness([client], {
      initialSessionMeta: {
        model: {
          label: 'cached-model High',
          provider: 'anthropic',
          id: 'cached-model',
          reasoning: true,
          thinkingLevel: 'high'
        },
        modelOptions: [
          { provider: 'anthropic', id: 'cached-model', name: 'Cached Model', reasoning: true }
        ],
        contextUsage: {
          label: '42%',
          title: 'Cached context usage',
          level: 'low'
        }
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(harness.states[0].modelLabel, 'cached-model High');
    assert.strictEqual(harness.states[0].contextUsageLabel, '42%');
    assert.deepStrictEqual(harness.states[0].modelOptions, [
      { provider: 'anthropic', id: 'cached-model', name: 'Cached Model', reasoning: true }
    ]);
    assert.strictEqual(lastState(harness).metadataRefreshing, true);
    assert.strictEqual(harness.createCalls, 1);
    harness.controller.dispose();
  });

  test('initial session file reconnects and restores messages from Pi history', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      },
      messages: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
        { role: 'toolResult', content: [{ type: 'text', text: 'hidden tool output' }] },
        { role: 'assistant', content: [], errorMessage: 'Earlier failure' }
      ]
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl'
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.deepStrictEqual(harness.clientOptions, [
      { cwd: '/workspace', sessionFile: '/sessions/current.jsonl' }
    ]);
    assert.strictEqual(client.messagesCalls, 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Earlier question' },
      { role: 'assistant', text: 'Earlier answer' },
      { role: 'assistant', text: 'Earlier failure', error: true }
    ]);
    harness.controller.dispose();
  });

  test('session switcher lists sessions and restores selected session messages', async () => {
    const sessionFiles: Array<string | undefined> = [];
    const sessions: WebviewSessionItem[] = [
      {
        path: '/sessions/next.jsonl',
        id: 'next',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 2,
        firstMessage: 'Next question',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: false
      }
    ];
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/next.jsonl'
      },
      messages: [
        { role: 'user', content: 'Next question' },
        { role: 'assistant', content: [{ type: 'text', text: 'Next answer' }] }
      ]
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile),
      listSessions: async (cwd, currentSessionFile) => sessions.map((session) => ({
        ...session,
        current: session.path === currentSessionFile,
        cwd: cwd ?? session.cwd
      }))
    });

    await harness.controller.handleWebviewMessage({ type: 'showSessions' });

    assert.strictEqual(lastState(harness).viewMode, 'sessions');
    assert.strictEqual(lastState(harness).sessionsRefreshing, false);
    assert.deepStrictEqual(lastState(harness).sessions, sessions);

    await harness.controller.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/next.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(client.switchedSessions, ['/sessions/next.jsonl']);
    assert.strictEqual(client.messagesCalls, 1);
    assert.deepStrictEqual(sessionFiles, ['/sessions/next.jsonl']);
    assert.strictEqual(lastState(harness).viewMode, undefined);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Next question' },
      { role: 'assistant', text: 'Next answer' }
    ]);
    harness.controller.dispose();
  });

  test('metadata refresh publishes the current session file', async () => {
    const sessionFiles: Array<string | undefined> = [];
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const harness = createControllerHarness([client], {
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile)
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.deepStrictEqual(sessionFiles, ['/sessions/current.jsonl']);
    harness.controller.dispose();
  });

  test('submit passes configured Pi path to the client', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client], { cwd: '/workspace', piPath: 'npx pi' });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello Pi' });

    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace', piPath: 'npx pi' }]);
    harness.controller.dispose();
  });

  test('pi path changes restart an idle client with the next configured path', async () => {
    let piPath = 'old-pi';
    const oldClient = new FakePiClient();
    const newClient = new FakePiClient();
    const harness = createControllerHarness([oldClient, newClient], {
      cwd: '/workspace',
      getPiPath: () => piPath
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace', piPath: 'old-pi' }]);
    assert.strictEqual(oldClient.disposed, false);

    piPath = 'new-pi';
    harness.controller.handlePiPathChanged();
    await flushPromises();

    assert.strictEqual(oldClient.disposed, true);
    assert.strictEqual(harness.createCalls, 2);
    assert.deepStrictEqual(harness.clientOptions[1], { cwd: '/workspace', piPath: 'new-pi' });
    assert.strictEqual(newClient.stateCalls, 1);
    assert.strictEqual(newClient.commandsCalls, 1);
    harness.controller.dispose();
  });

  test('pi path changes wait for a busy run to publish its session file before reconnecting', async () => {
    let piPath = 'old-pi';
    const oldClient = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const newClient = new FakePiClient();
    const harness = createControllerHarness([oldClient, newClient], {
      cwd: '/workspace',
      getPiPath: () => piPath
    });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello Pi' });

    piPath = 'new-pi';
    harness.controller.handlePiPathChanged();

    assert.strictEqual(oldClient.disposed, false);
    assert.strictEqual(harness.createCalls, 1);

    oldClient.emit({ type: 'agent_end' });
    await flushPromises();

    assert.strictEqual(oldClient.disposed, true);
    assert.strictEqual(harness.createCalls, 2);
    assert.deepStrictEqual(harness.clientOptions[1], {
      cwd: '/workspace',
      piPath: 'new-pi',
      sessionFile: '/sessions/current.jsonl'
    });
    assert.strictEqual(newClient.stateCalls, 1);
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
      contextUsageLevel: '',
      metadataRefreshing: false,
      slashCommands: [],
      slashCommandsRefreshing: false
    });
    harness.controller.dispose();
  });

  test('submit sends one-shot IDE context without showing it in the transcript', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    harness.controller.addPromptContext({
      kind: 'selection',
      path: 'src/foo.ts',
      label: 'foo.ts:2-4',
      title: 'src/foo.ts:2-4',
      languageId: 'typescript',
      startLine: 2,
      endLine: 4,
      text: 'const answer = 42;'
    });

    assert.deepStrictEqual(lastState(harness).promptContext, [
      { id: 'context-1', kind: 'selection', label: 'foo.ts:2-4', title: 'src/foo.ts:2-4' }
    ]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'explain this' });

    assert.strictEqual(client.prompts.length, 1);
    assert.ok(client.prompts[0].includes('<!-- piui:ide-context:start -->'));
    assert.ok(client.prompts[0].includes('<selection path="src/foo.ts" start_line="2" end_line="4" language="typescript">'));
    assert.ok(client.prompts[0].includes('```typescript\nconst answer = 42;\n```'));
    assert.ok(client.prompts[0].endsWith('\n\nexplain this'));
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'explain this' },
      { role: 'assistant', text: '' }
    ]);
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.controller.dispose();
  });

  test('prompt context can be removed before submit', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    harness.controller.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });

    const contextId = lastState(harness).promptContext?.[0]?.id;
    assert.strictEqual(contextId, 'context-1');
    assert.ok(contextId);

    await harness.controller.handleWebviewMessage({ type: 'removePromptContext', id: contextId });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });

    assert.deepStrictEqual(client.prompts, ['hello']);
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.controller.dispose();
  });

  test('busy queued prompts can include one-shot IDE context', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    harness.controller.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'change direction' });

    assert.strictEqual(client.prompts.length, 2);
    assert.strictEqual(client.prompts[0], 'hello');
    assert.ok(client.prompts[1].includes('<file path="src/foo.ts" />'));
    assert.ok(client.prompts[1].endsWith('\n\nchange direction'));
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.summary, 'change direction');
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.controller.dispose();
  });

  test('restored history hides PiUI IDE context wrappers from user messages', async () => {
    const client = new FakePiClient({
      messages: [
        {
          role: 'user',
          content: '<!-- piui:ide-context:start -->\n<ide_context source="vscode-piui">\n<file path="src/foo.ts" />\n</ide_context>\n<!-- piui:ide-context:end -->\n\nexplain this'
        }
      ]
    });
    const harness = createControllerHarness([client], {
      initialSessionFile: '/sessions/current.jsonl'
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'explain this' }
    ]);
    harness.controller.dispose();
  });

  test('busy submit defaults to steering and adds a compact queued notice', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'change direction' });

    assert.deepStrictEqual(client.prompts, ['hello', 'change direction']);
    assert.deepStrictEqual(client.promptStreamingBehaviors, [undefined, 'steer']);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      {
        role: 'assistant',
        text: '',
        activities: [
          {
            id: 'activity-0-1',
            kind: 'queue',
            title: 'Steering queued',
            status: 'info',
            summary: 'change direction'
          }
        ]
      }
    ]);
    harness.controller.dispose();
  });

  test('busy submit can queue a follow-up', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await harness.controller.handleWebviewMessage({
      type: 'submit',
      text: 'afterwards do this',
      streamingBehavior: 'followUp'
    });

    assert.deepStrictEqual(client.prompts, ['hello', 'afterwards do this']);
    assert.deepStrictEqual(client.promptStreamingBehaviors, [undefined, 'followUp']);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.title, 'Follow-up queued');
    harness.controller.dispose();
  });

  test('local slash commands are blocked while busy', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/new' });

    assert.deepStrictEqual(client.prompts, ['hello']);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.title, '/new not queued');
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.status, 'error');
    harness.controller.dispose();
  });

  test('abort sends RPC abort while keeping the current turn busy until agent events arrive', async () => {
    const promptDeferred = createDeferred<void>();
    const client = new FakePiClient({ promptResult: promptDeferred.promise });
    const harness = createControllerHarness([client]);

    const submitPromise = harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });

    assert.strictEqual(lastState(harness).busy, true);
    await harness.controller.handleWebviewMessage({ type: 'abort' });

    assert.strictEqual(client.abortCalls, 1);
    assert.strictEqual(lastState(harness).busy, true);

    promptDeferred.resolve();
    await submitPromise;
    harness.controller.dispose();
  });

  test('aborted responses append a confirmation without replacing partial output', async () => {
    const promptDeferred = createDeferred<void>();
    const client = new FakePiClient({ promptResult: promptDeferred.promise });
    const harness = createControllerHarness([client]);

    const submitPromise = harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial output' } });
    await harness.controller.handleWebviewMessage({ type: 'abort' });
    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'aborted' } });

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'partial output\n\nAborted.' }
    ]);

    client.emit({ type: 'agent_end' });
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'partial output\n\nAborted.' }
    ]);
    assert.strictEqual(lastState(harness).busy, false);

    promptDeferred.resolve();
    await submitPromise;
    harness.controller.dispose();
  });

  test('unsupported built-in slash commands are handled locally', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/settings' });

    assert.strictEqual(harness.createCalls, 0);
    assert.deepStrictEqual(client.prompts, []);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: '/settings is a Pi terminal command that is not supported in the VS Code sidebar yet.' }
    ]);
    harness.controller.dispose();
  });

  test('supported built-in slash commands route to RPC commands', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/name Feature work' });

    assert.strictEqual(harness.createCalls, 1);
    assert.deepStrictEqual(client.sessionNames, ['Feature work']);
    assert.deepStrictEqual(client.prompts, []);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Session name set to "Feature work".' }
    ]);
    harness.controller.dispose();
  });

  test('resume slash command opens the session switcher', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/resume' });

    assert.strictEqual(harness.createCalls, 0);
    assert.deepStrictEqual(client.prompts, []);
    assert.strictEqual(lastState(harness).viewMode, 'sessions');
    harness.controller.dispose();
  });

  test('fork slash command selects a message, switches to forked session, and prefills composer', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/forked.jsonl'
      },
      forkMessages: [
        { entryId: 'u1', text: 'First prompt' },
        { entryId: 'u2', text: 'Second prompt' }
      ],
      forkResult: { text: 'Second prompt', cancelled: false },
      messages: [{ role: 'user', content: 'First prompt' }]
    });
    const harness = createControllerHarness([client], {
      extensionUi: {
        notify: () => {},
        select: async (title, options) => {
          assert.strictEqual(title, 'Fork from message');
          assert.deepStrictEqual(options, ['1. First prompt', '2. Second prompt']);
          return options[1];
        },
        confirm: async () => undefined,
        input: async () => undefined
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/fork' });

    assert.strictEqual(client.forkMessagesCalls, 1);
    assert.deepStrictEqual(client.forkedEntries, ['u2']);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'First prompt' }
    ]);
    assert.strictEqual(lastState(harness).currentSessionFile, '/sessions/forked.jsonl');
    const composerState = harness.states.find((state) => state.composerTextRevision === 1);
    assert.ok(composerState);
    assert.strictEqual(composerState.composerText, 'Second prompt');
    harness.controller.dispose();
  });

  test('clone slash command switches to cloned session messages', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/cloned.jsonl'
      },
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
      ]
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/clone' });

    assert.strictEqual(client.cloneCalls, 1);
    assert.deepStrictEqual(client.prompts, []);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there' }
    ]);
    assert.strictEqual(lastState(harness).currentSessionFile, '/sessions/cloned.jsonl');
    harness.controller.dispose();
  });

  test('reload slash command reloads Pi resources and refreshes command metadata', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'anthropic', id: 'claude-test', reasoning: true },
        thinkingLevel: 'high'
      },
      models: [{ provider: 'anthropic', id: 'claude-test', name: 'Claude Test', reasoning: true }],
      stats: { contextUsage: { tokens: 250, contextWindow: 1000, percent: 25 } },
      commands: [
        { name: 'skill:new-skill', description: 'Newly added skill', source: 'skill', location: 'project' }
      ]
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/reload' });

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(client.reloadCalls, 1);
    assert.strictEqual(client.stateCalls, 1);
    assert.strictEqual(client.modelsCalls, 1);
    assert.strictEqual(client.statsCalls, 1);
    assert.strictEqual(client.commandsCalls, 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Reloading Pi resources...' },
      { role: 'system', text: 'Reloaded keybindings, extensions, skills, prompts, and themes.' }
    ]);
    assert.strictEqual(lastState(harness).modelId, 'claude-test');
    assert.deepStrictEqual(lastState(harness).slashCommands, [
      { name: 'skill:new-skill', description: 'Newly added skill', source: 'skill', location: 'project', path: undefined }
    ]);
    harness.controller.dispose();
  });

  test('reload slash command restarts Pi when RPC reload is unavailable', async () => {
    const oldClient = new FakePiClient({
      reloadError: new Error('Unknown command: reload'),
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const newClient = new FakePiClient({
      commands: [
        { name: 'skill:new-skill', description: 'Newly added skill', source: 'skill', location: 'project' }
      ]
    });
    const harness = createControllerHarness([oldClient, newClient]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/reload' });

    assert.strictEqual(harness.createCalls, 2);
    assert.strictEqual(harness.clientOptions[1].sessionFile, '/sessions/current.jsonl');
    assert.strictEqual(oldClient.reloadCalls, 1);
    assert.strictEqual(oldClient.stateCalls, 1);
    assert.strictEqual(oldClient.disposed, true);
    assert.strictEqual(newClient.commandsCalls, 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Reloading Pi resources...' },
      { role: 'system', text: 'Pi RPC reload is not supported by this Pi version; restarted Pi and reconnected to the current session.' },
      { role: 'system', text: 'Reloaded skills, prompts, extensions, metadata, and restored LLM session context.' }
    ]);
    assert.deepStrictEqual(lastState(harness).slashCommands, [
      { name: 'skill:new-skill', description: 'Newly added skill', source: 'skill', location: 'project', path: undefined }
    ]);
    harness.controller.dispose();
  });

  test('reload slash command reports reload failures', async () => {
    const client = new FakePiClient({ reloadError: new Error('reload unavailable') });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/reload' });

    assert.strictEqual(client.reloadCalls, 1);
    assert.strictEqual(client.commandsCalls, 0);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Reloading Pi resources...' },
      { role: 'system', text: 'reload unavailable', error: true }
    ]);
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

  test('starting a new session clears the remembered session file', async () => {
    const sessionFiles: Array<string | undefined> = [];
    const nextClient = new FakePiClient({
      stateResult: createDeferred<PiSessionState>().promise,
      statsResult: createDeferred<PiSessionStats>().promise,
      modelsResult: createDeferred<PiModel[]>().promise
    });
    const harness = createControllerHarness([nextClient], {
      initialSessionFile: '/sessions/current.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile)
    });

    harness.controller.startNewSession();
    await flushPromises();

    assert.deepStrictEqual(sessionFiles, [undefined]);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: undefined }]);
    harness.controller.dispose();
  });

  test('starting a new session keeps model metadata visible while live refresh runs', async () => {
    const secondStateDeferred = createDeferred<PiSessionState>();
    const secondStatsDeferred = createDeferred<PiSessionStats>();
    const secondModelsDeferred = createDeferred<PiModel[]>();
    const firstClient = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'first-model', reasoning: false },
        thinkingLevel: 'off'
      },
      models: [{ provider: 'openai', id: 'first-model', name: 'First Model', reasoning: false }],
      stats: { contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 } }
    });
    const secondClient = new FakePiClient({
      stateResult: secondStateDeferred.promise,
      statsResult: secondStatsDeferred.promise,
      modelsResult: secondModelsDeferred.promise
    });
    const harness = createControllerHarness([firstClient, secondClient]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(lastState(harness).modelProvider, 'openai');
    assert.strictEqual(lastState(harness).modelId, 'first-model');
    assert.strictEqual(lastState(harness).contextUsageLabel, '10%');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'openai', id: 'first-model', name: 'First Model', reasoning: false }
    ]);
    assert.strictEqual(firstClient.stateCalls, 1);

    harness.controller.startNewSession();
    await flushPromises();

    assert.strictEqual(firstClient.disposed, true);
    assert.strictEqual(harness.createCalls, 2);
    assert.strictEqual(lastState(harness).modelProvider, 'openai');
    assert.strictEqual(lastState(harness).modelId, 'first-model');
    assert.strictEqual(lastState(harness).modelReasoning, false);
    assert.strictEqual(lastState(harness).thinkingLevel, 'off');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'openai', id: 'first-model', name: 'First Model', reasoning: false }
    ]);
    assert.strictEqual(lastState(harness).contextUsageLabel, '');
    assert.strictEqual(lastState(harness).metadataRefreshing, true);
    assert.strictEqual(secondClient.stateCalls, 1);
    assert.strictEqual(secondClient.modelsCalls, 1);
    assert.strictEqual(secondClient.statsCalls, 1);

    secondStateDeferred.resolve({
      model: { provider: 'anthropic', id: 'second-model', reasoning: true },
      thinkingLevel: 'high'
    });
    secondStatsDeferred.resolve({});
    secondModelsDeferred.resolve([{ provider: 'anthropic', id: 'second-model', name: 'Second Model', reasoning: true }]);
    await flushPromises();

    assert.strictEqual(harness.createCalls, 2);
    assert.strictEqual(lastState(harness).modelProvider, 'anthropic');
    assert.strictEqual(lastState(harness).modelId, 'second-model');
    assert.strictEqual(lastState(harness).modelReasoning, true);
    assert.strictEqual(lastState(harness).thinkingLevel, 'high');
    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'anthropic', id: 'second-model', name: 'Second Model', reasoning: true }
    ]);
    assert.strictEqual(lastState(harness).metadataRefreshing, false);
    harness.controller.dispose();
  });

  test('refresh metadata updates model, options, and context independently as each call resolves', async () => {
    const stateDeferred = createDeferred<PiSessionState>();
    const statsDeferred = createDeferred<PiSessionStats>();
    const modelsDeferred = createDeferred<PiModel[]>();
    const client = new FakePiClient({
      stateResult: stateDeferred.promise,
      statsResult: statsDeferred.promise,
      modelsResult: modelsDeferred.promise
    });
    const cachedSessionChanges: PiChatSessionMetaSnapshot[] = [];
    const harness = createControllerHarness([client], {
      onSessionMetaChange: (metadata) => cachedSessionChanges.push(metadata)
    });

    const refresh = harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    await flushPromises();

    assert.strictEqual(client.stateCalls, 1);
    assert.strictEqual(client.statsCalls, 1);
    assert.strictEqual(client.modelsCalls, 1);
    assert.strictEqual(lastState(harness).metadataRefreshing, true);

    statsDeferred.resolve({ contextUsage: { tokens: 600, contextWindow: 1000 } });
    await flushPromises();

    assert.strictEqual(lastState(harness).contextUsageLabel, '60%');

    stateDeferred.resolve({
      model: { provider: 'anthropic', id: 'fast-model', reasoning: true },
      thinkingLevel: 'high'
    });
    await flushPromises();

    assert.strictEqual(lastState(harness).modelProvider, 'anthropic');
    assert.strictEqual(lastState(harness).modelId, 'fast-model');
    assert.strictEqual(lastState(harness).modelLabel, 'fast-model High');
    assert.deepStrictEqual(lastState(harness).modelOptions, []);
    assert.deepStrictEqual(cachedSessionChanges[cachedSessionChanges.length - 1].model, {
      label: 'fast-model High',
      provider: 'anthropic',
      id: 'fast-model',
      reasoning: true,
      thinkingLevel: 'high'
    });

    modelsDeferred.resolve([{ provider: 'anthropic', id: 'fast-model', name: 'Fast Model', reasoning: true }]);
    await refresh;

    assert.deepStrictEqual(lastState(harness).modelOptions, [
      { provider: 'anthropic', id: 'fast-model', name: 'Fast Model', reasoning: true }
    ]);
    assert.strictEqual(lastState(harness).contextUsageLabel, '60%');
    assert.strictEqual(lastState(harness).metadataRefreshing, false);
    harness.controller.dispose();
  });

  test('stale prompt failure is ignored after a new session', async () => {
    const deferred = createDeferred<void>();
    const client = new FakePiClient({ promptResult: deferred.promise });
    const nextClient = new FakePiClient({
      stateResult: createDeferred<PiSessionState>().promise,
      statsResult: createDeferred<PiSessionStats>().promise,
      modelsResult: createDeferred<PiModel[]>().promise
    });
    const harness = createControllerHarness([client, nextClient]);

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

  test('streaming text deltas are coalesced into one scheduled state post', async () => {
    const client = new FakePiClient();
    const scheduler = new FakeStateScheduler();
    const harness = createControllerHarness([client], { stateScheduler: scheduler });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    const stateCountAfterSubmit = harness.states.length;

    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'A' } });
    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'B' } });
    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'C' } });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit);
    assert.strictEqual(scheduler.pendingCount, 1);

    scheduler.runAll();

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'ABC' }
    ]);
    harness.controller.dispose();
  });

  test('agent end flushes a pending streaming state post', async () => {
    const client = new FakePiClient();
    const scheduler = new FakeStateScheduler();
    const harness = createControllerHarness([client], { stateScheduler: scheduler });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    const stateCountAfterSubmit = harness.states.length;

    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } });
    client.emit({ type: 'agent_end' });

    assert.strictEqual(scheduler.pendingCount, 0);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'done' }
    ]);
    assert.strictEqual(lastState(harness).busy, false);
    assert.ok(harness.states.length > stateCountAfterSubmit);
    const stateCountAfterEnd = harness.states.length;

    scheduler.runAll();

    assert.strictEqual(harness.states.length, stateCountAfterEnd);
    harness.controller.dispose();
  });

  test('assistant errors flush a pending streaming state post', async () => {
    const client = new FakePiClient();
    const scheduler = new FakeStateScheduler();
    const harness = createControllerHarness([client], { stateScheduler: scheduler });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    const stateCountAfterSubmit = harness.states.length;

    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } });
    client.emit({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'stream failed' } });

    assert.strictEqual(scheduler.pendingCount, 0);
    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'stream failed', error: true }
    ]);

    scheduler.runAll();

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);
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

  test('extension UI select requests are routed through the configured UI', async () => {
    const client = new FakePiClient();
    const selectCalls: { title: string; options: string[] }[] = [];
    const harness = createControllerHarness([client], {
      extensionUi: {
        notify: () => {},
        select: (title, options) => {
          selectCalls.push({ title, options });
          return 'Allow';
        },
        confirm: async () => undefined,
        input: async () => undefined
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    client.emit({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-1',
      title: 'Allow command?',
      options: ['Allow', 'Block']
    });
    await flushPromises();

    assert.deepStrictEqual(selectCalls, [{ title: 'Allow command?', options: ['Allow', 'Block'] }]);
    assert.deepStrictEqual(client.extensionUiResponses, [{ id: 'select-1', value: 'Allow' }]);
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

  test('refresh slash commands includes filtered slash commands', async () => {
    const client = new FakePiClient({
      commands: [
        { name: 'skill:search', description: 'Search docs', source: 'skill', location: 'user', path: '/skills/search/SKILL.md' },
        { name: '', description: 'Invalid', source: 'prompt' },
        { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt', location: 'project' },
        { name: 'session-name', description: 'Set session name', source: 'extension' }
      ]
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshSlashCommands' });

    assert.strictEqual(client.commandsCalls, 1);
    assert.deepStrictEqual(lastState(harness).slashCommands, [
      { name: 'session-name', description: 'Set session name', source: 'extension', location: undefined, path: undefined },
      { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt', location: 'project', path: undefined },
      { name: 'skill:search', description: 'Search docs', source: 'skill', location: 'user', path: '/skills/search/SKILL.md' }
    ]);
    assert.strictEqual(lastState(harness).slashCommandsRefreshing, false);
    harness.controller.dispose();
  });

  test('failed slash command refresh preserves previous commands', async () => {
    const client = new FakePiClient({
      commands: [{ name: 'fix-tests', description: 'Fix failing tests', source: 'prompt' }]
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshSlashCommands' });
    client.commandsError = new Error('commands unavailable');
    await harness.controller.refreshSlashCommands({ startClient: true, force: true });

    assert.deepStrictEqual(lastState(harness).slashCommands, [
      { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt', location: undefined, path: undefined }
    ]);
    assert.strictEqual(lastState(harness).slashCommandsRefreshing, false);
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
  piPath?: string;
  getPiPath?: () => string | undefined;
  extensionUi?: PiChatControllerOptions['extensionUi'];
  fullRpcAgentCommunication?: boolean;
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  listSessions?: (cwd: string | undefined, currentSessionFile: string | undefined) => Promise<WebviewSessionItem[]>;
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
    getPiPath: options.getPiPath ?? (() => options.piPath),
    postState: (message) => {
      states.push(message);
    },
    showNotification: (message, type) => {
      notifications.push({ message, type });
    },
    extensionUi: options.extensionUi,
    fullRpcAgentCommunication: options.fullRpcAgentCommunication ?? false,
    stateScheduler: options.stateScheduler,
    initialSessionMeta: options.initialSessionMeta,
    initialSessionFile: options.initialSessionFile,
    onSessionMetaChange: options.onSessionMetaChange,
    onSessionFileChange: options.onSessionFileChange,
    listSessions: options.listSessions
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
  stateResult?: Promise<PiSessionState>;
  modelsResult?: Promise<PiModel[]>;
  statsResult?: Promise<PiSessionStats>;
  commands?: PiCommand[];
  messages?: PiAgentMessage[];
  messagesResult?: Promise<PiAgentMessage[]>;
  commandsResult?: Promise<PiCommand[]>;
  commandsError?: unknown;
  reloadError?: unknown;
  switchSessionResult?: { cancelled?: boolean };
  switchSessionError?: unknown;
  forkMessages?: Array<{ entryId?: string; text?: string }>;
  forkResult?: { text?: string; cancelled?: boolean };
  cloneResult?: { cancelled?: boolean };
  promptResult?: Promise<void>;
  promptError?: unknown;
};

class FakeStateScheduler implements StatePublisherScheduler {
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  public get pendingCount(): number {
    return this.callbacks.size;
  }

  public schedule(callback: () => void): { dispose(): void } {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);

    return {
      dispose: () => {
        this.callbacks.delete(id);
      }
    };
  }

  public runAll(): void {
    while (this.callbacks.size > 0) {
      const next = this.callbacks.entries().next().value;

      if (!next) {
        return;
      }

      const [id, callback] = next;
      this.callbacks.delete(id);
      callback();
    }
  }
}

class FakePiClient implements PiRpcClientLike {
  public disposed = false;
  public stateCalls = 0;
  public modelsCalls = 0;
  public statsCalls = 0;
  public commandsCalls = 0;
  public abortCalls = 0;
  public reloadCalls = 0;
  public prompts: string[] = [];
  public promptStreamingBehaviors: Array<'steer' | 'followUp' | undefined> = [];
  public sessionNames: string[] = [];
  public extensionUiResponses: ExtensionUiResponse[] = [];
  public state: PiSessionState;
  public models: PiModel[];
  public stats: PiSessionStats;
  public commands: PiCommand[];
  public messages: PiAgentMessage[];
  public stateResult: Promise<PiSessionState> | undefined;
  public modelsResult: Promise<PiModel[]> | undefined;
  public statsResult: Promise<PiSessionStats> | undefined;
  public commandsResult: Promise<PiCommand[]> | undefined;
  public messagesResult: Promise<PiAgentMessage[]> | undefined;
  public messagesCalls = 0;
  public commandsError: unknown;
  public reloadError: unknown;
  public switchSessionResult: { cancelled?: boolean };
  public switchSessionError: unknown;
  public switchedSessions: string[] = [];
  public forkMessages: Array<{ entryId?: string; text?: string }>;
  public forkMessagesCalls = 0;
  public forkResult: { text?: string; cancelled?: boolean };
  public forkedEntries: string[] = [];
  public cloneResult: { cancelled?: boolean };
  public cloneCalls = 0;
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
    this.commands = options.commands ?? [];
    this.messages = options.messages ?? [];
    this.stateResult = options.stateResult;
    this.modelsResult = options.modelsResult;
    this.statsResult = options.statsResult;
    this.commandsResult = options.commandsResult;
    this.messagesResult = options.messagesResult;
    this.commandsError = options.commandsError;
    this.reloadError = options.reloadError;
    this.switchSessionResult = options.switchSessionResult ?? { cancelled: false };
    this.switchSessionError = options.switchSessionError;
    this.forkMessages = options.forkMessages ?? [];
    this.forkResult = options.forkResult ?? { cancelled: false };
    this.cloneResult = options.cloneResult ?? { cancelled: false };
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

  public async prompt(message: string, streamingBehavior?: 'steer' | 'followUp'): Promise<void> {
    this.prompts.push(message);
    this.promptStreamingBehaviors.push(streamingBehavior);

    if (this.promptResult) {
      await this.promptResult;
    }

    if (this.promptError) {
      throw this.promptError;
    }
  }

  public async abort(): Promise<void> {
    this.abortCalls += 1;
  }

  public async reload(): Promise<void> {
    this.reloadCalls += 1;

    if (this.reloadError) {
      throw this.reloadError;
    }
  }

  public async getState(): Promise<PiSessionState> {
    this.stateCalls += 1;
    return this.stateResult ?? this.state;
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    this.statsCalls += 1;
    return this.statsResult ?? this.stats;
  }

  public async getAvailableModels(): Promise<{ models?: PiModel[] }> {
    this.modelsCalls += 1;
    return { models: await (this.modelsResult ?? this.models) };
  }

  public async getCommands(): Promise<{ commands?: PiCommand[] }> {
    this.commandsCalls += 1;

    if (this.commandsError) {
      throw this.commandsError;
    }

    return { commands: await (this.commandsResult ?? this.commands) };
  }

  public async getMessages(): Promise<{ messages?: PiAgentMessage[] }> {
    this.messagesCalls += 1;
    return { messages: await (this.messagesResult ?? this.messages) };
  }

  public async switchSession(sessionPath: string): Promise<{ cancelled?: boolean }> {
    this.switchedSessions.push(sessionPath);

    if (this.switchSessionError) {
      throw this.switchSessionError;
    }

    return this.switchSessionResult;
  }

  public async getForkMessages(): Promise<{ messages?: Array<{ entryId?: string; text?: string }> }> {
    this.forkMessagesCalls += 1;
    return { messages: this.forkMessages };
  }

  public async fork(entryId: string): Promise<{ text?: string; cancelled?: boolean }> {
    this.forkedEntries.push(entryId);
    return this.forkResult;
  }

  public async clone(): Promise<{ cancelled?: boolean }> {
    this.cloneCalls += 1;
    return this.cloneResult;
  }

  public async setModel(_provider: string, _modelId: string): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(_level: string): Promise<void> {}

  public async setSessionName(name: string): Promise<void> {
    this.sessionNames.push(name);
  }

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportHtml(): Promise<{}> {
    return {};
  }

  public async getLastAssistantText(): Promise<{ text: null }> {
    return { text: null };
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
