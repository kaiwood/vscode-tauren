export function roundDevicePixelMetric(value: number): number {
  const devicePixelRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.max(1 / devicePixelRatio, Math.round(value * devicePixelRatio) / devicePixelRatio);
}
