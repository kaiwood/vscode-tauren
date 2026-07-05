import { getSettingsForSection, settingDefinitions, settingsSections, type SettingDefinition, type SettingOption, type SettingValue } from '../../settings/settingsRegistry';
import { parseWebviewSettingsSection } from '../../webviewProtocol/values';
import { getModelFullId, getScopedModelSelection, normalizeScopedModelSelection } from '../scopedModels';
import type { SettingsSection, WebviewState } from '../types';

type SettingsPaneControllerOptions = {
  getState: () => WebviewState;
  postMessage: (message: unknown) => void;
  settingsElement: HTMLElement;
  settingsBodyElement: HTMLElement;
  settingsBackButton: HTMLButtonElement;
  focusPromptInput: () => void;
};

export class SettingsPaneController {
  private renderedSignature = '';
  private wasVisible = false;
  private scopedModelsProviderFilter: string | undefined;

  public constructor(private readonly options: SettingsPaneControllerOptions) {}

  public attachEventListeners(): void {
    this.options.settingsBackButton.addEventListener('click', () => this.hideSettings({ focusPrompt: true }));

    this.options.settingsElement.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const authButton = target?.closest<HTMLButtonElement>('[data-auth-action]');

      if (authButton) {
        this.handleAuthAction(authButton);
        return;
      }

      const voiceButton = target?.closest<HTMLButtonElement>('[data-voice-action]') ?? null;

      if (voiceButton) {
        this.handleVoiceAction(voiceButton);
        return;
      }

      const scopedModelsButton = target?.closest<HTMLButtonElement>('[data-scoped-model-action]') ?? null;

      if (scopedModelsButton) {
        this.handleScopedModelsAction(scopedModelsButton);
        return;
      }

      const button = target?.closest<HTMLButtonElement>('[data-settings-section]') ?? null;

      if (!button) {
        return;
      }

      const section = parseWebviewSettingsSection(button.dataset.settingsSection);

      if (section) {
        this.selectSection(section);
      }
    });

    this.options.settingsElement.addEventListener('change', (event) => this.handleSettingChange(event));
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

  private handleAuthAction(button: HTMLButtonElement): void {
    const action = button.dataset.authAction;

    if (action === 'refresh') {
      this.options.postMessage({ type: 'authRefresh' });
      return;
    }

    if (action === 'cancel') {
      this.options.postMessage({ type: 'authCancel' });
      return;
    }

    if (action === 'loginSelected') {
      const authType = button.dataset.authType;
      const select = authType
        ? this.options.settingsBodyElement.querySelector<HTMLSelectElement>(`[data-auth-select="${authType}"]`)
        : undefined;
      const providerId = select?.value;
      if (providerId && (authType === 'oauth' || authType === 'api_key')) {
        this.options.postMessage({ type: 'authLogin', providerId, authType });
      }
      return;
    }

    const providerId = button.dataset.authProviderId;
    if (!providerId) {
      return;
    }

    if (action === 'login') {
      const authType = button.dataset.authType;
      this.options.postMessage({
        type: 'authLogin',
        providerId,
        ...(authType === 'oauth' || authType === 'api_key' ? { authType } : {})
      });
    } else if (action === 'logout') {
      this.options.postMessage({ type: 'authLogout', providerId });
    }
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

  private handleSettingChange(event: Event): void {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target instanceof HTMLInputElement && target.dataset.scopedModelId) {
      this.handleScopedModelsToggle(target);
      return;
    }

    const settingId = target.dataset.settingId;
    const definition = settingDefinitions.find((item) => item.id === settingId) as SettingDefinition | undefined;

    if (!definition || definition.readOnly) {
      return;
    }

    const value = target instanceof HTMLInputElement && target.type === 'checkbox'
      ? target.checked
      : target.value;

    this.options.postMessage({ type: 'updateSetting', settingId: definition.id, value });
  }

  private handleVoiceAction(button: HTMLButtonElement): void {
    const action = button.dataset.voiceAction;
    const modelId = button.dataset.voiceModelId;

    if (action === 'downloadBinary') {
      this.options.postMessage({ type: 'voiceDownloadBinary' });
    } else if (action === 'refreshInputDevices') {
      this.options.postMessage({ type: 'voiceRefreshInputDevices' });
    } else if (action === 'downloadModel') {
      this.options.postMessage({ type: 'voiceDownloadModel', ...(modelId ? { modelId } : {}) });
    } else if (action === 'deleteModel' && modelId) {
      this.options.postMessage({ type: 'voiceDeleteModel', modelId });
    }
  }

  private handleScopedModelsToggle(input: HTMLInputElement): void {
    const modelId = input.dataset.scopedModelId;
    if (!modelId) {
      return;
    }

    const state = this.options.getState();
    const selection = getScopedModelSelection(state);
    const nextIds = input.checked
      ? [...selection.enabledIds, modelId]
      : selection.enabledIds.filter((id) => id !== modelId);

    this.postScopedModelsUpdate(normalizeScopedModelSelection(nextIds, state.modelOptions));
  }

  private handleScopedModelsAction(button: HTMLButtonElement): void {
    const state = this.options.getState();
    const selection = getScopedModelSelection(state);
    const action = button.dataset.scopedModelAction;

    if (action === 'showAll') {
      this.scopedModelsProviderFilter = undefined;
      this.rerenderSettingsSection();
      return;
    }

    if (action === 'provider') {
      const provider = button.dataset.scopedProvider;
      if (!provider) {
        return;
      }

      this.scopedModelsProviderFilter = provider;
      this.rerenderSettingsSection();
      return;
    }

    if (action === 'selectVisible' || action === 'unselectVisible') {
      const visibleIds = getVisibleScopedModels(selection, this.scopedModelsProviderFilter).map(getModelFullId);
      const selectedIds = selection.enabledIds;
      const visibleSet = new Set(visibleIds);
      const nextIds = action === 'selectVisible'
        ? [...selectedIds, ...visibleIds.filter((id) => !selectedIds.includes(id))]
        : selectedIds.filter((id) => !visibleSet.has(id));
      this.postScopedModelsUpdate(normalizeScopedModelSelection(nextIds, state.modelOptions));
      return;
    }

    if (action === 'moveUp' || action === 'moveDown') {
      if (selection.allEnabled) {
        return;
      }

      const modelId = button.dataset.scopedModelId;
      const index = modelId ? selection.enabledIds.indexOf(modelId) : -1;
      const delta = action === 'moveUp' ? -1 : 1;
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= selection.enabledIds.length) {
        return;
      }

      const nextIds = selection.enabledIds.slice();
      [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
      this.postScopedModelsUpdate(nextIds);
    }
  }

  private postScopedModelsUpdate(enabledModelIds: string[]): void {
    this.options.postMessage({ type: 'updateSetting', settingId: 'enabledModels', value: enabledModelIds });
  }

  private rerenderSettingsSection(): void {
    this.renderedSignature = '';
    this.renderSection(this.options.getState().settingsSection);
  }

  private renderSection(sectionId: SettingsSection): void {
    const state = this.options.getState();
    const signature = createSettingsSignature(sectionId, state, this.scopedModelsProviderFilter);

    if (this.renderedSignature === signature) {
      this.syncNavState(sectionId);
      return;
    }

    const section = settingsSections.find((item) => item.id === sectionId) ?? settingsSections[0];
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

    if (section.id === 'login') {
      this.appendAuthCards(cards, state);
    } else if (section.id === 'voice') {
      this.appendVoiceCards(cards, state);
    } else {
      for (const definition of getVisibleSettingsForSection(section.id, state)) {
        cards.append(this.createSettingCard(definition, state));
      }

      if (cards.childElementCount === 0 && state.settings.values['tauren.backend'] === 'kward') {
        cards.append(createKwardUnsupportedSettingsEmptyState());
      }
    }

    panel.append(cards);
    this.options.settingsBodyElement.replaceChildren(nav, panel);
    this.renderedSignature = signature;
    this.syncNavState(sectionId);

    if (state.chatFace === 'settings') {
      requestAnimationFrame(() => this.focusSectionButton(sectionId));
    }
  }

  private appendVoiceCards(cards: HTMLElement, state: WebviewState): void {
    const voice = state.voice;
    if (!voice) {
      const card = document.createElement('article');
      card.className = 'settings-surface__card';
      card.append(createTextElement('h4', 'settings-surface__card-title', 'Voice assets'));
      card.append(createTextElement('p', 'settings-surface__card-body', 'Voice state is not available yet.'));
      cards.append(card);
      return;
    }

    for (const definition of getVisibleSettingsForSection('voice', state)) {
      if (definition.id !== 'tauren.voice.inputDevice') {
        cards.append(this.createSettingCard(definition, state));
      }
    }

    if (voice.languageForced) {
      const card = document.createElement('article');
      card.className = 'settings-surface__card';
      card.append(createTextElement('h4', 'settings-surface__card-title', 'Language forced to English'));
      card.append(createTextElement('p', 'settings-surface__card-helper', 'The selected English-only Whisper model always uses English. Choose a multilingual model for auto-detect or non-English input.'));
      cards.append(card);
    }

    cards.append(this.createVoiceInputDeviceCard(voice));
    cards.append(this.createVoiceBinaryCard(voice));
    cards.append(this.createVoiceModelCard(voice));
  }

  private createVoiceInputDeviceCard(voice: NonNullable<WebviewState['voice']>): HTMLElement {
    const card = document.createElement('article');
    card.className = 'settings-surface__card';
    card.append(createTextElement('h4', 'settings-surface__card-title', 'Input device'));
    card.append(createTextElement('p', 'settings-surface__card-body', 'Choose which microphone or audio source Tauren records from.'));

    const select = document.createElement('select');
    select.className = 'settings-surface__select';
    select.dataset.settingId = 'tauren.voice.inputDevice';
    select.disabled = voice.recordingStatus === 'recording' || voice.recordingStatus === 'transcribing';

    for (const device of voice.inputDevices.devices) {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.label;
      option.selected = device.id === voice.inputDevices.selectedId;
      select.append(option);
    }

    card.append(select);

    const toolbar = document.createElement('div');
    toolbar.className = 'settings-surface__auth-toolbar';
    const refreshButton = this.createVoiceButton(voice.inputDevices.status === 'refreshing' ? 'Refreshing…' : 'Refresh devices', 'refreshInputDevices');
    refreshButton.disabled = voice.inputDevices.status === 'refreshing';
    toolbar.append(refreshButton);
    card.append(toolbar);

    const statusLabel = voice.inputDevices.status === 'ready'
      ? `${Math.max(voice.inputDevices.devices.length - 1, 0)} input device${voice.inputDevices.devices.length === 2 ? '' : 's'} detected.`
      : voice.inputDevices.status === 'refreshing'
        ? 'Looking for input devices…'
        : 'Click Refresh devices to detect available microphones.';
    card.append(createTextElement('p', 'settings-surface__card-helper', statusLabel));

    if (voice.inputDevices.error) {
      card.append(createTextElement('p', 'settings-surface__card-error', voice.inputDevices.error));
    }

    return card;
  }

  private createVoiceBinaryCard(voice: NonNullable<WebviewState['voice']>): HTMLElement {
    const card = document.createElement('article');
    card.className = 'settings-surface__card';
    card.append(createTextElement('h4', 'settings-surface__card-title', 'whisper.cpp runtime'));
    card.append(createTextElement('p', 'settings-surface__card-body', voice.binary.source === 'system' && voice.binary.path
      ? `${voice.binary.label}: ${voice.binary.path}`
      : voice.binary.label));
    card.append(createTextElement('p', 'settings-surface__card-helper', voice.binary.helper ?? getVoiceDownloadLabel(voice.binary.download)));

    const button = this.createVoiceButton(voice.binary.status === 'failed' ? 'Retry runtime download' : 'Download runtime', 'downloadBinary');
    button.disabled = voice.binary.status === 'downloaded' || voice.binary.status === 'downloading' || voice.binary.status === 'unavailable';
    card.append(button);

    if (voice.binary.download.error) {
      card.append(createTextElement('p', 'settings-surface__card-error', voice.binary.download.error));
    }

    return card;
  }

  private createVoiceModelCard(voice: NonNullable<WebviewState['voice']>): HTMLElement {
    const card = document.createElement('article');
    card.className = 'settings-surface__card';
    card.append(createTextElement('h4', 'settings-surface__card-title', 'Downloaded models'));

    for (const model of voice.models) {
      const row = document.createElement('div');
      row.className = 'settings-surface__auth-toolbar';
      row.append(createTextElement('span', 'settings-surface__card-body', `${model.label} · ${formatVoiceBytes(model.sizeBytes)} · ${getVoiceDownloadLabel(model.download)}`));

      const downloadButton = this.createVoiceButton(model.download.status === 'failed' ? 'Retry' : 'Download', 'downloadModel', model.id);
      downloadButton.disabled = model.downloaded || model.download.status === 'downloading';
      row.append(downloadButton);

      const deleteButton = this.createVoiceButton('Delete', 'deleteModel', model.id);
      deleteButton.disabled = !model.downloaded || model.id === voice.selectedModelId;
      row.append(deleteButton);
      card.append(row);

      if (model.download.error) {
        card.append(createTextElement('p', 'settings-surface__card-error', model.download.error));
      }
    }

    if (voice.error) {
      card.append(createTextElement('p', 'settings-surface__card-error', voice.error));
    }

    return card;
  }

  private createVoiceButton(label: string, action: string, modelId?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'settings-surface__button';
    button.type = 'button';
    button.textContent = label;
    button.dataset.voiceAction = action;
    if (modelId) {
      button.dataset.voiceModelId = modelId;
    }
    return button;
  }

  private appendAuthCards(cards: HTMLElement, state: WebviewState): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'settings-surface__auth-toolbar';
    const refreshButton = this.createAuthButton('Refresh', 'refresh', undefined, Boolean(state.auth.refreshing || state.auth.busyProviderId));
    toolbar.append(refreshButton);

    if (state.auth.busyProviderId) {
      toolbar.append(this.createAuthButton('Cancel', 'cancel', undefined, false));
    }

    cards.append(toolbar);

    if (state.auth.progress) {
      cards.append(this.createAuthProgressCard(state));
    }

    if (state.auth.error) {
      const errorCard = document.createElement('article');
      errorCard.className = 'settings-surface__card settings-surface__card--danger';
      errorCard.append(createTextElement('h4', 'settings-surface__card-title', 'Login error'));
      errorCard.append(createTextElement('p', 'settings-surface__card-error', state.auth.error));
      cards.append(errorCard);
    }

    const providers = state.auth.providers;
    if (providers.length === 0) {
      const emptyCard = document.createElement('article');
      emptyCard.className = 'settings-surface__card';
      emptyCard.append(createTextElement('h4', 'settings-surface__card-title', state.auth.refreshing ? 'Loading providers…' : 'No providers loaded'));
      emptyCard.append(createTextElement('p', 'settings-surface__card-body', 'Refresh to load Pi runtime authentication providers.'));
      cards.append(emptyCard);
      return;
    }

    cards.append(this.createAuthLoginCard('oauth', providers.filter((provider) => provider.authType === 'oauth'), state));
    cards.append(this.createAuthLoginCard('api_key', providers.filter((provider) => provider.authType === 'api_key'), state));

    const activeProviders = providers.filter((provider) => provider.canLogout);
    const separator = document.createElement('div');
    separator.className = 'settings-surface__auth-separator';
    separator.setAttribute('role', 'separator');
    cards.append(separator);

    const activeGroup = document.createElement('div');
    activeGroup.className = 'settings-surface__auth-group';
    activeGroup.append(createTextElement('div', 'settings-surface__section-eyebrow', 'Active providers'));

    if (activeProviders.length === 0) {
      const emptyActiveCard = document.createElement('article');
      emptyActiveCard.className = 'settings-surface__card';
      emptyActiveCard.append(createTextElement('h4', 'settings-surface__card-title', 'No active stored logins'));
      emptyActiveCard.append(createTextElement('p', 'settings-surface__card-body', 'Environment variables and models.json credentials may still be active outside Tauren logout.'));
      activeGroup.append(emptyActiveCard);
    } else {
      for (const provider of activeProviders) {
        activeGroup.append(this.createActiveAuthProviderCard(provider, state));
      }
    }

    cards.append(activeGroup);
  }

  private createAuthLoginCard(authType: 'oauth' | 'api_key', providers: WebviewState['auth']['providers'], state: WebviewState): HTMLElement {
    const card = document.createElement('article');
    card.className = 'settings-surface__card';

    const title = authType === 'oauth' ? 'OAuth login' : 'API key login';
    card.append(createTextElement('h4', 'settings-surface__card-title', title));
    card.append(createTextElement(
      'p',
      'settings-surface__card-body',
      authType === 'oauth'
        ? 'Choose a subscription provider and complete OAuth in your browser.'
        : 'Choose a provider and store an API key in Pi auth.json.'
    ));

    const select = document.createElement('select');
    select.className = 'settings-surface__select';
    select.dataset.authSelect = authType;
    select.disabled = providers.length === 0 || Boolean(state.auth.busyProviderId || state.busy);

    if (providers.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = authType === 'oauth' ? 'No OAuth providers available' : 'No API key providers available';
      select.append(option);
    } else {
      for (const provider of providers) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.configured ? `${provider.name} (${getAuthStatusLabel(provider)})` : provider.name;
        select.append(option);
      }
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'settings-surface__auth-actions';
    const loginButton = this.createAuthButton('Login / Replace', 'loginSelected', undefined, providers.length === 0 || Boolean(state.auth.busyProviderId || state.busy));
    loginButton.dataset.authType = authType;
    actionRow.append(loginButton);

    const control = document.createElement('div');
    control.className = 'settings-surface__control';
    control.append(select, actionRow);
    card.append(control);

    return card;
  }

  private createAuthProgressCard(state: WebviewState): HTMLElement {
    const progress = state.auth.progress;
    const card = document.createElement('article');
    card.className = 'settings-surface__card';
    card.append(createTextElement('h4', 'settings-surface__card-title', 'Authentication in progress'));

    if (!progress) {
      return card;
    }

    card.append(createTextElement('p', 'settings-surface__card-body', progress.message));

    if (progress.userCode) {
      const code = document.createElement('code');
      code.className = 'settings-surface__auth-code';
      code.textContent = progress.userCode;
      card.append(code);
    }

    if (progress.url || progress.verificationUri) {
      card.append(createTextElement('p', 'settings-surface__card-helper', progress.url ?? progress.verificationUri ?? ''));
    }

    return card;
  }

  private createActiveAuthProviderCard(provider: WebviewState['auth']['providers'][number], state: WebviewState): HTMLElement {
    const card = document.createElement('article');
    card.className = 'settings-surface__card';

    const titleRow = document.createElement('div');
    titleRow.className = 'settings-surface__card-title-row';
    titleRow.append(createTextElement('h4', 'settings-surface__card-title', provider.name));
    titleRow.append(createTextElement('span', 'settings-surface__card-status settings-surface__card-status--pi', getAuthStatusLabel(provider)));

    const actionRow = document.createElement('div');
    actionRow.className = 'settings-surface__auth-actions';
    actionRow.append(this.createAuthButton('Logout', 'logout', provider.id, Boolean(state.auth.busyProviderId || state.busy)));

    card.append(
      titleRow,
      createTextElement('p', 'settings-surface__card-body', provider.authType === 'oauth' ? 'Stored OAuth subscription credentials.' : 'Stored API key credentials.'),
      actionRow
    );

    if (provider.label || provider.source) {
      card.append(createTextElement('p', 'settings-surface__card-helper', provider.label ?? `Configured via ${provider.source}`));
    }

    return card;
  }

  private createAuthButton(label: string, action: string, providerId: string | undefined, disabled: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'settings-surface__button';
    button.type = 'button';
    button.textContent = label;
    button.dataset.authAction = action;
    button.disabled = disabled;

    if (providerId) {
      button.dataset.authProviderId = providerId;
    }

    return button;
  }

  private createSettingCard(definition: SettingDefinition, state: WebviewState): HTMLElement {
    const value = getSettingValue(definition, state);
    const cardElement = document.createElement('article');
    cardElement.className = 'settings-surface__card';
    cardElement.classList.toggle('settings-surface__card--danger', Boolean(definition.danger));
    cardElement.classList.toggle('settings-surface__card--subtle', Boolean(definition.subtle));

    const titleRow = document.createElement('div');
    titleRow.className = 'settings-surface__card-title-row';
    titleRow.append(createTextElement('h4', 'settings-surface__card-title', definition.label));
    titleRow.append(createTextElement('span', `settings-surface__card-status settings-surface__card-status--${definition.owner}`, definition.owner === 'tauren' ? 'Tauren' : 'Pi'));

    const control = this.createControl(definition, value, state);
    const body = createTextElement('p', 'settings-surface__card-body', definition.description);
    const helperText = getHelperText(definition);
    const helper = helperText ? createTextElement('p', 'settings-surface__card-helper', helperText) : undefined;
    const error = state.settings.errors?.[definition.id]
      ? createTextElement('p', 'settings-surface__card-error', state.settings.errors[definition.id] ?? '')
      : undefined;

    cardElement.append(titleRow, body, control);

    if (helper) {
      cardElement.append(helper);
    }

    if (error) {
      cardElement.append(error);
    }

    return cardElement;
  }

  private createControl(definition: SettingDefinition, value: SettingValue, state: WebviewState): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-surface__control';

    if (definition.control === 'toggle') {
      const label = document.createElement('label');
      label.className = 'settings-surface__toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.settingId = definition.id;
      input.checked = value === true;
      input.disabled = definition.readOnly === true || state.busy;
      label.append(input, document.createElement('span'));
      wrapper.append(label);
      return wrapper;
    }

    if (definition.control === 'select') {
      const select = document.createElement('select');
      select.className = 'settings-surface__select';
      select.dataset.settingId = definition.id;
      select.disabled = definition.readOnly === true || state.busy;

      const options = getSettingOptions(definition, state);
      if (options.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Waiting for Pi…';
        select.append(option);
        select.disabled = true;
      }

      for (const item of options) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        select.append(option);
      }

      select.value = typeof value === 'string' ? value : '';
      wrapper.append(select);
      return wrapper;
    }

    if (definition.control === 'text') {
      const input = document.createElement('input');
      input.className = 'settings-surface__text';
      input.type = 'text';
      input.dataset.settingId = definition.id;
      input.value = typeof value === 'string' ? value : '';
      input.disabled = definition.readOnly === true;
      wrapper.append(input);
      return wrapper;
    }

    if (definition.control === 'scopedModels') {
      wrapper.append(this.createScopedModelsControl(state));
      return wrapper;
    }

    const list = document.createElement('div');
    list.className = 'settings-surface__readonly-list';
    const values = Array.isArray(value) ? value : [];

    if (values.length === 0) {
      list.textContent = 'No scoped model patterns configured.';
    } else {
      for (const entry of values) {
        const item = document.createElement('code');
        item.textContent = entry;
        list.append(item);
      }
    }

    wrapper.append(list);
    return wrapper;
  }

  private createScopedModelsControl(state: WebviewState): HTMLElement {
    const container = document.createElement('div');
    container.className = 'settings-surface__scoped-models';

    if (state.modelOptions.length === 0) {
      container.append(createTextElement('p', 'settings-surface__card-helper', state.metadataRefreshing ? 'Loading models…' : 'No models available yet.'));
      return container;
    }

    const selection = getScopedModelSelection(state);
    const summary = selection.allEnabled
      ? 'All models are enabled for cycling.'
      : `${selection.enabledIds.length}/${state.modelOptions.length} models enabled for cycling.`;
    container.append(createTextElement('p', 'settings-surface__card-helper', summary));

    const visibleModels = getVisibleScopedModels(selection, this.scopedModelsProviderFilter);
    const filterToolbar = document.createElement('div');
    filterToolbar.className = 'settings-surface__scoped-toolbar';
    filterToolbar.append(this.createScopedModelsButton('All models', 'showAll', state.busy, this.scopedModelsProviderFilter === undefined));

    for (const provider of Array.from(new Set(state.modelOptions.map((model) => model.provider))).sort()) {
      const button = this.createScopedModelsButton(provider, 'provider', state.busy, this.scopedModelsProviderFilter === provider);
      button.dataset.scopedProvider = provider;
      filterToolbar.append(button);
    }

    const separator = document.createElement('div');
    separator.className = 'settings-surface__scoped-separator';
    separator.setAttribute('role', 'separator');

    const actionToolbar = document.createElement('div');
    actionToolbar.className = 'settings-surface__scoped-toolbar settings-surface__scoped-toolbar--actions';
    actionToolbar.append(this.createScopedModelsButton('Select', 'selectVisible', state.busy || visibleModels.length === 0));
    actionToolbar.append(this.createScopedModelsButton('Unselect', 'unselectVisible', state.busy || visibleModels.length === 0));

    container.append(filterToolbar, separator, actionToolbar);

    const list = document.createElement('div');
    list.className = 'settings-surface__scoped-list';

    for (const group of groupScopedModelsByProvider(visibleModels)) {
      const providerIds = group.models.map(getModelFullId);
      const enabledCount = selection.allEnabled
        ? providerIds.length
        : providerIds.filter((id) => selection.enabledIds.includes(id)).length;
      const groupElement = document.createElement('section');
      groupElement.className = 'settings-surface__scoped-provider';
      groupElement.setAttribute('aria-label', `${group.provider} scoped models`);

      const header = document.createElement('div');
      header.className = 'settings-surface__scoped-provider-header';
      const title = document.createElement('div');
      title.className = 'settings-surface__scoped-provider-title';
      title.textContent = group.provider;
      const count = document.createElement('span');
      count.className = 'settings-surface__scoped-provider-count';
      count.textContent = `${enabledCount}/${providerIds.length} selected`;
      title.append(count);

      header.append(title);
      groupElement.append(header);

      for (const model of group.models) {
        const fullId = getModelFullId(model);
        const enabled = selection.allEnabled || selection.enabledIds.includes(fullId);
        const row = document.createElement('div');
        row.className = 'settings-surface__scoped-row';
        row.classList.toggle('settings-surface__scoped-row--disabled', !enabled);

        const label = document.createElement('label');
        label.className = 'settings-surface__scoped-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.scopedModelId = fullId;
        checkbox.checked = enabled;
        checkbox.disabled = state.busy;
        label.append(checkbox, document.createTextNode(model.name || model.id));

        const meta = document.createElement('span');
        meta.className = 'settings-surface__scoped-meta';
        meta.textContent = fullId;

        const actions = document.createElement('div');
        actions.className = 'settings-surface__scoped-actions';
        const moveUp = this.createScopedModelsButton('Up', 'moveUp', state.busy || selection.allEnabled || !enabled);
        moveUp.dataset.scopedModelId = fullId;
        const moveDown = this.createScopedModelsButton('Down', 'moveDown', state.busy || selection.allEnabled || !enabled);
        moveDown.dataset.scopedModelId = fullId;
        actions.append(moveUp, moveDown);

        row.append(label, meta, actions);
        groupElement.append(row);
      }

      list.append(groupElement);
    }

    container.append(list);
    return container;
  }

  private createScopedModelsButton(label: string, action: string, disabled: boolean, active = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'settings-surface__button settings-surface__button--compact';
    button.classList.toggle('settings-surface__button--active', active);
    button.type = 'button';
    button.textContent = label;
    button.dataset.scopedModelAction = action;
    button.disabled = disabled;
    return button;
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

function getAuthStatusLabel(provider: WebviewState['auth']['providers'][number]): string {
  if (provider.canLogout && provider.storedCredentialType === 'oauth') {
    return 'Logged in';
  }

  if (provider.canLogout && provider.storedCredentialType === 'api_key') {
    return 'Stored key';
  }

  if (provider.configured) {
    return provider.source === 'environment' ? 'Env' : 'Configured';
  }

  return 'Not set';
}

function getSettingValue(definition: SettingDefinition, state: WebviewState): SettingValue {
  return state.settings.values[definition.id] ?? definition.defaultValue;
}

function createKwardUnsupportedSettingsEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'settings-surface__card settings-surface__card--subtle';
  empty.append(
    createTextElement('h4', 'settings-surface__card-title', 'No Kward-supported settings in this section yet'),
    createTextElement('p', 'settings-surface__card-body', 'Kward reports supported runtime settings through RPC capabilities. Unsupported Pi settings are hidden.')
  );
  return empty;
}

