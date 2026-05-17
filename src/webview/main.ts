import { configureCodeHighlighting, handleCodeHighlightMessage, watchCodeHighlightThemeChanges } from './codeHighlighting';
import { ComposerController } from './composer/composer';
import { getWebviewDom } from './dom';
import { MessageListController } from './messages/messageList';
import { SessionViewController } from './sessions/sessionView';
import { initialWebviewState, parseWebviewStateMessage } from './state';
import type { WebviewState } from './types';

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
let toastHideTimeout: ReturnType<typeof setTimeout> | undefined;

let sessionsController: SessionViewController;

const messagesController = new MessageListController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  messagesElement,
  messagesContentElement,
  busyStatusElement,
  busyStatusTextElement
});

const composerController = new ComposerController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  refreshMetadata,
  form,
  textarea,
  submitButton,
  newSessionButton,
  busySubmitElement,
  diffSummaryElement,
  diffAddedElement,
  diffRemovedElement,
  streamingBehaviorButtonElements,
  slashMenuElement,
  contextBadgesElement,
  contextElement,
  contextValueElement,
  contextTooltipElement,
  modelElement,
  modelMenuElement,
  modelSelectElement,
  thinkingSelectElement,
  focusPromptInput,
  cancelSessionNameEdit: () => sessionsController.cancelSessionNameEdit(),
  closeSessionCommandMenu: () => sessionsController.closeSessionCommandMenu(),
  isMessagesAtBottom: () => messagesController.isMessagesAtBottom(),
  scrollMessagesToBottom: () => messagesController.scrollMessagesToBottom()
});

sessionsController = new SessionViewController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  sessionsElement,
  toolbarTitleElement,
  toolbarTitleTextElement,
  sessionNameInputElement,
  sessionToggleButton,
  sessionMenuWrapElement,
  sessionMenuButton,
  sessionMenuElement,
  sessionMenuItemElements,
  focusPromptInput,
  closeSlashMenu: () => composerController.closeSlashMenu(),
  closeModelMenu: () => composerController.closeModelMenu(),
  runSessionSlashCommand: (command) => composerController.runSessionSlashCommand(command)
});

composerController.attachEventListeners();
sessionsController.attachEventListeners();

newSessionButton.addEventListener('click', startNewSession);
diffSummaryElement.addEventListener('click', showCurrentChanges);
messagesElement.addEventListener('click', (event) => messagesController.handleMessageClick(event));

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
    sessionsController.disableSessionPointerHover();
  }

  if (
    state.viewMode === 'sessions'
    && (previousViewMode !== 'sessions'
      || previousCurrentSessionFile !== state.currentSessionFile
      || previousSessionCount === 0)
  ) {
    sessionsController.selectFirstVisibleSession();
  }

  if (state.viewMode === 'tree' && (previousViewMode !== 'tree' || previousTreeCount === 0)) {
    sessionsController.selectCurrentTreeEntry();
  }

  if (sessionsController.isSessionListNameEditingMissing()) {
    sessionsController.stopSessionListNameEdit();
  }

  render();
  composerController.applyComposerTextFromState();

  if (wasListView && state.viewMode === 'chat') {
    messagesController.scheduleMessagesToBottom();
    focusPromptInput();
  }
});

window.addEventListener('click', (event) => {
  const target = eventTargetNode(event);
  composerController.handleWindowClick(target);
  sessionsController.handleWindowClick(target, eventTargetElement(event));
});

window.addEventListener('keydown', (event) => {
  if (sessionsController.handleGlobalKeydown(event)) {
    return;
  }

  if (event.key === 'Escape' && handleChatEscape(event)) {
    return;
  }

  if (messagesController.handleChatPageScroll(event)) {
    return;
  }

  if (!isNewSessionShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  startNewSession();
}, true);

window.addEventListener('resize', () => {
  render();
  composerController.syncComposer({ preserveBottom: true });
});

function showCurrentChanges(): void {
  vscode.postMessage({ type: 'showCurrentChanges' });
  focusPromptInput();
}

function refreshMetadata(): void {
  vscode.postMessage({ type: 'refreshMetadata' });
}

function showToast(message: string): void {
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

function render(): void {
  const isListView = state.viewMode === 'sessions' || state.viewMode === 'tree';
  const shouldStickToBottom = !isListView && messagesController.isMessagesAtBottom();

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

  sessionsController.syncForRender(isListView);

  if (isListView) {
    busyStatusElement.hidden = true;
    state.viewMode === 'tree' ? sessionsController.renderTree() : sessionsController.renderSessions();
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    sessionsController.cancelSessionNameEdit();

    if (!sessionsController.isSessionListNameEditing() && !sessionsController.isSessionSearchFocused()) {
      requestAnimationFrame(() => sessionsElement.focus({ preventScroll: true }));
    }

    return;
  }

  messagesController.renderMessageList();

  messagesController.syncBusyStatus();
  composerController.syncModelLabel();
  composerController.syncPromptContextBadges();
  composerController.syncComposer();
  composerController.syncSlashMenu();
  if (shouldStickToBottom) {
    messagesController.scrollMessagesToBottom();
  }
}

function handleChatEscape(event: KeyboardEvent): boolean {
  const hadSlashMenu = composerController.hasSlashMenuOpen();
  const hadModelMenu = composerController.hasModelMenuOpen();
  const sessionUiState = sessionsController.hasSlashOrSessionUiOpen();

  if (hadSlashMenu) {
    composerController.dismissSlashMenu();
  }

  if (hadModelMenu) {
    composerController.closeModelMenu();
  }

  if (sessionUiState.sessionCommandMenu) {
    sessionsController.closeSessionCommandMenu();
  }

  if (sessionUiState.sessionNameEditing) {
    sessionsController.cancelSessionNameEdit();
  }

  if (hadSlashMenu || hadModelMenu || sessionUiState.sessionCommandMenu || sessionUiState.sessionNameEditing) {
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

function startNewSession(): void {
  sessionsController.cancelSessionNameEdit();
  vscode.postMessage({ type: 'newSession' });
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

function focusPromptInput(): void {
  requestAnimationFrame(() => {
    textarea.focus({ preventScroll: true });
  });
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function eventTargetNode(event: Event): Node | null {
  return event.target instanceof Node ? event.target : null;
}

vscode.postMessage({ type: 'ready' });
render();
