import type { SessionItemCommand } from '../types';

export function createSessionEmptyElement(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'sessions__empty';
  empty.textContent = text;
  return empty;
}

export function getSessionListCommandForKey(key: string): SessionItemCommand | undefined {
  switch (key.toLowerCase()) {
    case 'r':
      return 'rename';
    case 'f':
      return 'fork';
    case 'c':
      return 'clone';
    case 'z':
      return 'compact';
    case 'e':
      return 'export';
    default:
      return undefined;
  }
}

export function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}
