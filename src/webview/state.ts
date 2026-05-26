import { normalizeDiffLineCount } from '../diff/lineCount';
import { isSettingId, normalizeSettingValue } from '../settings/settingsRegistry';
import { parseWebviewCustomUiTheme, parseWebviewLane, parseWebviewSettingsSection } from '../webviewProtocol/values';
import type { Activity, ChatMessage, ExtensionFooterEntry, ExtensionStatusEntry, ExtensionWidgetEntry, MessagePatch, StartupResourceSection, WebviewState } from './types';

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
  sessions: [],
  sessionsRefreshing: false,
  sessionsError: '',
  currentSessionFile: '',
  currentSessionName: '',
  treeItems: [],
  treeRefreshing: false,
  treeError: '',
  sessionLoading: false,
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
  return {
    extensionFooter: state.extensionFooter ? { ...state.extensionFooter } : { line: '' },
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
  return state.settings.values['tauren.extensions.statusBarEnabled'] !== false;
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
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    sessionsRefreshing: Boolean(record.sessionsRefreshing),
    sessionsError: typeof record.sessionsError === 'string' ? record.sessionsError : '',
    currentSessionFile: typeof record.currentSessionFile === 'string' ? record.currentSessionFile : '',
    currentSessionName: typeof record.currentSessionName === 'string' ? record.currentSessionName : '',
    treeItems: Array.isArray(record.treeItems) ? record.treeItems : [],
    treeRefreshing: Boolean(record.treeRefreshing),
    treeError: typeof record.treeError === 'string' ? record.treeError : '',
    sessionLoading: Boolean(record.sessionLoading),
    perfEnabled: Boolean(record.perfEnabled)
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

  const patch = parseMessagePatch(record.messagePatch);

  if (!patch) {
    return previousMessages;
  }

  return applyMessagePatch(previousMessages, patch);
}

function parseMessagePatch(value: unknown): MessagePatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const upserts = Array.isArray(value.upserts)
    ? value.upserts.filter(isMessagePatchUpsert)
    : undefined;
  const deleteFrom = typeof value.deleteFrom === 'number' && Number.isInteger(value.deleteFrom) && value.deleteFrom >= 0
    ? value.deleteFrom
    : undefined;

  if ((!upserts || upserts.length === 0) && deleteFrom === undefined) {
    return undefined;
  }

  return {
    ...(upserts && upserts.length > 0 ? { upserts } : {}),
    ...(deleteFrom !== undefined ? { deleteFrom } : {})
  };
}

function isMessagePatchUpsert(value: unknown): value is { index: number; message: ChatMessage } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.index === 'number'
    && Number.isInteger(value.index)
    && value.index >= 0
    && isRecord(value.message)
    && typeof value.message.role === 'string'
    && typeof value.message.text === 'string';
}

function applyMessagePatch(previousMessages: ChatMessage[], patch: MessagePatch): ChatMessage[] {
  const messages = previousMessages.slice();

  if (typeof patch.deleteFrom === 'number') {
    messages.splice(patch.deleteFrom);
  }

  for (const upsert of patch.upserts ?? []) {
    messages[upsert.index] = mergePatchedMessage(messages[upsert.index], upsert.message);
  }

  return messages;
}

function mergePatchedMessage(previous: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (!previous || !incoming.id || previous.id !== incoming.id) {
    return incoming;
  }

  const merged: ChatMessage = { ...incoming };

  if (!('images' in incoming) && previous.images) {
    merged.images = previous.images;
  }

  if (Array.isArray(incoming.activities) && Array.isArray(previous.activities)) {
    merged.activities = mergePatchedActivities(previous.activities, incoming.activities);
  }

  return merged;
}

function mergePatchedActivities(previousActivities: Activity[], incomingActivities: Activity[]): Activity[] {
  return incomingActivities.map((activity) => {
    const activityId = typeof activity.id === 'string' ? activity.id : '';
    const previous = activityId
      ? previousActivities.find((item) => item.id === activityId)
      : undefined;

    if (!previous || 'images' in activity || !previous.images) {
      return activity;
    }

    return { ...activity, images: previous.images };
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
