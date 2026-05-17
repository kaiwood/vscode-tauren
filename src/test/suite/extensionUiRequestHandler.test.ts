import * as assert from 'assert';
import {
  ExtensionUiRequestHandler,
  mapExtensionUiRequest,
  type ExtensionUiRequestClock,
  type ExtensionUiRequestUi,
  type MaybePromise
} from '../../extensionUi/requestHandler';
import type { ExtensionUiResponse } from '../../rpc/types';

suite('ExtensionUiRequestHandler', () => {
  test('maps extension UI requests', () => {
    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'notify',
        message: 'Saved',
        notifyType: 'warning'
      }),
      { type: 'notify', message: 'Saved', notifyType: 'warning' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'notify'
      }),
      { type: 'notify', message: 'Pi notification', notifyType: 'info' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'select',
        id: 'select-1',
        title: 'Pick one',
        options: ['A', 1, 'B'],
        timeout: 100
      }),
      { type: 'select', id: 'select-1', title: 'Pick one', options: ['A', 'B'], timeoutMs: 100 }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'select',
        id: 'select-2',
        options: []
      }),
      { type: 'cancel', id: 'select-2', method: 'select' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'confirm',
        id: 'confirm-1',
        title: 'Continue?',
        message: 'This will run a command.'
      }),
      {
        type: 'confirm',
        id: 'confirm-1',
        title: 'Continue?',
        message: 'This will run a command.'
      }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'input',
        id: 'input-1',
        title: 'Name',
        placeholder: 'type here'
      }),
      { type: 'input', id: 'input-1', title: 'Name', placeholder: 'type here' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'editor',
        id: 'editor-1'
      }),
      { type: 'cancel', id: 'editor-1', method: 'editor' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'setStatus',
        id: 'status-1'
      }),
      { type: 'ignore' }
    );

    assert.deepStrictEqual(
      mapExtensionUiRequest({
        type: 'extension_ui_request',
        method: 'futureDialog',
        id: 'future-1'
      }),
      { type: 'cancel', id: 'future-1', method: 'futureDialog' }
    );
  });

  test('routes notifications without sending a response', async () => {
    const harness = createHandlerHarness();

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'notify',
      message: 'Saved',
      notifyType: 'info'
    });

    assert.deepStrictEqual(harness.ui.notifications, [{ message: 'Saved', notifyType: 'info' }]);
    assert.deepStrictEqual(harness.responses, []);
  });

  test('routes select requests to the UI and responds with selected values or cancellation', async () => {
    const harness = createHandlerHarness();
    harness.ui.selectResult = 'Allow';

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-1',
      title: 'Allow command?',
      options: ['Allow', 'Block']
    });

    assert.deepStrictEqual(harness.ui.selectCalls, [{ title: 'Allow command?', options: ['Allow', 'Block'] }]);
    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', value: 'Allow' }]);

    harness.ui.selectResult = undefined;
    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-2',
      title: 'Allow command?',
      options: ['Allow', 'Block']
    });

    assert.deepStrictEqual(harness.responses[1], { id: 'select-2', cancelled: true });
  });

  test('routes confirm requests and distinguishes no from dismissal', async () => {
    const harness = createHandlerHarness();
    harness.ui.confirmResult = true;

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'confirm',
      id: 'confirm-1',
      title: 'Continue?',
      message: 'Run it now?'
    });

    harness.ui.confirmResult = false;
    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'confirm',
      id: 'confirm-2',
      title: 'Continue?',
      message: 'Run it now?'
    });

    harness.ui.confirmResult = undefined;
    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'confirm',
      id: 'confirm-3',
      title: 'Continue?'
    });

    assert.deepStrictEqual(harness.ui.confirmCalls, [
      { title: 'Continue?', message: 'Run it now?' },
      { title: 'Continue?', message: 'Run it now?' },
      { title: 'Continue?', message: undefined }
    ]);
    assert.deepStrictEqual(harness.responses, [
      { id: 'confirm-1', confirmed: true },
      { id: 'confirm-2', confirmed: false },
      { id: 'confirm-3', cancelled: true }
    ]);
  });

  test('routes input requests to the UI and responds with entered values or cancellation', async () => {
    const harness = createHandlerHarness();
    harness.ui.inputResult = 'hello';

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'input',
      id: 'input-1',
      title: 'Value',
      placeholder: 'type something'
    });

    harness.ui.inputResult = undefined;
    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'input',
      id: 'input-2',
      title: 'Value'
    });

    assert.deepStrictEqual(harness.ui.inputCalls, [
      { title: 'Value', placeholder: 'type something' },
      { title: 'Value', placeholder: undefined }
    ]);
    assert.deepStrictEqual(harness.responses, [
      { id: 'input-1', value: 'hello' },
      { id: 'input-2', cancelled: true }
    ]);
  });

  test('cancels unsupported dialog requests', async () => {
    const harness = createHandlerHarness();

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'editor',
      id: 'editor-1',
      title: 'Edit'
    });
    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'futureDialog',
      id: 'future-1'
    });

    assert.deepStrictEqual(harness.responses, [
      { id: 'editor-1', cancelled: true },
      { id: 'future-1', cancelled: true }
    ]);
  });

  test('cancels and ignores stale generation requests', async () => {
    const input = createDeferred<string | undefined>();
    const harness = createHandlerHarness();
    harness.ui.inputResult = input.promise;

    const handling = harness.handler.handle({
      type: 'extension_ui_request',
      method: 'input',
      id: 'input-1',
      title: 'Value'
    });

    assert.strictEqual(harness.ui.inputCalls.length, 1);

    harness.handler.startNewGeneration();
    assert.deepStrictEqual(harness.responses, [{ id: 'input-1', cancelled: true }]);

    input.resolve('late value');
    await handling;

    assert.deepStrictEqual(harness.responses, [{ id: 'input-1', cancelled: true }]);
  });

  test('cancels pending requests on dispose', async () => {
    const select = createDeferred<string | undefined>();
    const harness = createHandlerHarness();
    harness.ui.selectResult = select.promise;

    const handling = harness.handler.handle({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-1',
      title: 'Pick',
      options: ['A']
    });

    harness.handler.dispose();
    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', cancelled: true }]);

    select.resolve('A');
    await handling;

    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', cancelled: true }]);
  });

  test('times out stale requests and ignores late UI results', async () => {
    const select = createDeferred<string | undefined>();
    const clock = new FakeClock();
    const harness = createHandlerHarness({ clock, staleRequestTimeoutMs: 50 });
    harness.ui.selectResult = select.promise;

    const handling = harness.handler.handle({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-1',
      title: 'Pick',
      options: ['A'],
      timeout: 25
    });

    assert.deepStrictEqual(clock.delays, [25]);

    clock.runAll();
    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', cancelled: true }]);

    select.resolve('A');
    await handling;

    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', cancelled: true }]);
  });

  test('cancels requests and reports errors when UI calls fail', async () => {
    const harness = createHandlerHarness();
    harness.ui.selectResult = Promise.reject(new Error('quick pick failed'));

    await harness.handler.handle({
      type: 'extension_ui_request',
      method: 'select',
      id: 'select-1',
      title: 'Pick',
      options: ['A']
    });

    assert.deepStrictEqual(harness.responses, [{ id: 'select-1', cancelled: true }]);
    assert.strictEqual(harness.errors.length, 1);
    assert.match(harness.errors[0], /quick pick failed/);
  });
});

