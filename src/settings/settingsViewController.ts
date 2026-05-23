import type { NavigationController } from '../navigation/navigationController';
import type { WebviewSettingsSection, WebviewSettingsViewState } from '../webviewProtocol/types';

const defaultSettingsSection: WebviewSettingsSection = 'providers';

export class SettingsViewController {
  private activeSection: WebviewSettingsSection = defaultSettingsSection;

  public constructor(
    private readonly navigation: NavigationController,
    private readonly postState: () => void
  ) {}

  public get isSettingsVisible(): boolean {
    return this.navigation.isSettingsVisible;
  }

  public getWebviewState(): WebviewSettingsViewState | undefined {
    if (this.activeSection === defaultSettingsSection) {
      return undefined;
    }

    return {
      activeSection: this.activeSection
    };
  }

  public toggleSettings(): void {
    if (this.navigation.isSettingsVisible) {
      this.hideSettings();
      return;
    }

    this.showSettings();
  }

  public showSettings(): void {
    this.navigation.showChatFace('settings');
  }

  public hideSettings(options: { post?: boolean } = {}): void {
    this.navigation.hideChatFace(options);
  }

  public setActiveSection(section: WebviewSettingsSection): void {
    if (this.activeSection === section) {
      return;
    }

    this.activeSection = section;
    this.postState();
  }
}
