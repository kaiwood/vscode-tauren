import type { WebviewModelOption, WebviewSlashCommand, WebviewStartupResourceSection } from '../webviewProtocol/types';
import type { AgentCommand, AgentMessagesResult, AgentModel, AgentSessionState, AgentSessionStats, AgentStartupResources } from '../agent/types';
import { isStaleKwardSessionRequestError } from '../controller/errors';
import type {
  TaurenChatContextUsage,
  TaurenChatModelMeta,
  TaurenChatSessionMetaSnapshot,
  SessionMetadataWebviewState,
  PiRuntimeSettingsMeta
} from './types';

export type {
  TaurenChatContextUsage,
  TaurenChatSessionMetaSnapshot,
  SessionMetadataWebviewState
} from './types';

export type SessionMetadataStateOptions = {
  initialSessionMeta?: TaurenChatSessionMetaSnapshot;
  onChange?: (metadata: TaurenChatSessionMetaSnapshot) => void;
  postState?: () => void;
};

export type SessionMetadataClient = {
  getMessages(): Promise<AgentMessagesResult>;
  getState(): Promise<AgentSessionState>;
  getSessionStats(): Promise<AgentSessionStats>;
  getAvailableModels(): Promise<{ models?: AgentModel[] }>;
  getCommands(): Promise<{ commands?: AgentCommand[] }>;
  getStartupResources?(): Promise<AgentStartupResources>;
};

export type SessionMetadataRefreshControllerOptions = {
  state: SessionMetadataState;
  getSessionGeneration: () => number;
  getClient: (options: { startClient?: boolean }) => SessionMetadataClient | undefined;
  restoreInitialSessionHistory: (
    client: SessionMetadataClient,
    sessionGeneration: number,
    isCurrent: () => boolean
  ) => Promise<void>;
  applySessionState: (state: AgentSessionState) => { sessionFileChanged: boolean; sessionNameChanged: boolean };
  applySessionStatsIdentity: (stats: AgentSessionStats) => { sessionFileChanged: boolean; sessionNameChanged: boolean };
  refreshSessions: () => void;
  postState: () => void;
  onMetadataStartError: (message: string) => void;
  onError: (message: string) => void;
  getErrorMessage: (error: unknown) => string;
};

export class SessionMetadataRefreshController {
  private metadataRefreshSequence = 0;
  private slashCommandsRefreshSequence = 0;
  private metadataRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private contextUsageRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;
  private slashCommandsRefreshInFlight: { generation: number; promise: Promise<void> } | undefined;

  public constructor(private readonly options: SessionMetadataRefreshControllerOptions) {}

