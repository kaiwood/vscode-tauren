import { configureCodeHighlighting, handleCodeHighlightMessage, requestCodeHighlightsIn, watchCodeHighlightThemeChanges } from './codeHighlighting';
import { getWebviewDom } from './dom';
import { createMessageElement, updateMessageBodyElement } from './renderMessages';
import { buildSessionTreePrefix, formatSessionMeta, getSessionDisplayName, shortenPath } from './sessionFormat';
import {
  getSessionItemCommandIcon,
  getSessionItemCommandLabel,
  parseSessionItemCommand,
  sessionItemMenuCommands
} from './sessionItemCommands';
import { initialWebviewState, parseWebviewStateMessage } from './state';
import {
  localSlashCommands,
  maxTextareaHeight,
  messagesBottomThreshold,
  minTextareaHeight
} from './constants';
import type {
  Activity,
  ChatMessage,
  PromptContextAttachment,
  SessionItem,
  SessionItemCommand,
  SlashCommand,
  TreeItem,
  WebviewState,
  WebviewStreamingBehavior
} from './types';

const vscode = acquireVsCodeApi();
configureCodeHighlighting((message) => vscode.postMessage(message));
watchCodeHighlightThemeChanges();
const {
  viewElement,
  toolbarTitleElement,
  toolbarTitleTextElement,
  sessionNameInputElement,
  sessionToggleButton,
  sessionMenuWrapElement,
  sessionMenuButton,
  sessionMenuElement,
  sessionMenuItemElements,
  toastElement,
  messagesElement,
  sessionsElement,
  form,
  textarea,
  slashMenuElement,
  contextBadgesElement,
  busySubmitElement,
  diffSummaryElement,
  diffAddedElement,
  diffRemovedElement,
  streamingBehaviorButtonElements,
  newSessionButton,
  contextElement,
  contextValueElement,
  contextTooltipElement,
  modelElement,
  modelMenuElement,
  modelSelectElement,
  thinkingSelectElement,
  submitButton
} = getWebviewDom();
const messagesContentElement = document.createElement('div');
messagesContentElement.className = 'messages__content';
const busyStatusElement = document.createElement('div');
busyStatusElement.className = 'status';
busyStatusElement.hidden = true;
const busyStatusSpinnerElement = document.createElement('span');
busyStatusSpinnerElement.className = 'status__spinner';
busyStatusSpinnerElement.setAttribute('aria-hidden', 'true');
const busyStatusTextElement = document.createElement('span');
busyStatusElement.append(busyStatusSpinnerElement, busyStatusTextElement);
messagesContentElement.replaceChildren(...Array.from(messagesElement.childNodes));
messagesElement.append(messagesContentElement, busyStatusElement);
const isMac = navigator.platform.toUpperCase().includes('MAC');
let state: WebviewState = { ...initialWebviewState };
let appliedComposerTextRevision = 0;
let slashMenuOpen = false;
let slashMenuActiveIndex = 0;
let slashMenuItems: SlashCommand[] = [];
let slashMenuQuery = '';
let slashMenuDismissedQuery: string | undefined;
let slashCommandsRefreshRequested = false;
let streamingBehavior: WebviewStreamingBehavior = 'steer';
let busySubmitHideTimeout: ReturnType<typeof setTimeout> | undefined;
let toastHideTimeout: ReturnType<typeof setTimeout> | undefined;
let sessionListSelectedIndex = 0;
let treeListSelectedIndex = 0;
let sessionPointerHoverEnabled = false;
let openSessionListMenuIndex: number | undefined;
let openSessionListMenuCommandIndex = 0;
let sessionListNameEditPath: string | undefined;
let sessionListNameEditInitialValue = '';
let sessionNameEditing = false;
let sessionNameEditInitialValue = '';

type DiffCounterState = {
  element: HTMLElement;
  prefix: '+' | '-';
  value: number;
  target: number;
  startValue: number;
  startTime: number;
  duration: number;
  lastText: string;
  animationFrame: number | undefined;
};

const addedDiffCounter = createDiffCounter(diffAddedElement, '+');
const removedDiffCounter = createDiffCounter(diffRemovedElement, '-');

type RenderedMessageView = {
  element: HTMLElement;
  message: ChatMessage;
  showRole: boolean;
  activitiesSignature: string;
  copyable: boolean;
};

let renderedMessageViews: RenderedMessageView[] = [];
window.addEventListener('message', (event) => {
  if (handleCodeHighlightMessage(event.data)) {
    return;
  }

  if (event.data?.type === 'focusInput') {
    focusPromptInput();
    return;
  }

  if (event.data?.type === 'toast') {
    showToast(typeof event.data.message === 'string' ? event.data.message : 'Done.');
    return;
  }

  if (event.data?.type !== 'state') {
    return;
  }

  const previousViewMode = state.viewMode;
  const previousCurrentSessionFile = state.currentSessionFile;
  const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  const previousTreeCount = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
  state = parseWebviewStateMessage(event.data);
  const wasListView = previousViewMode === 'sessions' || previousViewMode === 'tree';
  const isListView = state.viewMode === 'sessions' || state.viewMode === 'tree';

  if (!wasListView && isListView) {
    disableSessionPointerHover();
  }

  if (
    state.viewMode === 'sessions'
    && (previousViewMode !== 'sessions'
      || previousCurrentSessionFile !== state.currentSessionFile
      || previousSessionCount === 0)
  ) {
    selectCurrentSession();
  }

  if (state.viewMode === 'tree' && (previousViewMode !== 'tree' || previousTreeCount === 0)) {
    selectCurrentTreeEntry();
  }
  if (sessionListNameEditPath && !state.sessions.some((session) => session.path === sessionListNameEditPath)) {
    stopSessionListNameEdit();
  }

  render();
  applyComposerTextFromState();

  if (wasListView && state.viewMode === 'chat') {
    scheduleMessagesToBottom();
    focusPromptInput();
  }
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = textarea.value.trim();

  if (!text) {
    return;
  }

  closeSlashMenu();
  cancelSessionNameEdit();
  vscode.postMessage(state.busy
    ? { type: 'submit', text, streamingBehavior }
    : { type: 'submit', text });
  textarea.value = '';
  syncComposer({ preserveBottom: true });
  focusPromptInput();
});

submitButton?.addEventListener('click', (event) => {
  if (!isStopSubmitMode()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  vscode.postMessage({ type: 'abort' });
  focusPromptInput();
});

for (const button of streamingBehaviorButtonElements) {
  button.addEventListener('click', () => {
    const nextBehavior = button.getAttribute('data-streaming-behavior');

    if (nextBehavior === 'steer' || nextBehavior === 'followUp') {
      streamingBehavior = nextBehavior;
      syncComposer({ preserveBottom: true });
      focusPromptInput();
    }
  });
}

newSessionButton?.addEventListener('click', startNewSession);
messagesElement?.addEventListener('click', handleMessageClick);
sessionToggleButton?.addEventListener('click', toggleSessionView);
toolbarTitleElement?.addEventListener('dblclick', startSessionNameEdit);
sessionMenuButton?.addEventListener('click', toggleSessionCommandMenu);
for (const item of sessionMenuItemElements) {
  item.addEventListener('click', () => runSessionMenuCommand(item.getAttribute('data-session-command')));
  item.addEventListener('pointerenter', () => setSessionMenuItemHover(item, true));
  item.addEventListener('pointerleave', () => setSessionMenuItemHover(item, false));
  item.addEventListener('focus', () => setSessionMenuItemHover(item, true));
  item.addEventListener('blur', () => setSessionMenuItemHover(item, false));
}
sessionNameInputElement?.addEventListener('blur', () => cancelSessionNameEdit());
sessionsElement?.addEventListener('keydown', handleSessionListKeydown);
sessionsElement?.addEventListener('pointermove', enableSessionPointerHover);
sessionsElement?.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  const sessionMenuButton = target?.closest('.sessions__menu-button');

  if (sessionMenuButton) {
    event.preventDefault();
    event.stopPropagation();
    const item = sessionMenuButton.closest('.sessions__item');
    const index = Number(item?.getAttribute('data-index'));
    toggleSessionItemMenu(index);
    return;
  }

  const sessionMenuItem = target?.closest('.sessions__menu-item');

  if (sessionMenuItem) {
    event.preventDefault();
    event.stopPropagation();
    const item = sessionMenuItem.closest('.sessions__item');
    const index = Number(item?.getAttribute('data-index'));
    runSessionItemMenuCommand(index, sessionMenuItem.getAttribute('data-session-command'));
    return;
  }

  const item = target?.closest('.sessions__item');

  if (!item) {
    closeSessionItemMenus();
    return;
  }

  closeSessionItemMenus();
  const index = Number(item.getAttribute('data-index'));
  state.viewMode === 'tree' ? selectTreeIndex(index) : selectSessionIndex(index);
});
modelElement?.addEventListener('click', toggleModelMenu);
modelSelectElement?.addEventListener('change', selectModel);
thinkingSelectElement?.addEventListener('change', selectThinkingLevel);

