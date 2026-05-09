const assert = require('node:assert/strict');
const test = require('node:test');
const { ChatSession } = require('../out/chatSession');

test('beginSubmit rejects blank input and accepts trimmed non-blank input', () => {
  const session = new ChatSession();

  assert.equal(session.beginSubmit('   '), undefined);
  assert.deepEqual(session.snapshot(), { messages: [], busy: false });

  assert.deepEqual(session.beginSubmit('  hello Pi  '), {
    text: 'hello Pi',
    sessionGeneration: 0
  });
  assert.deepEqual(session.snapshot(), {
    messages: [
      { role: 'user', text: 'hello Pi' },
      { role: 'assistant', text: '' }
    ],
    busy: true
  });
  assert.equal(session.beginSubmit('second prompt'), undefined);
});

test('assistant deltas append to the active assistant message', () => {
  const session = new ChatSession();

  session.beginSubmit('hello');

  assert.equal(session.appendAssistantDelta('Hi'), true);
  assert.equal(session.appendAssistantDelta(''), false);
  assert.equal(session.appendAssistantDelta(' there'), true);
  assert.deepEqual(session.snapshot(), {
    messages: [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi there' }
    ],
    busy: true
  });
});

test('agent lifecycle updates busy state and clears the active assistant on end', () => {
  const session = new ChatSession();

  session.handleAgentStart();
  assert.equal(session.snapshot().busy, true);

  session.appendAssistantDelta('late message');
  session.handleAgentEnd();
  assert.equal(session.snapshot().busy, false);

  session.addErrorMessage('after end');
  assert.deepEqual(session.snapshot(), {
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

  assert.equal(session.generation, 1);
  assert.deepEqual(session.snapshot(), { messages: [], busy: false });
  assert.deepEqual(session.beginSubmit('next'), {
    text: 'next',
    sessionGeneration: 1
  });
});

test('errors mark active assistant or create a system error when idle', () => {
  const session = new ChatSession();

  session.addErrorMessage('idle failure');
  assert.deepEqual(session.snapshot(), {
    messages: [
      { role: 'system', text: 'idle failure', error: true }
    ],
    busy: false
  });

  session.beginSubmit('hello');
  session.addErrorMessage('active failure');
  assert.deepEqual(session.snapshot(), {
    messages: [
      { role: 'system', text: 'idle failure', error: true },
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'active failure', error: true }
    ],
    busy: true
  });

  session.failActivePrompt('prompt failed');
  assert.equal(session.snapshot().busy, false);
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

  assert.equal(
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

  assert.deepEqual(session.snapshot(), {
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

test('activity snapshots are copied before returning', () => {
  const session = new ChatSession();

  session.beginSubmit('copy activity');
  session.addActivity({
    kind: 'rpc',
    title: 'RPC event',
    status: 'info',
    body: 'original'
  });

  const snapshot = session.snapshot();
  snapshot.messages[1].activities[0].body = 'changed';

  assert.equal(session.snapshot().messages[1].activities[0].body, 'original');
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

  assert.notEqual(firstId, secondId);
});
