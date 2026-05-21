import { containsAnsiEscape, renderAnsiTextInto } from './ansi';
import { createIconActionButton } from './actionButtons';
import { renderHighlightedCodeInto, renderMarkdownInto, type RenderMarkdownOptions } from './markdown';
import type { Activity, ChatMessage } from '../types';

const activityExpansion = new Map<string, boolean>();
const activityBodyExpansion = new Map<string, boolean>();

export function toggleActivityBodyExpansion(activityId: string): boolean {
  const next = !activityBodyExpansion.get(activityId);
  activityBodyExpansion.set(activityId, next);
  return next;
}

export type MessageRenderOptions = RenderMarkdownOptions & {
  outputColors?: boolean;
};

export function createMessageElement(
  message: ChatMessage,
  showRole: boolean,
  messageIndex?: number,
  options: MessageRenderOptions = {}
): HTMLElement {
  const article = document.createElement('article');
  article.className = `message message--${message.role}${message.error ? ' message--error' : ''}${getMessageVariantClass(message)}`;

  if (message.variant === 'branchSummary') {
    article.append(createBranchSummaryActivityElement(message.text || '', messageIndex, options));
    return article;
  }

  const body = document.createElement('div');
  body.className = 'message__body';

  if (shouldRenderMarkdown(message)) {
    renderMarkdownInto(body, message.text || '', options);
  } else {
    body.textContent = message.text || '';
  }

  if (showRole) {
    const role = document.createElement('div');
    role.className = 'message__role';
    role.textContent = roleLabel(message.role);
    article.append(role);
  }

  const activities = Array.isArray(message.activities) ? message.activities : [];
  const hasBody = Boolean(message.text || message.error || activities.length === 0);

  if (message.role !== 'assistant') {
    article.append(body);
    return article;
  }

  if (activities.length > 0) {
    article.append(createActivityListElement(activities, messageIndex, options));
  }

  if (hasBody) {
    if (activities.length > 0) {
      body.classList.add('message__body--after-activities');
    }

    article.append(body);
  }

  if (canCopyAssistantMessage(message) && typeof messageIndex === 'number') {
    article.append(createCopyButtonElement(messageIndex));
  }

  return article;
}

export function updateMessageBodyElement(
  article: HTMLElement,
  message: ChatMessage,
  options: MessageRenderOptions = {}
): boolean {
  if (message.variant === 'branchSummary') {
    return updateBranchSummaryActivityElement(article, message.text || '');
  }

  const body = getDirectMessageBodyElement(article);

  if (!body) {
    return false;
  }

  body.className = 'message__body';

  if (message.role === 'assistant' && Array.isArray(message.activities) && message.activities.length > 0) {
    body.classList.add('message__body--after-activities');
  }

  if (shouldRenderMarkdown(message)) {
    renderMarkdownInto(body, message.text || '', options);
  } else {
    body.textContent = message.text || '';
  }

  return true;
}

function getDirectMessageBodyElement(article: HTMLElement): HTMLElement | undefined {
  for (const child of Array.from(article.children)) {
    if (child instanceof HTMLElement && child.classList.contains('message__body')) {
      return child;
    }
  }

  return undefined;
}

function getMessageVariantClass(message: ChatMessage): string {
  return message.variant === 'thinking' ? ' message--thinking' : '';
}

function shouldRenderMarkdown(message: ChatMessage): boolean {
  return message.role === 'assistant' && !message.error;
}

function createBranchSummaryActivityElement(text: string, messageIndex: number | undefined, options: MessageRenderOptions): HTMLElement {
  const body = stripBranchSummaryPrefix(text);

  return createActivityElement({
    id: typeof messageIndex === 'number' ? `branch-summary-${messageIndex}` : 'branch-summary',
    kind: 'message',
    title: 'Branch summary',
    status: 'info',
    body: createBranchSummaryPreview(body),
    expandedBody: body,
    code: true
  }, messageIndex, options);
}

function updateBranchSummaryActivityElement(article: HTMLElement, text: string): boolean {
  article.replaceChildren(createBranchSummaryActivityElement(text, undefined, {}));
  return true;
}

function createBranchSummaryPreview(text: string): string {
  const previewLineCount = 4;
  const lines = text.split('\n');

  if (lines.length <= previewLineCount) {
    return text;
  }

  return [
    ...lines.slice(0, previewLineCount),
    `... (${lines.length - previewLineCount} more lines)`
  ].join('\n');
}

function stripBranchSummaryPrefix(text: string): string {
  const prefix = 'Returned from branch.\n\n';
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function canCopyAssistantMessage(message: ChatMessage): boolean {
  return message.role === 'assistant'
    && !message.error
    && message.variant !== 'thinking'
    && Boolean(message.text);
}

function createCopyButtonElement(messageIndex: number): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'message__actions';

  const button = createIconActionButton('message__copy', 'Copy response');
  button.dataset.copyMessageIndex = String(messageIndex);

  actions.append(button);
  return actions;
}

