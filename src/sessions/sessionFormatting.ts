import type { WebviewSessionItem } from '../webviewProtocol/types';
import type { PiForkMessage, PiSessionState, PiSessionStats } from '../rpc/types';
import { formatContextUsage, formatInteger } from '../metadata/sessionMetadata';

export type ForkMessageOption = {
  entryId: string;
  text: string;
};

export function getSessionFile(state: { sessionFile?: string }): string | undefined {
  return typeof state.sessionFile === 'string' && state.sessionFile
    ? state.sessionFile
    : undefined;
}

export function normalizeSessionPath(sessionPath: string | undefined): string {
  return typeof sessionPath === 'string' ? sessionPath.replace(/\\/g, '/') : '';
}

export function createFallbackSessionItem(sessionPath: string): WebviewSessionItem {
  return {
    path: sessionPath,
    id: sessionPath.split(/[\\/]/).pop()?.trim() || sessionPath,
    cwd: '',
    created: '',
    modified: '',
    messageCount: 0,
    firstMessage: '',
    depth: 0,
    isLast: true,
    ancestorContinues: [],
    current: false
  };
}

export function getSessionDisplayName(session: WebviewSessionItem | undefined, fallbackPath: string): string {
  const name = session?.name?.trim() || session?.firstMessage?.trim() || session?.id?.trim();

  if (name) {
    return name.length > 80 ? name.slice(0, 77) + '...' : name;
  }

  const fileName = fallbackPath.split(/[\\/]/).pop()?.trim();
  return fileName || 'session';
}

export function formatForkMessages(messages: PiForkMessage[] | undefined): ForkMessageOption[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    const entryId = typeof message.entryId === 'string' ? message.entryId : '';
    const text = typeof message.text === 'string'
      ? message.text.trim()
      : '';

    return entryId && text ? [{ entryId, text }] : [];
  });
}

export function formatForkMessageLabel(message: ForkMessageOption, index: number): string {
  return `${index + 1}. ${truncateOneLine(message.text, 120)}`;
}

export function formatCompactionTitle(tokensBefore: number | undefined): string {
  return typeof tokensBefore === 'number' && Number.isFinite(tokensBefore)
    ? `Compacted ${formatInteger(tokensBefore)} tokens`
    : 'Compacted session context';
}

export function formatCompactionSystemMessage(summary: string, tokensBefore: number | undefined): string {
  return `${formatCompactionTitle(tokensBefore)}.${summary ? `\n\n${summary}` : ''}`;
}

export function formatSessionInfo(state: PiSessionState, stats: PiSessionStats): string {
  const lines = ['Session'];
  const sessionName = state.sessionName ?? stats.sessionName;
  const sessionId = state.sessionId ?? stats.sessionId;
  const sessionFile = state.sessionFile ?? stats.sessionFile;

  if (sessionName) {
    lines.push(`Name: ${sessionName}`);
  }

  if (sessionId) {
    lines.push(`ID: ${sessionId}`);
  }

  if (sessionFile) {
    lines.push(`File: ${sessionFile}`);
  }

  if (typeof state.messageCount === 'number') {
    lines.push(`Messages: ${formatInteger(state.messageCount)}`);
  } else if (typeof stats.totalMessages === 'number') {
    lines.push(`Messages: ${formatInteger(stats.totalMessages)}`);
  }

  if (typeof stats.toolCalls === 'number') {
    lines.push(`Tool calls: ${formatInteger(stats.toolCalls)}`);
  }

  if (typeof stats.cost === 'number') {
    lines.push(`Cost: $${stats.cost.toFixed(4)}`);
  }

  const contextUsage = formatContextUsage(stats);

  if (contextUsage.label) {
    lines.push(`Context used: ${contextUsage.label}`);
  }

  return lines.join('\n');
}

function truncateOneLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}
