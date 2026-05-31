import type { WebviewState } from './types';

export type ChatLaneLayoutState = {
  isSessionLane: boolean;
  isSettingsFaceVisible: boolean;
  hiddenBySurface: boolean;
  reserveBottomSurfaceLayout: boolean;
};

export function getChatLaneLayout(state: Pick<WebviewState, 'lane' | 'chatFace'>): ChatLaneLayoutState {
  const isSessionLane = state.lane === 'sessions' || state.lane === 'tree';
  const isSettingsFaceVisible = !isSessionLane && state.chatFace === 'settings';

  return {
    isSessionLane,
    isSettingsFaceVisible,
    hiddenBySurface: isSessionLane || isSettingsFaceVisible,
    reserveBottomSurfaceLayout: isSessionLane
  };
}
