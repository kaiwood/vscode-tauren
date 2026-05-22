import type { ChatSession } from '../chat/chatSession';
import {
  formatExtensionError,
  mapMessageUpdate,
  mapPiActivity,
  type ActivityAddAction,
  type ActivityRemoveAction,
  type ActivityUpdateAction
} from '../pi/eventMapper';
import type { PiEvent } from '../pi/types';
import { isAbortMessage, isMessageUpdateStart } from './errors';
import { getRecordString, isRecord } from './typeGuards';

type LiveToolCall = {
  id: string;
  name?: string;
  args?: unknown;
};

export type PiEventHandlerOptions = {
  session: ChatSession;
  postState: () => void;
  scheduleState: () => void;
  refreshSessionDiffStats: () => void;
  addToolExecution: (event: PiEvent) => void;
  armQueuedReadyScriptRun: () => void;
  runReadyScriptAfterAgentEnd: () => void;
  refreshMetadataAfterAgentEnd: () => void;
  isAbortRequested: () => boolean;
  appendAbortNoticeIfNeeded: () => void;
  resetAbortState: () => void;
};

export class PiEventHandler {
  private assistantStreamId = 0;
  private readonly liveToolCallsById = new Map<string, LiveToolCall>();

  public constructor(private readonly options: PiEventHandlerOptions) {}

  public reset(): void {
    this.assistantStreamId = 0;
    this.liveToolCallsById.clear();
  }

  public clearLiveToolCalls(): void {
    this.liveToolCallsById.clear();
  }

  public handleEvent(event: PiEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.options.armQueuedReadyScriptRun();
        this.options.session.handleAgentStart();
        this.options.refreshSessionDiffStats();
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'message_update':
        this.handleMessageUpdate(event);
        break;
      case 'agent_end':
        this.applyPiActivity(event);
        this.options.appendAbortNoticeIfNeeded();
        this.options.session.handleAgentEnd();
        this.options.resetAbortState();
        this.options.runReadyScriptAfterAgentEnd();
        this.options.refreshSessionDiffStats();
        this.options.postState();
        this.options.refreshMetadataAfterAgentEnd();
        break;
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
      case 'message_end':
      case 'tool_execution_start':
      case 'tool_execution_update':
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'tool_execution_end':
        this.applyPiActivity(event);
        this.options.addToolExecution(this.enrichLiveToolExecutionEvent(event));
        this.options.postState();
        break;
      case 'queue_update':
      case 'compaction_start':
      case 'compaction_end':
      case 'auto_retry_start':
      case 'auto_retry_end':
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'extension_error':
        this.applyPiActivity(event);
        this.options.session.addErrorMessage(formatExtensionError(event));
        this.options.postState();
        break;
      case 'prompt_handled':
        this.options.session.completeActivePrompt();
        this.options.postState();
        break;
      default:
        this.applyPiActivity(event);
        this.options.postState();
        break;
    }
  }

  private handleMessageUpdate(event: PiEvent): void {
    this.rememberLiveToolCall(event);

    const action = mapMessageUpdate(event, this.getMessageUpdateStreamId(event), {
      fullCommunication: false
    });

    if (action.type === 'text_delta') {
      if (this.options.session.appendAssistantDelta(action.delta)) {
        this.options.scheduleState();
      }

      return;
    }

    if (action.type === 'thinking_start') {
      if (this.options.session.startThinking(action.sourceId)) {
        this.options.postState();
      }

      return;
    }

    if (action.type === 'thinking_delta') {
      if (this.options.session.appendThinkingDelta(action.sourceId, action.delta)) {
        this.options.scheduleState();
      }

      return;
    }

    if (action.type === 'thinking_end') {
      if (this.options.session.finishThinking(action.sourceId, action.content)) {
        this.options.postState();
      }

      return;
    }

    if (action.type === 'assistant_error') {
      if (this.options.isAbortRequested() && isAbortMessage(action.message)) {
        this.options.appendAbortNoticeIfNeeded();
      } else {
        this.options.session.markActiveAssistantError(action.message);
      }

      this.options.postState();
      return;
    }

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);

      if (action.type === 'activity_update' && action.bodyMode === 'append') {
        this.options.scheduleState();
      } else {
        this.options.postState();
      }
    }
  }

  private applyPiActivity(event: PiEvent): void {
    if (!this.options.session.isBusy && event.type !== 'agent_start') {
      return;
    }

    const action = mapPiActivity(this.enrichLiveToolExecutionEvent(event), {
      fullCommunication: false
    });

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action);
    }
  }

  private applyActivityAction(action: ActivityUpdateAction | ActivityAddAction | ActivityRemoveAction): void {
    if (action.type === 'activity_update') {
      this.options.session.upsertActivity(action.sourceId, action.activity, action.bodyMode);
      return;
    }

    if (action.type === 'activity_remove') {
      this.options.session.removeActivity(action.sourceId);
      return;
    }

    this.options.session.addActivity(action.activity);
  }

  private rememberLiveToolCall(event: PiEvent): void {
    const assistantMessageEvent = event.assistantMessageEvent;

    if (!isRecord(assistantMessageEvent) || assistantMessageEvent.type !== 'toolcall_end') {
      return;
    }

    const toolCall = isRecord(assistantMessageEvent.toolCall) ? assistantMessageEvent.toolCall : undefined;
    const id = toolCall
      ? getRecordString(toolCall, 'id') ?? getRecordString(toolCall, 'toolCallId')
      : undefined;

    if (!id) {
      return;
    }

    this.liveToolCallsById.set(id, {
      id,
      name: toolCall ? getRecordString(toolCall, 'name') : undefined,
      args: toolCall?.arguments ?? toolCall?.args
    });
  }

  private enrichLiveToolExecutionEvent(event: PiEvent): PiEvent {
    if (
      event.type !== 'tool_execution_start'
      && event.type !== 'tool_execution_update'
      && event.type !== 'tool_execution_end'
    ) {
      return event;
    }

    const toolCallId = getRecordString(event, 'toolCallId');
    const toolCall = toolCallId ? this.liveToolCallsById.get(toolCallId) : undefined;

    if (!toolCall) {
      return event;
    }

    return {
      ...event,
      toolName: getRecordString(event, 'toolName') ?? toolCall.name,
      args: event.args ?? toolCall.args
    };
  }

  private getMessageUpdateStreamId(event: PiEvent): number {
    if (isMessageUpdateStart(event)) {
      this.assistantStreamId += 1;
    }

    return this.assistantStreamId;
  }
}
