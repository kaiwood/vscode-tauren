import { getSessionDisplayName } from './sessionFormat';
import type { SessionItem } from '../types';

export type SessionVisibilityFilter = {
  namedOnly?: boolean;
};

export function getVisibleSessionIndexes(
  sessions: readonly SessionItem[],
  query: string,
  filter: SessionVisibilityFilter = {}
): number[] {
  if (sessions.length === 0) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const indexes: number[] = [];

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];

    if (filter.namedOnly && !session.name?.trim()) {
      continue;
    }

    if (normalizedQuery && !getSessionDisplayName(session).toLowerCase().includes(normalizedQuery)) {
      continue;
    }

    indexes.push(index);
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
