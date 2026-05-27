import type { ChatActivityInput, ChatSession } from '../chat/chatSession';
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

const bashUpdateThrottleMs = 500;

export type PiEventHandlerOptions = {
  session: ChatSession;
  postState: () => void;
  scheduleState: () => void;
  isActiveSession?: () => boolean;
  refreshSessionDiffStats: () => void;
  refreshContextUsage: () => void;
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
  private agentActive = false;
  private autoRetryActive = false;
  private compactionActive = false;
  private waitingForAgentRestartAfterCompaction = false;
  private waitingForAutoRetryStart = false;
  private readyScriptTimer: ReturnType<typeof setImmediate> | undefined;
  private bashUpdatePostTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBashUpdatePostAt = 0;
  private readonly liveToolCallsById = new Map<string, LiveToolCall>();

  public constructor(private readonly options: PiEventHandlerOptions) {}

  public reset(): void {
    this.clearReadyScriptTimer();
    this.clearBashUpdatePostTimer();
    this.lastBashUpdatePostAt = 0;
    this.assistantStreamId = 0;
    this.agentActive = false;
    this.autoRetryActive = false;
    this.compactionActive = false;
    this.waitingForAgentRestartAfterCompaction = false;
    this.waitingForAutoRetryStart = false;
    this.liveToolCallsById.clear();
  }

  public clearLiveToolCalls(): void {
    this.liveToolCallsById.clear();
  }

  public dispose(): void {
    this.clearReadyScriptTimer();
    this.clearBashUpdatePostTimer();
  }

  public handleEvent(event: PiEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.clearReadyScriptTimer();
        this.agentActive = true;
        this.waitingForAgentRestartAfterCompaction = false;
        this.waitingForAutoRetryStart = false;
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
        this.agentActive = false;
        this.applyPiActivity(event);
        this.options.appendAbortNoticeIfNeeded();
        this.options.session.handleAgentEnd();
        this.options.resetAbortState();
        if (event.willRetry === true) {
          this.waitingForAutoRetryStart = true;
          this.options.session.setBusy(true);
        }
        this.options.refreshSessionDiffStats();
        this.options.postState();
        this.scheduleReadyScriptWhenPiIdle();
        break;
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'message_end':
        if (this.handleCustomMessageEnd(event)) {
          this.options.refreshContextUsage();
          this.options.postState();
          break;
        }

        this.applyPiActivity(event);
        this.options.refreshContextUsage();
        this.options.postState();
        break;
      case 'tool_execution_start':
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'tool_execution_update':
        this.handleToolExecutionUpdate(event);
        break;
      case 'tool_execution_end':
        this.clearBashUpdatePostTimer();
        this.applyPiActivity(event);
        this.options.addToolExecution(this.enrichLiveToolExecutionEvent(event));
        this.options.postState();
        break;
      case 'queue_update':
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'compaction_start':
        this.clearReadyScriptTimer();
        this.compactionActive = true;
        this.options.session.setBusy(true);
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'compaction_end':
        this.compactionActive = false;
        this.waitingForAgentRestartAfterCompaction = event.willRetry === true;
        if (this.waitingForAgentRestartAfterCompaction) {
          this.options.session.setBusy(true);
        }
        this.applyPiActivity(event);
        this.options.refreshContextUsage();
        this.options.postState();
        this.scheduleReadyScriptWhenPiIdle();
        break;
      case 'auto_retry_start':
        this.clearReadyScriptTimer();
        this.waitingForAutoRetryStart = false;
        this.autoRetryActive = true;
        this.options.session.setBusy(true);
        this.applyPiActivity(event);
        this.options.postState();
        break;
      case 'auto_retry_end':
        this.autoRetryActive = false;
        this.applyPiActivity(event);
        this.options.postState();
        this.scheduleReadyScriptWhenPiIdle();
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

  private handleCustomMessageEnd(event: PiEvent): boolean {
    const message = isRecord(event.message) ? event.message : undefined;

    if (!message || message.role !== 'custom') {
      return false;
    }

    const rendered = isRecord(message.taurenRenderedMessage) ? message.taurenRenderedMessage : undefined;

    if (rendered) {
      const body = getRecordString(rendered, 'body');

      if (body) {
        this.options.session.addSystemMessage('', [{
          kind: 'message',
          title: getRecordString(message, 'customType') ?? 'Extension message',
          status: 'info',
          body,
          ...(getRecordString(rendered, 'expandedBody') ? { expandedBody: getRecordString(rendered, 'expandedBody') } : {}),
          code: rendered.code === false ? false : true
        }]);
        return true;
      }
    }

    const display = typeof message.display === 'string'
      ? message.display
      : typeof message.content === 'string'
        ? message.content
        : '';

    if (display.trim()) {
      this.options.session.addSystemMessage(display);
      return true;
    }

    return false;
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

  private handleToolExecutionUpdate(event: PiEvent): void {
    const enrichedEvent = this.enrichLiveToolExecutionEvent(event);

    if (!this.isBashToolExecutionEvent(enrichedEvent)) {
      this.applyPiActivity(enrichedEvent);
      this.options.postState();
      return;
    }

    const active = this.options.isActiveSession?.() ?? true;
    this.applyPiActivity(enrichedEvent, { omitBody: !active });

    if (active) {
      this.postThrottledBashUpdate();
    }
  }

  private postThrottledBashUpdate(): void {
    const now = Date.now();
    const elapsed = now - this.lastBashUpdatePostAt;

    if (elapsed >= bashUpdateThrottleMs) {
      this.clearBashUpdatePostTimer();
      this.lastBashUpdatePostAt = now;
      this.options.postState();
      return;
    }

    if (this.bashUpdatePostTimer) {
      return;
    }

    this.bashUpdatePostTimer = setTimeout(() => {
      this.bashUpdatePostTimer = undefined;
      this.lastBashUpdatePostAt = Date.now();
      this.options.postState();
    }, bashUpdateThrottleMs - elapsed);

    if (typeof this.bashUpdatePostTimer === 'object' && typeof this.bashUpdatePostTimer.unref === 'function') {
      this.bashUpdatePostTimer.unref();
    }
  }

  private clearBashUpdatePostTimer(): void {
    if (!this.bashUpdatePostTimer) {
      return;
    }

    clearTimeout(this.bashUpdatePostTimer);
    this.bashUpdatePostTimer = undefined;
  }

  private scheduleReadyScriptWhenPiIdle(): void {
    this.clearReadyScriptTimer();

    const timer = setImmediate(() => {
      this.readyScriptTimer = undefined;
      this.finishPiWorkIfIdle();
    });

    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }

    this.readyScriptTimer = timer;
  }

  private clearReadyScriptTimer(): void {
    if (!this.readyScriptTimer) {
      return;
    }

    clearImmediate(this.readyScriptTimer);
    this.readyScriptTimer = undefined;
  }

  private finishPiWorkIfIdle(): void {
    if (this.isPiWorkPending()) {
      return;
    }

    this.options.session.handleAgentEnd();
    this.options.runReadyScriptAfterAgentEnd();
    this.options.postState();
    this.options.refreshMetadataAfterAgentEnd();
  }

  private isPiWorkPending(): boolean {
    return this.agentActive
      || this.autoRetryActive
      || this.compactionActive
      || this.waitingForAgentRestartAfterCompaction
      || this.waitingForAutoRetryStart;
  }

  private applyPiActivity(event: PiEvent, options: { omitBody?: boolean } = {}): void {
    if (!this.options.session.isBusy && event.type !== 'agent_start') {
      return;
    }

    const action = mapPiActivity(this.enrichLiveToolExecutionEvent(event), {
      fullCommunication: false
    });

    if (action.type === 'activity_update' || action.type === 'activity_add' || action.type === 'activity_remove') {
      this.applyActivityAction(action.type === 'activity_update' && options.omitBody
        ? { ...action, activity: omitActivityBody(action.activity) }
        : action);
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

  private isBashToolExecutionEvent(event: PiEvent): boolean {
    return event.type === 'tool_execution_update' && getRecordString(event, 'toolName') === 'bash';
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

function omitActivityBody(activity: ChatActivityInput): ChatActivityInput {
  const { body: _body, expandedBody: _expandedBody, code: _code, images: _images, ...statusOnly } = activity;
  return statusOnly;
}
