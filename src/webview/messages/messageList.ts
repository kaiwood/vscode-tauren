import { pruneDisconnectedCodeHighlights } from '../codeHighlighting';
import { messagesBottomThreshold } from '../constants';
import { eventTargetElement } from '../dom';
import { getAgentRuntimeWorkingText } from '../../shared/agentRuntimeLabels';
import { isHttpUrl } from '../../shared/url';
import { pruneDisconnectedLocalImageRequests } from './markdown';
import { shouldRenderQuietEmptyTranscript } from './renderPolicy';
import { createMessageElement, getActivityBodyExpansion, pruneActivityRenderState, setActivityBodyExpansion, toggleActivityBodyExpansion, updateMessageActivitiesElement, updateMessageBodyElement } from './renderMessages';
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

const largeTranscriptCollapseThreshold = 250;
const largeTranscriptHeadCount = 20;
const largeTranscriptTailCount = 180;
const streamingBodyRenderIntervalMs = 33;

type MessageRenderPlanItem = { kind: 'message'; index: number } | { kind: 'collapse'; count: number };

type RenderedMessageView = {
  element: HTMLElement;
  message: ChatMessage;
  bodyText: string;
  showRole: boolean;
  imagesSignature: string;
  allowRemoteImages: boolean;
  outputColors: boolean;
  copyable: boolean;
  hasBody: boolean;
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
  private bottomScrollFrame: number | undefined;
  private streamingBodyRenderTimer: number | undefined;
  private nextStreamingBodyRenderAt = 0;
  private readonly messagesResizeObserver: ResizeObserver;
  private collapsedTranscriptElement: HTMLElement | undefined;

  public constructor(private readonly options: MessageListControllerOptions) {
    this.messagesResizeObserver = new ResizeObserver(() => this.scheduleMessagesToBottom());
    this.messagesResizeObserver.observe(options.messagesContentElement);
  }

  public renderMessageList(): void {
    const state = this.options.getState();

    if (state.messages.length === 0) {
      this.renderedMessageViews = [];
      if (shouldRenderQuietEmptyTranscript(state)) {
        this.options.messagesContentElement.replaceChildren();
      } else {
        this.options.messagesContentElement.replaceChildren(this.createEmptyStateElement());
      }
      pruneActivityRenderState(new Set());
      pruneDisconnectedMessageRenderState();
      return;
    }

    if (this.options.messagesContentElement.querySelector('.empty-state')) {
      this.options.messagesContentElement.replaceChildren();
    }

    const renderPlan = getMessageRenderPlan(state.messages.length);
    const renderedIndexes = new Set<number>();
    const nodes: Node[] = [];
    let previousMessageRole: string | undefined;

    for (const item of renderPlan) {
      if (item.kind === 'collapse') {
        nodes.push(this.getCollapsedTranscriptElement(item.count));
        previousMessageRole = undefined;
        continue;
      }

      const message = state.messages[item.index];

      if (!message) {
        continue;
      }

      const showRole = message.role !== previousMessageRole;
      const view = this.renderMessageAtIndex(item.index, message, showRole);
      renderedIndexes.add(item.index);
      nodes.push(view.element);
      previousMessageRole = message.role;
    }

    for (const [index, view] of this.renderedMessageViews.entries()) {
      if (view && !renderedIndexes.has(index)) {
        view.element.remove();
      }
    }

    this.syncMessageNodes(nodes);
    this.renderedMessageViews.length = state.messages.length;
    pruneActivityRenderState(getActiveActivityIds(state.messages));
    pruneDisconnectedMessageRenderState();
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

  public toggleToolActivityDetail(): boolean | undefined {
    const activityIds = getExpandableToolActivityIds(this.options.getState().messages);

    if (activityIds.length === 0) {
      return undefined;
    }

    const nextExpanded = activityIds.some((activityId) => !getActivityBodyExpansion(activityId));

    for (const activityId of activityIds) {
      setActivityBodyExpansion(activityId, nextExpanded);
    }

    this.renderMessageList();
    return nextExpanded;
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
    if (this.bottomScrollFrame !== undefined) {
      return;
    }

    this.bottomScrollFrame = requestAnimationFrame(() => {
      this.bottomScrollFrame = undefined;
      this.scrollMessagesToBottomIfFollowingChat();
    });
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
        toggleActivityBodyExpansion(activityId);
        const expandableToolActivityIds = getExpandableToolActivityIds(state.messages);

        if (expandableToolActivityIds.includes(activityId)) {
          const expanded = expandableToolActivityIds.some((toolActivityId) => getActivityBodyExpansion(toolActivityId));
          this.options.postMessage({ type: 'setToolsExpanded', expanded });
        }

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

    if (link instanceof HTMLElement) {
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
      return;
    }

    const externalLink = target?.closest('a[href]');

    if (externalLink instanceof HTMLAnchorElement && isHttpUrl(externalLink.href)) {
      event.preventDefault();
      this.options.postMessage({ type: 'openExternal', url: externalLink.href });
    }
  }

  public getRenderedMessageCount(): number {
    return getMessageRenderPlan(this.options.getState().messages.length).filter((item) => item.kind === 'message').length;
  }

  public getCollapsedMessageCount(): number {
    return getMessageRenderPlan(this.options.getState().messages.length).reduce((count, item) => item.kind === 'collapse' ? count + item.count : count, 0);
  }

  private syncMessageNodes(nodes: Node[]): void {
    let reference = this.options.messagesContentElement.firstChild;

    for (const node of nodes) {
      if (node !== reference) {
        this.options.messagesContentElement.insertBefore(node, reference);
      }

      reference = node.nextSibling;
    }

    while (reference) {
      const next = reference.nextSibling;
      reference.remove();
      reference = next;
    }
  }

  private getCollapsedTranscriptElement(count: number): HTMLElement {
    if (!this.collapsedTranscriptElement) {
      const element = document.createElement('div');
      element.className = 'message message--collapsed-transcript';
      element.setAttribute('role', 'note');
      this.collapsedTranscriptElement = element;
    }

    this.collapsedTranscriptElement.textContent = `${count} earlier messages hidden to keep this large session responsive.`;
    return this.collapsedTranscriptElement;
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

    if (existingView
      && existingView.message === message
      && existingView.bodyText === (message.text || '')
      && existingView.showRole === showRole
      && existingView.allowRemoteImages === state.allowRemoteImages
      && existingView.outputColors === state.outputColors) {
      return existingView;
    }

    const imagesSignature = this.getImagesSignature(message);
    const copyable = canCopyAssistantMessage(message);
    const hasBody = shouldRenderMessageBody(message);

    if (existingView && canReuseMessageElement(existingView, message, showRole, imagesSignature, state.allowRemoteImages, copyable, hasBody)) {
      const renderOptions = {
        outputColors: state.outputColors,
        allowRemoteImages: state.allowRemoteImages
      };

      const bodyChanged = existingView.bodyText !== (message.text || '') || existingView.imagesSignature !== imagesSignature;

      if (bodyChanged && this.shouldDeferStreamingBodyRender(existingView.message, message, index)) {
        this.scheduleStreamingBodyRender();
      } else if (bodyChanged) {
        updateMessageBodyElement(existingView.element, message, renderOptions);
        existingView.bodyText = message.text || '';
        this.recordStreamingBodyRender(existingView.message, message, index);
      }

      updateMessageActivitiesElement(existingView.element, message, index, renderOptions);
      pruneDisconnectedMessageRenderState();
      existingView.message = message;
      existingView.showRole = showRole;
      existingView.imagesSignature = imagesSignature;
      existingView.allowRemoteImages = state.allowRemoteImages;
      existingView.outputColors = state.outputColors;
      existingView.copyable = copyable;
      existingView.hasBody = hasBody;
      return existingView;
    }

    const nextView: RenderedMessageView = {
      element: createMessageElement(
        message,
        showRole,
        index,
        {
          outputColors: state.outputColors,
          allowRemoteImages: state.allowRemoteImages
        }
      ),
      message,
      bodyText: message.text || '',
      showRole,
      imagesSignature,
      allowRemoteImages: state.allowRemoteImages,
      outputColors: state.outputColors,
      copyable,
      hasBody
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
        { outputColors: state.outputColors, allowRemoteImages: state.allowRemoteImages }
      ),
      message: state.messages[index],
      bodyText: state.messages[index].text || '',
      showRole,
      imagesSignature: this.getImagesSignature(state.messages[index]),
      allowRemoteImages: state.allowRemoteImages,
      outputColors: state.outputColors,
      copyable: canCopyAssistantMessage(state.messages[index]),
      hasBody: shouldRenderMessageBody(state.messages[index])
    };

    existingView.element.replaceWith(nextView.element);
    this.renderedMessageViews[index] = nextView;
    pruneDisconnectedMessageRenderState();
  }

  private shouldDeferStreamingBodyRender(previous: ChatMessage, next: ChatMessage, index: number): boolean {
    return this.isStreamingAssistantAppend(previous, next, index)
      && performance.now() < this.nextStreamingBodyRenderAt;
  }

  private scheduleStreamingBodyRender(): void {
    if (this.streamingBodyRenderTimer !== undefined) {
      return;
    }

    const delay = Math.max(0, this.nextStreamingBodyRenderAt - performance.now());
    this.streamingBodyRenderTimer = window.setTimeout(() => {
      this.streamingBodyRenderTimer = undefined;

      if (this.options.getState().lane === 'chat') {
        this.renderMessageList();
        this.scheduleMessagesToBottom();
      }
    }, delay);
  }

  private recordStreamingBodyRender(previous: ChatMessage, next: ChatMessage, index: number): void {
    if (this.isStreamingAssistantAppend(previous, next, index)) {
      this.nextStreamingBodyRenderAt = performance.now() + streamingBodyRenderIntervalMs;
    }
  }

  private isStreamingAssistantAppend(previous: ChatMessage, next: ChatMessage, index: number): boolean {
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

  private getImagesSignature(message: ChatMessage): string {
    return getImagesSignature(message.images);
  }

  private getBusyStatusText(): string {
    const activity = this.getLatestRunningActivity();

    if (!activity) {
      return getAgentRuntimeWorkingText(this.getBackend(), { ellipsis: true });
    }

    const title = typeof activity.title === 'string' && activity.title
      ? activity.title
      : getAgentRuntimeWorkingText(this.getBackend());
    const summary = typeof activity.summary === 'string' && activity.summary
      ? ': ' + activity.summary
      : '';

    return title + summary;
  }

  private getBackend(): unknown {
    return this.options.getState().settings.values['tauren.backend'];
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
  imagesSignature: string,
  allowRemoteImages: boolean,
  copyable: boolean,
  hasBody: boolean
): boolean {
  return view.message.role === message.role
    && Boolean(view.message.error) === Boolean(message.error)
    && (view.message.variant || '') === (message.variant || '')
    && view.showRole === showRole
    && view.imagesSignature === imagesSignature
    && view.allowRemoteImages === allowRemoteImages
    && view.copyable === copyable
    && view.hasBody === hasBody;
}

function shouldRenderMessageBody(message: ChatMessage): boolean {
  const activities = Array.isArray(message.activities) ? message.activities : [];
  return Boolean(message.text || message.error || hasRenderableImages(message.images) || activities.length === 0);
}

function hasRenderableImages(images: ChatImage[] | undefined): boolean {
  if (!Array.isArray(images)) {
    return false;
  }

  return images.some((image) => {
    const mimeType = typeof image.mimeType === 'string' ? image.mimeType.toLowerCase() : '';
    return image.type === 'image'
      && typeof image.data === 'string'
      && Boolean(image.data)
      && (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/gif' || mimeType === 'image/webp');
  });
}

function getMessageRenderPlan(messageCount: number): MessageRenderPlanItem[] {
  if (messageCount <= largeTranscriptCollapseThreshold) {
    return Array.from({ length: messageCount }, (_, index) => ({ kind: 'message', index }));
  }

  const headCount = Math.min(largeTranscriptHeadCount, messageCount);
  const tailStart = Math.max(headCount, messageCount - largeTranscriptTailCount);
  const collapsedCount = Math.max(0, tailStart - headCount);
  const plan: MessageRenderPlanItem[] = [];

  for (let index = 0; index < headCount; index += 1) {
    plan.push({ kind: 'message', index });
  }

  if (collapsedCount > 0) {
    plan.push({ kind: 'collapse', count: collapsedCount });
  }

  for (let index = tailStart; index < messageCount; index += 1) {
    plan.push({ kind: 'message', index });
  }

  return plan;
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
      if (typeof activity.id === 'string' && activity.id && isExpandableToolActivity(activity)) {
        ids.push(activity.id);
      }
    }
  }

  return ids;
}

function isExpandableToolActivity(activity: NonNullable<ChatMessage['activities']>[number]): boolean {
  return typeof activity.expandedBody === 'string'
    || (activity.kind === 'tool_execution' && activity.status === 'running' && typeof activity.body === 'string' && activity.body.length > 0);
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
