import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  getAgentDir, SessionManager, SettingsManager, VERSION, type AgentSessionRuntime
} from '@earendil-works/pi-coding-agent';
import { ErrorCodes, ResponseError, type MessageConnection } from 'vscode-jsonrpc';
import {
  assertProtocolVersion, Notifications, PROTOCOL_VERSION, Requests, TaurenErrorCodes,
  type InitializeResult, type Snapshot, type JsonValue
} from './protocol/index.js';

interface ServerConfiguration {
  workspace: string;
  sessionDirectory: string;
  sessionFile?: string;
}

/** Convert SDK snapshots to JSON, omitting undefined optional fields. */
function snapshot(value: unknown): Snapshot {
  return JSON.parse(JSON.stringify(value)) as Snapshot;
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ResponseError(ErrorCodes.InvalidParams, 'Expected an object');
  }
  return input as Record<string, unknown>;
}
function absolute(value: unknown, name: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new ResponseError(TaurenErrorCodes.IncompatibleRuntime, `${name} must be an absolute path`);
  }
  return path.resolve(value);
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve symlinks even when the final directory does not exist yet. */
async function canonical(target: string): Promise<string> {
  try { return await fs.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.join(await canonical(path.dirname(target)), path.basename(target));
  }
}

/** RequestType checks callers at compile time, not JSON received over the pipe.
 * Validate initialize's untrusted payload and return canonical runtime paths.
 */
