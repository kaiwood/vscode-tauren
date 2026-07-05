const int16Min = -32768;
const int16Max = 32767;

export function calculatePcm16Dbfs(buffer: Buffer): number {
  if (buffer.length < 2) {
    return Number.NEGATIVE_INFINITY;
  }

  let squareSum = 0;
  const sampleCount = Math.floor(buffer.length / 2);

  for (let offset = 0; offset < sampleCount * 2; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const normalized = sample / (sample < 0 ? Math.abs(int16Min) : int16Max);
    squareSum += normalized * normalized;
  }

  const rms = Math.sqrt(squareSum / sampleCount);
  if (rms <= 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return 20 * Math.log10(rms);
}

export function isSpeechLevel(dbfs: number, thresholdDbfs: number): boolean {
  return Number.isFinite(dbfs) && dbfs >= thresholdDbfs;
}
