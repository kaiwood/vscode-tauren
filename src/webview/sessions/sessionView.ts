import { createSessionItemElement } from './sessionElements';
import { getSessionDisplayName } from './sessionFormat';
import {
  ensureVisibleSessionSelection,
  getVisibleSessionIndexes,
  moveVisibleSessionSelection
} from './sessionSearch';
import { SessionTreeController } from './sessionTreeController';
import {
  parseSessionItemCommand,
  sessionItemMenuCommands
} from './sessionItemCommands';
import { createSessionEmptyElement, eventTargetElement, getSessionListCommandForKey } from './sessionUiHelpers';
import { TopSessionControls } from './topSessionControls';
import type { SessionItem, SessionItemCommand, WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

export type SessionViewControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  sessionsElement: HTMLElement;
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
};

export class SessionViewController {
  private sessionListSelectedIndex = 0;
  private sessionSearchQuery = '';
  private sessionNamedOnlyFilter = false;
  private sessionPointerHoverEnabled = false;
  private openSessionListMenuIndex: number | undefined;
  private openSessionListMenuCommandIndex = 0;
  private sessionListNameEditPath: string | undefined;
  private sessionListNameEditInitialValue = '';
  private sessionListNameEditValue = '';
  private sessionListNameEditShouldSelect = false;
  private suppressSessionListNameInputBlur = false;
  private sessionListScrollTop: number | undefined;
  private pendingSessionListScrollRestore = false;
  private pendingSessionScrollIndex: number | undefined;
  private pendingSessionScrollFrame: number | undefined;
  private readonly topControls: TopSessionControls;
  private readonly treeController: SessionTreeController;

  public constructor(private readonly options: SessionViewControllerOptions) {
    this.treeController = new SessionTreeController({
      getState: options.getState,
      postMessage: options.postMessage,
      sessionsElement: options.sessionsElement
    });
    this.topControls = new TopSessionControls({
      getState: options.getState,
      postMessage: options.postMessage,
      toolbarTitleElement: options.toolbarTitleElement,
      toolbarTitleTextElement: options.toolbarTitleTextElement,
      toolbarTimestampElement: options.toolbarTimestampElement,
      sessionNameInputElement: options.sessionNameInputElement,
      sessionToggleButton: options.sessionToggleButton,
      treeToggleButton: options.treeToggleButton,
      sessionMenuWrapElement: options.sessionMenuWrapElement,
      sessionMenuButton: options.sessionMenuButton,
      sessionMenuElement: options.sessionMenuElement,
      sessionMenuItemElements: options.sessionMenuItemElements,
      sessionHelpWrapElement: options.sessionHelpWrapElement,
      sessionHelpButton: options.sessionHelpButton,
      sessionHelpPopoverElement: options.sessionHelpPopoverElement,
      focusPromptInput: options.focusPromptInput,
      closeSlashMenu: options.closeSlashMenu,
      closeModelMenu: options.closeModelMenu,
      runSessionSlashCommand: options.runSessionSlashCommand,
      getCurrentSessionTitle: () => this.getCurrentSessionTitle(),
      getCurrentSessionName: () => this.getCurrentSessionName(),
      getCurrentSessionPath: () => this.getCurrentSessionPath(),
      getCurrentSessionTimestamp: () => this.getCurrentSessionTimestamp()
    });
  }

  public attachEventListeners(): void {
    this.topControls.attachEventListeners();
    this.options.sessionsElement.addEventListener('keydown', (event) => this.handleSessionListKeydown(event));
    this.options.sessionsElement.addEventListener('pointermove', (event) => this.handleSessionListPointerMove(event));
    this.options.sessionsElement.addEventListener('click', (event) => this.handleSessionsClick(event));
  }

  public handleWindowClick(target: Node | null, eventTarget: Element | null): void {
    this.topControls.handleWindowClick(target);

    if (!target || !this.options.sessionsElement.contains(target) || !eventTarget?.closest('.sessions__menu-wrap')) {
      this.closeSessionItemMenus();
    }
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (this.topControls.handleGlobalKeydown(event)) {
      return true;
    }

    const state = this.options.getState();

    if (state.viewMode === 'tree' && this.treeController.handleKeydown(event)) {
      return true;
    }

    if (state.viewMode === 'tree' && event.key === 'Escape') {
      this.hideSessionList(event);
      return true;
    }

    const target = eventTargetElement(event);
    const sessionSearchInput = target?.closest('.sessions__search-input');

    if (sessionSearchInput instanceof HTMLInputElement && state.viewMode === 'sessions') {
      return this.handleSessionSearchKeydown(event, sessionSearchInput);
    }

    const namedOnlyFilterButton = target?.closest('.sessions__named-filter');

    if (namedOnlyFilterButton instanceof HTMLButtonElement && state.viewMode === 'sessions') {
      return this.handleNamedOnlyFilterKeydown(event);
    }

    const sessionListNameInput = target?.closest('.sessions__name-input');

    if (sessionListNameInput instanceof HTMLInputElement) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.commitSessionListNameEdit(sessionListNameInput.value);
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelSessionListNameEdit({ focusList: true });
        return true;
      }

