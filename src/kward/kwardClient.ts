import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PiClient } from '../pi/clientTypes';
import type { ExtensionUi } from '../extensionUi/types';
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
import { normalizeSessionPath } from '../sessions/sessionFormatting';
import { KwardCapabilityResolver } from './capabilities';
import { KwardRpcTransport, type KwardJsonRpcNotification } from './rpcTransport';
import { KwardTurnEventNormalizer } from './eventMapper';
import type {
  KwardAuthProvidersResult,
  KwardCommandsResult,
  KwardCapabilities,
  KwardCompactResult,
  KwardImportResult,
  KwardInitializeResult,
  KwardMemoryInspect,
  KwardMemoryList,
  KwardMemoryRecord,
  KwardMemoryStatus,
  KwardMemorySummarize,
  KwardMemoryWhy,
  KwardModel,
  KwardNavigateTreeResult,
  KwardOAuthLoginStart,
  KwardQuestionRequest,
  KwardRuntimeSettingResult,
  KwardSession,
  KwardStartupResourcesResult,
  KwardTranscriptResult,
  KwardTreeResult,
  KwardTurn,
  KwardTurnEvent
} from './types';

export type KwardClientOptions = {
  cwd?: string;
  sessionFile?: string;
  resumeLastSession?: boolean;
  kwardPath?: string;
  showNotification?: (message: string, notifyType: string) => void;
  extensionUi?: ExtensionUi;
};

const defaultKwardPath = '/Users/kwood/Repositories/github.com/kaiwood/kward';
const supportedKwardProtocolVersion = 1;
const authLoginPollIntervalMs = 1000;
const authLoginTimeoutSeconds = 120;

export class StaleKwardSessionRequestError extends Error {
  public constructor(public readonly method: string, public readonly sessionId: string) {
    super('Stale Kward session response ignored.');
    this.name = 'StaleKwardSessionRequestError';
  }
}

export class KwardClient implements PiClient {
  private transport: KwardRpcTransport | undefined;
  private initializePromise: Promise<void> | undefined;
  private session: KwardSession | undefined;
  private sessionPromise: Promise<KwardSession> | undefined;
  private capabilities: KwardCapabilities = {};
  private capabilityResolver = new KwardCapabilityResolver(this.capabilities);
  private currentTurnId: string | undefined;
  private kwardFooterText: string | undefined;
  private readonly pendingKwardFooters = new Map<string, string>();
  private readonly eventNormalizer = new KwardTurnEventNormalizer();
  private disposed = false;
  private startupWarningShown = false;
  private protocolWarningShown = false;
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
    await this.ensureInitialized();
    if (streamingBehavior === 'steer' && !this.capabilityResolver.isBusyInputModeSupported('steer')) {
      throw new Error('Kward backend does not support steering while busy yet.');
    }
    if (streamingBehavior === 'followUp' && !this.capabilityResolver.isBusyInputModeSupported('followUp')) {
      throw new Error('Kward backend does not support queued follow-up prompts yet.');
    }
    if (images && images.length > 0) {
      this.requireCapability('attachments.input', this.capabilityResolver.isAttachmentInputSupported(), 'Kward backend does not support image attachments yet.');
    }

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

  public async expandPromptCommand(command: string, args: string): Promise<string> {
    await this.ensureInitialized();
    await this.ensureSession();
    const result = normalizePromptExpansion(await this.request('prompts/expand', {
      command,
      arguments: args
    }));
    return requiredString(result.input, 'Kward expanded prompt text');
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
    await this.ensureInitialized();
    this.requireCapability('runtime.reload', this.capabilityResolver.isMethodSupported('runtimeSettings', 'runtime/reload'), 'Kward backend does not support runtime reload yet.');
    const session = await this.ensureSession();
    await this.request('runtime/reload', { sessionId: requiredString(session.id, 'Kward session id') });
    this.clearExtensionFooter();
  }

  public async getState(): Promise<PiSessionState> {
    const session = await this.ensureSession();
    const result = await this.requestForSession('runtime/state', session);
    this.refreshSessionIdentityFromRuntime(result, session);
    return normalizeSessionState(result, this.session ?? session, this.capabilityResolver.isScopedModelsSupported());
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const session = await this.ensureSession();
    const result = await this.requestForSession('runtime/stats', session);
    this.refreshSessionIdentityFromRuntime(result, session);
    return normalizeSessionStats(result, this.session ?? session);
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    await this.ensureInitialized();
    const result = await this.request('models/list');
    const models = isRecord(result) && Array.isArray(result.models) ? result.models : [];
    return { models: models.map(mapKwardListModel).filter(Boolean) as PiModel[] };
  }

