import type { Activity, ChatMessage, MessagePatch, WebviewState } from './types';

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
  allowRemoteImages: true,
  welcomeDismissed: false,
  promptContext: [],
  composerText: '',
  composerTextRevision: 0,
  lane: 'chat',
  chatFace: 'main',
  settingsSection: 'providers',
  sessions: [],
  sessionsRefreshing: false,
  sessionsError: '',
  currentSessionFile: '',
  currentSessionName: '',
  treeItems: [],
  treeRefreshing: false,
  treeError: '',
  sessionLoading: false
};

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
    customUiTheme: parseCustomUiTheme(record.customUiTheme),
    allowRemoteImages: typeof record.allowRemoteImages === 'boolean' ? record.allowRemoteImages : true,
    welcomeDismissed: Boolean(record.welcomeDismissed),
    promptContext: Array.isArray(record.promptContext) ? record.promptContext : [],
    composerText: typeof record.composerText === 'string' ? record.composerText : '',
    composerTextRevision: typeof record.composerTextRevision === 'number' ? record.composerTextRevision : 0,
    lane: parseLane(record.lane),
    chatFace: parseChatFace(record.chatFace, parseLane(record.lane)),
    settingsSection: parseSettingsSection(record.settingsSection),
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    sessionsRefreshing: Boolean(record.sessionsRefreshing),
    sessionsError: typeof record.sessionsError === 'string' ? record.sessionsError : '',
    currentSessionFile: typeof record.currentSessionFile === 'string' ? record.currentSessionFile : '',
    currentSessionName: typeof record.currentSessionName === 'string' ? record.currentSessionName : '',
    treeItems: Array.isArray(record.treeItems) ? record.treeItems : [],
    treeRefreshing: Boolean(record.treeRefreshing),
    treeError: typeof record.treeError === 'string' ? record.treeError : '',
    sessionLoading: Boolean(record.sessionLoading)
  };
}

function parseLane(value: unknown) {
  return value === 'sessions' || value === 'tree' ? value : 'chat';
}

function parseChatFace(value: unknown, lane: 'chat' | 'sessions' | 'tree') {
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

function parseCustomUiTheme(value: unknown) {
  return value === 'modern' || value === 'crt' || value === 'amber' || value === 'matrix' ? value : 'default';
}

function parseSettingsSection(value: unknown) {
  return value === 'models'
    || value === 'runtime'
    || value === 'appearance'
    || value === 'advanced'
    ? value
    : 'providers';
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

function normalizeDiffLineCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
