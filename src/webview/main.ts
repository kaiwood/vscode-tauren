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
  toolbarTimestampElement,
  sessionNameInputElement,
  sessionToggleButton,
  treeToggleButton,
  sessionMenuWrapElement,
  sessionMenuButton,
  sessionMenuElement,
  sessionMenuItemElements,
  chatHelpWrapElement,
  chatHelpButton,
  chatHelpPopoverElement,
  sessionHelpWrapElement,
  sessionHelpButton,
  sessionHelpPopoverElement,
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
busyStatusElement.setAttribute('role', 'status');
busyStatusElement.setAttribute('aria-live', 'polite');
busyStatusElement.setAttribute('aria-atomic', 'true');
const busyStatusSpinnerElement = document.createElement('span');
busyStatusSpinnerElement.className = 'status__spinner';
busyStatusSpinnerElement.setAttribute('aria-hidden', 'true');
const busyStatusTextElement = document.createElement('span');
busyStatusElement.append(busyStatusSpinnerElement, busyStatusTextElement);
messagesContentElement.replaceChildren(...Array.from(messagesElement.childNodes));
messagesElement.append(messagesContentElement, busyStatusElement);

let state: WebviewState = { ...initialWebviewState };
let toastHideTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingRenderFrame: number | undefined;
let pendingReturnToChatAfterRender = false;
let sessionLane: 'sessions' | 'tree' = 'sessions';

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
  toolbarTimestampElement,
  sessionNameInputElement,
  sessionToggleButton,
  treeToggleButton,
  sessionMenuWrapElement,
  sessionMenuButton,
  sessionMenuElement,
  sessionMenuItemElements,
  sessionHelpWrapElement,
  sessionHelpButton,
  sessionHelpPopoverElement,
  focusPromptInput,
  closeSlashMenu: () => composerController.closeSlashMenu(),
  closeModelMenu: () => composerController.closeModelMenu(),
  runSessionSlashCommand: (command) => composerController.runSessionSlashCommand(command)
});

composerController.attachEventListeners();
sessionsController.attachEventListeners();

chatHelpButton.addEventListener('click', toggleChatHelpPopover);
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

  if (event.data?.type === 'openModelPicker') {
    composerController.openModelPicker();
    return;
  }

  if (event.data?.type === 'toggleStreamingBehavior') {
    composerController.toggleStreamingBehavior();
    return;
  }

  if (event.data?.type === 'toast') {
    showToast(
      typeof event.data.message === 'string' ? event.data.message : 'Done.',
      parseToastKind(event.data.kind)
    );
    return;
  }

  if (event.data?.type !== 'state') {
    return;
  }

  const previousViewMode = state.viewMode;
  const previousCurrentSessionFile = state.currentSessionFile;
  const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  const previousTreeCount = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
  const nextState = parseWebviewStateMessage(event.data);
  const hasComposerTextUpdate = nextState.composerTextRevision > 0;
  state = nextState;
  document.body.classList.toggle('tau-animations-disabled', !state.animationsEnabled);
  const wasListView = previousViewMode === 'sessions' || previousViewMode === 'tree';
  const isListView = state.viewMode === 'sessions' || state.viewMode === 'tree';

  syncSessionLaneForStateChange(previousViewMode, state.viewMode);

  if (previousViewMode === 'sessions' && state.viewMode !== 'sessions') {
    sessionsController.rememberSessionListScrollPosition();
  }

  if (!wasListView && isListView) {
    sessionsController.disableSessionPointerHover();
  }

  if (
    state.viewMode === 'sessions'
    && (previousViewMode !== 'sessions'
      || previousCurrentSessionFile !== state.currentSessionFile
      || previousSessionCount === 0)
  ) {
    sessionsController.selectCurrentSessionOrFirstVisible();

    if (previousViewMode !== 'sessions') {
      sessionsController.restoreSessionListScrollAfterNextRender();
    }
  }

  if (state.viewMode === 'tree' && (previousViewMode !== 'tree' || previousTreeCount === 0)) {
    sessionsController.selectCurrentTreeEntry();
  }

  if (sessionsController.isSessionListNameEditingMissing()) {
    sessionsController.stopSessionListNameEdit();
  }

  if (hasComposerTextUpdate) {
    composerController.applyComposerTextFromState();
  }

  scheduleRender({ returnToChat: wasListView && state.viewMode === 'chat' });
});

window.addEventListener('click', (event) => {
  const target = eventTargetNode(event);
  composerController.handleWindowClick(target);
  sessionsController.handleWindowClick(target, eventTargetElement(event));
  handleChatHelpWindowClick(target);
});