function createActivityListElement(activities: Activity[], messageIndex: number | undefined, options: MessageRenderOptions): HTMLElement {
  const list = document.createElement('div');
  list.className = 'activity-list';

  for (const activity of activities) {
    list.append(createActivityElement(activity, messageIndex, options));
  }

  return list;
}

function createActivityElement(activity: Activity, messageIndex: number | undefined, options: MessageRenderOptions): HTMLElement {
  const details = document.createElement('details');
  details.className = `activity activity--${activity.kind || 'rpc'} activity--${activity.status || 'info'}`;

  const activityId = typeof activity.id === 'string' ? activity.id : '';
  const savedOpenState = activityExpansion.get(activityId);
  details.open = typeof savedOpenState === 'boolean'
    ? savedOpenState
    : activity.status === 'running' || shouldKeepActivityOpen(activity);

  details.addEventListener('toggle', () => {
    if (activityId) {
      activityExpansion.set(activityId, details.open);
    }
  });

  const summary = document.createElement('summary');
  summary.className = 'activity__summary';

  const title = document.createElement('span');
  title.className = 'activity__title';
  title.textContent = typeof activity.title === 'string' ? activity.title : 'Activity';

  const status = document.createElement('span');
  status.className = 'activity__status';
  status.textContent = activityStatusLabel(activity.status);

  summary.append(title, status);

  if (typeof activity.summary === 'string' && activity.summary.length > 0) {
    const description = document.createElement('span');
    description.className = 'activity__description';
    description.textContent = activity.summary;
    summary.append(description);
  }

  details.append(summary);

  if (typeof activity.body === 'string' && activity.body.length > 0) {
    const bodyCanVisuallyExpand = Boolean(activityId && activity.code);
    const bodyExpanded = Boolean(activityId && activityBodyExpansion.get(activityId) && (activity.expandedBody || bodyCanVisuallyExpand));
    const bodyText = bodyExpanded && typeof activity.expandedBody === 'string' ? activity.expandedBody : activity.body;
    const body = document.createElement(activity.code ? 'pre' : 'div');
    body.className = `activity__body${activity.code ? ' activity__body--code' : ' activity__body--markdown'}${bodyExpanded ? ' activity__body--expanded' : ''}`;

    let bodyToggle: ActivityBodyToggle | undefined;

    if (activity.code) {
      bodyToggle = renderCodeActivityBody(body, activity, bodyText, {
        bodyExpanded,
        messageIndex,
        outputColors: options.outputColors !== false
      });
    } else {
      renderMarkdownInto(body, bodyText);
    }

    const overflowToggle = bodyCanVisuallyExpand && !bodyExpanded && !bodyToggle
      ? { label: 'Show full output', activityId, messageIndex, expanded: false }
      : undefined;

    const copyBodyText = activity.title === 'Branch summary' && typeof activity.expandedBody === 'string'
      ? activity.expandedBody
      : bodyText;

    details.append(activity.code ? createActivityBodyWrap(body, bodyText, getReadActivityPath(activity, bodyText), bodyToggle, overflowToggle, copyBodyText) : body);

    if (bodyExpanded && shouldScrollExpandedBodyToBottom(activity.body)) {
      scheduleActivityBodyScrollToBottom(body);
    }
  }

  return details;
}

function createActivityBodyWrap(
  body: HTMLElement,
  bodyText: string,
  filePath: string | undefined,
  bodyToggle: ActivityBodyToggle | undefined,
  overflowToggle: ActivityBodyToggle | undefined,
  copyText: string = bodyText
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'activity__body-wrap';

  const actions = document.createElement('div');
  actions.className = 'activity__body-actions';

  const copyOutput = createIconActionButton('activity__body-action', 'Copy output');
  copyOutput.dataset.copyActivityOutput = copyText;
  actions.append(copyOutput);

  if (filePath) {
    const openFile = document.createElement('button');
    openFile.className = 'activity__body-action activity__body-action--text';
    openFile.type = 'button';
    openFile.textContent = 'Open';
    openFile.setAttribute('aria-label', 'Open file');
    openFile.dataset.openFilePath = filePath;
    const openFileTooltip = document.createElement('span');
    openFileTooltip.className = 'tau-icon-action-tooltip';
    openFileTooltip.textContent = 'Open file';
    openFile.append(openFileTooltip);
    actions.append(openFile);

    const copyPath = createIconActionButton('activity__body-action', 'Copy path');
    copyPath.dataset.copyPath = filePath;
    actions.append(copyPath);
  }

  wrap.append(actions, body);

  if (bodyToggle) {
    wrap.append(createActivityBodyToggle(bodyToggle));
  } else if (overflowToggle) {
    scheduleActivityBodyOverflowToggle(wrap, body, overflowToggle);
  }

  return wrap;
}

type ActivityBodyToggle = {
  label: string;
  activityId: string;
  messageIndex: number | undefined;
  expanded: boolean;
};

