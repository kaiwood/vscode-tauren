export type WebviewStreamingBehavior = 'steer' | 'followUp';
export type ViewMode = 'chat' | 'sessions' | 'tree';
export type SessionItemCommand = 'rename' | 'fork' | 'clone' | 'compact' | 'export' | 'delete';

export type WebviewApi = {
  postMessage(message: unknown): void;
};

export type ModelOption = {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
};

export type SlashCommand = {
  name: string;
  description: string;
  source: string;
  location?: string;
  path?: string;
};

export type PromptContextAttachment = {
  id: string;
  kind: 'file' | 'selection';
  label: string;
  title: string;
  source?: 'origin';
  xml?: string;
};

export type SessionItem = {
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

export type TreeItem = {
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

export type Activity = {
  id?: string;
  kind?: string;
  status?: string;
  title?: string;
  body?: string;
  expandedBody?: string;
  summary?: string;
  code?: boolean;
};

export type ChatMessage = {
  role: string;
  text: string;
  error?: boolean;
  variant?: string;
  activities?: Activity[];
};

export type WorkspaceDiffStats = {
  addedLines: number;
  removedLines: number;
};

export type WebviewState = {
  messages: ChatMessage[];
  busy: boolean;
  modelLabel: string;
  modelProvider: string;
  modelId: string;
  modelReasoning: boolean;
  thinkingLevel: string;
  modelOptions: ModelOption[];
  contextUsageLabel: string;
  contextUsageTitle: string;
  contextUsageLevel: string;
  metadataRefreshing: boolean;
  workspaceDiffStats: WorkspaceDiffStats;
  slashCommands: SlashCommand[];
  slashCommandsRefreshing: boolean;
  outputColors: boolean;
  animationsEnabled: boolean;
  welcomeDismissed: boolean;
  promptContext: PromptContextAttachment[];
  composerText: string;
  composerTextRevision: number;
  viewMode: ViewMode;
  sessions: SessionItem[];
  sessionsRefreshing: boolean;
  sessionsError: string;
  currentSessionFile: string;
  currentSessionName: string;
  treeItems: TreeItem[];
  treeRefreshing: boolean;
  treeError: string;
  sessionLoading: boolean;
};

export type MarkdownRenderer = {
  render(value: string): string;
  renderInline(value: string): string;
};

export type MarkdownItFactory = (options: {
  html: boolean;
  linkify: boolean;
  breaks: boolean;
}) => MarkdownRenderer;

export type DomPurify = {
  sanitize(value: string, config?: unknown): string;
};

declare global {
  function acquireVsCodeApi(): WebviewApi;

  interface Window {
    markdownit?: MarkdownItFactory;
    DOMPurify?: DomPurify;
  }
}
