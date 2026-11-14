/**
 * Test-only Pi extension for sandbox-package.test.js. That test extracts Tauren's
 * installable VSIX archive outside the checkout, provisions an independent Pi
 * installation, and copies this file into its isolated agent settings directory.
 * The extracted server loads Pi's SDK and discovers this as an ordinary extension.
 *
 * Scripted model streams avoid HTTP calls and credentials while real SDK tools,
 * custom rendering and UI interactions exercise the packaged server. Bare imports
 * also verify extension dependency resolution through the installed Pi harness.
 * This standalone JavaScript fixture needs no compiled development test files;
 * it is not shipped in the VSIX or used by the production server.
 */
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

export default function packagedOfflineProvider(pi) {
  console.log('packaged offline provider loaded');
  const read = createReadTool(process.cwd());
  pi.registerTool({ ...read, renderCall: args => new Text(`packaged-read:${args.path}`, 0, 0) });
  pi.registerTool({
    name: 'packaged_echo', label: 'Packaged echo', description: 'Exercise extension peer imports',
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, args) { return { content: [{ type: 'text', text: args.text }], details: {} }; }
  });
  pi.registerCommand('packaged-ui', { handler: async (_args, ctx) => {
    const answer = await ctx.ui.select('packaged-select', ['archive-answer']);
    ctx.ui.setWidget('packaged-widget', () => new Text(`packaged-widget:${answer}`, 0, 0));
    ctx.ui.notify(`packaged-ui:${answer}`);
  } });
  pi.on('input', async event => event.text === 'source-check'
    ? { action: 'transform', text: `source=${event.source};cwd=${process.cwd()}` }
    : { action: 'continue' });

  pi.registerProvider('packaged-offline', {
    api: 'packaged-offline-api', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-not-a-secret',
    models: [{ id: 'scripted', name: 'Packaged offline', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      let index = context.messages.length - 1;
      while (index >= 0 && context.messages[index].role !== 'user') index--;
      const user = context.messages[index];
      const text = typeof user?.content === 'string' ? user.content
        : user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
      const results = context.messages.slice(index + 1).filter(message => message.role === 'toolResult');
      const calls = text === 'tools-roundtrip' ? [
        { name: 'write', arguments: { path: 'packaged-roundtrip.txt', content: 'before\n' } },
        { name: 'read', arguments: { path: 'packaged-roundtrip.txt' } },
        { name: 'edit', arguments: { path: 'packaged-roundtrip.txt', oldText: 'before', newText: 'after' } },
        { name: 'read', arguments: { path: 'packaged-roundtrip.txt' } },
        { name: 'packaged_echo', arguments: { text: 'packaged-peer-success' } }
      ] : [];
      const next = calls[results.length];
      const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: next ? 'toolUse' : 'stop', content: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message });
        if (next) {
          const toolCall = { type: 'toolCall', id: `packaged-${index}-${results.length}`, ...next };
          message.content.push(toolCall);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(next.arguments), partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        } else {
          const content = `packaged fixture: ${text}`;
          message.content.push({ type: 'text', text: content });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: content, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content, partial: message });
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    }
  });
}
