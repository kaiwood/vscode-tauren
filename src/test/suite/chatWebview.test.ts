import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  createWebviewHtml,
  createWebviewStateMessage,
  parseWebviewMessage
} from '../../sidebar/chatWebview';
import type { ChatState } from '../../chat/chatSession';

suite('Chat webview helpers', () => {
  test('parseWebviewMessage accepts @ file suggestion requests', () => {
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'requestFileSuggestions', id: '1', prefix: '@src' }),
      { type: 'requestFileSuggestions', id: '1', prefix: '@src' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'requestFileSuggestions', id: '1', prefix: 'src' }), { type: 'unknown' });
  });

  test('parseWebviewMessage accepts extension footer dimensions', () => {
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'extensionFooterDimensions', columns: 100, rows: 1, cellWidthPx: 7.5, cellHeightPx: 18 }),
      { type: 'extensionFooterDimensions', columns: 100, rows: 1, cellWidthPx: 7.5, cellHeightPx: 18 }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'extensionFooterDimensions', columns: 0, rows: 1 }), { type: 'unknown' });
  });

  test('createWebviewStateMessage adds message type, model metadata, and context usage', () => {
    const state: ChatState = {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' }
      ],
      busy: true
    };
    const modelOptions = [
      { provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true }
    ];

    assert.deepStrictEqual(
      createWebviewStateMessage({
        state,
        model: {
          label: 'gpt-test High',
          provider: 'openai',
          id: 'gpt-test',
          reasoning: true,
          thinkingLevel: 'high',
          options: modelOptions
        },
        contextUsage: {
          label: '30%',
          title: '60,000 / 200,000 context tokens',
          level: 'low'
        }
      }),
      {
        type: 'state',
        messages: state.messages,
        busy: true,
        modelLabel: 'gpt-test High',
        modelProvider: 'openai',
        modelId: 'gpt-test',
        modelReasoning: true,
        thinkingLevel: 'high',
        modelOptions,
        contextUsageLabel: '30%',
        contextUsageTitle: '60,000 / 200,000 context tokens',
        contextUsageLevel: 'low',
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
      }
    );
  });

  test('createWebviewStateMessage defaults to empty metadata', () => {
    assert.deepStrictEqual(
      createWebviewStateMessage({ state: { messages: [], busy: false } }),
      {
        type: 'state',
        messages: [],
        busy: false,
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
      }
    );
  });

  test('createWebviewStateMessage includes extension status entries when present', () => {
    assert.deepStrictEqual(
      createWebviewStateMessage({
        state: { messages: [], busy: false },
        extensionStatus: [
          { key: 'plan-mode', text: 'Planning' },
          { key: 'review', text: 'Reviewing' }
        ]
      }).extensionStatus,
      [
        { key: 'plan-mode', text: 'Planning' },
        { key: 'review', text: 'Reviewing' }
      ]
    );
  });

  test('createWebviewStateMessage includes custom extension footer when present', () => {
    assert.deepStrictEqual(
      createWebviewStateMessage({
        state: { messages: [], busy: false },
        extensionFooter: { line: 'Footer line' }
      }).extensionFooter,
      { line: 'Footer line' }
    );
  });

  test('createWebviewStateMessage includes prompt context attachments when present', () => {
    assert.deepStrictEqual(
      createWebviewStateMessage({
        state: { messages: [], busy: false },
        promptContext: [
          { id: 'context-1', kind: 'selection', label: 'foo.ts:2-4', title: 'src/foo.ts:2-4' }
        ]
      }).promptContext,
      [{ id: 'context-1', kind: 'selection', label: 'foo.ts:2-4', title: 'src/foo.ts:2-4' }]
    );
  });

  test('createWebviewStateMessage includes append composer mode when requested', () => {
    const message = createWebviewStateMessage({
      state: { messages: [], busy: false },
      composer: { text: 'selected line', revision: 1, mode: 'append' }
    });

    assert.strictEqual(message.composerText, 'selected line');
    assert.strictEqual(message.composerTextRevision, 1);
    assert.strictEqual(message.composerTextMode, 'append');
  });

  test('parseWebviewMessage narrows valid inbound messages', () => {
    assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'focusChanged', focused: true }), { type: 'focusChanged', focused: true });
    assert.deepStrictEqual(
      parseWebviewMessage({
        type: 'perfEvent',
        event: {
          name: 'sessionList.render',
          durationMs: 12.5,
          lane: 'sessions',
          sessionCount: 4,
          visibleItemCount: 3,
          currentSessionFile: '/sessions/current.jsonl',
          sessionLoading: false
        }
      }),
      {
        type: 'perfEvent',
        event: {
          name: 'sessionList.render',
          durationMs: 12.5,
          lane: 'sessions',
          sessionCount: 4,
          visibleItemCount: 3,
          currentSessionFile: '/sessions/current.jsonl',
          sessionLoading: false
        }
      }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'newSession' }), { type: 'newSession' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showLane', lane: 'sessions' }), { type: 'showLane', lane: 'sessions' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showLane', lane: 'tree' }), { type: 'showLane', lane: 'tree' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showLane', lane: 'chat' }), { type: 'showLane', lane: 'chat' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showChatFace', chatFace: 'settings' }), { type: 'showChatFace', chatFace: 'settings' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'hideChatFace' }), { type: 'hideChatFace' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSettingsSection', section: 'runtime' }), { type: 'setSettingsSection', section: 'runtime' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'updateSetting', settingId: 'tauren.outputColors', value: false }), { type: 'updateSetting', settingId: 'tauren.outputColors', value: false });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'updateSetting', settingId: 'defaultThinkingLevel', value: 'high' }), { type: 'updateSetting', settingId: 'defaultThinkingLevel', value: 'high' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authLogin', providerId: 'anthropic' }), { type: 'authLogin', providerId: 'anthropic' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authLogin', providerId: 'anthropic', authType: 'oauth' }), { type: 'authLogin', providerId: 'anthropic', authType: 'oauth' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authLogout', providerId: 'anthropic' }), { type: 'authLogout', providerId: 'anthropic' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authRefresh' }), { type: 'authRefresh' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authCancel' }), { type: 'authCancel' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshSessions' }), { type: 'refreshSessions' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showCurrentChanges' }), { type: 'showCurrentChanges' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'dismissWelcome' }), { type: 'dismissWelcome' });
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/current.jsonl' }),
      { type: 'selectSession', sessionPath: '/sessions/current.jsonl' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'deleteSession', sessionPath: '/sessions/old.jsonl' }),
      { type: 'deleteSession', sessionPath: '/sessions/old.jsonl' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'compact' }),
      { type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'compact' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'showChanges' }),
      { type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'showChanges' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: 'Old work' }),
      { type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: 'Old work' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'selectTreeEntry', entryId: 'entry-1' }),
      { type: 'selectTreeEntry', entryId: 'entry-1' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'selectTreeEntry', entryId: 'entry-1', summarize: true, customInstructions: 'Focus on tests' }),
      { type: 'selectTreeEntry', entryId: 'entry-1', summarize: true, customInstructions: 'Focus on tests' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setTreeEntryLabel', entryId: 'entry-1', label: 'checkpoint' }),
      { type: 'setTreeEntryLabel', entryId: 'entry-1', label: 'checkpoint' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setSessionName', name: 'Feature work' }),
      { type: 'setSessionName', name: 'Feature work' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshMetadata' }), { type: 'refreshMetadata' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshSlashCommands' }), { type: 'refreshSlashCommands' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'selectPromptImages' }), { type: 'selectPromptImages' });
    assert.deepStrictEqual(
      parseWebviewMessage({
        type: 'dropPromptImages',
        files: [{ label: 'image.png', title: 'image.png', mimeType: 'image/png', sizeBytes: 4, data: 'AAAA' }],
        uris: ['file:///tmp/image.webp']
      }),
      {
        type: 'dropPromptImages',
        files: [{ label: 'image.png', title: 'image.png', mimeType: 'image/png', sizeBytes: 4, data: 'AAAA' }],
        uris: ['file:///tmp/image.webp']
      }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'dropPromptImages', files: [], uris: [], rejections: ['Unsupported attachment: note.txt.'] }),
      { type: 'dropPromptImages', files: [], uris: [], rejections: ['Unsupported attachment: note.txt.'] }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptImage', id: 'prompt-image-1' }), { type: 'removePromptImage', id: 'prompt-image-1' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptContext', id: 'context-1' }), { type: 'removePromptContext', id: 'context-1' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'abort' }), { type: 'abort' });
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'copyText', text: 'assistant output' }),
      { type: 'copyText', text: 'assistant output' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'copyText', text: 'const x = 1;', successMessage: 'Copied code.' }),
      { type: 'copyText', text: 'const x = 1;', successMessage: 'Copied code.' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: 'typescript' }),
      { type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: 'typescript' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'highlightCode', id: 'highlight-2', code: 'const x = 1;', language: 'typescript', themeId: 'Default Dark Modern' }),
      { type: 'highlightCode', id: 'highlight-2', code: 'const x = 1;', language: 'typescript', themeId: 'Default Dark Modern' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'resolveLocalImage', id: 'local-image-1', src: './image.png' }),
      { type: 'resolveLocalImage', id: 'local-image-1', src: './image.png' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'customUiInput', id: 'custom-ui-1', data: '\\r' }),
      { type: 'customUiInput', id: 'custom-ui-1', data: '\\r' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'customUiCancel', id: 'custom-ui-1' }),
      { type: 'customUiCancel', id: 'custom-ui-1' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'customUiDimensions', id: 'custom-ui-1', columns: 80, rows: 12 }),
      { type: 'customUiDimensions', id: 'custom-ui-1', columns: 80, rows: 12 }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'customUiDimensions', id: 'custom-ui-1', columns: 80, rows: 12, cellWidthPx: 7.5, cellHeightPx: 16.2 }),
      { type: 'customUiDimensions', id: 'custom-ui-1', columns: 80, rows: 12, cellWidthPx: 7.5, cellHeightPx: 16.2 }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'extensionWidgetDimensions', key: 'status', columns: 40, rows: 3, cellWidthPx: 8, cellHeightPx: 18 }),
      { type: 'extensionWidgetDimensions', key: 'status', columns: 40, rows: 3, cellWidthPx: 8, cellHeightPx: 18 }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'extensionTerminalInput', data: '\u000f' }),
      { type: 'extensionTerminalInput', data: '\u000f' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setToolsExpanded', expanded: true }),
      { type: 'setToolsExpanded', expanded: true }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'extensionEditorSave', id: 'extension-editor-1', text: '' }),
      { type: 'extensionEditorSave', id: 'extension-editor-1', text: '' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'extensionEditorCancel', id: 'extension-editor-1' }),
      { type: 'extensionEditorCancel', id: 'extension-editor-1' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'submit', text: 'hello' }),
      { type: 'submit', text: 'hello' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'submit', text: 'hello', streamingBehavior: 'steer' }),
      { type: 'submit', text: 'hello', streamingBehavior: 'steer' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'submit', text: 'hello', streamingBehavior: 'followUp' }),
      { type: 'submit', text: 'hello', streamingBehavior: 'followUp' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setModel', provider: 'openai', modelId: 'gpt-test' }),
      { type: 'setModel', provider: 'openai', modelId: 'gpt-test' }
    );
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setThinkingLevel', level: 'high' }),
      { type: 'setThinkingLevel', level: 'high' }
    );
  });

  test('parseWebviewMessage maps malformed or unknown inbound messages to unknown', () => {
    assert.deepStrictEqual(parseWebviewMessage(undefined), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({}), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'focusChanged', focused: 'yes' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSettingsSection', section: 'bogus' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authLogin', providerId: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'authLogout', providerId: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'submit', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'selectSession', sessionPath: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'deleteSession', sessionPath: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '', command: 'compact' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'bogus' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionItemName', sessionPath: '', name: 'Old work' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setTreeEntryLabel', entryId: '', label: 'checkpoint' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setTreeEntryLabel', entryId: 'entry-1', label: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionName', name: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'dropPromptImages', files: 'nope', uris: [] }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'dropPromptImages', files: [{ label: '', title: '', mimeType: 'image/png', sizeBytes: 1, data: 'x' }], uris: [] }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'dropPromptImages', files: [], uris: [42] }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'dropPromptImages', files: [], uris: [], rejections: [''] }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptContext', id: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: 'assistant output', successMessage: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: '', code: 'const x = 1;', language: 'typescript' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: '', language: 'typescript' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: 'typescript', themeId: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'resolveLocalImage', id: '', src: './image.png' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'resolveLocalImage', id: 'local-image-1', src: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'customUiInput', id: '', data: '\\r' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'customUiInput', id: 'custom-ui-1', data: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'customUiCancel', id: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'customUiDimensions', id: 'custom-ui-1', columns: 0, rows: 12 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'customUiDimensions', id: 'custom-ui-1', columns: 80, rows: '12' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'extensionEditorSave', id: '', text: 'x' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'extensionEditorSave', id: 'extension-editor-1', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'extensionEditorCancel', id: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'submit', text: 'hello', streamingBehavior: 'later' }), { type: 'unknown' });
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setModel', provider: 'openai' }),
      { type: 'unknown' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'futureMessage' }), { type: 'unknown' });
  });

  test('webview bundle is valid JavaScript', () => {
    const bundlePath = path.resolve(__dirname, '..', '..', '..', 'resources', 'webview', 'chat.js');
    const bundle = fs.readFileSync(bundlePath, 'utf8');

    assert.doesNotThrow(() => new Function(bundle));
    assert.ok(bundle.includes('vscode.postMessage({ type: "ready" });'));
    assert.ok(bundle.includes('vscode.postMessage({ type: "refreshMetadata" });'));
    assert.ok(bundle.includes('vscode.postMessage({ type: "refreshSessions" });'));
  });

  test('createWebviewHtml models sessions, chat, and tree as three lanes', () => {
    const html = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      webviewScriptUri: 'vscode-resource://chat.js'
    });

    assert.ok(html.includes('.tauren-chat-surface,\n    .sessions,\n    .session-tree'));
    assert.match(html, /\.tauren-view--lane-chat \.sessions \{\n      transform: translate3d\(-100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-chat \.session-tree \{\n      transform: translate3d\(100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-sessions \.tauren-chat-surface \{\n      transform: translate3d\(100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-sessions \.sessions \{\n      transform: translate3d\(0, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-sessions \.session-tree \{\n      transform: translate3d\(100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-tree \.tauren-chat-surface \{\n      transform: translate3d\(-100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-tree \.sessions \{\n      transform: translate3d\(-100%, 0, 0\);/);
    assert.match(html, /\.tauren-view--lane-tree \.session-tree \{\n      transform: translate3d\(0, 0, 0\);/);
    assert.ok(html.includes('--tauren-lane-transition-duration: 190ms'));
    assert.ok(html.includes('--tauren-lane-transition-easing: cubic-bezier(0.16, 1, 0.3, 1)'));
    assert.ok(html.includes('transition: transform var(--tauren-lane-transition-duration) var(--tauren-lane-transition-easing);'));
    assert.match(html, /\.tauren-view--has-extension-widgets-above \.messages \{\n      padding-bottom: calc\(14px \+ 1lh\);/);
    assert.ok(html.includes('class="settings-surface tauren-chat-surface__face tauren-chat-surface__settings"'));
    assert.ok(!html.includes('translate3d(200%, 0, 0)'));
    assert.ok(!html.includes('translate3d(-200%, 0, 0)'));
    assert.ok(!html.includes('tauren-view--tree-enter'));
    assert.ok(!html.includes('@keyframes tauren-session-tree-enter'));
    assert.ok(!html.includes('--tauren-tree-enter-transition-duration'));
    assert.ok(!html.includes('pi-view--lane-tree'));
    assert.ok(!html.includes('pi-view--lane-sessions'));
  });

  test('createWebviewHtml wires CSP nonce and stable composer markup', () => {
    const html = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      webviewScriptUri: 'vscode-resource://chat.js'
    });
    const scriptMatch = html.match(/<script nonce="([A-Za-z0-9]{32})"/);

    assert.ok(scriptMatch);
    const nonce = scriptMatch[1];

    assert.ok(
      html.includes(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">`
      )
    );
    assert.ok(html.includes('    .tauren-view {'));
    assert.ok(html.includes('      display: grid;'));
    assert.ok(!html.includes('vscode-resource://highlight.js'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://markdown-it.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://dompurify.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://chat.js"></script>'));
    assert.ok(html.includes('class="tauren-toolbar__sessions"'));
    assert.ok(html.includes('class="tauren-toolbar__tree"'));
    assert.ok(!html.includes('class="tauren-toolbar__new-session"'));
    assert.ok(!html.includes('class="tauren-toolbar__settings"'));
    assert.ok(!html.includes('class="tauren-toolbar__menu-wrap"'));
    assert.ok(html.includes('class="tauren-help-overlay"'));
    assert.ok(html.includes('<h3 id="chat-help-heading" class="tauren-help-overlay__section-title">Chat View</h3>'));
    assert.ok(html.includes('<h3 id="session-help-heading" class="tauren-help-overlay__section-title">Session List</h3>'));
    assert.ok(html.includes('<th scope="col">Key</th><th scope="col">Function</th>'));
    assert.ok(html.includes('<span class="tauren-icon-action-tooltip">Show tree</span>'));
    assert.ok(!html.includes('class="tauren-toolbar__edit"'));
    assert.ok(html.includes('class="tauren-toolbar__title-input"'));
    assert.ok(!html.includes('data-session-command="rename"'));
    assert.ok(!html.includes('data-session-command="showChanges"'));
    assert.ok(!html.includes('data-session-command="fork"'));
    assert.ok(!html.includes('data-session-command="clone"'));
    assert.ok(!html.includes('data-session-command="delete"'));
    assert.ok(!html.includes('tauren-toolbar__session-menu'));
    assert.ok(html.includes('class="messages" aria-live="polite" aria-label="Tauren conversation"'));
    assert.ok(html.includes('Don\'t show again'));
    assert.ok(html.includes('class="sessions" aria-label="Tauren sessions" role="listbox" tabindex="-1" aria-hidden="true"'));
    assert.ok(html.includes('class="session-tree" aria-label="Tauren session tree" role="listbox" tabindex="-1" aria-hidden="true"'));
    assert.ok(!html.includes('class="session-tree" aria-label="Tauren session tree" role="listbox" tabindex="-1" hidden'));
    assert.ok(html.includes('<form class="composer" aria-label="Prompt input">'));
    assert.ok(html.includes('class="composer__button composer__add"'));
    assert.ok(!html.includes('class="composer__button composer__fork"'));
    assert.ok(!html.includes('class="composer__button composer__clone"'));
    assert.ok(html.includes('class="composer__context-badges"'));
    assert.ok(html.includes('class="composer__context"'));
    assert.ok(html.includes('class="composer__context-tooltip"'));
    assert.ok(html.includes('class="composer__model"'));
    assert.ok(html.includes('class="composer__model-menu"'));
    assert.ok(html.includes('class="composer__slash-menu"'));
    assert.ok(html.includes('class="composer__busy-submit"'));
    assert.ok(html.includes('class="composer__diff-summary" type="button"'));
    assert.ok(html.includes('class="composer__diff-added"'));
    assert.ok(html.includes('class="composer__diff-removed"'));
    assert.ok(!html.includes('composer__busy-submit-hint'));
    assert.ok(html.includes('data-streaming-behavior="steer"'));
    assert.ok(html.includes('data-streaming-behavior="followUp"'));
    assert.ok(html.includes('aria-autocomplete="list"'));
    assert.ok(html.includes('placeholder="Write your prompt…"'));
    assert.ok(!html.includes('composer__model--refreshing'));
    assert.ok(html.includes('class="composer__select composer__thinking-select"'));
    assert.ok(html.includes('class="composer__select composer__model-select"'));
    assert.ok(html.includes('class="composer__button composer__submit"'));

    const dismissedHtml = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      webviewScriptUri: 'vscode-resource://chat.js'
    }, { welcomeDismissed: true });
    assert.ok(dismissedHtml.includes('<p class="empty-state">Ask Tauren about this workspace.</p>'));
    assert.ok(!dismissedHtml.includes('Don\'t show again'));
  });

  test('createWebviewHtml omits HTTPS images from CSP by default', () => {
    const html = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      webviewScriptUri: 'vscode-resource://chat.js',
      cspSource: 'vscode-webview-resource:'
    });

    assert.ok(html.includes('img-src data: vscode-webview-resource:;'));
    assert.ok(!html.includes('img-src data: https: vscode-webview-resource:;'));
  });

  test('createWebviewHtml allows HTTPS images in CSP when explicitly enabled', () => {
    const html = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      webviewScriptUri: 'vscode-resource://chat.js',
      cspSource: 'vscode-webview-resource:'
    }, {
      allowRemoteImages: true
    });

    assert.ok(html.includes('img-src data: https: vscode-webview-resource:;'));
  });
});
