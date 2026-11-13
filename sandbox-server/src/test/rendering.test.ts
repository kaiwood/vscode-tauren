import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MessageRenderer, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { PiSdkRenderer, type RenderableRuntime } from '@tauren/shared/rendering/piSdkRendering';
import { renderComponentContent } from '@tauren/shared/rendering/renderContent';

// Unit doubles exercise only renderer callbacks/components, not SDK integration.
const component = (text: string) => ({ render: () => [text], invalidate() {} });
function runtime(tool?: Partial<ToolDefinition>, message?: MessageRenderer): RenderableRuntime {
  return { cwd: '/workspace', session: { extensionRunner: {
    getToolDefinition: () => tool as ToolDefinition | undefined,
    getMessageRenderer: () => message
  } } };
}

test('tool call/update/end share args, state, and the last result component', () => {
  let expanded = true;
  const renderer = new PiSdkRenderer(() => expanded);
  const args = { path: 'file' };
  let last: unknown;
  let callState: unknown;
  const contexts: unknown[] = [];
  const host = runtime({
    renderCall: (_args, _theme, context) => {
      assert.deepEqual(context.args, args);
      assert.equal(context.cwd, '/workspace');
      context.state.marker = 'retained';
      callState = context.state;
      return component('call');
    },
    renderResult: (_result, options, _theme, context) => {
      assert.equal(context.state, callState);
      assert.equal((context.state as Record<string, unknown>).marker, 'retained');
      assert.equal(context.args, args);
      assert.equal(context.lastComponent, last);
      contexts.push(context);
      last = component(options.expanded ? 'expanded' : 'collapsed');
      return last as ReturnType<typeof component>;
    }
  });
  assert.deepEqual(renderer.enrichEvent(host, { type: 'tool_execution_start', toolName: 'test', toolCallId: 'id', args }).taurenRenderedTool,
    { body: 'call', code: true });
  assert.deepEqual(renderer.enrichEvent(host, { type: 'tool_execution_update', toolName: 'test', toolCallId: 'id', partialResult: 'partial' }).taurenRenderedTool,
    { body: 'expanded', code: true });
  expanded = false;
  const update = { type: 'tool_execution_update', toolName: 'test', toolCallId: 'id' };
  assert.equal(renderer.enrichEvent(host, update), update);
  assert.deepEqual(renderer.enrichEvent(host, { type: 'tool_execution_end', toolName: 'test', toolCallId: 'id', result: 'done' }).taurenRenderedTool,
    { body: 'collapsed', expandedBody: 'expanded', code: true });
  assert.equal(contexts.length, 3);
  // Ending a call drops state, even when the next call reuses its identifier.
  const fresh = runtime({ renderCall: (_args, _theme, context) => {
    assert.notEqual(context.state, callState);
    assert.deepEqual(context.state, {});
    return component('fresh');
  } });
  renderer.enrichEvent(fresh, { type: 'tool_execution_start', toolName: 'test', toolCallId: 'id' });
});

test('resumed custom messages use the same collapsed/expanded DTO as live messages', () => {
  const renderer = new PiSdkRenderer();
  const host = runtime(undefined, (_message, options) => component(options.expanded ? 'full message' : 'short message'));
  const message = { role: 'custom', customType: 'notice', content: [{ type: 'text', text: 'stored' }] };
  const expected = { body: 'short message', expandedBody: 'full message', code: true };
  assert.deepEqual(renderer.renderCustomMessage(host, message), expected);
  assert.deepEqual(renderer.enrichEvent(host, { type: 'message_end', message }).message,
    { ...message, taurenRenderedMessage: expected });
  assert.equal('taurenRenderedMessage' in message, false);
});

test('renderer and component failures safely preserve the unrendered event', () => {
  const renderer = new PiSdkRenderer();
  for (const renderCall of [() => { throw new Error('callback'); },
    () => ({ render() { throw new Error('component'); }, invalidate() {} })]) {
    const host = runtime({ renderCall });
    const event = { type: 'tool_execution_start', toolName: 'test', toolCallId: 'id' };
    assert.equal(renderer.enrichEvent(host, event), event);
  }
  const message = { customType: 'bad' };
  assert.equal(renderer.renderCustomMessage(runtime(undefined, () => { throw new Error('callback'); }), message), undefined);
  assert.equal(renderer.renderCustomMessage(runtime(undefined, () => ({ render() { throw new Error('component'); }, invalidate() {} })), message), undefined);
});

test('ANSI backgrounds and inverse are removed while foreground/style codes survive', () => {
  const renderer = new PiSdkRenderer();
  const host = runtime(undefined, () => component('\x1b[31;44;1mred\x1b[48;5;200m!\x1b[48;2;1;2;3;4munder\x1b[7;27;49;100m.\x1b[0m'));
  assert.deepEqual(renderer.renderCustomMessage(host, { customType: 'ansi' }),
    { body: '\x1b[31;1mred!\x1b[4munder.\x1b[0m', code: true });
});

test('mixed component images and embedded text/image arrays do not stringify image payloads', () => {
  const image = { base64Data: 'secret-base64', mimeType: 'image/png', dimensions: { widthPx: 20, heightPx: 20 } };
  const tree = { children: [component('before'), image, component('after')] };
  const content = renderComponentContent(tree, 100);
  assert.equal(content.blocks[1]?.type, 'image');
  assert.ok(content.lines.includes('before'));
  assert.ok(content.lines.includes('after'));
  assert.ok(!content.lines.join('').includes('secret-base64'));
  const embedded = { render: () => [{ type: 'text', text: 'embedded\ntext' }, { type: 'image', data: 'secret-base64', mimeType: 'image/png' }] };
  assert.deepEqual(renderComponentContent(embedded, 100).lines, ['embedded', 'text']);
  const renderer = new PiSdkRenderer();
  assert.equal(renderer.renderCustomMessage(runtime(undefined, () => image as never), { customType: 'image' }), undefined);
});

test('reset and dispose release retained call state', () => {
  const renderer = new PiSdkRenderer();
  const states: unknown[] = [];
  const host = runtime({ renderCall: (_args, _theme, context) => {
    states.push(context.state);
    return component('call');
  } });
  const event = { type: 'tool_execution_start', toolName: 'test', toolCallId: 'id' };
  renderer.enrichEvent(host, event);
  renderer.reset();
  renderer.enrichEvent(host, event);
  renderer.dispose();
  renderer.enrichEvent(host, event);
  assert.equal(new Set(states).size, 3);
});
