import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PiClient } from '../pi/clientTypes';
import type {
  PiAvailableCommands,
  PiAgentMessage,
  PiAuthActionResult,
  PiAuthProvider,
  PiAuthProvidersResult,
  PiAuthSource,
  PiAvailableModels,
  PiCloneResult,
  PiCompactResult,
  PiEvent,
  PiExportHtmlResult,
  PiForkMessagesResult,
  PiForkResult,
  PiImageContent,
  PiImportSessionResult,
  PiLastAssistantText,
  PiMessagesResult,
  PiModel,
  PiNavigateTreeResult,
  PiOAuthLoginCallbacks,
  PiPromptStreamingBehavior,
  PiSessionState,
  PiSessionStats,
  PiStartupResources,
  PiSwitchSessionResult
} from '../pi/types';
import type { PiSettingId, SettingValue } from '../settings/settingsRegistry';
import type { WebviewTreeItem } from '../webviewProtocol/types';
import { isRecord } from '../shared/typeGuards';
import { KwardRpcTransport, type KwardJsonRpcNotification } from './rpcTransport';
import { mapKwardTurnEvent } from './eventMapper';
import type {
  KwardAuthProvidersResult,
  KwardCommandsResult,
  KwardModel,
  KwardOAuthLoginStart,
  KwardQuestionRequest,
  KwardRuntimeSettingResult,
  KwardSession,
  KwardStartupResourcesResult,
  KwardTranscriptResult,
  KwardTurn,
  KwardTurnEvent
} from './types';

export type KwardClientOptions = {
  cwd?: string;
  sessionFile?: string;
  kwardPath?: string;
  showNotification?: (message: string, notifyType: string) => void;
};

const defaultKwardPath = '/Users/kwood/Repositories/github.com/kaiwood/kward';
const unsupportedKwardFeatureMessage = 'This feature is not available with the experimental Kward backend yet.';
const authLoginPollIntervalMs = 1000;
const authLoginTimeoutSeconds = 120;

export class KwardClient implements PiClient {
  private transport: KwardRpcTransport | undefined;
  private initializePromise: Promise<void> | undefined;
  private session: KwardSession | undefined;
  private currentTurnId: string | undefined;
  private disposed = false;
  private startupWarningShown = false;
  private readonly eventListeners = new Set<(event: PiEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: KwardClientOptions = {}) {}

