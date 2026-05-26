export type VirtualSessionRange = {
  enabled: boolean;
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
};

export type VirtualSessionRangeOptions = {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  listTopOffset: number;
  itemHeight: number;
  overscan: number;
  threshold: number;
};

export function getVirtualSessionRange(options: VirtualSessionRangeOptions): VirtualSessionRange {
  const itemCount = Math.max(0, Math.floor(options.itemCount));

  if (itemCount <= Math.max(0, options.threshold)) {
    return {
      enabled: false,
      start: 0,
      end: itemCount,
      topPadding: 0,
      bottomPadding: 0
    };
  }

  const itemHeight = Math.max(1, options.itemHeight);
  const overscan = Math.max(0, Math.floor(options.overscan));
  const viewportHeight = Math.max(itemHeight, options.viewportHeight);
  const relativeScrollTop = Math.max(0, options.scrollTop - Math.max(0, options.listTopOffset));
  const visibleStart = Math.floor(relativeScrollTop / itemHeight);
  const visibleEnd = Math.ceil((relativeScrollTop + viewportHeight) / itemHeight);
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(itemCount, Math.max(start + 1, visibleEnd + overscan));

  return {
    enabled: true,
    start,
    end,
    topPadding: start * itemHeight,
    bottomPadding: Math.max(0, itemCount - end) * itemHeight
  };
}
