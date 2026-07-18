import type { ChatSnapshotMessage, ChatSnapshotState, ChatState } from '../chat/chatSession';
import type { SettingId, SettingValue, TaurenSettingsSection } from '../settings/settingsRegistry';
import type { VoiceState } from '../voice/types';

export type WebviewStreamingBehavior = 'steer' | 'followUp';
export type WebviewComposerTextMode = 'replace' | 'append';
export type WebviewCustomUiTheme = 'default' | 'modern' | 'crt' | 'amber' | 'matrix';
export type WebviewScrollDirection = 'up' | 'down';
export type WebviewScrollAmount = 'page' | 'line' | 'edge';
export type WebviewScrollCommand = {
  direction: WebviewScrollDirection;
  amount: WebviewScrollAmount;
};

export type WebviewPromptContextAttachment = {
  id: string;
  kind: 'file' | 'selection';
  label: string;
  title: string;
  source?: 'origin';
  xml?: string;
};

export type WebviewPromptImageAttachment = {
  id: string;
  label: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
};

export type WebviewDroppedPromptImage = {
  label: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  data: string;
};

export type WebviewFileSuggestion = {
  value: string;
  label: string;
  description?: string;
  directory: boolean;
};

export type WebviewComposerCompletion = {
  id: string;
  value: string;
  label: string;
  description?: string;
};

export type WebviewComposerCompletionCapabilities = {
  triggerCharacters: string[];
  generation: number;
};

export type WebviewSessionItemCommand = 'rename' | 'showChanges' | 'fork' | 'clone' | 'compact' | 'export' | 'delete';

export type WebviewSessionSearchStatus = 'idle' | 'indexing' | 'ready' | 'error';

export type WebviewSessionSearchState = {
  requestId: number;
  query: string;
  namedOnly: boolean;
  status: WebviewSessionSearchStatus;
  matchedSessionPaths: string[];
  indexedCount: number;
  totalCount: number;
  error?: string;
};

export type WebviewAuthAction = 'login' | 'logout' | 'refresh' | 'cancel';

export type WebviewKwardQuestionOption = {
  label: string;
  description: string;
};

export type WebviewKwardQuestion = {
  question: string;
  header: string;
  options: WebviewKwardQuestionOption[];
};

export type WebviewKwardQuestionRequest = {
  sessionId: string;
  questionRequestId: string;
  questions: WebviewKwardQuestion[];
};

export type WebviewKwardQuestionAnswer = {
  question: string;
  answer: string;
};

export type WebviewPerfEventName =
  | 'transcript.render'
  | 'sessionList.render'
  | 'tree.render'
  | 'chat.render'
  | 'composer.input'
  | 'composer.sync'
  | 'composer.textareaResize'
  | 'composer.scrollPreserve'
  | 'composer.slashMenuSync';

export type WebviewPerfEvent = {
  name: WebviewPerfEventName;
  durationMs: number;
  lane: WebviewLane;
  messageCount?: number;
  sessionCount?: number;
  visibleItemCount?: number;
  renderedMessageCount?: number;
  collapsedMessageCount?: number;
  currentSessionFile?: string;
  sessionLoading?: boolean;
  textareaLength?: number;
  promptContextCount?: number;
  promptImageCount?: number;
  busy?: boolean;
  atBottom?: boolean;
};

export type WebviewAuthType = 'oauth' | 'api_key';

export type WebviewAuthProvider = {
  id: string;
  name: string;
  authType: WebviewAuthType;
  configured: boolean;
  source?: string;
  label?: string;
  storedCredentialType?: WebviewAuthType;
  canLogout: boolean;
  usesCallbackServer?: boolean;
};

export type WebviewAuthProgress = {
  providerId?: string;
  message: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
};