export function getVisibleSettingsForSection(sectionId: SettingsSection, state: WebviewState): SettingDefinition[] {
  return getSettingsForSection(sectionId).filter((definition) => isSettingVisible(definition, state));
}

function isSettingVisible(definition: SettingDefinition, state: WebviewState): boolean {
  if (state.settings.values['tauren.backend'] !== 'kward' || definition.owner !== 'pi') {
    return true;
  }

  return definition.id in state.settings.values;
}

function getSettingOptions(definition: SettingDefinition, state: WebviewState): SettingOption[] {
  if (definition.id === 'defaultProvider') {
    const providers = Array.from(new Set(state.modelOptions.map((model) => model.provider).filter(Boolean)));
    return providers.map((provider) => ({ value: provider, label: provider }));
  }

  if (definition.id === 'defaultModel') {
    return state.modelOptions.map((model) => ({
      value: `${model.provider}/${model.id}`,
      label: model.name || `${model.provider}/${model.id}`
    }));
  }

  return definition.options ? [...definition.options] : [];
}

function getHelperText(definition: SettingDefinition): string {
  if (definition.helper) {
    return definition.helper;
  }

  return definition.liveBehavior === 'reload'
    ? 'Saved for Pi; takes effect after reload or a new session.'
    : '';
}

function groupScopedModelsByProvider(models: WebviewState['modelOptions']): Array<{
  provider: string;
  models: WebviewState['modelOptions'];
}> {
  const groups: Array<{ provider: string; models: WebviewState['modelOptions'] }> = [];

  for (const model of models) {
    let group = groups.find((item) => item.provider === model.provider);
    if (!group) {
      group = { provider: model.provider, models: [] };
      groups.push(group);
    }
    group.models.push(model);
  }

  return groups;
}

