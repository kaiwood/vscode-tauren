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
        animationsEnabled: true
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
        animationsEnabled: true
      }
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

  test('parseWebviewMessage narrows valid inbound messages', () => {
    assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'focusChanged', focused: true }), { type: 'focusChanged', focused: true });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'newSession' }), { type: 'newSession' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showSessions' }), { type: 'showSessions' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showTree' }), { type: 'showTree' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'hideSessions' }), { type: 'hideSessions' });
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
      parseWebviewMessage({ type: 'setSessionName', name: 'Feature work' }),
      { type: 'setSessionName', name: 'Feature work' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshMetadata' }), { type: 'refreshMetadata' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshSlashCommands' }), { type: 'refreshSlashCommands' });
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
    assert.deepStrictEqual(parseWebviewMessage({ type: 'submit', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'selectSession', sessionPath: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'deleteSession', sessionPath: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '', command: 'compact' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'sessionItemCommand', sessionPath: '/sessions/old.jsonl', command: 'bogus' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionItemName', sessionPath: '', name: 'Old work' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/old.jsonl', name: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'setSessionName', name: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptContext', id: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'copyText', text: 'assistant output', successMessage: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: '', code: 'const x = 1;', language: 'typescript' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: '', language: 'typescript' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'highlightCode', id: 'highlight-1', code: 'const x = 1;', language: 'typescript', themeId: 42 }), { type: 'unknown' });
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
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">`
      )
    );
    assert.ok(html.includes('    .pi-view {'));
    assert.ok(html.includes('      display: grid;'));
    assert.ok(!html.includes('vscode-resource://highlight.js'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://markdown-it.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://dompurify.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://chat.js"></script>'));
    assert.ok(html.includes('class="pi-toolbar__sessions"'));
    assert.ok(html.includes('class="pi-toolbar__tree"'));
    assert.ok(html.includes('<span class="tau-icon-action-tooltip">Show tree</span>'));
    assert.ok(!html.includes('class="pi-toolbar__edit"'));
    assert.ok(html.includes('class="pi-toolbar__title-input"'));
    assert.ok(html.includes('data-session-command="rename"'));
    assert.ok(!html.includes('data-session-command="showChanges"'));
    assert.ok(html.includes('data-session-command="fork"'));
    assert.ok(html.includes('data-session-command="clone"'));
    assert.ok(html.includes('data-session-command="delete"'));
    assert.ok(html.includes('<span class="pi-toolbar__menu-label">Rename session</span>'));
    assert.ok(html.includes('<span class="pi-toolbar__menu-label">Fork session</span>'));
    assert.ok(html.includes('<span class="pi-toolbar__menu-label">Clone session</span>'));
    assert.ok(html.includes('<span class="pi-toolbar__menu-label">Move session to trash</span>'));
    assert.ok(html.includes('class="pi-toolbar__menu-icon"'));
    assert.ok(!html.includes('pi-toolbar__session-menu'));
    assert.ok(html.includes('class="messages" aria-live="polite" aria-label="Pi conversation"'));
    assert.ok(html.includes('Don\'t show again'));
    assert.ok(html.includes('class="sessions" aria-label="Pi sessions and tree" role="listbox"'));
    assert.ok(html.includes('<form class="composer" aria-label="Pi message input">'));
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
    assert.ok(dismissedHtml.includes('<p class="empty-state">Ask Pi about this workspace.</p>'));
    assert.ok(!dismissedHtml.includes('Don\'t show again'));
  });
});
