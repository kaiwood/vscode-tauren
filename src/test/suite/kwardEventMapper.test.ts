import * as assert from 'assert';
import { KwardTurnEventNormalizer, mapKwardTurnEvent } from '../../kward/eventMapper';

suite('Kward event mapper', () => {
  test('normalizes Kward reasoning deltas into separate Pi-style thinking blocks', () => {
    const normalizer = new KwardTurnEventNormalizer();

    assert.deepStrictEqual(normalizer.map({ type: 'turnStarted', turnId: 'turn-1' }), [
      { type: 'agent_start', turnId: 'turn-1' }
    ]);
    assert.deepStrictEqual(normalizer.map({ type: 'reasoningDelta', payload: { delta: 'first thought' } }), [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 1 } },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'first thought' } }
    ]);
    assert.deepStrictEqual(normalizer.map({ type: 'assistantDelta', payload: { delta: 'answer' } }), [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 1 } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer' } }
    ]);
    assert.deepStrictEqual(normalizer.map({ type: 'toolCall', payload: { toolCallId: 'call-1', toolName: 'bash', args: { command: 'true' } } }), [
      { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'true' } }
    ]);
    assert.deepStrictEqual(normalizer.map({ type: 'reasoningDelta', payload: { delta: 'second thought' } }), [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 2 } },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 2, delta: 'second thought' } }
    ]);
    assert.deepStrictEqual(normalizer.map({ type: 'turnFinished', payload: { status: 'completed' } }), [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 2 } },
      { type: 'agent_end' }
    ]);
  });

  test('maps assistant and reasoning deltas to Tauren message updates', () => {
    assert.deepStrictEqual(
      mapKwardTurnEvent({ type: 'assistantDelta', payload: { delta: 'hello' } }),
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
      }
    );

    assert.deepStrictEqual(
      mapKwardTurnEvent({ type: 'reasoningDelta', payload: { delta: 'thinking' } }),
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'thinking' }
      }
    );
  });

  test('maps canonical edit tool metadata to Pi-style tool execution events', () => {
    assert.deepStrictEqual(
      mapKwardTurnEvent({
        type: 'toolResult',
        payload: {
          toolCallId: 'call-1',
          toolName: 'edit',
          args: {
            path: 'src/file.ts',
            edits: [{ oldText: 'old', newText: 'new' }]
          },
          result: {
            content: 'edited',
            isError: false,
            diff: '--- a/src/file.ts\n+++ b/src/file.ts\n'
          }
        }
      }),
      {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'edit',
        args: {
          path: 'src/file.ts',
          edits: [{ oldText: 'old', newText: 'new' }]
        },
        result: {
          content: 'edited',
          isError: false,
          diff: '--- a/src/file.ts\n+++ b/src/file.ts\n'
        },
        isError: false
      }
    );
  });

  test('keeps legacy tool metadata mapping for older Kward events', () => {
    assert.deepStrictEqual(
      mapKwardTurnEvent({
        type: 'toolCall',
        payload: {
          toolCall: { id: 'call-1', function: { name: 'edit_file' } },
          tool: {
            kind: 'edit',
            path: 'src/file.ts',
            edits: [{ oldText: 'old', newText: 'new' }]
          }
        }
      }),
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'edit',
        args: {
          path: 'src/file.ts',
          edits: [{ oldText: 'old', newText: 'new' }]
        }
      }
    );
  });

  test('maps turn lifecycle events', () => {
    assert.deepStrictEqual(mapKwardTurnEvent({ type: 'turnStarted', turnId: 'turn-1' }), { type: 'agent_start', turnId: 'turn-1' });
    assert.deepStrictEqual(mapKwardTurnEvent({ type: 'turnFinished', payload: { status: 'completed' } }), { type: 'agent_end' });
  });

  test('maps compaction lifecycle events', () => {
    assert.deepStrictEqual(mapKwardTurnEvent({ type: 'compactionStart' }), { type: 'compaction_start' });
    assert.deepStrictEqual(
      mapKwardTurnEvent({
        type: 'compactionEnd',
        payload: {
          result: { summary: 'Prior context', tokensBefore: 1234 },
          aborted: false,
          willRetry: false,
          errorMessage: null
        }
      }),
      {
        type: 'compaction_end',
        result: { summary: 'Prior context', tokensBefore: 1234 },
        aborted: false,
        willRetry: false,
        errorMessage: undefined
      }
    );
  });
});
