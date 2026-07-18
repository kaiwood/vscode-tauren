import { getChatLaneLayout } from './chatLaneLayout';
import { configureCodeHighlighting, handleCodeHighlightMessage, watchCodeHighlightThemeChanges } from './codeHighlighting';
import { prepareCustomUiLines, terminalDataForKeyboardEvent } from './customUI/customUi';
import { roundDevicePixelMetric } from './metrics';
import { createExtensionImageElement, normalizeExtensionRenderBlocks } from './extensionRenderBlocks';
import { getAnsiFullWidgetBackground, getAnsiLineBackground, isAnsiBlockImageLine, renderAnsiBlockImageLineInto, renderAnsiSpinnersInto, renderAnsiTextInto } from './messages/ansi';
import { configureMarkdownImageRendering, handleMarkdownImageMessage } from './messages/markdown';
import { ComposerController } from './composer/composer';
import { CustomUiController } from './customUI/customUi';
import { ExtensionEditorDialogController } from './extensionEditorDialog';
import { ExtensionPromptController } from './extensionPrompt';
import { eventTargetElement, getWebviewDom, parseCssPixelValue } from './dom';
import { MessageListController } from './messages/messageList';
import { TranscriptSearchController } from './messages/transcriptSearch';
import { SessionViewController } from './sessions/sessionView';
import { SettingsPaneController } from './settings/settingsPane';
import {
  applyProvisionalExtensionUiSnapshot,
  applyStartupResourcesCache,
  createOptimisticNewSessionState,
  createProvisionalExtensionUiSnapshot,
  createStartupResourcesCache,
  hasPendingProvisionalExtensionUi,
  initialWebviewState,
  parseWebviewStateMessage,
  type ProvisionalExtensionUiSnapshot
} from './state';
import type { VoiceState } from '../voice/types';
import type { WebviewPerfEventName, WebviewScrollCommand } from '../webviewProtocol/types';
import {
  createKwardQuestionUiState,
  getKwardQuestionAnswerForIndex,
  getKwardQuestionAnswerMessage,
  getKwardQuestionAriaLabel,
  getKwardQuestionCustomAnswerForIndex,
  getKwardQuestionCustomChoiceIndex,
  getKwardQuestionLastStepIndex,
  getKwardQuestionNextVerticalFocusTarget,
  getKwardQuestionNextProgressFocusIndex,
  getKwardQuestionRenderSignature,
  getKwardQuestionRequestKey,
  getKwardQuestionSelectedAnswerForIndex,
  getKwardQuestionTitle,
  isKwardQuestionSummaryStep,
  type KwardQuestionUiState
} from './kwardQuestion';
import type { WebviewState } from './types';
import { isRecord } from '../shared/typeGuards';

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
  extensionEditorElement,
  extensionEditorTitleElement,
  extensionEditorInputElement,
  extensionEditorSaveButton,
  extensionEditorCancelButton,
  extensionEditorCloseButton,
  widgetBusySlotElement,
  extensionWidgetsAboveElement,
  extensionWidgetsBelowElement,
  form,
  textarea,
  composerStatusElement,
  composerStatusTextElement,
  slashMenuElement,
  contextBadgesElement,
  busySubmitElement,
  diffSummaryElement,
  diffAddedElement,
  diffRemovedElement,
  streamingBehaviorButtonElements,
  attachButton,
  voiceButton,
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
const extensionPromptElement = document.createElement('article');
extensionPromptElement.className = 'extension-prompt';
extensionPromptElement.hidden = true;
extensionPromptElement.inert = true;
extensionPromptElement.setAttribute('aria-live', 'polite');
extensionPromptElement.setAttribute('aria-label', 'Pi extension prompt');
messagesElement.append(messagesContentElement, busyStatusElement, extensionPromptElement);

const kwardQuestionElement = document.createElement('section');
kwardQuestionElement.className = 'kward-question';
kwardQuestionElement.hidden = true;
kwardQuestionElement.setAttribute('aria-label', 'Kward question');
kwardQuestionElement.setAttribute('aria-live', 'polite');
kwardQuestionElement.setAttribute('role', 'dialog');
kwardQuestionElement.tabIndex = 0;
extensionWidgetsAboveElement.after(kwardQuestionElement);

let state: WebviewState = { ...initialWebviewState };
let kwardQuestionUiState: KwardQuestionUiState | undefined;
let renderedKwardQuestionSignature = '';
let toolsExpanded = false;
let toastHideTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingRenderFrame: number | undefined;
let pendingReturnToChatAfterRender = false;
let hasReceivedHostState = false;
let faceTransitionSuppressionFrame: number | undefined;
const renderInstrumentationEnabled = document.body.dataset.taurenDevRenderInstrumentation === 'true';
const perfEventThresholdMs = 8;
const busySubmitHomeMarker = document.createComment('busy-submit-home');
busySubmitElement.after(busySubmitHomeMarker);
const widgetDimensionSignatures = new Map<string, string>();
let footerDimensionSignature = '';
let provisionalExtensionUiSnapshot: ProvisionalExtensionUiSnapshot | undefined;
let startupResourcesCache = createStartupResourcesCache();

let sessionsController: SessionViewController;
let settingsController: SettingsPaneController;
let transcriptSearchController: TranscriptSearchController;
const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform);

const customUiController = new CustomUiController({
  vscode,
  customUiElement,
  customUiOutputElement,
  customUiCloseButton,
  form,
  onClose: handleCustomUiClose
});

const extensionEditorDialogController = new ExtensionEditorDialogController({
  vscode,
  element: extensionEditorElement,
  titleElement: extensionEditorTitleElement,
  inputElement: extensionEditorInputElement,
  saveButton: extensionEditorSaveButton,
  cancelButton: extensionEditorCancelButton,
  closeButton: extensionEditorCloseButton
});

const messagesController = new MessageListController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  messagesElement,
  messagesContentElement,
  busyStatusElement,
  busyStatusTextElement
});

const extensionPromptController = new ExtensionPromptController({
  vscode,
  element: extensionPromptElement,
  onShow: () => messagesController.scheduleMessagesToBottom()
});

transcriptSearchController = new TranscriptSearchController({
  messagesElement,
  messagesContentElement,
  isChatMainVisible: () => state.lane === 'chat' && state.chatFace !== 'settings',
  onClose: focusPromptInput
});

