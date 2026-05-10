import * as assert from 'assert';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import { PiRpcClient, type RpcEvent } from '../../piRpcClient';

suite('PiRpcClient', () => {
  test('reports whether the RPC process is running', async () => {
    const { client, fakeProcess } = createClient();

    assert.strictEqual(client.isRunning(), false);

    const statePromise = client.getState();
    const command = await fakeProcess.nextCommand();

    assert.strictEqual(client.isRunning(), true);

    fakeProcess.writeRecord({
      type: 'response',
      id: command.id,
      command: 'get_state',
      success: true,
      data: {}
    });

    await statePromise;
    fakeProcess.emitExit(0);

    assert.strictEqual(client.isRunning(), false);
    client.dispose();
  });

  test('correlates responses by id', async () => {
    const { client, fakeProcess, spawnCalls } = createClient({ cwd: '/workspace' });

    const statePromise = client.getState();
    const statsPromise = client.getSessionStats();
    const commands = [await fakeProcess.nextCommand(), await fakeProcess.nextCommand()];
    const stateCommand = commands.find((command) => command.type === 'get_state');
    const statsCommand = commands.find((command) => command.type === 'get_session_stats');

    assert.strictEqual(spawnCalls.length, 1);
    assert.strictEqual(spawnCalls[0].command, 'pi');
    assert.deepStrictEqual(spawnCalls[0].args, ['--mode', 'rpc']);
    assert.strictEqual(spawnCalls[0].options.cwd, '/workspace');
    assert.deepStrictEqual(spawnCalls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.ok(stateCommand);
    assert.ok(statsCommand);
    assert.ok(typeof stateCommand.id === 'string');
    assert.ok(typeof statsCommand.id === 'string');
    assert.notStrictEqual(stateCommand.id, statsCommand.id);

    fakeProcess.writeRecord({
      type: 'response',
      id: statsCommand.id,
      command: 'get_session_stats',
      success: true,
      data: { contextUsage: { tokens: 12 } }
    });
    fakeProcess.writeRecord({
      type: 'response',
      id: stateCommand.id,
      command: 'get_state',
      success: true,
      data: { thinkingLevel: 'high' }
    });

    assert.deepStrictEqual(await statePromise, { thinkingLevel: 'high' });
    assert.deepStrictEqual(await statsPromise, { contextUsage: { tokens: 12 } });

    client.dispose();
  });

  test('rejects failed command responses', async () => {
    const { client, fakeProcess } = createClient();
    const responsePromise = client.setThinkingLevel('high');
    const command = await fakeProcess.nextCommand();

    fakeProcess.writeRecord({
      type: 'response',
      id: command.id,
      command: 'set_thinking_level',
      success: false,
      error: 'bad thinking level'
    });

    await assert.rejects(responsePromise, /bad thinking level/);
    client.dispose();
  });

  test('emits unmatched responses as events', async () => {
    const { client, fakeProcess } = createClient();
    const events: RpcEvent[] = [];

    client.onEvent((event) => events.push(event));

    const statePromise = client.getState();
    const command = await fakeProcess.nextCommand();
    const unmatchedResponse: RpcEvent = {
      type: 'response',
      id: 'unmatched',
      success: true,
      data: { ignored: true }
    };

    fakeProcess.writeRecord(unmatchedResponse);
    await flushPromises();

    assert.deepStrictEqual(events, [unmatchedResponse]);

    fakeProcess.writeRecord({
      type: 'response',
      id: command.id,
      command: 'get_state',
      success: true,
      data: { thinkingLevel: 'off' }
    });

    assert.deepStrictEqual(await statePromise, { thinkingLevel: 'off' });
    client.dispose();
  });

  test('emits errors for malformed JSON stdout', async () => {
    const { client, fakeProcess } = createClient();
    const errors: string[] = [];

    client.onError((message) => errors.push(message));

    const statePromise = client.getState();
    const command = await fakeProcess.nextCommand();

    fakeProcess.writeRaw('{not json}\n');
    await flushPromises();

    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Failed to parse Pi RPC output/);

    fakeProcess.writeRecord({
      type: 'response',
      id: command.id,
      command: 'get_state',
      success: true,
      data: {}
    });

    assert.deepStrictEqual(await statePromise, {});
    client.dispose();
  });

  test('emits errors for malformed RPC records', async () => {
    const { client, fakeProcess } = createClient();
    const errors: string[] = [];

    client.onError((message) => errors.push(message));

    const statePromise = client.getState();
    const command = await fakeProcess.nextCommand();

    fakeProcess.writeRecord({ missingType: true });
    await flushPromises();

    assert.deepStrictEqual(errors, ['Received malformed Pi RPC output.']);

    fakeProcess.writeRecord({
      type: 'response',
      id: command.id,
      command: 'get_state',
      success: true,
      data: {}
    });

    assert.deepStrictEqual(await statePromise, {});
    client.dispose();
  });

  test('rejects startup when the process emits error', async () => {
    const { client, fakeProcess } = createClient();
    const errors: string[] = [];

    client.onError((message) => errors.push(message));

    const statePromise = client.getState();

    fakeProcess.writeStderr('spawn stderr');
    fakeProcess.emitProcessError(new Error('spawn failed'));

    await assert.rejects(statePromise, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Failed to start Pi RPC process: spawn failed/);
      assert.match(error.message, /Stderr: spawn stderr/);
      return true;
    });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Failed to start Pi RPC process: spawn failed/);
    assert.match(errors[0], /Stderr: spawn stderr/);

    client.dispose();
  });

  test('rejects pending requests when the process exits', async () => {
    const { client, fakeProcess } = createClient();
    const errors: string[] = [];

    client.onError((message) => errors.push(message));

    const statePromise = client.getState();
    await fakeProcess.nextCommand();

    fakeProcess.writeStderr('runtime stderr');
    fakeProcess.emitExit(2);

    await assert.rejects(statePromise, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Pi RPC process exited with code 2/);
      assert.match(error.message, /Stderr: runtime stderr/);
      return true;
    });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Pi RPC process exited with code 2/);

    client.dispose();
  });

  test('rejects pending requests on dispose', async () => {
    const { client, fakeProcess } = createClient();
    const statePromise = client.getState();

    await fakeProcess.nextCommand();
    client.dispose();

    await assert.rejects(statePromise, /Pi RPC client disposed/);
    assert.strictEqual(fakeProcess.killedSignal, 'SIGTERM');
  });

  test('includes stderr in command timeout errors', async () => {
    const { client, fakeProcess } = createClient({ commandTimeoutMs: 5 });
    const statePromise = client.getState();

    await fakeProcess.nextCommand();
    fakeProcess.writeStderr('timeout stderr');

    await assert.rejects(statePromise, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Timed out waiting for Pi response to get_state/);
      assert.match(error.message, /Stderr: timeout stderr/);
      return true;
    });

    client.dispose();
  });
});