  public async getCommands(): Promise<PiAvailableCommands> {
    await this.ensureInitialized();
    if (!this.capabilityResolver.isGroupSupported('commands')) {
      return { commands: [] };
    }
    const session = await this.ensureSession();
    const result = normalizeCommandsResult(await this.requestForSession('commands/list', session));
    return { commands: result.commands ?? [] };
  }

  public async getStartupResources(): Promise<PiStartupResources> {
    await this.ensureInitialized();
    if (!this.capabilityResolver.isGroupSupported('startupResources')) {
      return { sections: [] };
    }
    const session = await this.ensureSession();
    const result = normalizeStartupResourcesResult(await this.requestForSession('resources/startup', session));
    return { sections: result.sections ?? [] };
  }

  public async getAuthProviders(): Promise<PiAuthProvidersResult> {
    await this.ensureInitialized();
    if (!this.capabilityResolver.isGroupSupported('auth')) {
      return { providers: [] };
    }
    const result = normalizeAuthProvidersResult(await this.request('auth/providers'));
    return { providers: result.providers ?? [] };
  }

  public async loginWithApiKey(providerId: string, apiKey: string): Promise<PiAuthActionResult> {
    await this.ensureInitialized();
    this.requireCapability('auth.loginWithApiKey', this.capabilityResolver.isMethodSupported('auth', 'auth/loginWithApiKey'), 'Kward backend does not support API-key login yet.');
    const result = await this.request('auth/loginWithApiKey', { providerId, apiKey });
    return normalizeAuthActionResult(result, providerId, `Saved API key for ${providerId}.`);
  }

  public async loginWithOAuth(providerId: string, callbacks: PiOAuthLoginCallbacks): Promise<PiAuthActionResult> {
    await this.ensureInitialized();
    this.requireCapability('auth.loginWithOAuth', this.capabilityResolver.isMethodSupported('auth', 'auth/loginWithOAuth'), 'Kward backend does not support OAuth login yet.');
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
    this.requireCapability('auth.logoutProvider', this.capabilityResolver.isMethodSupported('auth', 'auth/logoutProvider'), 'Kward backend does not support auth logout yet.');
    const result = await this.request('auth/logoutProvider', { providerId });
    return normalizeAuthActionResult(result, providerId, `Logged out of ${providerId}.`);
  }

  public async setModel(provider: string, modelId: string): Promise<PiModel> {
    await this.ensureInitialized();
    const normalizedProvider = normalizeKwardProvider(provider);
    const result = await this.request('models/set', { ...(normalizedProvider ? { provider: normalizedProvider } : {}), model: modelId });
    return mapKwardCurrentModel(normalizeModel(result));
  }

  public async setThinkingLevel(level: string): Promise<void> {
    await this.ensureInitialized();
    await this.request('reasoning/set', { effort: level });
  }

  public async updateRuntimeSetting(settingId: PiSettingId, value: SettingValue): Promise<{ applied: 'live' | 'reload'; message?: string }> {
    await this.ensureInitialized();

    if (settingId === 'defaultModel') {
      const selected = await this.resolveModelSelection(value);
      await this.setModel(selected.provider, selected.modelId);
      return { applied: 'live', message: 'Model updated for this session.' };
    }

    this.requireCapability('runtimeSettings', this.capabilityResolver.isRuntimeSettingSupported(settingId), `Kward backend does not support runtime setting: ${settingId}.`);
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

  private async resolveModelSelection(value: SettingValue): Promise<{ provider: string; modelId: string }> {
    if (typeof value !== 'string') {
      throw new Error('Model must be a non-empty string.');
    }

    const modelRef = value.trim();
    if (!modelRef) {
      throw new Error('Model must be a non-empty string.');
    }

    const availableModels = (await this.getAvailableModels()).models ?? [];
    const selected = availableModels.find((model) => model.provider && model.id && `${model.provider}/${model.id}` === modelRef);
    if (selected?.provider && selected.id) {
      return { provider: selected.provider, modelId: selected.id };
    }

    const slashIndex = modelRef.indexOf('/');
    if (slashIndex <= 0 || slashIndex === modelRef.length - 1) {
      throw new Error(`Model must include a provider: ${modelRef}`);
    }

    return {
      provider: modelRef.slice(0, slashIndex),
      modelId: modelRef.slice(slashIndex + 1)
    };
  }

  public async setSessionName(name: string): Promise<void> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/rename', { sessionId: requiredString(session.id, 'Kward session id'), name });
    this.session = normalizeSession(result);
  }

