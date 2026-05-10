import type { ExtensionUiResponse, RpcEvent } from './piRpcProtocol';

export const defaultExtensionUiRequestTimeoutMs = 5 * 60 * 1000;

export type MaybePromise<T> = T | PromiseLike<T>;

export type ExtensionUiRequestUi = {
  notify(message: string, notifyType: string): void;
  select(title: string, options: string[]): MaybePromise<string | undefined>;
  confirm(title: string, message: string | undefined): MaybePromise<boolean | undefined>;
  input(title: string, placeholder: string | undefined): MaybePromise<string | undefined>;
};

export type ExtensionUiRequestHandlerOptions = {
  ui: ExtensionUiRequestUi;
  respond(response: ExtensionUiResponse): MaybePromise<void>;
  onError?: (message: string) => void;
  staleRequestTimeoutMs?: number;
  clock?: ExtensionUiRequestClock;
};

export type ExtensionUiRequestClock = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type ExtensionUiRequestAction =
  | { type: 'notify'; message: string; notifyType: string }
  | { type: 'select'; id: string; title: string; options: string[]; timeoutMs?: number }
  | { type: 'confirm'; id: string; title: string; message?: string; timeoutMs?: number }
  | { type: 'input'; id: string; title: string; placeholder?: string; timeoutMs?: number }
  | { type: 'cancel'; id: string; method: string }
  | { type: 'ignore' };

type PendingRequest = {
  generation: number;
  timeout: unknown;
};

const defaultClock: ExtensionUiRequestClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

const fireAndForgetMethods = new Set([
  'notify',
  'setStatus',
  'setWidget',
  'setTitle',
  'set_editor_text'
]);

export function createCancellingExtensionUi(
  notify: (message: string, notifyType: string) => void
): ExtensionUiRequestUi {
  return {
    notify,
    select: async () => undefined,
    confirm: async () => undefined,
    input: async () => undefined
  };
}

export function mapExtensionUiRequest(event: RpcEvent): ExtensionUiRequestAction {
  const method = getRecordString(event, 'method') ?? '';

  if (method === 'notify') {
    return {
      type: 'notify',
      message: getRecordString(event, 'message') ?? 'Pi notification',
      notifyType: getRecordString(event, 'notifyType') ?? 'info'
    };
  }

  const id = getRecordString(event, 'id');

  if (!id) {
    return { type: 'ignore' };
  }

  if (method === 'select') {
    const options = getStringArray(event.options);

    if (options.length === 0) {
      return { type: 'cancel', id, method };
    }

    return {
      type: 'select',
      id,
      title: getDialogTitle(event, 'Select an option'),
      options,
      ...getTimeoutField(event)
    };
  }

  if (method === 'confirm') {
    return {
      type: 'confirm',
      id,
      title: getDialogTitle(event, 'Confirm'),
      ...getOptionalStringField('message', getDialogMessage(event)),
      ...getTimeoutField(event)
    };
  }

  if (method === 'input') {
    return {
      type: 'input',
      id,
      title: getDialogTitle(event, 'Input'),
      ...getOptionalStringField('placeholder', getRecordString(event, 'placeholder')),
      ...getTimeoutField(event)
    };
  }

  if (fireAndForgetMethods.has(method)) {
    return { type: 'ignore' };
  }

  return { type: 'cancel', id, method };
}

export class ExtensionUiRequestHandler {
  private generation = 0;
  private disposed = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly clock: ExtensionUiRequestClock;

  public constructor(private readonly options: ExtensionUiRequestHandlerOptions) {
    this.clock = options.clock ?? defaultClock;
  }

  public async handle(event: RpcEvent): Promise<void> {
    if (this.disposed) {
      return;
    }

    const action = mapExtensionUiRequest(event);

    switch (action.type) {
      case 'notify':
        this.options.ui.notify(action.message, action.notifyType);
        return;
      case 'select':
        await this.handleSelect(action);
        return;
      case 'confirm':
        await this.handleConfirm(action);
        return;
      case 'input':
        await this.handleInput(action);
        return;
      case 'cancel':
        this.sendCancellation(action.id);
        return;
      case 'ignore':
        return;
    }
  }

  public startNewGeneration(): void {
    this.generation += 1;
    this.cancelPendingRequests();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generation += 1;
    this.cancelPendingRequests();
  }

