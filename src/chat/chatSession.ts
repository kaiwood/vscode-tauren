export const chatActivityBodyMaxDisplayLength = 20000;
export const chatActivitySummaryMaxDisplayLength = 300;
export const chatErrorMaxDisplayLength = 6000;
export const chatTruncationMarker = '\n...[truncated]';

export type ChatActivityStatus = 'running' | 'completed' | 'error' | 'info';

export type ChatActivityKind =
  | 'agent'
  | 'compaction'
  | 'extension_error'
  | 'message'
  | 'queue'
  | 'retry'
  | 'pi'
  | 'thinking'
  | 'tool_call'
  | 'tool_execution'
  | 'turn';

export type ChatImage = {
  type: 'image';
  data: string;
  mimeType: string;
  alt?: string;
};

export type ChatActivity = {
  id: string;
  kind: ChatActivityKind;
  title: string;
  status: ChatActivityStatus;
  summary?: string;
  body?: string;
  expandedBody?: string;
  code?: boolean;
  images?: ChatImage[];
};

export type ChatActivityInput = Omit<ChatActivity, 'id'>;
export type ChatActivityBodyMode = 'replace' | 'append';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  error?: boolean;
  variant?: 'thinking' | 'branchSummary' | 'compactionSummary';
  images?: ChatImage[];
  activities?: ChatActivity[];
};

export type ChatSnapshotMessage = ChatMessage & {
  id: string;
  revision: number;
};

export type ChatState = {
  messages: ChatMessage[];
  busy: boolean;
};

export type ChatSnapshotState = {
  messages: ChatSnapshotMessage[];
  busy: boolean;
};

type ChatMessageMeta = {
  id: string;
  revision: number;
};

export type SubmittedPrompt = {
  text: string;
  sessionGeneration: number;
};

export class ChatSession {
  private activeAssistantIndex: number | undefined;
  private activitySequence = 0;
  private busy = false;
  private messageSequence = 0;
  private sessionGeneration = 0;
  private readonly activeActivityIds = new Map<string, string>();
  private readonly activeThinkingIndexes = new Map<string, number>();
  private readonly messageMeta = new WeakMap<ChatMessage, ChatMessageMeta>();
  private readonly transcript: ChatMessage[] = [];

  public get generation(): number {
    return this.sessionGeneration;
  }

  public get isBusy(): boolean {
    return this.busy;
  }

  public get isEmpty(): boolean {
    return this.transcript.length === 0;
  }

  public snapshot(): ChatState {
    return {
      messages: this.transcript.map(cloneMessage),
      busy: this.busy
    };
  }

  public webviewSnapshot(): ChatSnapshotState {
    return {
      messages: this.transcript.map((message) => cloneSnapshotMessage(message, this.ensureMessageMeta(message))),
      busy: this.busy
    };
  }

  public beginSubmit(text: string, images?: ChatImage[]): SubmittedPrompt | undefined {
    const trimmedText = text.trim();

    if (!trimmedText || this.busy) {
      return undefined;
    }

    this.pushMessage({
      role: 'user',
      text: trimmedText,
      ...(images && images.length > 0 ? { images: images.map((image) => ({ ...image })) } : {})
    });
    this.activeAssistantIndex = this.pushMessage({ role: 'assistant', text: '' });
    this.busy = true;

    return {
      text: trimmedText,
      sessionGeneration: this.sessionGeneration
    };
  }

  public startNewSession(): void {
    this.sessionGeneration += 1;
    this.activitySequence = 0;
    this.messageSequence = 0;
    this.transcript.length = 0;
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
    this.activeThinkingIndexes.clear();
    this.busy = false;
  }

  public replaceMessages(messages: ChatMessage[]): void {
    this.activitySequence = 0;
    this.transcript.length = 0;
    this.transcript.push(...messages.map((message) => this.prepareMessage(cloneMessage(message))));
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
    this.activeThinkingIndexes.clear();
    this.busy = false;
  }

  public handleAgentStart(): void {
    this.busy = true;
  }

  public handleAgentEnd(): void {
    this.busy = false;
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
    this.activeThinkingIndexes.clear();
  }

  public completeActivePrompt(): void {
    if (this.activeAssistantIndex !== undefined && isEmptyAssistantMessage(this.transcript[this.activeAssistantIndex])) {
      this.transcript.splice(this.activeAssistantIndex, 1);
    }

    this.busy = false;
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
    this.activeThinkingIndexes.clear();
  }

  public setBusy(busy: boolean): void {
    this.busy = busy;
  }

  public appendAssistantDelta(delta: string): boolean {
    if (!delta) {
      return false;
    }

    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text += delta;
    this.touchMessage(this.transcript[index]);
    return true;
  }

  public markActiveAssistantError(message: string): void {
    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text = limitErrorMessage(message);
    this.transcript[index].error = true;
    this.touchMessage(this.transcript[index]);
  }

