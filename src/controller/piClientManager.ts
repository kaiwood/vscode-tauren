import type { AgentClientFactory, AgentClient } from '../agent/clientTypes';
import type { ExtensionUi } from '../extensionUi/types';
import type { AgentClientOptions, AgentEvent } from '../agent/types';

type DisposableLike = {
  dispose(): void;
};

export type AgentClientManagerOptions = {
  createClient: AgentClientFactory;
  getCwd?: () => string | undefined;
  getCurrentSessionFile: () => string | undefined;
  getResumeLastSession?: () => boolean | undefined;
  getSessionGeneration: () => number;
  extensionUi?: ExtensionUi;
  onEvent: (event: AgentEvent) => void;
  onError: (message: string) => void;
};

export class AgentClientManager {
  private client: AgentClient | undefined;
  private nextSessionFile: string | undefined;
  private nextResumeLastSession: boolean | undefined;
  private readonly disposables: DisposableLike[] = [];

  public constructor(private readonly options: AgentClientManagerOptions) {}

  public setNextSessionFile(sessionFile: string | undefined): void {
    this.nextSessionFile = sessionFile;
  }

  public setNextResumeLastSession(resumeLastSession: boolean | undefined): void {
    this.nextResumeLastSession = resumeLastSession;
  }

  public getExistingClient(): AgentClient | undefined {
    if (!this.client?.isRunning()) {
      return undefined;
    }

    return this.client;
  }

  public getClient(): AgentClient {
    if (this.client) {
      return this.client;
    }

    const sessionFile = this.nextSessionFile ?? this.options.getCurrentSessionFile();
    const resumeLastSession = this.nextResumeLastSession ?? this.options.getResumeLastSession?.();
    this.nextSessionFile = undefined;
    this.nextResumeLastSession = undefined;

    const clientOptions: AgentClientOptions = { cwd: this.options.getCwd?.() };

    if (this.options.extensionUi) {
      clientOptions.extensionUi = this.options.extensionUi;
    }

    if (sessionFile) {
      clientOptions.sessionFile = sessionFile;
    }

    if (resumeLastSession !== undefined) {
      clientOptions.resumeLastSession = resumeLastSession;
    }

    const client = this.options.createClient(clientOptions);
    const sessionGeneration = this.options.getSessionGeneration();
    this.client = client;

    this.disposables.push(
      { dispose: client.onEvent((event) => {
        if (sessionGeneration === this.options.getSessionGeneration()) {
          this.options.onEvent(event);
        }
      }) },
      { dispose: client.onError((message) => {
        if (sessionGeneration === this.options.getSessionGeneration()) {
          this.options.onError(message);
        }
      }) }
    );

    return client;
  }

  public disposeClient(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }

    this.client?.dispose();
    this.client = undefined;
  }
}
