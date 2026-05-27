export type ThinkingLevelStepDirection = 'raise' | 'lower';

export const thinkingLevelOrder = ['off', 'low', 'medium', 'high', 'xhigh'] as const;

export function getSteppedThinkingLevel(
  currentLevel: string,
  direction: ThinkingLevelStepDirection
): string | undefined {
  const currentIndex = thinkingLevelOrder.indexOf(currentLevel as typeof thinkingLevelOrder[number]);

  if (currentIndex === -1) {
    return undefined;
  }

  const nextIndex = direction === 'raise' ? currentIndex + 1 : currentIndex - 1;

  if (nextIndex < 0 || nextIndex >= thinkingLevelOrder.length) {
    return undefined;
  }

  return thinkingLevelOrder[nextIndex];
}
