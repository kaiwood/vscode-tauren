import type {
  ChatActivityBodyMode,
  ChatActivityInput
} from './chatSession';
import type { RpcEvent } from './piRpcClient';

export type MessageUpdateAction =
  | { type: 'text_delta'; delta: string }
  | { type: 'assistant_error'; message: string }
  | ActivityUpdateAction
  | ActivityAddAction
  | { type: 'ignore' };

export type ActivityUpdateAction = {
  type: 'activity_update';
  sourceId: string;
  activity: ChatActivityInput;
  bodyMode?: ChatActivityBodyMode;
};

export type ActivityAddAction = {
  type: 'activity_add';
  activity: ChatActivityInput;
};

export type RpcActivityAction =
  | ActivityUpdateAction
  | ActivityAddAction
  | { type: 'ignore' };

export type ExtensionUiRequestAction =
  | { type: 'notify'; message: string; notifyType: string }
  | { type: 'cancel'; id: string }
  | { type: 'ignore' };

export function mapMessageUpdate(event: RpcEvent, streamId = 0): MessageUpdateAction {
  const assistantMessageEvent = event.assistantMessageEvent;

  if (!isRecord(assistantMessageEvent)) {
    return { type: 'ignore' };
  }

  const updateType = getRecordString(assistantMessageEvent, 'type') ?? '';

  switch (updateType) {
    case 'start':
      return updateActivity(`assistant:${streamId}`, {
        kind: 'message',
        title: 'Assistant response',
        status: 'running',
        summary: 'Started'
      });
    case 'text_start':
      return updateActivity(`assistant-text:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'message',
        title: 'Writing response',
        status: 'running'
      });
    case 'text_delta':
      return {
        type: 'text_delta',
        delta: typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : ''
      };
    case 'text_end':
      return updateActivity(`assistant-text:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'message',
        title: 'Response text',
        status: 'completed',
        summary: summarizeLength(getRecordString(assistantMessageEvent, 'content'))
      });
    case 'thinking_start':
      return updateActivity(`thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'thinking',
        title: 'Thinking',
        status: 'running',
        body: '',
        code: false
      });
    case 'thinking_delta':
      return updateActivity(
        `thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`,
        {
          kind: 'thinking',
          title: 'Thinking',
          status: 'running',
          body: getRecordString(assistantMessageEvent, 'delta') ?? '',
          code: false
        },
        'append'
      );
    case 'thinking_end':
      return updateActivity(`thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'thinking',
        title: 'Thinking',
        status: 'completed',
        summary: 'Completed'
      });
    case 'toolcall_start':
      return updateActivity(`toolcall:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'tool_call',
        title: 'Preparing tool call',
        status: 'running',
        body: '',
        code: true
      });
    case 'toolcall_delta':
      return updateActivity(
        `toolcall:${streamId}:${getContentIndex(assistantMessageEvent)}`,
        {
          kind: 'tool_call',
          title: 'Preparing tool call',
          status: 'running',
          body: getRecordString(assistantMessageEvent, 'delta') ?? '',
          code: true
        },
        'append'
      );
    case 'toolcall_end':
      return mapToolCallEnd(assistantMessageEvent, streamId);
    case 'done':
      return updateActivity(`assistant:${streamId}`, {
        kind: 'message',
        title: 'Assistant response',
        status: 'completed',
        summary: formatDoneReason(getRecordString(assistantMessageEvent, 'reason'))
      });
    case 'error':
      return {
        type: 'assistant_error',
        message: getRecordString(assistantMessageEvent, 'reason')
          ?? getRecordString(assistantMessageEvent, 'error')
          ?? 'Pi reported an error while responding.'
      };
    default:
      return addActivity({
        kind: 'rpc',
        title: updateType ? `Message update: ${updateType}` : 'Message update',
        status: 'info',
        body: formatJson(assistantMessageEvent),
        code: true
      });
  }
}

export function mapRpcActivity(event: RpcEvent): RpcActivityAction {
  switch (event.type) {
    case 'agent_start':
      return updateActivity('agent', {
        kind: 'agent',
        title: 'Agent processing',
        status: 'running',
        summary: 'Started'
      });
    case 'agent_end':
      return updateActivity('agent', {
        kind: 'agent',
        title: 'Agent processing',
        status: 'completed',
        summary: summarizeMessageCount(event.messages)
      });
    case 'turn_start':
      return addActivity({
        kind: 'turn',
        title: 'Turn started',
        status: 'info'
      });
    case 'turn_end':
      return addActivity({
        kind: 'turn',
        title: 'Turn completed',
        status: 'completed',
        summary: summarizeToolResults(event.toolResults),
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'message_start':
      return addActivity({
        kind: 'message',
        title: `${formatMessageRole(event.message)} message started`,
        status: 'info',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'message_end':
      return addActivity({
        kind: 'message',
        title: `${formatMessageRole(event.message)} message completed`,
        status: 'completed',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'tool_execution_start':
      return mapToolExecutionStart(event);
    case 'tool_execution_update':
      return mapToolExecutionUpdate(event);
    case 'tool_execution_end':
      return mapToolExecutionEnd(event);
    case 'queue_update':
      return addActivity({
        kind: 'queue',
        title: 'Queue updated',
        status: 'info',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'compaction_start':
      return updateActivity('compaction', {
        kind: 'compaction',
        title: 'Compacting context',
        status: 'running',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'compaction_end':
      return updateActivity('compaction', {
        kind: 'compaction',
        title: 'Compacting context',
        status: 'completed',
        summary: 'Completed',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'auto_retry_start':
      return updateActivity('auto-retry', {
        kind: 'retry',
        title: 'Auto retry',
        status: 'running',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'auto_retry_end':
      return updateActivity('auto-retry', {
        kind: 'retry',
        title: 'Auto retry',
        status: event.success === false ? 'error' : 'completed',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'extension_ui_request':
      return addActivity({
        kind: 'extension_ui',
        title: `Extension UI: ${getRecordString(event, 'method') ?? 'request'}`,
        status: 'info',
        summary: summarizeExtensionUiRequest(event),
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'extension_error':
      return addActivity({
        kind: 'extension_error',
        title: 'Extension error',
        status: 'error',
        summary: getRecordString(event, 'error') ?? 'Unknown extension error.',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'message_update':
    case 'response':
      return { type: 'ignore' };
    default:
      return addActivity({
        kind: 'rpc',
        title: `RPC event: ${event.type}`,
        status: 'info',
        body: formatJson(event),
        code: true
      });
  }
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

function mapToolCallEnd(
  assistantMessageEvent: Record<string, unknown>,
  streamId: number
): ActivityUpdateAction {
  const toolCall = isRecord(assistantMessageEvent.toolCall) ? assistantMessageEvent.toolCall : {};
  const toolName = getRecordString(toolCall, 'name') ?? getRecordString(assistantMessageEvent, 'name');
  const toolArguments = toolCall.arguments ?? toolCall.args ?? assistantMessageEvent.arguments;

  return updateActivity(`toolcall:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
    kind: 'tool_call',
    title: toolName ? `Prepared tool call: ${toolName}` : 'Prepared tool call',
    status: 'completed',
    summary: summarizeValue(toolArguments),
    body: formatBodyValue(toolArguments ?? toolCall),
    code: true
  });
}

