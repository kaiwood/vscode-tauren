import * as fs from 'node:fs/promises';

const wavHeaderBytes = 44;

export async function writePcm16Wav(file: string, chunks: Buffer[], sampleRate: number, channels: number): Promise<void> {
  const dataSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = createWavHeader(dataSize, sampleRate, channels);
  await fs.writeFile(file, Buffer.concat([header, ...chunks], wavHeaderBytes + dataSize));
}

function createWavHeader(dataSize: number, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(wavHeaderBytes);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}
