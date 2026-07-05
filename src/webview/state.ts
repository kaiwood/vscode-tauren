import { normalizeDiffLineCount } from '../diff/lineCount';
import { isSettingId, normalizeSettingValue } from '../settings/settingsRegistry';
import { parseWebviewMessagePatch, applyWebviewMessagePatch } from '../webviewProtocol/messagePatch';
import { parseWebviewCustomUiTheme, parseWebviewLane, parseWebviewSettingsSection } from '../webviewProtocol/values';
import type { ChatMessage, ExtensionFooterEntry, ExtensionStatusEntry, ExtensionWidgetEntry, StartupResourceSection, WebviewState } from './types';
import { isRecord } from '../shared/typeGuards';

export type ProvisionalExtensionUiSnapshot = {
  extensionFooter?: ExtensionFooterEntry;
  extensionStatus: ExtensionStatusEntry[];
  extensionWidgets: ExtensionWidgetEntry[];
  footerPending: boolean;
  widgetsPending: boolean;
};

export const initialWebviewState: WebviewState = {
  messages: [],
  busy: false,
  modelLabel: '',
  modelProvider: '',
  modelId: '',
  modelReasoning: false,
  thinkingLevel: '',
  modelOptions: [],
  contextUsageLabel: '',
  contextUsageTitle: '',
  contextUsageLevel: '',
  metadataRefreshing: false,
  workspaceDiffStats: { addedLines: 0, removedLines: 0 },
  slashCommands: [],
  slashCommandsRefreshing: false,
  outputColors: true,
  animationsEnabled: true,
  customUiTheme: 'default',
  extensionStatus: [],
  extensionFooter: undefined,
  extensionWidgets: [],
  startupResources: [],
  startupResourcesReloadRevision: 0,
  allowRemoteImages: false,
  welcomeDismissed: false,
  promptContext: [],
  promptImages: [],
  composerText: '',
  composerTextRevision: 0,
  composerTextMode: 'replace',
  lane: 'chat',
  chatFace: 'main',
  settingsSection: 'appearance',
  settings: { values: {} },
  auth: { providers: [] },
  kwardQuestion: undefined,
  sessions: [],
  sessionsRefreshing: false,
  sessionsError: '',
  sessionSearch: createEmptySessionSearchState(),
  currentSessionFile: '',
  currentSessionName: '',
  treeItems: [],
  treeRefreshing: false,
  treeError: '',
  sessionLoading: false,
  voice: undefined,
  perfEnabled: false
};

export type StartupResourcesCache = {
  initialized: boolean;
  reloadRevision: number;
  resources: StartupResourceSection[];
};

export function createStartupResourcesCache(): StartupResourcesCache {
  return {
    initialized: false,
    reloadRevision: 0,
    resources: []
  };
}

export function applyStartupResourcesCache(
  nextState: WebviewState,
  cache: StartupResourcesCache
): { state: WebviewState; cache: StartupResourcesCache } {
  let nextCache = cache;

  if (nextState.startupResourcesReloadRevision > cache.reloadRevision) {
    nextCache = {
      initialized: true,
      reloadRevision: nextState.startupResourcesReloadRevision,
      resources: cloneStartupResources(nextState.startupResources)
    };
  } else if (!cache.initialized && nextState.startupResources.length > 0) {
    nextCache = {
      initialized: true,
      reloadRevision: nextState.startupResourcesReloadRevision,
      resources: cloneStartupResources(nextState.startupResources)
    };
  }

  if (!nextCache.initialized || areStartupResourcesEqual(nextState.startupResources, nextCache.resources)) {
    return { state: nextState, cache: nextCache };
  }

  return {
    state: {
      ...nextState,
      startupResources: cloneStartupResources(nextCache.resources)
    },
    cache: nextCache
  };
}

export function createOptimisticNewSessionState(previousState: WebviewState): WebviewState {
  return {
    ...previousState,
    messages: [],
    busy: false,
    contextUsageLabel: '',
    contextUsageTitle: '',
    contextUsageLevel: '',
    workspaceDiffStats: { addedLines: 0, removedLines: 0 },
    composerPaste: undefined,
    lane: 'chat',
    chatFace: 'main',
    currentSessionFile: '',
    currentSessionName: '',
    treeRefreshing: false,
    treeError: '',
    sessionLoading: false
  };
}

