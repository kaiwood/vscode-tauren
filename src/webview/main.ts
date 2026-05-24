import { configureCodeHighlighting, handleCodeHighlightMessage, watchCodeHighlightThemeChanges } from './codeHighlighting';
import { configureMarkdownImageRendering, handleMarkdownImageMessage } from './messages/markdown';
import { ComposerController } from './composer/composer';
import { CustomUiController } from './customUI/customUi';
import { getWebviewDom } from './dom';
import { MessageListController } from './messages/messageList';
import { SessionViewController } from './sessions/sessionView';
import { SettingsPaneController } from './settings/settingsPane';
import { initialWebviewState, parseWebviewStateMessage } from './state';
import type { WebviewState } from './types';

const vscode = acquireVsCodeApi();
configureCodeHighlighting((message) => vscode.postMessage(message));
configureMarkdownImageRendering((message) => vscode.postMessage(message));
watchCodeHighlightThemeChanges();

const {
  viewElement,
  toolbarTitleElement,
  toolbarTitleTextElement,
  toolbarTimestampElement,
  sessionNameInputElement,
  sessionToggleButton,
  treeToggleButton,
  helpOverlayElement,
  helpCloseButton,
  settingsElement,
  settingsBodyElement,
  settingsBackButton,
  toastElement,
  messagesElement,
  sessionsElement,
  sessionTreeElement,
  customUiElement,
  customUiOutputElement,
  customUiCloseButton,
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
let hasReceivedHostState = false;
let faceTransitionSuppressionFrame: number | undefined;
const renderInstrumentationEnabled = document.body.dataset.tauDevRenderInstrumentation === 'true';

let sessionsController: SessionViewController;
let settingsController: SettingsPaneController;

const customUiController = new CustomUiController({
  vscode,
  customUiElement,
  customUiOutputElement,
  customUiCloseButton,
  form,
  onClose: handleCustomUiClose
});

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

settingsController = new SettingsPaneController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  settingsElement,
  settingsBodyElement,
  settingsBackButton,
  focusPromptInput
});

sessionsController = new SessionViewController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  sessionsElement,
  sessionTreeElement,
  toolbarTitleElement,
  toolbarTitleTextElement,
  toolbarTimestampElement,
  sessionNameInputElement,
  sessionToggleButton,
  treeToggleButton,
  focusPromptInput,
  closeSlashMenu: () => composerController.closeSlashMenu(),
  closeModelMenu: () => composerController.closeModelMenu(),
  openHelpOverlay
});

composerController.attachEventListeners();
sessionsController.attachEventListeners();
settingsController.attachEventListeners();
customUiController.attachEventListeners();

helpCloseButton.addEventListener('click', () => closeHelpOverlay());
newSessionButton.addEventListener('click', startNewSession);
diffSummaryElement.addEventListener('click', showCurrentChanges);
messagesElement.addEventListener('click', (event) => messagesController.handleMessageClick(event));
messagesElement.addEventListener('scroll', () => messagesController.handleMessagesScroll());

