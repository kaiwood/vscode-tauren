import type { AgentEvent } from '../agent/types';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isUnsupportedReloadCommandError(error: unknown): boolean {
  return /unknown command:?\s+reload/i.test(getErrorMessage(error));
}

export function isStaleKwardSessionRequestError(error: unknown): boolean {
  return isObject(error) && error.name === 'StaleKwardSessionRequestError';
}

export type MissingSessionCwdIssueLike = {
  sessionCwd: string;
  fallbackCwd: string;
};

export function isMissingSessionCwdError(error: unknown): error is { issue: MissingSessionCwdIssueLike } {
  if (!isObject(error) || error.name !== 'MissingSessionCwdError') {
    return false;
  }

  const issue = error.issue;

  return isObject(issue)
    && typeof issue.sessionCwd === 'string'
    && typeof issue.fallbackCwd === 'string';
}

export function isSessionImportFileNotFoundError(error: unknown): boolean {
  return isObject(error) && error.name === 'SessionImportFileNotFoundError';
}

export function isAbortMessage(message: string): boolean {
  return message.trim().toLowerCase() === 'aborted';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isMessageUpdateStart(event: AgentEvent): boolean {
  const assistantMessageEvent = event.assistantMessageEvent;

  return typeof assistantMessageEvent === 'object'
    && assistantMessageEvent !== null
    && 'type' in assistantMessageEvent
    && assistantMessageEvent.type === 'start';
}
