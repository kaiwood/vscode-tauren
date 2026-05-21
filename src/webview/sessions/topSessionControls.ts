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
  sessionMenuWrapElement: HTMLElement;
  sessionMenuButton: HTMLButtonElement;
  sessionMenuElement: HTMLElement;
  sessionMenuItemElements: HTMLButtonElement[];
  sessionHelpWrapElement: HTMLElement;
  sessionHelpButton: HTMLButtonElement;
  sessionHelpPopoverElement: HTMLElement;
  focusPromptInput: () => void;
  closeSlashMenu: () => void;
  closeModelMenu: () => void;
  runSessionSlashCommand: (command: 'fork' | 'clone' | 'compact' | 'reload' | 'export') => void;
  getCurrentSessionTitle: () => string;
  getCurrentSessionName: () => string;
  getCurrentSessionPath: () => string;
  getCurrentSessionTimestamp: () => string;
};

export class TopSessionControls {
  private sessionNameEditing = false;
  private sessionNameEditInitialValue = '';
  private sessionMenuCommandIndex = 0;
  private sessionHelpOpenedFromShortcut = false;

  public constructor(private readonly options: TopSessionControlsOptions) {}

  public get isSessionNameEditing(): boolean {
    return this.sessionNameEditing;
  }

  public attachEventListeners(): void {
    this.options.sessionToggleButton.addEventListener('click', () => this.toggleSessionView());
    this.options.treeToggleButton.addEventListener('click', () => this.toggleTreeView());
    this.options.toolbarTitleElement.addEventListener('dblclick', (event) => this.startSessionNameEdit(event));
    this.options.sessionMenuButton.addEventListener('click', (event) => this.toggleSessionCommandMenu(event));
    this.options.sessionHelpButton.addEventListener('click', (event) => this.toggleSessionHelpPopover(event));

    for (const item of this.options.sessionMenuItemElements) {
      item.addEventListener('click', () => this.runSessionMenuCommand(item.getAttribute('data-session-command')));
      item.addEventListener('pointerenter', () => this.setSessionMenuItemHover(item, true));
      item.addEventListener('pointerleave', () => this.setSessionMenuItemHover(item, false));
      item.addEventListener('focus', () => {
        this.updateSessionMenuCommandIndex(item);
        this.setSessionMenuItemHover(item, true);
      });
      item.addEventListener('blur', () => this.setSessionMenuItemHover(item, false));
    }

    this.options.sessionNameInputElement.addEventListener('blur', () => this.cancelSessionNameEdit());
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (this.handleSessionCommandMenuKeydown(event)) {
      return true;
    }

    if ((event.target === this.options.sessionToggleButton || event.target === this.options.treeToggleButton || event.target === this.options.sessionHelpButton)
      && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();

      if (event.target === this.options.sessionToggleButton) {
        this.toggleSessionView();
      } else if (event.target === this.options.treeToggleButton) {
        this.toggleTreeView();
      } else {
        this.toggleSessionHelpPopover();
      }

      return true;
    }

    if (this.hasSessionHelpPopoverOpen() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionHelpPopover({ focusButton: !this.sessionHelpOpenedFromShortcut });
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
    const toolbarTitle = state.viewMode === 'sessions' ? 'Sessions' : state.viewMode === 'tree' ? 'Session tree' : this.options.getCurrentSessionTitle();
    const toolbarTimestamp = isListView ? '' : formatRelativeTime(this.options.getCurrentSessionTimestamp());
    const toolbarTitleTooltip = [toolbarTitle, toolbarTimestamp].filter(Boolean).join(' · ');

    if ((isListView || state.busy) && this.sessionNameEditing) {
      this.cancelSessionNameEdit();
    }

    this.options.toolbarTitleTextElement.textContent = toolbarTitle;
    this.options.toolbarTimestampElement.textContent = toolbarTimestamp;
    this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !toolbarTimestamp;
    this.options.toolbarTitleElement.title = toolbarTitleTooltip;
    this.options.toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', this.sessionNameEditing);
    this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
    this.options.sessionMenuWrapElement.hidden = isListView;
    this.options.sessionHelpWrapElement.hidden = state.viewMode !== 'sessions';
    this.options.sessionMenuButton.disabled = state.busy || this.sessionNameEditing;
    this.syncSessionCommandMenuItems();

    if (isListView || state.busy || this.sessionNameEditing) {
      this.closeSessionCommandMenu();
    }

    if (state.viewMode !== 'sessions') {
      this.closeSessionHelpPopover();
    }

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

  public closeSessionCommandMenu(options: { focusButton?: boolean } = {}): void {
    if (this.options.sessionMenuElement.hidden) {
      return;
    }

    this.options.sessionMenuElement.hidden = true;
    this.options.sessionMenuButton.setAttribute('aria-expanded', 'false');
    for (const item of this.options.sessionMenuItemElements) {
      this.setSessionMenuItemHover(item, false);
    }

    if (options.focusButton && !this.options.sessionMenuWrapElement.hidden) {
      this.options.sessionMenuButton.focus({ preventScroll: true });
    }
  }

  public openSessionHelpPopover(options: { fromShortcut?: boolean } = {}): void {
    const state = this.options.getState();

    if (state.viewMode !== 'sessions') {
      return;
    }

    this.closeSessionCommandMenu();
    this.sessionHelpOpenedFromShortcut = Boolean(options.fromShortcut);
    this.options.sessionHelpPopoverElement.hidden = false;
    this.options.sessionHelpButton.setAttribute('aria-expanded', 'true');
  }

  public closeSessionHelpPopover(options: { focusButton?: boolean } = {}): void {
    if (this.options.sessionHelpPopoverElement.hidden) {
      return;
    }

    this.options.sessionHelpPopoverElement.hidden = true;
    this.options.sessionHelpButton.setAttribute('aria-expanded', 'false');
    this.sessionHelpOpenedFromShortcut = false;

    if (options.focusButton && !this.options.sessionHelpWrapElement.hidden) {
      this.options.sessionHelpButton.focus({ preventScroll: true });
    }
  }

  public handleWindowClick(target: Node | null): void {
    if (!target || !this.options.sessionMenuWrapElement.contains(target)) {
      this.closeSessionCommandMenu();
    }

    if (!target || !this.options.sessionHelpWrapElement.contains(target)) {
      this.closeSessionHelpPopover();
    }
  }

  public hasSessionCommandMenuOpen(): boolean {
    return !this.options.sessionMenuElement.hidden;
  }

  private hasSessionHelpPopoverOpen(): boolean {
    return !this.options.sessionHelpPopoverElement.hidden;
  }

  private startSessionNameEdit(event?: MouseEvent): void {
    const state = this.options.getState();
    event?.preventDefault();
    event?.stopPropagation();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree' || state.busy) {
      return;
    }

    this.options.closeSlashMenu();
    this.options.closeModelMenu();
    this.closeSessionCommandMenu();

    const initialName = this.options.getCurrentSessionName();
    this.sessionNameEditing = true;
    this.sessionNameEditInitialValue = initialName;
    this.options.sessionNameInputElement.value = initialName;
    this.options.sessionNameInputElement.placeholder = initialName ? '' : this.options.getCurrentSessionTitle();
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
    const previousName = this.sessionNameEditInitialValue;
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
    this.options.sessionNameInputElement.placeholder = '';
    this.syncSessionNameEditor();
  }

  private syncSessionNameEditor(): void {
    const state = this.options.getState();
    this.options.toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', this.sessionNameEditing);
    this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
    this.options.toolbarTimestampElement.hidden = this.sessionNameEditing || !this.options.toolbarTimestampElement.textContent;
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
    this.options.sessionMenuButton.disabled = state.busy || this.sessionNameEditing;
  }

  private toggleSessionCommandMenu(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (!this.options.sessionMenuElement.hidden) {
      this.closeSessionCommandMenu();
      return;
    }

    this.openSessionCommandMenu();
  }

  private toggleSessionHelpPopover(event?: MouseEvent): void {
    const state = this.options.getState();
    event?.preventDefault();
    event?.stopPropagation();

    if (state.viewMode !== 'sessions') {
      return;
    }

    const isOpen = !this.options.sessionHelpPopoverElement.hidden;

    if (isOpen) {
      this.closeSessionHelpPopover();
      return;
    }

    this.openSessionHelpPopover();
  }

  private syncSessionCommandMenuItems(): void {
    const state = this.options.getState();

    for (const item of this.options.sessionMenuItemElements) {
      const command = item.getAttribute('data-session-command');
      item.disabled = state.busy || this.sessionNameEditing || (command === 'delete' && !this.options.getCurrentSessionPath());
    }
  }

  private handleSessionCommandMenuKeydown(event: KeyboardEvent): boolean {
    const target = event.target instanceof Node ? event.target : undefined;
    const isMenuButtonTarget = event.target === this.options.sessionMenuButton;
    const isMenuTarget = Boolean(target && this.options.sessionMenuElement.contains(target));
    const isMenuOpen = this.hasSessionCommandMenuOpen();

    if (isMenuButtonTarget && !isMenuOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        this.openSessionCommandMenu({ focusMenu: true });
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        this.openSessionCommandMenu({ focusMenu: true, focusLast: true });
        return true;
      }

      return false;
    }

    if (!isMenuOpen || (!isMenuButtonTarget && !isMenuTarget)) {
      return false;
    }

    if (event.key === 'Tab') {
      this.closeSessionCommandMenu();
      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionCommandMenu({ focusButton: true });
      return true;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      isMenuTarget ? this.moveSessionCommandMenuSelection(1) : this.focusFirstSessionCommandMenuItem();
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      isMenuTarget ? this.moveSessionCommandMenuSelection(-1) : this.focusLastSessionCommandMenuItem();
      return true;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      this.focusFirstSessionCommandMenuItem();
      return true;
    }

    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      this.focusLastSessionCommandMenuItem();
      return true;
    }

