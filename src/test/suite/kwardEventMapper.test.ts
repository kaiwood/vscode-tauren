import * as assert from 'assert';
import { mapKwardTurnEvent } from '../../kward/eventMapper';

suite('Kward event mapper', () => {
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

  test('maps normalized edit tool metadata to Pi-style tool execution events', () => {
    assert.deepStrictEqual(
      mapKwardTurnEvent({
        type: 'toolResult',
        payload: {
          toolCall: { id: 'call-1', name: 'edit_file' },
          tool: {
            kind: 'edit',
            path: 'src/file.ts',
            edits: [{ oldText: 'old', newText: 'new' }]
          },
          content: 'edited'
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
          details: {
            tool: {
              kind: 'edit',
              path: 'src/file.ts',
              edits: [{ oldText: 'old', newText: 'new' }]
            }
          }
        }
      }
    );
  });

  test('maps turn lifecycle events', () => {
    assert.deepStrictEqual(mapKwardTurnEvent({ type: 'turnStarted', turnId: 'turn-1' }), { type: 'agent_start', turnId: 'turn-1' });
    assert.deepStrictEqual(mapKwardTurnEvent({ type: 'turnFinished', payload: { status: 'completed' } }), { type: 'agent_end' });
  });
});
