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

  test('requires method lists on supported method groups', () => {
    const resolver = new KwardCapabilityResolver({
      auth: {
        supported: true,
        methods: ['auth/providers', 'auth/loginWithApiKey']
      },
      runtimeSettings: {
        supported: false,
        methods: ['runtime/reload']
      }
    });

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

    const resolver = new KwardCapabilityResolver({
      extensionUi: {
        question: {
          notification: 'custom/question',
          method: 'custom/answerQuestion'
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