  private async handleSelect(action: Extract<ExtensionUiRequestAction, { type: 'select' }>): Promise<void> {
    const pending = this.registerPendingRequest(action.id, action.timeoutMs);

    try {
      const selected = await this.options.ui.select(action.title, action.options);

      if (typeof selected === 'string') {
        this.completePendingRequest(action.id, pending.generation, { id: action.id, value: selected });
      } else {
        this.cancelPendingRequest(action.id, pending.generation);
      }
    } catch (error) {
      this.cancelPendingRequest(action.id, pending.generation);
      this.reportError(`Extension UI select request failed: ${getErrorMessage(error)}`);
    }
  }

  private async handleConfirm(action: Extract<ExtensionUiRequestAction, { type: 'confirm' }>): Promise<void> {
    const pending = this.registerPendingRequest(action.id, action.timeoutMs);

    try {
      const confirmed = await this.options.ui.confirm(action.title, action.message);

      if (typeof confirmed === 'boolean') {
        this.completePendingRequest(action.id, pending.generation, { id: action.id, confirmed });
      } else {
        this.cancelPendingRequest(action.id, pending.generation);
      }
    } catch (error) {
      this.cancelPendingRequest(action.id, pending.generation);
      this.reportError(`Extension UI confirm request failed: ${getErrorMessage(error)}`);
    }
  }

  private async handleInput(action: Extract<ExtensionUiRequestAction, { type: 'input' }>): Promise<void> {
    const pending = this.registerPendingRequest(action.id, action.timeoutMs);

    try {
      const value = await this.options.ui.input(action.title, action.placeholder);

      if (typeof value === 'string') {
        this.completePendingRequest(action.id, pending.generation, { id: action.id, value });
      } else {
        this.cancelPendingRequest(action.id, pending.generation);
      }
    } catch (error) {
      this.cancelPendingRequest(action.id, pending.generation);
      this.reportError(`Extension UI input request failed: ${getErrorMessage(error)}`);
    }
  }

  private registerPendingRequest(id: string, requestTimeoutMs: number | undefined): PendingRequest {
    const existing = this.pendingRequests.get(id);

    if (existing) {
      this.cancelPendingRequest(id, existing.generation);
    }

    const generation = this.generation;
    const timeout = this.clock.setTimeout(
      () => this.cancelPendingRequest(id, generation),
      requestTimeoutMs ?? this.options.staleRequestTimeoutMs ?? defaultExtensionUiRequestTimeoutMs
    );
    const pending = { generation, timeout };
    this.pendingRequests.set(id, pending);

    return pending;
  }

  private completePendingRequest(id: string, generation: number, response: ExtensionUiResponse): void {
    const pending = this.getMatchingPendingRequest(id, generation);

    if (!pending) {
      return;
    }

    this.deletePendingRequest(id, pending);
    this.sendResponse(response);
  }

  private cancelPendingRequest(id: string, generation: number): void {
    const pending = this.getMatchingPendingRequest(id, generation);

    if (!pending) {
      return;
    }

    this.deletePendingRequest(id, pending);
    this.sendCancellation(id);
  }

  private cancelPendingRequests(): void {
    const ids = [...this.pendingRequests.keys()];

    for (const id of ids) {
      const pending = this.pendingRequests.get(id);

      if (pending) {
        this.deletePendingRequest(id, pending);
        this.sendCancellation(id);
      }
    }
  }

  private getMatchingPendingRequest(id: string, generation: number): PendingRequest | undefined {
    const pending = this.pendingRequests.get(id);

    if (!pending || pending.generation !== generation || this.disposed) {
      return undefined;
    }

    return pending;
  }

  private deletePendingRequest(id: string, pending: PendingRequest): void {
    this.clock.clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
  }

  private sendCancellation(id: string): void {
    this.sendResponse({ id, cancelled: true });
  }

  private sendResponse(response: ExtensionUiResponse): void {
    try {
      const result = this.options.respond(response);

      if (isPromiseLike(result)) {
        result.then(undefined, (error) => {
          this.reportError(`Failed to respond to Pi extension UI request: ${getErrorMessage(error)}`);
        });
      }
    } catch (error) {
      this.reportError(`Failed to respond to Pi extension UI request: ${getErrorMessage(error)}`);
    }
  }

  private reportError(message: string): void {
    this.options.onError?.(message);
  }
}

function getDialogTitle(event: RpcEvent, fallback: string): string {
  return getRecordString(event, 'title')
    ?? getRecordString(event, 'message')
    ?? fallback;
}

function getDialogMessage(event: RpcEvent): string | undefined {
  const message = getRecordString(event, 'message');

  if (!message || message === getRecordString(event, 'title')) {
    return undefined;
  }

  return message;
}

function getTimeoutField(event: RpcEvent): { timeoutMs?: number } {
  const timeoutMs = event.timeout;

  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {};
  }

  return { timeoutMs };
}

function getOptionalStringField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