export function createProvisionalExtensionUiSnapshot(state: WebviewState): ProvisionalExtensionUiSnapshot {
  const hasFooterUi = hasExtensionFooterUi(state);

  return {
    extensionFooter: hasFooterUi && state.extensionFooter ? { ...state.extensionFooter } : undefined,
    extensionStatus: state.extensionStatus.map((entry) => ({ ...entry })),
    extensionWidgets: state.extensionWidgets.map((widget) => ({
      ...widget,
      lines: [...widget.lines],
      ...(widget.blocks ? { blocks: [...widget.blocks] } : {})
    })),
    footerPending: shouldReserveExtensionFooter(state),
    widgetsPending: state.extensionWidgets.length > 0
  };
}

export function applyProvisionalExtensionUiSnapshot(
  nextState: WebviewState,
  snapshot: ProvisionalExtensionUiSnapshot | undefined
): { state: WebviewState; snapshot: ProvisionalExtensionUiSnapshot | undefined } {
  if (!snapshot) {
    return { state: nextState, snapshot: undefined };
  }

  const footerPending = snapshot.footerPending && !hasExtensionFooterUi(nextState);
  const widgetsPending = snapshot.widgetsPending && nextState.extensionWidgets.length === 0;

  if (!footerPending && !widgetsPending) {
    return { state: nextState, snapshot: undefined };
  }

  return {
    state: {
      ...nextState,
      ...(footerPending ? {
        extensionFooter: snapshot.extensionFooter,
        extensionStatus: snapshot.extensionStatus
      } : {}),
      ...(widgetsPending ? {
        extensionWidgets: snapshot.extensionWidgets
      } : {})
    },
    snapshot: {
      ...snapshot,
      footerPending,
      widgetsPending
    }
  };
}

export function hasPendingProvisionalExtensionUi(snapshot: ProvisionalExtensionUiSnapshot | undefined): boolean {
  return Boolean(snapshot?.footerPending || snapshot?.widgetsPending);
}

function hasExtensionFooterUi(state: Pick<WebviewState, 'extensionFooter' | 'extensionStatus'>): boolean {
  return state.extensionFooter !== undefined || state.extensionStatus.length > 0;
}

function shouldReserveExtensionFooter(state: WebviewState): boolean {
  return state.settings.values['tauren.extensions.statusBarEnabled'] !== false && hasExtensionFooterUi(state);
}