      if (isTextInputShortcut(event)) {
        return false;
      }

      event.stopPropagation();
      return true;
    }

    return (state.viewMode === 'sessions' || state.viewMode === 'tree') && this.handleSessionListKeydown(event);
  }

  public syncForRender(isListView: boolean): void {
    const state = this.options.getState();

    if (state.viewMode !== 'sessions') {
      this.sessionSearchQuery = '';
      this.sessionNamedOnlyFilter = false;
      this.openSessionListMenuIndex = undefined;
      this.openSessionListMenuCommandIndex = 0;
      this.stopSessionListNameEdit();
    }

    this.topControls.syncForRender(isListView);
  }

  public renderSessions(): void {
    const state = this.options.getState();
    const searchInput = this.isSessionSearchFocused() ? document.activeElement as HTMLInputElement : undefined;
    const nameInput = this.isSessionListNameInputFocused() ? document.activeElement as HTMLInputElement : undefined;
    const selectedIndex = searchInput ? -1 : this.sessionListSelectedIndex;
    const searchSelectionStart = searchInput?.selectionStart ?? null;
    const searchSelectionEnd = searchInput?.selectionEnd ?? null;
    const nameSelectionStart = nameInput?.selectionStart ?? null;
    const nameSelectionEnd = nameInput?.selectionEnd ?? null;
    if (nameInput) {
      this.sessionListNameEditValue = nameInput.value;
    }
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    const visibleIndexes = this.getVisibleSessionIndexes();
    const filtersActive = this.hasActiveSessionListFilters();
    this.sessionListSelectedIndex = ensureVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes);
    this.suppressSessionListNameInputBlur = Boolean(this.sessionListNameEditPath);
    this.options.sessionsElement.replaceChildren();
    this.suppressSessionListNameInputBlur = false;

    const search = this.createSessionSearchElement();
    this.options.sessionsElement.append(search);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    if (this.openSessionListMenuIndex !== undefined && !visibleIndexes.includes(this.openSessionListMenuIndex)) {
      this.openSessionListMenuIndex = undefined;
    }
    header.textContent = state.sessionsRefreshing
      ? 'Loading sessions...'
      : filtersActive && visibleIndexes.length !== count
      ? visibleIndexes.length + ' of ' + count + ' sessions'
      : count === 1
      ? '1 session'
      : count + ' sessions';
    this.options.sessionsElement.append(header);

    if (state.sessionsError) {
      const error = document.createElement('div');
      error.className = 'sessions__error';
      error.textContent = state.sessionsError;
      this.options.sessionsElement.append(error);
    }

    if (state.sessionsRefreshing && count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('Loading sessions...'));
    } else if (count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('No sessions found for this workspace.'));
    } else if (visibleIndexes.length === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement(this.getSessionListEmptyText()));
    } else {
      for (const index of visibleIndexes) {
        this.options.sessionsElement.append(createSessionItemElement({
          session: state.sessions[index],
          index,
          selectedIndex,
          nameEditPath: this.sessionListNameEditPath,
          nameEditValue: this.sessionListNameEditValue,
          openMenuIndex: this.openSessionListMenuIndex,
          canRunSessionItemCommand: (session, command) => this.canRunSessionItemCommand(session, command),
          onNameInputInput: (value) => this.updateSessionListNameEditValue(value),
          onNameInputBlur: () => this.handleSessionListNameInputBlur(),
          onCommandActivate: (commandIndex, button) => {
            this.openSessionListMenuCommandIndex = commandIndex;
            this.setSessionMenuItemHover(button, true);
          },
          onCommandHover: (button, hovered) => this.setSessionMenuItemHover(button, hovered)
        }));
      }
    }

    if (this.sessionListNameEditPath) {
      const select = this.sessionListNameEditShouldSelect;
      this.sessionListNameEditShouldSelect = false;
      requestAnimationFrame(() => this.focusSessionListNameInput({ select, selectionStart: nameSelectionStart, selectionEnd: nameSelectionEnd }));
    } else if (searchInput) {
      this.focusSessionSearchInput({ select: false, selectionStart: searchSelectionStart, selectionEnd: searchSelectionEnd });
    }

    if (this.pendingSessionListScrollRestore) {
      this.pendingSessionListScrollRestore = false;
      this.restoreSessionListScrollPositionOrRevealSelection();
    }
  }

  public renderTree(): void {
    this.treeController.render();
  }

  public selectCurrentTreeEntry(): void {
    this.treeController.selectCurrent();
  }

  public selectCurrentSessionOrFirstVisible(): void {
    const visibleIndexes = this.getVisibleSessionIndexes();
    const currentIndex = this.getCurrentSessionIndex();

    this.sessionListSelectedIndex = currentIndex !== undefined && visibleIndexes.includes(currentIndex)
      ? currentIndex
      : visibleIndexes[0] ?? 0;
  }

  public rememberSessionListScrollPosition(): void {
    this.sessionListScrollTop = this.options.sessionsElement.scrollTop;
  }

  public restoreSessionListScrollAfterNextRender(): void {
    this.pendingSessionListScrollRestore = true;
  }

  public disableSessionPointerHover(): void {
    this.sessionPointerHoverEnabled = false;
    this.options.sessionsElement.classList.remove('sessions--pointer-hover');
  }

  public stopSessionListNameEdit(): void {
    this.sessionListNameEditPath = undefined;
    this.sessionListNameEditInitialValue = '';
    this.sessionListNameEditValue = '';
    this.sessionListNameEditShouldSelect = false;
  }

  public isSessionListNameEditing(): boolean {
    return Boolean(this.sessionListNameEditPath);
  }

  public isSessionSearchFocused(): boolean {
    return document.activeElement instanceof HTMLInputElement
      && document.activeElement.classList.contains('sessions__search-input');
  }

  public isSessionListNameInputFocused(): boolean {
    return document.activeElement instanceof HTMLInputElement
      && document.activeElement.classList.contains('sessions__name-input');
  }

  public isSessionListNameEditingMissing(): boolean {
    const state = this.options.getState();
    return Boolean(this.sessionListNameEditPath && !state.sessions.some((session) => session.path === this.sessionListNameEditPath));
  }

  public hasSlashOrSessionUiOpen(): { sessionCommandMenu: boolean; sessionNameEditing: boolean } {
    return {
      sessionCommandMenu: this.topControls.hasSessionCommandMenuOpen(),
      sessionNameEditing: this.topControls.isSessionNameEditing
    };
  }

  public cancelSessionNameEdit(options: { focusPrompt?: boolean } = {}): void {
    this.topControls.cancelSessionNameEdit(options);
  }

  public closeSessionCommandMenu(): void {
    this.topControls.closeSessionCommandMenu();
  }

  public closeSessionItemMenus(): void {
    if (this.openSessionListMenuIndex === undefined) {
      return;
    }

    this.openSessionListMenuIndex = undefined;
    this.openSessionListMenuCommandIndex = 0;

    for (const menu of this.options.sessionsElement.querySelectorAll<HTMLElement>('.sessions__menu')) {
      menu.hidden = true;
    }

    for (const button of this.options.sessionsElement.querySelectorAll<HTMLButtonElement>('.sessions__menu-button')) {
      button.setAttribute('aria-expanded', 'false');
    }
  }

  private handleSessionsClick(event: MouseEvent): void {
    const state = this.options.getState();
    const target = eventTargetElement(event);

    if (state.viewMode === 'tree' && this.treeController.handleClick(target, event)) {
      return;
    }
    const sessionMenuButton = target?.closest('.sessions__menu-button');

    if (sessionMenuButton) {
      event.preventDefault();
      event.stopPropagation();
      const item = sessionMenuButton.closest('.sessions__item');
      const index = Number(item?.getAttribute('data-index'));
      this.toggleSessionItemMenu(index);
      return;
    }

    const sessionMenuItem = target?.closest('.sessions__menu-item');

    if (sessionMenuItem) {
      event.preventDefault();
      event.stopPropagation();
      const item = sessionMenuItem.closest('.sessions__item');
      const index = Number(item?.getAttribute('data-index'));
      this.runSessionItemMenuCommand(index, sessionMenuItem.getAttribute('data-session-command'));
      return;
    }

    const item = target?.closest('.sessions__item');

    if (!item) {
      this.closeSessionItemMenus();
      return;
    }

    this.closeSessionItemMenus();
    const index = Number(item.getAttribute('data-index'));
    state.viewMode === 'tree' ? this.treeController.selectIndex(index) : this.selectSessionIndex(index);
  }

  private getCurrentSessionTitle(): string {
    const state = this.options.getState();
    const session = this.getCurrentSession();

    if (session) {
      return getSessionDisplayName(session);
    }

    if (state.currentSessionName) {
      return state.currentSessionName;
    }

    if (state.currentSessionFile) {
      return 'Current session';
    }

    return state.messages.length === 0 ? 'New session' : 'Current session';
  }

  private getCurrentSession(): SessionItem | undefined {
    const state = this.options.getState();
    const currentIndex = this.getCurrentSessionIndex();

    return currentIndex === undefined ? undefined : state.sessions[currentIndex];
  }

  private getCurrentSessionIndex(): number | undefined {
    const state = this.options.getState();

    if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
      return undefined;
    }

    const index = state.currentSessionFile
      ? state.sessions.findIndex((session) => session.path === state.currentSessionFile)
      : -1;
    const fallbackIndex = index >= 0 ? index : state.sessions.findIndex((session) => session.current);

    return fallbackIndex >= 0 ? fallbackIndex : undefined;
  }

  private handleSessionListKeydown(event: KeyboardEvent): boolean {
    const state = this.options.getState();

    const target = eventTargetElement(event);

    if (target?.closest('.sessions__search-input, .sessions__name-input')) {
      return false;
    }

    if (state.viewMode !== 'sessions' && state.viewMode !== 'tree') {
      return false;
    }

    if (state.viewMode === 'tree' && this.treeController.handleKeydown(event)) {
      return true;
    }

    if (this.openSessionListMenuIndex !== undefined && this.handleSessionItemMenuKeydown(event)) {
      return true;
    }

    if (state.viewMode === 'sessions' && event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionItemMenus();
      this.topControls.openSessionHelpPopover({ fromShortcut: true });
      return true;
    }

    if (event.key === 'Escape') {
      this.hideSessionList(event);
      return true;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.disableSessionPointerHover();
      this.closeSessionItemMenus();
      state.viewMode === 'tree' ? this.treeController.moveSelection(1) : this.moveSessionSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.disableSessionPointerHover();
      this.closeSessionItemMenus();
      state.viewMode === 'tree' ? this.treeController.moveSelection(-1) : this.moveSessionSelectionUpOrFocusSearch();
      return true;
    }

    if (state.viewMode === 'sessions' && event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      this.openSessionItemMenu(this.sessionListSelectedIndex, { focusMenu: true });
      return true;
    }

    if (state.viewMode === 'sessions' && this.handleSessionListCommandKey(event)) {
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      state.viewMode === 'tree' ? this.treeController.selectCurrentIndex() : this.selectSessionIndex(this.sessionListSelectedIndex);
      return true;
    }

    if (state.viewMode === 'sessions' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteSessionIndex(this.sessionListSelectedIndex);
      return true;
    }

    return false;
  }

  private hideSessionList(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.options.postMessage({ type: 'hideSessions' });
    this.options.focusPromptInput();
  }

  private enableSessionPointerHover(): void {
    if (this.sessionPointerHoverEnabled) {
      return;
    }

    this.sessionPointerHoverEnabled = true;
    this.options.sessionsElement.classList.add('sessions--pointer-hover');
  }

  private handleSessionListPointerMove(event: PointerEvent): void {
    this.enableSessionPointerHover();

    const state = this.options.getState();

    if (state.viewMode !== 'sessions') {
      return;
    }

    const item = eventTargetElement(event)?.closest('.sessions__item');

    if (!(item instanceof HTMLElement) || !this.options.sessionsElement.contains(item)) {
      return;
    }

    const index = Number(item.getAttribute('data-index'));

    if (!Number.isInteger(index) || !this.isSessionIndexVisible(index)) {
      return;
    }

    const previousIndex = this.sessionListSelectedIndex;

    if (index === previousIndex) {
      return;
    }

    if (this.openSessionListMenuIndex !== undefined && this.openSessionListMenuIndex !== index) {
      this.closeSessionItemMenus();
    }

    this.sessionListSelectedIndex = index;
    this.updateRenderedSessionSelection(previousIndex);
  }

  private moveSessionSelection(delta: number): void {
    const visibleIndexes = this.getVisibleSessionIndexes();

    if (visibleIndexes.length === 0) {
      return;
    }

    const nextIndex = moveVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes, delta);

    if (nextIndex === undefined) {
      return;
    }

    const previousIndex = this.sessionListSelectedIndex;

    if (nextIndex === previousIndex) {
      return;
    }

    this.sessionListSelectedIndex = nextIndex;
    this.updateRenderedSessionSelection(previousIndex);
    this.scheduleSessionSelectionIntoView(nextIndex);
  }

  private moveSessionSelectionUpOrFocusSearch(): void {
    const visibleIndexes = this.getVisibleSessionIndexes();

    if (visibleIndexes.length === 0 || this.sessionListSelectedIndex === visibleIndexes[0]) {
      this.focusSessionSearchInput({ reveal: true });
      return;
    }

    this.moveSessionSelection(-1);
  }

  private updateRenderedSessionSelection(previousIndex: number): void {
    this.updateRenderedSessionItemSelection(previousIndex, false);
    this.updateRenderedSessionItemSelection(this.sessionListSelectedIndex, true);
  }

  private updateRenderedSessionItemSelection(index: number, selected: boolean): void {
    const item = document.getElementById('session-' + index);

    if (!item) {
      return;
    }

    item.classList.toggle('sessions__item--active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  }

  private scheduleSessionSelectionIntoView(index: number): void {
    this.pendingSessionScrollIndex = index;

    if (this.pendingSessionScrollFrame !== undefined) {
      return;
    }

    this.pendingSessionScrollFrame = requestAnimationFrame(() => {
      const scrollIndex = this.pendingSessionScrollIndex;
      this.pendingSessionScrollIndex = undefined;
      this.pendingSessionScrollFrame = undefined;

      if (scrollIndex === undefined) {
        return;
      }

      document.getElementById('session-' + scrollIndex)?.scrollIntoView({ block: 'nearest' });
    });
  }

  private cancelPendingSessionSelectionScroll(): void {
    if (this.pendingSessionScrollFrame !== undefined) {
      cancelAnimationFrame(this.pendingSessionScrollFrame);
    }

    this.pendingSessionScrollIndex = undefined;
    this.pendingSessionScrollFrame = undefined;
  }

  private restoreSessionListScrollPositionOrRevealSelection(): void {
    const scrollTop = this.sessionListScrollTop;

    requestAnimationFrame(() => {
      if (scrollTop !== undefined) {
        this.options.sessionsElement.scrollTop = scrollTop;
      }

      this.revealSelectedSessionIfNeeded();
    });
  }

  private revealSelectedSessionIfNeeded(): void {
    const item = document.getElementById('session-' + this.sessionListSelectedIndex);

    if (!item) {
      return;
    }

    const containerRect = this.options.sessionsElement.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectSessionIndex(index: number): void {
    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session?.path || !this.isSessionIndexVisible(index)) {
      return;
    }

    this.options.postMessage({ type: 'selectSession', sessionPath: session.path });
  }

  private deleteSessionIndex(index: number): void {
    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session?.path || !this.isSessionIndexVisible(index) || !this.canDeleteSession(session)) {
      return;
    }

    this.options.postMessage({ type: 'deleteSession', sessionPath: session.path });
  }

  private toggleSessionItemMenu(index: number): void {
    if (this.openSessionListMenuIndex === index) {
      this.closeSessionItemMenus();
      return;
    }

    this.openSessionItemMenu(index, { focusMenu: true });
  }

  private openSessionItemMenu(index: number, options: { focusMenu?: boolean } = {}): void {
    const state = this.options.getState();

    if (!Number.isInteger(index) || index < 0 || state.viewMode !== 'sessions' || !this.isSessionIndexVisible(index)) {
      return;
    }

    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session || !this.canRunSessionItemCommand(session)) {
      return;
    }

    this.sessionListSelectedIndex = this.clampSessionIndex(index);
    this.openSessionListMenuIndex = this.sessionListSelectedIndex;
    this.openSessionListMenuCommandIndex = this.getFirstEnabledSessionItemMenuCommandIndex(session);
    this.renderSessions();
    document.getElementById('session-' + this.sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });

    if (options.focusMenu) {
      requestAnimationFrame(() => this.focusSessionItemMenuCommand(this.openSessionListMenuIndex, this.openSessionListMenuCommandIndex));
    }
  }

  private handleSessionItemMenuKeydown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionItemMenus();
      this.options.sessionsElement.focus({ preventScroll: true });
      return true;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.moveSessionItemMenuSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.moveSessionItemMenuSelection(-1);
      return true;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const focusedCommand = eventTargetElement(event)?.closest('.sessions__menu-item')?.getAttribute('data-session-command');
      this.runOpenSessionItemMenuCommand(focusedCommand ?? sessionItemMenuCommands[this.openSessionListMenuCommandIndex]);
      return true;
    }

    return false;
  }

  private moveSessionItemMenuSelection(delta: number): void {
    if (this.openSessionListMenuIndex === undefined) {
      return;
    }

    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[this.openSessionListMenuIndex] : undefined;
    const enabledIndexes = this.getEnabledSessionItemMenuCommandIndexes(session);

    if (enabledIndexes.length === 0) {
      return;
    }

    const currentPosition = enabledIndexes.indexOf(this.openSessionListMenuCommandIndex);
    const nextPosition = currentPosition >= 0
      ? (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length
      : (delta > 0 ? 0 : enabledIndexes.length - 1);
    this.openSessionListMenuCommandIndex = enabledIndexes[nextPosition];
    this.focusSessionItemMenuCommand(this.openSessionListMenuIndex, this.openSessionListMenuCommandIndex);
  }

  private focusSessionItemMenuCommand(sessionIndex: number | undefined, commandIndex: number): void {
    if (sessionIndex === undefined) {
      return;
    }

    const item = document.getElementById('session-' + sessionIndex);
    const commandButton = item?.querySelector<HTMLButtonElement>('.sessions__menu-item[data-session-command-index="' + commandIndex + '"]:not(:disabled)')
      ?? item?.querySelector<HTMLButtonElement>('.sessions__menu-item:not(:disabled)');
    commandButton?.focus({ preventScroll: true });
  }

  private runOpenSessionItemMenuCommand(command: SessionItemCommand | string | null | undefined): void {
    if (this.openSessionListMenuIndex === undefined) {
      return;
    }

    this.runSessionItemMenuCommand(this.openSessionListMenuIndex, typeof command === 'string' ? command : null);
  }

  private getFirstEnabledSessionItemMenuCommandIndex(session: SessionItem): number {
    return this.getEnabledSessionItemMenuCommandIndexes(session)[0] ?? 0;
  }

  private getEnabledSessionItemMenuCommandIndexes(session: SessionItem | undefined): number[] {
    if (!session) {
      return [];
    }

    const indexes: number[] = [];

    for (let index = 0; index < sessionItemMenuCommands.length; index += 1) {
      if (this.canRunSessionItemCommand(session, sessionItemMenuCommands[index])) {
        indexes.push(index);
      }
    }

    return indexes;
  }

  private runSessionItemMenuCommand(index: number, command: string | null): void {
    const state = this.options.getState();
    const parsedCommand = parseSessionItemCommand(command);
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!parsedCommand || !session?.path || !this.isSessionIndexVisible(index) || !this.canRunSessionItemCommand(session, parsedCommand)) {
      return;
    }

    this.closeSessionItemMenus();

    if (parsedCommand === 'delete') {
      this.options.postMessage({ type: 'deleteSession', sessionPath: session.path });
      return;
    }

    if (parsedCommand === 'rename') {
      this.startSessionListNameEdit(index);
      return;
    }

    this.options.postMessage({ type: 'sessionItemCommand', sessionPath: session.path, command: parsedCommand });
  }

  private startSessionListNameEdit(index: number): void {
    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session?.path || !this.canRunSessionItemCommand(session, 'rename')) {
      return;
    }

    this.sessionListSelectedIndex = this.clampSessionIndex(index);
    this.sessionListNameEditPath = session.path;
    this.sessionListNameEditInitialValue = session.name?.trim() ?? '';
    this.sessionListNameEditValue = this.sessionListNameEditInitialValue;
    this.sessionListNameEditShouldSelect = true;
    this.closeSessionItemMenus();
    this.renderSessions();
  }

  private updateSessionListNameEditValue(value: string): void {
    this.sessionListNameEditValue = value;
  }

  private commitSessionListNameEdit(name: string): void {
    const sessionPath = this.sessionListNameEditPath;

    if (!sessionPath) {
      return;
    }

    const nextName = name.trim();
    const previousName = this.sessionListNameEditInitialValue.trim();
    this.stopSessionListNameEdit();
    this.renderSessions();

    if (nextName === previousName) {
      return;
    }

    this.options.postMessage({ type: 'setSessionItemName', sessionPath, name: nextName });
  }

  private cancelSessionListNameEdit(options: { focusList?: boolean } = {}): void {
    if (!this.sessionListNameEditPath) {
      return;
    }

    this.stopSessionListNameEdit();
    this.renderSessions();

    if (options.focusList) {
      requestAnimationFrame(() => this.options.sessionsElement.focus({ preventScroll: true }));
    }
  }

  private handleSessionListNameInputBlur(): void {
    if (this.suppressSessionListNameInputBlur) {
      return;
    }

    this.cancelSessionListNameEdit();
  }

  private focusSessionListNameInput(options: { select?: boolean; selectionStart?: number | null; selectionEnd?: number | null } = {}): void {
    const input = this.options.sessionsElement.querySelector<HTMLInputElement>('.sessions__name-input');
    input?.focus({ preventScroll: true });

    if (!input) {
      return;
    }

    if (options.select) {
      input.select();
      return;
    }

    if (options.selectionStart !== null && options.selectionStart !== undefined) {
      input.setSelectionRange(options.selectionStart, options.selectionEnd ?? options.selectionStart);
    }
  }

  private createSessionSearchElement(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sessions__search';

    const input = document.createElement('input');
    input.className = 'sessions__search-input';
    input.type = 'search';
    input.value = this.sessionSearchQuery;
    input.placeholder = 'Search sessions';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Search sessions');
    input.addEventListener('input', () => this.updateSessionSearchQuery(input.value, input.selectionStart, input.selectionEnd));
    input.addEventListener('focus', () => this.handleSessionSearchFocus());
    input.addEventListener('blur', () => this.handleSessionSearchBlur());
    input.addEventListener('click', (event) => event.stopPropagation());
    wrap.append(input);

    const namedOnlyButton = document.createElement('button');
    namedOnlyButton.className = 'sessions__named-filter';
    namedOnlyButton.classList.toggle('sessions__named-filter--active', this.sessionNamedOnlyFilter);
    namedOnlyButton.type = 'button';
    namedOnlyButton.innerHTML = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.75 2.5H8.6C8.95 2.5 9.29 2.64 9.54 2.89L13.1 6.45C13.62 6.97 13.62 7.81 13.1 8.33L8.33 13.1C7.81 13.62 6.97 13.62 6.45 13.1L2.89 9.54C2.64 9.29 2.5 8.95 2.5 8.6V3.75C2.5 3.06 3.06 2.5 3.75 2.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="5.65" cy="5.65" r="1" fill="currentColor"/><path d="M7.35 8.3H10.7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg><span class="tau-icon-action-tooltip">Filter to named sessions</span>';
    namedOnlyButton.setAttribute('aria-label', 'Filter to named sessions');
    namedOnlyButton.setAttribute('aria-pressed', this.sessionNamedOnlyFilter ? 'true' : 'false');
    namedOnlyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleNamedOnlyFilter();
    });
    wrap.append(namedOnlyButton);

    return wrap;
  }

  private handleSessionSearchFocus(): void {
    this.disableSessionPointerHover();
    this.setSessionListHighlightEnabled(false);
  }

  private handleSessionSearchBlur(): void {
    this.setSessionListHighlightEnabled(true);
  }

  private setSessionListHighlightEnabled(enabled: boolean): void {
    const activeItem = document.getElementById('session-' + this.sessionListSelectedIndex);

    for (const item of this.options.sessionsElement.querySelectorAll<HTMLElement>('.sessions__item')) {
      const isActive = enabled && item === activeItem;
      item.classList.toggle('sessions__item--active', isActive);
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  private updateSessionSearchQuery(value: string, selectionStart: number | null, selectionEnd: number | null): void {
    if (value === this.sessionSearchQuery) {
      return;
    }

    this.sessionSearchQuery = value;
    this.closeSessionItemMenus();
    this.renderSessions();
    requestAnimationFrame(() => {
      const input = this.options.sessionsElement.querySelector<HTMLInputElement>('.sessions__search-input');
      input?.focus({ preventScroll: true });

      if (input && selectionStart !== null) {
        input.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
      }
    });
  }

  private handleSessionSearchKeydown(event: KeyboardEvent, input: HTMLInputElement): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    if (event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.focusFirstVisibleSession();
      return true;
    }

    if (event.key === 'Escape') {
      if (input.value.length > 0 || this.sessionSearchQuery.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.updateSessionSearchQuery('', 0, 0);
        return true;
      }

      this.hideSessionList(event);
      return true;
    }

    event.stopPropagation();
    this.sessionSearchQuery = input.value;
    return true;
  }

  private focusFirstVisibleSession(): void {
    const firstVisibleIndex = this.getVisibleSessionIndexes()[0];

    if (firstVisibleIndex === undefined) {
      return;
    }

    this.sessionListSelectedIndex = firstVisibleIndex;
    this.closeSessionItemMenus();
    this.renderSessions();
    requestAnimationFrame(() => {
      this.options.sessionsElement.focus({ preventScroll: true });
      this.setSessionListHighlightEnabled(true);
      document.getElementById('session-' + firstVisibleIndex)?.scrollIntoView({ block: 'nearest' });
    });
  }

  private focusSessionSearchInput(options: { select?: boolean; selectionStart?: number | null; selectionEnd?: number | null; reveal?: boolean } = {}): void {
    const input = this.options.sessionsElement.querySelector<HTMLInputElement>('.sessions__search-input');

    if (options.reveal) {
      this.cancelPendingSessionSelectionScroll();
      this.options.sessionsElement.scrollTop = 0;
    }

    input?.focus({ preventScroll: true });

    if (!input) {
      return;
    }

    if (options.select ?? true) {
      input.select();
      return;
    }

    if (options.selectionStart !== null && options.selectionStart !== undefined) {
      input.setSelectionRange(options.selectionStart, options.selectionEnd ?? options.selectionStart);
    }
  }

  private handleNamedOnlyFilterKeydown(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleNamedOnlyFilter();
      return true;
    }

    return false;
  }

  private toggleNamedOnlyFilter(): void {
    this.sessionNamedOnlyFilter = !this.sessionNamedOnlyFilter;
    this.closeSessionItemMenus();
    this.renderSessions();
  }

  private hasActiveSessionListFilters(): boolean {
    return Boolean(this.sessionSearchQuery.trim()) || this.sessionNamedOnlyFilter;
  }

  private getSessionListEmptyText(): string {
    if (this.sessionNamedOnlyFilter && this.sessionSearchQuery.trim()) {
      return 'No named sessions match your search.';
    }

    if (this.sessionNamedOnlyFilter) {
      return 'No named sessions found.';
    }

    return 'No sessions match your search.';
  }

  private handleSessionListCommandKey(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    const command = getSessionListCommandForKey(event.key);

    if (!command) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.runSessionItemMenuCommand(this.sessionListSelectedIndex, command);
    return true;
  }

  private canRunSessionItemCommand(session: SessionItem, command?: SessionItemCommand): boolean {
    const state = this.options.getState();

    if (command === 'delete') {
      return this.canDeleteSession(session);
    }

    return session.liveStatus !== 'running' && !(session.current && state.busy);
  }

  private canDeleteSession(session: SessionItem): boolean {
    const state = this.options.getState();
    return session.liveStatus !== 'running' && !(session.current && state.busy);
  }

  private getVisibleSessionIndexes(): number[] {
    const state = this.options.getState();

    return getVisibleSessionIndexes(Array.isArray(state.sessions) ? state.sessions : [], this.sessionSearchQuery, {
      namedOnly: this.sessionNamedOnlyFilter
    });
  }

  private isSessionIndexVisible(index: number): boolean {
    return this.getVisibleSessionIndexes().includes(index);
  }

  private clampSessionIndex(index: number): number {
    const state = this.options.getState();
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;

    if (count === 0) {
      return 0;
    }

    return Math.max(0, Math.min(index, count - 1));
  }

  private setSessionMenuItemHover(item: HTMLButtonElement, hovered: boolean): void {
    item.classList.toggle('pi-toolbar__menu-item--hover', hovered);
  }

  private getCurrentSessionName(): string {
    const state = this.options.getState();
    return (this.getCurrentSession()?.name ?? state.currentSessionName ?? '').trim();
  }

  private getCurrentSessionPath(): string {
    const state = this.options.getState();
    return (this.getCurrentSession()?.path ?? state.currentSessionFile ?? '').trim();
  }

  private getCurrentSessionTimestamp(): string {
    return this.getCurrentSession()?.modified ?? '';
  }

}

function isTextInputShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
    return false;
  }

  const key = event.key.toLowerCase();
  return key === 'a' || key === 'c' || key === 'v' || key === 'x' || key === 'z' || key === 'y';
}