const composerController = new ComposerController({
  getState: () => state,
  postMessage: (message) => vscode.postMessage(message),
  refreshMetadata,
  form,
  textarea,
  submitButton,
  attachButton,
  voiceButton,
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
  scrollMessagesToBottom: () => messagesController.scrollMessagesToBottom(),
  measurePerfEvent
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
extensionEditorDialogController.attachEventListeners();

helpCloseButton.addEventListener('click', () => closeHelpOverlay());
newSessionButton.addEventListener('click', startNewSession);
diffSummaryElement.addEventListener('click', showCurrentChanges);
messagesElement.addEventListener('click', (event) => messagesController.handleMessageClick(event));
messagesElement.addEventListener('scroll', () => messagesController.handleMessagesScroll());

window.addEventListener('message', (event) => {
  if (extensionPromptController.handleHostMessage(event.data)) {
    return;
  }

  if (extensionEditorDialogController.handleHostMessage(event.data)) {
    return;
  }

  if (composerController.handleHostMessage(event.data)) {
    return;
  }

  if (customUiController.handleHostMessage(event.data)) {
    return;
  }

  if (handleCodeHighlightMessage(event.data)) {
    transcriptSearchController.refreshHighlights({ preserveCurrent: true });
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

  if (event.data?.type === 'openTranscriptSearch') {
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    transcriptSearchController.openSearch();
    return;
  }

  if (event.data?.type === 'openModelPicker') {
    composerController.openModelPicker();
    return;
  }

  if (event.data?.type === 'scrollPane') {
    const command = parsePaneScrollCommand(event.data);

    if (command) {
      scrollActivePane(command);
    }
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

  if (event.data?.type === 'optimisticNewSession') {
    applyOptimisticNewSessionTransition();
    focusPromptInput();
    return;
  }

  if (event.data?.type === 'voiceState') {
    const voice = parseHostVoiceState(event.data.voice);
    if (voice) {
      state = { ...state, voice };
      scheduleRender();
    }
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
  const parsedState = parseWebviewStateMessage(event.data, state);
  const startupResourcesResult = applyStartupResourcesCache(parsedState, startupResourcesCache);
  startupResourcesCache = startupResourcesResult.cache;
  const provisionalResult = applyProvisionalExtensionUiSnapshot(startupResourcesResult.state, provisionalExtensionUiSnapshot);
  const nextState = provisionalResult.state;
  provisionalExtensionUiSnapshot = provisionalResult.snapshot;
  clearProvisionalExtensionUiIfSettled();
  const hasComposerTextUpdate = nextState.composerTextRevision > 0;
  const hasComposerPasteUpdate = nextState.composerPaste !== undefined;
  state = nextState;

  if (isInitialHostState) {
    suppressFaceTransitionForNextRender();
  }
  document.body.classList.toggle('tauren-animations-disabled', !state.animationsEnabled);
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

  if (hasComposerPasteUpdate && state.composerPaste) {
    composerController.pasteToEditor(state.composerPaste.text);
  }

  scheduleRender({
    returnToChatMain: wasSessionLane && state.lane === 'chat' && state.chatFace !== 'settings'
  });

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
  if (extensionPromptController.handleGlobalKeydown(event)) {
    return;
  }

  if (extensionEditorDialogController.handleGlobalKeydown(event)) {
    return;
  }

  if (customUiController.handleGlobalKeydown(event)) {
    return;
  }

  if (settingsController.handleGlobalKeydown(event)) {
    return;
  }

  if (handleKwardQuestionGlobalKeydown(event)) {
    return;
  }

  if (transcriptSearchController.handleGlobalKeydown(event)) {
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
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

  if (handlePaneScrollShortcut(event)) {
    return;
  }

  if (handleToolDetailShortcut(event)) {
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

  toastElement.className = 'tauren-toast tauren-toast--' + kind;
  toastElement.replaceChildren(createToastIcon(kind), document.createTextNode(message));
  toastElement.hidden = false;
  toastElement.classList.add('tauren-toast--visible');
  toastHideTimeout = setTimeout(() => {
    toastElement.classList.remove('tauren-toast--visible');
    toastElement.hidden = true;
    toastHideTimeout = undefined;
  }, 2500);
}

function parseToastKind(value: unknown): 'success' | 'warning' | 'error' {
  return value === 'warning' || value === 'error' ? value : 'success';
}

function applyCustomUiTheme(theme: WebviewState['customUiTheme']): void {
  for (const name of ['default', 'modern', 'crt', 'amber', 'matrix']) {
    document.body.classList.toggle(`tauren-custom-ui-theme-${name}`, name === theme);
  }
}

function createToastIcon(kind: 'success' | 'warning' | 'error'): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'tauren-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = kind === 'warning' ? '⚠' : kind === 'error' ? '✕' : '✓';
  return icon;
}

function parseHostVoiceState(value: unknown): VoiceState | undefined {
  const parsedState = parseWebviewStateMessage({ type: 'state', voice: value }, state);
  return parsedState.voice;
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
  viewElement.classList.add('tauren-view--suppress-face-transition');

  if (faceTransitionSuppressionFrame !== undefined) {
    cancelAnimationFrame(faceTransitionSuppressionFrame);
  }

  faceTransitionSuppressionFrame = requestAnimationFrame(() => {
    faceTransitionSuppressionFrame = requestAnimationFrame(() => {
      faceTransitionSuppressionFrame = undefined;
      viewElement.classList.remove('tauren-view--suppress-face-transition');
    });
  });
}

function renderWithInstrumentation(): void {
  if (!renderInstrumentationEnabled) {
    measurePerfEvent('chat.render', render);
    return;
  }

  const started = performance.now();
  measurePerfEvent('chat.render', render);
  const duration = performance.now() - started;

  if (duration > 8) {
    console.debug(`[Tauren] render ${duration.toFixed(1)}ms`, {
      messages: state.messages.length,
      sessions: state.sessions.length,
      treeItems: state.treeItems.length,
      lane: state.lane
    });
  }
}

function measurePerfEvent(name: WebviewPerfEventName, measure: () => void): void {
  if (!state.perfEnabled) {
    measure();
    return;
  }

  const started = performance.now();
  measure();
  const durationMs = performance.now() - started;

  if (durationMs < perfEventThresholdMs) {
    return;
  }

  vscode.postMessage({
    type: 'perfEvent',
    event: {
      name,
      durationMs,
      lane: state.lane,
      messageCount: state.messages.length,
      sessionCount: state.sessions.length,
      renderedMessageCount: messagesController.getRenderedMessageCount(),
      collapsedMessageCount: messagesController.getCollapsedMessageCount(),
      currentSessionFile: state.currentSessionFile,
      sessionLoading: state.sessionLoading,
      textareaLength: textarea.value.length,
      promptContextCount: state.promptContext.length,
      promptImageCount: state.promptImages.length,
      busy: state.busy
    }
  });
}

function measureRenderBoundary(name: 'transcript.render' | 'sessionList.render' | 'tree.render', renderBoundary: () => void): void {
  if (!state.perfEnabled) {
    renderBoundary();
    return;
  }

  const started = performance.now();
  renderBoundary();
  const durationMs = performance.now() - started;

  if (durationMs < perfEventThresholdMs) {
    return;
  }

  vscode.postMessage({
    type: 'perfEvent',
    event: {
      name,
      durationMs,
      lane: state.lane,
      messageCount: state.messages.length,
      sessionCount: state.sessions.length,
      visibleItemCount: name === 'sessionList.render' ? sessionsController.getVisibleSessionCount() : undefined,
      renderedMessageCount: messagesController.getRenderedMessageCount(),
      collapsedMessageCount: messagesController.getCollapsedMessageCount(),
      currentSessionFile: state.currentSessionFile,
      sessionLoading: state.sessionLoading
    }
  });
}

function render(): void {
  const chatLaneLayout = getChatLaneLayout(state);
  const { isSessionLane, isSettingsFaceVisible } = chatLaneLayout;
  const shouldStickToBottom = !isSessionLane && !isSettingsFaceVisible && messagesController.shouldFollowOutput();
  viewElement.classList.toggle('tauren-view--session-lane', isSessionLane);
  viewElement.classList.toggle('tauren-view--lane-sessions', state.lane === 'sessions');
  viewElement.classList.toggle('tauren-view--lane-tree', state.lane === 'tree');
  viewElement.classList.toggle('tauren-view--lane-chat', !isSessionLane);
  viewElement.classList.toggle('tauren-view--chat-face-settings', isSettingsFaceVisible);
  viewElement.classList.toggle('tauren-view--extension-ui-font', !isExtensionMonospaceFontEnabled());
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
  syncExtensionWidgets(chatLaneLayout.hiddenBySurface, { reserveLayout: chatLaneLayout.reserveBottomSurfaceLayout });
  syncExtensionStatus(chatLaneLayout.hiddenBySurface, { reserveLayout: chatLaneLayout.reserveBottomSurfaceLayout });
  syncKwardQuestion(chatLaneLayout.hiddenBySurface || isSessionLane || isSettingsFaceVisible);

  sessionsController.syncForRender(isSessionLane);
  settingsController.syncForRender(isSessionLane);
  customUiController.syncForRender(isSessionLane || isSettingsFaceVisible);

  transcriptSearchController.syncForRender();

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
    state.lane === 'tree'
      ? measureRenderBoundary('tree.render', () => sessionsController.renderTree())
      : measureRenderBoundary('sessionList.render', () => sessionsController.renderSessions());
    composerController.closeSlashMenu();
    composerController.closeModelMenu();
    sessionsController.closeSessionCommandMenu();
    sessionsController.cancelSessionNameEdit();

    if (!sessionsController.isSessionListNameEditing() && !sessionsController.isSessionSearchFocused()) {
      const activeSessionPane = state.lane === 'tree' ? sessionTreeElement : sessionsElement;
      requestAnimationFrame(() => {
        if (document.hasFocus()) {
          activeSessionPane.focus({ preventScroll: true });
        }
      });
    }

    return;
  }

  measureRenderBoundary('transcript.render', () => messagesController.renderMessageList());
  transcriptSearchController.syncForRender();

  messagesController.syncBusyStatus();
  composerController.syncModelLabel();
  composerController.syncPromptContextBadges();
  if (!customUiController.isActive() && !extensionEditorDialogController.isActive()) {
    composerController.syncComposer();
  }
  composerController.syncSlashMenu();
  if (shouldStickToBottom) {
    messagesController.scheduleMessagesToBottom();
  }
}

function handleKwardQuestionGlobalKeydown(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || kwardQuestionElement.hidden || !state.kwardQuestion) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  cancelKwardQuestion(state.kwardQuestion);
  return true;
}

function syncKwardQuestion(hiddenBySurface: boolean): void {
  const request = hiddenBySurface ? undefined : state.kwardQuestion;

  if (!request) {
    kwardQuestionElement.hidden = true;
    kwardQuestionElement.replaceChildren();
    renderedKwardQuestionSignature = '';
    return;
  }

  const uiState = ensureKwardQuestionUiState(request);
  renderKwardQuestion(request, uiState);
}

function ensureKwardQuestionUiState(request: NonNullable<WebviewState['kwardQuestion']>): KwardQuestionUiState {
  const requestKey = getKwardQuestionRequestKey(request);
  const existing = kwardQuestionUiState;

  if (existing?.requestKey === requestKey && existing.selectedAnswers.length === request.questions.length && existing.customAnswers.length === request.questions.length) {
    existing.stepIndex = Math.min(existing.stepIndex, getKwardQuestionLastStepIndex(request));
    return existing;
  }

  const nextState = createKwardQuestionUiState(request);
  kwardQuestionUiState = nextState;
  renderedKwardQuestionSignature = '';
  return nextState;
}

function renderKwardQuestion(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState): void {
  const signature = getKwardQuestionRenderSignature(request, uiState);

  if (!kwardQuestionElement.hidden && renderedKwardQuestionSignature === signature) {
    return;
  }

  const previousActiveName = kwardQuestionElement.contains(document.activeElement) ? (document.activeElement as HTMLElement | null)?.getAttribute('name') ?? undefined : undefined;
  const focusQuestion = kwardQuestionElement.hidden || kwardQuestionElement.contains(document.activeElement);
  renderedKwardQuestionSignature = signature;
  kwardQuestionElement.hidden = false;
  kwardQuestionElement.setAttribute('aria-label', getKwardQuestionAriaLabel(request, uiState));
  const header = document.createElement('div');
  header.className = 'kward-question__header';
  const title = document.createElement('div');
  title.className = 'kward-question__title';
  title.textContent = getKwardQuestionTitle(request, uiState);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'kward-question__close';
  close.setAttribute('aria-label', 'Close Kward question');
  close.textContent = '×';
  close.addEventListener('click', () => cancelKwardQuestion(request));
  header.append(title, close);
  const formElement = document.createElement('form');
  formElement.className = 'kward-question__form';
  formElement.addEventListener('keydown', (event) => handleKwardQuestionKeydown(event, request, uiState));

  if (isKwardQuestionSummaryStep(request, uiState)) {
    formElement.append(createKwardQuestionSummary(request, uiState), createKwardQuestionActions(request, true));
  } else {
    const questionIndex = uiState.stepIndex;
    formElement.append(createKwardQuestionStep(request, uiState, questionIndex), createKwardQuestionActions(request, false));
  }

  formElement.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!isKwardQuestionSummaryStep(request, uiState)) {
      uiState.stepIndex = Math.min(uiState.stepIndex + 1, getKwardQuestionLastStepIndex(request));
      rerenderKwardQuestion(request, { focus: true });
      return;
    }

    const submit = formElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
    }

    vscode.postMessage(getKwardQuestionAnswerMessage(request, uiState));
  });

  kwardQuestionElement.replaceChildren(header, formElement);

  if (focusQuestion) {
    focusKwardQuestionStep(isKwardQuestionSummaryStep(request, uiState) ? undefined : previousActiveName);
  }
}

function createKwardQuestionStep(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState, questionIndex: number): HTMLElement {
  const body = document.createElement('div');
  body.className = 'kward-question__body';
  const question = request.questions[questionIndex];

  if (!question) {
    return body;
  }

  const progress = createKwardQuestionProgress(request, uiState);
  body.append(progress);

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'kward-question__fieldset';
  const legend = document.createElement('legend');
  legend.className = 'kward-question__legend';
  legend.textContent = `${question.header}: ${question.question}`;
  fieldset.append(legend);

  question.options.forEach((option, optionIndex) => {
    const label = document.createElement('label');
    label.className = 'kward-question__option';
    label.dataset.kwardQuestionChoiceIndex = String(optionIndex);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `kward-question-${questionIndex}`;
    input.value = option.label;
    input.checked = uiState.selectedAnswers[questionIndex] === option.label && !getKwardQuestionCustomAnswerForIndex(uiState, questionIndex);
    input.addEventListener('change', () => {
      uiState.selectedAnswers[questionIndex] = option.label;
      uiState.customAnswers[questionIndex] = '';
      const customInput = fieldset.querySelector<HTMLInputElement>(`input[name="kward-question-custom-${questionIndex}"]`);
      if (customInput) {
        customInput.value = '';
      }
    });
    const text = document.createElement('span');
    text.className = 'kward-question__option-text';
    const optionLabel = document.createElement('span');
    optionLabel.className = 'kward-question__option-label';
    optionLabel.textContent = option.label;
    const description = document.createElement('span');
    description.className = 'kward-question__option-description';
    description.textContent = option.description;
    text.append(optionLabel, description);
    label.append(input, text);
    fieldset.append(label);
  });

  const customLabel = document.createElement('label');
  customLabel.className = 'kward-question__custom-wrap';
  customLabel.dataset.kwardQuestionChoiceIndex = String(getKwardQuestionCustomChoiceIndex(request, questionIndex));
  const customRadio = document.createElement('input');
  customRadio.type = 'radio';
  customRadio.name = `kward-question-${questionIndex}`;
  customRadio.value = '__custom__';
  customRadio.checked = Boolean(getKwardQuestionCustomAnswerForIndex(uiState, questionIndex));
  const customText = document.createElement('span');
  customText.className = 'kward-question__option-label';
  customText.textContent = 'Custom input';
  const custom = document.createElement('input');
  custom.className = 'kward-question__custom';
  custom.type = 'text';
  custom.name = `kward-question-custom-${questionIndex}`;
  custom.placeholder = 'Custom answer…';
  custom.value = uiState.customAnswers[questionIndex] ?? '';
  customRadio.addEventListener('change', () => {
    if (customRadio.checked) {
      requestAnimationFrame(() => custom.focus({ preventScroll: true }));
    }
  });
  custom.addEventListener('focus', () => {
    customRadio.checked = true;
  });
  custom.addEventListener('input', () => {
    uiState.customAnswers[questionIndex] = custom.value;
    customRadio.checked = true;
  });
  customLabel.append(customRadio, customText, custom);
  fieldset.append(customLabel);
  body.append(fieldset, createKwardQuestionHint());
  return body;
}

function createKwardQuestionSummary(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState): HTMLElement {
  const body = document.createElement('div');
  body.className = 'kward-question__body';
  body.append(createKwardQuestionProgress(request, uiState));
  const heading = document.createElement('div');
  heading.className = 'kward-question__legend';
  heading.textContent = 'Review your answers';
  const list = document.createElement('ol');
  list.className = 'kward-question__summary';

  request.questions.forEach((question, index) => {
    const item = document.createElement('li');
    item.className = 'kward-question__summary-item';
    const label = document.createElement('span');
    label.className = 'kward-question__summary-question';
    label.textContent = `${question.header}: ${question.question}`;
    const selected = document.createElement('span');
    selected.className = 'kward-question__summary-answer';
    selected.textContent = `Selected answer: ${getKwardQuestionSelectedAnswerForIndex(request, uiState, index) || 'None'}`;
    item.append(label, selected);

    const customAnswer = getKwardQuestionCustomAnswerForIndex(uiState, index);
    if (customAnswer) {
      const custom = document.createElement('span');
      custom.className = 'kward-question__summary-custom';
      custom.textContent = `Custom answer: ${customAnswer}`;
      item.append(custom);
    }

    list.append(item);
  });

  body.append(heading, list, createKwardQuestionHint());
  return body;
}

function createKwardQuestionProgress(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState): HTMLElement {
  const progress = document.createElement('div');
  progress.className = 'kward-question__progress';
  progress.setAttribute('aria-label', 'Question steps');
  const totalSteps = getKwardQuestionLastStepIndex(request) + 1;

  for (let index = 0; index < totalSteps; index += 1) {
    const step = document.createElement('button');
    step.type = 'button';
    step.className = 'kward-question__progress-step';
    step.classList.toggle('kward-question__progress-step--active', index === uiState.stepIndex);
    step.classList.toggle('kward-question__progress-step--answered', index < request.questions.length && Boolean(getKwardQuestionAnswerForIndex(request, uiState, index)));
    step.setAttribute('aria-current', index === uiState.stepIndex ? 'step' : 'false');
    step.dataset.kwardQuestionStepIndex = String(index);
    step.textContent = index === request.questions.length ? 'Review' : String(index + 1);
    step.addEventListener('click', () => openKwardQuestionStep(request, uiState, index, { focusProgress: true }));
    progress.append(step);
  }

  return progress;
}

function createKwardQuestionActions(request: NonNullable<WebviewState['kwardQuestion']>, includeSubmit: boolean): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'kward-question__actions';

  if (includeSubmit) {
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'C3PO-arm';
    submit.textContent = request.questions.length > 1 ? 'Send answers' : 'Send answer';
    actions.append(submit);
  }

  if (request.questions.length > 1 && !includeSubmit) {
    const spacer = document.createElement('span');
    spacer.className = 'kward-question__actions-hint';
    spacer.textContent = 'Press Enter to continue';
    actions.prepend(spacer);
  }

  return actions;
}

