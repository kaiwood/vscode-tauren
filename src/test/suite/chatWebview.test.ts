import * as assert from 'assert';
import {
  createWebviewHtml,
  createWebviewStateMessage,
  parseWebviewMessage
} from '../../chatWebview';
import { chatWebviewScript } from '../../chatWebviewScript';
import type { ChatState } from '../../chatSession';

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
        slashCommands: [],
        slashCommandsRefreshing: false
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
        slashCommands: [],
        slashCommandsRefreshing: false
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
    assert.deepStrictEqual(parseWebviewMessage({ type: 'newSession' }), { type: 'newSession' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'showSessions' }), { type: 'showSessions' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'hideSessions' }), { type: 'hideSessions' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshSessions' }), { type: 'refreshSessions' });
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/current.jsonl' }),
      { type: 'selectSession', sessionPath: '/sessions/current.jsonl' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshMetadata' }), { type: 'refreshMetadata' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'refreshSlashCommands' }), { type: 'refreshSlashCommands' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptContext', id: 'context-1' }), { type: 'removePromptContext', id: 'context-1' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'abort' }), { type: 'abort' });
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
    assert.deepStrictEqual(parseWebviewMessage({ type: 'submit', text: 42 }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'selectSession', sessionPath: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'removePromptContext', id: '' }), { type: 'unknown' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'submit', text: 'hello', streamingBehavior: 'later' }), { type: 'unknown' });
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'setModel', provider: 'openai' }),
      { type: 'unknown' }
    );
    assert.deepStrictEqual(parseWebviewMessage({ type: 'futureMessage' }), { type: 'unknown' });
  });

  test('embedded webview script is valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(chatWebviewScript));
  });

  test('createWebviewHtml wires CSP nonce and stable composer markup', () => {
    const html = createWebviewHtml({
      markdownItScriptUri: 'vscode-resource://markdown-it.js',
      domPurifyScriptUri: 'vscode-resource://dompurify.js',
      highlightScriptUri: 'vscode-resource://highlight.js'
    });
    const scriptMatch = html.match(/<script nonce="([A-Za-z0-9]{32})"/);

    assert.ok(scriptMatch);
    const nonce = scriptMatch[1];

    assert.ok(
      html.includes(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">`
      )
    );
    assert.ok(html.includes('    .pi-view {\n      display: grid;'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://highlight.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://markdown-it.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://dompurify.js"></script>'));
    assert.ok(html.includes('class="pi-toolbar__sessions"'));
    assert.ok(html.includes('class="messages" aria-live="polite" aria-label="Pi conversation"'));
    assert.ok(html.includes('class="sessions" aria-label="Pi sessions" role="listbox"'));
    assert.ok(html.includes('<form class="composer" aria-label="Pi message input">'));
    assert.ok(!html.includes('Full RPC Agent communication'));
    assert.ok(!html.includes('setFullRpcAgentCommunication'));
    assert.ok(html.includes('class="composer__button composer__add"'));
    assert.ok(html.includes('class="composer__context-badges"'));
    assert.ok(html.includes('class="composer__context"'));
    assert.ok(html.includes('class="composer__context-tooltip"'));
    assert.ok(html.includes('class="composer__model"'));
    assert.ok(html.includes('class="composer__model-menu"'));
    assert.ok(html.includes('class="composer__slash-menu"'));
    assert.ok(html.includes('class="composer__busy-submit"'));
    assert.ok(html.includes('data-streaming-behavior="steer"'));
    assert.ok(html.includes('data-streaming-behavior="followUp"'));
    assert.ok(html.includes('aria-autocomplete="list"'));
    assert.ok(html.includes('placeholder="Write your prompt…"'));
    assert.ok(html.includes('composer__model--refreshing'));
    assert.ok(html.includes('class="composer__select composer__thinking-select"'));
    assert.ok(html.includes('class="composer__select composer__model-select"'));
    assert.ok(html.includes('class="composer__button composer__submit"'));
    assert.ok(html.includes('state.modelOptions.length === 0 && !state.metadataRefreshing'));
    assert.ok(html.includes("vscode.postMessage({ type: 'refreshMetadata' });"));
    assert.ok(html.includes("vscode.postMessage({ type: 'refreshSlashCommands' });"));
    assert.ok(html.includes("vscode.postMessage({ type: 'showSessions' });"));
    assert.ok(html.includes("vscode.postMessage({ type: 'ready' });"));
  });
});
