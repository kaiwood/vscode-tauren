import type { WebviewSettingsSection, WebviewSettingsViewState } from '../webviewProtocol/types';

const defaultSettingsSection: WebviewSettingsSection = 'providers';

export class SettingsViewController {
  private surfaceSide: 'front' | 'settings' = 'front';
  private activeSection: WebviewSettingsSection = defaultSettingsSection;

  public constructor(private readonly postState: () => void) {}

  public get isSettingsVisible(): boolean {
    return this.surfaceSide === 'settings';
  }

  public getWebviewState(): WebviewSettingsViewState | undefined {
    if (this.surfaceSide === 'front' && this.activeSection === defaultSettingsSection) {
      return undefined;
    }

    return {
      surfaceSide: this.surfaceSide,
      activeSection: this.activeSection
    };
  }

  public toggleSettings(): void {
    if (this.surfaceSide === 'settings') {
      this.hideSettings();
      return;
    }

    this.showSettings();
  }

  public showSettings(): void {
    if (this.surfaceSide === 'settings') {
      return;
    }

    this.surfaceSide = 'settings';
    this.postState();
  }

  public hideSettings(options: { post?: boolean } = {}): void {
    if (this.surfaceSide === 'front') {
      return;
    }

    this.surfaceSide = 'front';

    if (options.post !== false) {
      this.postState();
    }
  }

  public setActiveSection(section: WebviewSettingsSection): void {
    if (this.activeSection === section) {
      return;
    }

    this.activeSection = section;
    this.postState();
  }
}
