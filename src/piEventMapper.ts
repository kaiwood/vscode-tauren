import type { RpcEvent } from './piRpcClient';

export type MessageUpdateAction =
  | { type: 'text_delta'; delta: string }
  | { type: 'assistant_error'; message: string }
  | { type: 'ignore' };

export type ExtensionUiRequestAction =
  | { type: 'notify'; message: string; notifyType: string }
  | { type: 'cancel'; id: string }
  | { type: 'ignore' };

export function mapMessageUpdate(event: RpcEvent): MessageUpdateAction {
  const assistantMessageEvent = event.assistantMessageEvent;

  if (!isRecord(assistantMessageEvent)) {
    return { type: 'ignore' };
  }

  if (assistantMessageEvent.type === 'text_delta') {
    return {
      type: 'text_delta',
      delta: typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : ''
    };
  }

  if (assistantMessageEvent.type === 'error') {
    return {
      type: 'assistant_error',
      message: getRecordString(assistantMessageEvent, 'reason')
        ?? getRecordString(assistantMessageEvent, 'error')
        ?? 'Pi reported an error while responding.'
    };
  }

  return { type: 'ignore' };
}

export function mapExtensionUiRequest(event: RpcEvent): ExtensionUiRequestAction {
  const method = typeof event.method === 'string' ? event.method : '';

  if (method === 'notify') {
    return {
      type: 'notify',
      message: typeof event.message === 'string' ? event.message : 'Pi notification',
      notifyType: typeof event.notifyType === 'string' ? event.notifyType : 'info'
    };
  }

  if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
    const id = typeof event.id === 'string' ? event.id : undefined;

    if (id) {
      return { type: 'cancel', id };
    }
  }

  return { type: 'ignore' };
}

export function getFailedResponseError(event: RpcEvent): string | undefined {
  if (event.success !== false) {
    return undefined;
  }

  return typeof event.error === 'string' ? event.error : 'Pi command failed.';
}

export function formatExtensionError(event: RpcEvent): string {
  const extensionPath = typeof event.extensionPath === 'string' ? event.extensionPath : 'extension';
  const error = typeof event.error === 'string' ? event.error : 'Unknown extension error.';

  return `Pi ${extensionPath} error: ${error}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
