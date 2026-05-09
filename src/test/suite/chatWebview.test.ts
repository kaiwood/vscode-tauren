import * as assert from 'assert';
import { createWebviewHtml, createWebviewStateMessage } from '../../chatWebview';
import type { ChatState } from '../../chatSession';

suite('Chat webview helpers', () => {
  test('createWebviewStateMessage adds message type, model label, and context usage', () => {
    const state: ChatState = {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' }
      ],
      busy: true
    };

    assert.deepStrictEqual(createWebviewStateMessage(state, 'gpt-test High', '30%', '60,000 / 200,000 context tokens', 'low'), {
      type: 'state',
      messages: state.messages,
      busy: true,
      modelLabel: 'gpt-test High',
      contextUsageLabel: '30%',
      contextUsageTitle: '60,000 / 200,000 context tokens',
      contextUsageLevel: 'low'
    });
  });

  test('createWebviewStateMessage defaults to an empty model label', () => {
    assert.deepStrictEqual(
      createWebviewStateMessage({ messages: [], busy: false }),
      {
        type: 'state',
        messages: [],
        busy: false,
        modelLabel: '',
        contextUsageLabel: '',
        contextUsageTitle: '',
        contextUsageLevel: ''
      }
    );
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
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://highlight.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://markdown-it.js"></script>'));
    assert.ok(html.includes('<script nonce="' + nonce + '" src="vscode-resource://dompurify.js"></script>'));
    assert.ok(html.includes('class="messages" aria-live="polite" aria-label="Pi conversation"'));
    assert.ok(html.includes('<form class="composer" aria-label="Pi message input">'));
    assert.ok(!html.includes('Full RPC Agent communication'));
    assert.ok(!html.includes('setFullRpcAgentCommunication'));
    assert.ok(html.includes('class="composer__button composer__add"'));
    assert.ok(html.includes('class="composer__context"'));
    assert.ok(html.includes('class="composer__context-tooltip"'));
    assert.ok(html.includes('class="composer__model"'));
    assert.ok(html.includes('class="composer__button composer__submit"'));
    assert.ok(html.includes("vscode.postMessage({ type: 'ready' });"));
  });
});
