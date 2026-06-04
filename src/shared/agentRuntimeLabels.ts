export function getAgentRuntimeLabel(backend: unknown): string {
  return backend === 'kward' ? 'Kward' : 'Pi engine';
}

export function getAgentRuntimeWorkingText(backend: unknown, options: { ellipsis?: boolean } = {}): string {
  return `${getAgentRuntimeLabel(backend)} is working${options.ellipsis ? '...' : ''}`;
}
