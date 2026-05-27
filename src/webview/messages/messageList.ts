import { pruneDisconnectedCodeHighlights, requestCodeHighlightsIn } from '../codeHighlighting';
import { messagesBottomThreshold } from '../constants';
import { pruneDisconnectedLocalImageRequests } from './markdown';
import { createMessageElement, getActivityBodyExpansion, pruneActivityRenderState, setActivityBodyExpansion, toggleActivityBodyExpansion, updateMessageBodyElement } from './renderMessages';
import {
  createScrollFollowState,
  isScrollAtBottom,
  recordScrollMetrics,
  updateScrollFollowStateForScroll,
  type ScrollFollowState,
  type ScrollMetrics
} from './scrollFollow';
import type { Activity, ChatImage, ChatMessage, StartupResourceSection, WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

type RenderedMessageView = {
  element: HTMLElement;
  message: ChatMessage;
  showRole: boolean;
  activitiesSignature: string;
  imagesSignature: string;
  allowRemoteImages: boolean;
  copyable: boolean;
};

export type MessageListControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  messagesElement: HTMLElement;
  messagesContentElement: HTMLElement;
  busyStatusElement: HTMLElement;
  busyStatusTextElement: HTMLElement;
};

export class MessageListController {
  private renderedMessageViews: RenderedMessageView[] = [];
  private readonly scrollFollowState: ScrollFollowState = createScrollFollowState();
  private savedChatScroll: { sessionKey: string; scrollTop: number; followOutput: boolean } | undefined;
  private bottomScrollScheduled = false;

  public constructor(private readonly options: MessageListControllerOptions) {}

  public renderMessageList(): void {
    const state = this.options.getState();

    if (state.messages.length === 0) {
      this.renderedMessageViews = [];
      this.options.messagesContentElement.replaceChildren(this.createEmptyStateElement());
      pruneActivityRenderState(new Set());
      pruneDisconnectedMessageRenderState();
      return;
    }

    if (this.options.messagesContentElement.querySelector('.empty-state')) {
      this.options.messagesContentElement.replaceChildren();
    }

    let previousMessageRole: string | undefined;

    for (const [index, message] of state.messages.entries()) {
      const showRole = message.role !== previousMessageRole;
      const view = this.renderMessageAtIndex(index, message, showRole);
      const currentNode = this.options.messagesContentElement.children[index];

      if (currentNode !== view.element) {
        this.options.messagesContentElement.insertBefore(view.element, currentNode ?? null);
      }

      previousMessageRole = message.role;
    }

    for (let index = this.renderedMessageViews.length - 1; index >= state.messages.length; index -= 1) {
      this.renderedMessageViews[index]?.element.remove();
    }

    this.renderedMessageViews.length = state.messages.length;
    pruneActivityRenderState(getActiveActivityIds(state.messages));
    pruneDisconnectedMessageRenderState();
    requestCodeHighlightsIn(this.options.messagesContentElement);
  }

  public syncBusyStatus(): void {
    const state = this.options.getState();

    if (!state.busy) {
      this.options.busyStatusElement.hidden = true;
      this.options.busyStatusTextElement.textContent = '';
      return;
    }

    const nextText = this.getBusyStatusText();

    if (this.options.busyStatusTextElement.textContent !== nextText) {
      this.options.busyStatusTextElement.textContent = nextText;
    }

    this.options.busyStatusElement.hidden = false;
  }

  public toggleToolActivityDetail(): boolean {
    const activityIds = getExpandableToolActivityIds(this.options.getState().messages);

    if (activityIds.length === 0) {
      return false;
    }

    const nextExpanded = activityIds.some((activityId) => !getActivityBodyExpansion(activityId));

    for (const activityId of activityIds) {
      setActivityBodyExpansion(activityId, nextExpanded);
    }

    this.renderMessageList();
    return nextExpanded;
  }

