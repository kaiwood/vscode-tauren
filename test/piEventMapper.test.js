const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatExtensionError,
  getFailedResponseError,
  mapExtensionUiRequest,
  mapMessageUpdate,
  mapRpcActivity
} = require('../out/piEventMapper');

test('mapMessageUpdate extracts assistant text deltas', () => {
  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    }),
    { type: 'text_delta', delta: 'hello' }
  );

  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 42 }
    }),
    { type: 'text_delta', delta: '' }
  );
});

test('mapMessageUpdate extracts assistant error messages', () => {
  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'error', reason: 'reason wins', error: 'fallback' }
    }),
    { type: 'assistant_error', message: 'reason wins' }
  );

  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'error', error: 'fallback error' }
    }),
    { type: 'assistant_error', message: 'fallback error' }
  );

  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'error' }
    }),
    { type: 'assistant_error', message: 'Pi reported an error while responding.' }
  );
});

test('mapMessageUpdate ignores malformed or unsupported updates', () => {
  assert.deepEqual(
    mapMessageUpdate({ type: 'message_update' }),
    { type: 'ignore' }
  );
});

test('mapMessageUpdate exposes unknown updates as activity', () => {
  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'tool_call' }
    }),
    {
      type: 'activity_add',
      activity: {
        kind: 'rpc',
        title: 'Message update: tool_call',
        status: 'info',
        body: '{\n  "type": "tool_call"\n}',
        code: true
      }
    }
  );
});

test('mapMessageUpdate maps thinking stream activity', () => {
  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 }
    }, 2),
    {
      type: 'activity_update',
      sourceId: 'thinking:2:0',
      activity: {
        kind: 'thinking',
        title: 'Thinking',
        status: 'running',
        body: '',
        code: false
      }
    }
  );

  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'step' }
    }, 2),
    {
      type: 'activity_update',
      sourceId: 'thinking:2:0',
      activity: {
        kind: 'thinking',
        title: 'Thinking',
        status: 'running',
        body: 'step',
        code: false
      },
      bodyMode: 'append'
    }
  );
});

test('mapMessageUpdate maps tool call construction activity', () => {
  assert.deepEqual(
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

test('mapRpcActivity maps tool execution lifecycle', () => {
  assert.deepEqual(
    mapRpcActivity({
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
        title: 'Running bash',
        status: 'running',
        summary: 'npm test',
        body: '{\n  "command": "npm test"\n}',
        code: true
      }
    }
  );

  assert.deepEqual(
    mapRpcActivity({
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
        title: 'Running bash',
        status: 'running',
        summary: 'npm test',
        body: 'passing',
        code: true
      }
    }
  );

  assert.deepEqual(
    mapRpcActivity({
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
        title: 'bash failed',
        status: 'error',
        summary: 'npm test',
        body: 'failed',
        code: true
      }
    }
  );
});

test('mapRpcActivity maps extension UI and unknown events', () => {
  assert.deepEqual(
    mapRpcActivity({
      type: 'extension_ui_request',
      method: 'confirm',
      title: 'Allow command?'
    }),
    {
      type: 'activity_add',
      activity: {
        kind: 'extension_ui',
        title: 'Extension UI: confirm',
        status: 'info',
        summary: 'Allow command?',
        body: '{\n  "method": "confirm",\n  "title": "Allow command?"\n}',
        code: true
      }
    }
  );

  assert.deepEqual(
    mapRpcActivity({ type: 'future_event', value: 1 }),
    {
      type: 'activity_add',
      activity: {
        kind: 'rpc',
        title: 'RPC event: future_event',
        status: 'info',
        body: '{\n  "type": "future_event",\n  "value": 1\n}',
        code: true
      }
    }
  );
});

test('mapExtensionUiRequest maps notifications and unsupported dialogs', () => {
  assert.deepEqual(
    mapExtensionUiRequest({
      type: 'extension_ui_request',
      method: 'notify',
      message: 'Saved',
      notifyType: 'warning'
    }),
    { type: 'notify', message: 'Saved', notifyType: 'warning' }
  );

  assert.deepEqual(
    mapExtensionUiRequest({
      type: 'extension_ui_request',
      method: 'notify'
    }),
    { type: 'notify', message: 'Pi notification', notifyType: 'info' }
  );

  assert.deepEqual(
    mapExtensionUiRequest({
      type: 'extension_ui_request',
      method: 'select',
      id: 'dialog-1'
    }),
    { type: 'cancel', id: 'dialog-1' }
  );

  assert.deepEqual(
    mapExtensionUiRequest({
      type: 'extension_ui_request',
      method: 'select'
    }),
    { type: 'ignore' }
  );
});

test('getFailedResponseError maps failed unmatched responses only', () => {
  assert.equal(
    getFailedResponseError({ type: 'response', success: true }),
    undefined
  );
  assert.equal(
    getFailedResponseError({ type: 'response', success: false, error: 'bad command' }),
    'bad command'
  );
  assert.equal(
    getFailedResponseError({ type: 'response', success: false }),
    'Pi command failed.'
  );
});

test('formatExtensionError includes extension path and error fallback', () => {
  assert.equal(
    formatExtensionError({
      type: 'extension_error',
      extensionPath: 'sample-extension',
      error: 'boom'
    }),
    'Pi sample-extension error: boom'
  );

  assert.equal(
    formatExtensionError({ type: 'extension_error' }),
    'Pi extension error: Unknown extension error.'
  );
});