  public onEvent(listener: (event: PiEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  public isRunning(): boolean {
    return !this.disposed && Boolean(this.transport?.running || this.initializePromise || this.session);
  }

  public async prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior, images?: PiImageContent[]): Promise<void> {
    const session = await this.ensureSession();
    const result = await this.request('turns/start', {
      sessionId: requiredString(session.id, 'Kward session id'),
      input: message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(images && images.length > 0 ? { attachments: images.map(toKwardAttachment) } : {})
    });
    const turn = normalizeTurn(result);
    this.currentTurnId = requiredString(turn.id, 'Kward turn id');
  }

  public async abort(): Promise<void> {
    if (this.disposed || !this.currentTurnId) {
      return;
    }

    await this.request('turns/cancel', { turnId: this.currentTurnId }).catch((error) => {
      this.emitError(error instanceof Error ? error.message : String(error));
    });
  }

  public async reload(): Promise<void> {
    const session = await this.ensureSession();
    await this.request('runtime/reload', { sessionId: requiredString(session.id, 'Kward session id') });
  }

  public async getState(): Promise<PiSessionState> {
    const session = await this.ensureSession();
    const result = await this.request('runtime/state', { sessionId: requiredString(session.id, 'Kward session id') });
    return normalizeSessionState(result, session);
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const session = await this.ensureSession();
    const result = await this.request('runtime/stats', { sessionId: requiredString(session.id, 'Kward session id') });
    return normalizeSessionStats(result, session);
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    await this.ensureInitialized();
    const result = await this.request('models/list');
    const models = isRecord(result) && Array.isArray(result.models) ? result.models : [];
    return { models: models.map(mapKwardListModel).filter(Boolean) as PiModel[] };
  }

  public async getCommands(): Promise<PiAvailableCommands> {
    const session = await this.ensureSession();
    const result = normalizeCommandsResult(await this.request('commands/list', { sessionId: requiredString(session.id, 'Kward session id') }));
    return { commands: result.commands ?? [] };
  }

  public async getStartupResources(): Promise<PiStartupResources> {
    const session = await this.ensureSession();
    const result = normalizeStartupResourcesResult(await this.request('resources/startup', { sessionId: requiredString(session.id, 'Kward session id') }));
    return { sections: result.sections ?? [] };
  }

  public async getAuthProviders(): Promise<PiAuthProvidersResult> {
    await this.ensureInitialized();
    const result = normalizeAuthProvidersResult(await this.request('auth/providers'));
    return { providers: result.providers ?? [] };
  }

  public async loginWithApiKey(providerId: string, apiKey: string): Promise<PiAuthActionResult> {
    await this.ensureInitialized();
    const result = await this.request('auth/loginWithApiKey', { providerId, apiKey });
    return normalizeAuthActionResult(result, providerId, `Saved API key for ${providerId}.`);
  }

  public async loginWithOAuth(providerId: string, callbacks: PiOAuthLoginCallbacks): Promise<PiAuthActionResult> {
    await this.ensureInitialized();
    const start = normalizeOAuthLoginStart(await this.request('auth/loginWithOAuth', { providerId, timeoutSeconds: authLoginTimeoutSeconds }));
    const loginId = requiredString(start.loginId, 'Kward auth login id');
    const authorizationUrl = requiredString(start.authorizationUrl, 'Kward authorization URL');

    callbacks.onAuth({
      url: authorizationUrl,
      instructions: `Complete login for ${providerId} in your browser.`
    });
    callbacks.onProgress?.('Waiting for browser login to complete…');

    const finished = await this.waitForOAuthLogin(loginId, callbacks);
    if (finished.status !== 'completed') {
      throw new Error(finished.error ?? finished.message ?? `Login failed for ${providerId}.`);
    }

    return {
      providerId: finished.providerId ?? providerId,
      message: finished.message ?? `Logged in to ${providerId}.`
    };
  }

  public async logoutAuthProvider(providerId: string): Promise<PiAuthActionResult> {
    await this.ensureInitialized();
    const result = await this.request('auth/logoutProvider', { providerId });
    return normalizeAuthActionResult(result, providerId, `Logged out of ${providerId}.`);
  }

  public async setModel(provider: string, modelId: string): Promise<PiModel> {
    await this.ensureInitialized();
    const result = await this.request('models/set', { ...(provider ? { provider } : {}), model: modelId });
    return mapKwardCurrentModel(normalizeModel(result));
  }

  public async setThinkingLevel(level: string): Promise<void> {
    await this.ensureInitialized();
    await this.request('reasoning/set', { effort: level });
  }

  public async updateRuntimeSetting(settingId: PiSettingId, value: SettingValue): Promise<{ applied: 'live' | 'reload'; message?: string }> {
    const session = await this.ensureSession();
    const result = normalizeRuntimeSettingResult(await this.request('runtime/updateSetting', {
      sessionId: requiredString(session.id, 'Kward session id'),
      settingId,
      value
    }));
    return {
      applied: result.applied === 'reload' ? 'reload' : 'live',
      ...(result.message ? { message: result.message } : {})
    };
  }

  public async setSessionName(name: string): Promise<void> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/rename', { sessionId: requiredString(session.id, 'Kward session id'), name });
    this.session = normalizeSession(result);
  }

  public async compact(_customInstructions?: string): Promise<PiCompactResult> {
    throw new Error('Kward backend does not support compaction from Tauren yet.');
  }

