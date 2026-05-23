import type { SettingsSection, WebviewState } from '../types';

type SettingsPaneControllerOptions = {
  getState: () => WebviewState;
  postMessage: (message: unknown) => void;
  settingsElement: HTMLElement;
  settingsBodyElement: HTMLElement;
  settingsBackButton: HTMLButtonElement;
  focusPromptInput: () => void;
};

type SettingsSectionDefinition = {
  id: SettingsSection;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  cards: SettingsCardDefinition[];
};

type SettingsCardDefinition = {
  title: string;
  body: (state: WebviewState) => string;
  status?: (state: WebviewState) => string;
};

const settingsSections: SettingsSectionDefinition[] = [
  {
    id: 'providers',
    label: 'Providers',
    eyebrow: 'Connectivity',
    title: 'Providers',
    description: 'A home for provider accounts, routing, and health. Login flows are intentionally not wired yet.',
    cards: [
      {
        title: 'Provider slots',
        body: () => 'Reserved for configured Pi providers and account status.',
        status: () => 'Placeholder'
      },
      {
        title: 'Authentication',
        body: () => 'Future provider sign-in controls will live here without leaving the chat surface.',
        status: () => 'Not implemented'
      }
    ]
  },
  {
    id: 'models',
    label: 'Models',
    eyebrow: 'Selection',
    title: 'Models',
    description: 'Model inventory and defaults will be managed here. The current composer picker remains the source of truth for now.',
    cards: [
      {
        title: 'Current model',
        body: (state) => formatModelSummary(state),
        status: (state) => state.modelLabel || 'Waiting for Pi'
      },
      {
        title: 'Available models',
        body: (state) => `${state.modelOptions.length} model${state.modelOptions.length === 1 ? '' : 's'} reported by Pi metadata.`,
        status: () => 'Read-only'
      }
    ]
  },
  {
    id: 'runtime',
    label: 'Runtime',
    eyebrow: 'Session',
    title: 'Runtime',
    description: 'Runtime controls should make Pi process/session state visible before they mutate anything.',
    cards: [
      {
        title: 'Session state',
        body: (state) => state.busy ? 'Pi is currently working in this session.' : 'Pi is idle for this session.',
        status: (state) => state.busy ? 'Running' : 'Idle'
      },
      {
        title: 'Session binding',
        body: (state) => state.currentSessionName || state.currentSessionFile || 'No persisted session file is selected yet.',
        status: () => 'Observed'
      }
    ]
  },
  {
    id: 'appearance',
    label: 'Appearance',
    eyebrow: 'Surface',
    title: 'Appearance',
    description: 'Visual controls should feel native to the sidebar while preserving VS Code theme integration.',
    cards: [
      {
        title: 'Theme alignment',
        body: () => 'Tau follows VS Code colors and typography. Future display preferences can be staged here.',
        status: () => 'VS Code native'
      },
      {
        title: 'Motion',
        body: (state) => state.animationsEnabled ? 'Subtle surface transitions are enabled.' : 'Tau animations are disabled.',
        status: (state) => state.animationsEnabled ? 'Enabled' : 'Reduced'
      }
    ]
  },
  {
    id: 'advanced',
    label: 'Advanced',
    eyebrow: 'Diagnostics',
    title: 'Advanced',
    description: 'Advanced controls should stay explicit and inspectable, not hidden in JSON settings.',
    cards: [
      {
        title: 'Diagnostics',
        body: () => 'Reserved for transport diagnostics, logs, and reset actions.',
        status: () => 'Placeholder'
      },
      {
        title: 'Safety rails',
        body: () => 'Future dangerous actions should be grouped here with clear confirmation steps.',
        status: () => 'Planned'
      }
    ]
  }
];

export class SettingsPaneController {
  private renderedSection: SettingsSection | undefined;
  private wasVisible = false;

  public constructor(private readonly options: SettingsPaneControllerOptions) {}

  public attachEventListeners(): void {
    this.options.settingsBackButton.addEventListener('click', () => this.hideSettings({ focusPrompt: true }));

    this.options.settingsElement.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-settings-section]')
        : null;

      if (!button) {
        return;
      }

      const section = parseSettingsSection(button.dataset.settingsSection);