export function parseWebviewStateMessage(data: unknown, previousState?: WebviewState): WebviewState {
  const record = isRecord(data) ? data : {};

  return {
    messages: parseMessages(record, previousState?.messages ?? []),
    busy: Boolean(record.busy),
    modelLabel: typeof record.modelLabel === 'string' ? record.modelLabel : '',
    modelProvider: typeof record.modelProvider === 'string' ? record.modelProvider : '',
    modelId: typeof record.modelId === 'string' ? record.modelId : '',
    modelReasoning: Boolean(record.modelReasoning),
    thinkingLevel: typeof record.thinkingLevel === 'string' ? record.thinkingLevel : '',
    modelOptions: Array.isArray(record.modelOptions) ? record.modelOptions : [],
    contextUsageLabel: typeof record.contextUsageLabel === 'string' ? record.contextUsageLabel : '',
    contextUsageTitle: typeof record.contextUsageTitle === 'string' ? record.contextUsageTitle : '',
    contextUsageLevel: typeof record.contextUsageLevel === 'string' ? record.contextUsageLevel : '',
    metadataRefreshing: Boolean(record.metadataRefreshing),
    workspaceDiffStats: parseWorkspaceDiffStats(record.workspaceDiffStats),
    slashCommands: Array.isArray(record.slashCommands) ? record.slashCommands : [],
    slashCommandsRefreshing: Boolean(record.slashCommandsRefreshing),
    outputColors: typeof record.outputColors === 'boolean' ? record.outputColors : true,
    animationsEnabled: typeof record.animationsEnabled === 'boolean' ? record.animationsEnabled : true,
    customUiTheme: parseWebviewCustomUiTheme(record.customUiTheme),
    extensionStatus: parseExtensionStatus(record.extensionStatus),
    extensionFooter: parseExtensionFooter(record.extensionFooter),
    extensionWidgets: parseExtensionWidgets(record.extensionWidgets),
    startupResources: parseStartupResources(record.startupResources),
    startupResourcesReloadRevision: parseNonNegativeInteger(record.startupResourcesReloadRevision, previousState?.startupResourcesReloadRevision ?? 0),
    allowRemoteImages: typeof record.allowRemoteImages === 'boolean' ? record.allowRemoteImages : false,
    welcomeDismissed: Boolean(record.welcomeDismissed),
    promptContext: Array.isArray(record.promptContext) ? record.promptContext : [],
    promptImages: parsePromptImages(record.promptImages),
    composerText: typeof record.composerText === 'string' ? record.composerText : '',
    composerTextRevision: typeof record.composerTextRevision === 'number' ? record.composerTextRevision : 0,
    composerTextMode: record.composerTextMode === 'append' ? 'append' : 'replace',
    composerPaste: parseComposerPaste(record.composerPaste),
    lane: parseWebviewLane(record.lane, 'chat'),
    chatFace: parseChatFace(record.chatFace, parseWebviewLane(record.lane, 'chat')),
    settingsSection: parseWebviewSettingsSection(record.settingsSection, 'appearance'),
    settings: parseSettingsState(record.settings),
    auth: parseAuthState(record.auth),
    kwardQuestion: parseKwardQuestion(record.kwardQuestion),
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    sessionsRefreshing: Boolean(record.sessionsRefreshing),
    sessionsError: typeof record.sessionsError === 'string' ? record.sessionsError : '',
    sessionSearch: parseSessionSearchState(record.sessionSearch, previousState?.sessionSearch),
    currentSessionFile: typeof record.currentSessionFile === 'string' ? record.currentSessionFile : '',
    currentSessionName: typeof record.currentSessionName === 'string' ? record.currentSessionName : '',
    treeItems: Array.isArray(record.treeItems) ? record.treeItems : [],
    treeRefreshing: Boolean(record.treeRefreshing),
    treeError: typeof record.treeError === 'string' ? record.treeError : '',
    sessionLoading: Boolean(record.sessionLoading),
    voice: parseVoiceState(record.voice),
    perfEnabled: Boolean(record.perfEnabled)
  };
}

function parseVoiceState(value: unknown): WebviewState['voice'] {
  if (!isRecord(value) || !Array.isArray(value.models) || !isRecord(value.binary)) {
    return undefined;
  }

  const selectedModelId = parseVoiceModelId(value.selectedModelId);
  const transcriptAction = value.transcriptAction === 'submit' ? 'submit' : 'insert';
  const language = parseVoiceLanguage(value.language);
  const effectiveLanguage = parseVoiceLanguage(value.effectiveLanguage);
  const languageForced = Boolean(value.languageForced);
  const mode = value.mode === 'handsFree' ? 'handsFree' : 'pushToTalk';
  const activationMode = value.activationMode === 'hold' ? 'hold' : 'toggle';
  const maxRecordingSeconds = typeof value.maxRecordingSeconds === 'number' ? value.maxRecordingSeconds : 60;
  const handsFreeSensitivity = value.handsFreeSensitivity === 'low' || value.handsFreeSensitivity === 'high' ? value.handsFreeSensitivity : 'normal';
  const handsFreeSilenceSeconds = typeof value.handsFreeSilenceSeconds === 'number' ? value.handsFreeSilenceSeconds : 1.2;
  const audioLevel = typeof value.audioLevel === 'number' ? Math.max(0, Math.min(1, value.audioLevel)) : 0;
  const recordingStatus = value.recordingStatus === 'listening' || value.recordingStatus === 'recording' || value.recordingStatus === 'transcribing' || value.recordingStatus === 'error'
    ? value.recordingStatus
    : 'idle';

  return {
    enabled: Boolean(value.enabled),
    selectedModelId,
    transcriptAction,
    mode,
    activationMode,
    maxRecordingSeconds,
    handsFreeSensitivity,
    handsFreeSilenceSeconds,
    language,
    effectiveLanguage,
    languageForced,
    models: value.models.filter(isVoiceModelOption).map((model) => ({
      ...model,
      download: parseVoiceDownloadState(model.download)
    })),
    binary: {
      status: parseVoiceDownloadStatus(value.binary.status),
      label: typeof value.binary.label === 'string' ? value.binary.label : 'whisper.cpp',
      ...(typeof value.binary.path === 'string' ? { path: value.binary.path } : {}),
      ...(value.binary.source === 'system' || value.binary.source === 'downloaded' ? { source: value.binary.source } : {}),
      ...(typeof value.binary.helper === 'string' ? { helper: value.binary.helper } : {}),
      download: parseVoiceDownloadState(value.binary.download)
    },
    inputDevices: parseVoiceInputDevicesState(value.inputDevices),
    recordingStatus,
    audioLevel,
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {})
  };
}

