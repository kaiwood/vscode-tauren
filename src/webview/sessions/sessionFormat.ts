import type { SessionItem } from '../types';

export function getSessionDisplayName(session: SessionItem): string {
  const name = sanitizeSessionTitle(session.name);
  const firstMessage = sanitizeSessionTitle(session.firstMessage);
  return name || firstMessage || shortenPath(session.cwd) || 'Untitled session';
}

export function buildSessionTreePrefix(session: { depth?: number; ancestorContinues?: boolean[]; isLast?: boolean }): string {
  const depth = Number(session.depth) || 0;

  if (depth <= 0) {
    return '';
  }

  const ancestors = Array.isArray(session.ancestorContinues) ? session.ancestorContinues : [];
  const parts: string[] = ancestors.map((continues) => continues ? '│  ' : '   ');
  parts.push(session.isLast ? '└─ ' : '├─ ');
  return parts.join('');
}

export function formatSessionMeta(session: SessionItem): string {
  const count = typeof session.messageCount === 'number' ? session.messageCount : 0;
  const age = formatRelativeTime(session.modified);
  const cwd = shortenPath(session.cwd);
  const countLabel = count === 1 ? '1 message' : count + ' messages';
  return [countLabel, age, cwd].filter(Boolean).join(' · ');
}

export function shortenPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    return '';
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function sanitizeSessionTitle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/<\/?[A-Za-z][^>\n]*(?:>|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatRelativeTime(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return 'just now';
  }

  if (absMs < hour) {
    const minutes = Math.max(1, Math.round(absMs / minute));
    return minutes + 'm ago';
  }

  if (absMs < day) {
    const hours = Math.round(absMs / hour);
    return hours + 'h ago';
  }

  if (absMs < 7 * day) {
    const days = Math.round(absMs / day);
    return days + 'd ago';
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}
