import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import { ErrorCodes, ResponseError, type CancellationToken, type MessageConnection } from 'vscode-jsonrpc';
import { Requests, TaurenErrorCodes, type Snapshot } from './protocol/index.js';
import { flattenPiSessionTree, type FlattenableSessionTreeNode } from '@tauren/shared/sessions/piSessionTree';
import { readSessionSummary } from '@tauren/shared/sessions/sessionSummaryParser';
import { decorateSessionTree } from '@tauren/shared/sessions/sessionTree';
import { traceOrigin, type TraceOriginInput } from '@tauren/shared/sessions/sessionOriginTracer';
import { isRecord } from '@tauren/shared/sessions/records';
import type { RawSessionInfo } from '@tauren/shared/sessions/types';

export interface SessionPathConfiguration { workspace: string; sessionDirectory: string }

/** Shared guard for wire and extension commandContextActions.switchSession.
 * Require a direct child: SDK switch derives sessionDir from dirname(file).
 * Runtime factories must independently reject cwd/store drift on every replacement.
 */
export async function validateSessionPath(file: string, config: SessionPathConfiguration): Promise<string> {
  required(file, 'sessionPath');
  if (!path.isAbsolute(config.sessionDirectory) || !path.isAbsolute(config.workspace)) invalid('Workspace and session store must be absolute');
  const directory = await fs.realpath(config.sessionDirectory);
  const resolved = await fs.realpath(expand(file, config.workspace));
  if (path.dirname(resolved) !== directory || !(await fs.stat(resolved)).isFile()) invalid('Session must be a file in the configured store');
  const value = await header(resolved);
  if (!path.isAbsolute(value.cwd as string) || await fs.realpath(value.cwd as string) !== await fs.realpath(config.workspace)) {
    invalid('Session workspace does not match the initialized workspace');
  }
  return resolved;
}

/** Extension import actions must use this helper, not raw SDK importFromJsonl:
 * SDK copies bytes verbatim and cwdOverride does not rewrite the stored header.
 * The callback must import the staged file before returning; it is then removed.
 */
export async function withValidatedSessionImport<T>(
  inputPath: string, cwdOverride: string | undefined, config: SessionPathConfiguration,
  operation: (stagedPath: string, cwd: string) => Promise<T>
): Promise<T> {
  required(inputPath, 'inputPath');
  if (!path.isAbsolute(config.workspace) || !path.isAbsolute(config.sessionDirectory)) invalid('Workspace and session store must be absolute');
  const workspace = await fs.realpath(config.workspace);
  await fs.realpath(config.sessionDirectory);
  if (cwdOverride !== undefined && await fs.realpath(expand(required(cwdOverride, 'cwdOverride'), workspace)) !== workspace) {
    invalid('Import cannot change the initialized workspace');
  }
  const source = await fs.realpath(expand(inputPath, workspace));
  if (!(await fs.stat(source)).isFile() || path.extname(source) !== '.jsonl') invalid('Import requires a JSONL file');
  const value = await header(source);
  const staging = await fs.mkdtemp(path.join(tmpdir(), 'tauren-import-'));
  try {
    const text = await fs.readFile(source, 'utf8');
    const newline = text.indexOf('\n');
    value.cwd = workspace;
    const staged = path.join(staging, path.basename(source));
    await fs.writeFile(staged, JSON.stringify(value) + '\n' + (newline < 0 ? '' : text.slice(newline + 1)), { mode: 0o600 });
    return await operation(staged, workspace);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

export interface SessionControlHooks {
  getRuntime(): AgentSessionRuntime;
  /** Parent serializes idle mutations with prompts, reload and shutdown. */
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  getSessionDirectory(): string;
  cancelInteractions(): void;
}

function invalid(message: string): never { throw new ResponseError(ErrorCodes.InvalidParams, message); }
function object(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) invalid('Expected an object');
  return input;
}
function string(value: unknown, name: string, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || value.includes('\0')) invalid(`Invalid ${name}`);
  return value;
}
function required(value: unknown, name: string): string {
  const result = string(value, name)!;
  if (!result.trim()) invalid(`${name} must not be empty`);
  return result;
}
function none(input: unknown): void {
  if (input !== null && input !== undefined) invalid('This method takes no parameters');
}
function json<T>(value: unknown): T { return JSON.parse(JSON.stringify(value)) as T; }
function cancelled(token: CancellationToken): void {
  if (token.isCancellationRequested) throw new ResponseError(TaurenErrorCodes.Cancelled, 'Session request cancelled');
}
function expand(value: string, cwd: string): string {
  if (value === '~') return homedir();
  return path.resolve(cwd, value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
}

/** Read the actual header, not inferred metadata, before allowing store access. */
async function header(file: string): Promise<Record<string, unknown>> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    if (!text.includes('\n') && bytesRead === buffer.length) invalid('Session header is too large');
    const value: unknown = JSON.parse(text.split('\n')[0]!);
    if (!isRecord(value) || value.type !== 'session' || typeof value.id !== 'string' || typeof value.cwd !== 'string') {
      invalid('Invalid session header');
    }
    return value;
  } finally { await handle.close(); }
}

