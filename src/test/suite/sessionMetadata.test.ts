import * as assert from 'assert';
import { SessionMetadataRefreshController, SessionMetadataState, formatContextUsage } from '../../metadata/sessionMetadata';

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

  test('formats known and unknown context usage', () => {
    assert.deepStrictEqual(formatContextUsage({ contextUsage: { tokens: 60, contextWindow: 100, percent: 60 } }), {
      label: '60%',
      title: 'Context used: 60%\nCurrent context: 60 tokens\nModel context size: 100 tokens',
      level: 'medium'
    });

    assert.deepStrictEqual(formatContextUsage({ contextUsage: { tokens: null, contextWindow: 100, percent: null } }), {
      label: '?%',
      title: 'Context usage unavailable\nModel context size: 100 tokens',
      level: 'low'
    });
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
    assert.strictEqual(postCount > 0, true);
    assert.strictEqual(state.getWebviewState().model.id, 'live-model');
    assert.strictEqual(state.getWebviewState().contextUsage.label, '25%');
  });
});

class FakeMetadataClient {
  public stateCalls = 0;
  public statsCalls = 0;
  public modelsCalls = 0;

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
}