  public async compact(customInstructions?: string): Promise<PiCompactResult> {
    await this.ensureInitialized();
    this.requireCapability('sessions.compact', this.capabilityResolver.isSessionFeatureSupported('compact'), 'Kward backend does not support compaction from Tauren yet.');
    const session = await this.ensureSession();
    const result = normalizeCompactResult(await this.request('sessions/compact', {
      sessionId: requiredString(session.id, 'Kward session id'),
      ...(customInstructions ? { customInstructions } : {})
    }));
    return {
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.firstKeptEntryId ? { firstKeptEntryId: result.firstKeptEntryId } : {}),
      ...(result.tokensBefore !== undefined ? { tokensBefore: result.tokensBefore } : {}),
      ...(result.details !== undefined ? { details: result.details } : {})
    };
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
    this.sessionPromise = undefined;
    const result = await this.request('sessions/resume', { path: sessionPath, workspaceRoot: this.options.cwd });
    this.session = normalizeSession(result);
    this.currentTurnId = undefined;
    this.applyPendingExtensionFooter(this.session);
    return {};
  }

  public async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<PiImportSessionResult> {
    await this.ensureInitialized();
    this.requireCapability('sessions.import', this.capabilityResolver.isSessionFeatureSupported('import'), 'Kward backend does not support Tauren session import yet.');
    const result = normalizeImportResult(await this.request('sessions/import', {
      path: inputPath,
      workspaceRoot: this.options.cwd,
      ...(cwdOverride ? { cwdOverride } : {})
    }));
    if (result.session) {
      this.session = result.session;
      this.currentTurnId = undefined;
      this.applyPendingExtensionFooter(this.session);
    }
    return { cancelled: result.cancelled };
  }

  public async getSessionTree(): Promise<WebviewTreeItem[]> {
    await this.ensureInitialized();
    if (!this.capabilityResolver.isSessionFeatureSupported('tree')) {
      return this.getSessionAncestryTree();
    }

    const session = await this.ensureSession();
    const result = normalizeTreeResult(await this.request('sessions/tree', { sessionId: requiredString(session.id, 'Kward session id') }));
    return result.items?.map(normalizeTreeItem).filter(isDefined) ?? [];
  }

  public async setTreeEntryLabel(entryId: string, label: string | undefined): Promise<void> {
    await this.ensureInitialized();
    this.requireCapability('sessions.tree.labels', this.capabilityResolver.isTreeFeatureSupported('labels'), 'Kward backend does not support session tree labels yet.');
    const session = await this.ensureSession();
    await this.request('sessions/tree/setLabel', {
      sessionId: requiredString(session.id, 'Kward session id'),
      entryId,
      label: label ?? null
    });
  }

  public async navigateTree(entryId: string, options: { summarize?: boolean; customInstructions?: string } = {}): Promise<PiNavigateTreeResult> {
    await this.ensureInitialized();
    if (!this.capabilityResolver.isTreeFeatureSupported('navigate')) {
      if (options.summarize || options.customInstructions) {
        throw new Error('Kward backend does not support summarized session tree navigation yet.');
      }

      await this.switchSession(entryId);
      return {};
    }

    if (options.summarize) {
      this.requireCapability('sessions.tree.summarize', this.capabilityResolver.isTreeFeatureSupported('summarize'), 'Kward backend does not support summarized session tree navigation yet.');
    }

    const session = await this.ensureSession();
    const result = normalizeNavigateTreeResult(await this.request('sessions/tree/navigate', {
      sessionId: requiredString(session.id, 'Kward session id'),
      entryId,
      summarize: options.summarize ?? false,
      ...(options.customInstructions ? { customInstructions: options.customInstructions } : {})
    }));
    if (result.session) {
      this.session = result.session;
      this.currentTurnId = undefined;
      this.applyPendingExtensionFooter(this.session);
    }
    return {
      ...(result.editorText ? { editorText: result.editorText } : {}),
      ...(result.cancelled !== undefined ? { cancelled: result.cancelled } : {}),
      ...(result.aborted !== undefined ? { aborted: result.aborted } : {})
    };
  }

  public async getForkMessages(): Promise<PiForkMessagesResult> {
    await this.ensureInitialized();
    this.requireCapability('sessions.fork', this.capabilityResolver.isSessionFeatureSupported('fork'), 'Kward backend does not support session forking yet.');
    const session = await this.ensureSession();
    const result = await this.request('sessions/forkMessages', { sessionId: requiredString(session.id, 'Kward session id') });
    return normalizeForkMessagesResult(result);
  }

  public async fork(entryId: string): Promise<PiForkResult> {
    await this.ensureInitialized();
    this.requireCapability('sessions.fork', this.capabilityResolver.isSessionFeatureSupported('fork'), 'Kward backend does not support session forking yet.');
    const session = await this.ensureSession();
    const result = normalizeForkResult(await this.request('sessions/fork', {
      sessionId: requiredString(session.id, 'Kward session id'),
      entryId
    }));
    if (result.session) {
      this.session = result.session;
      this.currentTurnId = undefined;
      this.applyPendingExtensionFooter(this.session);
    }
    return { text: result.text, cancelled: result.cancelled };
  }

  public async clone(): Promise<PiCloneResult> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/clone', { sessionId: requiredString(session.id, 'Kward session id') });
    this.session = normalizeSession(result);
    this.currentTurnId = undefined;
    this.applyPendingExtensionFooter(this.session);
    return {};
  }

  public async deleteSession(sessionPath?: string): Promise<boolean> {
    await this.ensureInitialized();
    this.requireCapability('sessions.delete', this.capabilityResolver.isMethodSupported('sessions', 'sessions/delete'), 'Kward backend does not support session deletion yet.');
    const session = sessionPath
      ? normalizeSession(await this.request('sessions/resume', { path: sessionPath, workspaceRoot: this.options.cwd }))
      : await this.ensureSession();
    const result = await this.request('sessions/delete', { sessionId: requiredString(session.id, 'Kward session id') });

    if (!isRecord(result) || result.deleted !== false) {
      if (!sessionPath || normalizeSessionPath(session.path) === normalizeSessionPath(this.session?.path)) {
        this.session = undefined;
        this.sessionPromise = undefined;
        this.currentTurnId = undefined;
        this.clearExtensionFooter();
      }
      return true;
    }

    return false;
  }

  public async closeSession(): Promise<void> {
    if (this.disposed || !this.session) {
      return;
    }

    await this.ensureInitialized();
    if (!this.capabilityResolver.isMethodSupported('sessions', 'sessions/close')) {
      return;
    }

    const session = this.session;
    await this.request('sessions/close', { sessionId: requiredString(session.id, 'Kward session id') });
    if (this.session === session) {
      this.session = undefined;
      this.sessionPromise = undefined;
      this.currentTurnId = undefined;
      this.clearExtensionFooter();
    }
  }

  public async answerQuestion(sessionId: string, questionRequestId: string, answers: unknown[]): Promise<void> {
    await this.ensureInitialized();
    await this.request(this.capabilityResolver.getQuestionAnswerMethod(), { sessionId, questionRequestId, answers });
  }

  public async getMemoryStatus(): Promise<KwardMemoryStatus> {
    return normalizeMemoryStatus(await this.requestMemory('memory/status'));
  }

  public async setMemoryEnabled(enabled: boolean): Promise<KwardMemoryStatus> {
    const result = await this.requestMemory(enabled ? 'memory/enable' : 'memory/disable');
    return { ...(await this.getMemoryStatus()), ...normalizeMemoryStatus(result) };
  }

  public async setMemoryAutoSummary(autoSummary: boolean): Promise<KwardMemoryStatus> {
    const result = await this.requestMemory(autoSummary ? 'memory/autoSummary/enable' : 'memory/autoSummary/disable');
    return { ...(await this.getMemoryStatus()), ...normalizeMemoryStatus(result) };
  }

  public async listMemory(options: { includeInactive?: boolean } = {}): Promise<KwardMemoryList> {
    return normalizeMemoryList(await this.requestMemory('memory/list', {
      workspaceRoot: this.options.cwd,
      ...(options.includeInactive !== undefined ? { includeInactive: options.includeInactive } : {})
    }));
  }

  public async addMemory(text: string, options: { core?: boolean; scope?: string; tags?: string[] } = {}): Promise<KwardMemoryRecord> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error('Memory text cannot be empty.');
    }

    const result = await this.requestMemory(options.core ? 'memory/addCore' : 'memory/add', {
      text: trimmedText,
      scope: options.scope ?? 'workspace',
      ...(options.tags && options.tags.length > 0 ? { tags: options.tags } : {})
    });
    return normalizeMemoryResult(result);
  }

  public async forgetMemory(id: string): Promise<boolean> {
    const result = await this.requestMemory('memory/forget', { id: requireNonEmptyMemoryId(id) });
    return isRecord(result) ? result.forgotten !== false : true;
  }

  public async promoteMemory(id: string): Promise<KwardMemoryRecord> {
    return normalizeMemoryResult(await this.requestMemory('memory/promote', { id: requireNonEmptyMemoryId(id) }));
  }

  public async relaxMemory(id: string): Promise<KwardMemoryRecord> {
    return normalizeMemoryResult(await this.requestMemory('memory/relax', {
      id: requireNonEmptyMemoryId(id),
      workspaceRoot: this.options.cwd
    }));
  }

  public async inspectMemory(): Promise<KwardMemoryInspect> {
    return normalizeMemoryInspect(await this.requestMemory('memory/inspect'));
  }

  public async whyMemory(): Promise<KwardMemoryWhy> {
    const session = await this.ensureSession();
    return normalizeMemoryWhy(await this.requestMemory('memory/why', { sessionId: requiredString(session.id, 'Kward session id') }));
  }

  public async summarizeMemory(): Promise<KwardMemorySummarize> {
    const session = await this.ensureSession();
    return normalizeMemorySummarize(await this.requestMemory('memory/summarize', { sessionId: requiredString(session.id, 'Kward session id') }));
  }

  public dispose(): void {
    this.disposed = true;
    this.transport?.dispose();
    this.transport = undefined;
    this.initializePromise = undefined;
    this.session = undefined;
    this.sessionPromise = undefined;
    this.capabilities = {};
    this.capabilityResolver = new KwardCapabilityResolver(this.capabilities);
    this.currentTurnId = undefined;
    this.pendingKwardFooters.clear();
    this.protocolWarningShown = false;
    this.clearExtensionFooter();
    this.eventListeners.clear();
    this.errorListeners.clear();
  }

  private async getTranscript(): Promise<KwardTranscriptResult> {
    const session = await this.ensureSession();
    const result = await this.requestForSession('sessions/transcript', session);
    const transcript = normalizeTranscript(result);
    if (transcript.session) {
      this.session = transcript.session;
    }
    return transcript;
  }

  private async getSessionAncestryTree(): Promise<WebviewTreeItem[]> {
    const session = await this.ensureSession();
    const result = await this.request('sessions/list', { workspaceRoot: this.options.cwd, limit: 100 });
    const items = normalizeSessionListTreeItems(result, session.path);
    if (items.length === 0 && session.path) {
      return [{
        entryId: session.path,
        role: 'session',
        text: formatSessionTreeText(session),
        current: true,
        depth: 0,
        isLast: true,
        ancestorContinues: [],
        activePath: true,
        prefix: ''
      }];
    }

    return items;
  }

  private async ensureSession(): Promise<KwardSession> {
    await this.ensureInitialized();

    if (this.session) {
      return this.session;
    }

    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    let sessionPromise!: Promise<KwardSession>;
    sessionPromise = this.createSession().then((session) => {
      if (this.sessionPromise === sessionPromise) {
        this.session = session;
        this.sessionPromise = undefined;
        this.applyPendingExtensionFooter(session);
      }

      return session;
    }).catch((error) => {
      if (this.sessionPromise === sessionPromise) {
        this.sessionPromise = undefined;
      }

      throw error;
    });
    this.sessionPromise = sessionPromise;
    return sessionPromise;
  }

  private async createSession(): Promise<KwardSession> {
    const createParams = this.options.resumeLastSession === undefined
      ? { workspaceRoot: this.options.cwd }
      : { workspaceRoot: this.options.cwd, resumeLast: this.options.resumeLastSession };
    const result = this.options.sessionFile
      ? await this.request('sessions/resume', { path: this.options.sessionFile, workspaceRoot: this.options.cwd })
      : await this.request('sessions/create', createParams);
    return normalizeSession(result);
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
    this.initializePromise = this.request('initialize').then((result) => {
      const initializeResult = normalizeInitializeResult(result);
      this.capabilities = initializeResult.capabilities ?? {};
      this.capabilityResolver = new KwardCapabilityResolver(this.capabilities);
      this.showProtocolWarning(initializeResult);
      this.showStartupWarning();
    });

    return this.initializePromise;
  }

  private async requestForSession(method: string, session: KwardSession, params: Record<string, unknown> = {}): Promise<unknown> {
    const sessionId = requiredString(session.id, 'Kward session id');

    try {
      const result = await this.request(method, { sessionId, ...params });

      if (!this.isCurrentRpcSession(sessionId)) {
        throw new StaleKwardSessionRequestError(method, sessionId);
      }

      return result;
    } catch (error) {
      if (!this.isCurrentRpcSession(sessionId) && isUnknownSessionError(error)) {
        throw new StaleKwardSessionRequestError(method, sessionId);
      }

      throw error;
    }
  }

  private async requestMemory(method: string, params?: unknown): Promise<unknown> {
    await this.ensureInitialized();
    this.requireCapability('memory', this.capabilityResolver.isMemorySupported(), 'Kward backend does not support memory yet.');
    this.requireCapability(method, this.capabilityResolver.isMemoryMethodSupported(method), `Kward backend does not support ${method} yet.`);
    return this.request(method, params);
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
      if (event.sessionId && !this.isCurrentRpcSession(event.sessionId)) {
        return;
      }
      for (const mapped of this.eventNormalizer.map(event)) {
        this.emitEvent(mapped);
      }
      if (event.type === 'turnFinished') {
        this.currentTurnId = undefined;
      }
      return;
    }

    if (notification.method === this.capabilityResolver.getCompactionNotificationMethod()) {
      const event = normalizeTurnEvent(notification.params);
      if (event.sessionId && !this.isCurrentRpcSession(event.sessionId)) {
        return;
      }
      for (const mapped of this.eventNormalizer.map(event)) {
        this.emitEvent(mapped);
      }
      return;
    }

    if (notification.method === this.capabilityResolver.getQuestionNotificationMethod()) {
      const request = normalizeQuestionRequest(notification.params);
      if (request && this.isCurrentRpcSession(request.sessionId)) {
        this.emitEvent({ type: 'kward_ui_question', request });
      }
      return;
    }

    if (notification.method === 'ui/footer') {
      const footer = normalizeFooterUpdate(notification.params);
      if (footer && (!footer.sessionId || this.isCurrentRpcSession(footer.sessionId))) {
        this.setExtensionFooter(footer.text);
      } else if (footer?.sessionId) {
        this.pendingKwardFooters.set(footer.sessionId, footer.text);
      }
      return;
    }

    if (notification.method === 'auth/loginFinished') {
      return;
    }
  }

  private isCurrentRpcSession(sessionId: string): boolean {
    return this.session?.id === sessionId;
  }

  private setExtensionFooter(text: string): void {
    if (!text) {
      this.clearExtensionFooter();
      return;
    }

    if (this.kwardFooterText === text) {
      return;
    }

    this.kwardFooterText = text;
    if (this.options.extensionUi?.setFooterText) {
      this.options.extensionUi.setFooterText(text);
      return;
    }

    this.options.extensionUi?.setFooter?.(() => ({
      render: () => [text],
      invalidate: () => undefined
    }));
  }

  private clearExtensionFooter(): void {
    if (this.kwardFooterText === undefined) {
      return;
    }

    this.kwardFooterText = undefined;
    if (this.options.extensionUi?.setFooterText) {
      this.options.extensionUi.setFooterText(undefined);
      return;
    }

    this.options.extensionUi?.setFooter?.(undefined);
  }

  private applyPendingExtensionFooter(session: KwardSession | undefined): void {
    if (!session?.id || !this.pendingKwardFooters.has(session.id)) {
      this.clearExtensionFooter();
      return;
    }

    const text = this.pendingKwardFooters.get(session.id) ?? '';
    this.pendingKwardFooters.delete(session.id);
    this.setExtensionFooter(text);
  }

  private refreshSessionIdentityFromRuntime(value: unknown, fallbackSession: KwardSession): void {
    if (!isRecord(value)) {
      return;
    }

    const rpcSessionId = getString(value, 'rpcSessionId');
    const persistentId = getString(value, 'persistentSessionId') ?? getString(value, 'sessionId');
    const sessionFile = getString(value, 'sessionFile');
    const sessionName = getString(value, 'sessionName');

    if (!rpcSessionId && !persistentId && !sessionFile && !sessionName) {
      return;
    }

    const current = this.session ?? fallbackSession;
    this.session = {
      ...current,
      id: rpcSessionId ?? current.id,
      persistentId: persistentId ?? current.persistentId,
      path: sessionFile ?? current.path,
      ...(sessionName !== undefined ? { name: sessionName } : {})
    };
  }

  private requireCapability(name: string, supported: boolean, message: string): void {
    if (!supported) {
      throw new Error(`${message} (${name})`);
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

  private showProtocolWarning(result: KwardInitializeResult): void {
    if (this.protocolWarningShown || result.protocolVersion === undefined || result.protocolVersion === supportedKwardProtocolVersion) {
      return;
    }

    this.protocolWarningShown = true;
    this.options.showNotification?.(
      `Kward RPC protocol version ${result.protocolVersion} differs from Tauren's supported version ${supportedKwardProtocolVersion}. Some Kward features may not work as expected.`,
      'warning'
    );
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

function normalizeInitializeResult(value: unknown): KwardInitializeResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    protocolVersion: getNumber(value, 'protocolVersion'),
    serverName: getString(value, 'serverName'),
    capabilities: isRecord(value.capabilities) ? value.capabilities : {}
  };
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

function normalizePromptExpansion(value: unknown): { input?: string } {
  if (typeof value === 'string') {
    return { input: value };
  }

  if (!isRecord(value)) {
    return {};
  }

  return {
    input: getString(value, 'input') ?? getString(value, 'text') ?? getString(value, 'prompt')
  };
}

function normalizeSessionState(value: unknown, fallbackSession: KwardSession, scopedModelsSupported: boolean): PiSessionState {
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
    sessionId: getString(value, 'persistentSessionId') ?? getString(value, 'sessionId') ?? fallbackSession.persistentId ?? fallbackSession.id,
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
    enabledModels: scopedModelsSupported ? getStringArray(value.enabledModels) : undefined,
    enableSkillCommands: getBoolean(value, 'enableSkillCommands'),
    activePersonaLabel: getString(value, 'activePersonaLabel'),
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
    sessionId: getString(value, 'persistentSessionId') ?? getString(value, 'sessionId') ?? fallbackSession.persistentId ?? fallbackSession.id,
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

function normalizeKwardProvider(provider: string | undefined): string | undefined {
  switch (provider?.trim().toLowerCase()) {
    case 'codex':
    case 'openai':
      return 'Codex';
    case 'openrouter':
      return 'OpenRouter';
    case 'copilot':
      return 'Copilot';
    default:
      return provider?.trim() || undefined;
  }
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

function normalizeCompactResult(value: unknown): KwardCompactResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    summary: getString(value, 'summary'),
    firstKeptEntryId: getString(value, 'firstKeptEntryId'),
    tokensBefore: getNumber(value, 'tokensBefore'),
    details: value.details
  };
}

function normalizeImportResult(value: unknown): KwardImportResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    session: value.session ? normalizeSession(value.session) : undefined,
    cancelled: getBoolean(value, 'cancelled')
  };
}