  public handleChatPageScroll(event: KeyboardEvent): boolean {
    const state = this.options.getState();

    if (state.lane !== 'chat' || state.chatFace === 'settings' || (event.key !== 'PageUp' && event.key !== 'PageDown')) {
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
    const amount = event.ctrlKey
      ? this.getTranscriptLineScrollAmount()
      : Math.max(80, Math.floor(this.options.messagesElement.clientHeight * 0.85));
    this.options.messagesElement.scrollBy({ top: direction * amount, behavior: 'auto' });
    this.handleMessagesScroll();
    return true;
  }

  public handleMessagesScroll(): void {
    updateScrollFollowStateForScroll(
      this.scrollFollowState,
      this.getScrollMetrics(),
      messagesBottomThreshold
    );
  }

  public isMessagesAtBottom(): boolean {
    return isScrollAtBottom(this.getScrollMetrics(), messagesBottomThreshold);
  }

  public shouldFollowOutput(): boolean {
    return this.scrollFollowState.followOutput || this.isMessagesAtBottom();
  }

  public scrollMessagesToTop(): void {
    this.scrollFollowState.followOutput = false;
    this.options.messagesElement.scrollTop = 0;
    recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
  }

  public scrollMessagesToBottom(): void {
    this.scrollFollowState.followOutput = true;
    this.options.messagesElement.scrollTop = this.options.messagesElement.scrollHeight;
    recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
  }

  public scheduleMessagesToBottom(): void {
    this.scrollMessagesToBottomIfFollowingChat();

    if (this.bottomScrollScheduled) {
      return;
    }

    this.bottomScrollScheduled = true;
    requestAnimationFrame(() => {
      this.scrollMessagesToBottomIfFollowingChat();
      requestAnimationFrame(() => this.scrollMessagesToBottomIfFollowingChat());
    });
    setTimeout(() => this.scrollMessagesToBottomIfFollowingChat(), 80);
    setTimeout(() => {
      this.scrollMessagesToBottomIfFollowingChat();
      this.bottomScrollScheduled = false;
    }, 220);
  }

  public rememberChatScrollPosition(): void {
    this.savedChatScroll = {
      sessionKey: this.getSessionKey(),
      scrollTop: this.options.messagesElement.scrollTop,
      followOutput: this.shouldFollowOutput()
    };
  }

  public restoreChatScrollAfterReturn(): void {
    const saved = this.savedChatScroll;

    if (!saved || saved.sessionKey !== this.getSessionKey()) {
      this.scrollFollowState.followOutput = true;
      this.scheduleMessagesToBottom();
      return;
    }

    if (saved.followOutput) {
      this.scrollFollowState.followOutput = true;
      this.scheduleMessagesToBottom();
      return;
    }

    this.scrollFollowState.followOutput = false;
    requestAnimationFrame(() => {
      if (saved !== this.savedChatScroll || saved.sessionKey !== this.getSessionKey()) {
        return;
      }

      this.options.messagesElement.scrollTop = saved.scrollTop;
      recordScrollMetrics(this.scrollFollowState, this.getScrollMetrics());
    });
  }

  public handleMessageClick(event: MouseEvent): void {
    const state = this.options.getState();
    const target = eventTargetElement(event);
    const toggleButton = target?.closest('[data-activity-body-toggle]');

    if (toggleButton instanceof HTMLElement) {
      const activityId = toggleButton.dataset.activityBodyToggle;

      if (activityId) {
        event.preventDefault();
        event.stopPropagation();
        const expanded = toggleActivityBodyExpansion(activityId);
        this.options.postMessage({ type: 'setToolsExpanded', expanded });
        this.rerenderMessageAtIndex(parseDatasetInteger(toggleButton.dataset.messageIndex));
      }

      return;
    }

    const dismissWelcomeButton = target?.closest('[data-dismiss-welcome]');

    if (dismissWelcomeButton instanceof HTMLElement) {
      event.preventDefault();
      this.options.postMessage({ type: 'dismissWelcome' });
      return;
    }

    const codeCopyButton = target?.closest('[data-copy-code-block]');

    if (codeCopyButton instanceof HTMLElement) {
      const block = codeCopyButton.closest('.tauren-code-block');
      const text = block?.querySelector('pre')?.textContent ?? '';

      if (text) {
        event.preventDefault();
        this.options.postMessage({ type: 'copyText', text, successMessage: 'Copied code.' });
      }

      return;
    }

    const activityCopyButton = target?.closest('[data-copy-activity-output]');

    if (activityCopyButton instanceof HTMLElement) {
      const text = activityCopyButton.dataset.copyActivityOutput ?? '';

      if (text) {
        event.preventDefault();
        this.options.postMessage({ type: 'copyText', text, successMessage: 'Copied output.' });
      }

      return;
    }

    const pathCopyButton = target?.closest('[data-copy-path]');

    if (pathCopyButton instanceof HTMLElement) {
      const text = pathCopyButton.dataset.copyPath ?? '';

      if (text) {
        event.preventDefault();
        this.options.postMessage({ type: 'copyText', text, successMessage: 'Copied path.' });
      }

      return;
    }

    const openFileButton = target?.closest('[data-open-file-path]');

    if (openFileButton instanceof HTMLElement) {
      const filePath = openFileButton.dataset.openFilePath;

      if (filePath) {
        event.preventDefault();
        this.options.postMessage({ type: 'openFile', path: filePath });
      }

      return;
    }

    const copyButton = target?.closest('.message__copy');

    if (copyButton instanceof HTMLElement) {
      const index = Number(copyButton.dataset.copyMessageIndex);
      const text = Number.isInteger(index) ? state.messages[index]?.text : '';

      if (text) {
        event.preventDefault();
        this.options.postMessage({ type: 'copyText', text, successMessage: 'Copied response.' });
      }

      return;
    }

    const link = target?.closest('.tauren-file-link');

    if (!(link instanceof HTMLElement)) {
      return;
    }

    const filePath = link.dataset.filePath;

    if (!filePath) {
      return;
    }

    event.preventDefault();
    this.options.postMessage({
      type: 'openFile',
      path: filePath,
      ...parseDatasetPositiveInteger(link.dataset.line, 'line'),
      ...parseDatasetPositiveInteger(link.dataset.column, 'column')
    });
  }

  private createEmptyStateElement(): HTMLElement {
    const state = this.options.getState();

    if (!state.sessionLoading) {
      return state.welcomeDismissed ? createPlainEmptyStateElement(state) : createWelcomeStateElement(state);
    }

    const empty = document.createElement('p');
    empty.className = 'empty-state empty-state--loading';
    empty.setAttribute('role', 'status');
    empty.setAttribute('aria-live', 'polite');
    empty.setAttribute('aria-atomic', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'status__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Loading session…';
    empty.append(spinner, text);
    return empty;
  }

  private renderMessageAtIndex(index: number, message: ChatMessage, showRole: boolean): RenderedMessageView {
    const state = this.options.getState();
    const existingView = this.renderedMessageViews[index];
    const activitiesSignature = this.getActivitiesSignature(message);
    const imagesSignature = this.getImagesSignature(message);
    const copyable = canCopyAssistantMessage(message);
    const animateFromText = this.getStreamingAnimationStartText(existingView, message, index);

    if (existingView && canReuseMessageElement(existingView, message, showRole, activitiesSignature, imagesSignature, state.allowRemoteImages, copyable)) {
      if ((existingView.message.text || '') !== (message.text || '') || existingView.imagesSignature !== imagesSignature) {
        updateMessageBodyElement(
          existingView.element,
          message,
          {
            ...(animateFromText === undefined ? {} : { animateFromText }),
            outputColors: state.outputColors,
            animationsEnabled: state.animationsEnabled,
            allowRemoteImages: state.allowRemoteImages
          }
        );
        pruneDisconnectedMessageRenderState();
      }

      existingView.message = message;
      existingView.showRole = showRole;
      existingView.activitiesSignature = activitiesSignature;
      existingView.imagesSignature = imagesSignature;
      existingView.allowRemoteImages = state.allowRemoteImages;
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
          outputColors: state.outputColors,
          animationsEnabled: state.animationsEnabled,
          allowRemoteImages: state.allowRemoteImages
        }
      ),
      message,
      showRole,
      activitiesSignature,
      imagesSignature,
      allowRemoteImages: state.allowRemoteImages,
      copyable
    };

    existingView?.element.replaceWith(nextView.element);
    this.renderedMessageViews[index] = nextView;
    return nextView;
  }

