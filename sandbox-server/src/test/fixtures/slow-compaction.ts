import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Ordinary extension hook, loaded only by the compaction cancellation test.
 * Observable files synchronize the host with the real SDK's compaction signal.
 * A deadline makes a missing abort fail rather than leak an unbounded hook.
 */
export default function slowCompaction(pi: ExtensionAPI): void {
  pi.on('session_before_compact', async (event, ctx) => {
    if (event.customInstructions !== 'wait for compaction cancellation') return;
    await writeFile(path.join(ctx.cwd, 'compaction-entered'), 'entered');
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        event.signal.removeEventListener('abort', aborted);
        reject(new Error('Compaction fixture did not receive SDK abort'));
      }, 10_000);
      if (event.signal.aborted) aborted();
      else event.signal.addEventListener('abort', aborted, { once: true });
    });
    await writeFile(path.join(ctx.cwd, 'compaction-aborted'), 'aborted');
    return { cancel: true };
  });
}