window.addEventListener('click', (event) => {
  const target = eventTargetNode(event);

  if (modelMenuElement?.hasAttribute('open')) {
    if (!modelMenuElement.contains(target) && !modelElement?.contains(target)) {
      closeModelMenu();
    }
  }

  if (!sessionMenuWrapElement.contains(target)) {
    closeSessionCommandMenu();
  }

  if (!target || !(target instanceof Node) || !sessionsElement.contains(target) || !eventTargetElement(event)?.closest('.sessions__menu-wrap')) {
    closeSessionItemMenus();
  }

  if (slashMenuOpen) {
    if (!slashMenuElement?.contains(target) && target !== textarea) {
      closeSlashMenu();
    }
  }
});

window.addEventListener('keydown', (event) => {
  if (sessionNameEditing && event.target === sessionNameInputElement) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commitSessionNameEdit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelSessionNameEdit({ focusPrompt: true });
      return;
    }

    return;
  }

  const sessionListNameInput = eventTargetElement(event)?.closest('.sessions__name-input');

  if (sessionListNameInput instanceof HTMLInputElement) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commitSessionListNameEdit(sessionListNameInput.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelSessionListNameEdit({ focusList: true });
      return;
    }

    event.stopPropagation();
    return;
  }

  if ((state.viewMode === 'sessions' || state.viewMode === 'tree') && handleSessionListKeydown(event)) {
    return;
  }

  if (event.key === 'Escape' && handleChatEscape(event)) {
    return;
  }

  if (handleChatPageScroll(event)) {
    return;
  }

  if (!isNewSessionShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  startNewSession();
}, true);

textarea?.addEventListener('keydown', (event) => {
  if (handleSlashMenuKeydown(event)) {
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form?.requestSubmit();
  }
});

textarea?.addEventListener('input', () => {
  slashMenuDismissedQuery = undefined;
  syncComposer({ preserveBottom: true });
  syncSlashMenu();
});

textarea?.addEventListener('click', syncSlashMenu);
textarea?.addEventListener('blur', closeSlashMenu);
textarea?.addEventListener('keyup', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
    syncSlashMenu();
  }
});

slashMenuElement?.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

slashMenuElement?.addEventListener('click', (event) => {
  const item = eventTargetElement(event)?.closest('.composer__slash-item');

  if (!item) {
    return;
  }

  const index = Number(item.getAttribute('data-index'));
  const command = slashMenuItems[index];

  if (command) {
    acceptSlashCommand(command);
  }
});

contextBadgesElement?.addEventListener('mousedown', (event) => {
  if (eventTargetElement(event)?.closest('.composer__context-remove')) {
    event.preventDefault();
  }
});

contextBadgesElement?.addEventListener('click', (event) => {
  const removeButton = eventTargetElement(event)?.closest('.composer__context-remove');

  if (!removeButton) {
    return;
  }

  const id = removeButton.getAttribute('data-context-id');

  if (!id) {
    return;
  }

  vscode.postMessage({ type: 'removePromptContext', id });
  focusPromptInput();
});

function showToast(message: string): void {
  if (!toastElement) {
    return;
  }

  if (toastHideTimeout) {
    clearTimeout(toastHideTimeout);
  }

  toastElement.textContent = message;
  toastElement.hidden = false;
  toastElement.classList.add('pi-toast--visible');
  toastHideTimeout = setTimeout(() => {
    toastElement.classList.remove('pi-toast--visible');
    toastElement.hidden = true;
    toastHideTimeout = undefined;
  }, 2500);
}

function render() {
  const isListView = state.viewMode === 'sessions' || state.viewMode === 'tree';
  const shouldStickToBottom = !isListView && isMessagesAtBottom();
  if (state.viewMode !== 'sessions') {
    openSessionListMenuIndex = undefined;
    openSessionListMenuCommandIndex = 0;
    stopSessionListNameEdit();
  }
  viewElement.classList.toggle('pi-view--list', isListView);
  viewElement.classList.toggle('pi-view--chat', !isListView);
  messagesElement.hidden = false;
  sessionsElement.hidden = false;
  messagesElement.setAttribute('aria-hidden', isListView ? 'true' : 'false');
  sessionsElement.setAttribute('aria-hidden', isListView ? 'false' : 'true');
  messagesElement.inert = isListView;
  sessionsElement.inert = !isListView;
  sessionsElement.tabIndex = isListView ? 0 : -1;
  form.classList.toggle('composer--list-hidden', isListView);
  form.setAttribute('aria-hidden', isListView ? 'true' : 'false');
  form.inert = isListView;
  const toolbarTitle = state.viewMode === 'sessions' ? 'Sessions' : state.viewMode === 'tree' ? 'Session tree' : getCurrentSessionTitle();
  if ((isListView || state.busy) && sessionNameEditing) {
    cancelSessionNameEdit();
  }
  toolbarTitleTextElement.textContent = toolbarTitle;
  toolbarTitleElement.title = toolbarTitle;
  toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', sessionNameEditing);
  toolbarTitleTextElement.hidden = sessionNameEditing;
  sessionNameInputElement.hidden = !sessionNameEditing;
  sessionMenuWrapElement.hidden = isListView;
  sessionMenuButton.disabled = state.busy || sessionNameEditing;
  syncSessionCommandMenuItems();
  if (isListView || state.busy || sessionNameEditing) {
    closeSessionCommandMenu();
  }
  sessionToggleButton.title = isListView ? 'Back to chat' : 'Show sessions';
  sessionToggleButton.setAttribute('aria-label', sessionToggleButton.title);
  sessionToggleButton.classList.toggle('pi-toolbar__sessions--back', isListView);

  if (isListView) {
    busyStatusElement.hidden = true;
    state.viewMode === 'tree' ? renderTree() : renderSessions();
    closeSlashMenu();
    closeModelMenu();
    closeSessionCommandMenu();
    cancelSessionNameEdit();

    if (!sessionListNameEditPath) {
      requestAnimationFrame(() => sessionsElement?.focus({ preventScroll: true }));
    }

    return;
  }

  renderMessageList();

  syncBusyStatus();
  syncModelLabel();
  syncPromptContextBadges();
  syncComposer();
  syncSlashMenu();
  if (shouldStickToBottom) {
    scrollMessagesToBottom();
  }
}

function renderMessageList(): void {
  if (state.messages.length === 0) {
    renderedMessageViews = [];
    messagesContentElement.replaceChildren(createEmptyStateElement());
    return;
  }

  if (messagesContentElement.querySelector('.empty-state')) {
    messagesContentElement.replaceChildren();
  }

  let previousMessageRole: string | undefined;

  for (const [index, message] of state.messages.entries()) {
    const showRole = message.role !== previousMessageRole;
    const view = renderMessageAtIndex(index, message, showRole);
    const currentNode = messagesContentElement.children[index];

    if (currentNode !== view.element) {
      messagesContentElement.insertBefore(view.element, currentNode ?? null);
    }

    previousMessageRole = message.role;
  }

  for (let index = renderedMessageViews.length - 1; index >= state.messages.length; index -= 1) {
    renderedMessageViews[index]?.element.remove();
  }

  renderedMessageViews.length = state.messages.length;
  requestCodeHighlightsIn(messagesContentElement);
}

function createEmptyStateElement(): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'empty-state';

  if (!state.sessionLoading) {
    empty.textContent = 'Ask Pi about this workspace.';
    return empty;
  }

  empty.classList.add('empty-state--loading');
  const spinner = document.createElement('span');
  spinner.className = 'status__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = 'Loading session…';
  empty.append(spinner, text);
  return empty;
}

