import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  type AssistantMessage, type SimpleStreamOptions, type StreamFunction
} from '@earendil-works/pi-ai';

/** Discovered through settings.json like an ordinary installed Pi extension. */
export default function offlineProvider(pi: ExtensionAPI): void {
  // A normal extension log must not corrupt the server's framed stdout.
  console.log('offline fixture loaded');
  pi.on('input', (event, ctx) => event.text === 'source-check'
    ? { action: 'transform', text: `${event.text} [source=${event.source};cwd=${ctx.cwd};processCwd=${process.cwd()}]` }
    : { action: 'continue' });

  const streamSimple: StreamFunction<string, SimpleStreamOptions> = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const user = [...context.messages].reverse().find(message => message.role === 'user');
    const text = typeof user?.content === 'string' ? user.content
      : user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    const message: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), stopReason: 'pending', content: [],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: message });
      const block = { type: 'text' as const, text: '' };
      message.content.push(block);
      stream.push({ type: 'text_start', contentIndex: 0, partial: message });
      if (text === 'wait-for-abort') {
        block.text = 'fixture: waiting';
        stream.push({ type: 'text_delta', contentIndex: 0, delta: block.text, partial: message });
        const abort = () => {
          message.stopReason = 'aborted';
          message.errorMessage = 'Offline fixture aborted';
          stream.push({ type: 'error', reason: 'aborted', error: message });
          stream.end();
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener('abort', abort, { once: true });
        return;
      }
      for (const delta of ['fixture: ', text.slice(0, 3), text.slice(3)].filter(Boolean)) {
        block.text += delta;
        stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
      }
      stream.push({ type: 'text_end', contentIndex: 0, content: block.text, partial: message });
      message.stopReason = 'stop';
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
    });
    return stream;
  };

  pi.registerProvider('offline', {
    api: 'offline-fixture', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-fixture-not-a-secret', streamSimple,
    models: [{ id: 'scripted', name: 'Offline fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }]
  });
}
