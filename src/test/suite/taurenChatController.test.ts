import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  TaurenChatController,
  type TaurenChatControllerOptions,
  type TaurenChatSessionMetaSnapshot
} from '../../taurenChatController';
import type { PiClient } from '../../pi/clientTypes';
import type { WebviewSessionItem, WebviewStateMessage, WebviewTreeItem } from '../../webviewProtocol/types';
import type { StatePublisherScheduler } from '../../controller/statePublisher';
import type {
  PiAgentMessage,
  PiCommand,
  PiModel,
  PiClientOptions,
  PiSessionState,
  PiSessionStats,
  PiEvent,
  PiImageContent
} from '../../pi/types';

suite('TaurenChatController', () => {
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

  test('webview ready uses home cwd when workspace cwd is not available', async () => {
    const sessionFiles: Array<string | undefined> = [];
    const harness = createControllerHarness([new FakePiClient()], {
      cwd: undefined,
      initialSessionFile: '/sessions/current.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile)
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 1);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: os.homedir(), sessionFile: '/sessions/current.jsonl' }]);
    assert.deepStrictEqual(sessionFiles, [undefined]);
    assert.deepStrictEqual(lastState(harness).messages, []);
    assert.strictEqual(lastState(harness).sessionLoading, undefined);
    harness.controller.dispose();
  });

  test('webview ready rejects missing workspace cwd when workspace mutation guard is enabled', async () => {
    const harness = createControllerHarness([new FakePiClient()], {
      cwd: undefined,
      getRejectEditWriteOutsideWorkspace: () => true
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 0);
    assert.match(harness.notifications[0]?.message ?? '', /rejectEditWriteOutsideWorkspace is enabled/);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Tauren cannot start Pi engine because no workspace folder is available while tauren.rejectEditWriteOutsideWorkspace is enabled. Open a project folder and try again.', error: true }
    ]);
    harness.controller.dispose();
  });

  test('workspace change restarts after home cwd fallback', async () => {
    let cwd: string | undefined;
    const homeClient = new FakePiClient();
    const workspaceClient = new FakePiClient({
      state: {
        sessionFile: '/sessions/current.jsonl',
        model: { provider: 'openai', id: 'live-model', reasoning: false },
        thinkingLevel: 'off'
      },
      messages: [{ role: 'user', content: 'Restored prompt' }]
    });
    const harness = createControllerHarness([homeClient, workspaceClient], {
      getCwd: () => cwd,
      initialSessionFile: '/sessions/current.jsonl'
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();
    cwd = '/workspace';
    harness.controller.restartForWorkspaceChange(cwd, '/sessions/current.jsonl');
    await flushPromises();
    await flushPromises();

    assert.deepStrictEqual(harness.clientOptions, [
      { cwd: os.homedir(), sessionFile: '/sessions/current.jsonl' },
      { cwd: '/workspace', sessionFile: '/sessions/current.jsonl' }
    ]);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Workspace changed to /workspace. Restarting Pi engine for the new workspace.' }
    ]);
    harness.controller.dispose();
  });

  test('ready script does not run after live state refresh succeeds', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.refreshSessionMeta({ startClient: true });
    await harness.controller.refreshSessionMeta({ startClient: true, force: true });

    assert.deepStrictEqual(readyScripts, []);
    harness.controller.dispose();
  });

  test('ready script does not run when a new session is created', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);
    harness.controller.dispose();
  });

  test('ready script runs after each user-prompted agent run completes', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.refreshSessionMeta({ startClient: true });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();
    assert.deepStrictEqual(readyScripts, []);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'first prompt' });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'second prompt' });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [
      { scriptPath: 'scripts/ready.sh', cwd: '/workspace' },
      { scriptPath: 'scripts/ready.sh', cwd: '/workspace' }
    ]);
    harness.controller.dispose();
  });

  test('ready script waits for auto-retry to finish', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'retry this' });
    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end', messages: [], willRetry: true });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);
    assert.strictEqual(lastState(harness).busy, true);

    client.emit({ type: 'auto_retry_start' });
    client.emit({ type: 'agent_start' });
    client.emit({ type: 'auto_retry_end', success: true });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [{ scriptPath: 'scripts/ready.sh', cwd: '/workspace' }]);
    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('ready script waits for post-agent compaction to finish', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'compact this' });
    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end', messages: [] });
    client.emit({ type: 'compaction_start' });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);
    assert.strictEqual(lastState(harness).busy, true);

    client.emit({ type: 'compaction_end', result: {}, willRetry: false });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [{ scriptPath: 'scripts/ready.sh', cwd: '/workspace' }]);
    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('ready script waits for compaction-triggered retry to finish', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'overflow compact this' });
    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end', messages: [] });
    client.emit({ type: 'compaction_start' });
    client.emit({ type: 'compaction_end', result: {}, willRetry: true });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);
    assert.strictEqual(lastState(harness).busy, true);

    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [{ scriptPath: 'scripts/ready.sh', cwd: '/workspace' }]);
    assert.strictEqual(lastState(harness).busy, false);
    harness.controller.dispose();
  });

  test('queued follow-up arms the ready script only after the follow-up run starts', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient();
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.refreshSessionMeta({ startClient: true });
    client.emit({ type: 'agent_start' });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'run next', streamingBehavior: 'followUp' });

    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);

    client.emit({ type: 'agent_start' });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [{ scriptPath: 'scripts/ready.sh', cwd: '/workspace' }]);
    harness.controller.dispose();
  });

  test('ready script does not run when disabled, unset, or when state refresh fails', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const failingClient = new FakePiClient({
      stateResult: new Promise((_resolve, reject) => setImmediate(() => reject(new Error('state failed'))))
    });
    const disabledClient = new FakePiClient();
    const unsetClient = new FakePiClient();
    const disabledHarness = createControllerHarness([disabledClient], {
      getReadyScript: () => 'scripts/ready.sh',
      getReadyScriptEnabled: () => false,
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });
    const unsetHarness = createControllerHarness([unsetClient], {
      getReadyScript: () => '',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });
    const failingHarness = createControllerHarness([failingClient], {
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await disabledHarness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await unsetHarness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    disabledClient.emit({ type: 'agent_end', messages: [] });
    unsetClient.emit({ type: 'agent_end', messages: [] });
    await failingHarness.controller.refreshSessionMeta({ startClient: true });

    assert.deepStrictEqual(readyScripts, []);
    disabledHarness.controller.dispose();
    unsetHarness.controller.dispose();
    failingHarness.controller.dispose();
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
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Earlier answer' },
            { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'echo hidden' } }
          ]
        },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'hidden tool output' }]
        },
        { role: 'assistant', content: [], errorMessage: 'Earlier failure' }
      ]
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl'
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    assert.strictEqual(lastState(harness).sessionLoading, true);
    await flushPromises();

    assert.strictEqual(lastState(harness).sessionLoading, undefined);
    assert.deepStrictEqual(harness.clientOptions, [
      { cwd: '/workspace', sessionFile: '/sessions/current.jsonl' }
    ]);
    assert.strictEqual(client.messagesCalls, 1);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Earlier question' },
      {
        role: 'assistant',
        text: 'Earlier answer',
        activities: [
          {
            id: 'restored-tool-1',
            kind: 'tool_execution',
            title: '$ echo hidden',
            status: 'completed',
            body: 'hidden tool output',
            code: true
          }
        ]
      },
      { role: 'assistant', text: 'Earlier failure', error: true }
    ]);
    harness.controller.dispose();
  });

  test('ready script skips resume readiness and unprompted resumed agent completion', async () => {
    const readyScripts: Array<{ scriptPath: string; cwd: string | undefined }> = [];
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl',
      getReadyScript: () => 'scripts/ready.sh',
      runReadyScript: (scriptPath, cwd) => readyScripts.push({ scriptPath, cwd })
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);

    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, []);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'continue' });
    client.emit({ type: 'agent_end', messages: [] });
    await flushPromises();

    assert.deepStrictEqual(readyScripts, [{ scriptPath: 'scripts/ready.sh', cwd: '/workspace' }]);
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

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });

    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.strictEqual(lastState(harness).sessionsRefreshing, false);
    assert.deepStrictEqual(lastState(harness).sessions, sessions);

    await harness.controller.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/next.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(client.switchedSessions, ['/sessions/next.jsonl']);
    assert.strictEqual(client.messagesCalls, 1);
    assert.deepStrictEqual(sessionFiles, ['/sessions/next.jsonl']);
    assert.strictEqual(lastState(harness).lane, undefined);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Next question' },
      { role: 'assistant', text: 'Next answer' }
    ]);
    harness.controller.dispose();
  });

  test('session switcher deletes a non-current session', async () => {
    const sessions: WebviewSessionItem[] = [
      {
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Current question',
        depth: 0,
        isLast: false,
        ancestorContinues: [],
        current: true
      },
      {
        path: '/sessions/old.jsonl',
        id: 'old',
        cwd: '/workspace',
        name: 'Old work',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Old question',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: false
      }
    ];
    const deleted: Array<{ path: string; name: string }> = [];
    const harness = createControllerHarness([new FakePiClient()], {
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async () => sessions.filter((session) => !deleted.some((entry) => entry.path === session.path)),
      deleteSession: async (path, name) => {
        deleted.push({ path, name });
        return true;
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.controller.handleWebviewMessage({ type: 'deleteSession', sessionPath: '/sessions/old.jsonl' });

    assert.deepStrictEqual(deleted, [{ path: '/sessions/old.jsonl', name: 'Old work' }]);
    assert.deepStrictEqual(lastState(harness).sessions?.map((session) => session.path), ['/sessions/current.jsonl']);
    assert.deepStrictEqual(harness.toasts, ['Session moved to Trash.']);
    harness.controller.dispose();
  });

  test('show current changes opens active session diff without creating a Pi client', async () => {
    const shownChanges: Array<{ path: string; name: string }> = [];
    const harness = createControllerHarness([], {
      initialSessionFile: '/sessions/current.jsonl',
      showSessionChanges: async (path, name) => {
        shownChanges.push({ path, name });
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'showCurrentChanges' });

    assert.deepStrictEqual(shownChanges, [{ path: '/sessions/current.jsonl', name: 'current.jsonl' }]);
    assert.strictEqual(harness.createCalls, 0);
    harness.controller.dispose();
  });

  test('session item clone updates the list without switching sessions', async () => {
    const sessions: WebviewSessionItem[] = [
      {
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Current question',
        depth: 0,
        isLast: false,
        ancestorContinues: [],
        current: true
      },
      {
        path: '/sessions/old.jsonl',
        id: 'old',
        cwd: '/workspace',
        name: 'Old work',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Old question',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: false
      }
    ];
    const cloneClient = new FakePiClient();
    const harness = createControllerHarness([cloneClient], {
      cwd: '/workspace',
      listSessions: async () => sessions
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.controller.handleWebviewMessage({ type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'clone' });

    assert.strictEqual(cloneClient.cloneCalls, 1);
    assert.strictEqual(cloneClient.disposed, true);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace', sessionFile: '/sessions/old.jsonl' }]);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.deepStrictEqual(harness.toasts, ['Cloned session.']);
    harness.controller.dispose();
  });

  test('session item rename updates a listed session without switching sessions', async () => {
    let oldSessionName = 'Old work';
    const renameClient = new FakePiClient();
    const harness = createControllerHarness([renameClient], {
      cwd: '/workspace',
      listSessions: async () => [
        {
          path: '/sessions/current.jsonl',
          id: 'current',
          cwd: '/workspace',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:01:00.000Z',
          messageCount: 1,
          firstMessage: 'Current question',
          depth: 0,
          isLast: false,
          ancestorContinues: [],
          current: true
        },
        {
          path: '/sessions/old.jsonl',
          id: 'old',
          cwd: '/workspace',
          name: oldSessionName,
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:01:00.000Z',
          messageCount: 1,
          firstMessage: 'Old question',
          depth: 0,
          isLast: true,
          ancestorContinues: [],
          current: false
        }
      ]
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    oldSessionName = 'Renamed old';
    await harness.controller.handleWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: ' Renamed old ' });

    assert.deepStrictEqual(renameClient.sessionNames, ['Renamed old']);
    assert.strictEqual(renameClient.disposed, true);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace', sessionFile: '/sessions/old.jsonl' }]);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.strictEqual(lastState(harness).sessions?.[1]?.name, 'Renamed old');
    assert.deepStrictEqual(harness.toasts, ['Session renamed.']);
    harness.controller.dispose();
  });

  test('session item rename updates before Pi confirms', async () => {
    let oldSessionName = 'Old work';
    const renameDeferred = createDeferred<void>();
    const renameClient = new FakePiClient({ setSessionNameResult: renameDeferred.promise });
    const harness = createControllerHarness([renameClient], {
      cwd: '/workspace',
      listSessions: async () => [
        {
          path: '/sessions/old.jsonl',
          id: 'old',
          cwd: '/workspace',
          name: oldSessionName,
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:01:00.000Z',
          messageCount: 1,
          firstMessage: 'Old question',
          depth: 0,
          isLast: true,
          ancestorContinues: [],
          current: false
        }
      ]
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    const renamePromise = harness.controller.handleWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: ' Renamed old ' });
    await flushPromises();

    assert.deepStrictEqual(renameClient.sessionNames, ['Renamed old']);
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Renamed old');
    assert.strictEqual(renameClient.disposed, false);

    oldSessionName = 'Renamed old';
    renameDeferred.resolve();
    await renamePromise;

    assert.strictEqual(renameClient.disposed, true);
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Renamed old');
    harness.controller.dispose();
  });

  test('session item rename rolls back when Pi rejects it', async () => {
    const renameClient = new FakePiClient({ setSessionNameError: new Error('rename failed') });
    const harness = createControllerHarness([renameClient], {
      cwd: '/workspace',
      listSessions: async () => [
        {
          path: '/sessions/old.jsonl',
          id: 'old',
          cwd: '/workspace',
          name: 'Old work',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:01:00.000Z',
          messageCount: 1,
          firstMessage: 'Old question',
          depth: 0,
          isLast: true,
          ancestorContinues: [],
          current: false
        }
      ]
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.controller.handleWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: ' Renamed old ' });

    assert.deepStrictEqual(renameClient.sessionNames, ['Renamed old']);
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Old work');
    assert.strictEqual(lastState(harness).sessionsError, 'rename failed');
    harness.controller.dispose();
  });

  test('session switcher deletes the current session and starts a fresh empty session', async () => {
    const deleted: Array<{ path: string; name: string }> = [];
    const sessionFiles: Array<string | undefined> = [];
    const harness = createControllerHarness([new FakePiClient()], {
      initialSessionFile: '/sessions/current.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile),
      listSessions: async () => [{
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Current question',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: true
      }],
      deleteSession: async (path, name) => {
        deleted.push({ path, name });
        return true;
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.controller.handleWebviewMessage({ type: 'deleteSession', sessionPath: '/sessions/current.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(deleted, [{ path: '/sessions/current.jsonl', name: 'Current question' }]);
    assert.deepStrictEqual(harness.toasts, ['Session moved to Trash.']);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.strictEqual(lastState(harness).currentSessionFile, '');
    assert.deepStrictEqual(lastState(harness).messages, []);
    assert.deepStrictEqual(sessionFiles, [undefined]);
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace' }]);
    harness.controller.dispose();
  });

  test('native trash command deletes the current session directly', async () => {
    const deleted: Array<{ path: string; name: string }> = [];
    const harness = createControllerHarness([new FakePiClient()], {
      initialSessionFile: '/sessions/current.jsonl',
      deleteSession: async (path, name) => {
        deleted.push({ path, name });
        return true;
      }
    });

    await harness.controller.deleteCurrentSession();
    await flushPromises();

    assert.deepStrictEqual(deleted, [{ path: '/sessions/current.jsonl', name: 'current.jsonl' }]);
    assert.deepStrictEqual(harness.toasts, ['Session moved to Trash.']);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.strictEqual(lastState(harness).currentSessionFile, '');
    harness.controller.dispose();
  });

  test('session switcher blocks deleting a running session', async () => {
    const deleted: string[] = [];
    const harness = createControllerHarness([new FakePiClient()], {
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async () => [{
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 1,
        firstMessage: 'Current question',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: true,
        liveStatus: 'running'
      }],
      deleteSession: async (path) => {
        deleted.push(path);
        return true;
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.controller.handleWebviewMessage({ type: 'deleteSession', sessionPath: '/sessions/current.jsonl' });

    assert.deepStrictEqual(deleted, []);
    assert.deepStrictEqual(harness.notifications, [{ message: 'Wait for the session to finish before deleting it.', type: 'warning' }]);
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

  test('metadata refresh lists named current session before it is readable from disk', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/new.jsonl',
        sessionName: 'Named draft'
      }
    });
    const listedSession: WebviewSessionItem = {
      path: '/sessions/old.jsonl',
      id: 'old',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 1,
      firstMessage: 'Old question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: false
    };
    const listSessionFiles: Array<string | undefined> = [];
    const harness = createControllerHarness([client], {
      listSessions: async (_cwd, currentSessionFile) => {
        listSessionFiles.push(currentSessionFile);
        return [listedSession];
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    await flushPromises();

    const state = lastState(harness);
    const sessions = state.sessions ?? [];
    assert.deepStrictEqual(listSessionFiles, ['/sessions/new.jsonl']);
    assert.strictEqual(state.currentSessionFile, '/sessions/new.jsonl');
    assert.deepStrictEqual(sessions.map((session) => session.path), [
      '/sessions/new.jsonl',
      '/sessions/old.jsonl'
    ]);
    assert.strictEqual(sessions[0]?.current, true);
    assert.strictEqual(sessions[0]?.name, 'Named draft');
    assert.strictEqual(sessions[0]?.firstMessage, 'Named draft');
    assert.strictEqual(sessions[1]?.current, false);
    harness.controller.dispose();
  });

  test('metadata refresh hides unnamed empty current session before it is readable from disk', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/new.jsonl'
      }
    });
    const listedSession: WebviewSessionItem = {
      path: '/sessions/old.jsonl',
      id: 'old',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 1,
      firstMessage: 'Old question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: false
    };
    const harness = createControllerHarness([client], {
      listSessions: async () => [listedSession]
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    await flushPromises();

    const state = lastState(harness);
    const sessions = state.sessions ?? [];
    assert.strictEqual(state.currentSessionFile, '/sessions/new.jsonl');
    assert.deepStrictEqual(sessions.map((session) => session.path), ['/sessions/old.jsonl']);
    assert.strictEqual(sessions[0]?.current, false);
    harness.controller.dispose();
  });

  test('delete removes a named fallback current session without trashing a file', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/new.jsonl',
        sessionName: 'Named draft'
      }
    });
    const nextClient = new FakePiClient({
      stateResult: createDeferred<PiSessionState>().promise,
      statsResult: createDeferred<PiSessionStats>().promise,
      modelsResult: createDeferred<PiModel[]>().promise
    });
    const deleted: string[] = [];
    const harness = createControllerHarness([client, nextClient], {
      listSessions: async () => [],
      deleteSession: async (sessionPath) => {
        deleted.push(sessionPath);
        return true;
      }
    });

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    await flushPromises();

    assert.deepStrictEqual((lastState(harness).sessions ?? []).map((session) => session.path), ['/sessions/new.jsonl']);

    await harness.controller.handleWebviewMessage({ type: 'deleteSession', sessionPath: '/sessions/new.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(deleted, []);
    assert.strictEqual(lastState(harness).currentSessionFile, '');
    assert.deepStrictEqual(lastState(harness).sessions ?? [], []);
    assert.deepStrictEqual(lastState(harness).messages, []);
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
      workspaceDiffStats: { addedLines: 0, removedLines: 0 },
      slashCommands: [],
      slashCommandsRefreshing: false,
      outputColors: true,
      animationsEnabled: true,
      customUiTheme: 'default',
      extensionStatus: [],
      extensionWidgets: [],
      allowRemoteImages: false,
      perfEnabled: false
    });
    harness.controller.dispose();
  });

  test('publishes historical per-session diff stats from edit tool calls', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-session-diff-'));
    const client = new FakePiClient();
    const harness = createControllerHarness([client], { cwd });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'change files' });
    client.emit({
      type: 'tool_execution_end',
      toolName: 'edit',
      args: { edits: [{ oldText: 'const b = 2;\n', newText: 'const c = 3;\nconst d = 4;\n' }] }
    });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).workspaceDiffStats, { addedLines: 2, removedLines: 1 });

    client.state.sessionFile = path.join(cwd, 'session.jsonl');
    client.emit({ type: 'agent_end' });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).workspaceDiffStats, { addedLines: 2, removedLines: 1 });
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
      {
        id: 'context-1',
        kind: 'selection',
        label: 'foo.ts:2-4',
        title: 'src/foo.ts:2-4',
        xml: '<ide_context source="vscode-tauren">\nUser-attached IDE context.\n\n<selection path="src/foo.ts" start_line="2" end_line="4" language="typescript"><![CDATA[\nconst answer = 42;\n]]></selection>\n</ide_context>'
      }
    ]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'explain this' });

    assert.strictEqual(client.prompts.length, 1);
    assert.ok(client.prompts[0].startsWith('explain this\n\n<ide_context source="vscode-tauren">\n'));
    assert.ok(!client.prompts[0].includes('<!-- tauren:ide-context'));
    assert.ok(client.prompts[0].includes('<selection path="src/foo.ts" start_line="2" end_line="4" language="typescript"><![CDATA[\nconst answer = 42;\n]]></selection>'));
    assert.ok(!client.prompts[0].includes('```typescript'));
    assert.ok(client.prompts[0].endsWith('\n</ide_context>'));
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'explain this' },
      { role: 'assistant', text: '' }
    ]);
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.controller.dispose();
  });

  test('submit sends one-shot image attachments and shows them on the user message', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    harness.controller.addPromptImages([{
      id: 'prompt-image-1',
      type: 'image',
      data: 'abc',
      mimeType: 'image/png',
      label: 'screenshot.png',
      title: '/tmp/screenshot.png',
      sizeBytes: 123
    }]);

    assert.deepStrictEqual(lastState(harness).promptImages, [
      { id: 'prompt-image-1', label: 'screenshot.png', title: '/tmp/screenshot.png', mimeType: 'image/png', sizeBytes: 123 }
    ]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'describe this' });

    assert.deepStrictEqual(client.promptImages[0], [{ type: 'image', data: 'abc', mimeType: 'image/png' }]);
    assert.deepStrictEqual(lastState(harness).messages[0], {
      role: 'user',
      text: 'describe this',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png', alt: 'screenshot.png' }]
    });
    assert.strictEqual(lastState(harness).promptImages, undefined);
    harness.controller.dispose();
  });

  test('prompt image attachments can be removed before submit', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    harness.controller.addPromptImages([{
      id: 'prompt-image-1',
      type: 'image',
      data: 'abc',
      mimeType: 'image/png',
      label: 'screenshot.png',
      title: '/tmp/screenshot.png',
      sizeBytes: 123
    }]);

    await harness.controller.handleWebviewMessage({ type: 'removePromptImage', id: 'prompt-image-1' });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });

    assert.strictEqual(client.promptImages[0], undefined);
    assert.strictEqual(lastState(harness).promptImages, undefined);
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
    assert.ok(client.prompts[1].startsWith('change direction\n\n<ide_context source="vscode-tauren">\n'));
    assert.ok(client.prompts[1].includes('<file path="src/foo.ts" />'));
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.summary, 'change direction');
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.controller.dispose();
  });

  test('new sessions preserve unsent IDE context', async () => {
    const client = new FakePiClient({
      stateResult: createDeferred<PiSessionState>().promise,
      statsResult: createDeferred<PiSessionStats>().promise,
      modelsResult: createDeferred<PiModel[]>().promise
    });
    const harness = createControllerHarness([client]);

    harness.controller.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });
    harness.controller.startNewSession();
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).promptContext, [
      { id: 'context-1', kind: 'file', label: 'foo.ts', title: 'src/foo.ts', xml: '<ide_context source="vscode-tauren">\nUser-attached IDE context.\n\n<file path="src/foo.ts" />\n</ide_context>' }
    ]);
    harness.controller.dispose();
  });

  test('session switches preserve unsent IDE context', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/next.jsonl'
      },
      messages: [{ role: 'user', content: 'Next prompt' }]
    });
    const harness = createControllerHarness([client]);

    harness.controller.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });
    await harness.controller.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/next.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(client.switchedSessions, ['/sessions/next.jsonl']);
    assert.deepStrictEqual(lastState(harness).promptContext, [
      { id: 'context-1', kind: 'file', label: 'foo.ts', title: 'src/foo.ts', xml: '<ide_context source="vscode-tauren">\nUser-attached IDE context.\n\n<file path="src/foo.ts" />\n</ide_context>' }
    ]);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'Next prompt' }
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

  test('name slash command is allowed while busy', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/name Busy rename' });

    assert.deepStrictEqual(client.prompts, ['hello']);
    assert.deepStrictEqual(client.sessionNames, ['Busy rename']);
    assert.strictEqual(lastState(harness).currentSessionName, 'Busy rename');
    harness.controller.dispose();
  });

  test('new session action is blocked while busy', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    await harness.controller.handleWebviewMessage({ type: 'newSession' });

    assert.deepStrictEqual(client.prompts, ['hello']);
    assert.strictEqual(lastState(harness).busy, true);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.title, '/new not queued');
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.status, 'error');
    harness.controller.dispose();
  });

  test('/compact shows busy compaction activity and blocks prompt queueing', async () => {
    const compactDeferred = createDeferred<{}>();
    const client = new FakePiClient({ compactResult: compactDeferred.promise });
    const harness = createControllerHarness([client]);

    const compactPromise = harness.controller.handleWebviewMessage({ type: 'submit', text: '/compact' });
    await flushPromises();

    assert.strictEqual(lastState(harness).busy, true);
    assert.strictEqual(lastState(harness).messages[0].activities?.[0]?.title, 'Compacting context…');
    assert.strictEqual(lastState(harness).messages[0].activities?.[0]?.status, 'running');

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'do not send yet' });

    assert.deepStrictEqual(client.prompts, []);
    assert.strictEqual(lastState(harness).messages[0].activities?.[1]?.title, 'Compaction in progress');

    compactDeferred.resolve({ summary: 'Compacted summary', tokensBefore: 123333 });
    await compactPromise;
    await flushPromises();

    assert.strictEqual(client.compactCalls, 1);
    assert.strictEqual(lastState(harness).busy, false);
    assert.strictEqual(lastState(harness).messages.length, 1);
    assert.strictEqual(lastState(harness).messages[0].activities?.[0]?.title, 'Compacted 123,333 tokens');
    assert.strictEqual(lastState(harness).messages[0].activities?.[0]?.status, 'completed');
    assert.strictEqual(lastState(harness).messages[0].activities?.[0]?.body, 'Compacted summary');
    harness.controller.dispose();
  });

  test('unknown context usage still shows an unavailable context badge', async () => {
    const client = new FakePiClient({
      stats: { contextUsage: { tokens: null, contextWindow: 1000, percent: null } }
    });
    const harness = createControllerHarness([client]);

    await harness.controller.refreshContextUsage({ startClient: true });
    await flushPromises();

    assert.strictEqual(lastState(harness).contextUsageLabel, '?%');
    assert.strictEqual(lastState(harness).contextUsageLevel, 'low');
    assert.strictEqual(lastState(harness).contextUsageTitle, '?/1.0k');
    harness.controller.dispose();
  });

  test('abort sends Pi abort while keeping the current turn busy until agent events arrive', async () => {
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

  test('login slash command opens Settings Login without prompting Pi', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/login' });
    await flushPromises();

    assert.strictEqual(lastState(harness).chatFace, 'settings');
    assert.strictEqual(lastState(harness).settingsSection, 'login');
    assert.deepStrictEqual(client.prompts, []);
    harness.controller.dispose();
  });

  test('supported built-in slash commands route to Pi commands', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/name Feature work' });

    assert.strictEqual(harness.createCalls, 1);
    assert.deepStrictEqual(client.sessionNames, ['Feature work']);
    assert.deepStrictEqual(client.prompts, []);
    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'system', text: 'Session name set to "Feature work".' }
    ]);
    assert.strictEqual(lastState(harness).currentSessionName, 'Feature work');
    harness.controller.dispose();
  });

  test('webview session rename updates the current session without adding transcript noise', async () => {
    let sessionName = 'Old name';
    const session: WebviewSessionItem = {
      path: '/sessions/current.jsonl',
      id: 'current',
      cwd: '/workspace',
      name: sessionName,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 2,
      firstMessage: 'First prompt',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: true
    };
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async (_cwd, currentSessionFile) => [{
        ...session,
        name: sessionName,
        current: currentSessionFile === session.path
      }]
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Old name');

    sessionName = 'Feature work';
    await harness.controller.handleWebviewMessage({ type: 'setSessionName', name: ' Feature work ' });

    assert.deepStrictEqual(client.sessionNames, ['Feature work']);
    assert.deepStrictEqual(lastState(harness).messages, []);
    assert.strictEqual(lastState(harness).currentSessionName, 'Feature work');
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Feature work');
    harness.controller.dispose();
  });

  test('webview session rename can clear the current session name', async () => {
    let sessionName: string | undefined = 'Old name';
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      }
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async (_cwd, currentSessionFile) => [{
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        ...(sessionName ? { name: sessionName } : {}),
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 2,
        firstMessage: 'First prompt',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: currentSessionFile === '/sessions/current.jsonl'
      }]
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();
    sessionName = undefined;
    await harness.controller.handleWebviewMessage({ type: 'setSessionName', name: '   ' });

    assert.deepStrictEqual(client.sessionNames, ['']);
    assert.strictEqual(lastState(harness).currentSessionName, '');
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, undefined);
    harness.controller.dispose();
  });

  test('webview session rename updates the current session before Pi confirms', async () => {
    let sessionName = 'Old name';
    const renameDeferred = createDeferred<void>();
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      },
      setSessionNameResult: renameDeferred.promise
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async (_cwd, currentSessionFile) => [{
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        name: sessionName,
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 2,
        firstMessage: 'First prompt',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: currentSessionFile === '/sessions/current.jsonl'
      }]
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();

    const renamePromise = harness.controller.handleWebviewMessage({ type: 'setSessionName', name: ' Feature work ' });
    await flushPromises();

    assert.deepStrictEqual(client.sessionNames, ['Feature work']);
    assert.strictEqual(lastState(harness).currentSessionName, 'Feature work');
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Feature work');

    sessionName = 'Feature work';
    renameDeferred.resolve();
    await renamePromise;

    assert.strictEqual(lastState(harness).currentSessionName, 'Feature work');
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Feature work');
    harness.controller.dispose();
  });

  test('webview session rename rolls back the current session when Pi rejects it', async () => {
    const client = new FakePiClient({
      state: {
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off',
        sessionFile: '/sessions/current.jsonl'
      },
      setSessionNameError: new Error('rename failed')
    });
    const harness = createControllerHarness([client], {
      cwd: '/workspace',
      initialSessionFile: '/sessions/current.jsonl',
      listSessions: async (_cwd, currentSessionFile) => [{
        path: '/sessions/current.jsonl',
        id: 'current',
        cwd: '/workspace',
        name: 'Old name',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:01:00.000Z',
        messageCount: 2,
        firstMessage: 'First prompt',
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        current: currentSessionFile === '/sessions/current.jsonl'
      }]
    });

    await harness.controller.handleWebviewMessage({ type: 'ready' });
    await flushPromises();
    await harness.controller.handleWebviewMessage({ type: 'setSessionName', name: ' Feature work ' });

    assert.deepStrictEqual(client.sessionNames, ['Feature work']);
    assert.strictEqual(lastState(harness).currentSessionName, 'Old name');
    assert.strictEqual(lastState(harness).sessions?.[0]?.name, 'Old name');
    assert.strictEqual(lastState(harness).messages.at(-1)?.text, 'rename failed');
    harness.controller.dispose();
  });

  test('tree slash command opens the live session tree', async () => {
    const treeItems: WebviewTreeItem[] = [{
      entryId: 'entry-1',
      role: 'user',
      text: 'Fix tests',
      current: true,
      activePath: true,
      depth: 0,
      isLast: true,
      ancestorContinues: []
    }];
    const client = new FakePiClient({ treeItems });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/tree' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(client.treeCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'tree');
    assert.deepStrictEqual(lastState(harness).treeItems, treeItems);
    assert.strictEqual(lastState(harness).treeRefreshing, false);
    harness.controller.dispose();
  });

  test('show tree toolbar action opens the live session tree', async () => {
    const treeItems: WebviewTreeItem[] = [{
      entryId: 'entry-1',
      role: 'user',
      text: 'Fix tests',
      current: true,
      activePath: true,
      depth: 0,
      isLast: true,
      ancestorContinues: []
    }];
    const client = new FakePiClient({ treeItems });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'showLane', lane: 'tree' });
    await flushPromises();

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(client.treeCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'tree');
    assert.deepStrictEqual(lastState(harness).treeItems, treeItems);
    harness.controller.dispose();
  });

  test('toggle settings opens and closes the settings pane', () => {
    const harness = createControllerHarness([new FakePiClient()]);

    harness.controller.toggleSettings();

    assert.strictEqual(lastState(harness).chatFace, 'settings');

    harness.controller.toggleSettings();

    assert.strictEqual(lastState(harness).chatFace, undefined);
    harness.controller.dispose();
  });

  test('toggle settings switches from session list to settings pane', async () => {
    const sessions: WebviewSessionItem[] = [{
      path: '/sessions/current.jsonl',
      id: 'current',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 1,
      firstMessage: 'Current question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: true
    }];
    const harness = createControllerHarness([new FakePiClient()], {
      listSessions: async () => sessions
    });

    harness.controller.toggleSessionList();
    await flushPromises();

    assert.strictEqual(lastState(harness).lane, 'sessions');

    harness.controller.toggleSettings();

    assert.strictEqual(lastState(harness).lane, undefined);
    assert.strictEqual(lastState(harness).chatFace, 'settings');
    harness.controller.dispose();
  });

  test('toggle session list opens and closes the session list', async () => {
    const sessions: WebviewSessionItem[] = [{
      path: '/sessions/current.jsonl',
      id: 'current',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 1,
      firstMessage: 'Current question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: true
    }];
    let listCalls = 0;
    const harness = createControllerHarness([new FakePiClient()], {
      listSessions: async () => {
        listCalls += 1;
        return sessions;
      }
    });

    harness.controller.toggleSessionList();
    await flushPromises();

    assert.strictEqual(listCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.deepStrictEqual(lastState(harness).sessions, sessions);

    harness.controller.toggleSessionList();

    assert.strictEqual(listCalls, 1);
    assert.strictEqual(lastState(harness).lane, undefined);
    harness.controller.dispose();
  });

  test('reopening session list shows cached sessions before refreshing', async () => {
    const initialSessions: WebviewSessionItem[] = [{
      path: '/sessions/current.jsonl',
      id: 'current',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:01:00.000Z',
      messageCount: 1,
      firstMessage: 'Current question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: true
    }];
    const refreshedSessions: WebviewSessionItem[] = [{
      ...initialSessions[0],
      modified: '2026-01-01T00:02:00.000Z',
      messageCount: 2,
      firstMessage: 'Updated question'
    }];
    let listCalls = 0;
    const harness = createControllerHarness([new FakePiClient()], {
      listSessions: async () => {
        listCalls += 1;
        return listCalls === 1 ? initialSessions : refreshedSessions;
      }
    });

    harness.controller.toggleSessionList();
    await flushPromises();
    assert.strictEqual(listCalls, 1);
    assert.deepStrictEqual(lastState(harness).sessions, initialSessions);

    harness.controller.toggleSessionList();
    assert.strictEqual(lastState(harness).lane, undefined);

    harness.controller.toggleSessionList();
    assert.strictEqual(listCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'sessions');
    assert.deepStrictEqual(lastState(harness).sessions, initialSessions);

    await harness.controller.handleWebviewMessage({ type: 'refreshSessions' });
    assert.strictEqual(listCalls, 2);
    assert.deepStrictEqual(lastState(harness).sessions, refreshedSessions);
    harness.controller.dispose();
  });

  test('show chat returns from session lanes and settings', async () => {
    const harness = createControllerHarness([new FakePiClient()]);

    harness.controller.toggleSessionList();
    await flushPromises();
    assert.strictEqual(lastState(harness).lane, 'sessions');

    harness.controller.showChat();
    assert.strictEqual(lastState(harness).lane, undefined);

    harness.controller.toggleSettings();
    assert.strictEqual(lastState(harness).chatFace, 'settings');

    harness.controller.showChat();
    assert.strictEqual(lastState(harness).chatFace, undefined);
    assert.strictEqual(lastState(harness).lane, undefined);
    harness.controller.dispose();
  });

  test('toggle session tree opens and closes the live session tree', async () => {
    const treeItems: WebviewTreeItem[] = [{
      entryId: 'entry-1',
      role: 'user',
      text: 'Fix tests',
      current: true,
      activePath: true,
      depth: 0,
      isLast: true,
      ancestorContinues: []
    }];
    const client = new FakePiClient({ treeItems });
    const harness = createControllerHarness([client]);

    harness.controller.toggleSessionTree();
    await flushPromises();

    assert.strictEqual(harness.createCalls, 1);
    assert.strictEqual(client.treeCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'tree');
    assert.deepStrictEqual(lastState(harness).treeItems, treeItems);

    harness.controller.toggleSessionTree();

    assert.strictEqual(client.treeCalls, 1);
    assert.strictEqual(lastState(harness).lane, undefined);
    harness.controller.dispose();
  });

  test('toggle session tree switches directly from the session list', async () => {
    const sessions: WebviewSessionItem[] = [{
      path: '/sessions/current.jsonl',
      id: 'current',
      cwd: '/workspace',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
      firstMessage: 'Current question',
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      current: true
    }];
    const treeItems: WebviewTreeItem[] = [{
      entryId: 'entry-1',
      role: 'user',
      text: 'Fix tests',
      current: true,
      activePath: true,
      depth: 0,
      isLast: true,
      ancestorContinues: []
    }];
    const client = new FakePiClient({ treeItems });
    const harness = createControllerHarness([client], {
      listSessions: async () => sessions
    });

    harness.controller.toggleSessionList();
    await flushPromises();

    assert.strictEqual(lastState(harness).lane, 'sessions');

    harness.controller.toggleSessionTree();
    await flushPromises();

    assert.strictEqual(client.treeCalls, 1);
    assert.strictEqual(lastState(harness).lane, 'tree');
    assert.deepStrictEqual(lastState(harness).treeItems, treeItems);
    harness.controller.dispose();
  });

  test('tree navigation forwards branch summary options', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({
      type: 'selectTreeEntry',
      entryId: 'entry-1',
      summarize: true,
      customInstructions: 'Focus on the decision points'
    });

    assert.deepStrictEqual(client.navigatedTrees, [{
      entryId: 'entry-1',
      options: { summarize: true, customInstructions: 'Focus on the decision points' }
    }]);
    harness.controller.dispose();
  });

  test('resume slash command opens the session switcher', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: '/resume' });

    assert.strictEqual(harness.createCalls, 0);
    assert.deepStrictEqual(client.prompts, []);
    assert.strictEqual(lastState(harness).lane, 'sessions');
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
    assert.deepStrictEqual(harness.toasts, ['Cloned current session.']);
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
      { role: 'system', text: 'Reloading Pi engine resources...' },
      { role: 'system', text: 'Reloaded keybindings, extensions, skills, prompts, and themes.' }
    ]);
    assert.strictEqual(lastState(harness).modelId, 'claude-test');
    assert.strictEqual(lastState(harness).startupResourcesReloadRevision, 1);
    assert.deepStrictEqual(lastState(harness).slashCommands, [
      { name: 'skill:new-skill', description: 'Newly added skill', source: 'skill', location: 'project', path: undefined }
    ]);
    harness.controller.dispose();
  });

  test('reload slash command restarts Pi when reload is unavailable', async () => {
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
      { role: 'system', text: 'Reloading Pi engine resources...' },
      { role: 'system', text: 'Reloaded Tauren by restarting the Pi engine. Skills, prompts, extensions, and metadata were rediscovered. Current persisted session was reconnected.' }
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
      { role: 'system', text: 'Reloading Pi engine resources...' },
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
    assert.deepStrictEqual(harness.clientOptions, [{ cwd: '/workspace' }]);
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
    const cachedSessionChanges: TaurenChatSessionMetaSnapshot[] = [];
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

  test('prompt failure is surfaced when new session is blocked while busy', async () => {
    const deferred = createDeferred<void>();
    const client = new FakePiClient({ promptResult: deferred.promise });
    const harness = createControllerHarness([client]);

    const submit = harness.controller.handleWebviewMessage({ type: 'submit', text: 'hello' });
    assert.strictEqual(lastState(harness).busy, true);

    harness.controller.startNewSession();
    deferred.reject(new Error('late failure'));
    await submit;

    assert.deepStrictEqual(lastState(harness).messages, [
      { role: 'user', text: 'hello' },
      {
        role: 'assistant',
        text: 'late failure',
        error: true,
        activities: [
          {
            id: 'activity-0-1',
            kind: 'queue',
            title: '/new not queued',
            status: 'error',
            summary: 'Sidebar commands are not available while Pi engine is working.'
          }
        ]
      }
    ]);
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

  test('live tool execution titles use streamed tool call arguments when execution events omit args', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'status' });
    client.emit({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        toolCall: {
          id: 'call-1',
          name: 'bash',
          arguments: { command: 'git status --short', timeout: 10 }
        }
      }
    });
    client.emit({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash' });

    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.title, '$ git status --short (timeout 10s)');
    harness.controller.dispose();
  });

  test('running bash tool updates are throttled for active sessions', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'run tests' });
    const stateCountAfterSubmit = harness.states.length;

    client.emit({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' },
      partialResult: { content: [{ type: 'text', text: 'first' }] }
    });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.body, 'first');

    client.emit({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' },
      partialResult: { content: [{ type: 'text', text: 'second' }] }
    });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);

    client.emit({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' },
      result: { content: [{ type: 'text', text: 'done' }] }
    });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 2);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.body, 'done');
    harness.controller.dispose();
  });

  test('running bash tool updates are status-only for inactive sessions', async () => {
    const client = new FakePiClient();
    const harness = createControllerHarness([client], { isActiveSession: () => false });

    await harness.controller.handleWebviewMessage({ type: 'submit', text: 'run tests' });
    const stateCountAfterSubmit = harness.states.length;

    client.emit({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' },
      partialResult: { content: [{ type: 'text', text: 'hidden while inactive' }] }
    });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit);

    client.emit({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' },
      result: { content: [{ type: 'text', text: 'final output' }] }
    });

    assert.strictEqual(harness.states.length, stateCountAfterSubmit + 1);
    assert.strictEqual(lastState(harness).messages[1].activities?.[0]?.body, 'final output');
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

  test('context usage refresh updates only session stats', async () => {
    const client = new FakePiClient({
      stats: { contextUsage: { tokens: 250, contextWindow: 1000, percent: 25 } }
    });
    const harness = createControllerHarness([client]);

    await harness.controller.handleWebviewMessage({ type: 'refreshMetadata' });
    const stateCallsBefore = client.stateCalls;
    const modelsCallsBefore = client.modelsCalls;
    client.stats = { contextUsage: { tokens: 600, contextWindow: 1000 } };

    await harness.controller.refreshContextUsage({ silent: true });

    assert.strictEqual(client.statsCalls, 2);
    assert.strictEqual(client.stateCalls, stateCallsBefore);
    assert.strictEqual(client.modelsCalls, modelsCallsBefore);
    assert.strictEqual(lastState(harness).contextUsageLabel, '60%');
    assert.strictEqual(lastState(harness).contextUsageLevel, 'medium');
    harness.controller.dispose();
  });

  test('message end event refreshes compact context tooltip while busy', async () => {
    const client = new FakePiClient({
      stats: {
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500 },
        cost: 0.1,
        contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
        autoCompactionEnabled: true
      }
    });
    const harness = createControllerHarness([client]);

    await harness.controller.refreshContextUsage({ startClient: true });
    client.emit({ type: 'agent_start' });
    client.stats = {
      tokens: { input: 83000, output: 2400, cacheRead: 468000, cacheWrite: 0, total: 553400 },
      cost: 0.723,
      usingSubscription: true,
      autoCompactionEnabled: true,
      contextUsage: { tokens: 42704, contextWindow: 272000, percent: 15.7 }
    };
    client.emit({ type: 'message_end', message: { role: 'assistant' } });
    await flushPromises();

    assert.strictEqual(client.statsCalls, 2);
    assert.strictEqual(lastState(harness).busy, true);
    assert.strictEqual(lastState(harness).contextUsageTitle, '↑83k ↓2.4k\nR468k\n$0.723 (sub)\n15.7%/272k (auto)');
    harness.controller.dispose();
  });

  test('context usage refresh dedupes overlapping requests', async () => {
    const statsDeferred = createDeferred<PiSessionStats>();
    const client = new FakePiClient({ statsResult: statsDeferred.promise });
    const harness = createControllerHarness([client]);

    const firstRefresh = harness.controller.refreshContextUsage({ startClient: true, silent: true });
    const secondRefresh = harness.controller.refreshContextUsage({ startClient: true, silent: true });
    await flushPromises();

    assert.strictEqual(client.statsCalls, 1);

    statsDeferred.resolve({ contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 } });
    await Promise.all([firstRefresh, secondRefresh]);

    assert.strictEqual(lastState(harness).contextUsageLabel, '10%');
    harness.controller.dispose();
  });

  test('silent context usage refresh errors do not append transcript errors', async () => {
    const client = new FakePiClient({ statsError: new Error('stats failed') });
    const harness = createControllerHarness([client]);

    await harness.controller.refreshContextUsage({ startClient: true, silent: true });

    assert.strictEqual(harness.states.length, 0);
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
  controller: TaurenChatController;
  states: WebviewStateMessage[];
  notifications: { message: string; type: string }[];
  toasts: string[];
  clientOptions: PiClientOptions[];
  readonly createCalls: number;
};

type ControllerHarnessOptions = {
  cwd?: string;
  getCwd?: () => string | undefined;
  extensionUi?: TaurenChatControllerOptions['extensionUi'];
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: TaurenChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: TaurenChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  listSessions?: (cwd: string | undefined, currentSessionFile: string | undefined) => Promise<WebviewSessionItem[]>;
  deleteSession?: (sessionPath: string, displayName: string) => Promise<boolean>;
  showSessionChanges?: (sessionPath: string, displayName: string) => Promise<void>;
  getReadyScript?: () => string | undefined;
  getReadyScriptEnabled?: () => boolean;
  getRejectEditWriteOutsideWorkspace?: () => boolean;
  isActiveSession?: () => boolean;
  runReadyScript?: TaurenChatControllerOptions['runReadyScript'];
};

function createControllerHarness(
  clients: FakePiClient[] = [new FakePiClient()],
  options: ControllerHarnessOptions = {}
): ControllerHarness {
  const states: WebviewStateMessage[] = [];
  const notifications: { message: string; type: string }[] = [];
  const toasts: string[] = [];
  const clientOptions: PiClientOptions[] = [];
  const pendingClients = [...clients];
  let createCalls = 0;

  const controllerOptions: TaurenChatControllerOptions = {
    createClient: (clientOption) => {
      createCalls += 1;
      clientOptions.push(clientOption);
      const client = pendingClients.shift();
      assert.ok(client, 'Expected a fake client to be available');
      return client;
    },
    getCwd: options.getCwd ?? (() => options.cwd === undefined && Object.prototype.hasOwnProperty.call(options, 'cwd') ? undefined : options.cwd ?? '/workspace'),
    postState: (message) => {
      states.push(message);
    },
    showNotification: (message, type) => {
      notifications.push({ message, type });
    },
    showToast: (message) => {
      toasts.push(message);
    },
    extensionUi: options.extensionUi,
    stateScheduler: options.stateScheduler,
    initialSessionMeta: options.initialSessionMeta,
    initialSessionFile: options.initialSessionFile,
    onSessionMetaChange: options.onSessionMetaChange,
    onSessionFileChange: options.onSessionFileChange,
    listSessions: options.listSessions,
    deleteSession: options.deleteSession,
    showSessionChanges: options.showSessionChanges,
    getReadyScript: options.getReadyScript,
    getReadyScriptEnabled: options.getReadyScriptEnabled,
    getRejectEditWriteOutsideWorkspace: options.getRejectEditWriteOutsideWorkspace,
    isActiveSession: options.isActiveSession,
    runReadyScript: options.runReadyScript
  };

  const controller = new TaurenChatController(controllerOptions);

  return {
    controller,
    states,
    notifications,
    toasts,
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
  statsError?: unknown;
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
  compactResult?: Promise<{}> | {};
  compactError?: unknown;
  promptResult?: Promise<void>;
  promptError?: unknown;
  setSessionNameResult?: Promise<void>;
  setSessionNameError?: unknown;
  treeItems?: WebviewTreeItem[];
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

class FakePiClient implements PiClient {
  public disposed = false;
  public stateCalls = 0;
  public modelsCalls = 0;
  public statsCalls = 0;
  public commandsCalls = 0;
  public abortCalls = 0;
  public reloadCalls = 0;
  public prompts: string[] = [];
  public promptStreamingBehaviors: Array<'steer' | 'followUp' | undefined> = [];
  public promptImages: Array<PiImageContent[] | undefined> = [];
  public sessionNames: string[] = [];
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
  public statsError: unknown;
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
  public compactCalls = 0;
  public compactResult: Promise<{}> | {};
  public compactError: unknown;
  public promptResult: Promise<void> | undefined;
  public promptError: unknown;
  public setSessionNameResult: Promise<void> | undefined;
  public setSessionNameError: unknown;
  public treeItems: WebviewTreeItem[];
  public treeCalls = 0;
  public navigatedTrees: Array<{ entryId: string; options?: { summarize?: boolean; customInstructions?: string } }> = [];
  private readonly eventListeners = new Set<(event: PiEvent) => void>();
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
    this.statsError = options.statsError;
    this.commandsError = options.commandsError;
    this.reloadError = options.reloadError;
    this.switchSessionResult = options.switchSessionResult ?? { cancelled: false };
    this.switchSessionError = options.switchSessionError;
    this.forkMessages = options.forkMessages ?? [];
    this.forkResult = options.forkResult ?? { cancelled: false };
    this.cloneResult = options.cloneResult ?? { cancelled: false };
    this.compactResult = options.compactResult ?? {};
    this.compactError = options.compactError;
    this.promptResult = options.promptResult;
    this.promptError = options.promptError;
    this.setSessionNameResult = options.setSessionNameResult;
    this.setSessionNameError = options.setSessionNameError;
    this.treeItems = options.treeItems ?? [];
  }

  public isRunning(): boolean {
    return !this.disposed;
  }

  public onEvent(listener: (event: PiEvent) => void): () => void {
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

  public async prompt(message: string, streamingBehavior?: 'steer' | 'followUp', images?: PiImageContent[]): Promise<void> {
    this.prompts.push(message);
    this.promptStreamingBehaviors.push(streamingBehavior);
    this.promptImages.push(images);

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

    if (this.statsError) {
      throw this.statsError;
    }

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

  public async getSessionTree(): Promise<WebviewTreeItem[]> {
    this.treeCalls += 1;
    return this.treeItems;
  }

  public async setTreeEntryLabel(): Promise<void> {}

  public async switchSession(sessionPath: string): Promise<{ cancelled?: boolean }> {
    this.switchedSessions.push(sessionPath);

    if (this.switchSessionError) {
      throw this.switchSessionError;
    }

    return this.switchSessionResult;
  }

  public async navigateTree(
    entryId: string,
    options?: { summarize?: boolean; customInstructions?: string }
  ): Promise<{ editorText?: string; cancelled?: boolean; aborted?: boolean }> {
    this.navigatedTrees.push({ entryId, options });
    return { cancelled: false };
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

    if (this.setSessionNameResult) {
      await this.setSessionNameResult;
    }

    if (this.setSessionNameError) {
      throw this.setSessionNameError;
    }
  }

  public async compact(): Promise<{}> {
    this.compactCalls += 1;

    if (this.compactError) {
      throw this.compactError;
    }

    return this.compactResult;
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

  public emit(event: PiEvent): void {
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
