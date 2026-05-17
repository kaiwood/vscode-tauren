import type { WebviewModelOption, WebviewSlashCommand } from '../webviewProtocol/types';
import type { PiCommand, PiMessagesResult, PiModel, PiSessionState, PiSessionStats } from '../rpc/types';
import type {
  PiChatContextUsage,
  PiChatModelMeta,
  PiChatSessionMetaSnapshot,
  SessionMetadataWebviewState
} from './types';

export type {
  PiChatContextUsage,
  PiChatModelMeta,
  PiChatSessionMetaSnapshot,
  SessionMetadataWebviewState
} from './types';

export type SessionMetadataStateOptions = {
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  onChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  postState?: () => void;
};

export type SessionMetadataClient = {
  getMessages(): Promise<PiMessagesResult>;
  getState(): Promise<PiSessionState>;
  getSessionStats(): Promise<PiSessionStats>;
  getAvailableModels(): Promise<{ models?: PiModel[] }>;
  getCommands(): Promise<{ commands?: PiCommand[] }>;
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
  applySessionState: (state: PiSessionState) => { sessionFileChanged: boolean; sessionNameChanged: boolean };
  applySessionStatsIdentity: (stats: PiSessionStats) => { sessionFileChanged: boolean; sessionNameChanged: boolean };
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
      if (handledError || !this.isCurrentMetadataRefresh(sessionGeneration, refreshId)) {
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
        this.refreshModelOptions(client, sessionGeneration, refreshId)
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
      if (!options.silent && sessionGeneration === this.options.getSessionGeneration()) {
        this.options.onError(this.options.getErrorMessage(error));
      }
    }
  }

  private applySessionStats(stats: PiSessionStats): void {
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
      if (this.isCurrentSlashCommandRefresh(sessionGeneration, refreshId)) {
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
      slashCommandsRefreshing: this.slashCommandsRefreshing
    };
  }

  public getModelOptions(): WebviewModelOption[] {
    return this.modelOptions;
  }

  public applyModelState(state: PiSessionState): boolean {
    return this.applyModelMeta(getModelMeta(state));
  }

  public applySessionStats(stats: PiSessionStats): boolean {
    return this.applyContextUsage(formatContextUsage(stats));
  }

  public applyAvailableModels(models: PiModel[] | undefined): boolean {
    return this.applyModelOptions(formatModelOptions(models));
  }

  public applyAvailableCommands(commands: PiCommand[] | undefined): boolean {
    return this.applySlashCommands(formatSlashCommands(commands));
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

  private applyModelMeta(modelMeta: PiChatModelMeta): boolean {
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
    this.notifyChange();
    return true;
  }

  private setModelMetaFields(modelMeta: PiChatModelMeta): void {
    this.modelLabel = modelMeta.label;
    this.modelProvider = modelMeta.provider;
    this.modelId = modelMeta.id;
    this.modelReasoning = modelMeta.reasoning;
    this.thinkingLevel = modelMeta.thinkingLevel;
  }

  private applyContextUsage(contextUsage: PiChatContextUsage): boolean {
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

  private setFields(snapshot: PiChatSessionMetaSnapshot): void {
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
  }

  private notifyChange(): void {
    this.options.onChange?.(this.getSnapshot());
  }

  private getSnapshot(): PiChatSessionMetaSnapshot {
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
        : undefined
    };
  }
}

export function formatContextUsage(stats: PiSessionStats): PiChatContextUsage {
  const usage = stats.contextUsage;

  if (!usage || typeof usage.contextWindow !== 'number') {
    return { label: '', title: '', level: '' };
  }

  const percent = typeof usage.percent === 'number' ? Math.round(usage.percent) : undefined;
  const tokens = typeof usage.tokens === 'number' ? usage.tokens : undefined;

  if (percent === undefined && tokens === undefined) {
    return {
      label: '?%',
      title: [
        'Context usage unavailable',
        `Model context size: ${formatInteger(usage.contextWindow)} tokens`
      ].join('\n'),
      level: 'low'
    };
  }

  const derivedPercent = percent ?? Math.round(((tokens ?? 0) / usage.contextWindow) * 100);
  const label = `${derivedPercent}%`;
  const titleTokens = tokens === undefined ? 'Unknown' : formatInteger(tokens);
  const title = [
    `Context used: ${derivedPercent}%`,
    `Current context: ${titleTokens} tokens`,
    `Model context size: ${formatInteger(usage.contextWindow)} tokens`
  ].join('\n');

  return { label, title, level: getContextUsageLevel(derivedPercent) };
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
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

function getModelMeta(state: PiSessionState): PiChatModelMeta {
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

function formatModelOptions(models: PiModel[] | undefined): WebviewModelOption[] {
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

function formatSlashCommands(commands: PiCommand[] | undefined): WebviewSlashCommand[] {
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