  private rerenderMessageAtIndex(index: number | undefined): void {
    const state = this.options.getState();

    if (index === undefined || !state.messages[index]) {
      this.renderMessageList();
      return;
    }

    const existingView = this.renderedMessageViews[index];

    if (!existingView) {
      this.renderMessageList();
      return;
    }

    const previousMessage = index > 0 ? state.messages[index - 1] : undefined;
    const showRole = state.messages[index].role !== previousMessage?.role;
    const nextView: RenderedMessageView = {
      element: createMessageElement(
        state.messages[index],
        showRole,
        index,
        { outputColors: state.outputColors, animationsEnabled: state.animationsEnabled, allowRemoteImages: state.allowRemoteImages }
      ),
      message: state.messages[index],
      showRole,
      activitiesSignature: this.getActivitiesSignature(state.messages[index]),
      imagesSignature: this.getImagesSignature(state.messages[index]),
      allowRemoteImages: state.allowRemoteImages,
      copyable: canCopyAssistantMessage(state.messages[index])
    };

    existingView.element.replaceWith(nextView.element);
    this.renderedMessageViews[index] = nextView;
    pruneDisconnectedMessageRenderState();
    requestCodeHighlightsIn(nextView.element);
  }

  private getStreamingAnimationStartText(
    existingView: RenderedMessageView | undefined,
    message: ChatMessage,
    index: number
  ): string | undefined {
    if (!existingView || !this.shouldAnimateStreamingAppend(existingView.message, message, index)) {
      return undefined;
    }

    return getMessageBodyVisibleText(existingView.element);
  }