function createKwardQuestionHint(): HTMLElement {
  const hint = document.createElement('div');
  hint.className = 'kward-question__hint';
  hint.textContent = 'Press Enter to continue. Tab to move through choices and custom answer. Focus step indicators to use ← and →.';
  return hint;
}

function handleKwardQuestionKeydown(event: KeyboardEvent, request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancelKwardQuestion(request);
    return;
  }

  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !isKwardQuestionSummaryStep(request, uiState)) {
    event.preventDefault();
    event.stopPropagation();
    moveKwardQuestionChoice(request, uiState, event.key === 'ArrowDown' ? 1 : -1, event.target);
    return;
  }

  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && isKwardQuestionProgressStep(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    moveKwardQuestionProgressFocus(request, event.target, event.key === 'ArrowRight' ? 1 : -1);
    return;
  }

  if (event.key === 'Enter' && isKwardQuestionProgressStep(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    openKwardQuestionStep(request, uiState, getKwardQuestionProgressStepIndex(event.target), { focusProgress: true });
    return;
  }

  if (event.key === 'Enter' && !isKwardQuestionCloseButton(event.target)) {
    const submit = kwardQuestionElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (isKwardQuestionSummaryStep(request, uiState) && submit) {
      event.preventDefault();
      event.stopPropagation();
      submit.click();
      return;
    }

    if (!isKwardQuestionSummaryStep(request, uiState)) {
      event.preventDefault();
      event.stopPropagation();
      openKwardQuestionStep(request, uiState, Math.min(uiState.stepIndex + 1, getKwardQuestionLastStepIndex(request)), { focus: true });
      return;
    }
  }
}

