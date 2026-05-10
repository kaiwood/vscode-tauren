import { StringDecoder } from 'string_decoder';

export type RpcEventBase = Record<string, unknown> & {
  type: string;
};

export type RpcResponse = RpcEventBase & {
  type: 'response';
  command?: string;
  id?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
};

export type ExtensionUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export type AgentStartRpcEvent = RpcEventBase & { type: 'agent_start' };
export type AgentEndRpcEvent = RpcEventBase & { type: 'agent_end'; messages?: unknown };
export type TurnStartRpcEvent = RpcEventBase & { type: 'turn_start' };
export type TurnEndRpcEvent = RpcEventBase & { type: 'turn_end'; toolResults?: unknown };
export type MessageStartRpcEvent = RpcEventBase & { type: 'message_start'; message?: unknown };
export type MessageEndRpcEvent = RpcEventBase & { type: 'message_end'; message?: unknown };
export type MessageUpdateRpcEvent = RpcEventBase & {
  type: 'message_update';
  assistantMessageEvent?: unknown;
};
export type ToolExecutionStartRpcEvent = RpcEventBase & {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
};
export type ToolExecutionUpdateRpcEvent = RpcEventBase & {
  type: 'tool_execution_update';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
};
export type ToolExecutionEndRpcEvent = RpcEventBase & {
  type: 'tool_execution_end';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};
export type QueueUpdateRpcEvent = RpcEventBase & { type: 'queue_update' };
export type CompactionStartRpcEvent = RpcEventBase & { type: 'compaction_start' };
export type CompactionEndRpcEvent = RpcEventBase & { type: 'compaction_end' };
export type AutoRetryStartRpcEvent = RpcEventBase & { type: 'auto_retry_start' };
export type AutoRetryEndRpcEvent = RpcEventBase & { type: 'auto_retry_end'; success?: boolean };
export type ExtensionUiRequestRpcEvent = RpcEventBase & {
  type: 'extension_ui_request';
  id?: string;
  method?: string;
  message?: string;
  notifyType?: string;
};
export type ExtensionErrorRpcEvent = RpcEventBase & {
  type: 'extension_error';
  extensionPath?: string;
  error?: string;
};

export type KnownRpcEvent =
  | AgentStartRpcEvent
  | AgentEndRpcEvent
  | TurnStartRpcEvent
  | TurnEndRpcEvent
  | MessageStartRpcEvent
  | MessageEndRpcEvent
  | MessageUpdateRpcEvent
  | ToolExecutionStartRpcEvent
  | ToolExecutionUpdateRpcEvent
  | ToolExecutionEndRpcEvent
  | QueueUpdateRpcEvent
  | CompactionStartRpcEvent
  | CompactionEndRpcEvent
  | AutoRetryStartRpcEvent
  | AutoRetryEndRpcEvent
  | ExtensionUiRequestRpcEvent
  | ExtensionErrorRpcEvent
  | RpcResponse;

export type UnknownRpcEvent = RpcEventBase;

export type RpcEvent = KnownRpcEvent | UnknownRpcEvent;

export function parseRpcEvent(value: unknown): RpcEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'response') {
    return parseRpcResponseFromRecord(value);
  }

  return { ...value, type: value.type };
}

export function parseRpcResponse(value: unknown): RpcResponse | undefined {
  if (!isRecord(value) || value.type !== 'response') {
    return undefined;
  }

  return parseRpcResponseFromRecord(value);
}

export function attachJsonlLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): () => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const emitLine = (line: string): void => {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  };

  const onData = (chunk: string | Buffer): void => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf('\n');

      if (newlineIndex === -1) {
        return;
      }

      emitLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };

  const onEnd = (): void => {
    buffer += decoder.end();

    if (buffer.length > 0) {
      emitLine(buffer);
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.on('end', onEnd);

  return () => {
    stream.off('data', onData);
    stream.off('end', onEnd);
  };
}

export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function parseRpcResponseFromRecord(record: Record<string, unknown>): RpcResponse {
  const response = omitKeys(record, ['type', 'command', 'id', 'success', 'error', 'data']) as RpcResponse;
  response.type = 'response';

  if (typeof record.command === 'string') {
    response.command = record.command;
  }

  if (typeof record.id === 'string') {
    response.id = record.id;
  }

  if (typeof record.success === 'boolean') {
    response.success = record.success;
  }

  if (typeof record.error === 'string') {
    response.error = record.error;
  }

  if ('data' in record) {
    response.data = record.data;
  }

  return response;
}

function omitKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const copy = { ...record };

  for (const key of keys) {
    delete copy[key];
  }

  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