export type WebviewAuthState = {
  providers: WebviewAuthProvider[];
  refreshing?: boolean;
  busyProviderId?: string;
  busyAction?: Extract<WebviewAuthAction, 'login' | 'logout'>;
  progress?: WebviewAuthProgress;
  error?: string;
};

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'focusChanged'; focused: boolean }
  | { type: 'perfEvent'; event: WebviewPerfEvent }
  | { type: 'newSession' }
  | { type: 'showLane'; lane: WebviewLane }
  | { type: 'showChatFace'; chatFace: WebviewChatFace }
  | { type: 'hideChatFace' }
  | { type: 'setSettingsSection'; section: WebviewSettingsSection }
  | { type: 'updateSetting'; settingId: SettingId; value: SettingValue }
  | { type: 'voiceDownloadBinary' }
  | { type: 'voiceDownloadModel'; modelId?: string }
  | { type: 'voiceDeleteModel'; modelId: string }
  | { type: 'voiceRefreshInputDevices' }
  | { type: 'voiceStartRecording' }
  | { type: 'voiceStopRecording' }
  | { type: 'authLogin'; providerId: string; authType?: WebviewAuthType }
  | { type: 'authLogout'; providerId: string }
  | { type: 'authRefresh' }
  | { type: 'authCancel' }
  | { type: 'kwardQuestionAnswer'; sessionId: string; questionRequestId: string; answers: WebviewKwardQuestionAnswer[] }
  | { type: 'kwardQuestionCancel'; sessionId: string; questionRequestId: string }
  | { type: 'refreshSessions' }
  | { type: 'searchSessions'; requestId: number; query: string; namedOnly: boolean }
  | { type: 'showCurrentChanges' }
  | { type: 'dismissWelcome' }
  | { type: 'selectSession'; sessionPath: string }
  | { type: 'deleteSession'; sessionPath: string }
  | { type: 'sessionItemCommand'; sessionPath: string; command: WebviewSessionItemCommand }
  | { type: 'setSessionItemName'; sessionPath: string; name: string }
  | { type: 'selectTreeEntry'; entryId: string; summarize?: boolean; customInstructions?: string }
  | { type: 'setTreeEntryLabel'; entryId: string; label: string }
  | { type: 'setSessionName'; name: string }
  | { type: 'refreshMetadata' }
  | { type: 'refreshSlashCommands' }
  | { type: 'requestFileSuggestions'; id: string; prefix: string }
  | { type: 'requestComposerCompletions'; id: string; revision: number; text: string; selectionStart: number; selectionEnd: number }
  | { type: 'applyComposerCompletion'; id: string; revision: number; itemId: string }
  | { type: 'selectPromptImages' }
  | { type: 'dropPromptImages'; files: WebviewDroppedPromptImage[]; uris: string[]; rejections?: string[] }
  | { type: 'removePromptImage'; id: string }
  | { type: 'removePromptContext'; id: string }
  | { type: 'abort' }
  | { type: 'copyText'; text: string; successMessage?: string }
  | { type: 'openExternal'; url: string }
  | { type: 'openFile'; path: string; line?: number; column?: number }
  | { type: 'highlightCode'; id: string; code: string; language: string; themeId?: string }
  | { type: 'resolveLocalImage'; id: string; src: string }
  | { type: 'customUiInput'; id: string; data: string }
  | { type: 'customUiCancel'; id: string }
  | { type: 'customUiDimensions'; id: string; columns: number; rows: number; cellWidthPx?: number; cellHeightPx?: number }
  | { type: 'extensionWidgetDimensions'; key: string; columns: number; rows: number; cellWidthPx?: number; cellHeightPx?: number }
  | { type: 'extensionFooterDimensions'; columns: number; rows: number; cellWidthPx?: number; cellHeightPx?: number }
  | { type: 'extensionTerminalInput'; data: string }
  | { type: 'setToolsExpanded'; expanded: boolean }
  | { type: 'extensionPromptAnswer'; id: string; value: string | boolean }
  | { type: 'extensionPromptCancel'; id: string }
  | { type: 'extensionEditorSave'; id: string; text: string }
  | { type: 'extensionEditorCancel'; id: string }
  | { type: 'submit'; text: string; streamingBehavior?: WebviewStreamingBehavior }
  | { type: 'setModel'; provider: string; modelId: string }
  | { type: 'setThinkingLevel'; level: string }
  | { type: 'unknown' };

export type WebviewModelOption = {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
};

export type WebviewSlashCommand = {
  name: string;
  description: string;
  source: string;
  location?: string;
  path?: string;
};

export type WebviewLane = 'chat' | 'sessions' | 'tree';
export type WebviewChatFace = 'main' | 'settings';
export type WebviewSettingsSection = TaurenSettingsSection;

export type WebviewNavigationState = {
  lane?: WebviewLane;
  chatFace?: WebviewChatFace;
};

export type WebviewSettingsState = {
  values: Partial<Record<SettingId, SettingValue>>;
  pending?: SettingId[];
  errors?: Partial<Record<SettingId, string>>;
};

export type WebviewSettingsViewState = {
  activeSection?: WebviewSettingsSection;
  settings?: WebviewSettingsState;
};

export type WebviewSessionItem = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  metadataState?: 'loading' | 'ready';
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
  current: boolean;
  liveStatus?: 'idle' | 'running' | 'done' | 'error';
  customUiOpen?: boolean;
};

export type WebviewTreeItem = {
  entryId: string;
  parentId?: string;
  role: string;
  text: string;
  current: boolean;
  depth?: number;
  isLast?: boolean;
  ancestorContinues?: boolean[];
  activePath?: boolean;
  selectable?: boolean;
  label?: string;
  labelTimestamp?: string;
  prefix?: string;
};

export type WebviewWorkspaceDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type WebviewExtensionStatusEntry = {
  key: string;
  text: string;
};

export type WebviewExtensionTextBlock = {
  type: 'text';
  lines: string[];
};

export type WebviewExtensionImageBlock = {
  type: 'image';
  data: string;
  mimeType: string;
  columns: number;
  rows: number;
  widthPx?: number;
  heightPx?: number;
  cellWidthPx?: number;
  cellHeightPx?: number;
  alt?: string;
  indentColumns?: number;
};

export type WebviewExtensionRenderBlock = WebviewExtensionTextBlock | WebviewExtensionImageBlock;

export type WebviewExtensionWidgetEntry = {
  key: string;
  placement: 'aboveEditor' | 'belowEditor';
  lines: string[];
  blocks?: WebviewExtensionRenderBlock[];
};

