import * as assert from 'assert';
import type { MessageRenderOptions, MessageRenderer, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { PiSdkRenderer } from '../../sdk/piSdkRendering';

suite('PiSdkRenderer', () => {
  test('renders extension tool results with collapsed and expanded bodies', () => {
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      toolDefinition: {
        renderResult: (_result, options) => ({
          invalidate: () => undefined,
          render: () => [options.expanded ? '\u001b[43mexpanded detail\u001b[0m' : '\u001b[42mcollapsed detail\u001b[0m']
        })
      }
    });

    const event = renderer.enrichEvent(runtime, {
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'subagent',
      partialResult: { content: [{ type: 'text', text: 'fallback' }], details: { ok: true } }
    });

    assert.deepStrictEqual(event.taurenRenderedTool, {
      body: 'collapsed detail\u001b[0m',
      expandedBody: 'expanded detail\u001b[0m',
      code: true
    });
  });

  test('renders extension custom messages', () => {
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      messageRenderer: ((_message: unknown, options: MessageRenderOptions) => ({
        invalidate: () => undefined,
        render: () => [options.expanded ? 'expanded message' : 'collapsed message']
      })) as unknown as MessageRenderer
    });

    assert.deepStrictEqual(renderer.renderCustomMessage(runtime, {
      role: 'custom',
      customType: 'subagent-result',
      content: 'fallback',
      display: true
    }), {
      body: 'collapsed message',
      expandedBody: 'expanded message',
      code: true
    });
  });
});

function createRuntime(options: {
  toolDefinition?: Partial<ToolDefinition>;
  messageRenderer?: MessageRenderer;
}) {
  return {
    cwd: '/workspace',
    session: {
      extensionRunner: {
        getToolDefinition: () => options.toolDefinition as ToolDefinition | undefined,
        getMessageRenderer: () => options.messageRenderer
      }
    }
  };
}
