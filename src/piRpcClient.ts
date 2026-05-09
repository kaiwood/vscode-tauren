import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { attachJsonlLineReader, serializeJsonLine } from './piRpcProtocol';

export type RpcEvent = {
  type: string;
  [key: string]: unknown;
};

type RpcCommand = {
  type: string;
  [key: string]: unknown;
};

type RpcResponse = RpcEvent & {
  type: 'response';
  command?: string;
  id?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
};

export type PiSessionState = {
  model?: {
    provider?: string;
    id?: string;
    reasoning?: boolean;
    contextWindow?: number;
  } | null;
  thinkingLevel?: string;
};

export type PiSessionStats = {
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
};

type PendingRequest = {
  timeout: NodeJS.Timeout;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
};

export type PiRpcClientOptions = {
  cwd?: string;
};

export class PiRpcClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private startPromise: Promise<void> | undefined;
  private removeStdoutReader: (() => void) | undefined;
  private requestId = 0;
  private stderr = '';
  private isDisposing = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: PiRpcClientOptions = {}) {}

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

  public async prompt(message: string): Promise<void> {
    await this.send({ type: 'prompt', message });
  }

  public async getState(): Promise<PiSessionState> {
    const response = await this.send({ type: 'get_state' });
    return isRecord(response.data) ? response.data : {};
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const response = await this.send({ type: 'get_session_stats' });
    return isRecord(response.data) ? response.data : {};
  }

  public async cancelExtensionUiRequest(id: string): Promise<void> {
    await this.write({ type: 'extension_ui_response', id, cancelled: true });
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
    const id = `piui-${++this.requestId}`;
    const fullCommand = { ...command, id };

    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`Timed out waiting for Pi response to ${command.type}.${this.formatStderr()}`)
        );
      }, 30000);

      this.pendingRequests.set(id, { timeout, resolve, reject });

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

  private async write(command: RpcCommand): Promise<void> {
    const child = await this.ensureStarted();

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

  private async ensureStarted(): Promise<ChildProcessWithoutNullStreams> {
    if (this.process && this.process.exitCode === null) {
      return this.process;
    }

    if (this.startPromise) {
      await this.startPromise;

      if (this.process && this.process.exitCode === null) {
        return this.process;
      }
    }

    this.stderr = '';
    this.isDisposing = false;

    const child = spawn('pi', ['--mode', 'rpc'], {
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
        const message = `Failed to start Pi RPC process: ${error.message}`;
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

    if (!isRpcEvent(parsed)) {
      this.emitError('Received malformed Pi RPC output.');
      return;
    }

    if (parsed.type === 'response') {
      const response = parsed as RpcResponse;
      const id = typeof response.id === 'string' ? response.id : undefined;

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
    }

    this.emitEvent(parsed);
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

function isRpcEvent(value: unknown): value is RpcEvent {
  return isRecord(value) && typeof value.type === 'string';
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