  public startThinking(sourceId: string): boolean {
    if (this.activeThinkingIndexes.has(sourceId)) {
      return false;
    }

    const index = this.createThinkingMessage();
    this.activeThinkingIndexes.set(sourceId, index);
    return true;
  }

  public appendThinkingDelta(sourceId: string, delta: string): boolean {
    if (!delta) {
      return false;
    }

    const index = this.ensureThinkingMessage(sourceId);
    this.transcript[index].text += delta;
    this.touchMessage(this.transcript[index]);
    return true;
  }

  public finishThinking(sourceId: string, content: string | undefined): boolean {
    let changed = false;

    if (content !== undefined) {
      const index = this.ensureThinkingMessage(sourceId);
      this.transcript[index].text = content;
      this.touchMessage(this.transcript[index]);
      changed = true;
    }

    this.activeThinkingIndexes.delete(sourceId);
    return changed;
  }

  public appendAssistantNotice(message: string): boolean {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return false;
    }

    const index = this.ensureActiveAssistantMessage();
    const currentText = this.transcript[index].text;
    this.transcript[index].text = currentText
      ? `${currentText}${currentText.endsWith('\n') ? '\n' : '\n\n'}${trimmedMessage}`
      : trimmedMessage;
    this.touchMessage(this.transcript[index]);
    return true;
  }

  public addActivity(activity: ChatActivityInput): string {
    const id = this.nextActivityId();
    const index = this.ensureActiveAssistantMessage();
    const message = this.transcript[index];
    message.activities ??= [];
    message.activities.push({ id, ...limitActivityDisplay(activity) });
    this.touchMessage(message);

    return id;
  }

  public upsertActivity(
    sourceId: string,
    activity: ChatActivityInput,
    bodyMode: ChatActivityBodyMode = 'replace'
  ): string {
    const index = this.ensureActiveAssistantMessage();
    const message = this.transcript[index];
    message.activities ??= [];

    let id = this.activeActivityIds.get(sourceId);

    if (!id) {
      id = this.nextActivityId();
      this.activeActivityIds.set(sourceId, id);
    }

    const existingIndex = message.activities.findIndex((item) => item.id === id);

    if (existingIndex === -1) {
      message.activities.push({ id, ...limitActivityDisplay(activity) });
      this.touchMessage(message);
      return id;
    }

    message.activities[existingIndex] = mergeActivity(
      message.activities[existingIndex],
      activity,
      bodyMode
    );
    this.touchMessage(message);

    return id;
  }

  public removeActivity(sourceId: string): void {
    const id = this.activeActivityIds.get(sourceId);

    if (!id || this.activeAssistantIndex === undefined) {
      return;
    }

    const message = this.transcript[this.activeAssistantIndex];

    if (message.activities) {
      message.activities = message.activities.filter((activity) => activity.id !== id);

      if (message.activities.length === 0) {
        delete message.activities;
      }

      this.touchMessage(message);
    }

    this.activeActivityIds.delete(sourceId);
  }

  public failActivePrompt(message: string): void {
    this.markActiveAssistantError(message);
    this.busy = false;
    this.activeAssistantIndex = undefined;
  }

  public addErrorMessage(message: string): void {
    if (this.activeAssistantIndex !== undefined) {
      this.markActiveAssistantError(message);
      return;
    }

    this.pushMessage({ role: 'system', text: limitErrorMessage(message), error: true });
  }

  public addSystemMessage(message: string, activities?: ChatActivityInput[]): void {
    const trimmedMessage = message.trim();
    const normalizedActivities = activities?.map((activity) => ({
      id: this.nextActivityId(),
      ...limitActivityDisplay(activity)
    }));

    if (!trimmedMessage && (!normalizedActivities || normalizedActivities.length === 0)) {
      return;
    }

    this.pushMessage({
      role: 'system',
      text: trimmedMessage,
      ...(normalizedActivities && normalizedActivities.length > 0 ? { activities: normalizedActivities } : {})
    });
  }

  private ensureActiveAssistantMessage(): number {
    if (this.activeAssistantIndex !== undefined) {
      const message = this.transcript[this.activeAssistantIndex];

      if (message && message.role === 'assistant' && message.variant !== 'thinking') {
        return this.activeAssistantIndex;
      }
    }

    this.activeAssistantIndex = this.pushMessage({ role: 'assistant', text: '' });
    return this.activeAssistantIndex;
  }

  private ensureThinkingMessage(sourceId: string): number {
    const existingIndex = this.activeThinkingIndexes.get(sourceId);

    if (existingIndex !== undefined && this.transcript[existingIndex]?.variant === 'thinking') {
      return existingIndex;
    }

    const index = this.createThinkingMessage();
    this.activeThinkingIndexes.set(sourceId, index);
    return index;
  }

  private createThinkingMessage(): number {
    if (this.activeAssistantIndex !== undefined) {
      const activeMessage = this.transcript[this.activeAssistantIndex];

      if (isEmptyAssistantMessage(activeMessage)) {
        const index = this.activeAssistantIndex;
        activeMessage.variant = 'thinking';
        this.touchMessage(activeMessage);
        this.activeAssistantIndex = undefined;
        return index;
      }
    }

    this.activeAssistantIndex = undefined;
    return this.pushMessage({ role: 'assistant', text: '', variant: 'thinking' });
  }

  private pushMessage(message: ChatMessage): number {
    return this.transcript.push(this.prepareMessage(message)) - 1;
  }

  private prepareMessage(message: ChatMessage): ChatMessage {
    this.ensureMessageMeta(message);
    return message;
  }

  private ensureMessageMeta(message: ChatMessage): ChatMessageMeta {
    let meta = this.messageMeta.get(message);

    if (!meta) {
      this.messageSequence += 1;
      meta = { id: `message-${this.sessionGeneration}-${this.messageSequence}`, revision: 1 };
      this.messageMeta.set(message, meta);
    }

    return meta;
  }

  private touchMessage(message: ChatMessage | undefined): void {
    if (!message) {
      return;
    }

    this.ensureMessageMeta(message).revision += 1;
  }

  private nextActivityId(): string {
    this.activitySequence += 1;
    return `activity-${this.sessionGeneration}-${this.activitySequence}`;
  }
}

