import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  getAgentDir, SessionManager, SettingsManager, VERSION, type AgentSessionRuntime
} from '@earendil-works/pi-coding-agent';
import { ErrorCodes, ResponseError, type MessageConnection } from 'vscode-jsonrpc';
import { registerRuntimeControls } from './runtimeControls.js';
import { PiAutocompleteRegistry } from '@tauren/shared/completion/piAutocompleteRegistry';
import { registerSessionControls, validateSessionPath } from './sessionControls.js';
import { RemoteExtensionUi } from './extensionUi/remoteExtensionUi.js';
import { PiSdkRenderer } from '@tauren/shared/rendering/piSdkRendering';
import {
  assertProtocolVersion, Notifications, PROTOCOL_VERSION, Requests, TaurenErrorCodes,
  type InitializeResult, type Snapshot, type JsonValue, type PromptParams
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

/** Stop SDK work, including process groups owned by the built-in bash tool. */
async function abortSession(session: AgentSessionRuntime['session']): Promise<void> {
  session.abortCompaction();
  session.abortBranchSummary();
  session.abortBash();
  await session.abort();
}

/** Validate wire attachments before Pi's normal image normalization pipeline. */
function validatePrompt(input: unknown): PromptParams {
  const params = object(input);
  if (typeof params.message !== 'string'
    || (params.streamingBehavior !== undefined && params.streamingBehavior !== 'steer' && params.streamingBehavior !== 'followUp')) {
    throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid prompt text or streaming behavior');
  }
  if (params.images !== undefined && (!Array.isArray(params.images) || params.images.some(image => {
    if (!image || typeof image !== 'object') return true;
    return image.type !== 'image' || typeof image.data !== 'string' || typeof image.mimeType !== 'string';
  }))) throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid prompt images');
  return { message: params.message,
    ...(params.streamingBehavior ? { streamingBehavior: params.streamingBehavior } : {}),
    ...(params.images ? { images: params.images as PromptParams['images'] } : {}) };
}

export interface ServerLifecycle { dispose(): Promise<void> }

/** Register the SDK server, with no extension-host imports or test switches. */
export function registerServer(connection: MessageConnection, serverVersion: string, beginShutdown: () => void): ServerLifecycle {
  let runtime: AgentSessionRuntime | undefined;
  let initializing: Promise<InitializeResult> | undefined;
  let ready = false;
  let stopped = false;
  let cleanup: Promise<void> | undefined;
  let sequence = 0;
  let unsubscribe: (() => void) | undefined;
  const pendingPrompts = new Set<Promise<void>>();
  const cancelPreflights = new Set<() => void>();
  const completions = new PiAutocompleteRegistry({
    onCapabilitiesChange: capabilities => {
      if (!stopped) void connection.sendNotification(Notifications.completionCapabilities, capabilities).catch(() => undefined);
    },
    onDiagnostic: message => diagnostic(message)
  });
  const completionControllers = new Set<AbortController>();
  let reloadWork: Promise<void> | undefined;
  let reloading = false;
  let sessionDirectory = '';
  let mutation: Promise<unknown> | undefined;
  const capabilities = [Requests.initialize, Requests.shutdown, Requests.prompt,
    Requests.getMessages, Requests.getLastAssistantText].map(method => method.method);

  const diagnostic = (message: string) => {
    process.stderr.write(`${message}\n`);
    if (!stopped) void connection.sendNotification(Notifications.diagnostic,
      { level: 'warning', message }).catch(() => undefined);
  };
  const ui = new RemoteExtensionUi(connection, {
    autocompleteRegistry: completions, getCwd: () => runtime?.cwd ?? process.cwd(), diagnostic
  });
  const renderer = new PiSdkRenderer(() => ui.getToolsExpanded());
  const event = (value: unknown) => {
    if (stopped) return;
    void connection.sendNotification(Notifications.event, { sequence: sequence++, event: snapshot(value) })
      .catch(() => undefined); // Disconnect owns cleanup; never log to protocol stdout.
  };
  function active() {
    if (stopped || !ready || !runtime || reloading) {
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
    sessionDirectory = config.sessionDirectory;
    process.chdir(config.workspace);
    process.env.PI_CODING_AGENT_SESSION_DIR = config.sessionDirectory;
    const agentDir = getAgentDir();
    const manager = config.sessionFile
      ? SessionManager.open(config.sessionFile, config.sessionDirectory, config.workspace)
      : SessionManager.create(config.workspace, config.sessionDirectory);
    runtime = await createAgentSessionRuntime(async options => {
      process.chdir(config.workspace);
      const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
      const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir, settingsManager });
      const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent });
      return { ...created, services, diagnostics: services.diagnostics };
    }, { cwd: config.workspace, agentDir, sessionManager: manager });
    if (stopped) throw new Error('Server stopped during initialization');
    for (const entry of runtime.diagnostics) diagnostic(`${entry.type}: ${entry.message}`);
    // Replacements create a new SDK session and extension runner. Detach UI
    // synchronously before old contexts become stale, then bind the new owner.
    runtime.setBeforeSessionInvalidate(() => { ui.reset(); completions.reset(); renderer.reset(); unsubscribe?.(); });
    runtime.setRebindSession(async () => { await bindRuntime(); });
    await bindRuntime();
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
      if (runtime) {
        try { await runtime.dispose(); } catch { diagnostic('Failed to dispose incomplete Pi runtime'); }
        runtime = undefined;
      }
      if (error instanceof ResponseError) throw error;
      // Provider/extension startup errors may contain credential details.
      throw new ResponseError(ErrorCodes.InternalError, 'Pi runtime initialization failed');
    }).finally(() => { initializing = undefined; });
    return initializing;
  });

  /** Bind callbacks beside the SDK; only their effects and rendered DTOs cross
   * JSON-RPC. Command context actions use runtime replacement, not transcript copies.
   */
  async function bindRuntime(): Promise<void> {
    const current = runtime!;
    const session = current.session;
    completions.reset();
    unsubscribe?.();
    unsubscribe = session.subscribe(value => event(renderer.enrichEvent(current, value)));
    await session.bindExtensions({
      uiContext: ui.context,
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: options => current.newSession(options),
        fork: async (entryId, options) => ({ cancelled: (await current.fork(entryId, options)).cancelled }),
        navigateTree: (entryId, options) => session.navigateTree(entryId, options),
        switchSession: async (sessionPath, options) => {
          const file = await validateSessionPath(sessionPath, { workspace: current.cwd, sessionDirectory });
          return current.switchSession(file, { ...options, cwdOverride: current.cwd });
        },
        reload: () => reloadSession(session)
      },
      onError: error => event({ type: 'extension_error', ...error })
    });
  }

  /** Reserve an idle runtime for a single session mutation. Queries resolve the
   * active session afresh; prompts/reload cannot race a replacement in progress.
   */
  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const session = active();
    if (mutation || !session.isIdle || pendingPrompts.size) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Wait for Pi to become idle before changing sessions');
    }
    const work = Promise.resolve().then(operation);
    mutation = work;
    try { return await work; } finally { if (mutation === work) mutation = undefined; }
  }

  // Session controls retain the configured session store across SDK replacements.
  capabilities.push(...registerSessionControls(connection, {
    getRuntime: () => { active(); return runtime!; }, mutate,
    getSessionDirectory: () => sessionDirectory,
    cancelInteractions: () => ui.cancelInteractions()
  }));
  capabilities.push(...ui.capabilityMethods);
  capabilities.push(...registerRuntimeControls(connection, active, diagnostic));
  // Restore from SDK history and rerun custom renderers, never from a cached
  // host transcript. Rendered text is presentation only, not persisted session data.
  connection.onRequest(Requests.getMessages, () => {
    const messages = active().messages.map(message => {
      const rendered = renderer.renderCustomMessage(runtime!, message as unknown as Record<string, unknown>);
      return rendered ? { ...message, taurenRenderedMessage: rendered } : message;
    });
    return { messages: snapshot({ messages }).messages as JsonValue[] };
  });
  // The SDK extracts assistant text; normalize absent text to JSON null.
  connection.onRequest(Requests.getLastAssistantText, () => ({ text: active().getLastAssistantText() ?? null }));

  /** chat.prompt runs Pi's input hooks, templates, images and model loop.
   * Pi owns steering/follow-up queues. An acknowledgement is acceptance, not
   * completion; generation errors after acknowledgement travel as diagnostics.
   * Request cancellation applies only until acceptance; chat.abort stops a run.
   */
  connection.onRequest(Requests.prompt, (input, token) => {
    const session = active();
    if (mutation) throw new ResponseError(ErrorCodes.InvalidParams, 'Session operation in progress');
    const params = validatePrompt(input);
    if (session.isStreaming && !params.streamingBehavior) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Specify steering or follow-up while streaming');
    }
    return new Promise<null>((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      const finish = (error?: ResponseError<void>) => {
        if (settled) return;
        settled = true;
        subscription?.dispose();
        cancelPreflights.delete(cancel);
        if (error) reject(error); else resolve(null);
      };
      const cancel = () => {
        cancelled = true;
        finish(new ResponseError(TaurenErrorCodes.Cancelled, 'Prompt request cancelled'));
        ui.cancelInteractions();
        void abortSession(session).catch(() => diagnostic('Prompt cancellation failed'));
      };
      const subscription = token.onCancellationRequested(cancel);
      cancelPreflights.add(cancel);
      if (token.isCancellationRequested) { cancel(); return; }
      const work = session.prompt(params.message, { ...params, source: 'rpc', preflightResult: disposition => {
        // Pi input hooks have no cancellation signal. If cancelled while an
        // async hook ran, abort again once Pi has actually started its run.
        if (cancelled || stopped) {
          if (disposition === 'started') queueMicrotask(() => {
            void abortSession(session).catch(() => diagnostic('Late prompt cancellation failed'));
          });
          return;
        }
        if (disposition === 'handled') event({ type: 'prompt_handled' });
        finish();
      } }).then(() => finish(), () => {
        if (cancelled || stopped) return;
        if (settled) {
          void connection.sendNotification(Notifications.diagnostic,
            { level: 'error', message: 'Pi prompt failed after acceptance' }).catch(() => undefined);
        } else finish(new ResponseError(ErrorCodes.InternalError, 'Pi prompt failed'));
      }).finally(() => { pendingPrompts.delete(work); });
      pendingPrompts.add(work);
    });
  });

  // Abort all SDK operation categories, including bash process groups. Cancelling
  // pending preflights also prevents delayed extension hooks escaping this abort.
  connection.onRequest(Requests.abort, async input => {
    if (input !== null && input !== undefined) throw new ResponseError(ErrorCodes.InvalidParams, 'abort takes no parameters');
    const session = active();
    ui.cancelInteractions();
    for (const cancel of cancelPreflights) cancel();
    await abortSession(session);
    await Promise.all([...pendingPrompts]);
    return null;
  });

  // Reload through Pi, not a second resource scanner. Pi rebinds extensions and
  // emits session_start/reload; invalidate connection-local completion handles.
  connection.onRequest(Requests.reload, async input => {
    if (input !== null && input !== undefined) throw new ResponseError(ErrorCodes.InvalidParams, 'reload takes no parameters');
    const session = active();
    if (mutation || !session.isIdle || pendingPrompts.size) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Wait for Pi to become idle before reloading');
    }
    await reloadSession(session);
    return null;
  });

  /** Pi reload reuses the bound UI context. Dispose old components and provider
   * factories before loading extensions; session_start registers fresh providers.
   */
  async function reloadSession(session: AgentSessionRuntime['session']): Promise<void> {
    if (reloading || mutation || stopped) throw new ResponseError(ErrorCodes.InvalidParams, 'Runtime operation in progress');
    // Both wire reload and ctx.reload() reserve the runtime; the invoking slash
    // command may be pending, but no other prompt may enter during teardown.
    reloading = true;
    const resetOwners = () => { ui.reset(); renderer.reset(); completions.reset(); };
    resetOwners();
    const work = session.reload({ beforeSessionStart: async () => {
      // Old session_shutdown hooks may create UI. Remove it only after they
      // finish, before the new runner installs its session_start state.
      resetOwners();
    } });
    reloadWork = work;
    try { await work; }
    catch { throw new ResponseError(ErrorCodes.InternalError, 'Pi resource reload failed'); }
    finally { if (reloadWork === work) reloadWork = undefined; reloading = false; }
  }

  // The registry owns provider results and executable applyCompletion callbacks;
  // only opaque, revision-bound item handles cross the connection.
  connection.onRequest(Requests.getCompletionCapabilities, () => { active(); return completions.getCapabilities(); });
  connection.onRequest(Requests.getCompletions, async (input, token) => {
    active();
    const params = object(input);
    if (typeof params.id !== 'string' || !Number.isInteger(params.revision) || typeof params.text !== 'string'
      || !Number.isInteger(params.selectionStart) || !Number.isInteger(params.selectionEnd)) {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid completion request');
    }
    const controller = new AbortController();
    completionControllers.add(controller);
    const subscription = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    try {
      const result = await completions.complete(input, runtime!.cwd, controller.signal);
      if (controller.signal.aborted) throw new ResponseError(TaurenErrorCodes.Cancelled, 'Completion cancelled');
      return result;
    } finally { subscription.dispose(); completionControllers.delete(controller); }
  });
  connection.onRequest(Requests.applyCompletion, input => {
    active();
    const params = object(input);
    if (typeof params.id !== 'string' || !Number.isInteger(params.revision) || typeof params.itemId !== 'string') {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid completion application');
    }
    return completions.apply(input) ?? null;
  });
  capabilities.push(Requests.abort.method, Requests.reload.method, Requests.getCompletions.method,
    Requests.getCompletionCapabilities.method, Requests.applyCompletion.method);

  /** shutdown/EOF stops delivery, waits for startup, aborts SDK work, and awaits
   * runtime disposal (including pending credential writes). The entrypoint applies
   * a deadline so an uncooperative extension cannot hang the process indefinitely.
   */
  async function dispose(): Promise<void> {
    stopped = true;
    if (!cleanup) cleanup = (async () => {
      // Cancel reverse UI before waiting: initialization or a session mutation
      // may itself be blocked in an extension's dialog/custom surface.
      ui.dispose();
      await initializing?.catch(() => undefined);
      unsubscribe?.();
      renderer.reset();
      completions.reset();
      for (const controller of completionControllers) controller.abort();
      await reloadWork?.catch(() => undefined);
      for (const cancel of cancelPreflights) cancel();
      if (runtime) {
        await abortSession(runtime.session);
        await mutation?.catch(() => undefined);
        await Promise.all([...pendingPrompts]);
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
