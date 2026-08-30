import type { Activity } from '../types';

export function getFileActivityPath(activity: Activity): string | undefined {
  if (activity.kind !== 'tool_execution' || typeof activity.title !== 'string') {
    return undefined;
  }

  if (activity.title.startsWith('read ')) {
    return parseReadActivityPath(activity.title);
  }

  for (const prefix of ['edit ', 'write ']) {
    if (activity.title.startsWith(prefix)) {
      return activity.title.slice(prefix.length) || undefined;
    }
  }

  return undefined;
}

export function getReadActivityPath(activity: Activity): string | undefined {
  if (typeof activity.title !== 'string' || !activity.title.startsWith('read ')) {
    return undefined;
  }

  return getFileActivityPath(activity);
}

export function getBashActivityCommand(activity: Activity): string | undefined {
  if (activity.kind !== 'tool_execution'
    || typeof activity.title !== 'string'
    || !activity.title.startsWith('$')) {
    return undefined;
  }

  return typeof activity.command === 'string' && activity.command.length > 0
    ? activity.command
    : undefined;
}

function parseReadActivityPath(title: string): string | undefined {
  const match = title.match(/^read (.+?)(?::\d+(?:-\d+)?)?$/);
  return match?.[1];
}