function mapToolExecutionStart(event: RpcEvent): ActivityUpdateAction {
  const toolName = getToolName(event);
  const args = event.args;

  return updateActivity(getToolExecutionSourceId(event), {
    kind: 'tool_execution',
    title: `Running ${toolName}`,
    status: 'running',
    summary: summarizeToolArgs(args),
    body: formatBodyValue(args),
    code: true
  });
}

function mapToolExecutionUpdate(event: RpcEvent): ActivityUpdateAction {
  const toolName = getToolName(event);

  return updateActivity(getToolExecutionSourceId(event), {
    kind: 'tool_execution',
    title: `Running ${toolName}`,
    status: 'running',
    summary: summarizeToolArgs(event.args),
    body: formatToolResult(event.partialResult),
    code: true
  });
}

function mapToolExecutionEnd(event: RpcEvent): ActivityUpdateAction {
  const toolName = getToolName(event);
  const isError = event.isError === true;

  return updateActivity(getToolExecutionSourceId(event), {
    kind: 'tool_execution',
    title: isError ? `${toolName} failed` : `${toolName} completed`,
    status: isError ? 'error' : 'completed',
    summary: summarizeToolArgs(event.args),
    body: formatToolResult(event.result),
    code: true
  });
}

function updateActivity(
  sourceId: string,
  activity: ChatActivityInput,
  bodyMode?: ChatActivityBodyMode
): ActivityUpdateAction {
  const action: ActivityUpdateAction = {
    type: 'activity_update',
    sourceId,
    activity
  };

  if (bodyMode) {
    action.bodyMode = bodyMode;
  }

  return action;
}