function renderMessageAtIndex(index: number, message: ChatMessage, showRole: boolean): RenderedMessageView {
  const existingView = renderedMessageViews[index];
  const activitiesSignature = getActivitiesSignature(message);
  const copyable = canCopyAssistantMessage(message);
  const animateFromText = getStreamingAnimationStartText(existingView, message, index);

  if (existingView && canReuseMessageElement(existingView, message, showRole, activitiesSignature, copyable)) {
    if ((existingView.message.text || '') !== (message.text || '')) {
      updateMessageBodyElement(
        existingView.element,
        message,
        {
          ...(animateFromText === undefined ? {} : { animateFromText }),
          outputColors: state.outputColors
        }
      );
    }

    existingView.message = message;
    existingView.showRole = showRole;
    existingView.activitiesSignature = activitiesSignature;
    existingView.copyable = copyable;
    return existingView;
  }

  const nextView: RenderedMessageView = {
    element: createMessageElement(
      message,
      showRole,
      index,
      {
        ...(animateFromText === undefined ? {} : { animateFromText }),
        outputColors: state.outputColors
      }
    ),
    message,
    showRole,
    activitiesSignature,
    copyable
  };

  existingView?.element.replaceWith(nextView.element);
  renderedMessageViews[index] = nextView;
  return nextView;
}

function canReuseMessageElement(
  view: RenderedMessageView,
  message: ChatMessage,
  showRole: boolean,
  activitiesSignature: string,
  copyable: boolean
): boolean {
  return view.message.role === message.role
    && Boolean(view.message.error) === Boolean(message.error)
    && (view.message.variant || '') === (message.variant || '')
    && view.showRole === showRole
    && view.activitiesSignature === activitiesSignature
    && view.copyable === copyable;
}

function getStreamingAnimationStartText(
  existingView: RenderedMessageView | undefined,
  message: ChatMessage,
  index: number
): string | undefined {
  if (!existingView || !shouldAnimateStreamingAppend(existingView.message, message, index)) {
    return undefined;
  }

  return getMessageBodyVisibleText(existingView.element);
}

function shouldAnimateStreamingAppend(previous: ChatMessage, next: ChatMessage, index: number): boolean {
  const previousText = previous.text || '';
  const nextText = next.text || '';

  return state.busy
    && index === state.messages.length - 1
    && previous.role === 'assistant'
    && next.role === 'assistant'
    && !previous.error
    && !next.error
    && previous.variant !== 'thinking'
    && next.variant !== 'thinking'
    && nextText.length > previousText.length
    && nextText.startsWith(previousText);
}

function getMessageBodyVisibleText(article: HTMLElement): string {
  for (const child of Array.from(article.children)) {
    if (child instanceof HTMLElement && child.classList.contains('message__body')) {
      return child.textContent ?? '';
    }
  }

  return '';
}

function canCopyAssistantMessage(message: ChatMessage): boolean {
  return message.role === 'assistant'
    && !message.error
    && message.variant !== 'thinking'
    && Boolean(message.text);
}

function getActivitiesSignature(message: ChatMessage): string {
  if (!Array.isArray(message.activities) || message.activities.length === 0) {
    return '';
  }

  return JSON.stringify({ outputColors: state.outputColors, activities: message.activities });
}

function renderSessions() {
  sessionsElement.replaceChildren();
  sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex);

  const header = document.createElement('div');
  header.className = 'sessions__header';
  const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
  if (openSessionListMenuIndex !== undefined && openSessionListMenuIndex >= count) {
    openSessionListMenuIndex = undefined;
  }
  header.textContent = state.sessionsRefreshing
    ? 'Loading sessions...'
    : count === 1
    ? '1 session'
    : count + ' sessions';
  sessionsElement.append(header);

  if (state.sessionsError) {
    const error = document.createElement('div');
    error.className = 'sessions__error';
    error.textContent = state.sessionsError;
    sessionsElement.append(error);
  }

  if (state.sessionsRefreshing && count === 0) {
    sessionsElement.append(createSessionEmptyElement('Loading sessions...'));
    return;
  }

  if (count === 0) {
    sessionsElement.append(createSessionEmptyElement('No sessions found for this workspace.'));
    return;
  }

  for (let index = 0; index < state.sessions.length; index += 1) {
    sessionsElement.append(createSessionItemElement(state.sessions[index], index));
  }

  if (sessionListNameEditPath) {
    requestAnimationFrame(focusSessionListNameInput);
  }
}

function createSessionEmptyElement(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'sessions__empty';
  empty.textContent = text;
  return empty;
}

function createSessionItemElement(session: SessionItem, index: number): HTMLElement {
  const item = document.createElement('div');
  item.id = 'session-' + index;
  item.className = 'sessions__item'
    + (index === sessionListSelectedIndex ? ' sessions__item--active' : '')
    + (session.current ? ' sessions__item--current' : '')
    + (session.liveStatus ? ' sessions__item--' + session.liveStatus : '')
    + (session.unread ? ' sessions__item--unread' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', index === sessionListSelectedIndex ? 'true' : 'false');
  item.setAttribute('data-index', String(index));

  const prefix = document.createElement('span');
  prefix.className = 'sessions__prefix';
  prefix.textContent = (session.liveStatus === 'running' ? '● ' : '') + buildSessionTreePrefix(session);
  item.append(prefix);

  const title = document.createElement('span');
  title.className = 'sessions__title';

  if (sessionListNameEditPath === session.path) {
    title.append(createSessionListNameInput(session));
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

  item.append(createSessionItemMenuElement(session, index));

  return item;
}

function createSessionListNameInput(session: SessionItem): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'sessions__name-input';
  input.type = 'text';
  input.value = sessionListNameEditInitialValue;
  input.placeholder = getSessionDisplayName(session);
  input.setAttribute('aria-label', 'Session name');
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('blur', () => cancelSessionListNameEdit());
  return input;
}

function createSessionItemMenuElement(session: SessionItem, index: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'sessions__menu-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sessions__menu-button';
  button.title = 'Session commands';
  button.setAttribute('aria-label', 'Session commands');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', openSessionListMenuIndex === index ? 'true' : 'false');
  button.disabled = !canRunSessionItemCommand(session);
  button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg>';
  wrap.append(button);

  const menu = document.createElement('span');
  menu.className = 'sessions__menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = openSessionListMenuIndex !== index;

  for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
    menu.append(createSessionItemMenuButton(sessionItemMenuCommands[commandIndex], session, commandIndex));
  }

  wrap.append(menu);
  return wrap;
}

function createSessionItemMenuButton(command: SessionItemCommand, session: SessionItem, commandIndex: number): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pi-toolbar__menu-item sessions__menu-item';
  button.setAttribute('role', 'menuitem');
  button.setAttribute('data-session-command', command);
  button.setAttribute('data-session-command-index', String(commandIndex));
  button.disabled = !canRunSessionItemCommand(session, command);
  button.innerHTML = '<span class="pi-toolbar__menu-label">' + getSessionItemCommandLabel(command) + '</span>' + getSessionItemCommandIcon(command);
  button.addEventListener('pointerenter', () => {
    openSessionListMenuCommandIndex = commandIndex;
    setSessionMenuItemHover(button, true);
  });
  button.addEventListener('pointerleave', () => setSessionMenuItemHover(button, false));
  button.addEventListener('focus', () => {
    openSessionListMenuCommandIndex = commandIndex;
    setSessionMenuItemHover(button, true);
  });
  button.addEventListener('blur', () => setSessionMenuItemHover(button, false));
  return button;
}

function renderTree() {
  sessionsElement.replaceChildren();
  treeListSelectedIndex = clampTreeIndex(treeListSelectedIndex);

  const header = document.createElement('div');
  header.className = 'sessions__header';
  const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
  header.textContent = state.treeRefreshing
    ? 'Loading session tree...'
    : count === 1
    ? '1 tree entry'
    : count + ' tree entries';
  sessionsElement.append(header);

  if (state.treeError) {
    const error = document.createElement('div');
    error.className = 'sessions__error';
    error.textContent = state.treeError;
    sessionsElement.append(error);
  }

  if (state.treeRefreshing && count === 0) {
    sessionsElement.append(createSessionEmptyElement('Loading session tree...'));
    return;
  }

  if (count === 0) {
    sessionsElement.append(createSessionEmptyElement('No persisted tree entries found for this session.'));
    return;
  }

  for (let index = 0; index < state.treeItems.length; index += 1) {
    sessionsElement.append(createTreeItemElement(state.treeItems[index], index));
  }
}

