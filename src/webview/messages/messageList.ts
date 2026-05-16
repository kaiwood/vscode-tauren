import { requestCodeHighlightsIn } from '../codeHighlighting';
import { messagesBottomThreshold } from '../constants';
import { createMessageElement, updateMessageBodyElement } from '../renderMessages';
import type { Activity, ChatMessage, WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

type RenderedMessageView = {
  element: HTMLElement;
  message: ChatMessage;
  showRole: boolean;
  activitiesSignature: string;
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

  public constructor(private readonly options: MessageListControllerOptions) {}

  public renderMessageList(): void {
    const state = this.options.getState();

    if (state.messages.length === 0) {
      this.renderedMessageViews = [];
      this.options.messagesContentElement.replaceChildren(this.createEmptyStateElement());
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
    requestCodeHighlightsIn(this.options.messagesContentElement);
  }

  public syncBusyStatus(): void {
    const state = this.options.getState();
    this.options.busyStatusElement.hidden = !state.busy;

    if (!state.busy) {
      return;
    }

    const nextText = this.getBusyStatusText();

    if (this.options.busyStatusTextElement.textContent !== nextText) {
      this.options.busyStatusTextElement.textContent = nextText;
    }
  }

  public handleChatPageScroll(event: KeyboardEvent): boolean {
    const state = this.options.getState();

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
    const amount = event.ctrlKey
      ? this.getTranscriptLineScrollAmount()
      : Math.max(80, Math.floor(this.options.messagesElement.clientHeight * 0.85));
    this.options.messagesElement.scrollBy({ top: direction * amount, behavior: 'auto' });
    return true;
  }

  public isMessagesAtBottom(): boolean {
    const distanceFromBottom = this.options.messagesElement.scrollHeight
      - this.options.messagesElement.scrollTop
      - this.options.messagesElement.clientHeight;
    return distanceFromBottom <= messagesBottomThreshold;
  }

  public scrollMessagesToBottom(): void {
    this.options.messagesElement.scrollTop = this.options.messagesElement.scrollHeight;
  }

  public scheduleMessagesToBottom(): void {
    this.scrollMessagesToBottomIfChat();
    requestAnimationFrame(() => {
      this.scrollMessagesToBottomIfChat();
      requestAnimationFrame(() => this.scrollMessagesToBottomIfChat());
    });
    setTimeout(() => this.scrollMessagesToBottomIfChat(), 80);
    setTimeout(() => this.scrollMessagesToBottomIfChat(), 220);
  }

  public handleMessageClick(event: MouseEvent): void {
    const state = this.options.getState();
    const target = eventTargetElement(event);
    const copyButton = target?.closest('.message__copy');

    if (copyButton instanceof HTMLElement) {
      const index = Number(copyButton.dataset.copyMessageIndex);
      const text = Number.isInteger(index) ? state.messages[index]?.text : '';

      if (text) {
        event.preventDefault();
        this.options.postMessage({ type: 'copyText', text });
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
    this.options.postMessage({
      type: 'openFile',
      path: filePath,
      ...parseDatasetPositiveInteger(link.dataset.line, 'line'),
      ...parseDatasetPositiveInteger(link.dataset.column, 'column')
    });
  }

  private createEmptyStateElement(): HTMLElement {
    const state = this.options.getState();
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

  private renderMessageAtIndex(index: number, message: ChatMessage, showRole: boolean): RenderedMessageView {
    const state = this.options.getState();
    const existingView = this.renderedMessageViews[index];
    const activitiesSignature = this.getActivitiesSignature(message);
    const copyable = canCopyAssistantMessage(message);
    const animateFromText = this.getStreamingAnimationStartText(existingView, message, index);

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
    this.renderedMessageViews[index] = nextView;
    return nextView;
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

    return JSON.stringify({ outputColors: state.outputColors, activities: message.activities });
  }

  private getBusyStatusText(): string {
    const activity = this.getLatestRunningActivity();

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

  private scrollMessagesToBottomIfChat(): void {
    if (this.options.getState().viewMode === 'chat') {
      this.scrollMessagesToBottom();
    }
  }
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

function parseCssPixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}
