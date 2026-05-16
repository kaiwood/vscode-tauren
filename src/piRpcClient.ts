import { spawn, type SpawnOptionsWithoutStdio } from 'child_process';
import {
  attachJsonlLineReader,
  parseRpcEvent,
  parseRpcResponse,
  serializeJsonLine,
  type ExtensionUiResponse,
  type RpcEvent,
  type RpcResponse
} from './piRpcProtocol';

export { parseRpcEvent, parseRpcResponse } from './piRpcProtocol';
export type { ExtensionUiResponse, RpcEvent, RpcResponse } from './piRpcProtocol';

type RpcCommand = {
  type: string;
  [key: string]: unknown;
};

export type PiModel = {
  provider?: string;
  id?: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
};

export type PiSessionState = {
  model?: PiModel | null;
  thinkingLevel?: string;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  pendingMessageCount?: number;
};

export type PiAvailableModels = {
  models?: PiModel[];
};

export type PiCommand = {
  name?: string;
  description?: string;
  source?: string;
  location?: string;
  path?: string;
};

export type PiAvailableCommands = {
  commands?: PiCommand[];
};

export type PiSessionStats = {
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  totalMessages?: number;
  cost?: number;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
};

export type PiCompactResult = {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
};

export type PiExportHtmlResult = {
  path?: string;
};

export type PiLastAssistantText = {
  text?: string | null;
};

export type PiSwitchSessionResult = {
  cancelled?: boolean;
};

export type PiForkMessage = {
  entryId?: string;
  text?: string;
};

export type PiForkMessagesResult = {
  messages?: PiForkMessage[];
};

export type PiForkResult = {
  text?: string;
  cancelled?: boolean;
};

export type PiCloneResult = {
  cancelled?: boolean;
};

export type PiNavigateTreeResult = {
  editorText?: string;
  cancelled?: boolean;
  aborted?: boolean;
};

