import type { PiEvent } from '../pi/types';
import { isRecord } from '../shared/typeGuards';
import type { KwardTurnEvent } from './types';

export function mapKwardTurnEvent(event: KwardTurnEvent): PiEvent | undefined {
  const payload = isRecord(event.payload) ? event.payload : {};
  const turnId = typeof event.turnId === 'string' ? event.turnId : undefined;

  switch (event.type) {
    case 'turnStarted':
      return { type: 'agent_start', ...(turnId ? { turnId } : {}) };
    case 'assistantDelta':
      return {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: getString(payload, 'delta') ?? ''
        }
      };
    case 'reasoningDelta':
      return {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: getString(payload, 'delta') ?? ''
        }
      };
    case 'toolCall':
      return mapKwardToolEvent(payload, 'tool_execution_start');
    case 'toolResult':
      return mapKwardToolEvent(payload, 'tool_execution_end');
    case 'compactionStart':
      return { type: 'compaction_start' };
    case 'compactionEnd':
      return {
        type: 'compaction_end',
        result: isRecord(payload.result) ? payload.result : undefined,
        aborted: getBoolean(payload, 'aborted'),
        willRetry: getBoolean(payload, 'willRetry'),
        errorMessage: getString(payload, 'errorMessage') ?? undefined
      };
    case 'error':
      return {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'error',
          error: getString(payload, 'message') ?? getString(payload, 'error') ?? 'Kward reported an error while responding.'
        }
      };
    case 'turnFinished':
      return { type: 'agent_end', ...(getString(payload, 'status') === 'canceled' ? { aborted: true } : {}) };
    default:
      return undefined;
  }
}

function mapKwardToolEvent(payload: Record<string, unknown>, type: 'tool_execution_start' | 'tool_execution_end'): PiEvent {
  const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
  const tool = isRecord(payload.tool) ? payload.tool : undefined;
  const toolCallId = getString(payload, 'toolCallId') ?? getString(toolCall, 'id') ?? getString(toolCall, 'tool_call_id') ?? getString(toolCall, 'callId');
  const toolName = getString(payload, 'toolName') ?? normalizeToolName(getString(toolCall, 'name') ?? getNestedFunctionName(toolCall), getString(tool, 'kind'));
  const args = isRecord(payload.args) ? payload.args : normalizeToolArgs(tool, toolCall);
  const payloadResult = isRecord(payload.result) ? payload.result : undefined;
  const result = type === 'tool_execution_end'
    ? payloadResult ?? { content: payload.content, ...(tool ? { details: { tool } } : {}) }
    : undefined;
  const isError = type === 'tool_execution_end' && isRecord(result) && typeof result.isError === 'boolean'
    ? result.isError
    : undefined;

  return {
    type,
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(args ? { args } : {}),
    ...(result ? { result } : {}),
    ...(isError !== undefined ? { isError } : {})
  };
}

function getNestedFunctionName(toolCall: Record<string, unknown> | undefined): string | undefined {
  const fn = isRecord(toolCall?.function) ? toolCall.function : undefined;
  return getString(fn, 'name');
}

function normalizeToolName(name: string | undefined, kind: string | undefined): string | undefined {
  if (kind === 'edit') {
    return 'edit';
  }

  if (kind === 'write') {
    return 'write';
  }

  if (kind === 'shell') {
    return 'bash';
  }

  switch (name) {
    case 'edit_file':
      return 'edit';
    case 'write_file':
      return 'write';
    case 'run_shell_command':
      return 'bash';
    default:
      return name;
  }
}

function normalizeToolArgs(tool: Record<string, unknown> | undefined, toolCall: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (tool) {
    const kind = getString(tool, 'kind');

    if (kind === 'edit') {
      return {
        path: getString(tool, 'path') ?? '',
        edits: Array.isArray(tool.edits) ? tool.edits : buildSingleEdit(tool)
      };
    }

    if (kind === 'write') {
      return { path: getString(tool, 'path') ?? '' };
    }

    if (kind === 'shell') {
      return { command: getString(tool, 'command') ?? '' };
    }
  }

  const rawArgs = toolCall?.arguments ?? toolCall?.args;
  return isRecord(rawArgs) ? rawArgs : undefined;
}

function buildSingleEdit(tool: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  const oldText = getString(tool, 'oldText');
  const newText = getString(tool, 'newText');
  return oldText === undefined || newText === undefined ? [] : [{ oldText, newText }];
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : undefined;
}
