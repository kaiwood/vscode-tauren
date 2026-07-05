import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { calculatePcm16Dbfs, isSpeechLevel } from '../../voice/audioLevel';
import { writePcm16Wav } from '../../voice/wavWriter';

suite('voice audio helpers', () => {
  test('calculates silence as negative infinity', () => {
    const silence = Buffer.alloc(320);

    assert.strictEqual(calculatePcm16Dbfs(silence), Number.NEGATIVE_INFINITY);
    assert.strictEqual(isSpeechLevel(calculatePcm16Dbfs(silence), -35), false);
  });

  test('calculates full-scale PCM near 0 dBFS', () => {
    const samples = Buffer.alloc(320);
    for (let offset = 0; offset < samples.length; offset += 2) {
      samples.writeInt16LE(32767, offset);
    }

    assert.ok(calculatePcm16Dbfs(samples) > -0.01);
    assert.strictEqual(isSpeechLevel(calculatePcm16Dbfs(samples), -35), true);
  });

  test('writes a valid mono PCM WAV file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-voice-test-'));
    const file = path.join(directory, 'sample.wav');
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-1000, 2);

    try {
      await writePcm16Wav(file, [pcm], 16000, 1);
      const wav = await fs.readFile(file);

      assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
      assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
      assert.strictEqual(wav.toString('ascii', 12, 16), 'fmt ');
      assert.strictEqual(wav.readUInt16LE(20), 1);
      assert.strictEqual(wav.readUInt16LE(22), 1);
      assert.strictEqual(wav.readUInt32LE(24), 16000);
      assert.strictEqual(wav.readUInt16LE(34), 16);
      assert.strictEqual(wav.toString('ascii', 36, 40), 'data');
      assert.strictEqual(wav.readUInt32LE(40), pcm.length);
      assert.strictEqual(wav.subarray(44).compare(pcm), 0);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