  private shouldAnimateStreamingAppend(previous: ChatMessage, next: ChatMessage, index: number): boolean {
    const state = this.options.getState();
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

  private getActivitiesSignature(message: ChatMessage): string {
    const state = this.options.getState();

    if (!Array.isArray(message.activities) || message.activities.length === 0) {
      return '';
    }

    return [
      state.outputColors ? 'colors' : 'plain',
      state.allowRemoteImages ? 'remote' : 'local',
      ...message.activities.map(getActivitySignature)
    ].join('\u0001');
  }

  private getImagesSignature(message: ChatMessage): string {
    return getImagesSignature(message.images);
  }

  private getBusyStatusText(): string {
    const activity = this.getLatestRunningActivity();

    if (!activity) {
      return 'Pi engine is working...';
    }

    const title = typeof activity.title === 'string' && activity.title
      ? activity.title
      : 'Pi engine is working';
    const summary = typeof activity.summary === 'string' && activity.summary
      ? ': ' + activity.summary
      : '';

    return title + summary;
  }

  private getLatestRunningActivity(): Activity | undefined {
    const state = this.options.getState();

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

  private getTranscriptLineScrollAmount(): number {
    return parseCssPixelValue(getComputedStyle(this.options.messagesContentElement).lineHeight)
      || parseCssPixelValue(getComputedStyle(this.options.messagesElement).lineHeight)
      || 20;
  }

  private scrollMessagesToBottomIfFollowingChat(): void {
    if (this.options.getState().lane === 'chat' && this.shouldFollowOutput()) {
      this.scrollMessagesToBottom();
    }
  }

  private getScrollMetrics(): ScrollMetrics {
    return {
      scrollTop: this.options.messagesElement.scrollTop,
      scrollHeight: this.options.messagesElement.scrollHeight,
      clientHeight: this.options.messagesElement.clientHeight
    };
  }

  private getSessionKey(): string {
    const state = this.options.getState();
    return state.currentSessionFile || '__transient_chat__';
  }
}

function pruneDisconnectedMessageRenderState(): void {
  pruneDisconnectedCodeHighlights();
  pruneDisconnectedLocalImageRequests();
}

function createPlainEmptyStateElement(state: WebviewState): HTMLElement {
  const resources = createStartupResourcesElement(state.startupResources);

  if (!resources) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Ask Tauren about this workspace.';
    return empty;
  }

  const empty = document.createElement('div');
  empty.className = 'empty-state empty-state--welcome empty-state--new-session';

  const description = document.createElement('p');
  description.textContent = 'Ask Tauren about this workspace.';

  empty.append(description, resources);
  return empty;
}

function createWelcomeStateElement(state: WebviewState): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state empty-state--welcome';

  const title = document.createElement('h2');
  title.className = 'empty-state__title';
  title.textContent = 'Welcome to Tauren';