function moveKwardQuestionChoice(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState, delta: number, target: EventTarget | null): void {
  const questionIndex = uiState.stepIndex;
  const choiceIndex = getKwardQuestionChoiceIndexFromTarget(target) ?? getKwardQuestionCurrentChoiceIndex(request, uiState, questionIndex);
  const focusTarget = getKwardQuestionNextVerticalFocusTarget(request, questionIndex, choiceIndex, delta);

  if (focusTarget.kind === 'progress') {
    focusKwardQuestionStep(undefined, uiState.stepIndex);
    return;
  }

  focusKwardQuestionChoice(request, uiState, questionIndex, focusTarget.choiceIndex);
}

function getKwardQuestionCurrentChoiceIndex(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState, questionIndex: number): number {
  if (getKwardQuestionCustomAnswerForIndex(uiState, questionIndex)) {
    return getKwardQuestionCustomChoiceIndex(request, questionIndex);
  }

  const selectedIndex = request.questions[questionIndex]?.options.findIndex((option) => option.label === uiState.selectedAnswers[questionIndex]) ?? -1;
  return selectedIndex >= 0 ? selectedIndex : 0;
}

function focusKwardQuestionChoice(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState, questionIndex: number, choiceIndex: number): void {
  const customIndex = getKwardQuestionCustomChoiceIndex(request, questionIndex);
  if (choiceIndex >= customIndex) {
    requestAnimationFrame(() => kwardQuestionElement.querySelector<HTMLInputElement>(`input[name="kward-question-custom-${questionIndex}"]`)?.focus({ preventScroll: true }));
    return;
  }

  const option = request.questions[questionIndex]?.options[choiceIndex];
  if (option) {
    uiState.selectedAnswers[questionIndex] = option.label;
    uiState.customAnswers[questionIndex] = '';
    rerenderKwardQuestion(request, { focusChoiceIndex: choiceIndex });
  }
}