window.addEventListener('keydown', (event) => {
  if (sessionsController.handleGlobalKeydown(event)) {
    return;
  }

  if (event.key === 'Escape' && handleChatHelpEscape(event)) {
    return;
  }

  if (event.key === 'Escape' && handleChatEscape(event)) {
    return;
  }

  if (messagesController.handleChatPageScroll(event)) {
    return;
  }
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

function showToast(message: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
  if (toastHideTimeout) {
    clearTimeout(toastHideTimeout);
  }

  toastElement.className = 'pi-toast pi-toast--' + kind;
  toastElement.replaceChildren(createToastIcon(kind), document.createTextNode(message));
  toastElement.hidden = false;
  toastElement.classList.add('pi-toast--visible');
  toastHideTimeout = setTimeout(() => {
    toastElement.classList.remove('pi-toast--visible');
    toastElement.hidden = true;
    toastHideTimeout = undefined;
  }, 2500);
}

function parseToastKind(value: unknown): 'success' | 'warning' | 'error' {
  return value === 'warning' || value === 'error' ? value : 'success';
}

function createToastIcon(kind: 'success' | 'warning' | 'error'): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'pi-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = kind === 'warning' ? '⚠' : kind === 'error' ? '✕' : '✓';
  return icon;
}

function scheduleRender(options: { returnToChat?: boolean } = {}): void {
  pendingReturnToChatAfterRender ||= Boolean(options.returnToChat);

  if (pendingRenderFrame !== undefined) {
    return;
  }

  pendingRenderFrame = requestAnimationFrame(() => {
    pendingRenderFrame = undefined;
    const shouldHandleReturnToChat = pendingReturnToChatAfterRender;
    pendingReturnToChatAfterRender = false;

    render();

    if (shouldHandleReturnToChat && state.viewMode === 'chat') {
      messagesController.scheduleMessagesToBottom();
      focusPromptInput();
    }
  });
}

function syncSessionLaneForStateChange(
  previousViewMode: WebviewState['viewMode'],
  nextViewMode: WebviewState['viewMode']
): void {
  const nextLane = nextViewMode === 'sessions' || nextViewMode === 'tree'
    ? nextViewMode
    : previousViewMode === 'sessions' || previousViewMode === 'tree'
    ? previousViewMode
    : sessionLane;

  if (nextLane === sessionLane) {
    syncViewLaneClass();
    return;
  }

  const enteringFromChat = previousViewMode === 'chat' && (nextViewMode === 'sessions' || nextViewMode === 'tree');
  sessionLane = nextLane;

  if (enteringFromChat) {
    viewElement.classList.add('pi-view--lane-jump');
    syncViewLaneClass();
    void viewElement.offsetWidth;
    viewElement.classList.remove('pi-view--lane-jump');
    return;
  }

  syncViewLaneClass();
}

function syncViewLaneClass(): void {
  viewElement.classList.toggle('pi-view--lane-sessions', sessionLane === 'sessions');
  viewElement.classList.toggle('pi-view--lane-tree', sessionLane === 'tree');
}

function render(): void {
  const isListView = state.viewMode === 'sessions' || state.viewMode === 'tree';
  const shouldStickToBottom = !isListView && messagesController.isMessagesAtBottom();

  viewElement.classList.toggle('pi-view--list', isListView);
  viewElement.classList.toggle('pi-view--sessions', state.viewMode === 'sessions');
  viewElement.classList.toggle('pi-view--tree', state.viewMode === 'tree');
  viewElement.classList.toggle('pi-view--chat', !isListView);
  syncViewLaneClass();
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
  syncChatHelpForRender(isListView);

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

function syncChatHelpForRender(isListView: boolean): void {
  chatHelpWrapElement.hidden = isListView;

  if (isListView) {
    closeChatHelpPopover();
  }
}

function toggleChatHelpPopover(event?: MouseEvent): void {
  event?.preventDefault();
  event?.stopPropagation();

  if (state.viewMode !== 'chat') {
    return;
  }

  if (hasChatHelpPopoverOpen()) {
    closeChatHelpPopover();
    return;
  }

  composerController.closeSlashMenu();
  composerController.closeModelMenu();
  sessionsController.closeSessionCommandMenu();
  chatHelpPopoverElement.hidden = false;
  chatHelpButton.setAttribute('aria-expanded', 'true');
}

function closeChatHelpPopover(options: { focusButton?: boolean } = {}): void {
  if (chatHelpPopoverElement.hidden) {
    return;
  }

  chatHelpPopoverElement.hidden = true;
  chatHelpButton.setAttribute('aria-expanded', 'false');

  if (options.focusButton && !chatHelpWrapElement.hidden) {
    chatHelpButton.focus({ preventScroll: true });
  }
}

function handleChatHelpWindowClick(target: Node | null): void {
  if (!target || !chatHelpWrapElement.contains(target)) {
    closeChatHelpPopover();
  }
}

function handleChatHelpEscape(event: KeyboardEvent): boolean {
  if (!hasChatHelpPopoverOpen()) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  closeChatHelpPopover({ focusButton: true });
  return true;
}

function hasChatHelpPopoverOpen(): boolean {
  return !chatHelpPopoverElement.hidden;
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

  if (composerController.handlePromptEscape()) {
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

let webviewFocusState = false;

function postFocusChanged(focused: boolean): void {
  if (webviewFocusState === focused) {
    return;
  }

  webviewFocusState = focused;
  vscode.postMessage({ type: 'focusChanged', focused });
}

document.addEventListener('focusin', () => postFocusChanged(true));
window.addEventListener('focus', handleWindowFocus);
window.addEventListener('blur', () => postFocusChanged(false));
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.hasFocus()) {
      postFocusChanged(false);
    }
  }, 0);
});

function handleWindowFocus(): void {
  postFocusChanged(true);
  focusPromptInputIfNothingFocused();
}

function focusPromptInputIfNothingFocused(): void {
  requestAnimationFrame(() => {
    const activeElement = document.activeElement;

    if (activeElement === document.body || activeElement === document.documentElement) {
      focusPromptInput();
    }
  });
}

vscode.postMessage({ type: 'ready' });
postFocusChanged(document.hasFocus());
render();
