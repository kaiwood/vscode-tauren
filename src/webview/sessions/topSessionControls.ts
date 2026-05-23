import { formatRelativeTime } from './sessionFormat';
import type { WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

type TopSessionControlsOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  toolbarTitleElement: HTMLElement;
  toolbarTitleTextElement: HTMLElement;
  toolbarTimestampElement: HTMLElement;
  sessionNameInputElement: HTMLInputElement;
  sessionToggleButton: HTMLButtonElement;
  treeToggleButton: HTMLButtonElement;
  focusPromptInput: () => void;
  closeSlashMenu: () => void;
  closeModelMenu: () => void;
  getCurrentSessionTitle: () => string;
  getCurrentSessionName: () => string;
  getCurrentSessionTimestamp: () => string;
};

export class TopSessionControls {
  private sessionNameEditing = false;
  private sessionNameEditInitialValue = '';

  public constructor(private readonly options: TopSessionControlsOptions) {}

  public get isSessionNameEditing(): boolean {
    return this.sessionNameEditing;
  }

  public attachEventListeners(): void {
    this.options.sessionToggleButton.addEventListener('click', () => this.toggleSessionView());
    this.options.treeToggleButton.addEventListener('click', () => this.toggleTreeView());
    this.options.toolbarTitleElement.addEventListener('dblclick', (event) => this.startSessionNameEdit(event));
    this.options.sessionNameInputElement.addEventListener('blur', () => this.cancelSessionNameEdit());
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if ((event.target === this.options.sessionToggleButton || event.target === this.options.treeToggleButton)
      && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();

      if (event.target === this.options.sessionToggleButton) {
        this.toggleSessionView();
      } else {
        this.toggleTreeView();
      }

      return true;
    }

    if (!this.sessionNameEditing || event.target !== this.options.sessionNameInputElement) {
      return false;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitSessionNameEdit();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelSessionNameEdit({ focusPrompt: true });
      return true;
    }

    return true;
  }

  public syncForRender(isListView: boolean): void {
    const state = this.options.getState();
    const isSettingsView = state.surfaceSide === 'settings' && state.viewMode === 'chat';
    const isFrontHidden = isListView || isSettingsView;
    const toolbarTitle = isSettingsView ? 'Settings' : state.viewMode === 'sessions' ? 'Sessions' : state.viewMode === 'tree' ? 'Session tree' : this.options.getCurrentSessionTitle();
    const toolbarTimestamp = isFrontHidden ? '' : formatRelativeTime(this.options.getCurrentSessionTimestamp());
    const toolbarTitleTooltip = [toolbarTitle, toolbarTimestamp].filter(Boolean).join(' · ');

    if (isFrontHidden && this.sessionNameEditing) {
      this.cancelSessionNameEdit();
    }

    this.options.toolbarTitleTextElement.textContent = toolbarTitle;
    this.options.toolbarTimestampElement.textContent = toolbarTimestamp;
    this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !toolbarTimestamp;
    this.options.toolbarTitleElement.title = toolbarTitleTooltip;
    this.options.toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', this.sessionNameEditing);
    this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;

    const sessionToggleLabel = isListView ? 'Back to chat' : 'Show sessions';
    this.options.sessionToggleButton.setAttribute('aria-label', sessionToggleLabel);
    setTooltipText(this.options.sessionToggleButton, sessionToggleLabel);
    this.options.sessionToggleButton.classList.toggle('pi-toolbar__sessions--back', isListView);

    const treeToggleLabel = isListView ? 'Back to chat' : 'Show tree';
    this.options.treeToggleButton.setAttribute('aria-label', treeToggleLabel);
    setTooltipText(this.options.treeToggleButton, treeToggleLabel);
    this.options.treeToggleButton.classList.toggle('pi-toolbar__tree--back', isListView);
  }

  public cancelSessionNameEdit(options: { focusPrompt?: boolean } = {}): void {
    if (!this.sessionNameEditing) {
      return;
    }

    this.stopSessionNameEdit();

    if (options.focusPrompt) {
      this.options.focusPromptInput();
    }
  }

  public closeSessionCommandMenu(): void {}

  public handleWindowClick(_target: Node | null): void {}

  public hasSessionCommandMenuOpen(): boolean {
    return false;
  }

  private startSessionNameEdit(event?: MouseEvent): void {
    const state = this.options.getState();
    event?.preventDefault();
    event?.stopPropagation();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree') {
      return;
    }

    this.options.closeSlashMenu();
    this.options.closeModelMenu();
    this.sessionNameEditing = true;
    this.sessionNameEditInitialValue = this.options.getCurrentSessionName();
    this.options.sessionNameInputElement.value = this.sessionNameEditInitialValue;
    this.options.sessionNameInputElement.placeholder = this.sessionNameEditInitialValue ? '' : this.options.getCurrentSessionTitle();
    this.syncSessionNameEditor();
    requestAnimationFrame(() => {
      this.options.sessionNameInputElement.focus({ preventScroll: true });
      this.options.sessionNameInputElement.select();
    });
  }

  private commitSessionNameEdit(): void {
    if (!this.sessionNameEditing) {
      return;
    }

    const nextName = this.options.sessionNameInputElement.value.trim();
    const previousName = this.sessionNameEditInitialValue.trim();
    this.stopSessionNameEdit();

    if (nextName !== previousName) {
      this.options.postMessage({ type: 'setSessionName', name: nextName });
    }

    this.options.focusPromptInput();
  }

  private stopSessionNameEdit(): void {
    this.sessionNameEditing = false;
    this.sessionNameEditInitialValue = '';
    this.options.sessionNameInputElement.value = '';
    this.syncSessionNameEditor();
  }

  private syncSessionNameEditor(): void {
    this.options.toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', this.sessionNameEditing);
    this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
    this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !this.options.toolbarTimestampElement.textContent;
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
  }

  private toggleSessionView(): void {
    const state = this.options.getState();
    this.cancelSessionNameEdit();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree') {
      this.options.postMessage({ type: 'hideSessions' });
      this.options.focusPromptInput();
      return;
    }

    this.options.postMessage({ type: 'showSessions' });
  }

  private toggleTreeView(): void {
    const state = this.options.getState();
    this.cancelSessionNameEdit();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree') {
      this.options.postMessage({ type: 'hideSessions' });
      this.options.focusPromptInput();
      return;
    }

    this.options.postMessage({ type: 'showTree' });
  }
}

function setTooltipText(element: HTMLElement, text: string): void {
  const tooltip = element.querySelector<HTMLElement>('.tau-icon-action-tooltip');

  if (tooltip) {
    tooltip.textContent = text;
  }
}
