import type { ExtensionUiRequestUi } from '../extensionUi/requestHandler';
import type { PiRpcClientLike } from '../rpc/clientTypes';
import type {
  ExtensionUiResponse,
  PiAvailableCommands,
  PiAvailableModels,
  PiCloneResult,
  PiCompactResult,
  PiExportHtmlResult,
  PiForkMessagesResult,
  PiForkResult,
  PiLastAssistantText,
  PiMessagesResult,
  PiModel,
  PiNavigateTreeResult,
  PiPromptStreamingBehavior,
  PiRpcClientOptions,
  PiSessionState,
  PiSessionStats,
  PiSwitchSessionResult,
  RpcEvent
} from '../rpc/types';
import type { AgentSessionRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { loadPiSdk, type PiSdkLoader, type PiSdkModule } from './piSdkLoader';

const unavailableMessage = 'Pi SDK integration is not available yet.';
const sdkDisposedMessage = 'Pi SDK client disposed.';
const sessionDirEnvVar = 'PI_CODING_AGENT_SESSION_DIR';

export type PiSdkClientOptions = PiRpcClientOptions & {
  extensionUi?: ExtensionUiRequestUi;
  loadSdk?: PiSdkLoader;
  showNotification?: (message: string, notifyType: string) => void;
};

export class PiSdkClient implements PiRpcClientLike {
  private runtime: AgentSessionRuntime | undefined;
  private runtimePromise: Promise<AgentSessionRuntime> | undefined;
  private disposed = false;
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: PiSdkClientOptions = {}) {}

  public isRunning(): boolean {
    return !this.disposed && Boolean(this.runtime || this.runtimePromise);
  }

  public onEvent(listener: (event: RpcEvent) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);

    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public prompt(_message: string, _streamingBehavior?: PiPromptStreamingBehavior): Promise<void> {
    return this.unavailable();
  }

  public abort(): Promise<void> {
    return this.unavailable();
  }

  public reload(): Promise<void> {
    return this.unavailable();
  }

  public getState(): Promise<PiSessionState> {
    return this.unavailable();
  }

  public getSessionStats(): Promise<PiSessionStats> {
    return this.unavailable();
  }

  public getAvailableModels(): Promise<PiAvailableModels> {
    return this.unavailable();
  }

  public getCommands(): Promise<PiAvailableCommands> {
    return this.unavailable();
  }

  public setModel(_provider: string, _modelId: string): Promise<PiModel> {
    return this.unavailable();
  }

  public setThinkingLevel(_level: string): Promise<void> {
    return this.unavailable();
  }

  public setSessionName(_name: string): Promise<void> {
    return this.unavailable();
  }

  public compact(_customInstructions?: string): Promise<PiCompactResult> {
    return this.unavailable();
  }

  public exportHtml(_outputPath?: string): Promise<PiExportHtmlResult> {
    return this.unavailable();
  }

  public getLastAssistantText(): Promise<PiLastAssistantText> {
    return this.unavailable();
  }

  public getMessages(): Promise<PiMessagesResult> {
    return this.unavailable();
  }

  public switchSession(_sessionPath: string): Promise<PiSwitchSessionResult> {
    return this.unavailable();
  }

  public navigateTree(
    _entryId: string,
    _options: { summarize?: boolean; customInstructions?: string } = {}
  ): Promise<PiNavigateTreeResult> {
    return this.unavailable();
  }

  public getForkMessages(): Promise<PiForkMessagesResult> {
    return this.unavailable();
  }

  public fork(_entryId: string): Promise<PiForkResult> {
    return this.unavailable();
  }

  public clone(): Promise<PiCloneResult> {
    return this.unavailable();
  }

  public respondExtensionUiRequest(_response: ExtensionUiResponse): Promise<void> {
    return Promise.resolve();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const runtime = this.runtime;
    this.runtime = undefined;
    this.runtimePromise = undefined;
    void runtime?.dispose().catch((error: unknown) => {
      this.emitError(`Pi SDK dispose failed: ${getErrorMessage(error)}`);
    });
  }

  private async ensureRuntime(): Promise<AgentSessionRuntime> {
    if (this.disposed) {
      throw new Error(sdkDisposedMessage);
    }

    if (this.runtime) {
      return this.runtime;
    }

    this.runtimePromise ??= this.createRuntime();
    this.runtime = await this.runtimePromise;
    return this.runtime;
  }

  private async createRuntime(): Promise<AgentSessionRuntime> {
    const sdk = await this.loadSdk();
    const cwd = this.options.cwd ?? process.cwd();
    const agentDir = sdk.getAgentDir();
    const sessionManager = this.createSessionManager(sdk, cwd, agentDir);
    const runtime = await sdk.createAgentSessionRuntime(async (runtimeOptions) => {
      const services = await sdk.createAgentSessionServices({
        cwd: runtimeOptions.cwd,
        agentDir: runtimeOptions.agentDir
      });
      const created = await sdk.createAgentSessionFromServices({
        services,
        sessionManager: runtimeOptions.sessionManager,
        sessionStartEvent: runtimeOptions.sessionStartEvent
      });

      return {
        ...created,
        services,
        diagnostics: services.diagnostics
      };
    }, {
      cwd: sessionManager.getCwd(),
      agentDir,
      sessionManager
    });

    if (this.disposed) {
      await runtime.dispose();
      throw new Error(sdkDisposedMessage);
    }

    return runtime;
  }

  private createSessionManager(sdk: PiSdkModule, cwd: string, agentDir: string): SessionManager {
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir);
    const sessionDir = process.env[sessionDirEnvVar] || settingsManager.getSessionDir();

    if (this.options.sessionFile) {
      return sdk.SessionManager.open(this.options.sessionFile, sessionDir);
    }

    return sdk.SessionManager.create(cwd, sessionDir);
  }

  private loadSdk(): Promise<PiSdkModule> {
    return (this.options.loadSdk ?? loadPiSdk)();
  }

  private unavailable<T>(): Promise<T> {
    void this.ensureRuntime().catch((error: unknown) => {
      this.emitError(`Pi SDK startup failed: ${getErrorMessage(error)}`);
    });
    return Promise.reject(new Error(unavailableMessage));
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