      if (section) {
        this.selectSection(section);
      }
    });

    this.options.settingsElement.addEventListener('keydown', (event) => this.handleSettingsKeydown(event));
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (this.options.getState().chatFace !== 'settings') {
      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.hideSettings({ focusPrompt: true });
      return true;
    }

    return false;
  }

  public syncForRender(isSessionLane: boolean): void {
    const state = this.options.getState();
    const visible = !isSessionLane && state.chatFace === 'settings';

    this.options.settingsElement.hidden = false;
    this.options.settingsElement.inert = !visible;
    this.options.settingsElement.setAttribute('aria-hidden', visible ? 'false' : 'true');
    this.options.settingsElement.tabIndex = visible ? 0 : -1;

    this.renderSection(state.settingsSection);

    if (visible && !this.wasVisible) {
      requestAnimationFrame(() => {
        if (this.options.getState().chatFace === 'settings') {
          this.focusActiveSectionButton();
        }
      });
    }

    this.wasVisible = visible;
  }

  private hideSettings(options: { focusPrompt?: boolean } = {}): void {
    this.options.postMessage({ type: 'hideChatFace' });

    if (options.focusPrompt) {
      this.options.focusPromptInput();
    }
  }

  private selectSection(section: SettingsSection): void {
    this.options.postMessage({ type: 'setSettingsSection', section });
  }

  private handleSettingsKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-settings-section]')) {
      return;
    }

    const currentIndex = settingsSections.findIndex((section) => section.id === this.options.getState().settingsSection);
    let nextIndex = currentIndex;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % settingsSections.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + settingsSections.length) % settingsSections.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = settingsSections.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const section = settingsSections[nextIndex];
    this.selectSection(section.id);
    requestAnimationFrame(() => this.focusSectionButton(section.id));
  }

  private renderSection(sectionId: SettingsSection): void {
    if (this.renderedSection === sectionId) {
      this.updateDynamicCardText(sectionId);
      return;
    }

    const state = this.options.getState();
    const section = getSettingsSection(sectionId);
    const nav = document.createElement('nav');
    nav.className = 'settings-surface__nav';
    nav.setAttribute('aria-label', 'Settings sections');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');

    for (const item of settingsSections) {
      const button = document.createElement('button');
      button.className = 'settings-surface__nav-item';
      button.type = 'button';
      button.dataset.settingsSection = item.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'settings-panel');
      button.textContent = item.label;
      nav.append(button);
    }

    const panel = document.createElement('section');
    panel.id = 'settings-panel';
    panel.className = 'settings-surface__panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', section.title);

    const intro = document.createElement('div');
    intro.className = 'settings-surface__intro';
    intro.append(createTextElement('div', 'settings-surface__section-eyebrow', section.eyebrow));
    intro.append(createTextElement('h3', 'settings-surface__section-title', section.title));
    intro.append(createTextElement('p', 'settings-surface__section-description', section.description));
    panel.append(intro);

    const cards = document.createElement('div');
    cards.className = 'settings-surface__cards';
    section.cards.forEach((card, index) => {
      const cardElement = document.createElement('article');
      cardElement.className = 'settings-surface__card';
      cardElement.dataset.cardIndex = String(index);
      const titleRow = document.createElement('div');
      titleRow.className = 'settings-surface__card-title-row';
      titleRow.append(createTextElement('h4', 'settings-surface__card-title', card.title));

      if (card.status) {
        titleRow.append(createTextElement('span', 'settings-surface__card-status', card.status(state)));
      }

      cardElement.append(titleRow, createTextElement('p', 'settings-surface__card-body', card.body(state)));
      cards.append(cardElement);
    });
    panel.append(cards);

    this.options.settingsBodyElement.replaceChildren(nav, panel);
    this.renderedSection = sectionId;
    this.syncNavState(sectionId);

    if (state.chatFace === 'settings') {
      requestAnimationFrame(() => this.focusSectionButton(sectionId));
    }
  }

  private updateDynamicCardText(sectionId: SettingsSection): void {
    const state = this.options.getState();
    const section = getSettingsSection(sectionId);

    for (const cardElement of this.options.settingsBodyElement.querySelectorAll<HTMLElement>('.settings-surface__card')) {
      const cardIndex = Number(cardElement.dataset.cardIndex);
      const card = section.cards[cardIndex];

      if (!card) {
        continue;
      }

      const body = cardElement.querySelector('.settings-surface__card-body');
      if (body) {
        body.textContent = card.body(state);
      }

      const status = cardElement.querySelector('.settings-surface__card-status');
      if (status && card.status) {
        status.textContent = card.status(state);
      }
    }

    this.syncNavState(sectionId);
  }

  private syncNavState(sectionId: SettingsSection): void {
    for (const button of this.options.settingsBodyElement.querySelectorAll<HTMLButtonElement>('[data-settings-section]')) {
      const selected = button.dataset.settingsSection === sectionId;
      button.classList.toggle('settings-surface__nav-item--active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
  }

  private focusActiveSectionButton(): void {
    this.focusSectionButton(this.options.getState().settingsSection);
  }

  private focusSectionButton(section: SettingsSection): void {
    this.options.settingsBodyElement
      .querySelector<HTMLButtonElement>(`[data-settings-section="${section}"]`)
      ?.focus({ preventScroll: true });
  }
}

function getSettingsSection(sectionId: SettingsSection): SettingsSectionDefinition {
  return settingsSections.find((section) => section.id === sectionId) ?? settingsSections[0];
}

function parseSettingsSection(value: unknown): SettingsSection | undefined {
  return settingsSections.some((section) => section.id === value) ? value as SettingsSection : undefined;
}

function createTextElement(tagName: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatModelSummary(state: WebviewState): string {
  if (!state.modelLabel) {
    return 'Pi has not reported live model metadata yet.';
  }

  const provider = state.modelProvider ? ` via ${state.modelProvider}` : '';
  const reasoning = state.modelReasoning ? ' Reasoning is available for this model.' : '';
  return `${state.modelLabel}${provider}.${reasoning}`;
}