    if (isMenuTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      this.runFocusedSessionMenuCommand(event.target);
      return true;
    }

    return false;
  }

  private openSessionCommandMenu(options: { focusMenu?: boolean; focusLast?: boolean } = {}): void {
    const state = this.options.getState();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree' || state.busy || this.sessionNameEditing) {
      return;
    }

    this.options.closeSlashMenu();
    this.options.closeModelMenu();
    this.closeSessionHelpPopover();
    this.syncSessionCommandMenuItems();
    this.sessionMenuCommandIndex = options.focusLast
      ? this.getLastEnabledSessionCommandMenuIndex()
      : this.getFirstEnabledSessionCommandMenuIndex();
    this.options.sessionMenuElement.hidden = false;
    this.options.sessionMenuButton.setAttribute('aria-expanded', 'true');

    if (options.focusMenu) {
      requestAnimationFrame(() => this.focusSessionCommandMenuItem(this.sessionMenuCommandIndex));
    }
  }

  private moveSessionCommandMenuSelection(delta: number): void {
    const enabledIndexes = this.getEnabledSessionCommandMenuIndexes();

    if (enabledIndexes.length === 0) {
      return;
    }

    const currentPosition = enabledIndexes.indexOf(this.sessionMenuCommandIndex);
    const nextPosition = currentPosition >= 0
      ? (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length
      : (delta > 0 ? 0 : enabledIndexes.length - 1);
    this.sessionMenuCommandIndex = enabledIndexes[nextPosition];
    this.focusSessionCommandMenuItem(this.sessionMenuCommandIndex);
  }

  private focusFirstSessionCommandMenuItem(): void {
    this.sessionMenuCommandIndex = this.getFirstEnabledSessionCommandMenuIndex();
    this.focusSessionCommandMenuItem(this.sessionMenuCommandIndex);
  }

  private focusLastSessionCommandMenuItem(): void {
    this.sessionMenuCommandIndex = this.getLastEnabledSessionCommandMenuIndex();
    this.focusSessionCommandMenuItem(this.sessionMenuCommandIndex);
  }

  private focusSessionCommandMenuItem(index: number): void {
    const item = this.options.sessionMenuItemElements[index];

    if (!item || item.disabled) {
      return;
    }

    item.focus({ preventScroll: true });
  }

  private getFirstEnabledSessionCommandMenuIndex(): number {
    return this.getEnabledSessionCommandMenuIndexes()[0] ?? 0;
  }

  private getLastEnabledSessionCommandMenuIndex(): number {
    const enabledIndexes = this.getEnabledSessionCommandMenuIndexes();
    return enabledIndexes[enabledIndexes.length - 1] ?? 0;
  }

  private getEnabledSessionCommandMenuIndexes(): number[] {
    return this.options.sessionMenuItemElements
      .map((item, index) => item.disabled ? undefined : index)
      .filter((index): index is number => index !== undefined);
  }

  private updateSessionMenuCommandIndex(item: HTMLButtonElement): void {
    const index = this.options.sessionMenuItemElements.indexOf(item);

    if (index >= 0 && !item.disabled) {
      this.sessionMenuCommandIndex = index;
    }
  }

  private runFocusedSessionMenuCommand(target: EventTarget | null): void {
    const targetItem = target instanceof Element
      ? target.closest('.pi-toolbar__menu-item')
      : undefined;
    const item = targetItem instanceof HTMLButtonElement && this.options.sessionMenuElement.contains(targetItem) && !targetItem.disabled
      ? targetItem
      : this.options.sessionMenuItemElements[this.sessionMenuCommandIndex];

    if (!item || item.disabled) {
      return;
    }

    this.runSessionMenuCommand(item.getAttribute('data-session-command'));
  }

  private setSessionMenuItemHover(item: HTMLButtonElement, hovered: boolean): void {
    item.classList.toggle('pi-toolbar__menu-item--hover', hovered);
  }

  private runSessionMenuCommand(command: string | null): void {
    if (command === 'rename') {
      this.closeSessionCommandMenu();
      this.startSessionNameEdit();
      return;
    }

    if (command === 'fork' || command === 'clone') {
      this.closeSessionCommandMenu();
      this.options.runSessionSlashCommand(command);
      return;
    }

    if (command === 'delete') {
      this.closeSessionCommandMenu();
      this.deleteCurrentSession();
      return;
    }

    if (command !== 'reload' && command !== 'compact' && command !== 'export') {
      return;
    }

    this.closeSessionCommandMenu();
    this.options.postMessage({ type: 'submit', text: '/' + command });
    this.options.focusPromptInput();
  }

  private deleteCurrentSession(): void {
    const sessionPath = this.options.getCurrentSessionPath();

    if (!sessionPath) {
      return;
    }

    this.options.postMessage({ type: 'deleteSession', sessionPath });
    this.options.focusPromptInput();
  }

  private toggleSessionView(): void {
    const state = this.options.getState();
    this.cancelSessionNameEdit();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree') {
      this.closeSessionHelpPopover();
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
      this.closeSessionHelpPopover();
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