function normalizeTreeResult(value: unknown): KwardTreeResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    items: Array.isArray(value.items) ? value.items : undefined
  };
}

function normalizeSessionListTreeItems(value: unknown, currentSessionPath: string | undefined): WebviewTreeItem[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return [];
  }

  return value.sessions.map((session) => normalizeSessionListTreeItem(session, currentSessionPath)).filter(isDefined);
}

function normalizeSessionListTreeItem(value: unknown, currentSessionPath: string | undefined): WebviewTreeItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const path = getString(value, 'path');
  if (!path) {
    return undefined;
  }

  const current = Boolean(currentSessionPath && path === currentSessionPath);
  const depth = getNumber(value, 'depth') ?? 0;
  const isLast = getBoolean(value, 'isLast') ?? false;
  const ancestorContinues = Array.isArray(value.ancestorContinues) ? value.ancestorContinues.filter((entry): entry is boolean => typeof entry === 'boolean') : [];

  return {
    entryId: path,
    role: 'session',
    text: formatSessionTreeText(normalizeSession(value)),
    current,
    depth,
    isLast,
    ancestorContinues,
    activePath: current,
    selectable: true,
    prefix: buildTreePrefix(depth, isLast, ancestorContinues)
  };
}

function formatSessionTreeText(session: KwardSession): string {
  const name = typeof session.name === 'string' ? session.name.trim() : '';
  if (name) {
    return name;
  }

  const firstMessage = typeof session.firstMessage === 'string' ? session.firstMessage.trim() : '';
  if (firstMessage) {
    return firstMessage;
  }

  return session.path ? path.basename(session.path) : 'Current session';
}

