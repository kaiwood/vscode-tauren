import * as os from 'node:os';
import * as path from 'node:path';
import type { ExtensionUi } from '../extensionUi/types';
import type { PiClient } from '../pi/clientTypes';
import type {
  PiAuthActionResult,
  PiAuthProvider,
  PiAuthProvidersResult,
  PiAuthSource,
  PiAvailableCommands,
  PiAvailableModels,
  PiCloneResult,
  PiCompactResult,
  PiExportHtmlResult,
  PiForkMessagesResult,
  PiForkResult,
  PiImageContent,
  PiLastAssistantText,
  PiMessagesResult,
  PiModel,
  PiNavigateTreeResult,
  PiOAuthLoginCallbacks,
  PiPromptStreamingBehavior,
  PiClientOptions,
  PiSessionState,
  PiSessionStats,
  PiStartupResources,
  PiSwitchSessionResult,
  PiEvent
} from '../pi/types';
import type { AgentSessionRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { PiSettingId, SettingValue } from '../settings/settingsRegistry';
import { createSdkExtensionUiContext } from './extensionUiBridge';
import { PiSdkRenderer } from './piSdkRendering';
import { mapSdkExtensionErrorToPiEvent, mapSdkSessionEventToPiEvent } from './piSdkEventMapper';
import { flattenPiSessionTree, type FlattenableSessionTreeNode } from '../sessions/piSessionTree';
import { loadPiSdk, type PiSdkLoader, type PiSdkModule } from './piSdkLoader';
import { assertPiStartupCwd } from '../workspace/cwdSafety';
import { createWorkspaceMutationGuardTools } from './workspaceMutationGuard';
import { isBuiltInApiKeyProvider, isBuiltInOAuthProvider } from '../auth/builtinProviderMetadata';

const sdkDisposedMessage = 'Pi SDK client disposed.';
const sessionDirEnvVar = 'PI_CODING_AGENT_SESSION_DIR';

export type PiSdkClientOptions = PiClientOptions & {
  extensionUi?: ExtensionUi;
  loadSdk?: PiSdkLoader;
  showNotification?: (message: string, notifyType: string) => void;
  rejectEditWriteOutsideWorkspace?: boolean | (() => boolean);
};

export class PiSdkClient implements PiClient {
  private runtime: AgentSessionRuntime | undefined;
  private settingsManager: SettingsManager | undefined;
  private runtimePromise: Promise<AgentSessionRuntime> | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private disposed = false;
  private promptSawAgentStart = false;
  private readonly eventListeners = new Set<(event: PiEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly renderer = new PiSdkRenderer(() => this.options.extensionUi?.getToolsExpanded?.() ?? false);

  public constructor(private readonly options: PiSdkClientOptions = {}) {}

  public isRunning(): boolean {
    return !this.disposed && Boolean(this.runtime || this.runtimePromise);
  }

  public onEvent(listener: (event: PiEvent) => void): () => void {
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

  public async prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior, images?: PiImageContent[]): Promise<void> {
    const { session } = await this.ensureRuntime();

    this.promptSawAgentStart = false;

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
        ...(images && images.length > 0 ? { images } : {}),
        // Preserve Pi extension compatibility: Tauren historically reached Pi through RPC,
        // and extensions may branch on the upstream input source literal.
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

    if (!this.promptSawAgentStart && !session.isStreaming) {
      this.emitEvent({ type: 'prompt_handled' });
    }
  }

  public async abort(): Promise<void> {
    const { session } = await this.ensureRuntime();
    await session.abort();
  }

  public async reload(): Promise<void> {
    const runtime = await this.ensureRuntime();
    await this.reloadRuntime(runtime);
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
      autoRetryEnabled: session.autoRetryEnabled,
      ...this.getRuntimeSettingsState(),
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount
    };
    return state;
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const { session } = await this.ensureRuntime();
    const stats: PiSessionStats = {
      ...session.getSessionStats(),
      sessionName: session.sessionName,
      usingSubscription: session.model ? session.modelRegistry.isUsingOAuth(session.model) : false,
      autoCompactionEnabled: session.autoCompactionEnabled
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

  public async getStartupResources(): Promise<PiStartupResources> {
    const { session, cwd } = await this.ensureRuntime();
    const sections: NonNullable<PiStartupResources['sections']> = [];
    const resourceLoader = session.resourceLoader;
    const contextFiles = resourceLoader.getAgentsFiles().agentsFiles;

    if (contextFiles.length > 0) {
      sections.push({
        name: 'Context',
        items: contextFiles.map((contextFile) => formatContextResourcePath(contextFile.path, cwd))
      });
    }

    const skills = resourceLoader.getSkills().skills;
    if (skills.length > 0) {
      sections.push({
        name: 'Skills',
        items: sortStartupResourceLabels(skills.map((skill) => skill.name))
      });
    }

    const templates = session.promptTemplates;
    if (templates.length > 0) {
      sections.push({
        name: 'Prompts',
        items: sortStartupResourceLabels(templates.map((template) => `/${template.name}`))
      });
    }

    const extensions = resourceLoader.getExtensions().extensions.map((extension) => ({
      path: extension.path,
      sourceInfo: extension.sourceInfo
    }));
    if (extensions.length > 0) {
      sections.push({
        name: 'Extensions',
        items: sortStartupResourceLabels(getCompactExtensionLabels(extensions))
      });
    }

    const customThemes = resourceLoader.getThemes().themes.filter((theme) => theme.sourcePath);
    if (customThemes.length > 0) {
      sections.push({
        name: 'Themes',
        items: sortStartupResourceLabels(customThemes.map((theme) => (
          theme.name ?? getCompactPathLabel(theme.sourcePath ?? '', theme.sourceInfo)
        )))
      });
    }

    return { sections };
  }

  public async getAuthProviders(): Promise<PiAuthProvidersResult> {
    const { session } = await this.ensureRuntime();
    const { authStorage } = session.modelRegistry;
    authStorage.reload();

    const oauthProviders = authStorage
      .getOAuthProviders()
      .filter((provider) => isBuiltInOAuthProvider(provider.id));
    const providers: PiAuthProvider[] = oauthProviders.map((provider) => this.createAuthProvider({
      id: provider.id,
      name: provider.name,
      authType: 'oauth',
      usesCallbackServer: provider.usesCallbackServer
    }));

    const seenApiKeyProviders = new Set<string>();
    for (const model of session.modelRegistry.getAll()) {
      const providerId = typeof model.provider === 'string' ? model.provider : '';
      if (!providerId || seenApiKeyProviders.has(providerId) || !isBuiltInApiKeyProvider(providerId)) {
        continue;
      }

      seenApiKeyProviders.add(providerId);
      providers.push(this.createAuthProvider({
        id: providerId,
        name: session.modelRegistry.getProviderDisplayName(providerId),
        authType: 'api_key'
      }));
    }

    providers.sort((left, right) => left.name.localeCompare(right.name) || left.authType.localeCompare(right.authType));
    return { providers };
  }

  public async loginWithApiKey(providerId: string, apiKey: string): Promise<PiAuthActionResult> {
    const { session } = await this.ensureRuntime();

    if (!isBuiltInApiKeyProvider(providerId)) {
      throw new Error(`API-key login is not supported for provider: ${providerId}`);
    }

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      throw new Error('API key cannot be empty.');
    }

    session.modelRegistry.authStorage.set(providerId, { type: 'api_key', key: trimmedKey });
    session.modelRegistry.refresh();
    return {
      providerId,
      message: `Saved API key for ${session.modelRegistry.getProviderDisplayName(providerId)}.`
    };
  }

  public async loginWithOAuth(providerId: string, callbacks: PiOAuthLoginCallbacks): Promise<PiAuthActionResult> {
    const { session } = await this.ensureRuntime();
    const provider = session.modelRegistry.authStorage
      .getOAuthProviders()
      .find((candidate) => candidate.id === providerId && isBuiltInOAuthProvider(candidate.id));

    if (!provider) {
      throw new Error(`Subscription login is not supported for provider: ${providerId}`);
    }

    await session.modelRegistry.authStorage.login(providerId, callbacks);
    session.modelRegistry.refresh();
    return {
      providerId,
      message: `Logged in to ${provider.name}.`
    };
  }

  public async logoutAuthProvider(providerId: string): Promise<PiAuthActionResult> {
    const { session } = await this.ensureRuntime();
    const credential = session.modelRegistry.authStorage.get(providerId);

    if (!credential) {
      throw new Error('No stored credentials to remove. Environment variables and models.json config are unchanged.');
    }

    const providerName = session.modelRegistry.getProviderDisplayName(providerId);
    session.modelRegistry.authStorage.logout(providerId);
    session.modelRegistry.refresh();
    return {
      providerId,
      message: credential.type === 'oauth'
        ? `Logged out of ${providerName}.`
        : `Removed stored API key for ${providerName}. Environment variables and models.json config are unchanged.`
    };
  }

  private createAuthProvider(input: {
    id: string;
    name: string;
    authType: 'oauth' | 'api_key';
    usesCallbackServer?: boolean;
  }): PiAuthProvider {
    const runtime = this.runtime;
    if (!runtime) {
      throw new Error('Pi SDK runtime is not available.');
    }

    const { authStorage } = runtime.session.modelRegistry;
    const status = runtime.session.modelRegistry.getProviderAuthStatus(input.id);
    const credential = authStorage.get(input.id);
    const source = isPiAuthSource(status.source) ? status.source : undefined;
    const storedCredentialMatches = credential?.type === input.authType;
    const configured = input.authType === 'oauth'
      ? storedCredentialMatches
      : credential?.type === 'oauth'
        ? false
        : Boolean(status.configured);

    return {
      id: input.id,
      name: input.name,
      authType: input.authType,
      configured,
      ...(source && configured ? { source } : {}),
      ...(typeof status.label === 'string' && configured ? { label: status.label } : {}),
      ...(storedCredentialMatches ? { storedCredentialType: credential.type } : {}),
      canLogout: storedCredentialMatches,
      ...(input.usesCallbackServer !== undefined ? { usesCallbackServer: input.usesCallbackServer } : {})
    };
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

  public async updateRuntimeSetting(settingId: PiSettingId, value: SettingValue): Promise<{ applied: 'live' | 'reload'; message?: string }> {
    const runtime = await this.ensureRuntime();
    const { session } = runtime;

    switch (settingId) {
      case 'defaultProvider': {
        const provider = this.requireString(value, settingId);
        this.getSettingsManager().setDefaultProvider(provider);
        await this.flushSettings();
        return { applied: 'reload', message: 'Saved for new Pi sessions.' };
      }
      case 'defaultModel': {
        const modelRef = this.parseModelReference(this.requireString(value, settingId));
        const model = session.modelRegistry.getAvailable().find((candidate) => (
          candidate.provider === modelRef.provider && candidate.id === modelRef.modelId
        ));

        if (!model) {
          throw new Error(`Model not found: ${modelRef.provider}/${modelRef.modelId}`);
        }

        await session.setModel(model);
        await this.flushSettings();
        return { applied: 'live', message: 'Model updated for this session.' };
      }
      case 'defaultThinkingLevel': {
        const level = this.requireString(value, settingId);
        session.setThinkingLevel(level as Parameters<typeof session.setThinkingLevel>[0]);
        await this.flushSettings();
        return { applied: 'live', message: 'Thinking level updated for this session.' };
      }
      case 'compaction.enabled':
        session.setAutoCompactionEnabled(this.requireBoolean(value, settingId));
        await this.flushSettings();
        return { applied: 'live', message: 'Auto-compaction updated.' };
      case 'retry.enabled':
        session.setAutoRetryEnabled(this.requireBoolean(value, settingId));
        await this.flushSettings();
        return { applied: 'live', message: 'Auto-retry updated.' };
      case 'steeringMode': {
        const mode = this.requireString(value, settingId);
        session.setSteeringMode(mode as Parameters<typeof session.setSteeringMode>[0]);
        await this.flushSettings();
        return { applied: 'live', message: 'Steering delivery updated.' };
      }
      case 'followUpMode': {
        const mode = this.requireString(value, settingId);
        session.setFollowUpMode(mode as Parameters<typeof session.setFollowUpMode>[0]);
        await this.flushSettings();
        return { applied: 'live', message: 'Follow-up delivery updated.' };
      }
      case 'transport': {
        const transport = this.requireString(value, settingId);
        this.getSettingsManager().setTransport(transport as Parameters<SettingsManager['setTransport']>[0]);
        await this.flushSettings();
        return { applied: 'reload', message: 'Saved. Reload Pi or start a new session to apply.' };
      }
      case 'images.blockImages':
        this.getSettingsManager().setBlockImages(this.requireBoolean(value, settingId));
        await this.flushSettings();
        return { applied: 'reload', message: 'Saved. Reload Pi or start a new session to apply.' };
      case 'images.autoResize':
        this.getSettingsManager().setImageAutoResize(this.requireBoolean(value, settingId));
        await this.flushSettings();
        return { applied: 'reload', message: 'Saved. Reload Pi or start a new session to apply.' };
      case 'enableSkillCommands':
        this.getSettingsManager().setEnableSkillCommands(this.requireBoolean(value, settingId));
        await this.flushSettings();
        return { applied: 'reload', message: 'Saved. Reload Pi or start a new session to apply.' };
      case 'enabledModels':
        throw new Error('Editing enabledModels from Tauren is deferred to avoid saving malformed model patterns. Edit Pi settings JSON directly for now.');
      default:
        throw new Error(`Unsupported Pi setting: ${settingId}`);
    }
  }

  public async setSessionName(name: string): Promise<void> {
    const { session } = await this.ensureRuntime();
    session.setSessionName(name.trim());
  }

  public async compact(customInstructions?: string): Promise<PiCompactResult> {
    const { session } = await this.ensureRuntime();
    return await session.compact(customInstructions) as PiCompactResult;
  }

  public async exportHtml(outputPath?: string): Promise<PiExportHtmlResult> {
    const runtime = await this.ensureRuntime();
    const exportPath = resolveExportHtmlOutputPath(outputPath, runtime.session.sessionFile, runtime.cwd);
    return { path: await runtime.session.exportToHtml(exportPath) };
  }

  public async getLastAssistantText(): Promise<PiLastAssistantText> {
    const { session } = await this.ensureRuntime();
    return { text: session.getLastAssistantText() ?? null };
  }

  public async getMessages(): Promise<PiMessagesResult> {
    const runtime = await this.ensureRuntime();
    return { messages: this.renderCustomMessages(runtime, runtime.session.messages as PiMessagesResult['messages']) };
  }

  public async switchSession(sessionPath: string): Promise<PiSwitchSessionResult> {
    const runtime = await this.ensureRuntime();
    return await runtime.switchSession(sessionPath);
  }

  public async getSessionTree() {
    const { session } = await this.ensureRuntime();
    return flattenPiSessionTree(
      session.sessionManager.getTree() as unknown as FlattenableSessionTreeNode[],
      session.sessionManager.getLeafId()
    );
  }

  public async setTreeEntryLabel(entryId: string, label: string | undefined): Promise<void> {
    const { session } = await this.ensureRuntime();
    session.sessionManager.appendLabelChange(entryId, label);
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
    const sdk = await this.loadSdk();
    sdk.initTheme?.('dark', false);
    const cwd = this.resolveWorkspaceCwd();
    const agentDir = sdk.getAgentDir();
    const initialSettingsManager = sdk.SettingsManager.create(cwd, agentDir);
    const sessionManager = this.createSessionManager(sdk, cwd, agentDir, initialSettingsManager);
    const runtime = await sdk.createAgentSessionRuntime(async (runtimeOptions) => {
      const settingsManager = runtimeOptions.cwd === cwd
        ? initialSettingsManager
        : sdk.SettingsManager.create(runtimeOptions.cwd, runtimeOptions.agentDir);
      this.settingsManager = settingsManager;
      const services = await sdk.createAgentSessionServices({
        cwd: runtimeOptions.cwd,
        agentDir: runtimeOptions.agentDir,
        settingsManager
      });
      const customTools = this.shouldRejectEditWriteOutsideWorkspace()
        ? createWorkspaceMutationGuardTools(sdk, {
          workspaceRoot: runtimeOptions.cwd,
          shouldReject: () => this.shouldRejectEditWriteOutsideWorkspace()
        })
        : undefined;
      const created = await sdk.createAgentSessionFromServices({
        services,
        sessionManager: runtimeOptions.sessionManager,
        sessionStartEvent: runtimeOptions.sessionStartEvent,
        customTools
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

  private createSessionManager(sdk: PiSdkModule, cwd: string, _agentDir: string, settingsManager: SettingsManager): SessionManager {
    const sessionDir = process.env[sessionDirEnvVar] || settingsManager.getSessionDir();

    if (this.options.sessionFile) {
      return sdk.SessionManager.open(this.options.sessionFile, sessionDir, cwd);
    }

    return sdk.SessionManager.create(cwd, sessionDir);
  }

  private resolveWorkspaceCwd(): string {
    try {
      return assertPiStartupCwd(this.options.cwd, this.shouldRejectEditWriteOutsideWorkspace());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.showNotification?.(message, 'warning');
      throw error;
    }
  }

  private shouldRejectEditWriteOutsideWorkspace(): boolean {
    const setting = this.options.rejectEditWriteOutsideWorkspace;
    return typeof setting === 'function' ? setting() : Boolean(setting);
  }

  private getRuntimeSettingsState(): Partial<PiSessionState> {
    const settingsManager = this.settingsManager;

    if (!settingsManager) {
      return {};
    }

    return {
      defaultProvider: callOptionalSettingGetter<string>(settingsManager, 'getDefaultProvider'),
      defaultModel: callOptionalSettingGetter<string>(settingsManager, 'getDefaultModel'),
      defaultThinkingLevel: callOptionalSettingGetter<string>(settingsManager, 'getDefaultThinkingLevel'),
      transport: callOptionalSettingGetter<string>(settingsManager, 'getTransport'),
      blockImages: callOptionalSettingGetter<boolean>(settingsManager, 'getBlockImages'),
      imageAutoResize: callOptionalSettingGetter<boolean>(settingsManager, 'getImageAutoResize'),
      enabledModels: callOptionalSettingGetter<string[]>(settingsManager, 'getEnabledModels'),
      enableSkillCommands: callOptionalSettingGetter<boolean>(settingsManager, 'getEnableSkillCommands')
    };
  }

  private getSettingsManager(): SettingsManager {
    if (!this.settingsManager) {
      throw new Error('Pi settings are not available yet.');
    }

    return this.settingsManager;
  }

  private async flushSettings(): Promise<void> {
    const settingsManager = this.getSettingsManager();
    await settingsManager.flush();
    const errors = settingsManager.drainErrors();

    if (errors.length > 0) {
      const details = errors.map(({ scope, error }) => `${scope}: ${error.message}`).join('; ');
      throw new Error(`Pi settings were updated in memory but could not be fully saved: ${details}`);
    }
  }

  private requireBoolean(value: SettingValue, settingId: PiSettingId): boolean {
    if (typeof value !== 'boolean') {
      throw new Error(`Expected boolean value for ${settingId}.`);
    }

    return value;
  }

  private requireString(value: SettingValue, settingId: PiSettingId): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Expected non-empty string value for ${settingId}.`);
    }

    return value.trim();
  }

  private async reloadRuntime(runtime: AgentSessionRuntime): Promise<void> {
    this.options.extensionUi?.clearStatuses?.();
    this.options.extensionUi?.clearWidgets?.();
    await runtime.session.reload();
  }

  private parseModelReference(value: string): { provider: string; modelId: string } {
    const separatorIndex = value.indexOf('/');

    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throw new Error('Expected model value in provider/model format.');
    }

    return {
      provider: value.slice(0, separatorIndex),
      modelId: value.slice(separatorIndex + 1)
    };
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
          await this.reloadRuntime(runtime);
        }
      },
      onError: (error) => {
        this.emitEvent(mapSdkExtensionErrorToPiEvent(error));
      }
    });

    this.unsubscribeSession?.();
    this.unsubscribeSession = session.subscribe((event) => {
      if (event.type === 'agent_start') {
        this.promptSawAgentStart = true;
      }

      this.emitEvent(this.renderer.enrichEvent(runtime, mapSdkSessionEventToPiEvent(event)));
    });
  }

  private renderCustomMessages(runtime: AgentSessionRuntime, messages: PiMessagesResult['messages']): PiMessagesResult['messages'] {
    if (!Array.isArray(messages)) {
      return messages;
    }

    return messages.map((message) => {
      if (!message || message.role !== 'custom') {
        return message;
      }

      const rendered = this.renderer.renderCustomMessage(runtime, message as Record<string, unknown>);
      return rendered ? { ...message, taurenRenderedMessage: rendered } : message;
    });
  }

  private loadSdk(): Promise<PiSdkModule> {
    return (this.options.loadSdk ?? loadPiSdk)();
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

  private emitEvent(event: PiEvent): void {
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

type StartupResourceSourceInfo = {
  source?: string;
  baseDir?: string;
};

type StartupResourcePathItem = {
  path: string;
  sourceInfo?: StartupResourceSourceInfo;
};

function sortStartupResourceLabels(labels: string[]): string[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function formatDisplayPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function formatContextResourcePath(filePath: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(resolvedCwd, filePath);
  const relativePath = path.relative(resolvedCwd, absolutePath);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.replace(/\\/g, '/');
  }

  if (relativePath === '') {
    return path.basename(absolutePath);
  }

  return formatDisplayPath(absolutePath);
}

function getShortPath(filePath: string, sourceInfo: StartupResourceSourceInfo | undefined): string {
  const baseDir = sourceInfo?.baseDir;

  if (baseDir && isPackageSource(sourceInfo)) {
    const relativePath = path.relative(path.resolve(baseDir), path.resolve(filePath));

    if (relativePath
      && relativePath !== '.'
      && !relativePath.startsWith('..')
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)) {
      return relativePath.replace(/\\/g, '/');
    }
  }

  const source = sourceInfo?.source ?? '';
  const npmMatch = filePath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith('npm:')) {
    return npmMatch[2] ?? filePath;
  }

  const gitMatch = filePath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith('git:')) {
    return gitMatch[1] ?? filePath;
  }

  return formatDisplayPath(filePath);
}

function getCompactPathLabel(resourcePath: string, sourceInfo?: StartupResourceSourceInfo): string {
  const shortPath = getShortPath(resourcePath, sourceInfo);
  const segments = shortPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '~');

  return segments.at(-1) ?? shortPath;
}

function getCompactPackageSourceLabel(sourceInfo: StartupResourceSourceInfo | undefined): string {
  const source = sourceInfo?.source ?? '';

  if (source.startsWith('npm:')) {
    return source.slice('npm:'.length) || source;
  }

  if (source.startsWith('git:')) {
    const gitSource = source.slice('git:'.length).replace(/\.git$/, '');
    return gitSource.split('/').filter(Boolean).slice(-2).join('/') || gitSource || source;
  }

  return source;
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo: StartupResourceSourceInfo | undefined): string {
  if (!isPackageSource(sourceInfo)) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
  if (!sourceLabel) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, '/');
  const packagePath = shortPath.startsWith('extensions/') ? shortPath.slice('extensions/'.length) : shortPath;
  const parsedPath = path.posix.parse(packagePath);

  if (parsedPath.name === 'index') {
    return !parsedPath.dir || parsedPath.dir === '.' ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
  }

  return `${sourceLabel}:${packagePath}`;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
  return formatDisplayPath(resourcePath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '~');
}

function getCompactNonPackageExtensionLabel(resourcePath: string, index: number, allPaths: Array<{ segments: string[] }>): string {
  const segments = allPaths[index]?.segments;

  if (!segments || segments.length === 0) {
    return getCompactPathLabel(resourcePath);
  }

  for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
    const candidate = segments.slice(-segmentCount).join('/');
    const isUnique = allPaths.every((item, itemIndex) => itemIndex === index || item.segments.slice(-segmentCount).join('/') !== candidate);

    if (isUnique) {
      return candidate;
    }
  }

  return segments.join('/');
}

function getCompactExtensionLabels(extensions: StartupResourcePathItem[]): string[] {
  const nonPackageExtensions = extensions
    .map((extension) => {
      const segments = getCompactDisplayPathSegments(extension.path);
      const lastSegment = segments.at(-1);

      if (segments.length > 1 && (lastSegment === 'index.ts' || lastSegment === 'index.js')) {
        segments.pop();
      }

      return { ...extension, segments };
    })
    .filter((extension) => !isPackageSource(extension.sourceInfo));

  return extensions.map((extension) => {
    if (isPackageSource(extension.sourceInfo)) {
      return getCompactExtensionLabel(extension.path, extension.sourceInfo);
    }

    const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
    return nonPackageIndex === -1
      ? getCompactPathLabel(extension.path, extension.sourceInfo)
      : getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
  });
}

function isPackageSource(sourceInfo: StartupResourceSourceInfo | undefined): boolean {
  const source = sourceInfo?.source ?? '';
  return source.startsWith('npm:') || source.startsWith('git:');
}

function resolveExportHtmlOutputPath(outputPath: string | undefined, sessionFile: string | undefined, baseDir: string): string | undefined {
  const trimmedPath = outputPath?.trim();
  const exportBaseDir = baseDir || os.homedir();

  if (trimmedPath) {
    const expandedPath = expandHomePath(trimmedPath);
    return path.isAbsolute(expandedPath) ? expandedPath : path.resolve(exportBaseDir, expandedPath);
  }

  if (!sessionFile) {
    return undefined;
  }

  const sessionBasename = path.basename(sessionFile, '.jsonl');
  return path.join(exportBaseDir, `pi-session-${sessionBasename}.html`);
}

function expandHomePath(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/') || (process.platform === 'win32' && filePath.startsWith('~\\'))) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function callOptionalSettingGetter<T>(settingsManager: SettingsManager, methodName: string): T | undefined {
  const candidate = settingsManager as unknown as Record<string, unknown>;
  const method = candidate[methodName];
  return typeof method === 'function' ? method.call(settingsManager) as T : undefined;
}

function isPiAuthSource(value: unknown): value is PiAuthSource {
  return value === 'stored'
    || value === 'runtime'
    || value === 'environment'
    || value === 'fallback'
    || value === 'models_json_key'
    || value === 'models_json_command';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