  public refreshSessionMeta(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.options.getSessionGeneration();
    const existingRefresh = this.metadataRefreshInFlight;

    if (!options.force && existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    const refreshId = ++this.metadataRefreshSequence;
    let refreshPromise!: Promise<void>;

    refreshPromise = this.runSessionMetaRefresh(options, sessionGeneration, refreshId)
      .finally(() => {
        if (this.metadataRefreshInFlight?.promise === refreshPromise) {
          this.metadataRefreshInFlight = undefined;
        }
      });

    this.metadataRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

    return refreshPromise;
  }

  public refreshContextUsage(options: { startClient?: boolean; silent?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.options.getSessionGeneration();
    const existingRefresh = this.contextUsageRefreshInFlight;

    if (existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    let refreshPromise!: Promise<void>;

    refreshPromise = this.runContextUsageRefresh(options, sessionGeneration)
      .finally(() => {
        if (this.contextUsageRefreshInFlight?.promise === refreshPromise) {
          this.contextUsageRefreshInFlight = undefined;
        }
      });

    this.contextUsageRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

    return refreshPromise;
  }

  public refreshSlashCommands(options: { startClient?: boolean; force?: boolean } = {}): Promise<void> {
    const sessionGeneration = this.options.getSessionGeneration();
    const existingRefresh = this.slashCommandsRefreshInFlight;

    if (!options.force && existingRefresh?.generation === sessionGeneration) {
      return existingRefresh.promise;
    }

    const refreshId = ++this.slashCommandsRefreshSequence;
    let refreshPromise!: Promise<void>;

    refreshPromise = this.runSlashCommandsRefresh(options, sessionGeneration, refreshId)
      .finally(() => {
        if (this.slashCommandsRefreshInFlight?.promise === refreshPromise) {
          this.slashCommandsRefreshInFlight = undefined;
        }
      });

    this.slashCommandsRefreshInFlight = { generation: sessionGeneration, promise: refreshPromise };

    return refreshPromise;
  }

  public invalidate(): void {
    this.metadataRefreshSequence += 1;
    this.slashCommandsRefreshSequence += 1;
    this.metadataRefreshInFlight = undefined;
    this.contextUsageRefreshInFlight = undefined;
    this.slashCommandsRefreshInFlight = undefined;
    this.options.state.clearRefreshing();
  }

  private async runSessionMetaRefresh(
    options: { startClient?: boolean },
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    let client: SessionMetadataClient | undefined;

    try {
      client = this.options.getClient(options);
    } catch (error) {
      if (sessionGeneration === this.options.getSessionGeneration()) {
        this.options.onMetadataStartError(this.options.getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    this.options.state.setMetadataRefreshing(true);

    let handledError = false;
    const handleRefreshError = (error: unknown): void => {
      if (handledError || isStaleKwardSessionRequestError(error) || !this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        return;
      }

      handledError = true;
      this.options.onError(this.options.getErrorMessage(error));
    };

    try {
      await Promise.all([
        this.options.restoreInitialSessionHistory(client, sessionGeneration, () => this.isCurrentMetadataRefresh(sessionGeneration, refreshId)),
        this.refreshModelMeta(client, sessionGeneration, refreshId),
        this.refreshContextUsageForMetadata(client, sessionGeneration, refreshId),
        this.refreshModelOptions(client, sessionGeneration, refreshId),
        this.refreshStartupResources(client, sessionGeneration, refreshId)
      ].map((refresh) => refresh.catch(handleRefreshError)));
    } finally {
      if (this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
        this.options.state.setMetadataRefreshing(false);
      }
    }
  }

  private async refreshModelMeta(
    client: SessionMetadataClient,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const state = await client.getState();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    const { sessionFileChanged, sessionNameChanged } = this.options.applySessionState(state);

    if (sessionFileChanged) {
      this.options.refreshSessions();
    }

    if (sessionNameChanged || this.options.state.applyModelState(state)) {
      this.options.postState();
    }
  }

  private async refreshContextUsageForMetadata(
    client: SessionMetadataClient,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const stats = await client.getSessionStats();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    this.applySessionStats(stats);
  }

  private async runContextUsageRefresh(
    options: { startClient?: boolean; silent?: boolean },
    sessionGeneration: number
  ): Promise<void> {
    let client: SessionMetadataClient | undefined;

    try {
      client = this.options.getClient(options);
    } catch (error) {
      if (!options.silent && sessionGeneration === this.options.getSessionGeneration()) {
        this.options.onError(this.options.getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    try {
      const stats = await client.getSessionStats();

      if (sessionGeneration !== this.options.getSessionGeneration()) {
        return;
      }

      this.applySessionStats(stats);
    } catch (error) {
      if (!options.silent && !isStaleKwardSessionRequestError(error) && sessionGeneration === this.options.getSessionGeneration()) {
        this.options.onError(this.options.getErrorMessage(error));
      }
    }
  }

  private applySessionStats(stats: AgentSessionStats): void {
    const { sessionFileChanged, sessionNameChanged } = this.options.applySessionStatsIdentity(stats);

    if (sessionFileChanged) {
      this.options.refreshSessions();
    }

    if (sessionNameChanged || this.options.state.applySessionStats(stats)) {
      this.options.postState();
    }
  }

  private async refreshModelOptions(
    client: SessionMetadataClient,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    const availableModels = await client.getAvailableModels();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    if (this.options.state.applyAvailableModels(availableModels.models)) {
      this.options.postState();
    }
  }

  private async refreshStartupResources(
    client: SessionMetadataClient,
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    if (!client.getStartupResources) {
      return;
    }

    const startupResources = await client.getStartupResources();

    if (!this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
      return;
    }

    if (this.options.state.applyStartupResources(startupResources)) {
      this.options.postState();
    }
  }

  private async runSlashCommandsRefresh(
    options: { startClient?: boolean },
    sessionGeneration: number,
    refreshId: number
  ): Promise<void> {
    let client: SessionMetadataClient | undefined;

    try {
      client = this.options.getClient(options);
    } catch (error) {
      if (sessionGeneration === this.options.getSessionGeneration()) {
        this.options.onError(this.options.getErrorMessage(error));
      }

      return;
    }

    if (!client) {
      return;
    }

    this.options.state.setSlashCommandsRefreshing(true);

    try {
      const availableCommands = await client.getCommands();

      if (!this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        return;
      }

      if (this.options.state.applyAvailableCommands(availableCommands.commands)) {
        this.options.postState();
      }
    } catch (error) {
      if (!isStaleKwardSessionRequestError(error) && this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        this.options.onError(this.options.getErrorMessage(error));
      }
    } finally {
      if (this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
        this.options.state.setSlashCommandsRefreshing(false);
      }
    }
  }

  private isCurrentMetadataRefresh(sessionGeneration: number, refreshId: number): boolean {
    return sessionGeneration === this.options.getSessionGeneration()
      && refreshId === this.metadataRefreshSequence;
  }

  private isCurrentSlashCommandRefresh(sessionGeneration: number, refreshId: number): boolean {
    return sessionGeneration === this.options.getSessionGeneration()
      && refreshId === this.slashCommandsRefreshSequence;
  }
}


export class SessionMetadataState {
  private modelLabel = '';
  private modelProvider = '';
  private modelId = '';
  private modelReasoning = false;
  private thinkingLevel = '';
  private modelOptions: WebviewModelOption[] = [];
  private contextUsageLabel = '';
  private contextUsageTitle = '';
  private contextUsageLevel = '';
  private metadataRefreshing = false;
  private slashCommands: WebviewSlashCommand[] = [];
  private slashCommandsRefreshing = false;
  private startupResources: WebviewStartupResourceSection[] = [];
  private piSettings: PiRuntimeSettingsMeta = {};
  private activePersonaLabel = '';

  public constructor(private readonly options: SessionMetadataStateOptions = {}) {
    if (options.initialSessionMeta) {
      this.setFields(options.initialSessionMeta);
    }
  }

  public getWebviewState(): SessionMetadataWebviewState {
    return {
      model: {
        label: this.modelLabel,
        provider: this.modelProvider,
        id: this.modelId,
        reasoning: this.modelReasoning,
        thinkingLevel: this.thinkingLevel,
        options: this.modelOptions
      },
      contextUsage: {
        label: this.contextUsageLabel,
        title: this.contextUsageTitle,
        level: this.contextUsageLevel
      },
      metadataRefreshing: this.metadataRefreshing,
      slashCommands: this.slashCommands,
      slashCommandsRefreshing: this.slashCommandsRefreshing,
      startupResources: cloneStartupResources(this.startupResources),
      piSettings: { ...this.piSettings },
      activePersonaLabel: this.activePersonaLabel
    };
  }

  public getModelOptions(): WebviewModelOption[] {
    return this.modelOptions;
  }

  public getSlashCommands(): WebviewSlashCommand[] {
    return this.slashCommands;
  }

  public applyModelState(state: AgentSessionState): boolean {
    const modelChanged = this.applyModelMeta(getModelMeta(state), { notify: false });
    const runtimeChanged = this.applyPiSettings(getPiSettingsMeta(state));
    const personaLabelChanged = this.applyActivePersonaLabel(state.activePersonaLabel);

    if (modelChanged || runtimeChanged || personaLabelChanged) {
      this.notifyChange();
      return true;
    }

    return false;
  }

  public applyModelSelection(model: AgentModel, thinkingLevel: string): boolean {
    return this.applyModelMeta(getModelMeta({ model, thinkingLevel }));
  }

  public applySessionStats(stats: AgentSessionStats): boolean {
    return this.applyContextUsage(formatContextUsage(stats));
  }

  public applyAvailableModels(models: AgentModel[] | undefined): boolean {
    return this.applyModelOptions(formatModelOptions(models));
  }

  public applyAvailableCommands(commands: AgentCommand[] | undefined): boolean {
    return this.applySlashCommands(formatSlashCommands(commands));
  }

  public applyStartupResources(resources: AgentStartupResources | undefined): boolean {
    return this.setStartupResources(formatStartupResources(resources));
  }

  public resetContextUsage(): void {
    const changed = Boolean(this.contextUsageLabel || this.contextUsageTitle || this.contextUsageLevel);
    this.contextUsageLabel = '';
    this.contextUsageTitle = '';
    this.contextUsageLevel = '';

    if (changed) {
      this.notifyChange();
    }
  }

  public resetStartupResources(): void {
    this.setStartupResources([]);
  }

  public setMetadataRefreshing(value: boolean): void {
    if (this.metadataRefreshing === value) {
      return;
    }

    this.metadataRefreshing = value;
    this.options.postState?.();
  }

  public setSlashCommandsRefreshing(value: boolean): void {
    if (this.slashCommandsRefreshing === value) {
      return;
    }

    this.slashCommandsRefreshing = value;
    this.options.postState?.();
  }

  public clearRefreshing(): void {
    this.metadataRefreshing = false;
    this.slashCommandsRefreshing = false;
  }

  private applyModelMeta(modelMeta: TaurenChatModelMeta, options: { notify?: boolean } = {}): boolean {
    if (
      modelMeta.label === this.modelLabel
      && modelMeta.provider === this.modelProvider
      && modelMeta.id === this.modelId
      && modelMeta.reasoning === this.modelReasoning
      && modelMeta.thinkingLevel === this.thinkingLevel
    ) {
      return false;
    }

    this.setModelMetaFields(modelMeta);
    if (options.notify !== false) {
      this.notifyChange();
    }
    return true;
  }

  private setModelMetaFields(modelMeta: TaurenChatModelMeta): void {
    this.modelLabel = modelMeta.label;
    this.modelProvider = modelMeta.provider;
    this.modelId = modelMeta.id;
    this.modelReasoning = modelMeta.reasoning;
    this.thinkingLevel = modelMeta.thinkingLevel;
  }

  private applyPiSettings(settings: PiRuntimeSettingsMeta): boolean {
    if (arePiSettingsEqual(settings, this.piSettings)) {
      return false;
    }

    this.piSettings = { ...settings };
    return true;
  }

  private applyActivePersonaLabel(label: string | undefined): boolean {
    const nextLabel = label ?? '';

    if (nextLabel === this.activePersonaLabel) {
      return false;
    }

    this.activePersonaLabel = nextLabel;
    return true;
  }

  private applyContextUsage(contextUsage: TaurenChatContextUsage): boolean {
    if (
      contextUsage.label === this.contextUsageLabel
      && contextUsage.title === this.contextUsageTitle
      && contextUsage.level === this.contextUsageLevel
    ) {
      return false;
    }

    this.contextUsageLabel = contextUsage.label;
    this.contextUsageTitle = contextUsage.title;
    this.contextUsageLevel = contextUsage.level;
    this.notifyChange();
    return true;
  }

  private applyModelOptions(modelOptions: WebviewModelOption[]): boolean {
    if (areModelOptionsEqual(modelOptions, this.modelOptions)) {
      return false;
    }

    this.modelOptions = modelOptions;
    this.notifyChange();
    return true;
  }

  private applySlashCommands(slashCommands: WebviewSlashCommand[]): boolean {
    if (areSlashCommandsEqual(slashCommands, this.slashCommands)) {
      return false;
    }

    this.slashCommands = slashCommands;
    return true;
  }

  private setStartupResources(startupResources: WebviewStartupResourceSection[]): boolean {
    if (areStartupResourcesEqual(startupResources, this.startupResources)) {
      return false;
    }

    this.startupResources = cloneStartupResources(startupResources);
    return true;
  }

  private setFields(snapshot: TaurenChatSessionMetaSnapshot): void {
    if (snapshot.model) {
      this.setModelMetaFields(snapshot.model);
    }

    if (snapshot.modelOptions) {
      this.modelOptions = snapshot.modelOptions.map((modelOption) => ({ ...modelOption }));
    }

    if (snapshot.contextUsage) {
      this.contextUsageLabel = snapshot.contextUsage.label;
      this.contextUsageTitle = snapshot.contextUsage.title;
      this.contextUsageLevel = snapshot.contextUsage.level;
    }

    this.activePersonaLabel = snapshot.activePersonaLabel ?? '';
  }

  private notifyChange(): void {
    this.options.onChange?.(this.getSnapshot());
  }

  private getSnapshot(): TaurenChatSessionMetaSnapshot {
    return {
      model: this.modelId
        ? {
          label: this.modelLabel,
          provider: this.modelProvider,
          id: this.modelId,
          reasoning: this.modelReasoning,
          thinkingLevel: this.thinkingLevel
        }
        : undefined,
      modelOptions: this.modelOptions.map((modelOption) => ({ ...modelOption })),
      contextUsage: this.contextUsageLabel
        ? {
          label: this.contextUsageLabel,
          title: this.contextUsageTitle,
          level: this.contextUsageLevel
        }
        : undefined,
      ...(this.activePersonaLabel ? { activePersonaLabel: this.activePersonaLabel } : {})
    };
  }
}

export function formatContextUsage(stats: AgentSessionStats): TaurenChatContextUsage {
  const usage = stats.contextUsage;

  if (!usage || typeof usage.contextWindow !== 'number') {
    return { label: '', title: '', level: '' };
  }

  const rawPercent = typeof usage.percent === 'number' ? usage.percent : undefined;
  const roundedPercent = rawPercent === undefined ? undefined : Math.round(rawPercent);
  const tokens = typeof usage.tokens === 'number' ? usage.tokens : undefined;
  const title = formatContextStatusTooltip(stats);

  if (roundedPercent === undefined && tokens === undefined) {
    return { label: '?%', title, level: 'low' };
  }

  const derivedPercent = roundedPercent ?? Math.round(((tokens ?? 0) / usage.contextWindow) * 100);
  const label = `${derivedPercent}%`;

  return { label, title, level: getContextUsageLevel(derivedPercent) };
}

export function formatContextStatusTooltip(stats: AgentSessionStats): string {
  const lines: string[] = [];
  const tokens = stats.tokens;
  const tokenParts: string[] = [];
  const cacheParts: string[] = [];

  if (tokens?.input) {
    tokenParts.push(`↑${formatCompactTokens(tokens.input)}`);
  }

  if (tokens?.output) {
    tokenParts.push(`↓${formatCompactTokens(tokens.output)}`);
  }

  if (tokenParts.length > 0) {
    lines.push(tokenParts.join(' '));
  }

  if (tokens?.cacheRead) {
    cacheParts.push(`R${formatCompactTokens(tokens.cacheRead)}`);
  }

  if (tokens?.cacheWrite) {
    cacheParts.push(`W${formatCompactTokens(tokens.cacheWrite)}`);
  }

  if (cacheParts.length > 0) {
    lines.push(cacheParts.join(' '));
  }

  const cost = typeof stats.cost === 'number' && Number.isFinite(stats.cost) ? stats.cost : 0;
  if (cost || stats.usingSubscription) {
    lines.push(`$${cost.toFixed(3)}${stats.usingSubscription ? ' (sub)' : ''}`);
  }

  const contextUsage = stats.contextUsage;
  if (contextUsage && typeof contextUsage.contextWindow === 'number') {
    const rawPercent = typeof contextUsage.percent === 'number'
      ? contextUsage.percent
      : typeof contextUsage.tokens === 'number' && contextUsage.contextWindow > 0
        ? (contextUsage.tokens / contextUsage.contextWindow) * 100
        : undefined;
    const percentDisplay = rawPercent === undefined ? '?' : `${rawPercent.toFixed(1)}%`;
    const autoIndicator = stats.autoCompactionEnabled ? ' (auto)' : '';
    lines.push(`${percentDisplay}/${formatCompactTokens(contextUsage.contextWindow)}${autoIndicator}`);
  }

  return lines.join('\n');
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatCompactTokens(count: number): string {
  const roundedCount = Math.round(count);
  if (roundedCount < 1000) return roundedCount.toString();
  if (roundedCount < 10000) return `${(roundedCount / 1000).toFixed(1)}k`;
  if (roundedCount < 1000000) return `${Math.round(roundedCount / 1000)}k`;
  if (roundedCount < 10000000) return `${(roundedCount / 1000000).toFixed(1)}M`;
  return `${Math.round(roundedCount / 1000000)}M`;
}

function getContextUsageLevel(percent: number): string {
  if (percent >= 80) {
    return 'high';
  }

  if (percent >= 50) {
    return 'medium';
  }

  return 'low';
}

function getPiSettingsMeta(state: AgentSessionState): PiRuntimeSettingsMeta {
  const currentModelValue = state.model?.provider && state.model?.id
    ? `${state.model.provider}/${state.model.id}`
    : state.defaultProvider && state.defaultModel
      ? `${state.defaultProvider}/${state.defaultModel}`
      : state.defaultModel ?? '';

  const settings: PiRuntimeSettingsMeta = {
    defaultProvider: state.defaultProvider ?? state.model?.provider ?? '',
    defaultModel: currentModelValue,
    defaultThinkingLevel: state.defaultThinkingLevel ?? state.thinkingLevel ?? '',
    hideThinkingBlock: state.hideThinkingBlock ?? false,
    quietStartup: state.quietStartup ?? false,
    'compaction.enabled': state.autoCompactionEnabled ?? true,
    'retry.enabled': state.autoRetryEnabled ?? true,
    steeringMode: state.steeringMode ?? 'one-at-a-time',
    followUpMode: state.followUpMode ?? 'one-at-a-time',
    transport: state.transport ?? 'sse',
    'images.blockImages': state.blockImages ?? false,
    'images.autoResize': state.imageAutoResize ?? true,
    enableSkillCommands: state.enableSkillCommands ?? true
  };

  if (state.enabledModels !== undefined) {
    settings.enabledModels = state.enabledModels;
  }

  return settings;
}

function arePiSettingsEqual(left: PiRuntimeSettingsMeta, right: PiRuntimeSettingsMeta): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const leftValue = left[key as keyof PiRuntimeSettingsMeta];
    const rightValue = right[key as keyof PiRuntimeSettingsMeta];

    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue) || leftValue.length !== rightValue.length) {
        return false;
      }

      if (leftValue.some((entry, index) => entry !== rightValue[index])) {
        return false;
      }

      continue;
    }

    if (leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

function getModelMeta(state: AgentSessionState): TaurenChatModelMeta {
  const model = state.model;
  const id = typeof model?.id === 'string' ? model.id : '';
  const provider = typeof model?.provider === 'string' ? model.provider : '';
  const reasoning = Boolean(model?.reasoning);
  const thinkingLevel = typeof state.thinkingLevel === 'string' ? state.thinkingLevel : '';

  if (!id) {
    return { label: '', provider, id, reasoning, thinkingLevel };
  }

  if (reasoning && thinkingLevel) {
    return { label: `${id} ${formatThinkingLevel(thinkingLevel)}`, provider, id, reasoning, thinkingLevel };
  }

  return { label: id, provider, id, reasoning, thinkingLevel };
}

function formatModelOptions(models: AgentModel[] | undefined): WebviewModelOption[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return models.flatMap((model) => {
    const provider = typeof model.provider === 'string' ? model.provider : '';
    const id = typeof model.id === 'string' ? model.id : '';

    if (!provider || !id) {
      return [];
    }

    return [{
      provider,
      id,
      name: typeof model.name === 'string' && model.name.length > 0 ? model.name : id,
      reasoning: Boolean(model.reasoning)
    }];
  });
}

function formatSlashCommands(commands: AgentCommand[] | undefined): WebviewSlashCommand[] {
  if (!Array.isArray(commands)) {
    return [];
  }

  return commands
    .flatMap((command) => {
      const name = typeof command.name === 'string' ? command.name.trim() : '';

      if (!name) {
        return [];
      }

      return [{
        name,
        description: typeof command.description === 'string' ? command.description : '',
        source: typeof command.source === 'string' ? command.source : '',
        location: typeof command.location === 'string' ? command.location : undefined,
        path: typeof command.path === 'string' ? command.path : undefined
      }];
    })
    .sort(compareSlashCommands);
}

function compareSlashCommands(left: WebviewSlashCommand, right: WebviewSlashCommand): number {
  return getSlashCommandSourceRank(left.source) - getSlashCommandSourceRank(right.source)
    || left.name.localeCompare(right.name);
}

function getSlashCommandSourceRank(source: string): number {
  if (source === 'extension') {
    return 0;
  }

  if (source === 'prompt') {
    return 1;
  }

  if (source === 'skill') {
    return 2;
  }

  return 3;
}

function areModelOptionsEqual(left: WebviewModelOption[], right: WebviewModelOption[]): boolean {
  return left.length === right.length
    && left.every((model, index) => {
      const other = right[index];
      return other
        && model.provider === other.provider
        && model.id === other.id
        && model.name === other.name
        && model.reasoning === other.reasoning;
    });
}

function formatStartupResources(resources: AgentStartupResources | undefined): WebviewStartupResourceSection[] {
  if (!Array.isArray(resources?.sections)) {
    return [];
  }

  return resources.sections.flatMap((section) => {
    const name = typeof section.name === 'string' ? section.name.trim() : '';
    const items = Array.isArray(section.items)
      ? section.items.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : [];

    return name && items.length > 0 ? [{ name, items }] : [];
  });
}

function cloneStartupResources(resources: WebviewStartupResourceSection[]): WebviewStartupResourceSection[] {
  return resources.map((section) => ({
    name: section.name,
    items: section.items.slice()
  }));
}

function areStartupResourcesEqual(left: WebviewStartupResourceSection[], right: WebviewStartupResourceSection[]): boolean {
  return left.length === right.length
    && left.every((section, index) => {
      const other = right[index];
      return other
        && section.name === other.name
        && section.items.length === other.items.length
        && section.items.every((item, itemIndex) => item === other.items[itemIndex]);
    });
}

function areSlashCommandsEqual(left: WebviewSlashCommand[], right: WebviewSlashCommand[]): boolean {
  return left.length === right.length
    && left.every((command, index) => {
      const other = right[index];
      return other
        && command.name === other.name
        && command.description === other.description
        && command.source === other.source
        && command.location === other.location
        && command.path === other.path;
    });
}

function formatThinkingLevel(level: string): string {
  if (level === 'off') {
    return 'Thinking off';
  }

  return level.slice(0, 1).toUpperCase() + level.slice(1);
}