function moveKwardQuestionProgressFocus(request: NonNullable<WebviewState['kwardQuestion']>, target: EventTarget | null, delta: number): void {
  const nextIndex = getKwardQuestionNextProgressFocusIndex(request, getKwardQuestionProgressStepIndex(target), delta);
  focusKwardQuestionStep(undefined, nextIndex);
}

function openKwardQuestionStep(request: NonNullable<WebviewState['kwardQuestion']>, uiState: KwardQuestionUiState, stepIndex: number, options: { focus?: boolean; focusProgress?: boolean } = {}): void {
  uiState.stepIndex = Math.max(0, Math.min(stepIndex, getKwardQuestionLastStepIndex(request)));
  rerenderKwardQuestion(request, { focus: options.focus, focusProgressIndex: options.focusProgress ? uiState.stepIndex : undefined });
}

function rerenderKwardQuestion(request: NonNullable<WebviewState['kwardQuestion']>, options: { focus?: boolean; focusProgressIndex?: number; focusChoiceIndex?: number } = {}): void {
  renderedKwardQuestionSignature = '';
  renderKwardQuestion(request, ensureKwardQuestionUiState(request));

  if (options.focus || options.focusProgressIndex !== undefined || options.focusChoiceIndex !== undefined) {
    focusKwardQuestionStep(undefined, options.focusProgressIndex, options.focusChoiceIndex);
  }
}