function createTreeItemElement(treeItem: TreeItem, index: number): HTMLElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.id = 'tree-' + index;
  item.className = 'sessions__item'
    + (index === treeListSelectedIndex ? ' sessions__item--active' : '')
    + (treeItem.current ? ' sessions__item--current' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', index === treeListSelectedIndex ? 'true' : 'false');
  item.setAttribute('data-index', String(index));
  item.disabled = state.busy || state.treeRefreshing;

  const title = document.createElement('span');
  title.className = 'sessions__title';
  title.textContent = treeItem.role + ': ' + (treeItem.text || '(empty)');
  item.append(title);

  return item;
}

function getCurrentSessionTitle() {
  const session = getCurrentSession();

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

function getCurrentSession() {
  if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
    return undefined;
  }

  return (state.currentSessionFile ? state.sessions.find((session) => session.path === state.currentSessionFile) : undefined)
    ?? state.sessions.find((session) => session.current);
}

function handleChatEscape(event: KeyboardEvent): boolean {
  const hadSlashMenu = slashMenuOpen;
  const hadModelMenu = modelMenuElement?.hasAttribute('open') ?? false;
  const hadSessionCommandMenu = !sessionMenuElement.hidden;
  const wasSessionNameEditing = sessionNameEditing;

  if (hadSlashMenu) {
    dismissSlashMenu();
  }

  if (hadModelMenu) {
    closeModelMenu();
  }

  if (hadSessionCommandMenu) {
    closeSessionCommandMenu();
  }

  if (wasSessionNameEditing) {
    cancelSessionNameEdit();
  }

  if (hadSlashMenu || hadModelMenu || hadSessionCommandMenu || wasSessionNameEditing) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  if (state.viewMode === 'chat') {
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: 'showSessions' });
    return true;
  }

  return false;
}

function handleSessionListKeydown(event: KeyboardEvent): boolean {
  if (state.viewMode !== 'sessions' && state.viewMode !== 'tree') {
    return false;
  }

  if (openSessionListMenuIndex !== undefined && handleSessionItemMenuKeydown(event)) {
    return true;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: 'hideSessions' });
    focusPromptInput();
    return true;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    closeSessionItemMenus();
    state.viewMode === 'tree' ? moveTreeSelection(1) : moveSessionSelection(1);
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    closeSessionItemMenus();
    state.viewMode === 'tree' ? moveTreeSelection(-1) : moveSessionSelection(-1);
    return true;
  }

  if (state.viewMode === 'sessions' && event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    openSessionItemMenu(sessionListSelectedIndex, { focusMenu: true });
    return true;
  }

  if (state.viewMode === 'sessions' && handleSessionListCommandKey(event)) {
    return true;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    state.viewMode === 'tree' ? selectTreeIndex(treeListSelectedIndex) : selectSessionIndex(sessionListSelectedIndex);
    return true;
  }

  if (state.viewMode === 'sessions' && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    event.stopPropagation();
    deleteSessionIndex(sessionListSelectedIndex);
    return true;
  }

  return false;
}

function enableSessionPointerHover(): void {
  if (sessionPointerHoverEnabled) {
    return;
  }

  sessionPointerHoverEnabled = true;
  sessionsElement.classList.add('sessions--pointer-hover');
}

function disableSessionPointerHover(): void {
  sessionPointerHoverEnabled = false;
  sessionsElement.classList.remove('sessions--pointer-hover');
}

function moveSessionSelection(delta: number): void {
  if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
    return;
  }

  sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex + delta);
  renderSessions();
  document.getElementById('session-' + sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
}

function selectSessionIndex(index: number): void {
  const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

  if (!session?.path) {
    return;
  }

  selectSessionByPath(session.path);
}

function selectSessionByPath(sessionPath: string): void {
  if (!sessionPath) {
    return;
  }

  vscode.postMessage({ type: 'selectSession', sessionPath });
}

function deleteSessionIndex(index: number): void {
  const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

  if (!session?.path || !canDeleteSession(session)) {
    return;
  }

  vscode.postMessage({ type: 'deleteSession', sessionPath: session.path });
}

function toggleSessionItemMenu(index: number): void {
  if (openSessionListMenuIndex === index) {
    closeSessionItemMenus();
    return;
  }

  openSessionItemMenu(index, { focusMenu: true });
}

function openSessionItemMenu(index: number, options: { focusMenu?: boolean } = {}): void {
  if (!Number.isInteger(index) || index < 0 || state.viewMode !== 'sessions') {
    return;
  }

  const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

  if (!session || !canRunSessionItemCommand(session)) {
    return;
  }

  sessionListSelectedIndex = clampSessionIndex(index);
  openSessionListMenuIndex = sessionListSelectedIndex;
  openSessionListMenuCommandIndex = getFirstEnabledSessionItemMenuCommandIndex(session);
  renderSessions();
  document.getElementById('session-' + sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });

  if (options.focusMenu) {
    requestAnimationFrame(() => focusSessionItemMenuCommand(openSessionListMenuIndex, openSessionListMenuCommandIndex));
  }
}

function closeSessionItemMenus(): void {
  if (openSessionListMenuIndex === undefined) {
    return;
  }

  openSessionListMenuIndex = undefined;
  openSessionListMenuCommandIndex = 0;

  for (const menu of sessionsElement.querySelectorAll<HTMLElement>('.sessions__menu')) {
    menu.hidden = true;
  }

  for (const button of sessionsElement.querySelectorAll<HTMLButtonElement>('.sessions__menu-button')) {
    button.setAttribute('aria-expanded', 'false');
  }
}

function handleSessionItemMenuKeydown(event: KeyboardEvent): boolean {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeSessionItemMenus();
    sessionsElement.focus({ preventScroll: true });
    return true;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    moveSessionItemMenuSelection(1);
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    moveSessionItemMenuSelection(-1);
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
    runOpenSessionItemMenuCommand(focusedCommand ?? sessionItemMenuCommands[openSessionListMenuCommandIndex]);
    return true;
  }

  return false;
}

function moveSessionItemMenuSelection(delta: number): void {
  if (openSessionListMenuIndex === undefined) {
    return;
  }

  const session = Array.isArray(state.sessions) ? state.sessions[openSessionListMenuIndex] : undefined;
  const enabledIndexes = getEnabledSessionItemMenuCommandIndexes(session);

  if (enabledIndexes.length === 0) {
    return;
  }

  const currentPosition = enabledIndexes.indexOf(openSessionListMenuCommandIndex);
  const nextPosition = currentPosition >= 0
    ? (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length
    : (delta > 0 ? 0 : enabledIndexes.length - 1);
  openSessionListMenuCommandIndex = enabledIndexes[nextPosition];
  focusSessionItemMenuCommand(openSessionListMenuIndex, openSessionListMenuCommandIndex);
}

function focusSessionItemMenuCommand(sessionIndex: number | undefined, commandIndex: number): void {
  if (sessionIndex === undefined) {
    return;
  }

  const item = document.getElementById('session-' + sessionIndex);
  const commandButton = item?.querySelector<HTMLButtonElement>('.sessions__menu-item[data-session-command-index="' + commandIndex + '"]:not(:disabled)')
    ?? item?.querySelector<HTMLButtonElement>('.sessions__menu-item:not(:disabled)');
  commandButton?.focus({ preventScroll: true });
}

function runOpenSessionItemMenuCommand(command: SessionItemCommand | string | null | undefined): void {
  if (openSessionListMenuIndex === undefined) {
    return;
  }

  runSessionItemMenuCommand(openSessionListMenuIndex, typeof command === 'string' ? command : null);
}

function getFirstEnabledSessionItemMenuCommandIndex(session: SessionItem): number {
  return getEnabledSessionItemMenuCommandIndexes(session)[0] ?? 0;
}

function getEnabledSessionItemMenuCommandIndexes(session: SessionItem | undefined): number[] {
  if (!session) {
    return [];
  }

  const indexes: number[] = [];

  for (let index = 0; index < sessionItemMenuCommands.length; index += 1) {
    if (canRunSessionItemCommand(session, sessionItemMenuCommands[index])) {
      indexes.push(index);
    }
  }

  return indexes;
}

function runSessionItemMenuCommand(index: number, command: string | null): void {
  const parsedCommand = parseSessionItemCommand(command);
  const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

  if (!parsedCommand || !session?.path || !canRunSessionItemCommand(session, parsedCommand)) {
    return;
  }

  closeSessionItemMenus();

  if (parsedCommand === 'delete') {
    vscode.postMessage({ type: 'deleteSession', sessionPath: session.path });
    return;
  }

  if (parsedCommand === 'rename') {
    startSessionListNameEdit(index);
    return;
  }

  vscode.postMessage({ type: 'sessionItemCommand', sessionPath: session.path, command: parsedCommand });
}

function startSessionListNameEdit(index: number): void {
  const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

  if (!session?.path || !canRunSessionItemCommand(session, 'rename')) {
    return;
  }

  sessionListSelectedIndex = clampSessionIndex(index);
  sessionListNameEditPath = session.path;
  sessionListNameEditInitialValue = session.name?.trim() ?? '';
  closeSessionItemMenus();
  renderSessions();
}

function commitSessionListNameEdit(name: string): void {
  const sessionPath = sessionListNameEditPath;

  if (!sessionPath) {
    return;
  }

  const nextName = name.trim();
  const previousName = sessionListNameEditInitialValue.trim();
  stopSessionListNameEdit();
  renderSessions();

  if (nextName === previousName) {
    return;
  }

  vscode.postMessage({ type: 'setSessionItemName', sessionPath, name: nextName });
}

function cancelSessionListNameEdit(options: { focusList?: boolean } = {}): void {
  if (!sessionListNameEditPath) {
    return;
  }

  stopSessionListNameEdit();
  renderSessions();

  if (options.focusList) {
    requestAnimationFrame(() => sessionsElement.focus({ preventScroll: true }));
  }
}

function stopSessionListNameEdit(): void {
  sessionListNameEditPath = undefined;
  sessionListNameEditInitialValue = '';
}

function focusSessionListNameInput(): void {
  const input = sessionsElement.querySelector<HTMLInputElement>('.sessions__name-input');
  input?.focus({ preventScroll: true });
  input?.select();
}

function handleSessionListCommandKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  const command = getSessionListCommandForKey(event.key);

  if (!command) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  runSessionItemMenuCommand(sessionListSelectedIndex, command);
  return true;
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

function canRunSessionItemCommand(session: SessionItem, command?: SessionItemCommand): boolean {
  if (command === 'delete') {
    return canDeleteSession(session);
  }

  return session.liveStatus !== 'running' && !(session.current && state.busy);
}

function canDeleteSession(session: SessionItem): boolean {
  return session.liveStatus !== 'running' && !(session.current && state.busy);
}

function clampSessionIndex(index: number): number {
  const count = Array.isArray(state.sessions) ? state.sessions.length : 0;

  if (count === 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, count - 1));
}

