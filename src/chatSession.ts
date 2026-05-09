export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  error?: boolean;
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
  private busy = false;
  private sessionGeneration = 0;
  private readonly transcript: ChatMessage[] = [];

  public get generation(): number {
    return this.sessionGeneration;
  }

  public get isBusy(): boolean {
    return this.busy;
  }

  public snapshot(): ChatState {
    return {
      messages: this.transcript.map((message) => ({ ...message })),
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
    this.transcript.length = 0;
    this.activeAssistantIndex = undefined;
    this.busy = false;
  }

  public handleAgentStart(): void {
    this.busy = true;
  }

  public handleAgentEnd(): void {
    this.busy = false;
    this.activeAssistantIndex = undefined;
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
}
