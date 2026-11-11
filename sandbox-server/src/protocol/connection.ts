import type { Readable, Writable } from 'node:stream';
import {
  createMessageConnection, StreamMessageReader, StreamMessageWriter,
  type Logger, type MessageConnection
} from 'vscode-jsonrpc/node.js';

/** Content-Length framing, UTF-8 decoding, request IDs, and cancellation are
 * owned by vscode-jsonrpc, not a second Tauren codec. This adapter supplies the
 * stdio EOF policy: dispose the connection and reject outstanding requests.
 * Caller owns the streams, must call listen(), and must await shutdown before
 * ending output. No SDK runtime is created by this helper.
 */
export function createProtocolConnection(input: Readable, output: Writable, logger?: Logger): MessageConnection {
  const reader = new StreamMessageReader(input);
  // Startup/request deadlines belong to the lifecycle service. Disable the
  // library's recurring partial-frame timer so EOF cannot leave it alive.
  reader.partialMessageTimeout = 0;
  const writer = new StreamMessageWriter(output);
  const connection = createMessageConnection(reader, writer, logger);
  // The library reports malformed framing/JSON through onError; continuing on
  // an untrusted stream would risk losing framing synchronization.
  const onError = reader.onError(() => connection.dispose());
  const onClose = connection.onClose(() => connection.dispose());
  const onEnd = () => {
    // EOF terminates this connection, including incomplete frames and pending
    // handlers. It does not imply delivery acknowledgements or prompt replay.
    connection.dispose();
  };
  input.once('end', onEnd);
  const onDispose = connection.onDispose(() => {
    input.off('end', onEnd);
    onError.dispose();
    onClose.dispose();
    onDispose.dispose();
    reader.dispose();
    writer.dispose();
  });
  return connection;
}
