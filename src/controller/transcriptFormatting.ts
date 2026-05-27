import type { ChatActivityInput, ChatMessage } from '../chat/chatSession';
import { formatToolExecutionActivity } from '../pi/eventMapper';
import { extractPiMessageImages, extractPiMessageText } from '../pi/messageContent';
import { formatCompactionSystemMessage } from '../sessions/sessionFormatting';
import type { PiAgentMessage } from '../pi/types';
import { isRecord } from './typeGuards';

export type RestoredToolCall = {
  id: string;
  name?: string;
  args?: unknown;
};

export function formatAgentMessages(messages: PiAgentMessage[] | undefined): ChatMessage[] {
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
        const chatMessage: ChatMessage = {
          role: 'assistant',
          text: displayText,
          ...(errorMessage ? { error: true } : {}),
          ...(images.length > 0 ? { images } : {})
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

      if (summary.trim() || tokensBefore !== undefined) {
        transcript.push({ role: 'system', text: formatCompactionSystemMessage(summary, tokensBefore), variant: 'compactionSummary' });
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

      if (rendered) {
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
            ...(rendered.expandedBody ? { expandedBody: rendered.expandedBody } : {}),
            code: rendered.code ?? true
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

export function extractRestoredToolCalls(content: unknown): RestoredToolCall[] {
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

export function formatRestoredToolResultActivity(
  message: PiAgentMessage,
  toolCallsById: Map<string, RestoredToolCall>
): ChatActivityInput | undefined {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  const restoredToolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
  const toolName = typeof message.toolName === 'string'
    ? message.toolName
    : restoredToolCall?.name;
  const result = { content: message.content };

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

export function createRestoredToolAssistantMessage(transcript: ChatMessage[]): ChatMessage {
  const message: ChatMessage = { role: 'assistant', text: '' };
  transcript.push(message);
  return message;
}
