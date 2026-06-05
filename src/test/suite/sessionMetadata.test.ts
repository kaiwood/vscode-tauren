import * as assert from 'assert';
import {
  SessionMetadataRefreshController,
  SessionMetadataState,
  formatContextStatusTooltip,
  formatContextUsage
} from '../../metadata/sessionMetadata';

suite('SessionMetadataState', () => {
  test('applies initial metadata and publishes webview state', () => {
    const state = new SessionMetadataState({
      initialSessionMeta: {
        model: {
          label: 'cached High',
          provider: 'anthropic',
          id: 'cached',
          reasoning: true,
          thinkingLevel: 'high'
        },
        modelOptions: [
          { provider: 'anthropic', id: 'cached', name: 'Cached', reasoning: true }
        ],
        contextUsage: { label: '40%', title: 'Context used: 40%', level: 'low' }
      }
    });

    assert.deepStrictEqual(state.getWebviewState().model, {
      label: 'cached High',
      provider: 'anthropic',
      id: 'cached',
      reasoning: true,
      thinkingLevel: 'high',
      options: [{ provider: 'anthropic', id: 'cached', name: 'Cached', reasoning: true }]
    });
    assert.deepStrictEqual(state.getWebviewState().contextUsage, {
      label: '40%',
      title: 'Context used: 40%',
      level: 'low'
    });
  });

  test('notifies when durable metadata changes', () => {
    const snapshots: unknown[] = [];
    const state = new SessionMetadataState({ onChange: (snapshot) => snapshots.push(snapshot) });

    assert.strictEqual(state.applyModelState({
      model: { provider: 'openai', id: 'gpt', reasoning: true },
      thinkingLevel: 'medium'
    }), true);
    assert.strictEqual(state.applyAvailableModels([
      { provider: 'openai', id: 'gpt', name: 'GPT', reasoning: true }
    ]), true);

    assert.deepStrictEqual(snapshots, [
      {
        model: {
          label: 'gpt Medium',
          provider: 'openai',
          id: 'gpt',
          reasoning: true,
          thinkingLevel: 'medium'
        },
        modelOptions: [],
        contextUsage: undefined
      },
      {
        model: {
          label: 'gpt Medium',
          provider: 'openai',
          id: 'gpt',
          reasoning: true,
          thinkingLevel: 'medium'
        },
        modelOptions: [{ provider: 'openai', id: 'gpt', name: 'GPT', reasoning: true }],
        contextUsage: undefined
      }
    ]);
  });

  test('applies startup resources for webview state only', () => {
    const state = new SessionMetadataState();

    assert.strictEqual(state.applyStartupResources({
      sections: [
        { name: 'Context', items: ['AGENTS.md'] },
        { name: '', items: ['ignored'] },
        { name: 'Skills', items: [] }
      ]
    }), true);

    assert.deepStrictEqual(state.getWebviewState().startupResources, [
      { name: 'Context', items: ['AGENTS.md'] }
    ]);

    assert.strictEqual(state.applyStartupResources({ sections: [{ name: 'Context', items: ['AGENTS.md'] }] }), false);
    state.resetStartupResources();
    assert.deepStrictEqual(state.getWebviewState().startupResources, []);
  });

  test('formats known and unknown context usage with compact status tooltip', () => {
    assert.deepStrictEqual(formatContextUsage({
      tokens: { input: 83000, output: 2400, cacheRead: 468000, cacheWrite: 0, total: 553400 },
      cost: 0.723,
      usingSubscription: true,
      autoCompactionEnabled: true,
      contextUsage: { tokens: 42704, contextWindow: 272000, percent: 15.7 }
    }), {
      label: '16%',
      title: '↑83k ↓2.4k\nR468k\n$0.723 (sub)\n15.7%/272k (auto)',
      level: 'low'
    });

    assert.deepStrictEqual(formatContextUsage({ contextUsage: { tokens: null, contextWindow: 100, percent: null } }), {
      label: '?%',
      title: '?/100',
      level: 'low'
    });
  });

  test('formats compact context status tooltip with Pi-style gaps', () => {
    assert.strictEqual(formatContextStatusTooltip({
      tokens: { input: 999, output: 1000, cacheRead: 9999, cacheWrite: 10000, total: 21998 },
      cost: 0,
      usingSubscription: false,
      autoCompactionEnabled: false,
      contextUsage: { tokens: 250, contextWindow: 1000 }
    }), '↑999 ↓1.0k\nR10.0k W10k\n25.0%/1.0k');
  });

  test('ignores stale Kward refresh errors without clearing existing context usage', async () => {
    const state = new SessionMetadataState();
    state.applySessionStats({ contextUsage: { tokens: 40, contextWindow: 100, percent: 40 } });
    let errorCount = 0;
    const staleError = new Error('Stale Kward session response ignored.');
    staleError.name = 'StaleKwardSessionRequestError';
    const refresh = new SessionMetadataRefreshController({
      state,
      getSessionGeneration: () => 1,
      getClient: () => ({
        getSessionStats: async () => Promise.reject(staleError)
      } as FakeMetadataClient),
      restoreInitialSessionHistory: async () => {},
      applySessionState: () => ({ sessionFileChanged: false, sessionNameChanged: false }),
      applySessionStatsIdentity: () => ({ sessionFileChanged: false, sessionNameChanged: false }),
      refreshSessions: () => {},
      postState: () => {},
      onMetadataStartError: () => {},
      onError: () => { errorCount += 1; },
      getErrorMessage: (error) => error instanceof Error ? error.message : String(error)
    });

    await refresh.refreshContextUsage({ startClient: true });

    assert.strictEqual(errorCount, 0);
    assert.strictEqual(state.getWebviewState().contextUsage.label, '40%');
  });

  test('refresh controller dedupes session metadata refreshes', async () => {
    const state = new SessionMetadataState();
    const client = new FakeMetadataClient();
    let postCount = 0;
    const refresh = new SessionMetadataRefreshController({
      state,
      getSessionGeneration: () => 1,
      getClient: () => client,
      restoreInitialSessionHistory: async () => {},
      applySessionState: () => ({ sessionFileChanged: false, sessionNameChanged: false }),
      applySessionStatsIdentity: () => ({ sessionFileChanged: false, sessionNameChanged: false }),
      refreshSessions: () => {},
      postState: () => { postCount += 1; },
      onMetadataStartError: (message) => { throw new Error(message); },
      onError: (message) => { throw new Error(message); },
      getErrorMessage: (error) => error instanceof Error ? error.message : String(error)
    });

    await Promise.all([
      refresh.refreshSessionMeta({ startClient: true }),
      refresh.refreshSessionMeta({ startClient: true })
    ]);

    assert.strictEqual(client.stateCalls, 1);
    assert.strictEqual(client.statsCalls, 1);
    assert.strictEqual(client.modelsCalls, 1);
    assert.strictEqual(client.startupResourcesCalls, 1);
    assert.strictEqual(postCount > 0, true);
    assert.strictEqual(state.getWebviewState().model.id, 'live-model');
    assert.strictEqual(state.getWebviewState().contextUsage.label, '25%');
    assert.strictEqual(state.getWebviewState().piSettings.quietStartup, false);
    assert.deepStrictEqual(state.getWebviewState().startupResources, [{ name: 'Context', items: ['AGENTS.md'] }]);
  });
});

class FakeMetadataClient {
  public stateCalls = 0;
  public statsCalls = 0;
  public modelsCalls = 0;
  public startupResourcesCalls = 0;

  public async getMessages() {
    return { messages: [] };
  }

  public async getState() {
    this.stateCalls += 1;
    return {
      model: { provider: 'openai', id: 'live-model', reasoning: false },
      thinkingLevel: 'off'
    };
  }

  public async getSessionStats() {
    this.statsCalls += 1;
    return { contextUsage: { tokens: 25, contextWindow: 100, percent: 25 } };
  }

  public async getAvailableModels() {
    this.modelsCalls += 1;
    return { models: [{ provider: 'openai', id: 'live-model', name: 'Live Model', reasoning: false }] };
  }

  public async getCommands() {
    return { commands: [] };
  }

  public async getStartupResources() {
    this.startupResourcesCalls += 1;
    return { sections: [{ name: 'Context', items: ['AGENTS.md'] }] };
  }
}
