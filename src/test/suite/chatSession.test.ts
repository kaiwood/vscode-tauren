import * as assert from 'assert';
import {
  ChatSession,
  chatActivityBodyMaxDisplayLength,
  chatTruncationMarker
} from '../../chat/chatSession';

suite('ChatSession', () => {
  test('beginSubmit rejects blank input and accepts trimmed non-blank input', () => {
    const session = new ChatSession();

    assert.strictEqual(session.beginSubmit('   '), undefined);
    assert.deepStrictEqual(session.snapshot(), { messages: [], busy: false });

    assert.deepStrictEqual(session.beginSubmit('  hello Pi  '), {
      text: 'hello Pi',
      sessionGeneration: 0
    });
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'hello Pi' },
        { role: 'assistant', text: '' }
      ],
      busy: true
    });
    assert.strictEqual(session.beginSubmit('second prompt'), undefined);
  });

  test('beginSubmit attaches images to the user message', () => {
    const session = new ChatSession();

    session.beginSubmit('describe this', [{ type: 'image', data: 'abc', mimeType: 'image/png', alt: 'screenshot.png' }]);

    assert.deepStrictEqual(session.snapshot().messages[0], {
      role: 'user',
      text: 'describe this',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png', alt: 'screenshot.png' }]
    });
  });

  test('webview snapshots include stable message ids and changing revisions', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    const first = session.webviewSnapshot();
    session.appendAssistantDelta('Hi');
    const second = session.webviewSnapshot();

    assert.strictEqual(first.messages[0].id, second.messages[0].id);
    assert.strictEqual(first.messages[1].id, second.messages[1].id);
    assert.strictEqual(first.messages[0].revision, second.messages[0].revision);
    assert.ok(second.messages[1].revision > first.messages[1].revision);
    assert.deepStrictEqual(session.snapshot().messages, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi' }
    ]);
  });

  test('assistant deltas append to the active assistant message', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');

    assert.strictEqual(session.appendAssistantDelta('Hi'), true);
    assert.strictEqual(session.appendAssistantDelta(''), false);
    assert.strictEqual(session.appendAssistantDelta(' there'), true);
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'Hi there' }
      ],
      busy: true
    });
  });

  test('assistant deltas create an assistant message when no prompt is active', () => {
    const session = new ChatSession();

    assert.strictEqual(session.appendAssistantDelta('late message'), true);
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'assistant', text: 'late message' }
      ],
      busy: false
    });
  });

  test('thinking streams inline in event order without overwriting previous thinking', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    assert.strictEqual(session.startThinking('thinking:0'), true);
    assert.strictEqual(session.appendThinkingDelta('thinking:0', 'first'), true);
    assert.strictEqual(session.appendThinkingDelta('thinking:0', ' thought'), true);
    assert.strictEqual(session.finishThinking('thinking:0', undefined), false);
    assert.strictEqual(session.appendAssistantDelta('answer'), true);
    assert.strictEqual(session.startThinking('thinking:1'), true);
    assert.strictEqual(session.appendThinkingDelta('thinking:1', 'second'), true);
    assert.strictEqual(session.finishThinking('thinking:1', 'final second'), true);
    assert.strictEqual(session.appendAssistantDelta(' after'), true);

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'first thought', variant: 'thinking' },
        { role: 'assistant', text: 'answer' },
        { role: 'assistant', text: 'final second', variant: 'thinking' },
        { role: 'assistant', text: ' after' }
      ],
      busy: true
    });
  });

  test('snapshots can hide thinking messages without deleting them', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    session.startThinking('thinking:0');
    session.appendThinkingDelta('thinking:0', 'private thought');
    session.appendAssistantDelta('answer');

    assert.deepStrictEqual(session.snapshot({ hideThinking: true }), {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'answer' }
      ],
      busy: true
    });
    assert.strictEqual(session.webviewSnapshot({ hideThinking: true }).messages.length, 2);
    assert.deepStrictEqual(session.snapshot().messages.map((message) => message.text), ['hello', 'private thought', 'answer']);
  });

  test('completeActivePrompt clears busy state and removes empty assistant placeholders', () => {
    const session = new ChatSession();

    session.beginSubmit('/extension-command');
    session.completeActivePrompt();

    assert.deepStrictEqual(session.snapshot(), {
      messages: [{ role: 'user', text: '/extension-command' }],
      busy: false
    });
  });

  test('completeActivePrompt keeps non-empty assistant output', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    session.appendAssistantDelta('partial output');
    session.completeActivePrompt();

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'partial output' }
      ],
      busy: false
    });
  });

  test('agent lifecycle updates busy state and clears the active assistant on end', () => {
    const session = new ChatSession();

    session.handleAgentStart();
    assert.strictEqual(session.snapshot().busy, true);

    session.appendAssistantDelta('late message');
    session.handleAgentEnd();
    assert.strictEqual(session.snapshot().busy, false);

    session.addErrorMessage('after end');
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'assistant', text: 'late message' },
        { role: 'system', text: 'after end', error: true }
      ],
      busy: false
    });
  });

  test('new sessions reset transcript and increment generation', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    session.appendAssistantDelta('response');
    session.startNewSession();

    assert.strictEqual(session.generation, 1);
    assert.deepStrictEqual(session.snapshot(), { messages: [], busy: false });
    assert.deepStrictEqual(session.beginSubmit('next'), {
      text: 'next',
      sessionGeneration: 1
    });
  });

  test('replaceMessages restores an idle transcript', () => {
    const session = new ChatSession();

    session.beginSubmit('old prompt');
    session.replaceMessages([
      { role: 'user', text: 'restored prompt' },
      { role: 'assistant', text: 'restored response' }
    ]);

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'restored prompt' },
        { role: 'assistant', text: 'restored response' }
      ],
      busy: false
    });
    assert.strictEqual(session.isEmpty, false);
  });

  test('setBusy updates busy state without changing transcript', () => {
    const session = new ChatSession();

    session.setBusy(true);
    assert.deepStrictEqual(session.snapshot(), { messages: [], busy: true });

    session.setBusy(false);
    assert.deepStrictEqual(session.snapshot(), { messages: [], busy: false });
  });

  test('errors mark active assistant or create a system error when idle', () => {
    const session = new ChatSession();

    session.addErrorMessage('idle failure');
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'system', text: 'idle failure', error: true }
      ],
      busy: false
    });

    session.beginSubmit('hello');
    session.addErrorMessage('active failure');
    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'system', text: 'idle failure', error: true },
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'active failure', error: true }
      ],
      busy: true
    });

    session.failActivePrompt('prompt failed');
    assert.strictEqual(session.snapshot().busy, false);
  });

  test('failActivePrompt records an assistant error and clears busy state', () => {
    const session = new ChatSession();

    session.beginSubmit('hello');
    session.failActivePrompt('prompt failed');

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'prompt failed', error: true }
      ],
      busy: false
    });
  });

  test('activities attach to the active assistant message and can be updated', () => {
    const session = new ChatSession();

    session.beginSubmit('show activity');
    const firstId = session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
      body: 'one',
      code: false
    });

    assert.strictEqual(
      session.upsertActivity('thinking:0', {
        kind: 'thinking',
        title: 'Thinking',
        status: 'running',
        body: ' two',
        code: false
      }, 'append'),
      firstId
    );

    session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'completed',
      summary: 'Completed'
    });

    session.addActivity({
      kind: 'turn',
      title: 'Turn completed',
      status: 'completed'
    });

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'show activity' },
        {
          role: 'assistant',
          text: '',
          activities: [
            {
              id: firstId,
              kind: 'thinking',
              title: 'Thinking',
              status: 'completed',
              summary: 'Completed',
              body: 'one two',
              code: false
            },
            {
              id: 'activity-0-2',
              kind: 'turn',
              title: 'Turn completed',
              status: 'completed'
            }
          ]
        }
      ],
      busy: true
    });
  });

  test('activity replace bodies are truncated for display', () => {
    const session = new ChatSession();
    const longBody = 'x'.repeat(chatActivityBodyMaxDisplayLength + 1);
    const longExpandedBody = 'y'.repeat(chatActivityBodyMaxDisplayLength + 1);

    session.beginSubmit('show activity');
    session.addActivity({
      kind: 'pi',
      title: 'Large Pi event',
      status: 'info',
      body: longBody,
      expandedBody: longExpandedBody
    });

    const activity = session.snapshot().messages[1].activities![0];
    assert.strictEqual(activity.body, truncateForTest(longBody));
    assert.strictEqual(activity.expandedBody, truncateForTest(longExpandedBody));
  });

  test('activity append bodies are truncated for display', () => {
    const session = new ChatSession();
    const keptLength = chatActivityBodyMaxDisplayLength - chatTruncationMarker.length;
    const firstChunk = 'a'.repeat(keptLength - 2);
    const secondChunk = 'b'.repeat(chatTruncationMarker.length + 3);

    session.beginSubmit('show activity');
    session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
      body: firstChunk
    });
    session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
      body: secondChunk,
      expandedBody: longBodyForTest('expanded')
    }, 'append');

    const activity = session.snapshot().messages[1].activities![0];
    assert.strictEqual(activity.body, truncateForTest(`${firstChunk}${secondChunk}`));
    assert.strictEqual(activity.expandedBody, truncateForTest(longBodyForTest('expanded')));
  });

  test('normal short activity bodies are unchanged', () => {
    const session = new ChatSession();

    session.beginSubmit('show activity');
    session.addActivity({
      kind: 'pi',
      title: 'Short Pi event',
      status: 'info',
      body: 'short body'
    });
    session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
      body: 'one'
    });
    session.upsertActivity('thinking:0', {
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
      body: ' two'
    }, 'append');

    assert.strictEqual(session.snapshot().messages[1].activities![0].body, 'short body');
    assert.strictEqual(session.snapshot().messages[1].activities![1].body, 'one two');
  });

  test('removeActivity removes an upserted activity and source mapping', () => {
    const session = new ChatSession();

    session.beginSubmit('show activity');
    session.upsertActivity('tool:call-1', {
      kind: 'tool_execution',
      title: 'Running bash',
      status: 'running'
    });

    session.removeActivity('tool:call-1');

    assert.deepStrictEqual(session.snapshot(), {
      messages: [
        { role: 'user', text: 'show activity' },
        { role: 'assistant', text: '' }
      ],
      busy: true
    });

    const nextId = session.upsertActivity('tool:call-1', {
      kind: 'tool_execution',
      title: 'Running bash again',
      status: 'running'
    });

    assert.strictEqual(nextId, 'activity-0-2');
  });

  test('message and activity snapshots are copied before returning', () => {
    const session = new ChatSession();

    session.beginSubmit('copy activity');
    session.addActivity({
      kind: 'pi',
      title: 'Pi event',
      status: 'info',
      body: 'original'
    });

    const snapshot = session.snapshot();
    snapshot.messages[0].text = 'changed user text';
    snapshot.messages[1].activities![0].body = 'changed activity';

    const nextSnapshot = session.snapshot();
    assert.strictEqual(nextSnapshot.messages[0].text, 'copy activity');
    assert.strictEqual(nextSnapshot.messages[1].activities![0].body, 'original');
  });

  test('ending an agent run clears activity source mappings', () => {
    const session = new ChatSession();

    session.beginSubmit('first');
    const firstId = session.upsertActivity('agent', {
      kind: 'agent',
      title: 'Agent processing',
      status: 'running'
    });
    session.handleAgentEnd();

    const secondId = session.upsertActivity('agent', {
      kind: 'agent',
      title: 'Agent processing',
      status: 'running'
    });

    assert.notStrictEqual(firstId, secondId);
  });

  test('starting a new session resets activity ids and source mappings', () => {
    const session = new ChatSession();

    session.beginSubmit('first');
    session.upsertActivity('source', {
      kind: 'pi',
      title: 'First',
      status: 'info'
    });
    session.startNewSession();
    session.beginSubmit('second');

    const id = session.upsertActivity('source', {
      kind: 'pi',
      title: 'Second',
      status: 'info'
    });

    assert.strictEqual(id, 'activity-1-1');
  });
});

function longBodyForTest(prefix: string): string {
  return `${prefix}${'x'.repeat(chatActivityBodyMaxDisplayLength + 1)}`;
}

function truncateForTest(value: string): string {
  return `${value.slice(0, chatActivityBodyMaxDisplayLength - chatTruncationMarker.length)}${chatTruncationMarker}`;
}
