import { configureCodeHighlighting, handleCodeHighlightMessage, watchCodeHighlightThemeChanges } from './codeHighlighting';
import { prepareCustomUiLines } from './customUI/customUi';
import { roundDevicePixelMetric } from './metrics';
import { createExtensionImageElement, normalizeExtensionRenderBlocks } from './extensionRenderBlocks';
import { getAnsiFullWidgetBackground, getAnsiLineBackground, isAnsiBlockImageLine, renderAnsiBlockImageLineInto, renderAnsiTextInto } from './messages/ansi';
import { configureMarkdownImageRendering, handleMarkdownImageMessage } from './messages/markdown';
import { ComposerController } from './composer/composer';
import { CustomUiController } from './customUI/customUi';
import { ExtensionEditorDialogController } from './extensionEditorDialog';
import { getWebviewDom } from './dom';
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
let pendingRefreshSessionsAfterRender = false;
let pendingSessionRefreshFrame: number | undefined;
let sessionRefreshRequested = false;
let hasReceivedHostState = false;
let faceTransitionSuppressionFrame: number | undefined;
const renderInstrumentationEnabled = document.body.dataset.taurenDevRenderInstrumentation === 'true';
const busySubmitHomeMarker = document.createComment('busy-submit-home');
busySubmitElement.after(busySubmitHomeMarker);
const widgetDimensionSignatures = new Map<string, string>();
let footerDimensionSignature = '';
let provisionalExtensionUiSnapshot: ProvisionalExtensionUiSnapshot | undefined;
let startupResourcesCache = createStartupResourcesCache();

let sessionsController: SessionViewController;
let settingsController: SettingsPaneController;
let transcriptSearchController: TranscriptSearchController;

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
extensionEditorDialogController.attachEventListeners();

helpCloseButton.addEventListener('click', () => closeHelpOverlay());
newSessionButton.addEventListener('click', startNewSession);
diffSummaryElement.addEventListener('click', showCurrentChanges);
messagesElement.addEventListener('click', (event) => messagesController.handleMessageClick(event));
messagesElement.addEventListener('scroll', () => messagesController.handleMessagesScroll());