function getVisibleScopedModels(
  selection: { orderedModels: WebviewState['modelOptions'] },
  providerFilter: string | undefined
): WebviewState['modelOptions'] {
  return providerFilter
    ? selection.orderedModels.filter((model) => model.provider === providerFilter)
    : selection.orderedModels;
}

function createSettingsSignature(sectionId: SettingsSection, state: WebviewState, scopedModelsProviderFilter: string | undefined): string {
  const values = getVisibleSettingsForSection(sectionId, state)
    .map((definition) => [definition.id, state.settings.values[definition.id]]);
  const modelOptions = sectionId === 'runtime' || sectionId === 'scopedModels'
    ? state.modelOptions.map((model) => `${model.provider}/${model.id}:${model.name}`).join('|')
    : '';
  const auth = sectionId === 'login' ? state.auth : undefined;
  const voice = sectionId === 'voice' ? state.voice : undefined;
  const providerFilter = sectionId === 'scopedModels' ? scopedModelsProviderFilter : undefined;
  return JSON.stringify([sectionId, values, modelOptions, auth, voice, state.busy, state.settings.errors, providerFilter]);
}

function getVoiceDownloadLabel(download: { status: string; receivedBytes?: number; totalBytes?: number }): string {
  if (download.status === 'downloaded') {
    return 'Downloaded';
  }

  if (download.status === 'downloading') {
    if (download.totalBytes && download.receivedBytes !== undefined) {
      return `Downloading ${Math.round((download.receivedBytes / download.totalBytes) * 100)}% (${formatVoiceBytes(download.receivedBytes)} / ${formatVoiceBytes(download.totalBytes)})`;
    }
    return `Downloading ${formatVoiceBytes(download.receivedBytes ?? 0)}`;
  }

  if (download.status === 'failed') {
    return 'Download failed';
  }

  if (download.status === 'unavailable') {
    return 'Unavailable';
  }

  return 'Not downloaded';
}

function formatVoiceBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  }
  return `${Math.round(value / (1024 * 1024))} MiB`;
}

function createTextElement(tagName: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}
