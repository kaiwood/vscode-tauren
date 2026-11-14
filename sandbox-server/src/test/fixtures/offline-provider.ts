import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  type AssistantMessage, type SimpleStreamOptions, type StreamFunction, type ToolCall
} from '@earendil-works/pi-ai';

/** Bounded input-hook delay: hooks have no AbortSignal; production must cancel preflight itself. */
async function delayedPreflight(cwd: string): Promise<void> {
  await writeFile(path.join(cwd, 'preflight-entered'), 'entered');
  await new Promise(resolve => setTimeout(resolve, 800));
  await writeFile(path.join(cwd, 'preflight-finished'), 'finished');
}

/** Calls the real SDK bash tool, with both shell and descendant PIDs observable by the test. */
function hangingBash(): ToolCall['arguments'] {
  return { command: 'echo $$ > tool-shell.pid; sleep 120 & child=$!; echo "$child" > tool-child.pid; echo "fixture: tool waiting"; wait "$child"' };
}

/** Discovered through temp settings.json like an ordinary installed Pi extension.
 * Commands: tools-roundtrip performs write/read/edit/read; hang-tool invokes bash;
 * wait-for-abort holds generation until SDK abort; queue-window holds it briefly
 * for steering/followUp; delayed-preflight delays the normal input hook then holds
 * generation. Everything else echoes the most recent user message, without HTTP.
 */
export default function offlineProvider(pi: ExtensionAPI): void {
  // A normal extension log must not corrupt the server's framed stdout.
  console.log('offline fixture loaded');
  pi.registerCommand('offline-status', { description: 'Offline integration fixture', handler: async () => {} });
  pi.on('input', async (event, ctx) => {
    if (event.text === 'delayed-preflight') await delayedPreflight(ctx.cwd);
    return event.text === 'source-check'
      ? { action: 'transform', text: `${event.text} [source=${event.source};cwd=${ctx.cwd};processCwd=${process.cwd()}]` }
      : { action: 'continue' };
  });

  const streamSimple: StreamFunction<string, SimpleStreamOptions> = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    let userIndex = context.messages.length - 1;
    while (userIndex >= 0 && context.messages[userIndex]?.role !== 'user') userIndex--;
    const user = context.messages[userIndex];
    const text = typeof user?.content === 'string' ? user.content
      : user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    const results = context.messages.slice(userIndex + 1).filter(message => message.role === 'toolResult');
    const message: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), stopReason: 'pending', content: [],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: message });
      const calls = text === 'tools-roundtrip' ? [
        { name: 'write', arguments: { path: 'roundtrip.txt', content: 'before\n' } },
        { name: 'read', arguments: { path: 'roundtrip.txt' } },
        { name: 'edit', arguments: { path: 'roundtrip.txt', oldText: 'before', newText: 'after' } },
        { name: 'read', arguments: { path: 'roundtrip.txt' } }
      ] : text === 'hang-tool' ? [{ name: 'bash', arguments: hangingBash() }] : [];
      const next = calls[results.length];
      if (next) {
        const toolCall: ToolCall = { type: 'toolCall', id: `offline-${userIndex}-${results.length}`, ...next };
        message.content.push(toolCall);
        stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(next.arguments), partial: message });
        stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        message.stopReason = 'toolUse';
        stream.push({ type: 'done', reason: 'toolUse', message });
        stream.end();
        return;
      }
      const block = { type: 'text' as const, text: '' };
      message.content.push(block);
      stream.push({ type: 'text_start', contentIndex: 0, partial: message });
      let timer: NodeJS.Timeout | undefined;
      const abort = () => {
        clearTimeout(timer);
        message.stopReason = 'aborted';
        message.errorMessage = 'Offline fixture aborted';
        stream.push({ type: 'error', reason: 'aborted', error: message });
        stream.end();
      };
      const finish = () => {
        options?.signal?.removeEventListener('abort', abort);
        for (const delta of ['fixture: ', text.slice(0, 3), text.slice(3)].filter(Boolean)) {
          block.text += delta;
          stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
        }
        stream.push({ type: 'text_end', contentIndex: 0, content: block.text, partial: message });
        message.stopReason = 'stop';
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      };
      if (['wait-for-abort', 'delayed-preflight', 'queue-window'].includes(text)) {
        block.text = 'fixture: waiting';
        stream.push({ type: 'text_delta', contentIndex: 0, delta: block.text, partial: message });
        if (options?.signal?.aborted) abort();
        else {
          options?.signal?.addEventListener('abort', abort, { once: true });
          if (text === 'queue-window') timer = setTimeout(finish, 800);
        }
        return;
      }
      finish();
    });
    return stream;
  };

  pi.registerProvider('offline', {
    api: 'offline-fixture', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-fixture-not-a-secret', streamSimple,
    models: ['scripted', 'alternate'].map(id => ({ id, name: `Offline fixture ${id}`, reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }))
  });
}
