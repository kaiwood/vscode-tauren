import * as assert from 'assert';
import {
  applyWebviewMessagePatch,
  createWebviewMessageSyncPlan,
  parseWebviewMessagePatch,
  resolveWebviewStateMessageMessages
} from '../../webviewProtocol/messagePatch';
import type { ChatSnapshotMessage } from '../../chat/chatSession';
import type { WebviewStateMessage } from '../../webviewProtocol/types';

suite('Webview message patch helpers', () => {
  test('parses and applies patches while preserving omitted image payloads', () => {
    const previous: ChatSnapshotMessage[] = [{
      id: 'message-1',
      revision: 1,
      role: 'assistant',
      text: 'Hello',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      activities: [{
        id: 'activity-1',
        kind: 'tool_execution',
        title: 'Read',
        status: 'completed',
        images: [{ type: 'image', data: 'def', mimeType: 'image/png' }]
      }]
    }];

    const patch = parseWebviewMessagePatch({
      upserts: [{
        index: 0,
        message: {
          id: 'message-1',
          revision: 2,
          role: 'assistant',
          text: 'Hello again',
          activities: [{
            id: 'activity-1',
            kind: 'tool_execution',
            title: 'Read updated',
            status: 'completed'
          }]
        }
      }]
    });

    assert.ok(patch);
    const next = applyWebviewMessagePatch(previous, patch);

    assert.strictEqual(next[0].text, 'Hello again');
    assert.deepStrictEqual(next[0].images, previous[0].images);
    assert.deepStrictEqual(next[0].activities?.[0]?.images, previous[0].activities?.[0]?.images);
  });

  test('creates patch plans that omit unchanged images and clear removed images', () => {
    const initial: ChatSnapshotMessage[] = [{
      id: 'message-1',
      revision: 1,
      role: 'assistant',
      text: 'Hello',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      activities: [{
        id: 'activity-1',
        kind: 'tool_execution',
        title: 'Read',
        status: 'completed',
        images: [{ type: 'image', data: 'def', mimeType: 'image/png' }]
      }]
    }];
    const firstPlan = createWebviewMessageSyncPlan({ generation: 1, messages: initial });

    const unchangedImages: ChatSnapshotMessage[] = [{
      ...initial[0],
      revision: 2,
      text: 'Hello again',
      activities: [{
        ...initial[0].activities![0],
        title: 'Read updated'
      }]
    }];
    const secondPlan = createWebviewMessageSyncPlan({ generation: 1, messages: unchangedImages, lastSync: firstPlan.postedSync });

    assert.strictEqual(secondPlan.includeMessages, false);
    assert.strictEqual(secondPlan.messagePatch?.upserts?.[0]?.message.images, undefined);
    assert.strictEqual(secondPlan.messagePatch?.upserts?.[0]?.message.activities?.[0]?.images, undefined);

    const removedImages: ChatSnapshotMessage[] = [{
      id: 'message-1',
      revision: 3,
      role: 'assistant',
      text: 'No images',
      activities: [{
        id: 'activity-1',
        kind: 'tool_execution',
        title: 'Read without images',
        status: 'completed'
      }]
    }];
    const thirdPlan = createWebviewMessageSyncPlan({ generation: 1, messages: removedImages, lastSync: secondPlan.postedSync });

    assert.deepStrictEqual(thirdPlan.messagePatch?.upserts?.[0]?.message.images, []);
    assert.deepStrictEqual(thirdPlan.messagePatch?.upserts?.[0]?.message.activities?.[0]?.images, []);
  });

  test('resolves patch-only state messages with previous messages', () => {
    const previous = createState({
      messages: [{ id: 'message-1', revision: 1, role: 'user', text: 'Before' }]
    });
    const patched = createState({
      messages: undefined,
      messagePatch: {
        upserts: [{ index: 0, message: { id: 'message-1', revision: 2, role: 'user', text: 'After' } }]
      }
    });

    const resolved = resolveWebviewStateMessageMessages(patched, previous);

    assert.deepStrictEqual(resolved.messages, [{ id: 'message-1', revision: 2, role: 'user', text: 'After' }]);
  });
});

function createState(overrides: Partial<WebviewStateMessage>): WebviewStateMessage {
  return {
    type: 'state',
    messages: [],
    busy: false,
    modelLabel: '',
    modelProvider: '',
    modelId: '',
    modelReasoning: false,
    thinkingLevel: '',
    modelOptions: [],
    contextUsageLabel: '',
    contextUsageTitle: '',
    contextUsageLevel: '',
    metadataRefreshing: false,
    workspaceDiffStats: { addedLines: 0, removedLines: 0 },
    slashCommands: [],
    slashCommandsRefreshing: false,
    outputColors: true,
    animationsEnabled: true,
    customUiTheme: 'default',
    extensionStatus: [],
    extensionWidgets: [],
    ...overrides
  };
}
