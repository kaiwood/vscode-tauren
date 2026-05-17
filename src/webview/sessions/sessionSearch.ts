import { getSessionDisplayName } from './sessionFormat';
import type { SessionItem } from '../types';

export function getVisibleSessionIndexes(sessions: readonly SessionItem[], query: string): number[] {
  if (sessions.length === 0) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return sessions.map((_, index) => index);
  }

  const indexes: number[] = [];

  for (let index = 0; index < sessions.length; index += 1) {
    if (getSessionDisplayName(sessions[index]).toLowerCase().includes(normalizedQuery)) {
      indexes.push(index);
    }
  }

  return indexes;
}

export function ensureVisibleSessionSelection(selectedIndex: number, visibleIndexes: readonly number[]): number {
  if (visibleIndexes.length === 0) {
    return 0;
  }

  return visibleIndexes.includes(selectedIndex) ? selectedIndex : visibleIndexes[0];
}

export function moveVisibleSessionSelection(
  selectedIndex: number,
  visibleIndexes: readonly number[],
  delta: number
): number | undefined {
  if (visibleIndexes.length === 0) {
    return undefined;
  }

  const currentPosition = visibleIndexes.indexOf(selectedIndex);
  const nextPosition = currentPosition >= 0
    ? Math.max(0, Math.min(currentPosition + delta, visibleIndexes.length - 1))
    : (delta > 0 ? 0 : visibleIndexes.length - 1);

  return visibleIndexes[nextPosition];
}
