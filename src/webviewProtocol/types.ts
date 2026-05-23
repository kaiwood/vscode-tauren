import type { ChatSnapshotMessage, ChatSnapshotState, ChatState } from '../chat/chatSession';

export type WebviewStreamingBehavior = 'steer' | 'followUp';
export type WebviewCustomUiTheme = 'default' | 'modern' | 'crt' | 'amber' | 'matrix';

export type WebviewPromptContextAttachment = {
  id: string;
  kind: 'file' | 'selection';
  label: string;
  title: string;
  source?: 'origin';
  xml?: string;
};

export type WebviewSessionItemCommand = 'rename' | 'showChanges' | 'fork' | 'clone' | 'compact' | 'export' | 'delete';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'focusChanged'; focused: boolean }
  | { type: 'newSession' }
  | { type: 'showLane'; lane: WebviewLane }
  | { type: 'showChatFace'; chatFace: WebviewChatFace }
  | { type: 'hideChatFace' }
  | { type: 'setSettingsSection'; section: WebviewSettingsSection }
  | { type: 'refreshSessions' }
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
  | { type: 'removePromptContext'; id: string }
  | { type: 'abort' }
  | { type: 'copyText'; text: string; successMessage?: string }
  | { type: 'openFile'; path: string; line?: number; column?: number }
  | { type: 'highlightCode'; id: string; code: string; language: string; themeId?: string }
  | { type: 'resolveLocalImage'; id: string; src: string }
  | { type: 'customUiInput'; id: string; data: string }
  | { type: 'customUiCancel'; id: string }
  | { type: 'customUiDimensions'; id: string; columns: number; rows: number }
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
export type WebviewSettingsSection = 'providers' | 'models' | 'runtime' | 'appearance' | 'advanced';

export type WebviewNavigationState = {
  lane?: WebviewLane;
  chatFace?: WebviewChatFace;
};

export type WebviewSettingsViewState = {
  activeSection?: WebviewSettingsSection;
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
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
  current: boolean;
  liveStatus?: 'idle' | 'running' | 'done' | 'error';
  unread?: boolean;
  customUiOpen?: boolean;
};

export type WebviewTreeItem = {
  entryId: string;
  role: string;
  text: string;
  current: boolean;
  depth?: number;
  isLast?: boolean;
  ancestorContinues?: boolean[];
  activePath?: boolean;
  label?: string;
  prefix?: string;
};

export type WebviewWorkspaceDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type WebviewMessagePatch = {
  upserts?: Array<{ index: number; message: ChatSnapshotMessage }>;
  deleteFrom?: number;
};

export type WebviewStateMessage = Omit<ChatState, 'messages'> & {
  type: 'state';
  messages: ChatState['messages'] | ChatSnapshotMessage[];
  messagePatch?: WebviewMessagePatch;
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
  allowRemoteImages?: boolean;
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composerText?: string;
  composerTextRevision?: number;
  lane?: WebviewLane;
  sessions?: WebviewSessionItem[];
  sessionsRefreshing?: boolean;
  sessionsError?: string;
  currentSessionFile?: string;
  currentSessionName?: string;
  treeItems?: WebviewTreeItem[];
  treeRefreshing?: boolean;
  treeError?: string;
  sessionLoading?: boolean;
  chatFace?: WebviewChatFace;
  settingsSection?: WebviewSettingsSection;
};

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
  allowRemoteImages?: boolean;
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composer?: {
    text?: string;
    revision?: number;
  };
  navigation?: WebviewNavigationState;
  sessionView?: {
    sessions?: WebviewSessionItem[];
    refreshing?: boolean;
    error?: string;
    currentSessionFile?: string;
    currentSessionName?: string;
    treeItems?: WebviewTreeItem[];
    treeRefreshing?: boolean;
    treeError?: string;
    sessionLoading?: boolean;
  };
  settingsView?: WebviewSettingsViewState;
};

export type WebviewScriptUris = {
  markdownItScriptUri: string;
  domPurifyScriptUri: string;
  webviewScriptUri: string;
  cspSource?: string;
};

export type CreateWebviewHtmlOptions = {
  welcomeDismissed?: boolean;
  devRenderInstrumentation?: boolean;
  allowRemoteImages?: boolean;
};