function focusKwardQuestionStep(previousActiveName?: string, progressIndex?: number, choiceIndex?: number): void {
  requestAnimationFrame(() => {
    const preferred = previousActiveName
      ? kwardQuestionElement.querySelector<HTMLElement>(`[name="${cssEscape(previousActiveName)}"]`)
      : undefined;
    const progressTarget = progressIndex !== undefined
      ? kwardQuestionElement.querySelectorAll<HTMLElement>('.kward-question__progress-step')[progressIndex]
      : undefined;
    const choiceTarget = choiceIndex !== undefined
      ? kwardQuestionElement.querySelector<HTMLElement>(`[data-kward-question-choice-index="${choiceIndex}"] input`)
      : undefined;
    const focusTarget = preferred
      ?? progressTarget
      ?? choiceTarget
      ?? kwardQuestionElement.querySelector<HTMLElement>('button[type="submit"]')
      ?? kwardQuestionElement.querySelector<HTMLElement>('input[type="radio"]:checked')
      ?? kwardQuestionElement;
    focusTarget.focus({ preventScroll: true });
  });
}

function cancelKwardQuestion(request: NonNullable<WebviewState['kwardQuestion']>): void {
  vscode.postMessage({ type: 'kwardQuestionCancel', sessionId: request.sessionId, questionRequestId: request.questionRequestId });
}

function isKwardQuestionProgressStep(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.classList.contains('kward-question__progress-step');
}

function getKwardQuestionProgressStepIndex(target: EventTarget | null): number {
  if (!(target instanceof HTMLElement)) {
    return 0;
  }

  const stepIndex = Number(target.dataset.kwardQuestionStepIndex);
  return Number.isInteger(stepIndex) ? stepIndex : 0;
}

function getKwardQuestionChoiceIndexFromTarget(target: EventTarget | null): number | undefined {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }

  const choiceElement = target.closest<HTMLElement>('[data-kward-question-choice-index]');
  const choiceIndex = Number(choiceElement?.dataset.kwardQuestionChoiceIndex);
  return Number.isInteger(choiceIndex) ? choiceIndex : undefined;
}

function isKwardQuestionCloseButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.classList.contains('kward-question__close');
}

function syncExtensionWidgets(hiddenBySurface: boolean, options: { reserveLayout?: boolean } = {}): void {
  const reserveLayout = Boolean(options.reserveLayout);
  const collapseLayout = hiddenBySurface && !reserveLayout;
  const aboveWidgets = collapseLayout || !areExtensionAboveWidgetsEnabled()
    ? []
    : state.extensionWidgets.filter((widget) => widget.placement === 'aboveEditor');
  const belowWidgets = collapseLayout || !areExtensionBelowWidgetsEnabled()
    ? []
    : state.extensionWidgets.filter((widget) => widget.placement === 'belowEditor');
  const placeBusySubmitOnTopWidget = (!hiddenBySurface || reserveLayout) && aboveWidgets.length > 0;

  const activeKeys = new Set([...aboveWidgets, ...belowWidgets].map((widget) => widget.key));
  for (const key of widgetDimensionSignatures.keys()) {
    if (!activeKeys.has(key)) {
      widgetDimensionSignatures.delete(key);
    }
  }

  const renderPlaceholderWidgets = provisionalExtensionUiSnapshot?.widgetsPending === true;
  const widgetRenderOptions = { hiddenFromAccessibility: hiddenBySurface, postDimensions: !hiddenBySurface };
  renderExtensionWidgetContainer(extensionWidgetsAboveElement, aboveWidgets, placeBusySubmitOnTopWidget ? busySubmitElement : undefined, renderPlaceholderWidgets, widgetRenderOptions);
  renderExtensionWidgetContainer(extensionWidgetsBelowElement, belowWidgets, undefined, renderPlaceholderWidgets, widgetRenderOptions);
  syncBusySubmitPlacement(placeBusySubmitOnTopWidget);
  extensionWidgetsAboveElement.classList.toggle('extension-widgets--with-busy', placeBusySubmitOnTopWidget);
  viewElement.classList.toggle('tauren-view--has-extension-widgets-above', aboveWidgets.length > 0);
  viewElement.classList.toggle('tauren-view--has-extension-widgets-below', belowWidgets.length > 0);
}

function renderExtensionWidgetContainer(
  container: HTMLElement,
  widgets: WebviewState['extensionWidgets'],
  leadingElement?: HTMLElement,
  placeholderWidgets = false,
  options: { hiddenFromAccessibility?: boolean; postDimensions?: boolean } = {}
): void {
  const hasContent = widgets.length > 0 || Boolean(leadingElement);
  const hiddenFromAccessibility = Boolean(options.hiddenFromAccessibility);
  container.hidden = !hasContent;
  container.inert = hiddenFromAccessibility;
  container.setAttribute('aria-hidden', hasContent && !hiddenFromAccessibility ? 'false' : 'true');

  if (!hasContent) {
    container.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();

  if (leadingElement) {
    fragment.append(leadingElement);
  }

  for (const widget of widgets) {
    const element = document.createElement('article');
    element.className = 'extension-widget';
    element.classList.toggle('extension-widget--placeholder', placeholderWidgets);
    element.dataset.widgetKey = widget.key;
    element.setAttribute('aria-label', `Pi extension widget ${widget.key}`);

    const blocks = normalizeExtensionRenderBlocks(widget.blocks, widget.lines);
    const textLines = blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].lines : [];
    const prepared = prepareCustomUiLines(textLines);
    const backgroundColorsEnabled = areExtensionBackgroundColorsEnabled();
    const widgetBackground = getAnsiFullWidgetBackground(prepared.lines, backgroundColorsEnabled && state.outputColors);

    if (widgetBackground) {
      element.classList.add('extension-widget--ansi-background');
      element.style.backgroundColor = widgetBackground;
      element.style.borderColor = widgetBackground;
    }

    for (const block of blocks) {
      if (block.type === 'image') {
        element.append(createExtensionImageElement(block));
        continue;
      }

      for (const line of prepareCustomUiLines(block.lines).lines) {
        const lineElement = document.createElement('div');
        lineElement.className = 'extension-widget__line';
        const background = backgroundColorsEnabled ? getAnsiLineBackground(line, state.outputColors) : undefined;
        if (background) {
          lineElement.classList.add('extension-widget__line--ansi-background');
          lineElement.style.backgroundColor = background;
        }
        if (isAnsiBlockImageLine(line)) {
          lineElement.classList.add('extension-widget__line--ansi-image');
          if (renderAnsiBlockImageLineInto(lineElement, line, state.outputColors)) {
            element.append(lineElement);
            continue;
          }
        }
        renderAnsiTextInto(lineElement, line, state.outputColors, { suppressBackgrounds: !backgroundColorsEnabled });
        renderAnsiSpinnersInto(lineElement, state.animationsEnabled);
        element.append(lineElement);
      }
    }

    fragment.append(element);
  }

  container.replaceChildren(fragment);

  if (!placeholderWidgets && options.postDimensions !== false) {
    scheduleExtensionWidgetDimensionsPost(container, widgets);
  }
}

