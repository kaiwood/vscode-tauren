import type {
  ChatActivityBodyMode,
  ChatActivityInput
} from '../chat/chatSession';
import { formatCompactionTitle } from '../sessions/sessionFormatting';
import type { RpcEvent } from '../rpc/types';

const toolResultPreviewMaxLines = 8;
const toolResultPreviewMaxCharacters = 2400;
const editDiffPreviewMaxLines = 16;
const editDiffLineMaxCharacters = 500;
const ansiRed = '\x1b[31m';
const ansiGreen = '\x1b[32m';
const ansiReset = '\x1b[0m';

type ToolTextPreview = {
  body: string;
  expandedBody?: string;
};

export type MessageUpdateAction =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start'; sourceId: string }
  | { type: 'thinking_delta'; sourceId: string; delta: string }
  | { type: 'thinking_end'; sourceId: string; content?: string }
  | { type: 'assistant_error'; message: string }
  | ActivityUpdateAction
  | ActivityAddAction
  | ActivityRemoveAction
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

export type ActivityRemoveAction = {
  type: 'activity_remove';
  sourceId: string;
};

export type RpcActivityAction =
  | ActivityUpdateAction
  | ActivityAddAction
  | ActivityRemoveAction
  | { type: 'ignore' };

export type RpcMappingOptions = {
  fullCommunication?: boolean;
};

export type ToolExecutionActivityOptions = {
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  status: 'running' | 'completed' | 'error';
};

export function formatToolExecutionActivity({
  toolName,
  args,
  partialResult,
  result,
  status
}: ToolExecutionActivityOptions): ChatActivityInput {
  const display = formatToolExecutionDisplay({ toolName, args });
  const preview = status !== 'error' && display.toolName === 'edit'
    ? formatEditDiffPreview(args) ?? formatToolResultPreview(status === 'running' ? partialResult : result, display.toolName)
    : formatToolResultPreview(status === 'running' ? partialResult : result, display.toolName);

  return {
    kind: 'tool_execution',
    title: display.title,
    status,
    ...(display.summary ? { summary: display.summary } : {}),
    ...(preview ? { body: preview.body, ...(preview.expandedBody ? { expandedBody: preview.expandedBody } : {}), code: true } : {})
  };
}

