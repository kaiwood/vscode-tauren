import * as assert from 'assert';
import { getChatLaneLayout } from '../../webview/chatLaneLayout';

suite('Webview chat lane layout', () => {
  test('keeps bottom-surface layout reserved while session lanes are active', () => {
    assert.deepStrictEqual(getChatLaneLayout({ lane: 'sessions', chatFace: 'main' }), {
      isSessionLane: true,
      isSettingsFaceVisible: false,
      hiddenBySurface: true,
      reserveBottomSurfaceLayout: true
    });

    assert.deepStrictEqual(getChatLaneLayout({ lane: 'tree', chatFace: 'main' }), {
      isSessionLane: true,
      isSettingsFaceVisible: false,
      hiddenBySurface: true,
      reserveBottomSurfaceLayout: true
    });
  });

  test('collapses bottom surfaces for the settings face', () => {
    assert.deepStrictEqual(getChatLaneLayout({ lane: 'chat', chatFace: 'settings' }), {
      isSessionLane: false,
      isSettingsFaceVisible: true,
      hiddenBySurface: true,
      reserveBottomSurfaceLayout: false
    });
  });

  test('shows chat bottom surfaces for the main chat face', () => {
    assert.deepStrictEqual(getChatLaneLayout({ lane: 'chat', chatFace: 'main' }), {
      isSessionLane: false,
      isSettingsFaceVisible: false,
      hiddenBySurface: false,
      reserveBottomSurfaceLayout: false
    });
  });
});
