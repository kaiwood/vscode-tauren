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
  sessionNameInputElement: HTMLInputElement;
  sessionToggleButton: HTMLButtonElement;
  sessionMenuWrapElement: HTMLElement;
  sessionMenuButton: HTMLButtonElement;
  sessionMenuElement: HTMLElement;
  sessionMenuItemElements: HTMLButtonElement[];
  focusPromptInput: () => void;
  closeSlashMenu: () => void;
  closeModelMenu: () => void;
  runSessionSlashCommand: (command: 'fork' | 'clone' | 'compact' | 'reload' | 'export') => void;
};

export class SessionViewController {
  private sessionListSelectedIndex = 0;
  private sessionSearchQuery = '';
  private sessionPointerHoverEnabled = false;
  private openSessionListMenuIndex: number | undefined;
  private openSessionListMenuCommandIndex = 0;
  private sessionListNameEditPath: string | undefined;
  private sessionListNameEditInitialValue = '';
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
      sessionNameInputElement: options.sessionNameInputElement,
      sessionToggleButton: options.sessionToggleButton,
      sessionMenuWrapElement: options.sessionMenuWrapElement,
      sessionMenuButton: options.sessionMenuButton,
      sessionMenuElement: options.sessionMenuElement,
      sessionMenuItemElements: options.sessionMenuItemElements,
      focusPromptInput: options.focusPromptInput,
      closeSlashMenu: options.closeSlashMenu,
      closeModelMenu: options.closeModelMenu,
      runSessionSlashCommand: options.runSessionSlashCommand,
      getCurrentSessionTitle: () => this.getCurrentSessionTitle(),
      getCurrentSessionName: () => this.getCurrentSessionName(),
      getCurrentSessionPath: () => this.getCurrentSessionPath()
    });
  }

  public attachEventListeners(): void {
    this.topControls.attachEventListeners();
    this.options.sessionsElement.addEventListener('keydown', (event) => this.handleSessionListKeydown(event));
    this.options.sessionsElement.addEventListener('pointermove', () => this.enableSessionPointerHover());
    this.options.sessionsElement.addEventListener('click', (event) => this.handleSessionsClick(event));
  }

  public handleWindowClick(target: Node | null, eventTarget: Element | null): void {
    if (!this.options.sessionMenuWrapElement.contains(target)) {
      this.closeSessionCommandMenu();
    }

    if (!target || !this.options.sessionsElement.contains(target) || !eventTarget?.closest('.sessions__menu-wrap')) {
      this.closeSessionItemMenus();
    }
  }

  public handleGlobalKeydown(event: KeyboardEvent): boolean {
    if (this.topControls.handleGlobalKeydown(event)) {
      return true;
    }

    const state = this.options.getState();
    const target = eventTargetElement(event);
    const sessionSearchInput = target?.closest('.sessions__search-input');

    if (sessionSearchInput instanceof HTMLInputElement && state.viewMode === 'sessions') {
      return this.handleSessionSearchKeydown(event, sessionSearchInput);
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

      event.stopPropagation();
      return true;
    }

    return (state.viewMode === 'sessions' || state.viewMode === 'tree') && this.handleSessionListKeydown(event);
  }

  public syncForRender(isListView: boolean): void {
    const state = this.options.getState();

    if (state.viewMode !== 'sessions') {
      this.sessionSearchQuery = '';
      this.openSessionListMenuIndex = undefined;
      this.openSessionListMenuCommandIndex = 0;
      this.stopSessionListNameEdit();
    }

    this.topControls.syncForRender(isListView);
  }

  public renderSessions(): void {
    const state = this.options.getState();
    const searchInput = this.isSessionSearchFocused() ? document.activeElement as HTMLInputElement : undefined;
    const selectedIndex = searchInput ? -1 : this.sessionListSelectedIndex;
    const searchSelectionStart = searchInput?.selectionStart ?? null;
    const searchSelectionEnd = searchInput?.selectionEnd ?? null;
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    const visibleIndexes = this.getVisibleSessionIndexes();
    this.sessionListSelectedIndex = ensureVisibleSessionSelection(this.sessionListSelectedIndex, visibleIndexes);
    this.options.sessionsElement.replaceChildren();

    const search = this.createSessionSearchElement();
    this.options.sessionsElement.append(search);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    if (this.openSessionListMenuIndex !== undefined && !visibleIndexes.includes(this.openSessionListMenuIndex)) {
      this.openSessionListMenuIndex = undefined;
    }
    header.textContent = state.sessionsRefreshing
      ? 'Loading sessions...'
      : this.sessionSearchQuery.trim() && visibleIndexes.length !== count
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
      this.options.sessionsElement.append(createSessionEmptyElement('No sessions match your search.'));
    } else {
      for (const index of visibleIndexes) {
        this.options.sessionsElement.append(createSessionItemElement({
          session: state.sessions[index],
          index,
          selectedIndex,
          nameEditPath: this.sessionListNameEditPath,
          nameEditInitialValue: this.sessionListNameEditInitialValue,
          openMenuIndex: this.openSessionListMenuIndex,
          canRunSessionItemCommand: (session, command) => this.canRunSessionItemCommand(session, command),
          onNameInputBlur: () => this.cancelSessionListNameEdit(),
          onCommandActivate: (commandIndex, button) => {
            this.openSessionListMenuCommandIndex = commandIndex;
            this.setSessionMenuItemHover(button, true);
          },
          onCommandHover: (button, hovered) => this.setSessionMenuItemHover(button, hovered)
        }));
      }
    }

    if (this.sessionListNameEditPath) {
      requestAnimationFrame(() => this.focusSessionListNameInput());
    } else if (searchInput) {
      this.focusSessionSearchInput({ select: false, selectionStart: searchSelectionStart, selectionEnd: searchSelectionEnd });
    }
  }

  public renderTree(): void {
    this.treeController.render();
  }

  public selectCurrentTreeEntry(): void {
    this.treeController.selectCurrent();
  }

  public selectFirstVisibleSession(): void {
    this.sessionListSelectedIndex = this.getVisibleSessionIndexes()[0] ?? 0;
  }

  public disableSessionPointerHover(): void {
    this.sessionPointerHoverEnabled = false;
    this.options.sessionsElement.classList.remove('sessions--pointer-hover');
  }

  public stopSessionListNameEdit(): void {
    this.sessionListNameEditPath = undefined;
    this.sessionListNameEditInitialValue = '';
  }

  public isSessionListNameEditing(): boolean {
    return Boolean(this.sessionListNameEditPath);
  }

  public isSessionSearchFocused(): boolean {
    return document.activeElement instanceof HTMLInputElement
      && document.activeElement.classList.contains('sessions__search-input');
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

    if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
      return undefined;
    }

    return (state.currentSessionFile ? state.sessions.find((session) => session.path === state.currentSessionFile) : undefined)
      ?? state.sessions.find((session) => session.current);
  }

  private handleSessionListKeydown(event: KeyboardEvent): boolean {
    const state = this.options.getState();

    if (state.viewMode !== 'sessions' && state.viewMode !== 'tree') {
      return false;
    }

    if (this.openSessionListMenuIndex !== undefined && this.handleSessionItemMenuKeydown(event)) {
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.options.postMessage({ type: 'hideSessions' });
      this.options.focusPromptInput();
      return true;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionItemMenus();
      state.viewMode === 'tree' ? this.treeController.moveSelection(1) : this.moveSessionSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
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

  private enableSessionPointerHover(): void {
    if (this.sessionPointerHoverEnabled) {
      return;
    }

    this.sessionPointerHoverEnabled = true;
    this.options.sessionsElement.classList.add('sessions--pointer-hover');
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

    this.sessionListSelectedIndex = nextIndex;
    this.renderSessions();
    document.getElementById('session-' + this.sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
  }

  private moveSessionSelectionUpOrFocusSearch(): void {
    const visibleIndexes = this.getVisibleSessionIndexes();

    if (visibleIndexes.length === 0 || this.sessionListSelectedIndex === visibleIndexes[0]) {
      this.focusSessionSearchInput();
      return;
    }

    this.moveSessionSelection(-1);
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
    this.closeSessionItemMenus();
    this.renderSessions();
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

  private focusSessionListNameInput(): void {
    const input = this.options.sessionsElement.querySelector<HTMLInputElement>('.sessions__name-input');
    input?.focus({ preventScroll: true });
    input?.select();
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
    if (event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.focusFirstVisibleSession();
      return true;
    }

    if (event.key === 'Escape' && this.sessionSearchQuery.trim()) {
      event.preventDefault();
      event.stopPropagation();
      this.updateSessionSearchQuery('', 0, 0);
      return true;
    }

    if (event.key !== 'Escape') {
      event.stopPropagation();
      this.sessionSearchQuery = input.value;
      return true;
    }

    return false;
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

  private focusSessionSearchInput(options: { select?: boolean; selectionStart?: number | null; selectionEnd?: number | null } = {}): void {
    const input = this.options.sessionsElement.querySelector<HTMLInputElement>('.sessions__search-input');
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

    return getVisibleSessionIndexes(Array.isArray(state.sessions) ? state.sessions : [], this.sessionSearchQuery);
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

}
