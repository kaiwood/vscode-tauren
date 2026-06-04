import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PiClient } from '../pi/clientTypes';
import type {
  PiAvailableCommands,
  PiAgentMessage,
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
  PiPromptStreamingBehavior,
  PiSessionState,
  PiSessionStats,
  PiSwitchSessionResult
} from '../pi/types';
import type { PiSettingId, SettingValue } from '../settings/settingsRegistry';
import type { WebviewTreeItem } from '../webviewProtocol/types';
import { isRecord } from '../shared/typeGuards';
import { KwardRpcTransport, type KwardJsonRpcNotification } from './rpcTransport';
import { mapKwardTurnEvent } from './eventMapper';
import type { KwardModel, KwardQuestionRequest, KwardSession, KwardTranscriptResult, KwardTurn, KwardTurnEvent } from './types';

export type KwardClientOptions = {
  cwd?: string;
  sessionFile?: string;
  kwardPath?: string;
  showNotification?: (message: string, notifyType: string) => void;
};

const defaultKwardPath = '/Users/kwood/Repositories/github.com/kaiwood/kward';
const unsupportedKwardFeatureMessage = 'This feature is not available with the experimental Kward backend yet.';

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

  public async prompt(message: string, _streamingBehavior?: PiPromptStreamingBehavior, images?: PiImageContent[]): Promise<void> {
    if (images && images.length > 0) {
      throw new Error('Kward backend does not support image prompts in Tauren yet.');
    }

    const session = await this.ensureSession();
    const result = await this.request('turns/start', { sessionId: requiredString(session.id, 'Kward session id'), input: message });
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
    throw new Error('unknown command: reload');
  }

  public async getState(): Promise<PiSessionState> {
    const [session, model] = await Promise.all([
      this.ensureSession(),
      this.getCurrentModel().catch(() => undefined)
    ]);

    return {
      model: model ? mapKwardCurrentModel(model) : undefined,
      thinkingLevel: model?.reasoningEffort,
      sessionFile: session.path,
      sessionId: session.persistentId ?? session.id,
      sessionName: typeof session.name === 'string' ? session.name : undefined,
      transport: 'kward',
      quietStartup: false
    };
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    const transcript = await this.getTranscript();
    const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
    const session = transcript.session ?? this.session;

    return {
      sessionFile: session?.path,
      sessionId: session?.persistentId ?? session?.id,
      sessionName: typeof session?.name === 'string' ? session.name : undefined,
      userMessages: messages.filter((message) => message.role === 'user').length,
      assistantMessages: messages.filter((message) => message.role === 'assistant').length,
      toolCalls: messages.filter((message) => message.role === 'toolResult').length,
      totalMessages: messages.length
    };
  }

  public async getAvailableModels(): Promise<PiAvailableModels> {
    await this.ensureInitialized();
    const result = await this.request('models/list');
    const models = isRecord(result) && Array.isArray(result.models) ? result.models : [];
    return { models: models.map(mapKwardListModel).filter(Boolean) as PiModel[] };
  }

  public async getCommands(): Promise<PiAvailableCommands> {
    return { commands: [] };
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
    if (settingId === 'defaultModel' && typeof value === 'string') {
      const current = await this.getCurrentModel().catch(() => undefined);
      await this.setModel(current?.provider ?? '', value);
      return { applied: 'live' };
    }

    if (settingId === 'defaultThinkingLevel' && typeof value === 'string') {
      await this.setThinkingLevel(value);
      return { applied: 'live' };
    }

    throw new Error(`Kward backend does not support runtime setting ${settingId} yet.`);
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
    return { messages: [] };
  }

  public async fork(_entryId: string): Promise<PiForkResult> {
    throw new Error('Fork is not available with Kward yet. Use /clone instead.');
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

  private async getCurrentModel(): Promise<KwardModel> {
    await this.ensureInitialized();
    return normalizeModel(await this.request('models/current'));
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
      this.emitError('Kward auth finished, but Tauren Kward auth UI is not wired yet.');
    }
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
    current: typeof value.current === 'boolean' ? value.current : undefined
  };
}

function mapKwardCurrentModel(model: KwardModel): PiModel {
  const id = model.id ?? model.model;
  return {
    provider: model.provider,
    id,
    name: model.name ?? id,
    reasoning: model.reasoning ?? Boolean(model.reasoningEffort)
  };
}

function mapKwardListModel(value: unknown): PiModel | undefined {
  const model = normalizeModel(value);
  const id = model.id ?? model.model;
  return id ? { provider: model.provider, id, name: model.name ?? id, reasoning: model.reasoning ?? model.provider === 'Codex' } : undefined;
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

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((entry) => isRecord(entry) && typeof entry.text === 'string' ? entry.text : '').join('');
  }

  return '';
}
