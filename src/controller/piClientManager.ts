import type { PiClientFactory, PiClient } from '../pi/clientTypes';
import type { PiClientOptions, PiEvent } from '../pi/types';

type DisposableLike = {
  dispose(): void;
};

export type PiClientManagerOptions = {
  createClient: PiClientFactory;
  getCwd?: () => string | undefined;
  getCurrentSessionFile: () => string | undefined;
  getSessionGeneration: () => number;
  onEvent: (event: PiEvent) => void;
  onError: (message: string) => void;
};

export class PiClientManager {
  private client: PiClient | undefined;
  private nextSessionFile: string | undefined;
  private readonly disposables: DisposableLike[] = [];

  public constructor(private readonly options: PiClientManagerOptions) {}

  public setNextSessionFile(sessionFile: string | undefined): void {
    this.nextSessionFile = sessionFile;
  }

  public getExistingClient(): PiClient | undefined {
    if (!this.client?.isRunning()) {
      return undefined;
    }

    return this.client;
  }

  public getClient(): PiClient {
    if (this.client) {
      return this.client;
    }

    const sessionFile = this.nextSessionFile ?? this.options.getCurrentSessionFile();
    this.nextSessionFile = undefined;

    const clientOptions: PiClientOptions = { cwd: this.options.getCwd?.() };

    if (sessionFile) {
      clientOptions.sessionFile = sessionFile;
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
