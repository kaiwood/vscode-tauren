import * as assert from 'assert';
import {
  applyProvisionalExtensionUiSnapshot,
  applyStartupResourcesCache,
  createOptimisticNewSessionState,
  createProvisionalExtensionUiSnapshot,
  createStartupResourcesCache,
  hasPendingProvisionalExtensionUi,
  initialWebviewState,
  parseWebviewStateMessage
} from '../../webview/state';

suite('Webview state helpers', () => {
  test('initial state uses chat defaults', () => {
    assert.deepStrictEqual(initialWebviewState.messages, []);
    assert.strictEqual(initialWebviewState.busy, false);
    assert.deepStrictEqual(initialWebviewState.workspaceDiffStats, { addedLines: 0, removedLines: 0 });
    assert.strictEqual(initialWebviewState.lane, 'chat');
    assert.strictEqual(initialWebviewState.chatFace, 'main');
    assert.strictEqual(initialWebviewState.settingsSection, 'appearance');
    assert.strictEqual(initialWebviewState.customUiTheme, 'default');
    assert.deepStrictEqual(initialWebviewState.extensionStatus, []);
    assert.deepStrictEqual(initialWebviewState.startupResources, []);
    assert.strictEqual(initialWebviewState.startupResourcesReloadRevision, 0);
    assert.strictEqual(initialWebviewState.allowRemoteImages, false);
    assert.strictEqual(initialWebviewState.welcomeDismissed, false);
    assert.deepStrictEqual(initialWebviewState.auth, { providers: [] });
    assert.deepStrictEqual(initialWebviewState.promptImages, []);
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
      extensionStatus: [{ key: 'plan-mode', text: 'Planning', extra: 'ignored' }],
      startupResources: [{ name: 'Context', items: ['AGENTS.md', '', 1] }, { name: '', items: ['ignored'] }],
      startupResourcesReloadRevision: 2,
      allowRemoteImages: false,
      welcomeDismissed: true,
      promptContext: [{ id: 'context-1', kind: 'file', label: 'file.ts', title: 'src/file.ts' }],
      promptImages: [{ id: 'prompt-image-1', label: 'screenshot.png', title: '/tmp/screenshot.png', mimeType: 'image/png', sizeBytes: 123 }],
      composerText: 'draft',
      composerTextRevision: 2,
      composerTextMode: 'append',
      composerPaste: { text: 'paste', revision: 3 },
      lane: 'sessions',
      chatFace: 'settings',
      settingsSection: 'runtime',
      auth: {
        providers: [{
          id: 'anthropic',
          name: 'Anthropic',
          authType: 'oauth',
          configured: true,
          canLogout: true,
          storedCredentialType: 'oauth',
          secret: 'not-kept'
        }],
        progress: { message: 'Waiting', userCode: 'ABCD-EFGH' }
      },
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
    assert.deepStrictEqual(parsed.extensionStatus, [{ key: 'plan-mode', text: 'Planning' }]);
    assert.deepStrictEqual(parsed.startupResources, [{ name: 'Context', items: ['AGENTS.md'] }]);
    assert.strictEqual(parsed.startupResourcesReloadRevision, 2);
    assert.strictEqual(parsed.allowRemoteImages, false);
    assert.strictEqual(parsed.welcomeDismissed, true);
    assert.deepStrictEqual(parsed.auth.providers[0], {
      id: 'anthropic',
      name: 'Anthropic',
      authType: 'oauth',
      configured: true,
      canLogout: true,
      storedCredentialType: 'oauth'
    });
    assert.strictEqual(parsed.auth.progress?.userCode, 'ABCD-EFGH');
    assert.strictEqual(parsed.sessions[0]?.path, '/session.jsonl');
    assert.strictEqual(parsed.treeItems[0]?.entryId, 'entry-1');
    assert.strictEqual(parsed.sessionLoading, true);
    assert.strictEqual(parsed.composerTextMode, 'append');
    assert.deepStrictEqual(parsed.composerPaste, { text: 'paste', revision: 3 });
    assert.deepStrictEqual(parsed.promptImages, [{ id: 'prompt-image-1', label: 'screenshot.png', title: '/tmp/screenshot.png', mimeType: 'image/png', sizeBytes: 123 }]);

    const settingsParsed = parseWebviewStateMessage({ lane: 'chat', chatFace: 'settings' });
    assert.strictEqual(settingsParsed.lane, 'chat');
    assert.strictEqual(settingsParsed.chatFace, 'settings');
  });

  test('applies message patches and preserves omitted image payloads', () => {
    const previous = parseWebviewStateMessage({
      messages: [
        {
          id: 'message-1',
          revision: 1,
          role: 'assistant',
          text: 'Hello',
          images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
          activities: [{ id: 'activity-1', title: 'Read', images: [{ type: 'image', data: 'def', mimeType: 'image/png' }] }]
        }
      ]
    });

    const parsed = parseWebviewStateMessage({
      messagePatch: {
        upserts: [
          {
            index: 0,
            message: {
              id: 'message-1',
              revision: 2,
              role: 'assistant',
              text: 'Hello again',
              activities: [{ id: 'activity-1', title: 'Read updated' }]
            }
          },
          { index: 1, message: { id: 'message-2', revision: 1, role: 'user', text: 'Next' } }
        ]
      }
    }, previous);

    assert.strictEqual(parsed.messages[0].text, 'Hello again');
    assert.deepStrictEqual(parsed.messages[0].images, previous.messages[0].images);
    assert.deepStrictEqual(parsed.messages[0].activities?.[0]?.images, previous.messages[0].activities?.[0]?.images);
    assert.strictEqual(parsed.messages[1].text, 'Next');
  });

  test('creates optimistic new session state while preserving provisional extension UI', () => {
    const previous = parseWebviewStateMessage({
      messages: [{ role: 'assistant', text: 'Working response' }],
      busy: true,
      modelLabel: 'gpt-test',
      modelProvider: 'openai',
      modelId: 'gpt-test',
      contextUsageLabel: '50%',
      contextUsageTitle: 'half full',
      contextUsageLevel: 'medium',
      workspaceDiffStats: { addedLines: 5, removedLines: 2 },
      extensionFooter: { line: 'Footer line' },
      extensionWidgets: [{ key: 'widget-1', placement: 'aboveEditor', lines: ['Widget line'] }],
      promptContext: [{ id: 'context-1', kind: 'file', label: 'file.ts', title: 'src/file.ts' }],
      lane: 'sessions',
      currentSessionFile: '/session.jsonl',
      currentSessionName: 'Old session',
      sessionLoading: true
    });

    const optimistic = createOptimisticNewSessionState(previous);

    assert.deepStrictEqual(optimistic.messages, []);
    assert.strictEqual(optimistic.busy, false);
    assert.strictEqual(optimistic.lane, 'chat');
    assert.strictEqual(optimistic.chatFace, 'main');
    assert.strictEqual(optimistic.currentSessionFile, '');
    assert.strictEqual(optimistic.currentSessionName, '');
    assert.deepStrictEqual(optimistic.workspaceDiffStats, { addedLines: 0, removedLines: 0 });
    assert.strictEqual(optimistic.contextUsageLabel, '');
    assert.strictEqual(optimistic.sessionLoading, false);
    assert.strictEqual(optimistic.modelLabel, 'gpt-test');
    assert.deepStrictEqual(optimistic.promptContext, previous.promptContext);
    assert.deepStrictEqual(optimistic.extensionFooter, { line: 'Footer line' });
    assert.deepStrictEqual(optimistic.extensionWidgets, [{ key: 'widget-1', placement: 'aboveEditor', lines: ['Widget line'] }]);
  });

  test('reserves an empty provisional footer even before live footer content exists', () => {
    const snapshot = createProvisionalExtensionUiSnapshot(parseWebviewStateMessage({ messages: [], busy: false }));
    const liveWithoutFooter = parseWebviewStateMessage({ messages: [], busy: false });

    const preserved = applyProvisionalExtensionUiSnapshot(liveWithoutFooter, snapshot);

    assert.strictEqual(hasPendingProvisionalExtensionUi(preserved.snapshot), true);
    assert.deepStrictEqual(preserved.state.extensionFooter, { line: '' });
    assert.deepStrictEqual(preserved.state.extensionStatus, []);
  });

  test('keeps provisional extension UI until live UI replaces it', () => {
    const provisionalSource = parseWebviewStateMessage({
      extensionFooter: { line: 'Old footer' },
      extensionStatus: [{ key: 'status-1', text: 'Old status' }],
      extensionWidgets: [{ key: 'widget-1', placement: 'belowEditor', lines: ['Old widget'] }]
    });
    const snapshot = createProvisionalExtensionUiSnapshot(provisionalSource);
    const liveWithoutExtensionUi = parseWebviewStateMessage({ messages: [], busy: false });

    const preserved = applyProvisionalExtensionUiSnapshot(liveWithoutExtensionUi, snapshot);

    assert.strictEqual(hasPendingProvisionalExtensionUi(preserved.snapshot), true);
    assert.deepStrictEqual(preserved.state.extensionFooter, { line: 'Old footer' });
    assert.deepStrictEqual(preserved.state.extensionStatus, [{ key: 'status-1', text: 'Old status' }]);
    assert.deepStrictEqual(preserved.state.extensionWidgets, [{ key: 'widget-1', placement: 'belowEditor', lines: ['Old widget'] }]);

    const liveWithFooter = parseWebviewStateMessage({
      extensionFooter: { line: 'New footer' },
      extensionWidgets: [{ key: 'widget-2', placement: 'aboveEditor', lines: ['New widget'] }]
    });
    const replaced = applyProvisionalExtensionUiSnapshot(liveWithFooter, preserved.snapshot);

    assert.strictEqual(replaced.snapshot, undefined);
    assert.deepStrictEqual(replaced.state.extensionFooter, { line: 'New footer' });
    assert.deepStrictEqual(replaced.state.extensionWidgets, [{ key: 'widget-2', placement: 'aboveEditor', lines: ['New widget'] }]);
  });

  test('uses cached startup resources until reload revision changes', () => {
    let cache = createStartupResourcesCache();
    const initial = parseWebviewStateMessage({
      startupResources: [{ name: 'Context', items: ['AGENTS.md'] }]
    });

    let result = applyStartupResourcesCache(initial, cache);
    cache = result.cache;

    assert.strictEqual(cache.initialized, true);
    assert.deepStrictEqual(result.state.startupResources, [{ name: 'Context', items: ['AGENTS.md'] }]);

    result = applyStartupResourcesCache(parseWebviewStateMessage({
      startupResources: [{ name: 'Context', items: ['NEW.md'] }]
    }, result.state), cache);
    cache = result.cache;

    assert.deepStrictEqual(result.state.startupResources, [{ name: 'Context', items: ['AGENTS.md'] }]);

    result = applyStartupResourcesCache(parseWebviewStateMessage({
      startupResources: [{ name: 'Context', items: ['NEW.md'] }],
      startupResourcesReloadRevision: 1
    }, result.state), cache);

    assert.deepStrictEqual(result.cache.resources, [{ name: 'Context', items: ['NEW.md'] }]);
    assert.deepStrictEqual(result.state.startupResources, [{ name: 'Context', items: ['NEW.md'] }]);
  });

  test('falls back for malformed fields', () => {
    const parsed = parseWebviewStateMessage({
      messages: 'bad',
      modelLabel: 1,
      workspaceDiffStats: { addedLines: -1, removedLines: 'bad' },
      composerTextRevision: 'bad',
      composerPaste: { text: 1, revision: 'bad' },
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
    assert.strictEqual(parsed.composerTextMode, 'replace');
    assert.strictEqual(parsed.composerPaste, undefined);
    assert.strictEqual(parsed.lane, 'chat');
    assert.strictEqual(parsed.chatFace, 'main');
    assert.strictEqual(parsed.settingsSection, 'appearance');
    assert.strictEqual(parsed.customUiTheme, 'default');
    assert.deepStrictEqual(parsed.extensionStatus, []);
    assert.deepStrictEqual(parsed.startupResources, []);
    assert.strictEqual(parsed.allowRemoteImages, false);
    assert.strictEqual(parsed.welcomeDismissed, false);
    assert.deepStrictEqual(parsed.sessions, []);
  });
});