export type WebviewExtensionFooterEntry = {
  line: string;
};

export type WebviewStartupResourceSection = {
  name: string;
  items: string[];
};

export type WebviewMessagePatch = {
  upserts?: Array<{ index: number; message: ChatSnapshotMessage }>;
  deleteFrom?: number;
};

export type WebviewStateMessageBase = Omit<ChatState, 'messages'> & {
  type: 'state';
  modelLabel: string;
  modelProvider: string;
  modelId: string;
  modelReasoning: boolean;
  thinkingLevel: string;
  modelOptions: WebviewModelOption[];
  contextUsageLabel: string;
  contextUsageTitle: string;
  contextUsageLevel: string;
  metadataRefreshing: boolean;
  workspaceDiffStats: WebviewWorkspaceDiffStats;
  slashCommands: WebviewSlashCommand[];
  slashCommandsRefreshing: boolean;
  outputColors: boolean;
  animationsEnabled: boolean;
  customUiTheme: WebviewCustomUiTheme;
  extensionStatus: WebviewExtensionStatusEntry[];
  extensionFooter?: WebviewExtensionFooterEntry;
  extensionWidgets: WebviewExtensionWidgetEntry[];
  startupResources?: WebviewStartupResourceSection[];
  startupResourcesReloadRevision?: number;
  allowRemoteImages?: boolean;
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  promptImages?: WebviewPromptImageAttachment[];
  composerText?: string;
  composerTextRevision?: number;
  composerTextMode?: WebviewComposerTextMode;
  composerPaste?: {
    text: string;
    revision: number;
  };
  lane?: WebviewLane;
  sessions?: WebviewSessionItem[];
  sessionsRefreshing?: boolean;
  sessionsError?: string;
  sessionSearch?: WebviewSessionSearchState;
  currentSessionFile?: string;
  currentSessionName?: string;
  treeItems?: WebviewTreeItem[];
  treeRefreshing?: boolean;
  treeError?: string;
  sessionLoading?: boolean;
  perfEnabled?: boolean;
  chatFace?: WebviewChatFace;
  settingsSection?: WebviewSettingsSection;
  settings?: WebviewSettingsState;
  auth?: WebviewAuthState;
  kwardQuestion?: WebviewKwardQuestionRequest;
  voice?: VoiceState;
};

export type WebviewFullStateMessage = WebviewStateMessageBase & {
  messages: ChatState['messages'] | ChatSnapshotMessage[];
  messagePatch?: WebviewMessagePatch;
};

export type WebviewPatchedStateMessage = WebviewStateMessageBase & {
  messages?: undefined;
  messagePatch: WebviewMessagePatch;
};

export type WebviewStateMessage = WebviewFullStateMessage | WebviewPatchedStateMessage;

export type CreateWebviewStateMessageOptions = {
  state: ChatState | ChatSnapshotState;
  includeMessages?: boolean;
  messagePatch?: WebviewMessagePatch;
  model?: {
    label?: string;
    provider?: string;
    id?: string;
    reasoning?: boolean;
    thinkingLevel?: string;
    options?: WebviewModelOption[];
  };
  contextUsage?: {
    label?: string;
    title?: string;
    level?: string;
  };
  metadataRefreshing?: boolean;
  workspaceDiffStats?: WebviewWorkspaceDiffStats;
  slashCommands?: WebviewSlashCommand[];
  slashCommandsRefreshing?: boolean;
  outputColors?: boolean;
  animationsEnabled?: boolean;
  customUiTheme?: WebviewCustomUiTheme;
  extensionStatus?: WebviewExtensionStatusEntry[];
  extensionFooter?: WebviewExtensionFooterEntry;
  extensionWidgets?: WebviewExtensionWidgetEntry[];
  startupResources?: WebviewStartupResourceSection[];
  startupResourcesReloadRevision?: number;
  allowRemoteImages?: boolean;
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  promptImages?: WebviewPromptImageAttachment[];
  composer?: {
    text?: string;
    revision?: number;
    mode?: WebviewComposerTextMode;
  };
  navigation?: WebviewNavigationState;
  sessionView?: {
    sessions?: WebviewSessionItem[];
    refreshing?: boolean;
    error?: string;
    search?: WebviewSessionSearchState;
    currentSessionFile?: string;
    currentSessionName?: string;
    treeItems?: WebviewTreeItem[];
    treeRefreshing?: boolean;
    treeError?: string;
    sessionLoading?: boolean;
  };
  settingsView?: WebviewSettingsViewState;
  auth?: WebviewAuthState;
  kwardQuestion?: WebviewKwardQuestionRequest;
  voice?: VoiceState;
  perfEnabled?: boolean;
};

export type WebviewScriptUris = {
  markdownItScriptUri: string;
  domPurifyScriptUri: string;
  webviewScriptUri: string;
  cspSource?: string;
};

export type CreateWebviewHtmlOptions = {
  welcomeDismissed?: boolean;
  quietStartup?: boolean;
  devRenderInstrumentation?: boolean;
  allowRemoteImages?: boolean;
};
