import * as assert from 'assert';
import { KwardCapabilityResolver } from '../../kward/capabilities';

suite('KwardCapabilityResolver', () => {
  test('detects supported capability groups', () => {
    const resolver = new KwardCapabilityResolver({
      commands: true,
      auth: { supported: true },
      memory: { supported: false }
    });

    assert.strictEqual(resolver.isGroupSupported('commands'), true);
    assert.strictEqual(resolver.isGroupSupported('auth'), true);
    assert.strictEqual(resolver.isGroupSupported('memory'), false);
    assert.strictEqual(resolver.isGroupSupported('missing'), false);
  });

  test('detects listed methods unless the group is explicitly unsupported', () => {
    const resolver = new KwardCapabilityResolver({
      sessions: {
        methods: ['sessions/list', 'sessions/delete']
      },
      auth: {
        supported: true,
        methods: ['auth/providers', 'auth/loginWithApiKey']
      },
      runtimeSettings: {
        supported: false,
        methods: ['runtime/reload']
      }
    });

    assert.strictEqual(resolver.isMethodSupported('sessions', 'sessions/delete'), true);
    assert.strictEqual(resolver.isMethodSupported('sessions', 'sessions/rename'), false);
    assert.strictEqual(resolver.isMethodSupported('auth', 'auth/loginWithApiKey'), true);
    assert.strictEqual(resolver.isMethodSupported('auth', 'auth/loginWithOAuth'), false);
    assert.strictEqual(resolver.isMethodSupported('runtimeSettings', 'runtime/reload'), false);
  });

  test('detects nested session and tree features', () => {
    const resolver = new KwardCapabilityResolver({
      sessions: {
        compact: { supported: true },
        import: { supported: false },
        tree: {
          supported: true,
          labels: true,
          navigate: true,
          summarize: false
        }
      }
    });

    assert.strictEqual(resolver.isSessionFeatureSupported('compact'), true);
    assert.strictEqual(resolver.isSessionFeatureSupported('import'), false);
    assert.strictEqual(resolver.isTreeFeatureSupported('labels'), true);
    assert.strictEqual(resolver.isTreeFeatureSupported('navigate'), true);
    assert.strictEqual(resolver.isTreeFeatureSupported('summarize'), false);
  });

  test('reads protocol method and notification names with defaults', () => {
    const defaults = new KwardCapabilityResolver({});
    assert.strictEqual(defaults.getQuestionNotificationMethod(), 'ui/question');
    assert.strictEqual(defaults.getQuestionAnswerMethod(), 'ui/answerQuestion');
    assert.strictEqual(defaults.getCompactionNotificationMethod(), 'session/event');
    assert.strictEqual(defaults.getTurnEventNotificationMethod(), 'turn/event');
    assert.strictEqual(defaults.getFooterNotificationMethod(), 'ui/footer');

    const resolver = new KwardCapabilityResolver({
      events: {
        notification: 'custom/turnEvent'
      },
      extensionUi: {
        question: {
          notification: 'custom/question',
          method: 'custom/answerQuestion'
        },
        footer: {
          notification: 'custom/footer'
        }
      },
      sessions: {
        compact: {
          notification: 'custom/sessionEvent'
        }
      }
    });

    assert.strictEqual(resolver.getQuestionNotificationMethod(), 'custom/question');
    assert.strictEqual(resolver.getQuestionAnswerMethod(), 'custom/answerQuestion');
    assert.strictEqual(resolver.getCompactionNotificationMethod(), 'custom/sessionEvent');
    assert.strictEqual(resolver.getTurnEventNotificationMethod(), 'custom/turnEvent');
    assert.strictEqual(resolver.getFooterNotificationMethod(), 'custom/footer');
  });

  test('detects MCP discovery capabilities', () => {
    const resolver = new KwardCapabilityResolver({
      mcp: {
        discovery: {
          supported: true,
          methods: ['tools/list', 'mcp/status'],
          toolMetadata: true
        }
      }
    });

    assert.strictEqual(resolver.isMcpDiscoverySupported(), true);
    assert.strictEqual(resolver.isMcpStatusSupported(), true);
    assert.strictEqual(resolver.isMcpToolMetadataSupported(), true);

    const unsupported = new KwardCapabilityResolver({
      mcp: {
        discovery: {
          supported: false,
          methods: ['mcp/status'],
          toolMetadata: true
        }
      }
    });

    assert.strictEqual(unsupported.isMcpDiscoverySupported(), false);
    assert.strictEqual(unsupported.isMcpStatusSupported(), false);
    assert.strictEqual(unsupported.isMcpToolMetadataSupported(), false);

    const missing = new KwardCapabilityResolver({});
    assert.strictEqual(missing.isMcpDiscoverySupported(), false);
    assert.strictEqual(missing.isMcpStatusSupported(), false);
    assert.strictEqual(missing.isMcpToolMetadataSupported(), false);
  });

  test('detects runtime settings, busy input modes, and attachment input', () => {
    const resolver = new KwardCapabilityResolver({
      runtimeSettings: {
        supported: true,
        settings: ['defaultModel']
      },
      turns: {
        busyInput: {
          steer: 'native',
          followUp: 'unsupported'
        }
      },
      attachments: {
        input: { supported: true }
      }
    });

    assert.strictEqual(resolver.isRuntimeSettingSupported('defaultModel'), true);
    assert.strictEqual(resolver.isRuntimeSettingSupported('defaultThinkingLevel'), false);
    assert.strictEqual(resolver.isBusyInputModeSupported('steer'), true);
    assert.strictEqual(resolver.isBusyInputModeSupported('followUp'), false);
    assert.strictEqual(resolver.isAttachmentInputSupported(), true);
  });
});
