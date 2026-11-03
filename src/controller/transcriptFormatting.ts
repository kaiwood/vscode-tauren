import type { ChatActivityInput, ChatMessage, ChatTurnStats } from '../chat/chatSession';
import { formatToolExecutionActivity } from '../pi/eventMapper';
import { extractPiMessageImages, extractPiMessageText } from '../pi/messageContent';
import { formatCompactionSystemMessage } from '../sessions/sessionFormatting';
import type { AgentMessage, AgentTurnSummary } from '../agent/types';
import { isRecord } from './typeGuards';

type RestoredToolCall = {
  id: string;
  name?: string;
  args?: unknown;
};

export function formatAgentMessages(messages: AgentMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const transcript: ChatMessage[] = [];
  const toolCallsById = new Map<string, RestoredToolCall>();
  let lastAssistant: ChatMessage | undefined;
  let restoredActivitySequence = 0;
  let restoredCustomActivitySequence = 0;

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    if (message.role === 'user') {
      const text = extractPiMessageText(message.content);
      const images = extractPiMessageImages(message.content);

      if (text.trim() || images.length > 0) {
        transcript.push({ role: 'user', text, ...(images.length > 0 ? { images } : {}) });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls = extractRestoredToolCalls(message.content);

      for (const toolCall of toolCalls) {
        toolCallsById.set(toolCall.id, toolCall);
      }

      const text = extractPiMessageText(message.content);
      const images = extractPiMessageImages(message.content);
      const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage : '';
      const displayText = text || errorMessage;

      if (displayText.trim() || images.length > 0 || toolCalls.length > 0) {
        const turnSummary = normalizeTurnSummary(message.turnSummary);
        const chatMessage: ChatMessage = {
          role: 'assistant',
          text: displayText,
          ...(errorMessage ? { error: true } : {}),
          ...(images.length > 0 ? { images } : {}),
          ...(turnSummary ? { turnStats: formatTurnStats(turnSummary) } : {})
        };
        transcript.push(chatMessage);
        lastAssistant = chatMessage;
      } else {
        lastAssistant = undefined;
      }

      continue;
    }

    if (message.role === 'toolResult') {
      const activity = formatRestoredToolResultActivity(message, toolCallsById);

      if (activity) {
        const target = lastAssistant ?? createRestoredToolAssistantMessage(transcript);
        restoredActivitySequence += 1;
        target.activities ??= [];
        target.activities.push({
          id: `restored-tool-${restoredActivitySequence}`,
          ...activity
        });
        lastAssistant = target;
      }

      continue;
    }

    if (message.role === 'compactionSummary') {
      const summary = typeof message.summary === 'string' ? message.summary : '';
      const tokensBefore = typeof message.tokensBefore === 'number' ? message.tokensBefore : undefined;
      const estimatedTokensAfter = typeof message.estimatedTokensAfter === 'number' ? message.estimatedTokensAfter : undefined;

      if (summary.trim() || tokensBefore !== undefined) {
        transcript.push({
          role: 'system',
          text: formatCompactionSystemMessage(summary, tokensBefore, estimatedTokensAfter),
          variant: 'compactionSummary'
        });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'branchSummary') {
      const summary = typeof message.summary === 'string' ? message.summary : '';

      if (summary.trim()) {
        transcript.push({ role: 'system', text: `Returned from branch.\n\n${summary}`, variant: 'branchSummary' });
      }

      lastAssistant = undefined;
      continue;
    }

    if (message.role === 'custom') {
      const rendered = message.taurenRenderedMessage;

      if (isRenderedContent(rendered)) {
        restoredCustomActivitySequence += 1;
        transcript.push({
          role: 'system',
          text: '',
          activities: [{
            id: `restored-custom-${restoredCustomActivitySequence}`,
            kind: 'message',
            title: typeof message.customType === 'string' ? message.customType : 'Extension message',
            status: 'info',
            body: rendered.body,
            ...(typeof rendered.expandedBody === 'string' ? { expandedBody: rendered.expandedBody } : {}),
            code: typeof rendered.code === 'boolean' ? rendered.code : true
          }]
        });
        lastAssistant = undefined;
        continue;
      }

      const displayText = typeof message.display === 'string'
        ? message.display
        : extractPiMessageText(message.content);
      const images = extractPiMessageImages(message.content);

      if (displayText.trim() || images.length > 0) {
        transcript.push({ role: 'system', text: displayText, ...(images.length > 0 ? { images } : {}) });
      }

      lastAssistant = undefined;
    }
  }

  return transcript;
}

export function formatTurnStats(summary: AgentTurnSummary): ChatTurnStats {
  return {
    ...(typeof summary.elapsedMs === 'number' && summary.elapsedMs >= 0 ? { elapsedMs: summary.elapsedMs } : {}),
    ...(typeof summary.usage?.total_tokens === 'number' && summary.usage.total_tokens >= 0
      ? { totalTokens: summary.usage.total_tokens }
      : {})
  };
}

function normalizeTurnSummary(value: unknown): AgentTurnSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage = isRecord(value.usage) ? value.usage : undefined;
  return {
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    ...(typeof value.elapsedMs === 'number' ? { elapsedMs: value.elapsedMs } : {}),
    ...(typeof value.modelRequests === 'number' ? { modelRequests: value.modelRequests } : {}),
    ...(typeof value.toolCalls === 'number' ? { toolCalls: value.toolCalls } : {}),
    ...(typeof value.usageStatus === 'string' ? { usageStatus: value.usageStatus } : {}),
    ...(usage ? { usage: {
      ...(typeof usage.input_tokens === 'number' ? { input_tokens: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === 'number' ? { output_tokens: usage.output_tokens } : {}),
      ...(typeof usage.total_tokens === 'number' ? { total_tokens: usage.total_tokens } : {}),
      ...(typeof usage.cache_read_tokens === 'number' ? { cache_read_tokens: usage.cache_read_tokens } : {}),
      ...(typeof usage.cache_write_tokens === 'number' ? { cache_write_tokens: usage.cache_write_tokens } : {}),
      ...(typeof usage.estimated === 'boolean' ? { estimated: usage.estimated } : {})
    } } : value.usage === null ? { usage: null } : {})
  };
}

function isRenderedContent(value: unknown): value is { body: string; expandedBody?: unknown; code?: unknown } {
  return isRecord(value) && typeof value.body === 'string';
}

function extractRestoredToolCalls(content: unknown): RestoredToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((item): RestoredToolCall[] => {
    if (!isRecord(item) || item.type !== 'toolCall') {
      return [];
    }

    const id = typeof item.id === 'string' ? item.id : '';

    if (!id) {
      return [];
    }

    return [{
      id,
      name: typeof item.name === 'string' ? item.name : undefined,
      args: item.arguments ?? item.args
    }];
  });
}

function formatRestoredToolResultActivity(
  message: AgentMessage,
  toolCallsById: Map<string, RestoredToolCall>
): ChatActivityInput | undefined {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  const restoredToolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
  const toolName = typeof message.toolName === 'string'
    ? message.toolName
    : restoredToolCall?.name;
  const result = { content: message.content, details: message.details };

  if (!toolName && message.content === undefined) {
    return undefined;
  }

  return formatToolExecutionActivity({
    toolName,
    args: restoredToolCall?.args,
    result,
    status: message.isError === true ? 'error' : 'completed'
  });
}

function createRestoredToolAssistantMessage(transcript: ChatMessage[]): ChatMessage {
  const message: ChatMessage = { role: 'assistant', text: '' };
  transcript.push(message);
  return message;
}
