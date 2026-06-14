import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { resolveKwardLaunch } from './launch';

export type KwardJsonRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

export type KwardJsonRpcResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type KwardJsonRpcNotification = {
  jsonrpc?: string;
  method: string;
  params?: unknown;
};

export type KwardRpcTransportOptions = {
  kwardPath?: string;
  onNotification?: (notification: KwardJsonRpcNotification) => void;
  onError?: (message: string) => void;
  onExit?: (message: string) => void;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

const jsonRpcVersion = '2.0';

export class KwardRpcTransport {
  private process: ChildProcessWithoutNullStreams | undefined;
  private nextId = 0;
  private buffer = Buffer.alloc(0);
  private disposed = false;
  private readonly pending = new Map<number, PendingRequest>();

  public constructor(private readonly options: KwardRpcTransportOptions) {}

  public get running(): boolean {
    return !this.disposed && Boolean(this.process && !this.process.killed);
  }

  public start(): void {
    if (this.process) {
      return;
    }

    if (this.disposed) {
      throw new Error('Kward RPC transport disposed.');
    }

    const launch = resolveKwardLaunch(this.options.kwardPath);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.process = child;

    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.options.onError?.(text);
      }
    });
    child.on('error', (error) => {
      if (this.process === child) {
        this.process = undefined;
      }
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.options.onExit?.(`Kward RPC failed to start: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.process === child) {
        this.process = undefined;
      }
      const message = signal
        ? `Kward RPC exited with signal ${signal}.`
        : `Kward RPC exited with code ${code ?? 'unknown'}.`;
      this.rejectAll(new Error(message));
      if (!this.disposed) {
        this.options.onExit?.(message);
      }
    });
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.start();
    const child = this.process;

    if (!child) {
      return Promise.reject(new Error('Kward RPC process is not available.'));
    }

    const id = ++this.nextId;
    const request: KwardJsonRpcRequest = params === undefined
      ? { jsonrpc: jsonRpcVersion, id, method }
      : { jsonrpc: jsonRpcVersion, id, method, params };
    const body = Buffer.from(JSON.stringify(request), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'utf8');

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(Buffer.concat([header, body]), (error) => {
        if (!error) {
          return;
        }

        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  public notify(method: string, params?: unknown): void {
    this.start();
    const child = this.process;

    if (!child) {
      throw new Error('Kward RPC process is not available.');
    }

    const notification = params === undefined
      ? { jsonrpc: jsonRpcVersion, method }
      : { jsonrpc: jsonRpcVersion, method, params };
    const body = Buffer.from(JSON.stringify(notification), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'utf8');
    child.stdin.write(Buffer.concat([header, body]));
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rejectAll(new Error('Kward RPC transport disposed.'));

    const child = this.process;
    this.process = undefined;

    if (!child) {
      return;
    }

    if (!child.killed) {
      try {
        child.stdin.end();
      } catch {
        // ignore shutdown races
      }
      child.kill();
    }
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const contentLength = parseContentLength(headerText);
      if (!contentLength) {
        this.options.onError?.('Kward RPC sent a message without a valid Content-Length header.');
        this.buffer = Buffer.alloc(0);
        return;
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < bodyEnd) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: unknown;

    try {
      message = JSON.parse(body);
    } catch (error) {
      this.options.onError?.(`Kward RPC sent invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    if (typeof message.method === 'string' && !('id' in message)) {
      this.options.onNotification?.(message as KwardJsonRpcNotification);
      return;
    }

    const id = typeof message.id === 'number' ? message.id : undefined;
    if (id === undefined) {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    this.pending.delete(id);
    const response = message as KwardJsonRpcResponse;
    if (response.error) {
      pending.reject(new Error(response.error.message || `Kward RPC request ${id} failed.`));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parseContentLength(headerText: string): number | undefined {
  for (const line of headerText.split('\r\n')) {
    const [name, value] = line.split(':', 2);
    if (name?.toLowerCase() === 'content-length') {
      const parsed = Number.parseInt(value?.trim() ?? '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