function parseVoiceModelId(value: unknown): NonNullable<WebviewState['voice']>['selectedModelId'] {
  return value === 'tiny.en' || value === 'base.en' || value === 'small.en' || value === 'tiny' || value === 'base' || value === 'small'
    ? value
    : 'base.en';
}

function parseVoiceLanguage(value: unknown): NonNullable<WebviewState['voice']>['language'] {
  return value === 'en' || value === 'de' || value === 'fr' || value === 'es' || value === 'it' || value === 'pt' || value === 'nl' || value === 'pl' || value === 'ja' || value === 'ko' || value === 'zh'
    ? value
    : 'auto';
}

function parseVoiceInputDevicesState(value: unknown): NonNullable<WebviewState['voice']>['inputDevices'] {
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    return {
      selectedId: 'default',
      status: 'idle',
      devices: [{ id: 'default', label: 'Default microphone', isDefault: true }]
    };
  }

  const status = value.status === 'refreshing' || value.status === 'ready' || value.status === 'error' ? value.status : 'idle';
  const devices = value.devices.filter(isVoiceInputDevice);

  return {
    selectedId: typeof value.selectedId === 'string' && value.selectedId ? value.selectedId : 'default',
    status,
    devices: devices.length > 0 ? devices : [{ id: 'default', label: 'Default microphone', isDefault: true }],
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {})
  };
}

function isVoiceInputDevice(value: unknown): value is NonNullable<WebviewState['voice']>['inputDevices']['devices'][number] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string';
}

function isVoiceModelOption(value: unknown): value is NonNullable<WebviewState['voice']>['models'][number] {
  return isRecord(value)
    && (value.id === 'tiny.en' || value.id === 'base.en' || value.id === 'small.en' || value.id === 'tiny' || value.id === 'base' || value.id === 'small')
    && typeof value.label === 'string'
    && typeof value.description === 'string'
    && typeof value.sizeBytes === 'number'
    && typeof value.downloaded === 'boolean';
}

function parseVoiceDownloadState(value: unknown): NonNullable<WebviewState['voice']>['binary']['download'] {
  if (!isRecord(value)) {
    return { status: 'idle' };
  }

  return {
    status: parseVoiceDownloadStatus(value.status),
    ...(typeof value.receivedBytes === 'number' ? { receivedBytes: value.receivedBytes } : {}),
    ...(typeof value.totalBytes === 'number' ? { totalBytes: value.totalBytes } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {})
  };
}

function parseVoiceDownloadStatus(value: unknown): NonNullable<WebviewState['voice']>['binary']['status'] {
  return value === 'downloading' || value === 'downloaded' || value === 'failed' || value === 'unavailable' ? value : 'idle';
}

function parseKwardQuestion(value: unknown): WebviewState['kwardQuestion'] {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.questionRequestId !== 'string' || !Array.isArray(value.questions)) {
    return undefined;
  }

  const questions = value.questions.map((question) => {
    if (!isRecord(question) || typeof question.question !== 'string' || typeof question.header !== 'string' || !Array.isArray(question.options)) {
      return undefined;
    }

    const options = question.options.map((option) => {
      if (!isRecord(option) || typeof option.label !== 'string' || typeof option.description !== 'string') {
        return undefined;
      }

      return { label: option.label, description: option.description };
    });

    if (options.some((option) => !option)) {
      return undefined;
    }

    return { question: question.question, header: question.header, options: options as Array<{ label: string; description: string }> };
  });

  if (questions.some((question) => !question)) {
    return undefined;
  }

  return {
    sessionId: value.sessionId,
    questionRequestId: value.questionRequestId,
    questions: questions as NonNullable<WebviewState['kwardQuestion']>['questions']
  };
}

