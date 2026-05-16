import { buildSessionTreePrefix, formatSessionMeta, getSessionDisplayName, shortenPath } from '../sessionFormat';
import {
  getSessionItemCommandIcon,
  getSessionItemCommandLabel,
  parseSessionItemCommand,
  sessionItemMenuCommands
} from '../sessionItemCommands';
import type { SessionItem, SessionItemCommand, TreeItem, WebviewState } from '../types';

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
  private treeListSelectedIndex = 0;
  private sessionPointerHoverEnabled = false;
  private openSessionListMenuIndex: number | undefined;
  private openSessionListMenuCommandIndex = 0;
  private sessionListNameEditPath: string | undefined;
  private sessionListNameEditInitialValue = '';
  private sessionNameEditing = false;
  private sessionNameEditInitialValue = '';

  public constructor(private readonly options: SessionViewControllerOptions) {}

  public attachEventListeners(): void {
    this.options.sessionToggleButton.addEventListener('click', () => this.toggleSessionView());
    this.options.toolbarTitleElement.addEventListener('dblclick', (event) => this.startSessionNameEdit(event));
    this.options.sessionMenuButton.addEventListener('click', (event) => this.toggleSessionCommandMenu(event));

    for (const item of this.options.sessionMenuItemElements) {
      item.addEventListener('click', () => this.runSessionMenuCommand(item.getAttribute('data-session-command')));
      item.addEventListener('pointerenter', () => this.setSessionMenuItemHover(item, true));
      item.addEventListener('pointerleave', () => this.setSessionMenuItemHover(item, false));
      item.addEventListener('focus', () => this.setSessionMenuItemHover(item, true));
      item.addEventListener('blur', () => this.setSessionMenuItemHover(item, false));
    }

    this.options.sessionNameInputElement.addEventListener('blur', () => this.cancelSessionNameEdit());
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
    if (this.sessionNameEditing && event.target === this.options.sessionNameInputElement) {
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

    const sessionListNameInput = eventTargetElement(event)?.closest('.sessions__name-input');

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

    const state = this.options.getState();
    return (state.viewMode === 'sessions' || state.viewMode === 'tree') && this.handleSessionListKeydown(event);
  }

  public syncForRender(isListView: boolean): void {
    const state = this.options.getState();

    if (state.viewMode !== 'sessions') {
      this.openSessionListMenuIndex = undefined;
      this.openSessionListMenuCommandIndex = 0;
      this.stopSessionListNameEdit();
    }

    const toolbarTitle = state.viewMode === 'sessions' ? 'Sessions' : state.viewMode === 'tree' ? 'Session tree' : this.getCurrentSessionTitle();
    if ((isListView || state.busy) && this.sessionNameEditing) {
      this.cancelSessionNameEdit();
    }
    this.options.toolbarTitleTextElement.textContent = toolbarTitle;
    this.options.toolbarTitleElement.title = toolbarTitle;
    this.options.toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', this.sessionNameEditing);
    this.options.toolbarTitleTextElement.hidden = this.sessionNameEditing;
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
    this.options.sessionMenuWrapElement.hidden = isListView;
    this.options.sessionMenuButton.disabled = state.busy || this.sessionNameEditing;
    this.syncSessionCommandMenuItems();
    if (isListView || state.busy || this.sessionNameEditing) {
      this.closeSessionCommandMenu();
    }
    this.options.sessionToggleButton.title = isListView ? 'Back to chat' : 'Show sessions';
    this.options.sessionToggleButton.setAttribute('aria-label', this.options.sessionToggleButton.title);
    this.options.sessionToggleButton.classList.toggle('pi-toolbar__sessions--back', isListView);
  }

  public renderSessions(): void {
    const state = this.options.getState();
    this.options.sessionsElement.replaceChildren();
    this.sessionListSelectedIndex = this.clampSessionIndex(this.sessionListSelectedIndex);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    if (this.openSessionListMenuIndex !== undefined && this.openSessionListMenuIndex >= count) {
      this.openSessionListMenuIndex = undefined;
    }
    header.textContent = state.sessionsRefreshing
      ? 'Loading sessions...'
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
      return;
    }

    if (count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('No sessions found for this workspace.'));
      return;
    }

    for (let index = 0; index < state.sessions.length; index += 1) {
      this.options.sessionsElement.append(this.createSessionItemElement(state.sessions[index], index));
    }

    if (this.sessionListNameEditPath) {
      requestAnimationFrame(() => this.focusSessionListNameInput());
    }
  }

  public renderTree(): void {
    const state = this.options.getState();
    this.options.sessionsElement.replaceChildren();
    this.treeListSelectedIndex = this.clampTreeIndex(this.treeListSelectedIndex);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    header.textContent = state.treeRefreshing
      ? 'Loading session tree...'
      : count === 1
      ? '1 tree entry'
      : count + ' tree entries';
    this.options.sessionsElement.append(header);

    if (state.treeError) {
      const error = document.createElement('div');
      error.className = 'sessions__error';
      error.textContent = state.treeError;
      this.options.sessionsElement.append(error);
    }

    if (state.treeRefreshing && count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('Loading session tree...'));
      return;
    }

    if (count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('No persisted tree entries found for this session.'));
      return;
    }

    for (let index = 0; index < state.treeItems.length; index += 1) {
      this.options.sessionsElement.append(this.createTreeItemElement(state.treeItems[index], index));
    }
  }

  public selectCurrentTreeEntry(): void {
    const state = this.options.getState();
    const currentIndex = Array.isArray(state.treeItems)
      ? state.treeItems.findIndex((item) => item.current)
      : -1;
    this.treeListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
  }

  public selectCurrentSession(): void {
    const state = this.options.getState();
    const currentIndex = Array.isArray(state.sessions)
      ? state.sessions.findIndex((session) => session.current || session.path === state.currentSessionFile)
      : -1;
    this.sessionListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
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

  public isSessionListNameEditingMissing(): boolean {
    const state = this.options.getState();
    return Boolean(this.sessionListNameEditPath && !state.sessions.some((session) => session.path === this.sessionListNameEditPath));
  }

  public hasSlashOrSessionUiOpen(): { sessionCommandMenu: boolean; sessionNameEditing: boolean } {
    return {
      sessionCommandMenu: !this.options.sessionMenuElement.hidden,
      sessionNameEditing: this.sessionNameEditing
    };
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

  public closeSessionCommandMenu(): void {
    this.options.sessionMenuElement.hidden = true;
    this.options.sessionMenuButton.setAttribute('aria-expanded', 'false');
    for (const item of this.options.sessionMenuItemElements) {
      this.setSessionMenuItemHover(item, false);
    }
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
    state.viewMode === 'tree' ? this.selectTreeIndex(index) : this.selectSessionIndex(index);
  }

  private createSessionItemElement(session: SessionItem, index: number): HTMLElement {
    const item = document.createElement('div');
    item.id = 'session-' + index;
    item.className = 'sessions__item'
      + (index === this.sessionListSelectedIndex ? ' sessions__item--active' : '')
      + (session.current ? ' sessions__item--current' : '')
      + (session.liveStatus ? ' sessions__item--' + session.liveStatus : '')
      + (session.unread ? ' sessions__item--unread' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === this.sessionListSelectedIndex ? 'true' : 'false');
    item.setAttribute('data-index', String(index));

    const prefix = document.createElement('span');
    prefix.className = 'sessions__prefix';
    prefix.textContent = (session.liveStatus === 'running' ? '● ' : '') + buildSessionTreePrefix(session);
    item.append(prefix);

    const title = document.createElement('span');
    title.className = 'sessions__title';

    if (this.sessionListNameEditPath === session.path) {
      title.append(this.createSessionListNameInput(session));
    } else {
      const titleText = document.createElement('span');
      titleText.className = 'sessions__title-text';
      titleText.textContent = getSessionDisplayName(session);
      title.append(titleText);
    }

    item.append(title);

    const meta = document.createElement('span');
    meta.className = 'sessions__meta';
    meta.textContent = formatSessionMeta(session);
    item.append(meta);

    if (session.cwd) {
      const cwd = document.createElement('span');
      cwd.className = 'sessions__cwd';
      cwd.textContent = shortenPath(session.cwd);
      item.append(cwd);
    }

    item.append(this.createSessionItemMenuElement(session, index));

    return item;
  }

  private createSessionListNameInput(session: SessionItem): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'sessions__name-input';
    input.type = 'text';
    input.value = this.sessionListNameEditInitialValue;
    input.placeholder = getSessionDisplayName(session);
    input.setAttribute('aria-label', 'Session name');
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('blur', () => this.cancelSessionListNameEdit());
    return input;
  }

  private createSessionItemMenuElement(session: SessionItem, index: number): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'sessions__menu-wrap';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sessions__menu-button';
    button.title = 'Session commands';
    button.setAttribute('aria-label', 'Session commands');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', this.openSessionListMenuIndex === index ? 'true' : 'false');
    button.disabled = !this.canRunSessionItemCommand(session);
    button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg>';
    wrap.append(button);

    const menu = document.createElement('span');
    menu.className = 'sessions__menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = this.openSessionListMenuIndex !== index;

    for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
      const command = sessionItemMenuCommands[commandIndex];

      if (command === 'showChanges') {
        const separator = document.createElement('span');
        separator.className = 'pi-toolbar__menu-separator';
        separator.setAttribute('role', 'separator');
        menu.append(separator);
      }

      menu.append(this.createSessionItemMenuButton(command, session, commandIndex));
    }

    wrap.append(menu);
    return wrap;
  }

  private createSessionItemMenuButton(command: SessionItemCommand, session: SessionItem, commandIndex: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pi-toolbar__menu-item sessions__menu-item';
    button.setAttribute('role', 'menuitem');
    button.setAttribute('data-session-command', command);
    button.setAttribute('data-session-command-index', String(commandIndex));
    button.disabled = !this.canRunSessionItemCommand(session, command);
    button.innerHTML = '<span class="pi-toolbar__menu-label">' + getSessionItemCommandLabel(command) + '</span>' + getSessionItemCommandIcon(command);
    button.addEventListener('pointerenter', () => {
      this.openSessionListMenuCommandIndex = commandIndex;
      this.setSessionMenuItemHover(button, true);
    });
    button.addEventListener('pointerleave', () => this.setSessionMenuItemHover(button, false));
    button.addEventListener('focus', () => {
      this.openSessionListMenuCommandIndex = commandIndex;
      this.setSessionMenuItemHover(button, true);
    });
    button.addEventListener('blur', () => this.setSessionMenuItemHover(button, false));
    return button;
  }

  private createTreeItemElement(treeItem: TreeItem, index: number): HTMLElement {
    const state = this.options.getState();
    const item = document.createElement('button');
    item.type = 'button';
    item.id = 'tree-' + index;
    item.className = 'sessions__item'
      + (index === this.treeListSelectedIndex ? ' sessions__item--active' : '')
      + (treeItem.current ? ' sessions__item--current' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === this.treeListSelectedIndex ? 'true' : 'false');
    item.setAttribute('data-index', String(index));
    item.disabled = state.busy || state.treeRefreshing;

    const title = document.createElement('span');
    title.className = 'sessions__title';
    title.textContent = treeItem.role + ': ' + (treeItem.text || '(empty)');
    item.append(title);

    return item;
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
      state.viewMode === 'tree' ? this.moveTreeSelection(1) : this.moveSessionSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSessionItemMenus();
      state.viewMode === 'tree' ? this.moveTreeSelection(-1) : this.moveSessionSelection(-1);
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
      state.viewMode === 'tree' ? this.selectTreeIndex(this.treeListSelectedIndex) : this.selectSessionIndex(this.sessionListSelectedIndex);
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
    const state = this.options.getState();

    if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
      return;
    }

    this.sessionListSelectedIndex = this.clampSessionIndex(this.sessionListSelectedIndex + delta);
    this.renderSessions();
    document.getElementById('session-' + this.sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
  }

  private selectSessionIndex(index: number): void {
    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session?.path) {
      return;
    }

    this.options.postMessage({ type: 'selectSession', sessionPath: session.path });
  }

  private deleteSessionIndex(index: number): void {
    const state = this.options.getState();
    const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

    if (!session?.path || !this.canDeleteSession(session)) {
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

    if (!Number.isInteger(index) || index < 0 || state.viewMode !== 'sessions') {
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

    if (!parsedCommand || !session?.path || !this.canRunSessionItemCommand(session, parsedCommand)) {
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

  private clampSessionIndex(index: number): number {
    const state = this.options.getState();
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;

    if (count === 0) {
      return 0;
    }

    return Math.max(0, Math.min(index, count - 1));
  }

  private moveTreeSelection(delta: number): void {
    const state = this.options.getState();

    if (!Array.isArray(state.treeItems) || state.treeItems.length === 0) {
      return;
    }

    this.treeListSelectedIndex = this.clampTreeIndex(this.treeListSelectedIndex + delta);
    this.renderTree();
    document.getElementById('tree-' + this.treeListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
  }

  private selectTreeIndex(index: number): void {
    const state = this.options.getState();
    const treeItem = Array.isArray(state.treeItems) ? state.treeItems[index] : undefined;

    if (!treeItem?.entryId || state.busy || state.treeRefreshing) {
      return;
    }

    this.options.postMessage({ type: 'selectTreeEntry', entryId: treeItem.entryId });
  }

  private clampTreeIndex(index: number): number {
    const state = this.options.getState();
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;

    if (count === 0) {
      return 0;
    }

    return Math.max(0, Math.min(index, count - 1));
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

    const initialName = this.getCurrentSessionName();
    this.sessionNameEditing = true;
    this.sessionNameEditInitialValue = initialName;
    this.options.sessionNameInputElement.value = initialName;
    this.options.sessionNameInputElement.placeholder = initialName ? '' : this.getCurrentSessionTitle();
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
    this.options.sessionNameInputElement.hidden = !this.sessionNameEditing;
    this.options.sessionMenuButton.disabled = state.busy || this.sessionNameEditing;
  }

  private toggleSessionCommandMenu(event?: MouseEvent): void {
    const state = this.options.getState();
    event?.preventDefault();
    event?.stopPropagation();

    if (state.viewMode === 'sessions' || state.viewMode === 'tree' || state.busy || this.sessionNameEditing) {
      return;
    }

    this.options.closeSlashMenu();
    this.options.closeModelMenu();

    const isOpen = !this.options.sessionMenuElement.hidden;
    this.options.sessionMenuElement.hidden = isOpen;
    this.options.sessionMenuButton.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  }

  private syncSessionCommandMenuItems(): void {
    const state = this.options.getState();

    for (const item of this.options.sessionMenuItemElements) {
      const command = item.getAttribute('data-session-command');
      item.disabled = state.busy || this.sessionNameEditing || ((command === 'delete' || command === 'showChanges') && !this.getCurrentSessionPath());
    }
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

    if (command === 'showChanges') {
      const sessionPath = this.getCurrentSessionPath();

      if (!sessionPath) {
        return;
      }

      this.closeSessionCommandMenu();
      this.options.postMessage({ type: 'sessionItemCommand', sessionPath, command });
      this.options.focusPromptInput();
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

  private getCurrentSessionName(): string {
    const state = this.options.getState();
    return (this.getCurrentSession()?.name ?? state.currentSessionName ?? '').trim();
  }

  private getCurrentSessionPath(): string {
    const state = this.options.getState();
    return (this.getCurrentSession()?.path ?? state.currentSessionFile ?? '').trim();
  }

  private deleteCurrentSession(): void {
    const sessionPath = this.getCurrentSessionPath();

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
      this.options.postMessage({ type: 'hideSessions' });
      this.options.focusPromptInput();
      return;
    }

    this.options.postMessage({ type: 'showSessions' });
  }
}

function createSessionEmptyElement(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'sessions__empty';
  empty.textContent = text;
  return empty;
}

function getSessionListCommandForKey(key: string): SessionItemCommand | undefined {
  switch (key.toLowerCase()) {
    case 'r':
      return 'rename';
    case 'f':
      return 'fork';
    case 'c':
      return 'clone';
    case 'z':
      return 'compact';
    case 'e':
      return 'export';
    default:
      return undefined;
  }
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}
