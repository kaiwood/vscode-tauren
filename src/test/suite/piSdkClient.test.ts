import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiSdkClient } from '../../sdk/piSdkClient';
import { createSdkExtensionUiContext } from '../../sdk/extensionUiBridge';
import type { ExtensionUi } from '../../extensionUi/types';
import { loadPiSdk, resetPiSdkLoaderForTests, type PiSdkModule } from '../../sdk/piSdkLoader';
import type { PiEvent } from '../../pi/types';

suite('PiSdkClient', () => {
  test('loads the bundled SDK runtime and sets its package dir', async () => {
    const previousPackageDir = process.env.PI_PACKAGE_DIR;
    process.env.PI_PACKAGE_DIR = '/external/pi-package';
    resetPiSdkLoaderForTests();

    try {
      const sdk = await loadPiSdk();

      assert.strictEqual(typeof sdk.createAgentSessionRuntime, 'function');
      assert.notStrictEqual(process.env.PI_PACKAGE_DIR, '/external/pi-package');
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

  test('starts lazily and maps SDK session events to Pi events', async () => {
    const harness = createSdkHarness();
    const events: PiEvent[] = [];

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
      contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
      usingSubscription: false,
      autoCompactionEnabled: true
    });
    assert.strictEqual(harness.session.bindCount, 1);
    assert.deepStrictEqual(harness.initThemeCalls, [{ themeName: 'dark', enableWatcher: false }]);
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
      sessionDir: '/configured-sessions',
      cwdOverride: '/workspace'
    }]);
    harness.client.dispose();
  });

  test('uses home cwd when no workspace cwd is available', async () => {
    const harness = createSdkHarness({ cwd: undefined });

    await harness.client.getState();

    assert.deepStrictEqual(harness.createdSessionManagers, [{ type: 'create', cwd: os.homedir(), sessionDir: '/configured-sessions' }]);
    harness.client.dispose();
  });

  test('exports HTML to the workspace by default', async () => {
    const harness = createSdkHarness();

    const result = await harness.client.exportHtml();

    assert.deepStrictEqual(harness.session.exportToHtmlCalls, [path.join('/workspace', 'pi-session-current.html')]);
    assert.deepStrictEqual(result, { path: path.join('/workspace', 'pi-session-current.html') });
    harness.client.dispose();
  });

  test('exports HTML to the home directory when no workspace cwd is available', async () => {
    const harness = createSdkHarness({ cwd: undefined });

    const result = await harness.client.exportHtml();

    assert.deepStrictEqual(harness.session.exportToHtmlCalls, [path.join(os.homedir(), 'pi-session-current.html')]);
    assert.deepStrictEqual(result, { path: path.join(os.homedir(), 'pi-session-current.html') });
    harness.client.dispose();
  });

  test('resolves relative HTML export paths against the workspace', async () => {
    const harness = createSdkHarness();

    const result = await harness.client.exportHtml('exports/current.html');

    assert.deepStrictEqual(harness.session.exportToHtmlCalls, [path.join('/workspace', 'exports', 'current.html')]);
    assert.deepStrictEqual(result, { path: path.join('/workspace', 'exports', 'current.html') });
    harness.client.dispose();
  });

  test('rejects startup without a workspace cwd when workspace mutation guard is enabled', async () => {
    const notifications: Array<{ message: string; notifyType: string }> = [];
    const harness = createSdkHarness({ cwd: undefined, rejectEditWriteOutsideWorkspace: true, notifications });

    await assert.rejects(harness.client.getState(), /rejectEditWriteOutsideWorkspace is enabled/);

    assert.strictEqual(harness.createdSessionManagers.length, 0);
    assert.match(notifications[0]?.message ?? '', /rejectEditWriteOutsideWorkspace is enabled/);
    assert.strictEqual(notifications[0]?.notifyType, 'warning');
    harness.client.dispose();
  });

  test('rejects startup with filesystem root cwd', async () => {
    const harness = createSdkHarness({ cwd: '/' });

    await assert.rejects(harness.client.getState(), /filesystem root/);

    assert.strictEqual(harness.createdSessionManagers.length, 0);
    harness.client.dispose();
  });

  test('passes guarded edit and write tools when workspace mutation guard is enabled', async () => {
    const harness = createSdkHarness({ rejectEditWriteOutsideWorkspace: true });

    await harness.client.getState();

    assert.deepStrictEqual(harness.customToolNames, ['edit', 'write']);
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

    assert.deepStrictEqual(harness.session.promptCalls, [{ message: 'hello', streamingBehavior: 'followUp', source: 'rpc' }]);
    promptDeferred.resolve();
    harness.client.dispose();
  });

  test('passes images to SDK prompts', async () => {
    const harness = createSdkHarness();

    await harness.client.prompt('describe', undefined, [{ type: 'image', data: 'abc', mimeType: 'image/png' }]);

    assert.deepStrictEqual(harness.session.promptCalls, [{
      message: 'describe',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      source: 'rpc'
    }]);
    harness.client.dispose();
  });

  test('emits prompt handled when an SDK prompt completes without an agent run', async () => {
    const harness = createSdkHarness();
    const events: PiEvent[] = [];
    harness.client.onEvent((event) => events.push(event));

    await harness.client.prompt('/extension-command');

    assert.deepStrictEqual(events, [{ type: 'prompt_handled' }]);
    harness.client.dispose();
  });

  test('does not emit prompt handled after an SDK agent run starts', async () => {
    const harness = createSdkHarness();
    const events: PiEvent[] = [];
    harness.client.onEvent((event) => events.push(event));
    harness.session.promptImplementation = async (_message, options) => {
      options?.preflightResult?.(true);
      harness.session.emit({ type: 'agent_start' });
    };

    await harness.client.prompt('hello');

    assert.deepStrictEqual(events, [{ type: 'agent_start' }]);
    harness.client.dispose();
  });

  test('implements model, command, history metadata, and live tree methods', async () => {
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
    assert.deepStrictEqual(await harness.client.getStartupResources(), {
      sections: [
        { name: 'Context', items: ['AGENTS.md'] },
        { name: 'Skills', items: ['typescript'] },
        { name: 'Prompts', items: ['/review'] },
        { name: 'Extensions', items: ['extension.ts'] },
        { name: 'Themes', items: ['custom-dark'] }
      ]
    });

    assert.deepStrictEqual(await harness.client.getMessages(), { messages: harness.session.messages });
    assert.deepStrictEqual(await harness.client.getLastAssistantText(), { text: 'last answer' });
    assert.deepStrictEqual(await harness.client.getSessionTree(), [{
      entryId: 'leaf-1',
      role: 'user',
      text: 'Fix tests',
      current: true,
      depth: 0,
      isLast: true,
      ancestorContinues: [],
      activePath: true,
      prefix: ''
    }]);

    await harness.client.setTreeEntryLabel('leaf-1', 'checkpoint');
    assert.deepStrictEqual(harness.session.labelChanges, [{ entryId: 'leaf-1', label: 'checkpoint' }]);

    const selectedModel = await harness.client.setModel('openai', 'gpt-test');
    assert.strictEqual(selectedModel, harness.session.availableModels[0]);
    assert.strictEqual(harness.session.selectedModel, harness.session.availableModels[0]);

    await harness.client.setThinkingLevel('high');
    assert.strictEqual(harness.session.thinkingLevel, 'high');

    await harness.client.setSessionName('  Renamed  ');
    assert.strictEqual(harness.session.sessionName, 'Renamed');

    await harness.client.setSessionName('   ');
    assert.strictEqual(harness.session.sessionName, '');

    harness.client.dispose();
  });

  test('rebinds extensions and listeners after session replacement', async () => {
    const replacement = new FakeSession({ sessionFile: '/sessions/replacement.jsonl' });
    const harness = createSdkHarness({ replacementSession: replacement });
    const events: PiEvent[] = [];
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

  test('clears extension UI state before SDK reload rebinds extensions', async () => {
    let clearStatusesCount = 0;
    let clearWidgetsCount = 0;
    const harness = createSdkHarness({
      extensionUi: {
        notify: () => undefined,
        select: async () => undefined,
        confirm: async () => undefined,
        input: async () => undefined,
        clearStatuses: () => { clearStatusesCount += 1; },
        clearWidgets: () => { clearWidgetsCount += 1; }
      }
    });

    await harness.client.reload();

    assert.strictEqual(clearStatusesCount, 1);
    assert.strictEqual(clearWidgetsCount, 1);
    assert.strictEqual(harness.session.reloadCount, 1);
    assert.strictEqual(harness.session.bindCount, 1);
    harness.client.dispose();
  });

  test('updates live and persisted runtime settings through SDK APIs', async () => {
    const harness = createSdkHarness();

    assert.deepStrictEqual(
      await harness.client.updateRuntimeSetting('compaction.enabled', false),
      { applied: 'live', message: 'Auto-compaction updated.' }
    );
    assert.strictEqual(harness.session.autoCompactionEnabled, false);

    assert.deepStrictEqual(
      await harness.client.updateRuntimeSetting('steeringMode', 'one-at-a-time'),
      { applied: 'live', message: 'Steering delivery updated.' }
    );
    assert.strictEqual(harness.session.steeringMode, 'one-at-a-time');

    assert.deepStrictEqual(
      await harness.client.updateRuntimeSetting('transport', 'websocket'),
      { applied: 'reload', message: 'Saved. Reload Pi or start a new session to apply.' }
    );
    assert.strictEqual(harness.settingsManager.transport, 'websocket');
    assert.strictEqual(harness.settingsManager.flushCount, 3);

    await assert.rejects(
      harness.client.updateRuntimeSetting('enabledModels', ['gpt-*']),
      /deferred/
    );

    harness.client.dispose();
  });

  test('maps extension UI bridge methods to Tauren UI callbacks', async () => {
    const notifications: Array<{ message: string; notifyType: string }> = [];
    const statuses: Array<{ key: string; text: string | undefined }> = [];
    const widgets: Array<{ key: string; lines: string[] | undefined; placement?: 'aboveEditor' | 'belowEditor' }> = [];
    const footers: Array<unknown> = [];
    const composerTexts: string[] = [];
    const composerPastes: string[] = [];
    const editorRequests: Array<{ title: string; prefill: string | undefined }> = [];
    const terminalInputs: string[] = [];
    const toolExpansionStates: boolean[] = [];
    const ui = createSdkExtensionUiContext({
      notify: (message, notifyType) => notifications.push({ message, notifyType }),
      select: async (_title, options) => options[1],
      confirm: async () => true,
      input: async (_title, placeholder) => placeholder,
      editor: async (title, prefill) => {
        editorRequests.push({ title, prefill });
        return 'edited text';
      },
      setStatus: (key, text) => statuses.push({ key, text }),
      setWidget: (key, content, options) => widgets.push({
        key,
        lines: Array.isArray(content) ? content : undefined,
        placement: options?.placement
      }),
      setFooter: (factory) => footers.push(factory),
      onTerminalInput: (handler) => {
        terminalInputs.push(handler('\u000f')?.consume === true ? 'consumed' : 'ignored');
        return () => terminalInputs.push('unsubscribed');
      },
      getToolsExpanded: () => toolExpansionStates.at(-1) ?? false,
      setToolsExpanded: (expanded) => toolExpansionStates.push(expanded),
      setEditorText: (text) => composerTexts.push(text),
      pasteToEditor: (text) => composerPastes.push(text)
    });

    assert.strictEqual(await ui.select('Pick', ['A', 'B']), 'B');
    assert.strictEqual(await ui.confirm('Confirm', 'Continue?'), true);
    assert.strictEqual(await ui.input('Input', 'value'), 'value');
    assert.strictEqual(await ui.editor('Editor', 'prefill'), 'edited text');

    ui.notify('Saved', 'info');
    ui.setStatus('plan-mode', 'Planning');
    ui.setStatus('plan-mode', undefined);
    const footerFactory = () => ({ render: () => ['footer'], invalidate: () => undefined });
    ui.setWidget('todo', ['Line 1'], { placement: 'belowEditor' });
    ui.setFooter(footerFactory as never);
    ui.setFooter(undefined);
    const unsubscribeTerminalInput = ui.onTerminalInput((data) => ({ consume: data === '\u000f' }));
    unsubscribeTerminalInput();
    assert.strictEqual(ui.getToolsExpanded(), false);
    ui.setToolsExpanded(true);
    assert.strictEqual(ui.getToolsExpanded(), true);
    ui.setEditorText('prefilled prompt');
    ui.pasteToEditor('pasted prompt');

    assert.deepStrictEqual(notifications, [{ message: 'Saved', notifyType: 'info' }]);
    assert.deepStrictEqual(statuses, [
      { key: 'plan-mode', text: 'Planning' },
      { key: 'plan-mode', text: undefined }
    ]);
    assert.deepStrictEqual(editorRequests, [{ title: 'Editor', prefill: 'prefill' }]);
    assert.deepStrictEqual(widgets, [
      { key: 'todo', lines: ['Line 1'], placement: 'belowEditor' }
    ]);
    assert.deepStrictEqual(footers, [footerFactory, undefined]);
    assert.deepStrictEqual(terminalInputs, ['consumed', 'unsubscribed']);
    assert.deepStrictEqual(toolExpansionStates, [true]);
    assert.deepStrictEqual(composerTexts, ['prefilled prompt']);
    assert.deepStrictEqual(composerPastes, ['pasted prompt']);
  });
});