  public async exportHtml(outputPath?: string): Promise<PiExportHtmlResult> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/export', {
      sessionId: requiredString(session.id, 'Kward session id'),
      ...(outputPath ? { path: outputPath } : {}),
      format: 'html'
    });
    return { path: isRecord(result) && typeof result.path === 'string' ? result.path : undefined };
  }

  public async getLastAssistantText(): Promise<PiLastAssistantText> {
    const messages = (await this.getMessages()).messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'assistant') {
        const text = extractText(message.content);
        if (text) {
          return { text };
        }
      }
    }

    return { text: null };
  }

  public async getMessages(): Promise<PiMessagesResult> {
    const transcript = await this.getTranscript();
    return { messages: Array.isArray(transcript.messages) ? transcript.messages : [] };
  }

  public async switchSession(sessionPath: string): Promise<PiSwitchSessionResult> {
    await this.ensureInitialized();
    const result = await this.request('sessions/resume', { path: sessionPath, workspaceRoot: this.options.cwd });
    this.session = normalizeSession(result);
    this.currentTurnId = undefined;
    return {};
  }

  public async importFromJsonl(_inputPath: string, _cwdOverride?: string): Promise<PiImportSessionResult> {
    throw new Error('Kward backend does not support Tauren session import yet.');
  }

  public async getSessionTree(): Promise<WebviewTreeItem[]> {
    throw new Error('Session Tree is a Pi-only feature and is not available with Kward yet.');
  }

  public async setTreeEntryLabel(_entryId: string, _label: string | undefined): Promise<void> {
    throw new Error(unsupportedKwardFeatureMessage);
  }

  public async navigateTree(_entryId: string, _options?: { summarize?: boolean; customInstructions?: string }): Promise<PiNavigateTreeResult> {
    throw new Error(unsupportedKwardFeatureMessage);
  }

  public async getForkMessages(): Promise<PiForkMessagesResult> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/forkMessages', { sessionId: requiredString(session.id, 'Kward session id') });
    return normalizeForkMessagesResult(result);
  }

  public async fork(entryId: string): Promise<PiForkResult> {
    const session = await this.ensureSession();
    const result = normalizeForkResult(await this.request('sessions/fork', {
      sessionId: requiredString(session.id, 'Kward session id'),
      entryId
    }));
    if (result.session) {
      this.session = result.session;
      this.currentTurnId = undefined;
    }
    return { text: result.text, cancelled: result.cancelled };
  }

  public async clone(): Promise<PiCloneResult> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/clone', { sessionId: requiredString(session.id, 'Kward session id') });
    this.session = normalizeSession(result);
    this.currentTurnId = undefined;
    return {};
  }

  public async answerQuestion(sessionId: string, questionRequestId: string, answers: unknown[]): Promise<void> {
    await this.ensureInitialized();
    await this.request('ui/answerQuestion', { sessionId, questionRequestId, answers });
  }

  public dispose(): void {
    this.disposed = true;
    this.transport?.dispose();
    this.transport = undefined;
    this.initializePromise = undefined;
    this.session = undefined;
    this.currentTurnId = undefined;
    this.eventListeners.clear();
    this.errorListeners.clear();
  }

  private async getTranscript(): Promise<KwardTranscriptResult> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/transcript', { sessionId: requiredString(session.id, 'Kward session id') });
    const transcript = normalizeTranscript(result);
    if (transcript.session) {
      this.session = transcript.session;
    }
    return transcript;
  }

  private async ensureSession(): Promise<KwardSession> {
    await this.ensureInitialized();

    if (this.session) {
      return this.session;
    }

    const result = this.options.sessionFile
      ? await this.request('sessions/resume', { path: this.options.sessionFile, workspaceRoot: this.options.cwd })
      : await this.request('sessions/create', { workspaceRoot: this.options.cwd });
    this.session = normalizeSession(result);
    return this.session;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.disposed) {
      throw new Error('Kward client disposed.');
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    const kwardPath = this.resolveKwardPath();
    const transport = new KwardRpcTransport({
      cwd: kwardPath,
      onNotification: (notification) => this.handleNotification(notification),
      onError: (message) => this.emitError(message),
      onExit: (message) => this.emitError(message)
    });
    this.transport = transport;
    this.initializePromise = this.request('initialize').then(() => {
      this.showStartupWarning();
    });

    return this.initializePromise;
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.transport) {
      const kwardPath = this.resolveKwardPath();
      this.transport = new KwardRpcTransport({
        cwd: kwardPath,
        onNotification: (notification) => this.handleNotification(notification),
        onError: (message) => this.emitError(message),
        onExit: (message) => this.emitError(message)
      });
    }

    return this.transport.request(method, params);
  }

  private resolveKwardPath(): string {
    const kwardPath = this.options.kwardPath || defaultKwardPath;
    const expanded = kwardPath.startsWith('~') ? path.join(os.homedir(), kwardPath.slice(1)) : kwardPath;

    if (!fs.existsSync(expanded)) {
      throw new Error(`Kward path does not exist: ${expanded}`);
    }

    return expanded;
  }

  private handleNotification(notification: KwardJsonRpcNotification): void {
    if (notification.method === 'turn/event') {
      const event = normalizeTurnEvent(notification.params);
      const mapped = mapKwardTurnEvent(event);
      if (mapped) {
        this.emitEvent(mapped);
      }
      if (event.type === 'turnFinished') {
        this.currentTurnId = undefined;
      }
      return;
    }

    if (notification.method === 'ui/question') {
      const request = normalizeQuestionRequest(notification.params);
      if (request) {
        this.emitEvent({ type: 'kward_ui_question', request });
      }
      return;
    }

    if (notification.method === 'auth/loginFinished') {
      return;
    }
  }

  private async waitForOAuthLogin(loginId: string, callbacks: PiOAuthLoginCallbacks): Promise<KwardOAuthLoginStart> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < authLoginTimeoutSeconds * 1000 + authLoginPollIntervalMs) {
      throwIfAborted(callbacks.signal);
      const status = normalizeOAuthLoginStart(await this.request('auth/loginStatus', { loginId }));
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        return status;
      }
      await sleep(authLoginPollIntervalMs, callbacks.signal);
    }

    throw new Error('Login timed out.');
  }

  private showStartupWarning(): void {
    if (this.startupWarningShown) {
      return;
    }

    this.startupWarningShown = true;
    this.options.showNotification?.(
      'Kward backend is experimental. Tauren will warn but will not gate Kward file or shell mutations.',
      'warning'
    );
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

function normalizeSession(value: unknown): KwardSession {
  if (!isRecord(value)) {
    return {};
  }

  return {
    id: getString(value, 'id'),
    path: getString(value, 'path'),
    persistentId: getString(value, 'persistentId'),
    workspaceRoot: getString(value, 'workspaceRoot'),
    cwd: getString(value, 'cwd'),
    name: typeof value.name === 'string' ? value.name : null,
    createdAt: getString(value, 'createdAt'),
    modifiedAt: getString(value, 'modifiedAt'),
    firstMessage: getString(value, 'firstMessage')
  };
}

function normalizeTurn(value: unknown): KwardTurn {
  return isRecord(value) ? { id: getString(value, 'id'), sessionId: getString(value, 'sessionId'), status: getString(value, 'status') } : {};
}

function normalizeSessionState(value: unknown, fallbackSession: KwardSession): PiSessionState {
  if (!isRecord(value)) {
    return {
      sessionFile: fallbackSession.path,
      sessionId: fallbackSession.persistentId ?? fallbackSession.id,
      sessionName: typeof fallbackSession.name === 'string' ? fallbackSession.name : undefined,
      transport: 'kward-rpc',
      quietStartup: false
    };
  }

  return {
    model: isRecord(value.model) ? mapKwardCurrentModel(normalizeModel(value.model)) : undefined,
    thinkingLevel: getString(value, 'thinkingLevel'),
    isStreaming: getBoolean(value, 'isStreaming'),
    isCompacting: getBoolean(value, 'isCompacting'),
    steeringMode: getString(value, 'steeringMode'),
    followUpMode: getString(value, 'followUpMode'),
    sessionFile: getString(value, 'sessionFile') ?? fallbackSession.path,
    sessionId: getString(value, 'sessionId') ?? fallbackSession.persistentId ?? fallbackSession.id,
    sessionName: getString(value, 'sessionName') ?? (typeof fallbackSession.name === 'string' ? fallbackSession.name : undefined),
    autoCompactionEnabled: getBoolean(value, 'autoCompactionEnabled'),
    autoRetryEnabled: getBoolean(value, 'autoRetryEnabled'),
    defaultProvider: getString(value, 'defaultProvider'),
    defaultModel: getString(value, 'defaultModel'),
    defaultThinkingLevel: getString(value, 'defaultThinkingLevel'),
    hideThinkingBlock: getBoolean(value, 'hideThinkingBlock'),
    quietStartup: getBoolean(value, 'quietStartup') ?? false,
    transport: getString(value, 'transport') ?? 'kward-rpc',
    imageAutoResize: getBoolean(value, 'imageAutoResize'),
    blockImages: getBoolean(value, 'blockImages'),
    enabledModels: getStringArray(value.enabledModels),
    enableSkillCommands: getBoolean(value, 'enableSkillCommands'),
    messageCount: getNumber(value, 'messageCount'),
    pendingMessageCount: getNumber(value, 'pendingMessageCount')
  };
}

function normalizeSessionStats(value: unknown, fallbackSession: KwardSession): PiSessionStats {
  if (!isRecord(value)) {
    return {
      sessionFile: fallbackSession.path,
      sessionId: fallbackSession.persistentId ?? fallbackSession.id,
      sessionName: typeof fallbackSession.name === 'string' ? fallbackSession.name : undefined
    };
  }

  return {
    sessionFile: getString(value, 'sessionFile') ?? fallbackSession.path,
    sessionId: getString(value, 'sessionId') ?? fallbackSession.persistentId ?? fallbackSession.id,
    sessionName: getString(value, 'sessionName') ?? (typeof fallbackSession.name === 'string' ? fallbackSession.name : undefined),
    userMessages: getNumber(value, 'userMessages'),
    assistantMessages: getNumber(value, 'assistantMessages'),
    toolCalls: getNumber(value, 'toolCalls'),
    toolResults: getNumber(value, 'toolResults'),
    totalMessages: getNumber(value, 'totalMessages'),
    tokens: isRecord(value.tokens) ? {
      input: getNumber(value.tokens, 'input'),
      output: getNumber(value.tokens, 'output'),
      cacheRead: getNumber(value.tokens, 'cacheRead'),
      cacheWrite: getNumber(value.tokens, 'cacheWrite'),
      total: getNumber(value.tokens, 'total')
    } : undefined,
    cost: getNumber(value, 'cost'),
    usingSubscription: getBoolean(value, 'usingSubscription'),
    autoCompactionEnabled: getBoolean(value, 'autoCompactionEnabled'),
    contextUsage: isRecord(value.contextUsage) ? {
      tokens: getNumber(value.contextUsage, 'tokens'),
      contextWindow: getNumber(value.contextUsage, 'contextWindow'),
      percent: getNumber(value.contextUsage, 'percent')
    } : undefined
  };
}

function normalizeModel(value: unknown): KwardModel {
  if (!isRecord(value)) {
    return {};
  }

  return {
    provider: getString(value, 'provider'),
    id: getString(value, 'id'),
    model: getString(value, 'model'),
    name: getString(value, 'name'),
    reasoning: typeof value.reasoning === 'boolean' ? value.reasoning : undefined,
    reasoningEffort: getString(value, 'reasoningEffort'),
    contextWindow: getNumber(value, 'contextWindow'),
    current: typeof value.current === 'boolean' ? value.current : undefined
  };
}

function mapKwardCurrentModel(model: KwardModel): PiModel {
  const id = model.id ?? model.model;
  return {
    provider: model.provider,
    id,
    name: model.name ?? id,
    reasoning: model.reasoning ?? Boolean(model.reasoningEffort),
    contextWindow: model.contextWindow
  };
}

function mapKwardListModel(value: unknown): PiModel | undefined {
  const model = normalizeModel(value);
  const id = model.id ?? model.model;
  return id ? { provider: model.provider, id, name: model.name ?? id, reasoning: model.reasoning ?? model.provider === 'Codex', contextWindow: model.contextWindow } : undefined;
}

function normalizeRuntimeSettingResult(value: unknown): KwardRuntimeSettingResult {
  return isRecord(value) ? { applied: getString(value, 'applied'), message: getString(value, 'message') } : {};
}

function normalizeCommandsResult(value: unknown): KwardCommandsResult {
  if (!isRecord(value) || !Array.isArray(value.commands)) {
    return { commands: [] };
  }

  return {
    commands: value.commands.filter(isRecord).map((command) => ({
      name: getString(command, 'name'),
      description: getString(command, 'description'),
      source: getString(command, 'source'),
      sourceInfo: command.sourceInfo,
      location: getString(command, 'location'),
      path: getString(command, 'path')
    }))
  };
}

function normalizeStartupResourcesResult(value: unknown): KwardStartupResourcesResult {
  if (!isRecord(value) || !Array.isArray(value.sections)) {
    return { sections: [] };
  }

  return {
    sections: value.sections.filter(isRecord).map((section) => ({
      name: getString(section, 'name') ?? '',
      items: getStringArray(section.items) ?? []
    })).filter((section) => section.name)
  };
}

function normalizeTurnEvent(value: unknown): KwardTurnEvent {
  if (!isRecord(value)) {
    return {};
  }

  return {
    sequence: typeof value.sequence === 'number' ? value.sequence : undefined,
    timestamp: getString(value, 'timestamp'),
    sessionId: getString(value, 'sessionId'),
    turnId: getString(value, 'turnId'),
    type: getString(value, 'type'),
    payload: value.payload
  };
}

function normalizeTranscript(value: unknown): KwardTranscriptResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    session: value.session ? normalizeSession(value.session) : undefined,
    messages: Array.isArray(value.messages) ? value.messages.map(normalizeTranscriptMessage) : []
  };
}

