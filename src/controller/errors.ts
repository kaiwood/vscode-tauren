import type { PiEvent } from '../pi/types';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isUnsupportedReloadCommandError(error: unknown): boolean {
  return /unknown command:?\s+reload/i.test(getErrorMessage(error));
}

export function isAbortMessage(message: string): boolean {
  return message.trim().toLowerCase() === 'aborted';
}

export function isMessageUpdateStart(event: PiEvent): boolean {
  const assistantMessageEvent = event.assistantMessageEvent;

  return typeof assistantMessageEvent === 'object'
    && assistantMessageEvent !== null
    && 'type' in assistantMessageEvent
    && assistantMessageEvent.type === 'start';
}