function createEmptySessionSearchState(): WebviewState['sessionSearch'] {
  return {
    requestId: 0,
    query: '',
    namedOnly: false,
    status: 'idle',
    matchedSessionPaths: [],
    indexedCount: 0,
    totalCount: 0
  };
}

function parseSessionSearchState(
  value: unknown,
  fallback: WebviewState['sessionSearch'] | undefined
): WebviewState['sessionSearch'] {
  if (!isRecord(value)) {
    return fallback ?? createEmptySessionSearchState();
  }

  const status = value.status === 'indexing' || value.status === 'ready' || value.status === 'error'
    ? value.status
    : 'idle';
  const requestId = parseNonNegativeInteger(value.requestId, 0);
  const indexedCount = parseNonNegativeInteger(value.indexedCount, 0);
  const totalCount = parseNonNegativeInteger(value.totalCount, 0);
  const matchedSessionPaths = Array.isArray(value.matchedSessionPaths)
    ? value.matchedSessionPaths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : [];

  return {
    requestId,
    query: typeof value.query === 'string' ? value.query : '',
    namedOnly: Boolean(value.namedOnly),
    status,
    matchedSessionPaths,
    indexedCount,
    totalCount,
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {})
  };
}

function parsePromptImages(value: unknown): WebviewState['promptImages'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPromptImageAttachment).map((attachment) => ({
    id: attachment.id,
    label: attachment.label,
    title: attachment.title,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes
  }));
}

function isPromptImageAttachment(value: unknown): value is WebviewState['promptImages'][number] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.title === 'string'
    && typeof value.mimeType === 'string'
    && typeof value.sizeBytes === 'number';
}

function parseComposerPaste(value: unknown): WebviewState['composerPaste'] {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.revision !== 'number') {
    return undefined;
  }

  return {
    text: value.text,
    revision: value.revision
  };
}

function parseExtensionStatus(value: unknown): WebviewState['extensionStatus'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isExtensionStatusEntry).map((entry) => ({
    key: entry.key,
    text: entry.text
  }));
}

function parseExtensionFooter(value: unknown): WebviewState['extensionFooter'] {
  return isRecord(value) && typeof value.line === 'string' ? { line: value.line } : undefined;
}

function isExtensionStatusEntry(value: unknown): value is WebviewState['extensionStatus'][number] {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.text === 'string';
}

function parseExtensionWidgets(value: unknown): WebviewState['extensionWidgets'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isExtensionWidgetEntry).map((entry) => ({
    key: entry.key,
    placement: entry.placement,
    lines: entry.lines.map((line) => String(line)),
    ...(Array.isArray(entry.blocks) ? { blocks: entry.blocks } : {})
  }));
}

function isExtensionWidgetEntry(value: unknown): value is WebviewState['extensionWidgets'][number] {
  return isRecord(value)
    && typeof value.key === 'string'
    && (value.placement === 'aboveEditor' || value.placement === 'belowEditor')
    && Array.isArray(value.lines);
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function cloneStartupResources(resources: StartupResourceSection[]): StartupResourceSection[] {
  return resources.map((section) => ({
    name: section.name,
    items: section.items.slice()
  }));
}

function areStartupResourcesEqual(left: StartupResourceSection[], right: StartupResourceSection[]): boolean {
  return left.length === right.length
    && left.every((section, index) => {
      const other = right[index];
      return other
        && section.name === other.name
        && section.items.length === other.items.length
        && section.items.every((item, itemIndex) => item === other.items[itemIndex]);
    });
}

function parseStartupResources(value: unknown): WebviewState['startupResources'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((section) => {
    if (!isRecord(section) || typeof section.name !== 'string' || !Array.isArray(section.items)) {
      return [];
    }

    const items = section.items
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return section.name.trim() && items.length > 0
      ? [{ name: section.name.trim(), items }]
      : [];
  });
}

function parseAuthState(value: unknown): WebviewState['auth'] {
  if (!isRecord(value)) {
    return { providers: [] };
  }

  return {
    providers: Array.isArray(value.providers) ? value.providers.filter(isAuthProvider).map(sanitizeAuthProvider) : [],
    ...(value.refreshing === true ? { refreshing: true } : {}),
    ...(typeof value.busyProviderId === 'string' && value.busyProviderId ? { busyProviderId: value.busyProviderId } : {}),
    ...(value.busyAction === 'login' || value.busyAction === 'logout' ? { busyAction: value.busyAction } : {}),
    ...(isAuthProgress(value.progress) ? { progress: value.progress } : {}),
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {})
  };
}