function buildTreePrefix(depth: number, isLast: boolean, ancestorContinues: boolean[]): string {
  if (depth <= 0) {
    return '';
  }

  const parts: string[] = ancestorContinues.slice(0, Math.max(0, depth - 1)).map((continues) => continues ? '│  ' : '   ');
  parts.push(isLast ? '└─ ' : '├─ ');
  return parts.join('');
}

function normalizeTreeItem(value: unknown): WebviewTreeItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entryId = getString(value, 'entryId');
  if (!entryId) {
    return undefined;
  }

  return {
    entryId,
    parentId: getString(value, 'parentId'),
    role: getString(value, 'role') ?? 'message',
    text: getString(value, 'text') ?? '',
    current: getBoolean(value, 'current') ?? false,
    depth: getNumber(value, 'depth'),
    isLast: getBoolean(value, 'isLast'),
    ancestorContinues: Array.isArray(value.ancestorContinues) ? value.ancestorContinues.filter((entry): entry is boolean => typeof entry === 'boolean') : undefined,
    activePath: getBoolean(value, 'activePath'),
    selectable: getBoolean(value, 'selectable'),
    label: getString(value, 'label'),
    labelTimestamp: getString(value, 'labelTimestamp'),
    prefix: getString(value, 'prefix')
  };
}