function syncBusySubmitPlacement(aboveWidgets: boolean): void {
  widgetBusySlotElement.hidden = true;

  if (aboveWidgets) {
    return;
  }

  if (busySubmitElement.parentElement !== form) {
    busySubmitHomeMarker.parentNode?.insertBefore(busySubmitElement, busySubmitHomeMarker);
  }
}

function scheduleExtensionWidgetDimensionsPost(container: HTMLElement, widgets: WebviewState['extensionWidgets']): void {
  requestAnimationFrame(() => {
    for (const widget of widgets) {
      const element = container.querySelector<HTMLElement>(`.extension-widget[data-widget-key="${cssEscape(widget.key)}"]`);

      if (!element) {
        continue;
      }

      const dimensions = measureExtensionWidgetDimensions(element);
      const signature = `${dimensions.columns}x${dimensions.rows}@${dimensions.cellWidthPx}x${dimensions.cellHeightPx}`;
      const signatureKey = widget.key;

      if (widgetDimensionSignatures.get(signatureKey) === signature) {
        continue;
      }

      widgetDimensionSignatures.set(signatureKey, signature);
      vscode.postMessage({
        type: 'extensionWidgetDimensions',
        key: widget.key,
        columns: dimensions.columns,
        rows: dimensions.rows,
        cellWidthPx: dimensions.cellWidthPx,
        cellHeightPx: dimensions.cellHeightPx
      });
    }
  });
}

function measureExtensionWidgetDimensions(element: HTMLElement): { columns: number; rows: number; cellWidthPx: number; cellHeightPx: number } {
  const style = window.getComputedStyle(element);
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let charWidth = 8;

  if (context) {
    context.font = font;
    charWidth = Math.max(1, context.measureText('M').width);
  }

  const fontSize = Number.parseFloat(style.fontSize) || 12;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.35 || 18;
  const rect = element.getBoundingClientRect();
  const contentWidth = Math.max(0, rect.width
    - (Number.parseFloat(style.paddingLeft) || 0)
    - (Number.parseFloat(style.paddingRight) || 0));
  const contentHeight = Math.max(lineHeight, rect.height
    - (Number.parseFloat(style.paddingTop) || 0)
    - (Number.parseFloat(style.paddingBottom) || 0));
  const columns = Math.max(20, Math.floor(contentWidth / charWidth));
  const rows = Math.max(1, Math.min(80, Math.floor(contentHeight / lineHeight)));

  return {
    columns,
    rows,
    cellWidthPx: roundDevicePixelMetric(charWidth),
    cellHeightPx: roundDevicePixelMetric(lineHeight)
  };
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function areExtensionAboveWidgetsEnabled(): boolean {
  return state.settings.values['tauren.extensions.aboveWidgetsEnabled'] !== false;
}

function areExtensionBelowWidgetsEnabled(): boolean {
  return state.settings.values['tauren.extensions.belowWidgetsEnabled'] !== false;
}

function areExtensionStatusBarEnabled(): boolean {
  return state.settings.values['tauren.extensions.statusBarEnabled'] !== false;
}

function areExtensionBackgroundColorsEnabled(): boolean {
  return state.settings.values['tauren.extensions.backgroundColorsEnabled'] !== false;
}

function isExtensionMonospaceFontEnabled(): boolean {
  return state.settings.values['tauren.extensions.monospaceFontEnabled'] === true;
}

function syncExtensionStatus(hiddenBySurface: boolean, options: { reserveLayout?: boolean } = {}): void {
  const statusEnabled = areExtensionStatusBarEnabled();
  const reserveLayout = Boolean(options.reserveLayout);
  const placeholderFooter = provisionalExtensionUiSnapshot?.footerPending === true;
  const footerLine = statusEnabled ? state.extensionFooter?.line : undefined;
  const text = statusEnabled && !placeholderFooter
    ? footerLine !== undefined
      ? footerLine
      : state.extensionStatus
        .map((entry) => entry.text.trim())
        .filter(Boolean)
        .join('  •  ')
    : '';
  const hasStatusContent = placeholderFooter || footerLine !== undefined || text.length > 0;
  const hasStatusSlot = statusEnabled && hasStatusContent && (!hiddenBySurface || reserveLayout);
  const hasAccessibleText = !hiddenBySurface && text.length > 0 && !placeholderFooter;

  composerStatusTextElement.replaceChildren();
  renderAnsiTextInto(composerStatusTextElement, text, state.outputColors, { suppressBackgrounds: true });
  renderAnsiSpinnersInto(composerStatusTextElement, state.animationsEnabled);
  composerStatusElement.hidden = !hasStatusSlot;
  composerStatusElement.inert = hiddenBySurface;
  composerStatusElement.setAttribute('aria-hidden', hasAccessibleText ? 'false' : 'true');
  viewElement.classList.toggle('tauren-view--has-extension-status', hasStatusSlot);

  if (hasStatusSlot && hasAccessibleText && footerLine !== undefined) {
    scheduleExtensionFooterDimensionsPost();
  } else {
    footerDimensionSignature = '';
  }
}

function scheduleExtensionFooterDimensionsPost(): void {
  requestAnimationFrame(() => {
    if (composerStatusElement.hidden || state.extensionFooter === undefined) {
      footerDimensionSignature = '';
      return;
    }

    const dimensions = measureExtensionWidgetDimensions(composerStatusElement);
    const signature = [dimensions.columns, dimensions.rows, dimensions.cellWidthPx, dimensions.cellHeightPx].join(':');

    if (signature === footerDimensionSignature) {
      return;
    }

    footerDimensionSignature = signature;
    vscode.postMessage({
      type: 'extensionFooterDimensions',
      columns: dimensions.columns,
      rows: dimensions.rows,
      cellWidthPx: dimensions.cellWidthPx,
      cellHeightPx: dimensions.cellHeightPx
    });
  });
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

function parsePaneScrollCommand(value: unknown): WebviewScrollCommand | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const direction = value.direction === 'up' || value.direction === 'down' ? value.direction : undefined;
  const amount = value.amount === 'page' || value.amount === 'line' || value.amount === 'edge' ? value.amount : undefined;

  return direction && amount ? { direction, amount } : undefined;
}

function handlePaneScrollShortcut(event: KeyboardEvent): boolean {
  const command = getPaneScrollCommandForEvent(event);

  if (!command) {
    return false;
  }

  const target = eventTargetElement(event);

  if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
    return false;
  }

  if (target instanceof HTMLTextAreaElement && target !== textarea) {
    return false;
  }

  if (target === textarea && shouldPreserveComposerTextNavigation(event)) {
    return false;
  }

  if (!scrollActivePane(command)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function getPaneScrollCommandForEvent(event: KeyboardEvent): WebviewScrollCommand | undefined {
  if (event.shiftKey) {
    return undefined;
  }

  if (event.key === 'PageUp' || event.key === 'PageDown') {
    const direction = event.key === 'PageUp' ? 'up' : 'down';

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      return { direction, amount: 'page' };
    }

    if (isMacPlatform) {
      return event.metaKey && !event.ctrlKey && !event.altKey ? { direction, amount: 'page' } : undefined;
    }

    return event.altKey && !event.ctrlKey && !event.metaKey ? { direction, amount: 'page' } : undefined;
  }

  if (!isMacPlatform && (event.key === 'Home' || event.key === 'End')) {
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      return { direction: event.key === 'Home' ? 'up' : 'down', amount: 'edge' };
    }
  }

  if (isMacPlatform && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    if (event.metaKey && !event.ctrlKey && !event.altKey) {
      return { direction: event.key === 'ArrowUp' ? 'up' : 'down', amount: 'edge' };
    }
  }

  return undefined;
}