async function validateInitializeParams(input: unknown): Promise<ServerConfiguration> {
  const params = object(input);
  if (!Number.isInteger(params.protocolVersion) || typeof params.clientVersion !== 'string') {
    throw new ResponseError(ErrorCodes.InvalidParams, 'initialize requires protocolVersion and clientVersion');
  }
  assertProtocolVersion(params.protocolVersion as number);
  try {
    const workspace = await fs.realpath(absolute(params.workspace, 'workspace'));
    if (!(await fs.stat(workspace)).isDirectory()) throw new Error('workspace is not a directory');
    const sessionDirectory = await canonical(absolute(params.sessionDirectory, 'sessionDirectory'));
    if (within(workspace, sessionDirectory)) throw new Error('sessionDirectory must be outside workspace');
    let sessionFile: string | undefined;
    if (params.sessionFile !== undefined) {
      sessionFile = await fs.realpath(absolute(params.sessionFile, 'sessionFile'));
      if (!within(sessionDirectory, sessionFile) || !(await fs.stat(sessionFile)).isFile()) {
        throw new Error('sessionFile must be a file within sessionDirectory');
      }
      const header = JSON.parse((await fs.readFile(sessionFile, 'utf8')).split('\n')[0]!);
      if (header.type !== 'session' || typeof header.cwd !== 'string' || await fs.realpath(header.cwd) !== workspace) {
        throw new Error('sessionFile workspace does not match initialize workspace');
      }
    }
    await fs.mkdir(sessionDirectory, { recursive: true });
    return { workspace, sessionDirectory, ...(sessionFile ? { sessionFile } : {}) };
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    throw new ResponseError(TaurenErrorCodes.IncompatibleRuntime,
      `Invalid workspace/session configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ServerLifecycle { dispose(): Promise<void> }

/** Register the step-3 subset, with no extension-host imports or test switches. */
export function registerServer(connection: MessageConnection, serverVersion: string, beginShutdown: () => void): ServerLifecycle {
  let runtime: AgentSessionRuntime | undefined;
  let initializing: Promise<InitializeResult> | undefined;
  let ready = false;
  let stopped = false;
  let cleanup: Promise<void> | undefined;
  let sequence = 0;
  let unsubscribe: (() => void) | undefined;
  const capabilities = [Requests.initialize, Requests.shutdown, Requests.prompt, Requests.getState,
    Requests.getSessionStats, Requests.getMessages, Requests.getLastAssistantText].map(method => method.method);

  const diagnostic = (message: string) => { process.stderr.write(`${message}\n`); };
  const event = (value: unknown) => {
    if (stopped) return;
    void connection.sendNotification(Notifications.event, { sequence: sequence++, event: snapshot(value) })
      .catch(() => undefined); // Disconnect owns cleanup; never log to protocol stdout.
  };
  function active() {
    if (stopped || !ready || !runtime) {
      throw new ResponseError(TaurenErrorCodes.NotInitialized, stopped ? 'Server is shutting down' : 'Initialize the server first');
    }
    return runtime.session;
  }

  /** initialize: SessionManager owns the persisted conversation. The runtime
   * owns cwd-bound services and AgentSession. Preserve normal SDK discovery of
   * models, settings, extensions and tools; only workspace/session paths are fixed.
   */
  async function initialize(input: unknown): Promise<InitializeResult> {
    const config = await validateInitializeParams(input);
    if (stopped) throw new Error('Server stopped during initialization');
    // One process per connection: cwd/env changes cannot affect other clients.
    process.chdir(config.workspace);
    process.env.PI_CODING_AGENT_SESSION_DIR = config.sessionDirectory;
    const agentDir = getAgentDir();
    const manager = config.sessionFile
      ? SessionManager.open(config.sessionFile, config.sessionDirectory, config.workspace)
      : SessionManager.create(config.workspace, config.sessionDirectory);
    runtime = await createAgentSessionRuntime(async options => {
      const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
      const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir, settingsManager });
      const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent });
      return { ...created, services, diagnostics: services.diagnostics };
    }, { cwd: config.workspace, agentDir, sessionManager: manager });
    if (stopped) throw new Error('Server stopped during initialization');
    for (const entry of runtime.diagnostics) diagnostic(`${entry.type}: ${entry.message}`);
    // Bind real SDK extension lifecycle and input hooks. Full UI is step 5.
    await runtime.session.bindExtensions({ onError: error => event({ type: 'extension_error', ...error }) });
    unsubscribe = runtime.session.subscribe(event);
    if (stopped) throw new Error('Server stopped during initialization');
    ready = true;
    return { protocolVersion: PROTOCOL_VERSION, serverVersion, piVersion: VERSION,
      workspace: config.workspace, sessionDirectory: config.sessionDirectory, capabilities };
  }

  // Serialize startup, reject duplicate initialization, and allow retry after a
  // failed configuration check. Dispose a partially constructed runtime on error.
  connection.onRequest(Requests.initialize, input => {
    if (runtime || initializing || stopped) throw new ResponseError(TaurenErrorCodes.AlreadyInitialized, 'Already initialized or initializing');
    initializing = initialize(input).catch(async error => {
      ready = false;
      if (runtime) { await runtime.dispose(); runtime = undefined; }
      throw error;
    }).finally(() => { initializing = undefined; });
    return initializing;
  });

  // runtime.getState reads live SDK state, never a host-side transcript cache.
  connection.onRequest(Requests.getState, () => {
    const session = active();
    return snapshot({ model: session.model, thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming, isCompacting: session.isCompacting,
      steeringMode: session.steeringMode, followUpMode: session.followUpMode,
      sessionFile: session.sessionFile, sessionId: session.sessionId, sessionName: session.sessionName,
      messageCount: session.messages.length, pendingMessageCount: session.pendingMessageCount,
      autoCompactionEnabled: session.autoCompactionEnabled, autoRetryEnabled: session.autoRetryEnabled });
  });
  // runtime.getSessionStats delegates token/tool accounting to the SDK.
  connection.onRequest(Requests.getSessionStats, () => snapshot(active().getSessionStats()));
  // session.getMessages returns the SDK's reconstructed active branch, including
  // persisted history after reopen. Custom rendering enrichment belongs to step 5.
  connection.onRequest(Requests.getMessages, () => ({ messages: snapshot({ messages: active().messages }).messages as JsonValue[] }));
  // The SDK extracts assistant text; normalize absent text to JSON null.
  connection.onRequest(Requests.getLastAssistantText, () => ({ text: active().getLastAssistantText() ?? null }));

  // chat.prompt uses the normal SDK command/extension/model pipeline. Acknowledge
  // successful preflight, then report generation through session events. Preserve
  // source "rpc", since existing Pi extensions may branch on this literal.
  connection.onRequest(Requests.prompt, input => {
    const session = active();
    const params = object(input);
    if (typeof params.message !== 'string' || params.streamingBehavior !== undefined || params.images !== undefined) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'This server increment accepts text-only, idle prompts');
    }
    if (session.isStreaming) throw new ResponseError(ErrorCodes.InvalidParams, 'Session is busy');
    let sawStart = false;
    const off = session.subscribe(value => { if (value.type === 'agent_start') sawStart = true; });
    return new Promise<null>((resolve, reject) => {
      void session.prompt(params.message as string, { source: 'rpc', preflightResult: success => {
        if (success) resolve(null);
        else reject(new ResponseError(ErrorCodes.InvalidParams, 'Prompt preflight failed'));
      } }).then(() => {
        if (!sawStart && !session.isStreaming) event({ type: 'prompt_handled' });
        resolve(null);
      }, error => {
        diagnostic(`Prompt failed: ${error instanceof Error ? error.message : String(error)}`);
        reject(new ResponseError(ErrorCodes.InternalError, 'Prompt failed; see server diagnostics'));
      }).finally(off);
    });
  });

  /** shutdown/EOF stops delivery, waits for startup, aborts SDK work, and awaits
   * runtime disposal (including pending credential writes). The entrypoint applies
   * a deadline so an uncooperative extension cannot hang the process indefinitely.
   */
  async function dispose(): Promise<void> {
    stopped = true;
    if (!cleanup) cleanup = (async () => {
      await initializing?.catch(() => undefined);
      unsubscribe?.();
      if (runtime) {
        runtime.session.abortCompaction();
        runtime.session.abortBranchSummary();
        runtime.session.abortBash();
        await runtime.session.abort();
        await runtime.dispose();
        runtime = undefined;
      }
    })();
    return cleanup;
  }
  connection.onRequest(Requests.shutdown, async () => {
    beginShutdown();
    await dispose();
    return null; // Host closes stdin after receiving this acknowledgement.
  });
  return { dispose };
}