window.addEventListener('message', (event) => {
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

  if (event.data?.type === 'scrollTranscript') {
    if (isChatTranscriptScrollable()) {
      if (event.data.position === 'top') {
        messagesController.scrollMessagesToTop();
      } else if (event.data.position === 'bottom') {
        messagesController.scrollMessagesToBottom();
      }
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

  if (state.sessionsRefreshing) {
    sessionRefreshRequested = false;
  }

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
    returnToChatMain: wasSessionLane && state.lane === 'chat' && state.chatFace !== 'settings',
    refreshSessionsAfterRender: state.lane === 'sessions'
      && previousLane !== 'sessions'
      && state.sessions.length > 0
      && !state.sessionsRefreshing
      && !sessionRefreshRequested
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
  if (extensionEditorDialogController.handleGlobalKeydown(event)) {
    return;
  }

  if (customUiController.handleGlobalKeydown(event)) {
    return;
  }

  if (settingsController.handleGlobalKeydown(event)) {
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

  if (handleTranscriptEdgeScrollShortcut(event)) {
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

function scheduleRender(options: { returnToChatMain?: boolean; refreshSessionsAfterRender?: boolean } = {}): void {
  pendingReturnToChatAfterRender ||= Boolean(options.returnToChatMain);
  pendingRefreshSessionsAfterRender ||= Boolean(options.refreshSessionsAfterRender);

  if (pendingRenderFrame !== undefined) {
    return;
  }

  pendingRenderFrame = requestAnimationFrame(() => {
    pendingRenderFrame = undefined;
    const shouldHandleReturnToChat = pendingReturnToChatAfterRender;
    const shouldRefreshSessions = pendingRefreshSessionsAfterRender;
    pendingReturnToChatAfterRender = false;
    pendingRefreshSessionsAfterRender = false;

    renderWithInstrumentation();

    if (shouldRefreshSessions) {
      scheduleSessionsRefreshAfterNextPaint();
    }

    if (shouldHandleReturnToChat && state.lane === 'chat') {
      messagesController.restoreChatScrollAfterReturn();
      focusPromptInput();
    }
  });
}

function scheduleSessionsRefreshAfterNextPaint(): void {
  if (pendingSessionRefreshFrame !== undefined) {
    return;
  }

  pendingSessionRefreshFrame = requestAnimationFrame(() => {
    pendingSessionRefreshFrame = undefined;

    if (state.lane === 'sessions' && !state.sessionsRefreshing && !sessionRefreshRequested) {
      sessionRefreshRequested = true;
      vscode.postMessage({ type: 'refreshSessions' });
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
    render();
    return;
  }

  const started = performance.now();
  render();
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

function measureRenderBoundary(name: 'transcript.render' | 'sessionList.render' | 'tree.render', renderBoundary: () => void): void {
  if (!state.perfEnabled) {
    renderBoundary();
    return;
  }

  const started = performance.now();
  renderBoundary();
  vscode.postMessage({
    type: 'perfEvent',
    event: {
      name,
      durationMs: performance.now() - started,
      lane: state.lane,
      messageCount: state.messages.length,
      sessionCount: state.sessions.length,
      visibleItemCount: name === 'sessionList.render' ? sessionsController.getVisibleSessionCount() : undefined,
      currentSessionFile: state.currentSessionFile,
      sessionLoading: state.sessionLoading
    }
  });
}

function render(): void {
  const isSessionLane = state.lane === 'sessions' || state.lane === 'tree';
  const isSettingsFaceVisible = !isSessionLane && state.chatFace === 'settings';
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
  syncExtensionWidgets(isSessionLane || isSettingsFaceVisible);
  syncExtensionStatus(isSessionLane || isSettingsFaceVisible);

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
      requestAnimationFrame(() => activeSessionPane.focus({ preventScroll: true }));
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

function syncExtensionWidgets(hiddenBySurface: boolean): void {
  const aboveWidgets = hiddenBySurface || !areExtensionAboveWidgetsEnabled()
    ? []
    : state.extensionWidgets.filter((widget) => widget.placement === 'aboveEditor');
  const belowWidgets = hiddenBySurface || !areExtensionBelowWidgetsEnabled()
    ? []
    : state.extensionWidgets.filter((widget) => widget.placement === 'belowEditor');
  const placeBusySubmitOnTopWidget = !hiddenBySurface && aboveWidgets.length > 0;

  const activeKeys = new Set([...aboveWidgets, ...belowWidgets].map((widget) => widget.key));
  for (const key of widgetDimensionSignatures.keys()) {
    if (!activeKeys.has(key)) {
      widgetDimensionSignatures.delete(key);
    }
  }

  const renderPlaceholderWidgets = provisionalExtensionUiSnapshot?.widgetsPending === true;
  renderExtensionWidgetContainer(extensionWidgetsAboveElement, aboveWidgets, placeBusySubmitOnTopWidget ? busySubmitElement : undefined, renderPlaceholderWidgets);
  renderExtensionWidgetContainer(extensionWidgetsBelowElement, belowWidgets, undefined, renderPlaceholderWidgets);
  syncBusySubmitPlacement(placeBusySubmitOnTopWidget);
  extensionWidgetsAboveElement.classList.toggle('extension-widgets--with-busy', placeBusySubmitOnTopWidget);
  viewElement.classList.toggle('tauren-view--has-extension-widgets-above', aboveWidgets.length > 0);
  viewElement.classList.toggle('tauren-view--has-extension-widgets-below', belowWidgets.length > 0);
}

function renderExtensionWidgetContainer(
  container: HTMLElement,
  widgets: WebviewState['extensionWidgets'],
  leadingElement?: HTMLElement,
  placeholderWidgets = false
): void {
  const hasContent = widgets.length > 0 || Boolean(leadingElement);
  container.hidden = !hasContent;
  container.setAttribute('aria-hidden', hasContent ? 'false' : 'true');

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
        element.append(lineElement);
      }
    }

    fragment.append(element);
  }

  container.replaceChildren(fragment);

  if (!placeholderWidgets) {
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

function syncExtensionStatus(hiddenBySurface: boolean): void {
  const statusEnabled = areExtensionStatusBarEnabled();
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
  const hasStatusSlot = statusEnabled && !hiddenBySurface;
  const hasAccessibleText = text.length > 0 && !placeholderFooter;

  composerStatusTextElement.replaceChildren();
  renderAnsiTextInto(composerStatusTextElement, text, state.outputColors, { suppressBackgrounds: true });
  composerStatusElement.hidden = !hasStatusSlot;
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

function isChatTranscriptScrollable(): boolean {
  return state.lane === 'chat'
    && state.chatFace !== 'settings'
    && !hasHelpOverlayOpen()
    && !customUiController.isActive()
    && !extensionEditorDialogController.isActive();
}

function handleTranscriptEdgeScrollShortcut(event: KeyboardEvent): boolean {
  if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return false;
  }

  if (!isChatTranscriptScrollable()) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'ArrowUp') {
    messagesController.scrollMessagesToTop();
  } else {
    messagesController.scrollMessagesToBottom();
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
