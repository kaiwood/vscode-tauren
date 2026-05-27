import * as assert from 'assert';
import { getSteppedThinkingLevel } from '../../controller/thinkingLevelSteps';

suite('thinkingLevelSteps', () => {
  test('raises through existing thinking picker order', () => {
    assert.strictEqual(getSteppedThinkingLevel('off', 'raise'), 'minimal');
    assert.strictEqual(getSteppedThinkingLevel('minimal', 'raise'), 'low');
    assert.strictEqual(getSteppedThinkingLevel('low', 'raise'), 'medium');
    assert.strictEqual(getSteppedThinkingLevel('medium', 'raise'), 'high');
    assert.strictEqual(getSteppedThinkingLevel('high', 'raise'), 'xhigh');
  });

  test('lowers through existing thinking picker order', () => {
    assert.strictEqual(getSteppedThinkingLevel('xhigh', 'lower'), 'high');
    assert.strictEqual(getSteppedThinkingLevel('high', 'lower'), 'medium');
    assert.strictEqual(getSteppedThinkingLevel('medium', 'lower'), 'low');
    assert.strictEqual(getSteppedThinkingLevel('low', 'lower'), 'minimal');
    assert.strictEqual(getSteppedThinkingLevel('minimal', 'lower'), 'off');
  });

  test('clamps at bounds and ignores unknown levels', () => {
    assert.strictEqual(getSteppedThinkingLevel('xhigh', 'raise'), undefined);
    assert.strictEqual(getSteppedThinkingLevel('off', 'lower'), undefined);
    assert.strictEqual(getSteppedThinkingLevel('', 'raise'), undefined);
  });
});