  const description = document.createElement('p');
  description.textContent = 'Ask Tauren about this workspace, review code, plan changes, or make edits.';

  const commandHint = document.createElement('p');
  commandHint.textContent = 'Type / for commands, or add a file/selection as context from the editor.';

  const resources = createStartupResourcesElement(state.startupResources);

  const tryLabel = document.createElement('p');
  tryLabel.className = 'empty-state__try-label';
  tryLabel.textContent = 'Try:';

  const promptList = document.createElement('ul');
  promptList.className = 'empty-state__prompts';

  for (const prompt of [
    'Explain how this workspace is structured',
    'Review the current file for bugs',
    'Plan the changes before editing',
    'Write tests for this behavior'
  ]) {
    const item = document.createElement('li');
    item.textContent = prompt;
    promptList.append(item);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'empty-state__dismiss';
  dismiss.textContent = "Don't show again";
  dismiss.setAttribute('data-dismiss-welcome', '');

  empty.append(title, description, commandHint);

  if (resources) {
    empty.append(resources);
  }

  empty.append(tryLabel, promptList, dismiss);
  return empty;
}

function createStartupResourcesElement(resources: StartupResourceSection[]): HTMLElement | undefined {
  if (resources.length === 0) {
    return undefined;
  }

  const container = document.createElement('div');
  container.className = 'empty-state__resources';

  for (const section of resources) {
    if (section.items.length === 0) {
      continue;
    }

    const row = document.createElement('div');
    row.className = 'empty-state__resource-row';

    const heading = document.createElement('span');
    heading.className = 'empty-state__resource-heading';
    heading.textContent = `[${section.name}]`;

    const items = document.createElement('span');
    items.className = 'empty-state__resource-items';
    items.textContent = section.items.join(', ');

    row.append(heading, items);
    container.append(row);
  }

  return container.childElementCount > 0 ? container : undefined;
}

function getActivitySignature(activity: Activity): string {
  return [
    activity.id ?? '',
    activity.kind ?? '',
    activity.status ?? '',
    activity.title ?? '',
    activity.summary ?? '',
    activity.body ?? '',
    activity.expandedBody ?? '',
    activity.code ? 'code' : '',
    getImagesSignature(activity.images)
  ].join('\u0000');
}

function getImagesSignature(images: ChatImage[] | undefined): string {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }

  return images.map((image) => {
    const data = typeof image.data === 'string' ? image.data : '';
    const prefix = data.slice(0, 32);
    const suffix = data.length > 32 ? data.slice(-32) : '';
    return [
      image.type ?? '',
      image.mimeType ?? '',
      image.alt ?? '',
      data.length,
      prefix,
      suffix
    ].join('\u0000');
  }).join('\u0001');
}

function canReuseMessageElement(
  view: RenderedMessageView,
  message: ChatMessage,
  showRole: boolean,
  activitiesSignature: string,
  imagesSignature: string,
  allowRemoteImages: boolean,
  copyable: boolean
): boolean {
  return view.message.role === message.role
    && Boolean(view.message.error) === Boolean(message.error)
    && (view.message.variant || '') === (message.variant || '')
    && view.showRole === showRole
    && view.activitiesSignature === activitiesSignature
    && view.imagesSignature === imagesSignature
    && view.allowRemoteImages === allowRemoteImages
    && view.copyable === copyable;
}

function getActiveActivityIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();

  for (const message of messages) {
    for (const activity of message.activities ?? []) {
      if (typeof activity.id === 'string' && activity.id) {
        ids.delete(activity.id);
        ids.add(activity.id);
      }
    }
  }

  return ids;
}

function getExpandableToolActivityIds(messages: ChatMessage[]): string[] {
  const ids: string[] = [];

  for (const message of messages) {
    for (const activity of message.activities ?? []) {
      if (typeof activity.id === 'string' && activity.id && typeof activity.expandedBody === 'string') {
        ids.push(activity.id);
      }
    }
  }

  return ids;
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

function parseDatasetPositiveInteger(value: string | undefined, key: 'line' | 'column'): { line?: number; column?: number } {
  if (!value) {
    return {};
  }

  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return {};
  }

  return key === 'line' ? { line: numberValue } : { column: numberValue };
}

function parseDatasetInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : undefined;
}

function parseCssPixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}
