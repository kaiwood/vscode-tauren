const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatExtensionError,
  getFailedResponseError,
  mapExtensionUiRequest,
  mapMessageUpdate
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
  assert.deepEqual(
    mapMessageUpdate({
      type: 'message_update',
      assistantMessageEvent: { type: 'tool_call' }
    }),
    { type: 'ignore' }
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
