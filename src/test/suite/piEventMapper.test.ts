import * as assert from 'assert';
import {
  formatExtensionError,
  mapMessageUpdate,
  mapPiActivity
} from '../../pi/eventMapper';

suite('Pi event mapper', () => {
  test('mapMessageUpdate maps assistant response lifecycle activity', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'start' }
      }, 4),
      {
        type: 'activity_update',
        sourceId: 'assistant:4',
        activity: {
          kind: 'message',
          title: 'Assistant response',
          status: 'running',
          summary: 'Started'
        }
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 1 }
      }, 4),
      {
        type: 'activity_update',
        sourceId: 'assistant-text:4:1',
        activity: {
          kind: 'message',
          title: 'Writing response',
          status: 'running'
        }
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 1, content: 'hello' }
      }, 4),
      {
        type: 'activity_update',
        sourceId: 'assistant-text:4:1',
        activity: {
          kind: 'message',
          title: 'Response text',
          status: 'completed',
          summary: '5 characters'
        }
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'done', reason: 'stop' }
      }, 4),
      {
        type: 'activity_update',
        sourceId: 'assistant:4',
        activity: {
          kind: 'message',
          title: 'Assistant response',
          status: 'completed',
          summary: 'Done: stop'
        }
      }
    );
  });

  test('mapMessageUpdate extracts assistant text deltas', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
      }),
      { type: 'text_delta', delta: 'hello' }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 42 }
      }),
      { type: 'text_delta', delta: '' }
    );
  });

  test('mapMessageUpdate extracts assistant error messages', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'error', reason: 'reason wins', error: 'fallback' }
      }),
      { type: 'assistant_error', message: 'reason wins' }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'error', error: 'fallback error' }
      }),
      { type: 'assistant_error', message: 'fallback error' }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'error' }
      }),
      { type: 'assistant_error', message: 'Pi reported an error while responding.' }
    );
  });

  test('mapMessageUpdate ignores malformed updates', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({ type: 'message_update' }),
      { type: 'ignore' }
    );
  });

  test('mapMessageUpdate exposes unknown updates as activity', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'tool_call' }
      }),
      {
        type: 'activity_add',
        activity: {
          kind: 'pi',
          title: 'Message update: tool_call',
          status: 'info',
          body: '{\n  "type": "tool_call"\n}',
          code: true
        }
      }
    );
  });

  test('mapMessageUpdate maps thinking stream messages', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 }
      }, 2),
      {
        type: 'thinking_start',
        sourceId: 'thinking:2:0'
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'step' }
      }, 2),
      {
        type: 'thinking_delta',
        sourceId: 'thinking:2:0',
        delta: 'step'
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0 }
      }, 2),
      {
        type: 'thinking_end',
        sourceId: 'thinking:2:0'
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'final thinking' }
      }, 2),
      {
        type: 'thinking_end',
        sourceId: 'thinking:2:0',
        content: 'final thinking'
      }
    );
  });

  test('mapMessageUpdate maps tool call construction activity', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_start' }
      }, 3),
      {
        type: 'activity_update',
        sourceId: 'toolcall:3:current',
        activity: {
          kind: 'tool_call',
          title: 'Preparing tool call',
          status: 'running',
          body: '',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{"command"' }
      }, 3),
      {
        type: 'activity_update',
        sourceId: 'toolcall:3:1',
        activity: {
          kind: 'tool_call',
          title: 'Preparing tool call',
          status: 'running',
          body: '{"command"',
          code: true
        },
        bodyMode: 'append'
      }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 1,
          toolCall: {
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'npm test' }
          }
        }
      }, 3),
      {
        type: 'activity_update',
        sourceId: 'toolcall:3:1',
        activity: {
          kind: 'tool_call',
          title: 'Prepared tool call: bash',
          status: 'completed',
          summary: '{ "command": "npm test" }',
          body: '{\n  "command": "npm test"\n}',
          code: true
        }
      }
    );
  });

  test('mapPiActivity maps agent lifecycle', () => {
    assert.deepStrictEqual(
      mapPiActivity({ type: 'agent_start' }),
      {
        type: 'activity_update',
        sourceId: 'agent',
        activity: {
          kind: 'agent',
          title: 'Agent processing',
          status: 'running',
          summary: 'Started'
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'agent_end', messages: [{}, {}] }),
      {
        type: 'activity_update',
        sourceId: 'agent',
        activity: {
          kind: 'agent',
          title: 'Agent processing',
          status: 'completed',
          summary: '2 messages'
        }
      }
    );
  });

  test('mapPiActivity maps turn and message events', () => {
    assert.deepStrictEqual(
      mapPiActivity({ type: 'turn_start' }),
      {
        type: 'activity_add',
        activity: {
          kind: 'turn',
          title: 'Turn started',
          status: 'info'
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'turn_end', toolResults: [{}] }),
      {
        type: 'activity_add',
        activity: {
          kind: 'turn',
          title: 'Turn completed',
          status: 'completed',
          summary: '1 tool result',
          body: '{\n  "toolResults": [\n    {}\n  ]\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'message_start', message: { role: 'assistant', content: 'hi' } }),
      {
        type: 'activity_add',
        activity: {
          kind: 'message',
          title: 'Assistant message started',
          status: 'info',
          body: '{\n  "message": {\n    "role": "assistant",\n    "content": "hi"\n  }\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'message_end', message: { role: 'assistant' } }),
      {
        type: 'activity_add',
        activity: {
          kind: 'message',
          title: 'Assistant message completed',
          status: 'completed',
          body: '{\n  "message": {\n    "role": "assistant"\n  }\n}',
          code: true
        }
      }
    );
  });

  test('mapMessageUpdate hides verbose message events when full communication is disabled', () => {
    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 1 }
      }, 4, { fullCommunication: false }),
      { type: 'ignore' }
    );

    assert.deepStrictEqual(
      mapMessageUpdate({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'step' }
      }, 2, { fullCommunication: false }),
      {
        type: 'thinking_delta',
        sourceId: 'thinking:2:0',
        delta: 'step'
      }
    );
  });

  test('mapPiActivity maps tool execution lifecycle', () => {
    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' }
      }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'running'
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_update',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' },
        partialResult: { content: [{ type: 'text', text: 'passing' }] }
      }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'running',
          body: 'passing',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'failed' }] },
        isError: true
      }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'error',
          body: 'failed',
          code: true
        }
      }
    );
  });

  test('mapPiActivity omits expanded body for running bash output previews', () => {
    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_update',
        toolCallId: 'call-bash',
        toolName: 'bash',
        args: { command: 'npm run compile' },
        partialResult: { content: [{ type: 'text', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' }] }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-bash',
        activity: {
          kind: 'tool_execution',
          title: '$ npm run compile',
          status: 'running',
          body: '... (2 earlier lines)\n3\n4\n5\n6\n7\n8\n9\n10',
          code: true
        }
      }
    );
  });

  test('mapPiActivity formats common tools and previews long output', () => {
    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-read',
        toolName: 'read',
        args: { path: 'package.json', offset: 1, limit: 120 },
        result: { content: [{ type: 'text', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' }] }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-read',
        activity: {
          kind: 'tool_execution',
          title: 'read package.json:1-120',
          status: 'completed',
          body: '1\n2\n3\n4\n5\n6\n7\n8\n... (2 more lines)',
          expandedBody: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-bash',
        toolName: 'bash',
        args: { command: 'npm run compile' },
        result: { content: [{ type: 'text', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' }] }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-bash',
        activity: {
          kind: 'tool_execution',
          title: '$ npm run compile',
          status: 'completed',
          body: '... (2 earlier lines)\n3\n4\n5\n6\n7\n8\n9\n10',
          expandedBody: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-edit',
        toolName: 'edit',
        args: {
          path: 'src/example.ts',
          edits: [{ oldText: 'const value = 1;', newText: 'const value = 2;' }]
        },
        result: { content: [{ type: 'text', text: 'Successfully edited src/example.ts' }] }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-edit',
        activity: {
          kind: 'tool_execution',
          title: 'edit src/example.ts',
          status: 'completed',
          summary: '1 replacement',
          body: '\x1b[31m-const value = 1;\x1b[0m\n\x1b[32m+const value = 2;\x1b[0m',
          code: true
        }
      }
    );
  });

  test('mapPiActivity keeps concise tool execution visible when full communication is disabled', () => {
    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test', timeout: 120 }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test (timeout 120s)',
          status: 'running'
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_update',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' },
        partialResult: 'running'
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'running',
          body: 'running',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' }
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'completed'
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'failed' }] },
        isError: true
      }, { fullCommunication: false }),
      {
        type: 'activity_update',
        sourceId: 'tool:call-1',
        activity: {
          kind: 'tool_execution',
          title: '$ npm test',
          status: 'error',
          body: 'failed',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'turn_start' }, { fullCommunication: false }),
      { type: 'ignore' }
    );
  });

  test('mapPiActivity maps queue, compaction, and retry events', () => {
    assert.deepStrictEqual(
      mapPiActivity({ type: 'queue_update', queueLength: 2 }),
      {
        type: 'activity_add',
        activity: {
          kind: 'queue',
          title: 'Queue updated',
          status: 'info',
          body: '{\n  "queueLength": 2\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'compaction_start', remainingTokens: 4000 }),
      {
        type: 'activity_update',
        sourceId: 'compaction',
        activity: {
          kind: 'compaction',
          title: 'Compacting context…',
          status: 'running',
          body: '{\n  "remainingTokens": 4000\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'compaction_end', result: { summary: 'Summary text', tokensBefore: 123333 } }),
      {
        type: 'activity_update',
        sourceId: 'compaction',
        activity: {
          kind: 'compaction',
          title: 'Compacted 123,333 tokens',
          status: 'completed',
          body: 'Summary text',
          code: false
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'compaction_end', remainingTokens: 6000 }),
      {
        type: 'activity_update',
        sourceId: 'compaction',
        activity: {
          kind: 'compaction',
          title: 'Compacted session context',
          status: 'completed',
          summary: 'Completed',
          body: '{\n  "remainingTokens": 6000\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'auto_retry_start', attempt: 2 }),
      {
        type: 'activity_update',
        sourceId: 'auto-retry',
        activity: {
          kind: 'retry',
          title: 'Auto retry',
          status: 'running',
          body: '{\n  "attempt": 2\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'auto_retry_end', success: false }),
      {
        type: 'activity_update',
        sourceId: 'auto-retry',
        activity: {
          kind: 'retry',
          title: 'Auto retry',
          status: 'error',
          body: '{\n  "success": false\n}',
          code: true
        }
      }
    );
  });

  test('mapPiActivity maps extension errors and unknown events', () => {
    assert.deepStrictEqual(
      mapPiActivity({
        type: 'extension_error',
        extensionPath: 'tool',
        error: 'boom'
      }),
      {
        type: 'activity_add',
        activity: {
          kind: 'extension_error',
          title: 'Extension error',
          status: 'error',
          summary: 'boom',
          body: '{\n  "extensionPath": "tool",\n  "error": "boom"\n}',
          code: true
        }
      }
    );

    assert.deepStrictEqual(
      mapPiActivity({ type: 'future_event', value: 1 }),
      {
        type: 'activity_add',
        activity: {
          kind: 'pi',
          title: 'Pi event: future_event',
          status: 'info',
          body: '{\n  "type": "future_event",\n  "value": 1\n}',
          code: true
        }
      }
    );
  });

  test('mapPiActivity ignores message updates', () => {
    assert.deepStrictEqual(mapPiActivity({ type: 'message_update' }), { type: 'ignore' });
  });

  test('formatExtensionError includes extension path and error fallback', () => {
    assert.strictEqual(
      formatExtensionError({
        type: 'extension_error',
        extensionPath: 'tool',
        error: 'boom'
      }),
      'Pi tool error: boom'
    );

    assert.strictEqual(
      formatExtensionError({ type: 'extension_error' }),
      'Pi extension error: Unknown extension error.'
    );
  });
});