function normalizeTranscriptMessage(value: unknown): PiAgentMessage {
  if (!isRecord(value)) {
    return {};
  }

  const role = getString(value, 'role');
  const content = value.content;

  return {
    ...value,
    ...(role === 'tool' ? { role: 'toolResult' } : role ? { role } : {}),
    content
  };
}

function normalizeAuthProvidersResult(value: unknown): KwardAuthProvidersResult {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return { providers: [] };
  }

  return {
    providers: value.providers.filter(isRecord).map(normalizeAuthProvider).filter(isDefined)
  };
}

function normalizeAuthProvider(value: Record<string, unknown>): PiAuthProvider | undefined {
  const id = getString(value, 'id');
  const name = getString(value, 'name');
  const authType = getString(value, 'authType');

  if (!id || !name || (authType !== 'oauth' && authType !== 'api_key')) {
    return undefined;
  }

  const source = getString(value, 'source');
  const storedCredentialType = getString(value, 'storedCredentialType');

  return {
    id,
    name,
    authType,
    configured: getBoolean(value, 'configured') ?? false,
    ...(isAuthSource(source) ? { source } : {}),
    ...(getString(value, 'label') ? { label: getString(value, 'label') } : {}),
    ...(storedCredentialType === 'oauth' || storedCredentialType === 'api_key' ? { storedCredentialType } : {}),
    canLogout: getBoolean(value, 'canLogout') ?? false,
    ...(getBoolean(value, 'usesCallbackServer') !== undefined ? { usesCallbackServer: getBoolean(value, 'usesCallbackServer') } : {})
  };
}