function moveTreeSelection(delta: number): void {
  if (!Array.isArray(state.treeItems) || state.treeItems.length === 0) {
    return;
  }

  treeListSelectedIndex = clampTreeIndex(treeListSelectedIndex + delta);
  renderTree();
  document.getElementById('tree-' + treeListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
}

function selectTreeIndex(index: number): void {
  const treeItem = Array.isArray(state.treeItems) ? state.treeItems[index] : undefined;

  if (!treeItem?.entryId || state.busy || state.treeRefreshing) {
    return;
  }

  vscode.postMessage({ type: 'selectTreeEntry', entryId: treeItem.entryId });
}

function handleChatPageScroll(event: KeyboardEvent): boolean {
  if (state.viewMode !== 'chat' || (event.key !== 'PageUp' && event.key !== 'PageDown')) {
    return false;
  }

  if (event.altKey || event.metaKey || event.shiftKey) {
    return false;
  }

  const target = eventTargetElement(event);

  if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const direction = event.key === 'PageUp' ? -1 : 1;
  const amount = event.ctrlKey ? getTranscriptLineScrollAmount() : Math.max(80, Math.floor(messagesElement.clientHeight * 0.85));
  messagesElement.scrollBy({ top: direction * amount, behavior: 'auto' });
  return true;
}

function getTranscriptLineScrollAmount(): number {
  return parseCssPixelValue(getComputedStyle(messagesContentElement).lineHeight)
    || parseCssPixelValue(getComputedStyle(messagesElement).lineHeight)
    || 20;
}

function clampTreeIndex(index: number): number {
  const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;

  if (count === 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, count - 1));
}

function selectCurrentTreeEntry() {
  const currentIndex = Array.isArray(state.treeItems)
    ? state.treeItems.findIndex((item) => item.current)
    : -1;
  treeListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
}

function selectCurrentSession() {
  const currentIndex = Array.isArray(state.sessions)
    ? state.sessions.findIndex((session) => session.current || session.path === state.currentSessionFile)
    : -1;
  sessionListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
}

function startSessionNameEdit(event?: MouseEvent): void {
  event?.preventDefault();
  event?.stopPropagation();

  if (state.viewMode === 'sessions' || state.viewMode === 'tree' || state.busy) {
    return;
  }

  closeSlashMenu();
  closeModelMenu();
  closeSessionCommandMenu();

  const initialName = getCurrentSessionName();
  sessionNameEditing = true;
  sessionNameEditInitialValue = initialName;
  sessionNameInputElement.value = initialName;
  sessionNameInputElement.placeholder = initialName ? '' : getCurrentSessionTitle();
  syncSessionNameEditor();

  requestAnimationFrame(() => {
    sessionNameInputElement.focus({ preventScroll: true });
    sessionNameInputElement.select();
  });
}

function commitSessionNameEdit(): void {
  if (!sessionNameEditing) {
    return;
  }

  const nextName = sessionNameInputElement.value.trim();
  const previousName = sessionNameEditInitialValue;
  stopSessionNameEdit();

  if (nextName !== previousName) {
    vscode.postMessage({ type: 'setSessionName', name: nextName });
  }

  focusPromptInput();
}

function cancelSessionNameEdit(options: { focusPrompt?: boolean } = {}): void {
  if (!sessionNameEditing) {
    return;
  }

  stopSessionNameEdit();

  if (options.focusPrompt) {
    focusPromptInput();
  }
}

function stopSessionNameEdit(): void {
  sessionNameEditing = false;
  sessionNameEditInitialValue = '';
  sessionNameInputElement.value = '';
  sessionNameInputElement.placeholder = '';
  syncSessionNameEditor();
}

function syncSessionNameEditor(): void {
  toolbarTitleElement.classList.toggle('pi-toolbar__title--editing', sessionNameEditing);
  toolbarTitleTextElement.hidden = sessionNameEditing;
  sessionNameInputElement.hidden = !sessionNameEditing;
  sessionMenuButton.disabled = state.busy || sessionNameEditing;
}

function toggleSessionCommandMenu(event?: MouseEvent): void {
  event?.preventDefault();
  event?.stopPropagation();

  if (state.viewMode === 'sessions' || state.viewMode === 'tree' || state.busy || sessionNameEditing) {
    return;
  }

  closeSlashMenu();
  closeModelMenu();

  const isOpen = !sessionMenuElement.hidden;
  sessionMenuElement.hidden = isOpen;
  sessionMenuButton.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}

function closeSessionCommandMenu(): void {
  sessionMenuElement.hidden = true;
  sessionMenuButton.setAttribute('aria-expanded', 'false');
  for (const item of sessionMenuItemElements) {
    setSessionMenuItemHover(item, false);
  }
}

function syncSessionCommandMenuItems(): void {
  for (const item of sessionMenuItemElements) {
    const command = item.getAttribute('data-session-command');
    item.disabled = state.busy || sessionNameEditing || (command === 'delete' && !getCurrentSessionPath());
  }
}

function setSessionMenuItemHover(item: HTMLButtonElement, hovered: boolean): void {
  item.classList.toggle('pi-toolbar__menu-item--hover', hovered);
}

function runSessionMenuCommand(command: string | null): void {
  if (command === 'rename') {
    closeSessionCommandMenu();
    startSessionNameEdit();
    return;
  }

  if (command === 'fork' || command === 'clone') {
    closeSessionCommandMenu();
    runSessionSlashCommand(command);
    return;
  }

  if (command === 'delete') {
    closeSessionCommandMenu();
    deleteCurrentSession();
    return;
  }

  if (command !== 'reload' && command !== 'compact' && command !== 'export') {
    return;
  }

  closeSessionCommandMenu();
  vscode.postMessage({ type: 'submit', text: '/' + command });
  focusPromptInput();
}

function getCurrentSessionName(): string {
  return (getCurrentSession()?.name ?? state.currentSessionName ?? '').trim();
}