type RpcCommandRecord = {
  type: string;
  id?: string;
  [key: string]: unknown;
};

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: {
    cwd?: string | URL;
    stdio?: unknown;
  };
};

class FakePiProcess extends EventEmitter {
  public readonly stdin = new CommandWritable((command) => this.pushCommand(command));
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public killedSignal: NodeJS.Signals | number | undefined;
  private readonly commands: RpcCommandRecord[] = [];
  private readonly commandWaiters: ((command: RpcCommandRecord) => void)[] = [];

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killedSignal = signal;
    return true;
  }

  public emitProcessError(error: Error): void {
    this.emit('error', error);
  }

  public emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }

  public writeRecord(record: unknown): void {
    this.stdout.write(`${JSON.stringify(record)}\n`);
  }

  public writeRaw(raw: string): void {
    this.stdout.write(raw);
  }

  public writeStderr(message: string): void {
    this.stderr.write(message);
  }

  public nextCommand(): Promise<RpcCommandRecord> {
    const command = this.commands.shift();

    if (command) {
      return Promise.resolve(command);
    }

    return new Promise((resolve, reject) => {
      const waiter = (nextCommand: RpcCommandRecord): void => {
        clearTimeout(timeout);
        resolve(nextCommand);
      };
      const timeout = setTimeout(() => {
        const waiterIndex = this.commandWaiters.indexOf(waiter);

        if (waiterIndex >= 0) {
          this.commandWaiters.splice(waiterIndex, 1);
        }

        reject(new Error('Timed out waiting for Pi RPC command.'));
      }, 1000);

      this.commandWaiters.push(waiter);
    });
  }

  private pushCommand(command: RpcCommandRecord): void {
    const waiter = this.commandWaiters.shift();

    if (waiter) {
      waiter(command);
      return;
    }

    this.commands.push(command);
  }
}

class CommandWritable extends Writable {
  private buffer = '';

  public constructor(private readonly onCommand: (command: RpcCommandRecord) => void) {
    super();
  }

  public _write(
    chunk: Buffer | string | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.buffer += chunk.toString();

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');

      if (newlineIndex === -1) {
        break;
      }

      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.onCommand(JSON.parse(line) as RpcCommandRecord);
    }

    callback();
  }
}

function createClient(options: { cwd?: string; commandTimeoutMs?: number } = {}): {
  client: PiRpcClient;
  fakeProcess: FakePiProcess;
  spawnCalls: SpawnCall[];
} {
  const fakeProcess = new FakePiProcess();
  const spawnCalls: SpawnCall[] = [];
  const client = new PiRpcClient({
    cwd: options.cwd,
    commandTimeoutMs: options.commandTimeoutMs,
    spawnFactory: (command, args, spawnOptions) => {
      spawnCalls.push({
        command,
        args,
        options: {
          cwd: spawnOptions.cwd,
          stdio: spawnOptions.stdio
        }
      });
      return fakeProcess;
    }
  });

  return { client, fakeProcess, spawnCalls };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
