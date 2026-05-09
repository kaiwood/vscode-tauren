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
  code?: boolean;
};

export type ChatActivityInput = Omit<ChatActivity, 'id'>;
export type ChatActivityBodyMode = 'replace' | 'append';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  error?: boolean;
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
  private readonly transcript: ChatMessage[] = [];

  public get generation(): number {
    return this.sessionGeneration;
  }

  public get isBusy(): boolean {
    return this.busy;
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
    this.busy = false;
  }

  public handleAgentStart(): void {
    this.busy = true;
  }

  public handleAgentEnd(): void {
    this.busy = false;
    this.activeAssistantIndex = undefined;
    this.activeActivityIds.clear();
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
    this.transcript[index].text = message;
    this.transcript[index].error = true;
  }

  public addActivity(activity: ChatActivityInput): string {
    const id = this.nextActivityId();
    const index = this.ensureActiveAssistantMessage();
    const message = this.transcript[index];
    message.activities ??= [];
    message.activities.push({ id, ...activity });

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
      message.activities.push({ id, ...activity });
      return id;
    }

    message.activities[existingIndex] = mergeActivity(
      message.activities[existingIndex],
      activity,
      bodyMode
    );

    return id;
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

    this.transcript.push({ role: 'system', text: message, error: true });
  }

  private ensureActiveAssistantMessage(): number {
    if (this.activeAssistantIndex !== undefined) {
      return this.activeAssistantIndex;
    }

    this.activeAssistantIndex = this.transcript.push({ role: 'assistant', text: '' }) - 1;
    return this.activeAssistantIndex;
  }

  private nextActivityId(): string {
    this.activitySequence += 1;
    return `activity-${this.sessionGeneration}-${this.activitySequence}`;
  }
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
    next.summary = activity.summary;
  }

  if ('body' in activity) {
    next.body = bodyMode === 'append'
      ? `${existing.body ?? ''}${activity.body ?? ''}`
      : activity.body;
  }

  if ('code' in activity) {
    next.code = activity.code;
  }

  return next;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  const clone: ChatMessage = { ...message };

  if (message.activities) {
    clone.activities = message.activities.map((activity) => ({ ...activity }));
  }

  return clone;
}
