import type { ChatState } from '../chat/chatSession';

export type WebviewStreamingBehavior = 'steer' | 'followUp';

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
  | { type: 'showSessions' }
  | { type: 'showTree' }
  | { type: 'hideSessions' }
  | { type: 'refreshSessions' }
  | { type: 'showCurrentChanges' }
  | { type: 'dismissWelcome' }
  | { type: 'selectSession'; sessionPath: string }
  | { type: 'deleteSession'; sessionPath: string }
  | { type: 'sessionItemCommand'; sessionPath: string; command: WebviewSessionItemCommand }
  | { type: 'setSessionItemName'; sessionPath: string; name: string }
  | { type: 'selectTreeEntry'; entryId: string; summarize?: boolean; customInstructions?: string }
  | { type: 'setSessionName'; name: string }
  | { type: 'refreshMetadata' }
  | { type: 'refreshSlashCommands' }
  | { type: 'removePromptContext'; id: string }
  | { type: 'abort' }
  | { type: 'copyText'; text: string; successMessage?: string }
  | { type: 'openFile'; path: string; line?: number; column?: number }
  | { type: 'highlightCode'; id: string; code: string; language: string; themeId?: string }
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

export type WebviewViewMode = 'chat' | 'sessions' | 'tree';

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

export type WebviewStateMessage = ChatState & {
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
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composerText?: string;
  composerTextRevision?: number;
  viewMode?: WebviewViewMode;
  sessions?: WebviewSessionItem[];
  sessionsRefreshing?: boolean;
  sessionsError?: string;
  currentSessionFile?: string;
  currentSessionName?: string;
  treeItems?: WebviewTreeItem[];
  treeRefreshing?: boolean;
  treeError?: string;
  sessionLoading?: boolean;
};

export type CreateWebviewStateMessageOptions = {
  state: ChatState;
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
  welcomeDismissed?: boolean;
  promptContext?: WebviewPromptContextAttachment[];
  composer?: {
    text?: string;
    revision?: number;
  };
  sessionView?: {
    viewMode?: WebviewViewMode;
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
};

export type WebviewScriptUris = {
  markdownItScriptUri: string;
  domPurifyScriptUri: string;
  webviewScriptUri: string;
};

export type CreateWebviewHtmlOptions = {
  welcomeDismissed?: boolean;
};