type HandlerHarnessOptions = {
  clock?: ExtensionUiRequestClock;
  staleRequestTimeoutMs?: number;
};

type HandlerHarness = {
  handler: ExtensionUiRequestHandler;
  ui: FakeExtensionUi;
  responses: ExtensionUiResponse[];
  errors: string[];
};

class FakeExtensionUi implements ExtensionUiRequestUi {
  public notifications: { message: string; notifyType: string }[] = [];
  public selectCalls: { title: string; options: string[] }[] = [];
  public confirmCalls: { title: string; message: string | undefined }[] = [];
  public inputCalls: { title: string; placeholder: string | undefined }[] = [];
  public selectResult: MaybePromise<string | undefined> = undefined;
  public confirmResult: MaybePromise<boolean | undefined> = undefined;
  public inputResult: MaybePromise<string | undefined> = undefined;

  public notify(message: string, notifyType: string): void {
    this.notifications.push({ message, notifyType });
  }

  public select(title: string, options: string[]): MaybePromise<string | undefined> {
    this.selectCalls.push({ title, options });
    return this.selectResult;
  }

  public confirm(title: string, message: string | undefined): MaybePromise<boolean | undefined> {
    this.confirmCalls.push({ title, message });
    return this.confirmResult;
  }

  public input(title: string, placeholder: string | undefined): MaybePromise<string | undefined> {
    this.inputCalls.push({ title, placeholder });
    return this.inputResult;
  }
}

class FakeClock implements ExtensionUiRequestClock {
  public delays: number[] = [];
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  public setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.delays.push(ms);
    this.callbacks.set(id, callback);
    return id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') {
      this.callbacks.delete(handle);
    }
  }

  public runAll(): void {
    for (const [id, callback] of [...this.callbacks]) {
      this.callbacks.delete(id);
      callback();
    }
  }
}

function createHandlerHarness(options: HandlerHarnessOptions = {}): HandlerHarness {
  const ui = new FakeExtensionUi();
  const responses: ExtensionUiResponse[] = [];
  const errors: string[] = [];
  const handler = new ExtensionUiRequestHandler({
    ui,
    respond: (response) => {
      responses.push(response);
    },
    onError: (message) => {
      errors.push(message);
    },
    staleRequestTimeoutMs: options.staleRequestTimeoutMs,
    clock: options.clock
  });

  return { handler, ui, responses, errors };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
