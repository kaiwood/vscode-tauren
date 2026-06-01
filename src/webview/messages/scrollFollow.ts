export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type ScrollFollowState = {
  followOutput: boolean;
  lastScrollTop: number;
  lastScrollHeight: number;
  lastClientHeight: number;
};

const scrollMovementTolerance = 1;

export function createScrollFollowState(): ScrollFollowState {
  return {
    followOutput: true,
    lastScrollTop: 0,
    lastScrollHeight: 0,
    lastClientHeight: 0
  };
}

export function isScrollAtBottom(metrics: ScrollMetrics, threshold: number): boolean {
  return getDistanceFromBottom(metrics) <= threshold;
}

function getDistanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

export function recordScrollMetrics(state: ScrollFollowState, metrics: ScrollMetrics): void {
  state.lastScrollTop = metrics.scrollTop;
  state.lastScrollHeight = metrics.scrollHeight;
  state.lastClientHeight = metrics.clientHeight;
}

export function updateScrollFollowStateForScroll(
  state: ScrollFollowState,
  metrics: ScrollMetrics,
  threshold: number
): void {
  if (isScrollAtBottom(metrics, threshold)) {
    state.followOutput = true;
    recordScrollMetrics(state, metrics);
    return;
  }

  if (metrics.scrollTop < state.lastScrollTop - scrollMovementTolerance) {
    state.followOutput = false;
  }

  recordScrollMetrics(state, metrics);
}