function shouldPreserveComposerTextNavigation(event: KeyboardEvent): boolean {
  return event.key === 'Home' || event.key === 'End' || event.key === 'ArrowUp' || event.key === 'ArrowDown';
}

function scrollActivePane(command: WebviewScrollCommand): boolean {
  const element = getActiveScrollElement();

  if (!element) {
    return false;
  }

  if (command.amount === 'edge') {
    scrollElementToEdge(element, command.direction);
    return true;
  }

  const multiplier = command.direction === 'up' ? -1 : 1;
  const amount = command.amount === 'line'
    ? getLineScrollAmount(element)
    : Math.max(80, Math.floor(element.clientHeight * 0.85));

  element.scrollBy({ top: multiplier * amount, behavior: 'auto' });
  afterScrollElement(element);
  return true;
}

function getActiveScrollElement(): HTMLElement | undefined {
  if (hasHelpOverlayOpen() || customUiController.isActive() || extensionEditorDialogController.isActive()) {
    return undefined;
  }

  if (state.lane === 'sessions') {
    return sessionsElement;
  }

  if (state.lane === 'tree') {
    return sessionTreeElement;
  }

  if (state.chatFace === 'settings') {
    return settingsBodyElement.querySelector<HTMLElement>('.settings-surface__panel') ?? settingsBodyElement;
  }

  return messagesElement;
}

function scrollElementToEdge(element: HTMLElement, direction: WebviewScrollCommand['direction']): void {
  if (element === messagesElement) {
    direction === 'up' ? messagesController.scrollMessagesToTop() : messagesController.scrollMessagesToBottom();
    return;
  }

  element.scrollTop = direction === 'up' ? 0 : element.scrollHeight;
  afterScrollElement(element);
}

function afterScrollElement(element: HTMLElement): void {
  if (element === messagesElement) {
    messagesController.handleMessagesScroll();
  }
}

function getLineScrollAmount(element: HTMLElement): number {
  return parseCssPixelValue(getComputedStyle(element).lineHeight) || 20;
}


function handleToolDetailShortcut(event: KeyboardEvent): boolean {
  if (state.lane !== 'chat' || state.chatFace === 'settings' || event.key.toLowerCase() !== 'o') {
    return false;
  }

  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const expanded = messagesController.toggleToolActivityDetail();

  if (expanded !== undefined) {
    toolsExpanded = expanded;
  }

  const data = terminalDataForKeyboardEvent(event);

  if (data) {
    vscode.postMessage({ type: 'extensionTerminalInput', data });
  }

  if (expanded !== undefined) {
    vscode.postMessage({ type: 'setToolsExpanded', expanded: toolsExpanded });
  }

  return true;
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
  applyOptimisticNewSessionTransition();
  vscode.postMessage({ type: 'newSession' });
  focusPromptInput();
}

function applyOptimisticNewSessionTransition(): void {
  const wasSessionLane = state.lane === 'sessions' || state.lane === 'tree';
  provisionalExtensionUiSnapshot = createProvisionalExtensionUiSnapshot(state);
  state = createOptimisticNewSessionState(state);
  suppressFaceTransitionForNextRender();
  scheduleRender({ returnToChatMain: wasSessionLane });
}

function clearProvisionalExtensionUiIfSettled(): void {
  if (hasPendingProvisionalExtensionUi(provisionalExtensionUiSnapshot)) {
    return;
  }

  provisionalExtensionUiSnapshot = undefined;
}

function handleCustomUiClose(): void {
  if (state.lane !== 'chat') {
    return;
  }

  requestAnimationFrame(() => {
    if (state.lane === 'chat' && !customUiController.isActive() && !extensionPromptController.isActive()) {
      textarea.focus({ preventScroll: true });
    }
  });
}

function focusPromptInput(): void {
  requestAnimationFrame(() => {
    if (extensionPromptController.isActive()) {
      return;
    }

    if (customUiController.focusInput()) {
      return;
    }

    textarea.focus({ preventScroll: true });
  });
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
