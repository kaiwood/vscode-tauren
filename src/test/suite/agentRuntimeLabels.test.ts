import * as assert from 'assert';
import { getAgentRuntimeLabel, getAgentRuntimeWorkingText } from '../../shared/agentRuntimeLabels';

suite('Agent runtime labels', () => {
  test('uses Pi engine label by default', () => {
    assert.strictEqual(getAgentRuntimeLabel(undefined), 'Pi engine');
    assert.strictEqual(getAgentRuntimeWorkingText(undefined), 'Pi engine is working');
    assert.strictEqual(getAgentRuntimeWorkingText(undefined, { ellipsis: true }), 'Pi engine is working...');
  });

  test('uses Kward label for Kward backend', () => {
    assert.strictEqual(getAgentRuntimeLabel('kward'), 'Kward');
    assert.strictEqual(getAgentRuntimeWorkingText('kward'), 'Kward is working');
    assert.strictEqual(getAgentRuntimeWorkingText('kward', { ellipsis: true }), 'Kward is working...');
  });
});
