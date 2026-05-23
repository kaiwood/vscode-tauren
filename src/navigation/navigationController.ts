import type { WebviewChatFace, WebviewLane, WebviewNavigationState } from '../webviewProtocol/types';

export class NavigationController {
  private activeLane: WebviewLane = 'chat';
  private activeChatFace: WebviewChatFace = 'main';

  public constructor(private readonly postState: () => void) {}

  public get lane(): WebviewLane {
    return this.activeLane;
  }

  public get chatFace(): WebviewChatFace {
    return this.activeChatFace;
  }

  public get isSessionListVisible(): boolean {
    return this.activeLane === 'sessions';
  }

  public get isTreeVisible(): boolean {
    return this.activeLane === 'tree';
  }

  public get isSettingsVisible(): boolean {
    return this.activeLane === 'chat' && this.activeChatFace === 'settings';
  }

  public getWebviewState(): WebviewNavigationState | undefined {
    const state: WebviewNavigationState = {};

    if (this.activeLane !== 'chat') {
      state.lane = this.activeLane;
    }

    if (this.activeChatFace !== 'main') {
      state.chatFace = this.activeChatFace;
    }

    return state.lane || state.chatFace ? state : undefined;
  }

  public showLane(lane: WebviewLane, options: { post?: boolean } = {}): void {
    if (this.activeLane === lane && this.activeChatFace === 'main') {
      return;
    }

    this.activeLane = lane;
    this.activeChatFace = 'main';
    this.post(options);
  }

  public showChatFace(chatFace: WebviewChatFace, options: { post?: boolean } = {}): void {
    if (this.activeLane === 'chat' && this.activeChatFace === chatFace) {
      return;
    }

    this.activeLane = 'chat';
    this.activeChatFace = chatFace;
    this.post(options);
  }

  public hideChatFace(options: { post?: boolean } = {}): void {
    this.showChatFace('main', options);
  }

  public showChatMain(options: { post?: boolean } = {}): void {
    if (this.activeLane === 'chat' && this.activeChatFace === 'main') {
      return;
    }

    this.activeLane = 'chat';
    this.activeChatFace = 'main';
    this.post(options);
  }

  private post(options: { post?: boolean }): void {
    if (options.post !== false) {
      this.postState();
    }
  }
}