function renderCodeActivityBody(
  element: HTMLElement,
  activity: Activity,
  bodyText: string,
  options: { bodyExpanded: boolean; messageIndex: number | undefined; outputColors: boolean }
): ActivityBodyToggle | undefined {
  const activityId = typeof activity.id === 'string' ? activity.id : '';
  const filePath = getReadActivityPath(activity, bodyText);
  const hasExpandedToggle = Boolean(options.bodyExpanded && activityId);
  const marker = !options.bodyExpanded && activityId && typeof activity.expandedBody === 'string'
    ? findTruncationMarker(bodyText)
    : undefined;
  const renderedBodyText = marker ? removeTruncationMarker(marker) : bodyText;

  if (filePath && !containsAnsiEscape(renderedBodyText)) {
    renderHighlightedActivityCodeInto(element, renderedBodyText, filePath);
  } else {
    renderAnsiActivityCodeInto(element, renderedBodyText, options.outputColors);
  }

  if (hasExpandedToggle) {
    return {
      label: 'Show less',
      activityId,
      messageIndex: options.messageIndex,
      expanded: true
    };
  }

  if (marker) {
    return {
      label: marker.text,
      activityId,
      messageIndex: options.messageIndex,
      expanded: false
    };
  }

  return undefined;
}

function getReadActivityPath(activity: Activity, bodyText: string): string | undefined {
  if (activity.kind !== 'tool_execution' || typeof activity.title !== 'string' || containsAnsiEscape(bodyText)) {
    return undefined;
  }

  return parseReadActivityPath(activity.title);
}

function renderHighlightedActivityCodeInto(
  element: HTMLElement,
  bodyText: string,
  filePath: string
): void {
  if (!renderHighlightedCodeInto(element, bodyText, filePath)) {
    element.textContent = bodyText;
  }
}

function renderAnsiActivityCodeInto(
  element: HTMLElement,
  bodyText: string,
  outputColors: boolean
): void {
  renderAnsiTextInto(element, bodyText, outputColors);
}

type TruncationMarker = {
  before: string;
  text: string;
  after: string;
};

function removeTruncationMarker(marker: TruncationMarker): string {
  const before = marker.before.endsWith('\n') ? marker.before.slice(0, -1) : marker.before;
  const after = marker.after.startsWith('\n') ? marker.after.slice(1) : marker.after;

  if (before && after) {
    return `${before}\n${after}`;
  }

  return before || after;
}

function findTruncationMarker(value: string): TruncationMarker | undefined {
  const markerPattern = /^\.\.\. \((?:\d+ (?:more|earlier)[^)]+|output truncated)\)$/m;
  const match = markerPattern.exec(value);

  if (!match || match.index === undefined) {
    return undefined;
  }

  const text = match[0];
  const markerStart = match.index;
  const markerEnd = markerStart + text.length;

  return {
    before: value.slice(0, markerStart),
    text,
    after: value.slice(markerEnd)
  };
}

function shouldScrollExpandedBodyToBottom(collapsedBody: string): boolean {
  const marker = findTruncationMarker(collapsedBody);
  return Boolean(marker && marker.before.length === 0);
}

function scheduleActivityBodyScrollToBottom(element: HTMLElement): void {
  const scroll = () => {
    element.scrollTop = element.scrollHeight;
  };

  requestAnimationFrame(() => {
    scroll();
    requestAnimationFrame(scroll);
  });
  setTimeout(scroll, 80);
  setTimeout(scroll, 220);
}

function scheduleActivityBodyOverflowToggle(
  wrap: HTMLElement,
  body: HTMLElement,
  bodyToggle: ActivityBodyToggle
): void {
  const appendIfOverflowing = () => {
    if (!wrap.isConnected || wrap.querySelector('[data-activity-body-toggle]')) {
      return;
    }

    if (body.scrollHeight > body.clientHeight + 1) {
      wrap.append(createActivityBodyToggle(bodyToggle));
    }
  };

  requestAnimationFrame(() => {
    appendIfOverflowing();
    requestAnimationFrame(appendIfOverflowing);
  });
  setTimeout(appendIfOverflowing, 80);
  setTimeout(appendIfOverflowing, 220);
}

function createActivityBodyToggle({
  label,
  activityId,
  messageIndex,
  expanded
}: ActivityBodyToggle): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'activity__body-toggle';
  button.type = 'button';
  button.textContent = label;
  button.title = expanded ? 'Collapse output' : 'Show full output';
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  button.dataset.activityBodyToggle = activityId;

  if (typeof messageIndex === 'number') {
    button.dataset.messageIndex = String(messageIndex);
  }

  return button;
}

function parseReadActivityPath(title: string): string | undefined {
  const match = title.match(/^read\s+(.+?)(?::\d+(?:-\d+)?)?$/);
  return match?.[1];
}

function shouldKeepActivityOpen(activity: Activity): boolean {
  return typeof activity.body === 'string' && activity.body.length > 0;
}

function roleLabel(role: string): string {
  if (role === 'user') {
    return 'You';
  }

  if (role === 'assistant') {
    return 'Pi';
  }

  return 'System';
}

function activityStatusLabel(status: string | undefined): string {
  if (status === 'running') {
    return 'Running';
  }

  if (status === 'completed') {
    return 'Done';
  }

  if (status === 'error') {
    return 'Error';
  }

  return 'Info';
}