function isEmptyAssistantMessage(message: ChatMessage | undefined): message is ChatMessage {
  if (!message) {
    return false;
  }

  return message.role === 'assistant'
    && message.variant !== 'thinking'
    && !message.text
    && !message.error
    && (!message.images || message.images.length === 0)
    && (!message.activities || message.activities.length === 0);
}

function mergeActivity(
  existing: ChatActivity,
  activity: ChatActivityInput,
  bodyMode: ChatActivityBodyMode
): ChatActivity {
  const next: ChatActivity = {
    ...existing,
    kind: activity.kind,
    title: activity.title,
    status: activity.status
  };

  if ('summary' in activity) {
    next.summary = limitSummary(activity.summary);
  }

  if ('body' in activity) {
    next.body = bodyMode === 'append'
      ? appendActivityBody(existing.body, activity.body)
      : limitActivityBody(activity.body);
  }

  if ('expandedBody' in activity) {
    next.expandedBody = limitActivityBody(activity.expandedBody);
  }

  if ('code' in activity) {
    next.code = activity.code;
  }

  if ('images' in activity) {
    next.images = cloneImages(activity.images);
  }

  return next;
}

function limitActivityDisplay(activity: ChatActivityInput): ChatActivityInput {
  const next: ChatActivityInput = { ...activity };

  if ('summary' in activity) {
    next.summary = limitSummary(activity.summary);
  }

  if ('body' in activity) {
    next.body = limitActivityBody(activity.body);
  }

  if ('expandedBody' in activity) {
    next.expandedBody = limitActivityBody(activity.expandedBody);
  }

  if ('images' in activity) {
    next.images = cloneImages(activity.images);
  }

  return next;
}

function appendActivityBody(existingBody: string | undefined, delta: string | undefined): string {
  const current = existingBody ?? '';

  if (current.length >= chatActivityBodyMaxDisplayLength && current.endsWith(chatTruncationMarker)) {
    return current;
  }

  return limitActivityBody(`${current}${delta ?? ''}`) ?? '';
}

function limitActivityBody(value: string | undefined): string | undefined {
  return limitDisplayText(value, chatActivityBodyMaxDisplayLength);
}

function limitSummary(value: string | undefined): string | undefined {
  return limitDisplayText(value, chatActivitySummaryMaxDisplayLength);
}

function limitErrorMessage(value: string): string {
  return limitDisplayText(value, chatErrorMaxDisplayLength) ?? '';
}

function limitDisplayText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length <= maxLength) {
    return value;
  }

  const keptLength = Math.max(0, maxLength - chatTruncationMarker.length);
  return `${value.slice(0, keptLength)}${chatTruncationMarker}`;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  const clone: ChatMessage = { ...message };

  if (message.images) {
    clone.images = cloneImages(message.images);
  }

  if (message.activities) {
    clone.activities = message.activities.map((activity) => ({
      ...activity,
      ...(activity.images ? { images: cloneImages(activity.images) } : {})
    }));
  }

  return clone;
}

function cloneSnapshotMessage(message: ChatMessage, meta: ChatMessageMeta): ChatSnapshotMessage {
  return {
    ...cloneMessage(message),
    id: meta.id,
    revision: meta.revision
  };
}

function cloneImages(images: ChatImage[] | undefined): ChatImage[] | undefined {
  return images?.map((image) => ({ ...image }));
}
