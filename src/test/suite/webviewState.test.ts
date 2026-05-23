import * as assert from 'assert';
import { initialWebviewState, parseWebviewStateMessage } from '../../webview/state';

suite('Webview state helpers', () => {
  test('initial state uses chat defaults', () => {
    assert.deepStrictEqual(initialWebviewState.messages, []);
    assert.strictEqual(initialWebviewState.busy, false);
    assert.deepStrictEqual(initialWebviewState.workspaceDiffStats, { addedLines: 0, removedLines: 0 });
    assert.strictEqual(initialWebviewState.lane, 'chat');
    assert.strictEqual(initialWebviewState.chatFace, 'main');
    assert.strictEqual(initialWebviewState.settingsSection, 'providers');
    assert.strictEqual(initialWebviewState.customUiTheme, 'default');
    assert.strictEqual(initialWebviewState.allowRemoteImages, true);
    assert.strictEqual(initialWebviewState.welcomeDismissed, false);
    assert.deepStrictEqual(initialWebviewState.sessions, []);
  });

  test('parses state messages with safe defaults', () => {
    const parsed = parseWebviewStateMessage({
      messages: [{ role: 'assistant', text: 'Hello' }],
      busy: true,
      modelLabel: 'gpt-test',
      modelProvider: 'openai',
      modelId: 'gpt-test',
      modelReasoning: true,
      thinkingLevel: 'high',
      modelOptions: [{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true }],
      contextUsageLabel: '10%',
      contextUsageTitle: 'Context used: 10%',
      contextUsageLevel: 'low',
      metadataRefreshing: true,
      workspaceDiffStats: { addedLines: 300, removedLines: 200 },
      slashCommands: [{ name: 'test', description: '', source: 'prompt' }],
      slashCommandsRefreshing: true,
      customUiTheme: 'modern',
      allowRemoteImages: false,
      welcomeDismissed: true,
      promptContext: [{ id: 'context-1', kind: 'file', label: 'file.ts', title: 'src/file.ts' }],
      composerText: 'draft',
      composerTextRevision: 2,
      lane: 'sessions',
      chatFace: 'settings',
      settingsSection: 'runtime',
      sessions: [{ path: '/session.jsonl' }],
      sessionsRefreshing: true,
      sessionsError: 'failed',
      currentSessionFile: '/session.jsonl',
      currentSessionName: 'Session',
      treeItems: [{ entryId: 'entry-1', role: 'user', text: 'Prompt', current: true }],
      treeRefreshing: true,
      treeError: 'tree failed',
      sessionLoading: true
    });

    assert.strictEqual(parsed.busy, true);
    assert.strictEqual(parsed.modelLabel, 'gpt-test');
    assert.deepStrictEqual(parsed.workspaceDiffStats, { addedLines: 300, removedLines: 200 });
    assert.strictEqual(parsed.lane, 'sessions');
    assert.strictEqual(parsed.chatFace, 'main');
    assert.strictEqual(parsed.settingsSection, 'runtime');
    assert.strictEqual(parsed.customUiTheme, 'modern');
    assert.strictEqual(parsed.allowRemoteImages, false);
    assert.strictEqual(parsed.welcomeDismissed, true);
    assert.strictEqual(parsed.sessions[0]?.path, '/session.jsonl');
    assert.strictEqual(parsed.treeItems[0]?.entryId, 'entry-1');
    assert.strictEqual(parsed.sessionLoading, true);

    const settingsParsed = parseWebviewStateMessage({ lane: 'chat', chatFace: 'settings' });
    assert.strictEqual(settingsParsed.lane, 'chat');
    assert.strictEqual(settingsParsed.chatFace, 'settings');
  });

  test('falls back for malformed fields', () => {
    const parsed = parseWebviewStateMessage({
      messages: 'bad',
      modelLabel: 1,
      workspaceDiffStats: { addedLines: -1, removedLines: 'bad' },
      composerTextRevision: 'bad',
      customUiTheme: 'bad',
      lane: 'unknown',
      chatFace: 'bad',
      settingsSection: 'bad',
      sessions: 'bad'
    });

    assert.deepStrictEqual(parsed.messages, []);
    assert.strictEqual(parsed.modelLabel, '');
    assert.deepStrictEqual(parsed.workspaceDiffStats, { addedLines: 0, removedLines: 0 });
    assert.strictEqual(parsed.composerTextRevision, 0);
    assert.strictEqual(parsed.lane, 'chat');
    assert.strictEqual(parsed.chatFace, 'main');
    assert.strictEqual(parsed.settingsSection, 'providers');
    assert.strictEqual(parsed.customUiTheme, 'default');
    assert.strictEqual(parsed.allowRemoteImages, true);
    assert.strictEqual(parsed.welcomeDismissed, false);
    assert.deepStrictEqual(parsed.sessions, []);
  });
});