function getCurrentSessionPath(): string {
  return (getCurrentSession()?.path ?? state.currentSessionFile ?? '').trim();
}

function deleteCurrentSession(): void {
  const sessionPath = getCurrentSessionPath();

  if (!sessionPath) {
    return;
  }

  vscode.postMessage({ type: 'deleteSession', sessionPath });
  focusPromptInput();
}

function toggleSessionView() {
  cancelSessionNameEdit();

  if (state.viewMode === 'sessions' || state.viewMode === 'tree') {
    vscode.postMessage({ type: 'hideSessions' });
    focusPromptInput();
    return;
  }

  vscode.postMessage({ type: 'showSessions' });
}

function syncSubmit() {
  const isStopMode = isStopSubmitMode();
  const hasInput = textarea.value.length > 0;
  const hasSendableText = textarea.value.trim().length > 0;
  const label = getSubmitLabel(isStopMode);
  submitButton.disabled = state.busy ? (hasInput && !hasSendableText) : !hasSendableText;
  newSessionButton.disabled = false;
  submitButton.classList.toggle('composer__submit--stop', isStopMode);
  submitButton.setAttribute('aria-label', label);
  submitButton.title = label;
}

function getSubmitLabel(isStopMode: boolean): string {
  if (isStopMode) {
    return 'Stop current response';
  }

  if (state.busy) {
    return streamingBehavior === 'followUp' ? 'Queue follow-up' : 'Steer current run';
  }

  return 'Send message';
}

function isStopSubmitMode() {
  return state.busy && textarea.value.length === 0;
}