/** Register Pi-compatible session DTOs, without VS Code or process-global store discovery.
 * Replacement methods use AgentSessionRuntime; the parent owns setRebindSession.
 * Cancellation is cooperative: SDK replacement/extension hooks have no AbortSignal,
 * so cancellation cannot roll back a replacement or already persisted changes.
 */
export function registerSessionControls(connection: MessageConnection, hooks: SessionControlHooks): string[] {
  const methods: string[] = [];
  type Operation = (input: unknown, runtime: AgentSessionRuntime, token: CancellationToken) => Promise<unknown>;
  function register(method: string, mutation: boolean, operation: Operation): void {
    methods.push(method);
    connection.onRequest(method, async (input: unknown, token: CancellationToken) => {
      try {
        const run = async () => {
          cancelled(token);
          const result = await operation(input, hooks.getRuntime(), token);
          // Replacements cannot be rolled back once committed. Report their
          // actual result; cancellation is cooperative only for cancellable work.
          if (!mutation || method === Requests.compact.method || method === Requests.navigateTree.method) cancelled(token);
          return result;
        };
        return mutation ? await hooks.mutate(run) : await run();
      } catch (error) {
        if (token.isCancellationRequested && (!mutation || method === Requests.compact.method || method === Requests.navigateTree.method)) cancelled(token);
        if (error instanceof ResponseError) throw error;
        // SDK/provider errors can include credentials, tool content or arbitrary extension text.
        throw new ResponseError(ErrorCodes.InternalError, `Pi ${method} failed`);
      }
    });
  }
  async function store(runtime: AgentSessionRuntime): Promise<string> {
    const configured = hooks.getSessionDirectory();
    if (!path.isAbsolute(configured)) throw new ResponseError(TaurenErrorCodes.IncompatibleRuntime, 'Session store must be configured');
    const directory = await fs.realpath(configured);
    if (await fs.realpath(runtime.session.sessionManager.getSessionDir()) !== directory) {
      throw new ResponseError(TaurenErrorCodes.IncompatibleRuntime, 'Runtime session store changed');
    }
    return directory;
  }
  async function associated(file: string, runtime: AgentSessionRuntime): Promise<string> {
    return validateSessionPath(file, { workspace: runtime.cwd, sessionDirectory: await store(runtime) });
  }
  async function abortable<T>(runtime: AgentSessionRuntime, token: CancellationToken, abort: () => void, work: () => Promise<T>): Promise<T> {
    cancelled(token);
    const stop = () => {
      hooks.cancelInteractions();
      abort();
      void runtime.session.abort().catch(() => undefined);
    };
    const subscription = token.onCancellationRequested(stop);
    // compact() first awaits abort() before installing its controller. Catch
    // cancellation during that await when the SDK announces compaction_start.
    const unsubscribe = runtime.session.subscribe(event => {
      if (token.isCancellationRequested && event.type === 'compaction_start') stop();
    });
    try { cancelled(token); return await work(); }
    finally { subscription.dispose(); unsubscribe(); }
  }
  function entry(runtime: AgentSessionRuntime, value: unknown): string {
    const id = required(value, 'entryId');
    if (!runtime.session.sessionManager.getEntry(id)) invalid('Unknown entryId');
    return id;
  }

  // session.setSessionName; retain PiSdkClient's whitespace normalization.
  register(Requests.setSessionName.method, true, async (input, runtime) => {
    runtime.session.setSessionName(string(object(input).name, 'name')!.trim()); return null;
  });
  // session.compact returns CompactionResult directly, not an invented wrapper.
  register(Requests.compact.method, true, async (input, runtime, token) => {
    const instructions = string(object(input).customInstructions, 'customInstructions', true);
    return json<Snapshot>(await abortable(runtime, token, () => runtime.session.abortCompaction(), () => runtime.session.compact(instructions)));
  });
  // session.exportToHtml, with the same cwd-relative default as PiSdkClient.
  register(Requests.exportHtml.method, true, async (input, runtime) => {
    const output = string(object(input).outputPath, 'outputPath', true)?.trim();
    const outputPath = output ? expand(output, runtime.cwd) : runtime.session.sessionFile
      ? path.join(runtime.cwd, `pi-session-${path.basename(runtime.session.sessionFile, '.jsonl')}.html`) : undefined;
    const exported = await runtime.session.exportToHtml(outputPath);
    return { path: exported, html: await fs.readFile(exported, 'utf8') };
  });
  register(Requests.switchSession.method, true, async (input, runtime, token) => {
    const file = await associated(required(object(input).sessionPath, 'sessionPath'), runtime);
    cancelled(token);
    return abortable(runtime, token, () => undefined, () => runtime.switchSession(file, { cwdOverride: runtime.cwd }));
  });
  register(Requests.importJsonl.method, true, async (input, runtime, token) => {
    const params = object(input);
    const inputPath = required(params.inputPath, 'inputPath');
    const override = string(params.cwdOverride, 'cwdOverride', true);
    const directory = await store(runtime);
    return withValidatedSessionImport(inputPath, override, { workspace: runtime.cwd, sessionDirectory: directory },
      (staged, cwd) => abortable(runtime, token, () => undefined, () => runtime.importFromJsonl(staged, cwd)));
  });
  // Pure Tauren Session Tree Lane projection, including tool/hidden-entry rules.
  register(Requests.getTree.method, false, async (input, runtime) => {
    none(input);
    return json<Snapshot[]>(flattenPiSessionTree(runtime.session.sessionManager.getTree() as unknown as FlattenableSessionTreeNode[], runtime.session.sessionManager.getLeafId()));
  });
  register(Requests.setTreeEntryLabel.method, true, async (input, runtime) => {
    const params = object(input);
    const id = entry(runtime, params.entryId);
    if (params.label === undefined) invalid('label must be a string or null');
    const label = params.label === null ? undefined : string(params.label, 'label');
    runtime.session.sessionManager.appendLabelChange(id, label); return null;
  });
  register(Requests.navigateTree.method, true, async (input, runtime, token) => {
    const params = object(input);
    const id = entry(runtime, params.entryId);
    if (params.summarize !== undefined && typeof params.summarize !== 'boolean') invalid('Invalid summarize');
    const customInstructions = string(params.customInstructions, 'customInstructions', true);
    return json<Snapshot>(await abortable(runtime, token, () => runtime.session.abortBranchSummary(), () => runtime.session.navigateTree(id, {
      summarize: params.summarize === true, ...(customInstructions ? { customInstructions } : {})
    })));
  });
  register(Requests.getForkMessages.method, false, async (input, runtime) => {
    none(input); return json<Snapshot>({ messages: runtime.session.getUserMessagesForForking() });
  });
  register(Requests.fork.method, true, async (input, runtime, token) => {
    const id = entry(runtime, object(input).entryId);
    const selected = runtime.session.sessionManager.getEntry(id)!;
    if (selected.type !== 'message' || selected.message.role !== 'user') invalid('Fork requires a user message');
    await store(runtime);
    const result = await abortable(runtime, token, () => undefined, () => runtime.fork(id));
    return json<Snapshot>({ text: result.selectedText, cancelled: result.cancelled });
  });
  register(Requests.clone.method, true, async (input, runtime, token) => {
    none(input); await store(runtime);
    const leaf = runtime.session.sessionManager.getLeafId();
    if (!leaf) invalid('Cannot clone a session without a current entry');
    return json<Snapshot>(await abortable(runtime, token, () => undefined, () => runtime.fork(leaf, { position: 'at' })));
  });
  register(Requests.listSessions.method, false, async (input, runtime, token) => {
    const params = object(input);
    const workspace = string(params.workspace, 'workspace', true);
    if (workspace !== undefined && await fs.realpath(expand(workspace, runtime.cwd)) !== await fs.realpath(runtime.cwd)) invalid('Workspace does not match initialize');
    const directory = await store(runtime);
    const sessions: RawSessionInfo[] = [];
    // No ~/.pi fallback, metadata cache, symlink traversal or cross-workspace rows.
    for (const name of await fs.readdir(directory)) {
      cancelled(token);
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(directory, name);
      try {
        const resolved = await associated(file, runtime);
        const summary = await readSessionSummary(resolved, await fs.stat(resolved));
        if (summary) sessions.push({ ...summary, metadataState: 'ready' });
      } catch { /* Unrelated, malformed or concurrently removed sessions are omitted. */ }
    }
    return json<Snapshot[]>(decorateSessionTree(sessions, runtime.session.sessionFile));
  });
  register(Requests.traceOrigin.method, false, async (input, runtime, token) => {
    const params = object(input);
    const files: string[] = [];
    if (params.sessionFile !== undefined) files.push(await associated(required(params.sessionFile, 'sessionFile'), runtime));
    else {
      for (const name of await fs.readdir(await store(runtime))) {
        cancelled(token);
        if (!name.endsWith('.jsonl')) continue;
        try { files.push(await associated(path.join(hooks.getSessionDirectory(), name), runtime)); }
        catch { /* Never include unrelated or malformed store entries. */ }
      }
    }
    let inputs: TraceOriginInput[];
    if (params.inputs !== undefined) {
      if (!Array.isArray(params.inputs) || params.path !== undefined || params.content !== undefined) invalid('Invalid origin inputs');
      inputs = params.inputs.map(input => {
        const value = object(input);
        if (value.kind !== 'file' && value.kind !== 'selection') invalid('Invalid origin input kind');
        const target = required(value.path, 'path');
        const content = value.kind === 'selection' ? required(value.text, 'text') : undefined;
        const absolutePath = value.absolutePath === undefined ? expand(target, runtime.cwd)
          : expand(required(value.absolutePath, 'absolutePath'), runtime.cwd);
        return { kind: value.kind, path: target, absolutePath, ...(content !== undefined ? { text: content } : {}) };
      });
    } else {
      const target = required(params.path, 'path');
      const content = string(params.content, 'content', true);
      if (content !== undefined && !content.trim()) invalid('content must not be empty');
      inputs = [{ kind: content === undefined ? 'file' : 'selection', path: target,
        absolutePath: expand(target, runtime.cwd), ...(content !== undefined ? { text: content } : {}) }];
    }
    cancelled(token);
    // Preserve path-scoped-before-content-only precedence over the complete store.
    return json<Snapshot | null>(await traceOrigin(inputs, { sessionFiles: files, checkCancellation: () => cancelled(token) }) ?? null);
  });
  return methods;
}