function addActivity(activity: ChatActivityInput): ActivityAddAction {
  return {
    type: 'activity_add',
    activity
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getContentIndex(record: Record<string, unknown>): string {
  const value = record.contentIndex;

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return 'current';
}

function getToolExecutionSourceId(event: RpcEvent): string {
  const toolCallId = getRecordString(event, 'toolCallId');

  if (toolCallId) {
    return `tool:${toolCallId}`;
  }

  return `tool:${getToolName(event)}:current`;
}

function getToolName(event: RpcEvent): string {
  return getRecordString(event, 'toolName') ?? 'tool';
}

function formatDoneReason(reason: string | undefined): string | undefined {
  if (!reason) {
    return undefined;
  }

  return `Done: ${reason}`;
}

function summarizeLength(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return `${value.length} characters`;
}

function summarizeMessageCount(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return `${value.length} message${value.length === 1 ? '' : 's'}`;
}

function summarizeToolResults(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return `${value.length} tool result${value.length === 1 ? '' : 's'}`;
}

function formatMessageRole(message: unknown): string {
  if (!isRecord(message)) {
    return 'Message';
  }

  const role = getRecordString(message, 'role');

  if (!role) {
    return 'Message';
  }

  return `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;
}

function summarizeExtensionUiRequest(event: RpcEvent): string | undefined {
  return getRecordString(event, 'title')
    ?? getRecordString(event, 'message')
    ?? getRecordString(event, 'statusText')
    ?? getRecordString(event, 'text');
}

function summarizeToolArgs(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return summarizeValue(value);
  }

  return getRecordString(value, 'command')
    ?? getRecordString(value, 'path')
    ?? getRecordString(value, 'filePath')
    ?? getRecordString(value, 'pattern')
    ?? summarizeValue(value);
}

function summarizeValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return compactText(formatBodyValue(value));
}

function formatKnownEventBody(event: RpcEvent, omittedKeys: string[]): string | undefined {
  const details: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (!omittedKeys.includes(key)) {
      details[key] = value;
    }
  }

  return Object.keys(details).length > 0 ? formatJson(details) : undefined;
}

function formatToolResult(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return value === undefined ? undefined : formatBodyValue(value);
  }

  const content = formatContent(value.content);

  if (content) {
    return content;
  }

  return formatJson(value);
}

function formatContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts = value.map((item) => {
    if (!isRecord(item)) {
      return formatBodyValue(item);
    }

    if (getRecordString(item, 'type') === 'text') {
      return getRecordString(item, 'text') ?? '';
    }

    if (getRecordString(item, 'type') === 'image') {
      const mimeType = getRecordString(item, 'mimeType');
      return mimeType ? `[image: ${mimeType}]` : '[image]';
    }

    return formatJson(item);
  });

  return parts.join('\n');
}

function formatBodyValue(value: unknown): string {
  return typeof value === 'string' ? value : formatJson(value);
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function compactText(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  const maxLength = 160;

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3)}...`;
}