function syncBusySubmitMode() {
  if (!busySubmitElement) {
    return;
  }

  const showDiffSummary = state.busy || hasWorkspaceDiffChanges();
  setBusySubmitVisible(showDiffSummary);
  syncDiffSummary();

  const streamingModesElement = streamingBehaviorButtonElements[0]?.parentElement as HTMLElement | undefined;
  if (streamingModesElement) {
    streamingModesElement.hidden = !state.busy;
  }

  if (!state.busy) {
    return;
  }

  for (const button of streamingBehaviorButtonElements) {
    const isActive = button.getAttribute('data-streaming-behavior') === streamingBehavior;
    button.classList.toggle('composer__mode-button--active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function syncDiffSummary(): void {
  const addedLines = normalizeDiffLineCount(state.workspaceDiffStats.addedLines);
  const removedLines = normalizeDiffLineCount(state.workspaceDiffStats.removedLines);

  updateDiffCounter(addedDiffCounter, addedLines);
  updateDiffCounter(removedDiffCounter, removedLines);
  diffSummaryElement.title = `Changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
}

function createDiffCounter(element: HTMLElement, prefix: '+' | '-'): DiffCounterState {
  const value = parseDiffCounterValue(element.textContent, prefix);
  const counter: DiffCounterState = {
    element,
    prefix,
    value,
    target: value,
    startValue: value,
    startTime: 0,
    duration: 0,
    lastText: '',
    animationFrame: undefined
  };

  renderDiffCounter(counter, value);
  return counter;
}

function updateDiffCounter(counter: DiffCounterState, targetValue: number): void {
  const target = normalizeDiffLineCount(targetValue);

  if (target === counter.target) {
    return;
  }

  const now = performance.now();
  const currentValue = counter.animationFrame === undefined
    ? counter.value
    : getInterpolatedDiffCounterValue(counter, now);

  renderDiffCounter(counter, currentValue);
  counter.target = target;
  counter.startValue = currentValue;
  counter.startTime = now;
  counter.duration = getDiffCounterDuration(Math.abs(target - currentValue));

  if (counter.animationFrame === undefined) {
    counter.animationFrame = requestAnimationFrame((time) => tickDiffCounter(counter, time));
  }
}

function tickDiffCounter(counter: DiffCounterState, time: number): void {
  const nextValue = getInterpolatedDiffCounterValue(counter, time);
  renderDiffCounter(counter, nextValue);

  if (nextValue === counter.target) {
    counter.animationFrame = undefined;
    return;
  }

  counter.animationFrame = requestAnimationFrame((nextTime) => tickDiffCounter(counter, nextTime));
}

function getInterpolatedDiffCounterValue(counter: DiffCounterState, time: number): number {
  if (counter.duration <= 0) {
    return counter.target;
  }

  const progress = Math.min(1, Math.max(0, (time - counter.startTime) / counter.duration));
  const eased = 1 - Math.pow(1 - progress, 3);
  const value = counter.startValue + ((counter.target - counter.startValue) * eased);

  if (progress >= 1) {
    return counter.target;
  }

  return Math.round(value);
}

function renderDiffCounter(counter: DiffCounterState, value: number): void {
  const normalizedValue = normalizeDiffLineCount(value);
  const nextText = formatDiffLineCount(normalizedValue);

  if (counter.lastText === nextText && counter.value === normalizedValue) {
    return;
  }

  const previousText = counter.lastText;
  const fragment = document.createDocumentFragment();
  const sign = document.createElement('span');
  sign.className = 'composer__diff-sign';
  sign.textContent = counter.prefix;
  fragment.append(sign);

  for (let index = 0; index < nextText.length; index += 1) {
    const char = nextText[index];
    const previousIndex = previousText.length - nextText.length + index;
    const previousChar = previousIndex >= 0 ? previousText[previousIndex] : undefined;
    const span = document.createElement('span');
    const isDigit = /\d/.test(char);
    span.className = isDigit ? 'composer__diff-digit' : 'composer__diff-separator';
    span.textContent = char;

    if (isDigit && previousChar !== undefined && previousChar !== char) {
      span.classList.add('composer__diff-digit--rolling');
    }

    fragment.append(span);
  }

  counter.element.replaceChildren(fragment);
  counter.element.setAttribute('aria-label', `${counter.prefix}${nextText}`);
  counter.value = normalizedValue;
  counter.lastText = nextText;
}

function getDiffCounterDuration(delta: number): number {
  if (delta <= 0) {
    return 0;
  }

  return Math.min(2400, Math.max(600, 450 + Math.log10(delta + 1) * 650));
}

function parseDiffCounterValue(text: string | null, prefix: '+' | '-'): number {
  const normalized = (text ?? '').trim().replace(prefix, '').replace(/,/g, '');
  const value = Number(normalized);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeDiffLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function hasWorkspaceDiffChanges(): boolean {
  return state.workspaceDiffStats.addedLines > 0 || state.workspaceDiffStats.removedLines > 0;
}

function formatDiffLineCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString();
}

function setBusySubmitVisible(visible: boolean): void {
  if (!busySubmitElement) {
    return;
  }

  if (busySubmitHideTimeout) {
    clearTimeout(busySubmitHideTimeout);
    busySubmitHideTimeout = undefined;
  }

  if (visible) {
    busySubmitElement.hidden = false;
    requestAnimationFrame(() => {
      busySubmitElement.classList.add('composer__busy-submit--visible');
    });
    return;
  }

  busySubmitElement.classList.remove('composer__busy-submit--visible');
  busySubmitHideTimeout = setTimeout(() => {
    if (!state.busy) {
      busySubmitElement.hidden = true;
    }
  }, 160);
}

function syncBusyStatus() {
  busyStatusElement.hidden = !state.busy;

  if (!state.busy) {
    return;
  }

  const nextText = getBusyStatusText();

  if (busyStatusTextElement.textContent !== nextText) {
    busyStatusTextElement.textContent = nextText;
  }
}

function getBusyStatusText() {
  const activity = getLatestRunningActivity();

  if (!activity) {
    return 'Pi is working...';
  }

  const title = typeof activity.title === 'string' && activity.title
    ? activity.title
    : 'Pi is working';
  const summary = typeof activity.summary === 'string' && activity.summary
    ? ': ' + activity.summary
    : '';

  return title + summary;
}

function getLatestRunningActivity(): Activity | undefined {
  for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = state.messages[messageIndex];
    const activities: Activity[] = Array.isArray(message.activities)
      ? message.activities
      : [];

    for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
      if (activities[activityIndex]?.status === 'running') {
        return activities[activityIndex];
      }
    }
  }

  return undefined;
}

function syncPromptContextBadges() {
  if (!contextBadgesElement) {
    return;
  }

  const attachments = Array.isArray(state.promptContext)
    ? state.promptContext.filter(isPromptContextAttachment)
    : [];
  form?.classList.toggle('composer--has-context', attachments.length > 0);
  contextBadgesElement.hidden = attachments.length === 0;
  contextBadgesElement.replaceChildren();

  for (const attachment of attachments) {
    const badge = document.createElement('span');
    badge.className = 'composer__context-badge';
    badge.title = attachment.title || attachment.label;

    const label = document.createElement('span');
    label.className = 'composer__context-label';
    label.textContent = attachment.label;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'composer__context-remove';
    remove.setAttribute('data-context-id', attachment.id);
    remove.setAttribute('aria-label', 'Remove context ' + attachment.label);
    remove.title = 'Remove context';
    remove.textContent = '×';

    badge.append(label, remove);
    contextBadgesElement.append(badge);
  }
}

function isPromptContextAttachment(value: unknown): value is PromptContextAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const attachment = value as Partial<PromptContextAttachment>;
  return typeof attachment.id === 'string'
    && typeof attachment.label === 'string'
    && typeof attachment.title === 'string';
}

function syncModelLabel() {
  contextValueElement.textContent = state.contextUsageLabel;
  contextTooltipElement.textContent = state.contextUsageTitle;
  contextElement.title = state.contextUsageTitle;
  contextElement.className = 'composer__context' + (state.contextUsageLevel ? ' composer__context--' + state.contextUsageLevel : '');
  contextElement.hidden = state.contextUsageLabel.length === 0;

  const label = state.modelLabel || 'Select model';
  modelElement.textContent = label;
  modelElement.className = 'composer__model';
  modelElement.title = state.metadataRefreshing
    ? label + ' (refreshing...)'
    : state.modelOptions.length === 0 && !state.busy
    ? 'Load model settings'
    : label;
  modelElement.disabled = state.busy;
  modelElement.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');
  modelMenuElement?.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');

  syncModelSelect();
  syncThinkingSelect();
}

function syncModelSelect() {
  const selectedValue = modelKey(state.modelProvider, state.modelId);
  const currentValue = modelSelectElement.value;
  const modelOptions = getDisplayModelOptions();
  modelSelectElement.replaceChildren();

  for (const model of modelOptions) {
    if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') {
      continue;
    }

    const option = document.createElement('option');
    option.value = modelKey(model.provider, model.id);
    option.textContent = model.name && model.name !== model.id
      ? model.name + ' (' + model.provider + '/' + model.id + ')'
      : model.provider + '/' + model.id;
    modelSelectElement.append(option);
  }

  modelSelectElement.value = selectedValue || currentValue;
  modelSelectElement.disabled = state.busy || modelOptions.length === 0;
}

function getDisplayModelOptions() {
  if (state.modelOptions.length > 0) {
    return state.modelOptions;
  }

  if (!state.modelProvider || !state.modelId) {
    return [];
  }

  return [{
    provider: state.modelProvider,
    id: state.modelId,
    name: state.modelLabel || state.modelId,
    reasoning: state.modelReasoning
  }];
}

function syncThinkingSelect() {
  thinkingSelectElement.value = state.thinkingLevel || 'medium';
  thinkingSelectElement.disabled = state.busy || !state.modelReasoning;
  thinkingSelectElement.title = state.modelReasoning
    ? 'Thinking mode'
    : 'The selected model does not advertise thinking support.';
}

function toggleModelMenu() {
  if (modelElement.disabled) {
    return;
  }

  if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
    vscode.postMessage({ type: 'refreshMetadata' });
  }

  cancelSessionNameEdit();
  const open = !modelMenuElement.hasAttribute('open');
  modelMenuElement.toggleAttribute('open', open);
  modelElement.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeModelMenu() {
  modelMenuElement?.removeAttribute('open');
  modelElement?.setAttribute('aria-expanded', 'false');
}

function selectModel() {
  const [provider, modelId] = splitModelKey(modelSelectElement.value);

  if (!provider || !modelId || state.busy) {
    return;
  }

  closeModelMenu();
  vscode.postMessage({ type: 'setModel', provider, modelId });
}

function selectThinkingLevel() {
  const level = thinkingSelectElement.value;

  if (!level || state.busy || !state.modelReasoning) {
    return;
  }

  closeModelMenu();
  vscode.postMessage({ type: 'setThinkingLevel', level });
}

function handleSlashMenuKeydown(event: KeyboardEvent): boolean {
  if (!slashMenuOpen) {
    if (event.key === 'Escape') {
      dismissSlashMenu();
    }

    return false;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSlashMenuSelection(1);
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSlashMenuSelection(-1);
    return true;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    acceptActiveSlashCommand();
    return true;
  }

  if (event.key === 'Enter' && !event.shiftKey && slashMenuItems.length > 0) {
    event.preventDefault();
    acceptActiveSlashCommand();
    return true;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    dismissSlashMenu();
    return true;
  }

  return false;
}

function syncSlashMenu() {
  if (!shouldShowSlashMenu()) {
    closeSlashMenu();
    return;
  }

  closeModelMenu();
  cancelSessionNameEdit();
  if (
    state.slashCommands.length === 0
    && !state.slashCommandsRefreshing
    && !slashCommandsRefreshRequested
  ) {
    slashCommandsRefreshRequested = true;
    vscode.postMessage({ type: 'refreshSlashCommands' });
  }

  const query = getSlashCommandQuery();
  if (query === slashMenuDismissedQuery) {
    closeSlashMenu();
    return;
  }

  if (query !== slashMenuQuery) {
    slashMenuQuery = query;
    slashMenuActiveIndex = 0;
    if (slashMenuElement) {
      slashMenuElement.scrollTop = 0;
    }
  }

  slashMenuItems = getFilteredSlashCommands(query);
  slashMenuActiveIndex = Math.min(slashMenuActiveIndex, Math.max(0, slashMenuItems.length - 1));
  renderSlashMenu(query);
  openSlashMenu();
}

function shouldShowSlashMenu() {
  if (!textarea || state.busy || document.activeElement !== textarea) {
    return false;
  }

  const cursor = textarea.selectionStart;

  if (cursor !== textarea.selectionEnd) {
    return false;
  }

  const beforeCursor = textarea.value.slice(0, cursor);
  return beforeCursor.startsWith('/')
    && !Array.from(beforeCursor).some((character) => character.trim().length === 0);
}

function getSlashCommandQuery() {
  return textarea.value.slice(1, textarea.selectionStart).toLowerCase();
}

function getFilteredSlashCommands(query: string): SlashCommand[] {
  const commands = getAllSlashCommands();
  const scored = [];

  for (const command of commands) {
    if (!command || typeof command.name !== 'string') {
      continue;
    }

    const name = command.name.toLowerCase();
    const description = typeof command.description === 'string' ? command.description.toLowerCase() : '';
    const namePrefix = name.startsWith(query);
    const nameMatch = name.includes(query);
    const descriptionMatch = description.includes(query);

    if (!nameMatch && !descriptionMatch) {
      continue;
    }

    scored.push({
      command,
      score: namePrefix ? 0 : nameMatch ? 1 : 2
    });
  }

  return scored
    .sort((left, right) => left.score - right.score || getSlashCommandSourceRank(left.command.source) - getSlashCommandSourceRank(right.command.source) || left.command.name.localeCompare(right.command.name))
    .slice(0, 8)
    .map((item) => item.command);
}

function getAllSlashCommands() {
  const commands = [...localSlashCommands];
  const names = new Set(commands.map((command) => command.name));

  if (Array.isArray(state.slashCommands)) {
    for (const command of state.slashCommands) {
      if (!command || typeof command.name !== 'string' || names.has(command.name)) {
        continue;
      }

      names.add(command.name);
      commands.push(command);
    }
  }

  return commands;
}

function getSlashCommandSourceRank(source: string): number {
  if (source === 'builtin') {
    return 0;
  }

  if (source === 'extension') {
    return 1;
  }

  if (source === 'prompt') {
    return 2;
  }

  if (source === 'skill') {
    return 3;
  }

  if (source === 'unsupported') {
    return 4;
  }

  return 5;
}

function renderSlashMenu(query: string): void {
  slashMenuElement.replaceChildren();

  if (state.slashCommandsRefreshing && slashMenuItems.length === 0) {
    slashMenuElement.append(createSlashMenuEmptyElement('Loading commands...'));
    return;
  }

  if (slashMenuItems.length === 0) {
    slashMenuElement.append(createSlashMenuEmptyElement(query ? 'No matching slash commands' : 'No slash commands available'));
    return;
  }

  for (let index = 0; index < slashMenuItems.length; index += 1) {
    slashMenuElement.append(createSlashMenuItemElement(slashMenuItems[index], index));
  }

  syncSlashMenuActiveDescendant();
}

function createSlashMenuEmptyElement(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'composer__slash-empty';
  empty.textContent = text;
  return empty;
}

function createSlashMenuItemElement(command: SlashCommand, index: number): HTMLElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.id = 'slash-command-' + index;
  item.className = 'composer__slash-item' + (index === slashMenuActiveIndex ? ' composer__slash-item--active' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', index === slashMenuActiveIndex ? 'true' : 'false');
  item.setAttribute('data-index', String(index));

  const label = document.createElement('span');
  label.className = 'composer__slash-label';
  label.textContent = '/' + command.name;
  item.append(label);

  const meta = formatSlashCommandMeta(command);
  if (meta) {
    const source = document.createElement('span');
    source.className = 'composer__slash-source';
    source.textContent = meta;
    item.append(source);
  }

  if (command.description) {
    const description = document.createElement('span');
    description.className = 'composer__slash-description';
    description.textContent = command.description;
    item.append(description);
  }

  return item;
}

function formatSlashCommandMeta(command: SlashCommand): string {
  const source = typeof command.source === 'string' ? command.source : '';
  const location = typeof command.location === 'string' ? command.location : '';

  if (source && location) {
    return source + ' · ' + location;
  }

  return source || location;
}

function openSlashMenu() {
  if (!slashMenuElement) {
    return;
  }

  slashMenuOpen = true;
  slashMenuElement.setAttribute('open', '');
  textarea?.setAttribute('aria-expanded', 'true');
  syncSlashMenuActiveDescendant();
}

function dismissSlashMenu() {
  slashMenuDismissedQuery = textarea ? getSlashCommandQuery() : undefined;
  closeSlashMenu();
}

function closeSlashMenu() {
  slashMenuOpen = false;
  slashCommandsRefreshRequested = false;
  slashMenuItems = [];
  slashMenuActiveIndex = 0;
  slashMenuQuery = '';
  slashMenuElement?.removeAttribute('open');
  textarea?.setAttribute('aria-expanded', 'false');
  textarea?.removeAttribute('aria-activedescendant');
}

function moveSlashMenuSelection(delta: number): void {
  if (slashMenuItems.length === 0) {
    return;
  }

  slashMenuActiveIndex = (slashMenuActiveIndex + delta + slashMenuItems.length) % slashMenuItems.length;
  renderSlashMenu(getSlashCommandQuery());
}

function syncSlashMenuActiveDescendant() {
  if (!slashMenuOpen || slashMenuItems.length === 0) {
    textarea?.removeAttribute('aria-activedescendant');
    return;
  }

  textarea?.setAttribute('aria-activedescendant', 'slash-command-' + slashMenuActiveIndex);
  slashMenuElement?.querySelector('.composer__slash-item--active')?.scrollIntoView({ block: 'nearest' });
}

function acceptActiveSlashCommand() {
  const command = slashMenuItems[slashMenuActiveIndex];

  if (command) {
    acceptSlashCommand(command);
  }
}

function acceptSlashCommand(command: SlashCommand): void {
  const cursor = textarea.selectionStart;
  const after = textarea.value.slice(cursor).trimStart();
  const value = '/' + command.name + ' ' + after;
  const nextCursor = command.name.length + 2;
  textarea.value = value;
  textarea.setSelectionRange(nextCursor, nextCursor);
  closeSlashMenu();
  syncComposer({ preserveBottom: true });
  focusPromptInput();
}

function modelKey(provider: string, id: string): string {
  return provider + '/' + id;
}

function splitModelKey(value: string): [provider: string, id: string] {
  const slashIndex = value.indexOf('/');

  if (slashIndex <= 0) {
    return ['', ''];
  }

  return [value.slice(0, slashIndex), value.slice(slashIndex + 1)];
}

function isMessagesAtBottom() {
  const distanceFromBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight;
  return distanceFromBottom <= messagesBottomThreshold;
}

function scrollMessagesToBottom() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function scheduleMessagesToBottom(): void {
  scrollMessagesToBottomIfChat();
  requestAnimationFrame(() => {
    scrollMessagesToBottomIfChat();
    requestAnimationFrame(scrollMessagesToBottomIfChat);
  });
  setTimeout(scrollMessagesToBottomIfChat, 80);
  setTimeout(scrollMessagesToBottomIfChat, 220);
}

function scrollMessagesToBottomIfChat(): void {
  if (state.viewMode === 'chat') {
    scrollMessagesToBottom();
  }
}

function syncTextareaHeight() {
  textarea.style.height = 'auto';

  const maxHeight = getMaxTextareaHeight();
  const nextHeight = Math.max(minTextareaHeight, Math.min(textarea.scrollHeight, maxHeight));
  textarea.style.height = nextHeight + 'px';
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function getMaxTextareaHeight() {
  const reservedMessagesHeight = getReservedMessagesHeight();
  const composerChromeHeight = getComposerChromeHeight();
  const availableHeight = window.innerHeight - reservedMessagesHeight - composerChromeHeight;
  return Math.max(minTextareaHeight, Math.min(maxTextareaHeight, availableHeight));
}

function getReservedMessagesHeight() {
  return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
}

function getComposerChromeHeight() {
  const composerStyles = getComputedStyle(form);
  const composerMarginHeight = parseCssPixelValue(composerStyles.marginTop) + parseCssPixelValue(composerStyles.marginBottom);
  const composerHeight = form.getBoundingClientRect().height + composerMarginHeight;
  const textareaHeight = textarea.getBoundingClientRect().height;
  return Math.max(0, composerHeight - textareaHeight);
}

function parseCssPixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

function applyComposerTextFromState() {
  if (!textarea || state.composerTextRevision <= appliedComposerTextRevision) {
    return;
  }

  appliedComposerTextRevision = state.composerTextRevision;
  textarea.value = state.composerText;
  closeSlashMenu();
  syncComposer({ preserveBottom: true });
  focusPromptInput();
}

function syncComposer(options: { preserveBottom?: boolean } = {}): void {
  const shouldPreserveBottom = Boolean(options.preserveBottom) && isMessagesAtBottom();
  syncSubmit();
  syncBusySubmitMode();
  syncTextareaHeight();

  if (shouldPreserveBottom) {
    scrollMessagesToBottom();
  }
}

function startNewSession() {
  cancelSessionNameEdit();
  vscode.postMessage({ type: 'newSession' });
  focusPromptInput();
}

function runSessionSlashCommand(command: 'fork' | 'clone' | 'compact' | 'reload' | 'export') {
  if (state.busy) {
    return;
  }

  closeSlashMenu();
  cancelSessionNameEdit();
  vscode.postMessage({ type: 'submit', text: '/' + command });
  focusPromptInput();
}

function isNewSessionShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 'n' || event.shiftKey || event.altKey) {
    return false;
  }

  if (isMac) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function focusPromptInput() {
  requestAnimationFrame(() => {
    textarea.focus({ preventScroll: true });
  });
}

function handleMessageClick(event: MouseEvent): void {
  const target = eventTargetElement(event);
  const copyButton = target?.closest('.message__copy');

  if (copyButton instanceof HTMLElement) {
    const index = Number(copyButton.dataset.copyMessageIndex);
    const text = Number.isInteger(index) ? state.messages[index]?.text : '';

    if (text) {
      event.preventDefault();
      vscode.postMessage({ type: 'copyText', text });
    }

    return;
  }

  const link = target?.closest('.tau-file-link');

  if (!(link instanceof HTMLElement)) {
    return;
  }

  const filePath = link.dataset.filePath;

  if (!filePath) {
    return;
  }

  event.preventDefault();
  vscode.postMessage({
    type: 'openFile',
    path: filePath,
    ...parseDatasetPositiveInteger(link.dataset.line, 'line'),
    ...parseDatasetPositiveInteger(link.dataset.column, 'column')
  });
}

function parseDatasetPositiveInteger(value: string | undefined, key: 'line' | 'column'): { line?: number; column?: number } {
  if (!value) {
    return {};
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? { [key]: numberValue } : {};
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function eventTargetNode(event: Event): Node | null {
  return event.target instanceof Node ? event.target : null;
}

vscode.postMessage({ type: 'ready' });
window.addEventListener('resize', () => {
  render();
  syncComposer({ preserveBottom: true });
});
render();