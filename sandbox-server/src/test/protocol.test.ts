import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  createProtocolConnection, Requests, UiRequests,
  PROTOCOL_VERSION, assertProtocolVersion, TaurenErrorCodes,
  ResponseError
} from '../protocol/index.js';

/** Test fixture for delivering a complete notification before EOF. */
function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function pair() {
  const left = new PassThrough();
  const right = new PassThrough();
  const client = createProtocolConnection(left, right);
  const server = createProtocolConnection(right, left);
  client.listen();
  server.listen();
  return { client, server, close() { client.dispose(); server.dispose(); left.destroy(); right.destroy(); } };
}

test('Tauren connections support a host request with a reverse UI request', async () => {
  const p = pair();
  try {
    p.client.onRequest(UiRequests.confirm, ({ title }) => title === 'Confirm model');
    p.server.onRequest(Requests.setModel, async ({ provider, modelId }) => {
      const confirmed = await p.server.sendRequest(UiRequests.confirm, { title: 'Confirm model' });
      assert.equal(confirmed, true);
      return { provider, id: modelId };
    });
    assert.deepEqual(await p.client.sendRequest(Requests.setModel, {
      provider: 'fixture', modelId: 'scripted'
    }), { provider: 'fixture', id: 'scripted' });
  } finally { p.close(); }
});

test('Tauren protocol version policy accepts v1 and rejects incompatible versions', async () => {
  const p = pair();
  try {
    p.server.onRequest(Requests.initialize, params => {
      assertProtocolVersion(params.protocolVersion);
      return { protocolVersion: PROTOCOL_VERSION, serverVersion: 'fixture', piVersion: '1.5.1',
        workspace: params.workspace, sessionDirectory: params.sessionDirectory, capabilities: [] };
    });
    const params = { protocolVersion: 99, clientVersion: 'fixture', workspace: '/workspace', sessionDirectory: '/sessions' };
    await assert.rejects(p.client.sendRequest(Requests.initialize, params), error => {
      assert.ok(error instanceof ResponseError);
      assert.equal(error.code, TaurenErrorCodes.VersionMismatch);
      assert.deepEqual(error.data, { supportedVersion: PROTOCOL_VERSION });
      return true;
    });
    const result = await p.client.sendRequest(Requests.initialize, { ...params, protocolVersion: PROTOCOL_VERSION });
    assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  } finally { p.close(); }
});

for (const [name, raw] of [
  ['missing length', 'Other: 2\r\n\r\n{}'],
  ['invalid length', 'Content-Length: nope\r\n\r\n{}'],
  ['malformed JSON', 'Content-Length: 1\r\n\r\n{']
]) {
  test(`malformed input (${name}) reports an error and closes the connection`, async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const connection = createProtocolConnection(input, output);
    connection.listen();
    const errors: unknown[] = [];
    connection.onError(error => errors.push(error));
    const disposed = new Promise<void>(resolve => connection.onDispose(resolve));
    input.write(raw!);
    await disposed;
    assert.ok(errors.length > 0);
    input.destroy(); output.destroy();
  });
}

for (const partial of ['', 'Content-Len', 'Content-Length: 20\r\n\r\n{']) {
  test(`EOF disposes cleanly with ${partial ? 'an incomplete frame' : 'no frames'} and rejects pending calls`, async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const connection = createProtocolConnection(input, output);
    connection.listen();
    const written = new Promise<void>(resolve => output.once('data', () => resolve()));
    const pending = assert.rejects(connection.sendRequest('unanswered', null));
    await written;
    if (partial) input.write(partial);
    input.end();
    await pending;
    connection.dispose(); input.destroy(); output.destroy();
  });
}

test('clean EOF after a delivered notification disposes the connection', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createProtocolConnection(input, output);
  const received = new Promise<void>(resolve => connection.onNotification('fixture', resolve));
  connection.listen();
  const disposed = new Promise<void>(resolve => connection.onDispose(resolve));
  input.write(frame({ jsonrpc: '2.0', method: 'fixture' }));
  await received;
  input.end();
  await disposed;
  input.destroy(); output.destroy();
});