export type PiAgentMessage = {
  role?: string;
  content?: unknown;
  errorMessage?: string;
  summary?: string;
  display?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PiMessagesResult = {
  messages?: PiAgentMessage[];
};

export type PiPromptStreamingBehavior = 'steer' | 'followUp';

type PendingRequest = {
  commandType: string;
  timeout: NodeJS.Timeout;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
};

type PiRpcProcess = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

type PiRpcSpawnFactory = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => PiRpcProcess;

export type PiRpcClientOptions = {
  cwd?: string;
  sessionFile?: string;
  piPath?: string;
  spawnFactory?: PiRpcSpawnFactory;
  commandTimeoutMs?: number;
};

const defaultSpawnFactory: PiRpcSpawnFactory = (command, args, options) => spawn(command, args, options);
const defaultCommandTimeoutMs = 30000;

export class PiRpcClient {
  private process: PiRpcProcess | undefined;
  private startPromise: Promise<void> | undefined;
  private removeStdoutReader: (() => void) | undefined;
  private requestId = 0;
  private stderr = '';
  private isDisposing = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: PiRpcClientOptions = {}) {}

  public isRunning(): boolean {
    return Boolean(this.process && this.process.exitCode === null);
  }

  public onEvent(listener: (event: RpcEvent) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);

    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public async prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior): Promise<void> {
    await this.send({
      type: 'prompt',
      message,
      ...(streamingBehavior ? { streamingBehavior } : {})
    });
  }

  public async abort(): Promise<void> {
    await this.send({ type: 'abort' });
  }

  public async reload(): Promise<void> {
    await this.send({ type: 'reload' });
  }

  public async getState(): Promise<PiSessionState> {
    const response = await this.send({ type: 'get_state' });
    return isRecord(response.data) ? response.data : {};
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const response = await this.send({ type: 'get_session_stats' });
    return isRecord(response.data) ? response.data : {};
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    const response = await this.send({ type: 'get_available_models' });
    return isRecord(response.data) ? response.data : {};
  }

  public async getCommands(): Promise<PiAvailableCommands> {
    const response = await this.send({ type: 'get_commands' });
    return isRecord(response.data) ? response.data : {};
  }

  public async setModel(provider: string, modelId: string): Promise<PiModel> {
    const response = await this.send({ type: 'set_model', provider, modelId });
    return isRecord(response.data) ? response.data : {};
  }

  public async setThinkingLevel(level: string): Promise<void> {
    await this.send({ type: 'set_thinking_level', level });
  }

  public async setSessionName(name: string): Promise<void> {
    await this.send({ type: 'set_session_name', name });
  }

  public async compact(customInstructions?: string): Promise<PiCompactResult> {
    const response = await this.send({
      type: 'compact',
      ...(customInstructions ? { customInstructions } : {})
    });
    return isRecord(response.data) ? response.data : {};
  }

  public async exportHtml(outputPath?: string): Promise<PiExportHtmlResult> {
    const response = await this.send({
      type: 'export_html',
      ...(outputPath ? { outputPath } : {})
    });
    return isRecord(response.data) ? response.data : {};
  }

  public async getLastAssistantText(): Promise<PiLastAssistantText> {
    const response = await this.send({ type: 'get_last_assistant_text' });
    return isRecord(response.data) ? response.data : {};
  }

  public async getMessages(): Promise<PiMessagesResult> {
    const response = await this.send({ type: 'get_messages' });
    return isRecord(response.data) ? response.data : {};
  }

  public async switchSession(sessionPath: string): Promise<PiSwitchSessionResult> {
    const response = await this.send({ type: 'switch_session', sessionPath });
    return isRecord(response.data) ? response.data : {};
  }

  public async navigateTree(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string } = {}
  ): Promise<PiNavigateTreeResult> {
    const response = await this.send({
      type: 'navigate_tree',
      entryId,
      summarize: options.summarize ?? false,
      ...(options.customInstructions ? { customInstructions: options.customInstructions } : {})
    });
    return isRecord(response.data) ? response.data : {};
  }

  public async getForkMessages(): Promise<PiForkMessagesResult> {
    const response = await this.send({ type: 'get_fork_messages' });
    return isRecord(response.data) ? response.data : {};
  }

  public async fork(entryId: string): Promise<PiForkResult> {
    const response = await this.send({ type: 'fork', entryId });
    return isRecord(response.data) ? response.data : {};
  }

  public async clone(): Promise<PiCloneResult> {
    const response = await this.send({ type: 'clone' });
    return isRecord(response.data) ? response.data : {};
  }

  public respondExtensionUiRequest(response: ExtensionUiResponse): Promise<void> {
    return this.writeToRunningProcess({ type: 'extension_ui_response', ...response });
  }

  public dispose(): void {
    this.isDisposing = true;
    this.removeStdoutReader?.();
    this.removeStdoutReader = undefined;
    this.rejectPending(new Error('Pi RPC client disposed.'));

    if (this.process && this.process.exitCode === null) {
      this.process.kill('SIGTERM');
    }

    this.process = undefined;
  }

  private async send(command: RpcCommand): Promise<RpcResponse> {
    const child = await this.ensureStarted();
    const id = `tau-${++this.requestId}`;
    const fullCommand = { ...command, id };

    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`Timed out waiting for Pi response to ${command.type}.${this.formatStderr()}`)
        );
      }, this.options.commandTimeoutMs ?? defaultCommandTimeoutMs);

      this.pendingRequests.set(id, { commandType: command.type, timeout, resolve, reject });

      child.stdin.write(serializeJsonLine(fullCommand), (error?: Error | null) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to write Pi RPC command: ${error.message}`));
      });
    });
  }

  private writeToRunningProcess(command: RpcCommand): Promise<void> {
    if (!this.process || this.process.exitCode !== null) {
      return Promise.reject(new Error('Pi RPC process is not running.'));
    }

    return this.writeToProcess(this.process, command);
  }

  private writeToProcess(child: PiRpcProcess, command: RpcCommand): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      child.stdin.write(serializeJsonLine(command), (error?: Error | null) => {
        if (error) {
          reject(new Error(`Failed to write Pi RPC command: ${error.message}`));
          return;
        }

        resolve();
      });
    });
  }

  private async ensureStarted(): Promise<PiRpcProcess> {
    if (this.startPromise) {
      await this.startPromise;

      if (this.process && this.process.exitCode === null) {
        return this.process;
      }
    }

    if (this.process && this.process.exitCode === null) {
      return this.process;
    }

    this.stderr = '';
    this.isDisposing = false;

    const launchCommand = parsePiLaunchCommand(this.options.piPath);
    const args = [
      ...launchCommand.args,
      '--mode',
      'rpc',
      ...(this.options.sessionFile ? ['--session', this.options.sessionFile] : [])
    ];
    const child = (this.options.spawnFactory ?? defaultSpawnFactory)(launchCommand.command, args, {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process = child;
    this.removeStdoutReader = attachJsonlLineReader(child.stdout, (line) => {
      this.handleLine(line);
    });

    child.stderr.on('data', (chunk: string | Buffer) => {
      this.stderr += chunk.toString();

      if (this.stderr.length > 5000) {
        this.stderr = this.stderr.slice(-5000);
      }
    });

    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleSuccess = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      const settleFailure = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      const startupTimer = setTimeout(settleSuccess, 100);

      child.once('error', (error) => {
        clearTimeout(startupTimer);
        const stderr = this.formatStderr();
        const message = `Failed to start Pi RPC process: ${error.message}${stderr ? `.${stderr}` : ''}`;
        this.handleProcessFailure(message);
        settleFailure(new Error(message));
      });

      child.once('exit', (code, signal) => {
        clearTimeout(startupTimer);
        const message = `Pi RPC process exited with ${formatExit(code, signal)}.${this.formatStderr()}`;
        this.handleProcessFailure(message);
        settleFailure(new Error(message));
      });
    });

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }

    if (!this.process || this.process.exitCode !== null) {
      throw new Error(`Pi RPC process is not running.${this.formatStderr()}`);
    }

    return this.process;
  }

  private handleLine(line: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.emitError(`Failed to parse Pi RPC output: ${getErrorMessage(error)}`);
      return;
    }

    const event = parseRpcEvent(parsed);

    if (!event) {
      this.emitError('Received malformed Pi RPC output.');
      return;
    }

    const response = parseRpcResponse(event);

    if (response) {
      const id = response.id;

      if (id && this.pendingRequests.has(id)) {
        const pending = this.pendingRequests.get(id);

        if (!pending) {
          return;
        }

        this.pendingRequests.delete(id);
        clearTimeout(pending.timeout);

        if (response.success === false) {
          pending.reject(new Error(response.error ?? `Pi command ${response.command ?? 'unknown'} failed.`));
          return;
        }

        pending.resolve(response);
        return;
      }

      if (response.success === false && response.command) {
        const pending = this.getSinglePendingRequestForCommand(response.command);

        if (pending) {
          this.pendingRequests.delete(pending.id);
          clearTimeout(pending.request.timeout);
          pending.request.reject(new Error(response.error ?? `Pi command ${response.command} failed.`));
          return;
        }
      }

      this.emitEvent(response);
      return;
    }

    this.emitEvent(event);
  }

  private getSinglePendingRequestForCommand(commandType: string): { id: string; request: PendingRequest } | undefined {
    let match: { id: string; request: PendingRequest } | undefined;

    for (const [id, request] of this.pendingRequests) {
      if (request.commandType !== commandType) {
        continue;
      }

      if (match) {
        return undefined;
      }

      match = { id, request };
    }

    return match;
  }

  private handleProcessFailure(message: string): void {
    this.removeStdoutReader?.();
    this.removeStdoutReader = undefined;
    this.process = undefined;
    this.rejectPending(new Error(message));

    if (!this.isDisposing) {
      this.emitError(message);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private emitEvent(event: RpcEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }

  private formatStderr(): string {
    const stderr = this.stderr.trim();

    if (!stderr) {
      return '';
    }

    return ` Stderr: ${stderr}`;
  }
}

function parsePiLaunchCommand(piPath: string | undefined): { command: string; args: string[] } {
  const parts = splitCommandLine(piPath?.trim() ?? '');

  if (parts.length === 0) {
    return { command: 'pi', args: [] };
  }

  const [command, ...args] = parts;
  return { command, args };
}

function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (const char of value) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `code ${code}`;
  }

  if (signal) {
    return `signal ${signal}`;
  }

  return 'unknown status';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