function normalizeNavigateTreeResult(value: unknown): KwardNavigateTreeResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    session: value.session ? normalizeSession(value.session) : undefined,
    editorText: getString(value, 'editorText'),
    cancelled: getBoolean(value, 'cancelled'),
    aborted: getBoolean(value, 'aborted')
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

function normalizeFooterUpdate(value: unknown): { sessionId?: string; text: string } | undefined {
  if (typeof value === 'string') {
    return { text: value };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const text = getString(value, 'text') ?? getString(value, 'footer') ?? getString(value, 'line');
  if (text === undefined) {
    return undefined;
  }

  return {
    sessionId: getString(value, 'sessionId'),
    text
  };
}

function normalizeMemoryStatus(value: unknown): KwardMemoryStatus {
  const record = isRecord(value) ? value : {};
  const paths = isRecord(record.paths) ? record.paths : undefined;
  return {
    enabled: getBoolean(record, 'enabled') ?? false,
    autoSummary: getBoolean(record, 'autoSummary') ?? false,
    ...(paths ? {
      paths: {
        core: getString(paths, 'core'),
        soft: getString(paths, 'soft'),
        events: getString(paths, 'events')
      }
    } : {})
  };
}

function normalizeMemoryList(value: unknown): KwardMemoryList {
  const record = isRecord(value) ? value : {};
  return {
    globalCore: normalizeMemoryRecords(record.global_core),
    workspaceCore: normalizeMemoryRecords(record.workspace_core),
    workspaceSoft: normalizeMemoryRecords(record.workspace_soft)
  };
}

function normalizeMemoryInspect(value: unknown): KwardMemoryInspect {
  const record = isRecord(value) ? value : {};
  return {
    ...normalizeMemoryStatus(record),
    core: normalizeMemoryRecords(record.core),
    soft: normalizeMemoryRecords(record.soft)
  };
}

function normalizeMemoryWhy(value: unknown): KwardMemoryWhy {
  const record = isRecord(value) ? value : {};
  return {
    message: getString(record, 'message'),
    explanation: getString(record, 'explanation'),
    memories: normalizeMemoryRecords(record.memories)
  };
}

function normalizeMemorySummarize(value: unknown): KwardMemorySummarize {
  const record = isRecord(value) ? value : {};
  return { memories: normalizeMemoryRecords(record.memories) };
}

function normalizeMemoryResult(value: unknown): KwardMemoryRecord {
  const record = isRecord(value) && isRecord(value.memory) ? value.memory : value;
  return normalizeMemoryRecord(record) ?? {};
}

function normalizeMemoryRecords(value: unknown): KwardMemoryRecord[] {
  return Array.isArray(value) ? value.map(normalizeMemoryRecord).filter(isDefined) : [];
}

function normalizeMemoryRecord(value: unknown): KwardMemoryRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    id: getString(value, 'id'),
    text: getString(value, 'text'),
    scope: getString(value, 'scope'),
    tags: getStringArray(value.tags),
    active: getBoolean(value, 'active'),
    confidence: getNumber(value, 'confidence'),
    createdAt: getString(value, 'createdAt') ?? getString(value, 'created_at'),
    updatedAt: getString(value, 'updatedAt') ?? getString(value, 'updated_at')
  };
}

function requireNonEmptyMemoryId(id: string): string {
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error('Memory id cannot be empty.');
  }

  return trimmedId;
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

function isUnknownSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unknown session:/i.test(message);
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
