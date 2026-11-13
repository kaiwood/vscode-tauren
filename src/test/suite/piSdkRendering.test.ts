import * as assert from 'assert';
import type { MessageRenderOptions, MessageRenderer, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { PiSdkRenderer } from '@tauren/shared/rendering/piSdkRendering';

suite('PiSdkRenderer', () => {
  test('renders completed extension tool results with collapsed and expanded bodies', () => {
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      toolDefinition: {
        renderResult: (_result, options) => ({
          invalidate: () => undefined,
          render: () => [options.expanded ? '\u001b[43m⠋ expanded detail\u001b[0m' : '\u001b[42m⠋ collapsed detail\u001b[0m']
        })
      }
    });

    const event = renderer.enrichEvent(runtime, {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'subagent',
      result: { content: [{ type: 'text', text: 'fallback' }], details: { ok: true } }
    });

    assert.deepStrictEqual(event.taurenRenderedTool, {
      body: '⠋ collapsed detail\u001b[0m',
      expandedBody: '⠋ expanded detail\u001b[0m',
      code: true
    });
  });

  test('skips partial extension tool rendering while collapsed', () => {
    const calls: boolean[] = [];
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      toolDefinition: {
        renderResult: (_result, options) => {
          calls.push(options.expanded);
          return {
            invalidate: () => undefined,
            render: () => [options.expanded ? 'expanded detail' : 'collapsed detail']
          };
        }
      }
    });

    const event = renderer.enrichEvent(runtime, {
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'subagent',
      partialResult: { content: [{ type: 'text', text: 'fallback' }], details: { ok: true } }
    });

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(event.taurenRenderedTool, undefined);
  });

  test('renders expanded partial extension tool results when tools are expanded', () => {
    const calls: boolean[] = [];
    const renderer = new PiSdkRenderer(() => true);
    const runtime = createRuntime({
      toolDefinition: {
        renderResult: (_result, options) => {
          calls.push(options.expanded);
          return {
            invalidate: () => undefined,
            render: () => [options.expanded ? 'expanded detail' : 'collapsed detail']
          };
        }
      }
    });

    const event = renderer.enrichEvent(runtime, {
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'subagent',
      partialResult: { content: [{ type: 'text', text: 'fallback' }], details: { ok: true } }
    });

    assert.deepStrictEqual(calls, [true]);
    assert.deepStrictEqual(event.taurenRenderedTool, {
      body: 'expanded detail',
      code: true
    });
  });

  test('renders extension custom messages with Tauren host options', () => {
    const calls: MessageRenderOptions[] = [];
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      messageRenderer: ((_message: unknown, options: MessageRenderOptions) => {
        calls.push(options);
        return {
          invalidate: () => undefined,
          render: () => [options.expanded ? 'expanded message' : 'collapsed message']
        };
      }) as unknown as MessageRenderer
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
    assert.deepStrictEqual(calls.map(options => options.expanded), [false, true]);
    for (const options of calls) {
      assert.strictEqual(options.outputPad, 0);
      assert.strictEqual(options.keyText('app.tools.expand'), '');
      assert.strictEqual(options.keyHint('app.tools.expand', 'expand'), 'expand');
    }
  });

  test('supplies host options and unknown duration to tool renderers', () => {
    const contexts: Parameters<NonNullable<ToolDefinition['renderResult']>>[3][] = [];
    const renderer = new PiSdkRenderer(() => false);
    const runtime = createRuntime({
      toolDefinition: {
        renderResult: (_result, _options, _theme, context) => {
          contexts.push(context);
          return { invalidate: () => undefined, render: () => ['tool result'] };
        }
      }
    });
    renderer.enrichEvent(runtime, {
      type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'fixture',
      result: { content: [{ type: 'text', text: 'result' }] }
    });
    assert.strictEqual(contexts.length, 2);
    for (const context of contexts) {
      assert.strictEqual(context.outputPad, 0);
      assert.strictEqual(context.durationMs, undefined);
      assert.strictEqual(context.keyText('app.tools.expand'), '');
      assert.strictEqual(context.keyHint('app.tools.expand', 'expand'), 'expand');
    }
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