function normalizeAuthActionResult(value: unknown, fallbackProviderId: string, fallbackMessage: string): PiAuthActionResult {
  return {
    providerId: isRecord(value) ? getString(value, 'providerId') ?? fallbackProviderId : fallbackProviderId,
    message: isRecord(value) ? getString(value, 'message') ?? fallbackMessage : fallbackMessage
  };
}

function normalizeOAuthLoginStart(value: unknown): KwardOAuthLoginStart {
  if (!isRecord(value)) {
    return {};
  }

  return {
    providerId: getString(value, 'providerId'),
    loginId: getString(value, 'loginId'),
    authorizationUrl: getString(value, 'authorizationUrl'),
    redirectUri: getString(value, 'redirectUri'),
    status: getString(value, 'status'),
    message: getString(value, 'message'),
    error: getString(value, 'error')
  };
}

function isAuthSource(value: string | undefined): value is PiAuthSource {
  return value === 'stored'
    || value === 'runtime'
    || value === 'environment'
    || value === 'fallback'
    || value === 'models_json_key'
    || value === 'models_json_command';
}

function normalizeForkMessagesResult(value: unknown): PiForkMessagesResult {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return { messages: [] };
  }

  return {
    messages: value.messages.filter(isRecord).map((message) => ({
      entryId: getString(message, 'entryId'),
      text: getString(message, 'text')
    }))
  };
}

