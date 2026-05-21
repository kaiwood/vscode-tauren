export const chatActivityBodyMaxDisplayLength = 20000;
export const chatActivitySummaryMaxDisplayLength = 300;
export const chatErrorMaxDisplayLength = 6000;
export const chatTruncationMarker = '\n...[truncated]';

export type ChatActivityStatus = 'running' | 'completed' | 'error' | 'info';

export type ChatActivityKind =
  | 'agent'
  | 'compaction'
  | 'extension_error'
  | 'extension_ui'
  | 'message'
  | 'queue'
  | 'retry'
  | 'rpc'
  | 'thinking'
  | 'tool_call'
  | 'tool_execution'
  | 'turn';

export type ChatActivity = {
  id: string;
  kind: ChatActivityKind;
  title: string;
  status: ChatActivityStatus;
  summary?: string;
  body?: string;
  expandedBody?: string;
  code?: boolean;
};

export type ChatActivityInput = Omit<ChatActivity, 'id'>;
export type ChatActivityBodyMode = 'replace' | 'append';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  error?: boolean;
  variant?: 'thinking' | 'branchSummary' | 'compactionSummary';
  activities?: ChatActivity[];
};

export type ChatState = {
  messages: ChatMessage[];
  busy: boolean;
};

export type SubmittedPrompt = {
  text: string;
  sessionGeneration: number;
};

export class ChatSession {
  private activeAssistantIndex: number | undefined;
  private activitySequence = 0;
  private busy = false;
  private sessionGeneration = 0;
  private readonly activeActivityIds = new Map<string, string>();
  private readonly activeThinkingIndexes = new Map<string, number>();
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

  public beginSubmit(text: string): SubmittedPrompt | undefined {
    const trimmedText = text.trim();

    if (!trimmedText || this.busy) {
      return undefined;
    }

    this.transcript.push({ role: 'user', text: trimmedText });
    this.activeAssistantIndex = this.transcript.push({ role: 'assistant', text: '' }) - 1;
    this.busy = true;

    return {
      text: trimmedText,
      sessionGeneration: this.sessionGeneration
    };
  }

  public startNewSession(): void {
    this.sessionGeneration += 1;
    this.activitySequence = 0;
    this.transcript.length = 0;
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
    this.activeThinkingIndexes.clear();
    this.busy = false;
  }

  public replaceMessages(messages: ChatMessage[]): void {
    this.activitySequence = 0;
    this.transcript.length = 0;
    this.transcript.push(...messages.map(cloneMessage));
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

  public setBusy(busy: boolean): void {
    this.busy = busy;
  }

  public appendAssistantDelta(delta: string): boolean {
    if (!delta) {
      return false;
    }

    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text += delta;
    return true;
  }

  public markActiveAssistantError(message: string): void {
    const index = this.ensureActiveAssistantMessage();
    this.transcript[index].text = limitErrorMessage(message);
    this.transcript[index].error = true;
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
    return true;
  }

  public finishThinking(sourceId: string, content: string | undefined): boolean {
    let changed = false;

    if (content !== undefined) {
      const index = this.ensureThinkingMessage(sourceId);
      this.transcript[index].text = content;
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
    return true;
  }

  public addActivity(activity: ChatActivityInput): string {
    const id = this.nextActivityId();
    const index = this.ensureActiveAssistantMessage();
    const message = this.transcript[index];
    message.activities ??= [];
    message.activities.push({ id, ...limitActivityDisplay(activity) });

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
      return id;
    }

    message.activities[existingIndex] = mergeActivity(
      message.activities[existingIndex],
      activity,
      bodyMode
    );

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

    this.transcript.push({ role: 'system', text: limitErrorMessage(message), error: true });
  }

  public addSystemMessage(message: string): void {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    this.transcript.push({ role: 'system', text: trimmedMessage });
  }

  private ensureActiveAssistantMessage(): number {
    if (this.activeAssistantIndex !== undefined) {
      const message = this.transcript[this.activeAssistantIndex];

      if (message && message.role === 'assistant' && message.variant !== 'thinking') {
        return this.activeAssistantIndex;
      }
    }

    this.activeAssistantIndex = this.transcript.push({ role: 'assistant', text: '' }) - 1;
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
        this.activeAssistantIndex = undefined;
        return index;
      }
    }

    this.activeAssistantIndex = undefined;
    return this.transcript.push({ role: 'assistant', text: '', variant: 'thinking' }) - 1;
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

  if (message.activities) {
    clone.activities = message.activities.map((activity) => ({ ...activity }));
  }

  return clone;
}