type PromptOptions = {
  streamingBehavior?: 'steer' | 'followUp';
  images?: unknown;
  source?: string;
  preflightResult?: (success: boolean) => void;
};

type SessionManagerCall =
  | { type: 'create'; cwd: string; sessionDir: string | undefined }
  | { type: 'open'; path: string; sessionDir: string | undefined; cwdOverride: string | undefined };

type HarnessOptions = {
  cwd?: string;
  sessionFile?: string;
  replacementSession?: FakeSession;
  loadSdkFailures?: number;
  rejectEditWriteOutsideWorkspace?: boolean;
  notifications?: Array<{ message: string; notifyType: string }>;
  extensionUi?: ExtensionUi;
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
  public reloadCount = 0;
  public readonly labelChanges: Array<{ entryId: string; label: string | undefined }> = [];
  public readonly messages = [{ role: 'assistant', content: 'last answer' }];
  public readonly availableModels = [this.model];
  public readonly promptCalls: Array<{ message: string; streamingBehavior?: string; source?: string; images?: unknown }> = [];
  public readonly exportToHtmlCalls: Array<string | undefined> = [];
  public promptImplementation: (message: string, options?: PromptOptions) => Promise<void> = async (_message, options) => {
    options?.preflightResult?.(true);
  };
  public readonly modelRegistry = {
    getAvailable: () => this.availableModels,
    isUsingOAuth: () => false
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
    getAgentsFiles: () => ({
      agentsFiles: [{ path: '/workspace/AGENTS.md', content: 'Context' }]
    }),
    getSkills: () => ({
      skills: [{
        name: 'typescript',
        description: 'TypeScript help',
        sourceInfo: { label: 'SKILL.md' }
      }]
    }),
    getExtensions: () => ({
      extensions: [{
        path: '/workspace/extension.ts',
        sourceInfo: { source: 'local', scope: 'project' }
      }],
      errors: []
    }),
    getThemes: () => ({
      themes: [{
        name: 'custom-dark',
        sourcePath: '/workspace/theme.json',
        sourceInfo: { source: 'local', scope: 'project' }
      }],
      diagnostics: []
    })
  };
  public readonly sessionManager = {
    appendLabelChange: (entryId: string, label: string | undefined) => {
      this.labelChanges.push({ entryId, label });
      return 'label-1';
    },
    getLeafId: () => 'leaf-1',
    getTree: () => [{
      entry: {
        id: 'leaf-1',
        parentId: null,
        type: 'message',
        message: { role: 'user', content: 'Fix tests' }
      },
      children: []
    }]
  };
  public readonly agent = {
    waitForIdle: async () => undefined
  };
  private readonly listeners = new Set<(event: PiEvent) => void>();

  public constructor(public readonly options: { sessionFile: string } = { sessionFile: '/sessions/current.jsonl' }) {}

  public get sessionFile(): string {
    return this.options.sessionFile;
  }

  public async bindExtensions(_bindings: unknown): Promise<void> {
    this.bindCount += 1;
  }

  public subscribe(listener: (event: PiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: PiEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  public async prompt(message: string, options?: PromptOptions): Promise<void> {
    this.promptCalls.push({
      message,
      ...(options?.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
      ...(options?.images ? { images: options.images } : {}),
      ...(options?.source ? { source: options.source } : {})
    });
    await this.promptImplementation(message, options);
  }

  public async abort(): Promise<void> {}

  public async reload(): Promise<void> {
    this.reloadCount += 1;
  }

  public async setModel(model: unknown): Promise<void> {
    this.selectedModel = model;
  }

  public setThinkingLevel(level: string): void {
    this.thinkingLevel = level;
  }

  public setAutoCompactionEnabled(enabled: boolean): void {
    this.autoCompactionEnabled = enabled;
  }

  public setAutoRetryEnabled(enabled: boolean): void {
    this.autoRetryEnabled = enabled;
  }

  public setSteeringMode(mode: string): void {
    this.steeringMode = mode;
  }

  public setFollowUpMode(mode: string): void {
    this.followUpMode = mode;
  }

  public autoRetryEnabled = true;

  public setSessionName(name: string): void {
    this.sessionName = name;
  }

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportToHtml(outputPath?: string): Promise<string> {
    this.exportToHtmlCalls.push(outputPath);
    return outputPath ?? '/sessions/current.html';
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

class FakeSettingsManager {
  public defaultProvider: string | undefined;
  public defaultModel: string | undefined;
  public defaultThinkingLevel: string | undefined;
  public transport = 'sse';
  public blockImages = false;
  public imageAutoResize = true;
  public enabledModels: string[] | undefined;
  public enableSkillCommands = true;
  public flushCount = 0;

  public getSessionDir(): string {
    return '/configured-sessions';
  }

  public getDefaultProvider(): string | undefined {
    return this.defaultProvider;
  }

  public setDefaultProvider(provider: string): void {
    this.defaultProvider = provider;
  }

  public getDefaultModel(): string | undefined {
    return this.defaultModel;
  }

  public setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  public setDefaultModelAndProvider(provider: string, model: string): void {
    this.defaultProvider = provider;
    this.defaultModel = model;
  }

  public getDefaultThinkingLevel(): string | undefined {
    return this.defaultThinkingLevel;
  }

  public setDefaultThinkingLevel(level: string): void {
    this.defaultThinkingLevel = level;
  }

  public getTransport(): string {
    return this.transport;
  }

  public setTransport(transport: string): void {
    this.transport = transport;
  }

  public getBlockImages(): boolean {
    return this.blockImages;
  }

  public setBlockImages(blocked: boolean): void {
    this.blockImages = blocked;
  }

  public getImageAutoResize(): boolean {
    return this.imageAutoResize;
  }

  public setImageAutoResize(enabled: boolean): void {
    this.imageAutoResize = enabled;
  }

  public getEnabledModels(): string[] | undefined {
    return this.enabledModels;
  }

  public getEnableSkillCommands(): boolean {
    return this.enableSkillCommands;
  }

  public setEnableSkillCommands(enabled: boolean): void {
    this.enableSkillCommands = enabled;
  }

  public async flush(): Promise<void> {
    this.flushCount += 1;
  }

  public drainErrors(): [] {
    return [];
  }
}

class FakeRuntime {
  public diagnostics = [];
  public modelFallbackMessage: string | undefined;
  private rebindSession: (() => Promise<void>) | undefined;

  public constructor(
    public session: FakeSession,
    private readonly replacementSession?: FakeSession,
    public readonly cwd = '/workspace'
  ) {}

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
  initThemeCalls: Array<{ themeName: string | undefined; enableWatcher: boolean }>;
  customToolNames: string[];
  settingsManager: FakeSettingsManager;
} {
  const session = new FakeSession();
  const createdSessionManagers: SessionManagerCall[] = [];
  const initThemeCalls: Array<{ themeName: string | undefined; enableWatcher: boolean }> = [];
  const customToolNames: string[] = [];
  let remainingLoadSdkFailures = options.loadSdkFailures ?? 0;
  const settingsManager = new FakeSettingsManager();
  const sdk = {
    initTheme: (themeName?: string, enableWatcher = false) => {
      initThemeCalls.push({ themeName, enableWatcher });
    },
    getAgentDir: () => '/agent',
    SettingsManager: {
      create: () => settingsManager
    },
    SessionManager: {
      create: (cwd: string, sessionDir?: string) => {
        createdSessionManagers.push({ type: 'create', cwd, sessionDir });
        return { getCwd: () => cwd };
      },
      open: (path: string, sessionDir?: string, cwdOverride?: string) => {
        createdSessionManagers.push({ type: 'open', path, sessionDir, cwdOverride });
        return { getCwd: () => cwdOverride ?? '/workspace' };
      }
    },
    createAgentSessionServices: async (serviceOptions: { cwd: string; agentDir: string }) => ({
      ...serviceOptions,
      diagnostics: []
    }),
    createAgentSessionFromServices: async (createOptions: { customTools?: Array<{ name?: string }> }) => {
      customToolNames.push(...(createOptions.customTools ?? []).map((tool) => tool.name ?? ''));
      return { session };
    },
    createEditToolDefinition: () => ({ name: 'edit' }),
    createWriteToolDefinition: () => ({ name: 'write' }),
    createAgentSessionRuntime: async (createRuntime: (runtimeOptions: unknown) => Promise<{ session: FakeSession }>, runtimeOptions: unknown) => {
      const created = await createRuntime(runtimeOptions);
      return new FakeRuntime(created.session, options.replacementSession, (runtimeOptions as { cwd?: string }).cwd);
    }
  } as unknown as PiSdkModule;

  return {
    initThemeCalls,
    client: new PiSdkClient({
      cwd: options.cwd === undefined && Object.prototype.hasOwnProperty.call(options, 'cwd') ? undefined : options.cwd ?? '/workspace',
      sessionFile: options.sessionFile,
      rejectEditWriteOutsideWorkspace: options.rejectEditWriteOutsideWorkspace,
      showNotification: (message, notifyType) => options.notifications?.push({ message, notifyType }),
      extensionUi: options.extensionUi,
      loadSdk: async () => {
        if (remainingLoadSdkFailures > 0) {
          remainingLoadSdkFailures -= 1;
          throw new Error('SDK load failed');
        }
        return sdk;
      }
    }),
    session,
    createdSessionManagers,
    customToolNames,
    settingsManager
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
