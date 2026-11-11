#!/usr/bin/env node

import { Console } from 'node:console';
import { readFileSync } from 'node:fs';
import { createProtocolConnection } from './protocol/index.js';

// Reserve stdout for protocol bytes before loading the SDK or any extensions.
// Extension console output remains visible as stderr diagnostics.
globalThis.console = new Console(process.stderr, process.stderr);
const { registerServer } = await import('./server.js');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const logger = { error: (message: string) => console.error(message),
  warn: (message: string) => console.warn(message), info: (message: string) => console.info(message),
  log: (message: string) => console.log(message) };
const connection = createProtocolConnection(process.stdin, process.stdout, logger);
let deadline: NodeJS.Timeout | undefined;
let exiting = false;

/** Bound both SDK cleanup and waiting for the host to close after shutdown ack. */
function beginShutdown() {
  deadline ??= setTimeout(() => {
    console.error('Server shutdown deadline exceeded');
    process.exit(1);
  }, 5000);
}
const server = registerServer(connection, version, beginShutdown);

async function exit() {
  if (exiting) return;
  exiting = true;
  beginShutdown();
  try {
    await server.dispose();
    connection.dispose();
    process.stdout.end(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  } catch (error) {
    console.error('Server cleanup failed:', error);
    process.exit(1);
  }
}
connection.onDispose(() => { void exit(); });
process.once('SIGTERM', () => { void exit(); });
process.once('SIGINT', () => { void exit(); });
process.once('SIGHUP', () => { void exit(); });
connection.listen();
