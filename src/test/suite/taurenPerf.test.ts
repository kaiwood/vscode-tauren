import * as assert from 'assert';
import { TaurenPerfRecorder } from '../../perf/taurenPerf';

suite('Tauren perf recorder', () => {
  test('does not allocate timers or write events when disabled', () => {
    const lines: string[] = [];
    const recorder = new TaurenPerfRecorder({
      isEnabled: () => false,
      writeLine: (line) => lines.push(line),
      now: () => 10,
      timestamp: () => '2026-01-01T00:00:00.000Z'
    });

    assert.strictEqual(recorder.start('sessionList.load'), undefined);
    recorder.record('sessionList.load', 12, { sessionCount: 3 });

    assert.deepStrictEqual(lines, []);
    assert.deepStrictEqual(recorder.getEvents(), []);
  });

  test('records structured events and keeps bounded history', () => {
    let now = 0;
    const lines: string[] = [];
    const recorder = new TaurenPerfRecorder({
      isEnabled: () => true,
      writeLine: (line) => lines.push(line),
      now: () => now,
      timestamp: () => '2026-01-01T00:00:00.000Z',
      maxEvents: 2
    });

    const timer = recorder.start('sessionList.load', { cacheHits: 1 });
    now = 12.34;
    recorder.finish(timer, { cacheMisses: 2, ignored: undefined });
    recorder.record('transcript.render', 4, { messageCount: 10 });
    recorder.record('sessionList.render', 5, { visibleItemCount: 7 });

    assert.strictEqual(lines.length, 3);
    assert.ok(lines[0].includes('[Tauren perf] sessionList.load durationMs=12.3'));
    assert.ok(lines[0].includes('cacheHits=1'));
    assert.ok(lines[0].includes('cacheMisses=2'));
    assert.deepStrictEqual(recorder.getEvents().map((event) => event.name), ['transcript.render', 'sessionList.render']);
  });
});