export function mapMessageUpdate(
  event: RpcEvent,
  streamId = 0,
  options: RpcMappingOptions = { fullCommunication: true }
): MessageUpdateAction {
  const fullCommunication = options.fullCommunication !== false;
  const assistantMessageEvent = event.assistantMessageEvent;

  if (!isRecord(assistantMessageEvent)) {
    return { type: 'ignore' };
  }

  const updateType = getRecordString(assistantMessageEvent, 'type') ?? '';

  switch (updateType) {
    case 'start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return updateActivity(`assistant:${streamId}`, {
        kind: 'message',
        title: 'Assistant response',
        status: 'running',
        summary: 'Started'
      });
    case 'text_start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

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
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return updateActivity(`assistant-text:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'message',
        title: 'Response text',
        status: 'completed',
        summary: summarizeLength(getRecordString(assistantMessageEvent, 'content'))
      });
    case 'thinking_start':
      return {
        type: 'thinking_start',
        sourceId: `thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`
      };
    case 'thinking_delta':
      return {
        type: 'thinking_delta',
        sourceId: `thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`,
        delta: getRecordString(assistantMessageEvent, 'delta') ?? ''
      };
    case 'thinking_end': {
      const content = getRecordString(assistantMessageEvent, 'content')
        ?? getPartialThinkingContent(assistantMessageEvent);

      return {
        type: 'thinking_end',
        sourceId: `thinking:${streamId}:${getContentIndex(assistantMessageEvent)}`,
        ...(content ? { content } : {})
      };
    }
    case 'toolcall_start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return updateActivity(`toolcall:${streamId}:${getContentIndex(assistantMessageEvent)}`, {
        kind: 'tool_call',
        title: 'Preparing tool call',
        status: 'running',
        body: '',
        code: true
      });
    case 'toolcall_delta':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

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
      return mapToolCallEnd(assistantMessageEvent, streamId, fullCommunication);
    case 'done':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

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
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'rpc',
        title: updateType ? `Message update: ${updateType}` : 'Message update',
        status: 'info',
        body: formatJson(assistantMessageEvent),
        code: true
      });
  }
}

export function mapRpcActivity(
  event: RpcEvent,
  options: RpcMappingOptions = { fullCommunication: true }
): RpcActivityAction {
  const fullCommunication = options.fullCommunication !== false;

  switch (event.type) {
    case 'agent_start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return updateActivity('agent', {
        kind: 'agent',
        title: 'Agent processing',
        status: 'running',
        summary: 'Started'
      });
    case 'agent_end':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return updateActivity('agent', {
        kind: 'agent',
        title: 'Agent processing',
        status: 'completed',
        summary: summarizeMessageCount(event.messages)
      });
    case 'turn_start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'turn',
        title: 'Turn started',
        status: 'info'
      });
    case 'turn_end':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'turn',
        title: 'Turn completed',
        status: 'completed',
        summary: summarizeToolResults(event.toolResults),
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'message_start':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'message',
        title: `${formatMessageRole(event.message)} message started`,
        status: 'info',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'message_end':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'message',
        title: `${formatMessageRole(event.message)} message completed`,
        status: 'completed',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'tool_execution_start':
      return mapToolExecutionStart(event, fullCommunication);
    case 'tool_execution_update':
      return mapToolExecutionUpdate(event, fullCommunication);
    case 'tool_execution_end':
      return mapToolExecutionEnd(event, fullCommunication);
    case 'queue_update':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'queue',
        title: 'Queue updated',
        status: 'info',
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'compaction_start':
      return updateActivity('compaction', compactActivity({
        kind: 'compaction',
        title: 'Compacting context…',
        status: 'running',
        body: formatKnownEventBody(event, ['type']),
        code: true
      }, fullCommunication));
    case 'compaction_end': {
      const result = isRecord(event.result) ? event.result : undefined;
      const tokensBefore = getRecordNumber(result, 'tokensBefore');
      const summary = getRecordString(result ?? {}, 'summary');
      const errorMessage = getRecordString(event, 'errorMessage');
      const status = errorMessage ? 'error' : 'completed';

      return updateActivity('compaction', compactActivity({
        kind: 'compaction',
        title: status === 'completed' ? formatCompactionTitle(tokensBefore) : 'Compacting context…',
        status,
        ...(errorMessage || tokensBefore === undefined ? { summary: errorMessage ?? 'Completed' } : {}),
        ...(summary ? { body: summary } : { body: formatKnownEventBody(event, ['type']) }),
        code: !summary
      }, fullCommunication));
    }
    case 'auto_retry_start':
      return updateActivity('auto-retry', compactActivity({
        kind: 'retry',
        title: 'Auto retry',
        status: 'running',
        body: formatKnownEventBody(event, ['type']),
        code: true
      }, fullCommunication));
    case 'auto_retry_end':
      return updateActivity('auto-retry', compactActivity({
        kind: 'retry',
        title: 'Auto retry',
        status: event.success === false ? 'error' : 'completed',
        body: formatKnownEventBody(event, ['type']),
        code: true
      }, fullCommunication));
    case 'extension_ui_request':
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'extension_ui',
        title: `Extension UI: ${getRecordString(event, 'method') ?? 'request'}`,
        status: 'info',
        summary: summarizeExtensionUiRequest(event),
        body: formatKnownEventBody(event, ['type']),
        code: true
      });
    case 'extension_error':
      return addActivity(compactActivity({
        kind: 'extension_error',
        title: 'Extension error',
        status: 'error',
        summary: getRecordString(event, 'error') ?? 'Unknown extension error.',
        body: formatKnownEventBody(event, ['type']),
        code: true
      }, fullCommunication));
    case 'message_update':
    case 'response':
      return { type: 'ignore' };
    default:
      if (!fullCommunication) {
        return { type: 'ignore' };
      }

      return addActivity({
        kind: 'rpc',
        title: `RPC event: ${event.type}`,
        status: 'info',
        body: formatJson(event),
        code: true
      });
  }
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
  streamId: number,
  fullCommunication: boolean
): ActivityUpdateAction | { type: 'ignore' } {
  if (!fullCommunication) {
    return { type: 'ignore' };
  }

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

function mapToolExecutionStart(event: RpcEvent, _fullCommunication: boolean): ActivityUpdateAction | { type: 'ignore' } {
  return updateActivity(getToolExecutionSourceId(event), formatToolExecutionActivity({
    toolName: getToolName(event),
    args: event.args,
    status: 'running'
  }));
}

function mapToolExecutionUpdate(event: RpcEvent, _fullCommunication: boolean): ActivityUpdateAction | { type: 'ignore' } {
  return updateActivity(getToolExecutionSourceId(event), formatToolExecutionActivity({
    toolName: getToolName(event),
    args: event.args,
    partialResult: event.partialResult,
    status: 'running'
  }));
}

function mapToolExecutionEnd(event: RpcEvent, _fullCommunication: boolean): ActivityUpdateAction | { type: 'ignore' } {
  const isError = event.isError === true;

  return updateActivity(getToolExecutionSourceId(event), formatToolExecutionActivity({
    toolName: getToolName(event),
    args: event.args,
    result: event.result,
    status: isError ? 'error' : 'completed'
  }));
}

function compactActivity(activity: ChatActivityInput, fullCommunication: boolean): ChatActivityInput {
  if (fullCommunication) {
    return activity;
  }

  const { body: _body, code: _code, ...compact } = activity;
  return compact;
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

function getRecordNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getContentIndex(record: Record<string, unknown>): string {
  const value = record.contentIndex;

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return 'current';
}

function getPartialThinkingContent(record: Record<string, unknown>): string | undefined {
  const partial = record.partial;
  const contentIndex = Number(getContentIndex(record));

  if (!isRecord(partial) || !Array.isArray(partial.content) || !Number.isInteger(contentIndex)) {
    return undefined;
  }

  const content = partial.content[contentIndex];

  if (!isRecord(content) || content.type !== 'thinking') {
    return undefined;
  }

  return getRecordString(content, 'thinking');
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

function formatToolExecutionDisplay(input: { toolName?: string; args?: unknown }): { toolName: string; title: string; summary?: string } {
  const toolName = input.toolName || 'tool';
  const args = isRecord(input.args) ? input.args : undefined;

  if (toolName === 'bash') {
    const command = args ? getRecordString(args, 'command') : undefined;
    const timeout = args ? getPositiveNumber(args.timeout) : undefined;
    const timeoutLabel = timeout === undefined ? '' : ` (timeout ${timeout}s)`;

    return {
      toolName,
      title: command ? `$ ${compactOneLine(command, 140)}${timeoutLabel}` : '$ bash',
      summary: command && command.includes('\n') ? compactOneLine(command, 180) : undefined
    };
  }

  if (toolName === 'read') {
    const path = args ? getRecordString(args, 'path') : undefined;
    const range = args ? formatReadRange(args) : undefined;

    return {
      toolName,
      title: path ? `read ${path}${range ?? ''}` : 'read',
      summary: path ? undefined : summarizeToolArgs(input.args)
    };
  }

  if (toolName === 'edit') {
    const path = args ? getRecordString(args, 'path') : undefined;

    return {
      toolName,
      title: path ? `edit ${path}` : 'edit',
      summary: summarizeEditCount(args)
    };
  }

  if (toolName === 'write') {
    const path = args ? getRecordString(args, 'path') : undefined;

    return {
      toolName,
      title: path ? `write ${path}` : 'write',
      summary: path ? undefined : summarizeToolArgs(input.args)
    };
  }

  const summary = summarizeToolArgs(input.args);

  return {
    toolName,
    title: summary ? `${toolName} ${summary}` : toolName,
    summary: undefined
  };
}

function formatReadRange(args: Record<string, unknown>): string | undefined {
  const offset = getPositiveNumber(args.offset);
  const limit = getPositiveNumber(args.limit);

  if (offset !== undefined && limit !== undefined) {
    return `:${offset}-${offset + limit - 1}`;
  }

  if (offset !== undefined) {
    return `:${offset}`;
  }

  if (limit !== undefined) {
    return `:1-${limit}`;
  }

  return undefined;
}

function summarizeEditCount(args: Record<string, unknown> | undefined): string | undefined {
  const edits = args?.edits;

  if (!Array.isArray(edits)) {
    return undefined;
  }

  return `${edits.length} replacement${edits.length === 1 ? '' : 's'}`;
}

function formatEditDiffPreview(args: unknown): ToolTextPreview | undefined {
  if (!isRecord(args) || !Array.isArray(args.edits)) {
    return undefined;
  }

  const lines: string[] = [];

  for (const [index, edit] of args.edits.entries()) {
    if (!isRecord(edit)) {
      continue;
    }

    const oldText = getRecordString(edit, 'oldText');
    const newText = getRecordString(edit, 'newText');

    if (oldText === undefined || newText === undefined) {
      continue;
    }

    if (args.edits.length > 1) {
      lines.push(`@@ replacement ${index + 1} @@`);
    }

    lines.push(...formatDiffLines('-', oldText, ansiRed));
    lines.push(...formatDiffLines('+', newText, ansiGreen));
  }

  if (lines.length === 0) {
    return undefined;
  }

  return previewEditDiffLines(lines);
}

function formatDiffLines(prefix: '-' | '+', value: string, color: string): string[] {
  const lines = value.split('\n');
  return lines.map((line) => `${color}${prefix}${truncateDiffLine(line)}${ansiReset}`);
}

function truncateDiffLine(line: string): string {
  if (line.length <= editDiffLineMaxCharacters) {
    return line;
  }

  return `${line.slice(0, editDiffLineMaxCharacters - 3)}...`;
}

function previewEditDiffLines(lines: string[]): ToolTextPreview {
  const expandedBody = lines.join('\n');

  if (lines.length <= editDiffPreviewMaxLines) {
    return { body: expandedBody };
  }

  const hiddenLineCount = lines.length - editDiffPreviewMaxLines;
  return {
    body: `${lines.slice(0, editDiffPreviewMaxLines).join('\n')}\n... (${hiddenLineCount} more diff lines)`,
    expandedBody
  };
}

function getPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
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

function formatToolResultPreview(value: unknown, toolName: string): ToolTextPreview | undefined {
  const result = formatToolResult(value);

  if (!result) {
    return undefined;
  }

  return previewToolText(result, toolName === 'bash' ? 'tail' : 'head');
}

function formatToolResult(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return value === undefined ? undefined : formatBodyValue(value);
  }

  const content = formatContent(value.content);

  if (content !== undefined) {
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

function previewToolText(value: string, mode: 'head' | 'tail'): ToolTextPreview {
  const linePreview = previewToolTextByLines(value, mode);

  if (linePreview.body.length <= toolResultPreviewMaxCharacters) {
    return linePreview;
  }

  if (mode === 'tail') {
    return {
      body: `... (output truncated)\n${linePreview.body.slice(linePreview.body.length - toolResultPreviewMaxCharacters)}`,
      expandedBody: value
    };
  }

  return {
    body: `${linePreview.body.slice(0, toolResultPreviewMaxCharacters)}\n... (output truncated)`,
    expandedBody: value
  };
}

function previewToolTextByLines(value: string, mode: 'head' | 'tail'): ToolTextPreview {
  const lines = value.split('\n');

  if (lines.length <= toolResultPreviewMaxLines) {
    return { body: value };
  }

  const hiddenLineCount = lines.length - toolResultPreviewMaxLines;

  if (mode === 'tail') {
    return {
      body: `... (${hiddenLineCount} earlier lines)\n${lines.slice(-toolResultPreviewMaxLines).join('\n')}`,
      expandedBody: value
    };
  }

  return {
    body: `${lines.slice(0, toolResultPreviewMaxLines).join('\n')}\n... (${hiddenLineCount} more lines)`,
    expandedBody: value
  };
}

function compactText(value: string): string {
  return compactOneLine(value, 160);
}

function compactOneLine(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3)}...`;
}