function isAuthProvider(value: unknown): value is WebviewState['auth']['providers'][number] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.authType === 'oauth' || value.authType === 'api_key')
    && typeof value.configured === 'boolean'
    && typeof value.canLogout === 'boolean';
}

function sanitizeAuthProvider(provider: WebviewState['auth']['providers'][number]): WebviewState['auth']['providers'][number] {
  return {
    id: provider.id,
    name: provider.name,
    authType: provider.authType,
    configured: provider.configured,
    canLogout: provider.canLogout,
    ...(typeof provider.source === 'string' ? { source: provider.source } : {}),
    ...(typeof provider.label === 'string' ? { label: provider.label } : {}),
    ...(provider.storedCredentialType === 'oauth' || provider.storedCredentialType === 'api_key' ? { storedCredentialType: provider.storedCredentialType } : {}),
    ...(typeof provider.usesCallbackServer === 'boolean' ? { usesCallbackServer: provider.usesCallbackServer } : {})
  };
}

function isAuthProgress(value: unknown): value is NonNullable<WebviewState['auth']['progress']> {
  return isRecord(value)
    && typeof value.message === 'string'
    && (!('providerId' in value) || typeof value.providerId === 'string')
    && (!('url' in value) || typeof value.url === 'string')
    && (!('userCode' in value) || typeof value.userCode === 'string')
    && (!('verificationUri' in value) || typeof value.verificationUri === 'string');
}

function parseSettingsState(value: unknown): WebviewState['settings'] {
  if (!isRecord(value)) {
    return { values: {} };
  }

  const parsedValues: WebviewState['settings']['values'] = {};
  const values = isRecord(value.values) ? value.values : {};

  for (const [settingId, settingValue] of Object.entries(values)) {
    if (!isSettingId(settingId)) {
      continue;
    }

    const normalizedValue = normalizeSettingValue(settingId, settingValue);
    if (normalizedValue !== undefined) {
      parsedValues[settingId] = normalizedValue;
    }
  }

  return {
    values: parsedValues,
    pending: Array.isArray(value.pending) ? value.pending.filter(isSettingId) : undefined,
    errors: parseSettingsErrors(value.errors)
  };
}

function parseSettingsErrors(value: unknown): WebviewState['settings']['errors'] {
  if (!isRecord(value)) {
    return undefined;
  }

  const parsedErrors: NonNullable<WebviewState['settings']['errors']> = {};
  for (const [settingId, error] of Object.entries(value)) {
    if (isSettingId(settingId) && typeof error === 'string') {
      parsedErrors[settingId] = error;
    }
  }

  return parsedErrors;
}

function parseChatFace(value: unknown, lane: WebviewState['lane']): WebviewState['chatFace'] {
  return lane === 'chat' && value === 'settings' ? 'settings' : 'main';
}

function parseMessages(record: Record<string, unknown>, previousMessages: ChatMessage[]): ChatMessage[] {
  if (Array.isArray(record.messages)) {
    return record.messages;
  }

  const patch = parseWebviewMessagePatch(record.messagePatch);

  if (!patch) {
    return previousMessages;
  }

  return applyWebviewMessagePatch(previousMessages, patch);
}

function parseWorkspaceDiffStats(value: unknown): { addedLines: number; removedLines: number } {
  if (!isRecord(value)) {
    return { addedLines: 0, removedLines: 0 };
  }

  return {
    addedLines: normalizeDiffLineCount(value.addedLines),
    removedLines: normalizeDiffLineCount(value.removedLines)
  };
}
