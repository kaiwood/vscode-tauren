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
import { createSdkExtensionUiContext } from './extensionUiBridge';
import { mapSdkExtensionErrorToRpcEvent, mapSdkSessionEventToRpcEvent } from './piSdkEventMapper';
import { loadPiSdk, type PiSdkLoader, type PiSdkModule } from './piSdkLoader';

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
  private unsubscribeSession: (() => void) | undefined;
  private disposed = false;
  private reportedCustomPiPathWarning = false;
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

  public async prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior): Promise<void> {
    const { session } = await this.ensureRuntime();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleSuccess = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };
      const settleError = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      void session.prompt(message, {
        ...(streamingBehavior ? { streamingBehavior } : {}),
        source: 'rpc',
        preflightResult: (success) => {
          if (success) {
            settleSuccess();
          } else {
            settleError(new Error('Pi SDK prompt preflight failed.'));
          }
        }
      }).then(settleSuccess, settleError);
    });
  }

  public async abort(): Promise<void> {
    const { session } = await this.ensureRuntime();
    await session.abort();
  }

  public async reload(): Promise<void> {
    const runtime = await this.ensureRuntime();
    await runtime.session.reload();
    await this.bindRuntime(runtime);
  }

  public async getState(): Promise<PiSessionState> {
    const { session } = await this.ensureRuntime();

    const state: PiSessionState = {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount
    };
    return state;
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const { session } = await this.ensureRuntime();
    const stats: PiSessionStats = {
      ...session.getSessionStats(),
      sessionName: session.sessionName
    };
    return stats;
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    const { session } = await this.ensureRuntime();
    return { models: session.modelRegistry.getAvailable() };
  }

  public async getCommands(): Promise<PiAvailableCommands> {
    const { session } = await this.ensureRuntime();
    const commands: NonNullable<PiAvailableCommands['commands']> = [];

    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({
        name: command.invocationName,
        description: command.description,
        source: 'extension',
        sourceInfo: command.sourceInfo
      });
    }

    for (const template of session.promptTemplates) {
      commands.push({
        name: template.name,
        description: template.description,
        source: 'prompt',
        sourceInfo: template.sourceInfo
      });
    }

    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: 'skill',
        sourceInfo: skill.sourceInfo
      });
    }

    return { commands };
  }

  public async setModel(provider: string, modelId: string): Promise<PiModel> {
    const { session } = await this.ensureRuntime();
    const model = session.modelRegistry.getAvailable().find((candidate) => (
      candidate.provider === provider && candidate.id === modelId
    ));

    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }

    await session.setModel(model);
    return model;
  }

  public async setThinkingLevel(level: string): Promise<void> {
    const { session } = await this.ensureRuntime();
    session.setThinkingLevel(level as Parameters<typeof session.setThinkingLevel>[0]);
  }

  public async setSessionName(name: string): Promise<void> {
    const { session } = await this.ensureRuntime();
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error('Session name cannot be empty');
    }

    session.setSessionName(trimmedName);
  }

  public async compact(customInstructions?: string): Promise<PiCompactResult> {
    const { session } = await this.ensureRuntime();
    return await session.compact(customInstructions) as PiCompactResult;
  }

  public async exportHtml(outputPath?: string): Promise<PiExportHtmlResult> {
    const { session } = await this.ensureRuntime();
    return { path: await session.exportToHtml(outputPath) };
  }

  public async getLastAssistantText(): Promise<PiLastAssistantText> {
    const { session } = await this.ensureRuntime();
    return { text: session.getLastAssistantText() ?? null };
  }

  public async getMessages(): Promise<PiMessagesResult> {
    const { session } = await this.ensureRuntime();
    return { messages: session.messages as PiMessagesResult['messages'] };
  }

  public async switchSession(sessionPath: string): Promise<PiSwitchSessionResult> {
    const runtime = await this.ensureRuntime();
    return await runtime.switchSession(sessionPath);
  }

  public async navigateTree(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string } = {}
  ): Promise<PiNavigateTreeResult> {
    const { session } = await this.ensureRuntime();
    return await session.navigateTree(entryId, {
      summarize: options.summarize ?? false,
      ...(options.customInstructions ? { customInstructions: options.customInstructions } : {})
    });
  }

  public async getForkMessages(): Promise<PiForkMessagesResult> {
    const { session } = await this.ensureRuntime();
    return { messages: session.getUserMessagesForForking() };
  }

  public async fork(entryId: string): Promise<PiForkResult> {
    const runtime = await this.ensureRuntime();
    const result = await runtime.fork(entryId);

    return {
      text: result.selectedText,
      cancelled: result.cancelled
    };
  }

  public async clone(): Promise<PiCloneResult> {
    const runtime = await this.ensureRuntime();
    const leafId = runtime.session.sessionManager.getLeafId();

    if (!leafId) {
      throw new Error('Cannot clone session: no current entry selected');
    }

    return await runtime.fork(leafId, { position: 'at' });
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
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
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

    if (!this.runtimePromise) {
      const runtimePromise = this.createRuntime().catch((error) => {
        if (this.runtimePromise === runtimePromise) {
          this.runtimePromise = undefined;
        }
        throw error;
      });
      this.runtimePromise = runtimePromise;
    }

    this.runtime = await this.runtimePromise;
    return this.runtime;
  }

  private async createRuntime(): Promise<AgentSessionRuntime> {
    this.reportIgnoredPiPathIfNeeded();
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

    runtime.setRebindSession(async () => {
      this.reportRuntimeDiagnostics(runtime);
      await this.bindRuntime(runtime);
    });
    this.reportRuntimeDiagnostics(runtime);
    await this.bindRuntime(runtime);
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

  private async bindRuntime(runtime: AgentSessionRuntime): Promise<void> {
    const { session } = runtime;

    await session.bindExtensions({
      uiContext: createSdkExtensionUiContext(this.options.extensionUi),
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: (options) => runtime.newSession(options),
        fork: async (entryId, options) => {
          const result = await runtime.fork(entryId, options);
          return { cancelled: result.cancelled };
        },
        navigateTree: (targetId, options) => session.navigateTree(targetId, {
          summarize: options?.summarize,
          customInstructions: options?.customInstructions,
          replaceInstructions: options?.replaceInstructions,
          label: options?.label
        }),
        switchSession: (sessionPath, options) => runtime.switchSession(sessionPath, options),
        reload: async () => {
          await session.reload();
          await this.bindRuntime(runtime);
        }
      },
      onError: (error) => {
        this.emitEvent(mapSdkExtensionErrorToRpcEvent(error));
      }
    });

    this.unsubscribeSession?.();
    this.unsubscribeSession = session.subscribe((event) => {
      this.emitEvent(mapSdkSessionEventToRpcEvent(event));
    });
  }

  private loadSdk(): Promise<PiSdkModule> {
    return (this.options.loadSdk ?? loadPiSdk)();
  }

  private reportIgnoredPiPathIfNeeded(): void {
    if (!this.options.piPath || this.reportedCustomPiPathWarning) {
      return;
    }

    this.reportedCustomPiPathWarning = true;
    this.notify('Tau SDK mode uses the bundled Pi SDK and ignores tau.piPath.', 'warning');
  }

  private reportRuntimeDiagnostics(runtime: AgentSessionRuntime): void {
    if (runtime.modelFallbackMessage) {
      this.notify(runtime.modelFallbackMessage, 'warning');
    }

    for (const diagnostic of runtime.diagnostics) {
      if (diagnostic.type === 'error') {
        this.emitError(diagnostic.message);
      } else {
        this.notify(diagnostic.message, diagnostic.type);
      }
    }
  }

  private notify(message: string, notifyType: string): void {
    this.options.showNotification?.(message, notifyType);
  }

  private emitEvent(event: RpcEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
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