function normalizeForkResult(value: unknown): PiForkResult & { session?: KwardSession } {
  if (!isRecord(value)) {
    return {};
  }

  return {
    session: value.session ? normalizeSession(value.session) : undefined,
    text: getString(value, 'text'),
    cancelled: getBoolean(value, 'cancelled')
  };
}

function normalizeQuestionRequest(value: unknown): KwardQuestionRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sessionId = getString(value, 'sessionId');
  const questionRequestId = getString(value, 'questionRequestId');
  const questions = Array.isArray(value.questions) ? value.questions.map(normalizeQuestion).filter(isDefined) : [];

  if (!sessionId || !questionRequestId || questions.length === 0) {
    return undefined;
  }

  return { sessionId, questionRequestId, questions };
}

function normalizeQuestion(value: unknown): KwardQuestionRequest['questions'][number] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const question = getString(value, 'question');
  const header = getString(value, 'header');
  const options = Array.isArray(value.options)
    ? value.options.map((option) => isRecord(option) ? { label: getString(option, 'label') ?? '', description: getString(option, 'description') ?? '' } : undefined).filter(isValidQuestionOption)
    : [];

  return question && header && options.length >= 2 ? { question, header, options } : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isValidQuestionOption(value: { label: string; description: string } | undefined): value is { label: string; description: string } {
  return Boolean(value?.label && value.description);
}

function requiredString(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function toKwardAttachment(image: PiImageContent): Record<string, unknown> {
  return {
    type: image.type,
    data: image.data,
    mimeType: image.mimeType
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Login cancelled');
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('Login cancelled'));
    }, { once: true });
  });
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((entry) => isRecord(entry) && typeof entry.text === 'string' ? entry.text : '').join('');
  }

  return '';
}