window.addEventListener('message', (event) => {
  if (customUiController.handleHostMessage(event.data)) {
    return;
  }

  if (handleCodeHighlightMessage(event.data)) {
    messagesController.scheduleMessagesToBottom();
    return;
  }

  if (handleMarkdownImageMessage(event.data)) {
    messagesController.scheduleMessagesToBottom();
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

  if (event.data?.type === 'toggleHelpOverlay') {
    toggleHelpOverlay();
    return;
  }

  if (event.data?.type === 'startSessionNameEdit') {
    sessionsController.startCurrentSessionNameEdit();
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

  const previousLane = state.lane;
  const previousChatFace = state.chatFace;
  const previousCurrentSessionFile = state.currentSessionFile;
  const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  const previousTreeCount = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
  const isInitialHostState = !hasReceivedHostState;
  hasReceivedHostState = true;
  const nextState = parseWebviewStateMessage(event.data, state);
  const hasComposerTextUpdate = nextState.composerTextRevision > 0;
  state = nextState;

  if (isInitialHostState) {
    suppressFaceTransitionForNextRender();
  }
  document.body.classList.toggle('tau-animations-disabled', !state.animationsEnabled);
  applyCustomUiTheme(state.customUiTheme);
  const wasSessionLane = previousLane === 'sessions' || previousLane === 'tree';
  const isSessionLane = state.lane === 'sessions' || state.lane === 'tree';

  if (previousLane === 'sessions' && state.lane !== 'sessions') {
    sessionsController.rememberSessionListScrollPosition();
  }

  if (!wasSessionLane && isSessionLane) {
    messagesController.rememberChatScrollPosition();
    sessionsController.disableSessionPointerHover();
  }

  if (
    state.lane === 'sessions'
    && (previousLane !== 'sessions'
      || previousCurrentSessionFile !== state.currentSessionFile
      || previousSessionCount === 0)
  ) {
    sessionsController.selectCurrentSessionOrFirstVisible();

    if (previousLane !== 'sessions') {
      sessionsController.restoreSessionListScrollAfterNextRender();
    }
  }

  if (state.lane === 'tree' && (previousLane !== 'tree' || previousTreeCount === 0)) {
    sessionsController.selectCurrentTreeEntry();
  }

  if (sessionsController.isSessionListNameEditingMissing()) {
    sessionsController.stopSessionListNameEdit();
  }

  if (hasComposerTextUpdate) {
    composerController.applyComposerTextFromState();
  }

  scheduleRender({ returnToChatMain: wasSessionLane && state.lane === 'chat' && state.chatFace !== 'settings' });

  if (previousChatFace === 'settings' && state.chatFace === 'main' && state.lane === 'chat') {
    requestAnimationFrame(() => focusPromptInput());
  }
});

window.addEventListener('click', (event) => {
  const target = eventTargetNode(event);
  composerController.handleWindowClick(target);
  sessionsController.handleWindowClick(target, eventTargetElement(event));
  handleHelpWindowClick(target);
});

window.addEventListener('keydown', (event) => {
  if (customUiController.handleGlobalKeydown(event)) {
    return;
  }

  if (settingsController.handleGlobalKeydown(event)) {
    return;
  }

  if (sessionsController.handleGlobalKeydown(event)) {
    return;
  }

  if (event.key === 'Escape' && handleHelpEscape(event)) {
    return;
  }

  if (event.key === 'Escape' && handleChatEscape(event)) {
    return;
  }

  if (messagesController.handleChatPageScroll(event)) {
    return;
  }
}, true);

window.addEventListener('keyup', (event) => {
  customUiController.handleGlobalKeyup(event);
}, true);

window.addEventListener('resize', () => {
  renderWithInstrumentation();
  composerController.syncComposer({ preserveBottom: true });
  customUiController.handleResize();
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

  toastElement.className = 'tau-toast tau-toast--' + kind;
  toastElement.replaceChildren(createToastIcon(kind), document.createTextNode(message));
  toastElement.hidden = false;
  toastElement.classList.add('tau-toast--visible');
  toastHideTimeout = setTimeout(() => {
    toastElement.classList.remove('tau-toast--visible');
    toastElement.hidden = true;
    toastHideTimeout = undefined;
  }, 2500);
}

function parseToastKind(value: unknown): 'success' | 'warning' | 'error' {
  return value === 'warning' || value === 'error' ? value : 'success';
}

function applyCustomUiTheme(theme: WebviewState['customUiTheme']): void {
  for (const name of ['default', 'modern', 'crt', 'amber', 'matrix']) {
    document.body.classList.toggle(`tau-custom-ui-theme-${name}`, name === theme);
  }
}

function createToastIcon(kind: 'success' | 'warning' | 'error'): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'tau-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = kind === 'warning' ? '⚠' : kind === 'error' ? '✕' : '✓';
  return icon;
}

function scheduleRender(options: { returnToChatMain?: boolean } = {}): void {
  pendingReturnToChatAfterRender ||= Boolean(options.returnToChatMain);

  if (pendingRenderFrame !== undefined) {
    return;
  }

  pendingRenderFrame = requestAnimationFrame(() => {
    pendingRenderFrame = undefined;
    const shouldHandleReturnToChat = pendingReturnToChatAfterRender;
    pendingReturnToChatAfterRender = false;

    renderWithInstrumentation();

    if (shouldHandleReturnToChat && state.lane === 'chat') {
      messagesController.restoreChatScrollAfterReturn();
      focusPromptInput();
    }
  });
}

function suppressFaceTransitionForNextRender(): void {
  viewElement.classList.add('tau-view--suppress-face-transition');

  if (faceTransitionSuppressionFrame !== undefined) {
    cancelAnimationFrame(faceTransitionSuppressionFrame);
  }

  faceTransitionSuppressionFrame = requestAnimationFrame(() => {
    faceTransitionSuppressionFrame = requestAnimationFrame(() => {
      faceTransitionSuppressionFrame = undefined;
      viewElement.classList.remove('tau-view--suppress-face-transition');
    });
  });
}

function renderWithInstrumentation(): void {
  if (!renderInstrumentationEnabled) {
    render();
    return;
  }

  const started = performance.now();
  render();
  const duration = performance.now() - started;

  if (duration > 8) {
    console.debug(`[Tau] render ${duration.toFixed(1)}ms`, {
      messages: state.messages.length,
      sessions: state.sessions.length,
      treeItems: state.treeItems.length,
      lane: state.lane
    });
  }
}

function render(): void {
  const isSessionLane = state.lane === 'sessions' || state.lane === 'tree';
  const isSettingsFaceVisible = !isSessionLane && state.chatFace === 'settings';
  const shouldStickToBottom = !isSessionLane && !isSettingsFaceVisible && messagesController.shouldFollowOutput();
  viewElement.classList.toggle('tau-view--session-lane', isSessionLane);
  viewElement.classList.toggle('tau-view--lane-sessions', state.lane === 'sessions');
  viewElement.classList.toggle('tau-view--lane-tree', state.lane === 'tree');
  viewElement.classList.toggle('tau-view--lane-chat', !isSessionLane);
  viewElement.classList.toggle('tau-view--chat-face-settings', isSettingsFaceVisible);
  messagesElement.hidden = false;
  sessionsElement.hidden = false;
  sessionTreeElement.hidden = false;
  messagesElement.setAttribute('aria-hidden', isSessionLane || isSettingsFaceVisible ? 'true' : 'false');
  sessionsElement.setAttribute('aria-hidden', state.lane === 'sessions' ? 'false' : 'true');
  sessionTreeElement.setAttribute('aria-hidden', state.lane === 'tree' ? 'false' : 'true');
  messagesElement.inert = isSessionLane || isSettingsFaceVisible;
  sessionsElement.inert = state.lane !== 'sessions';
  sessionTreeElement.inert = state.lane !== 'tree';
  sessionsElement.tabIndex = state.lane === 'sessions' ? 0 : -1;
  sessionTreeElement.tabIndex = state.lane === 'tree' ? 0 : -1;
  form.classList.toggle('composer--list-hidden', isSessionLane);
  form.setAttribute('aria-hidden', isSessionLane || isSettingsFaceVisible ? 'true' : 'false');
  form.inert = isSessionLane || isSettingsFaceVisible;

  sessionsController.syncForRender(isSessionLane);
  settingsController.syncForRender(isSessionLane);
  customUiController.syncForRender(isSessionLane || isSettingsFaceVisible);

  if (isSettingsFaceVisible) {
    busyStatusElement.hidden = true;
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    sessionsController.cancelSessionNameEdit();
    return;
  }

  if (isSessionLane) {
    busyStatusElement.hidden = true;
    state.lane === 'tree' ? sessionsController.renderTree() : sessionsController.renderSessions();
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    sessionsController.cancelSessionNameEdit();

    if (!sessionsController.isSessionListNameEditing() && !sessionsController.isSessionSearchFocused()) {
      const activeSessionPane = state.lane === 'tree' ? sessionTreeElement : sessionsElement;
      requestAnimationFrame(() => activeSessionPane.focus({ preventScroll: true }));
    }

    return;
  }

  messagesController.renderMessageList();

  messagesController.syncBusyStatus();
  composerController.syncModelLabel();
  composerController.syncPromptContextBadges();
  if (!customUiController.isActive()) {
    composerController.syncComposer();
  }
  composerController.syncSlashMenu();
  if (shouldStickToBottom) {
    messagesController.scheduleMessagesToBottom();
  }
}

function toggleHelpOverlay(): void {
  if (hasHelpOverlayOpen()) {
    closeHelpOverlay();
    return;
  }

  openHelpOverlay();
}

function openHelpOverlay(): void {
  composerController.closeSlashMenu();
  composerController.closeModelMenu();
  sessionsController.closeSessionCommandMenu();
  sessionsController.closeSessionItemMenus();
  helpOverlayElement.hidden = false;
  requestAnimationFrame(() => helpOverlayElement.focus({ preventScroll: true }));
}

function closeHelpOverlay(): void {
  helpOverlayElement.hidden = true;
}

function handleHelpWindowClick(target: Node | null): void {
  if (hasHelpOverlayOpen() && (!target || !helpOverlayElement.contains(target))) {
    closeHelpOverlay();
  }
}

function handleHelpEscape(event: KeyboardEvent): boolean {
  if (!hasHelpOverlayOpen()) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  closeHelpOverlay();
  return true;
}

function hasHelpOverlayOpen(): boolean {
  return !helpOverlayElement.hidden;
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

  if (state.lane === 'chat') {
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: 'showLane', lane: 'sessions' });
    return true;
  }

  return false;
}

function startNewSession(): void {
  sessionsController.cancelSessionNameEdit();
  vscode.postMessage({ type: 'newSession' });
  focusPromptInput();
}

function handleCustomUiClose(): void {
  if (state.lane !== 'chat') {
    return;
  }

  requestAnimationFrame(() => {
    if (state.lane === 'chat' && !customUiController.isActive()) {
      textarea.focus({ preventScroll: true });
    }
  });
}

function focusPromptInput(): void {
  requestAnimationFrame(() => {
    if (customUiController.focusInput()) {
      return;
    }

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
renderWithInstrumentation();
