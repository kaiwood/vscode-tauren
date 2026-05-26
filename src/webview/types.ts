import type {
  WebviewAuthState,
  WebviewChatFace,
  WebviewCustomUiTheme,
  WebviewExtensionFooterEntry,
  WebviewExtensionStatusEntry,
  WebviewExtensionWidgetEntry,
  WebviewFileSuggestion,
  WebviewLane,
  WebviewModelOption,
  WebviewPromptContextAttachment,
  WebviewPromptImageAttachment,
  WebviewSessionItem,
  WebviewStartupResourceSection,
  WebviewSessionItemCommand,
  WebviewSettingsSection,
  WebviewSettingsState,
  WebviewSlashCommand,
  WebviewStreamingBehavior as ProtocolWebviewStreamingBehavior,
  WebviewTreeItem,
  WebviewWorkspaceDiffStats
} from '../webviewProtocol/types';

export type WebviewStreamingBehavior = ProtocolWebviewStreamingBehavior;
export type CustomUiTheme = WebviewCustomUiTheme;
export type Lane = WebviewLane;
export type ChatFace = WebviewChatFace;
export type SettingsSection = WebviewSettingsSection;
export type SettingsState = WebviewSettingsState;
export type AuthState = WebviewAuthState;
export type SessionItemCommand = WebviewSessionItemCommand;

export type WebviewApi = {
  postMessage(message: unknown): void;
};

export type ModelOption = WebviewModelOption;
export type SlashCommand = WebviewSlashCommand;
export type FileSuggestion = WebviewFileSuggestion;
export type PromptContextAttachment = WebviewPromptContextAttachment;
export type PromptImageAttachment = WebviewPromptImageAttachment;
export type SessionItem = WebviewSessionItem;
export type TreeItem = WebviewTreeItem;

export type ChatImage = {
  type?: string;
  data?: string;
  mimeType?: string;
  alt?: string;
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
  images?: ChatImage[];
};

export type ChatMessage = {
  id?: string;
  revision?: number;
  role: string;
  text: string;
  error?: boolean;
  variant?: string;
  images?: ChatImage[];
  activities?: Activity[];
};

export type MessagePatch = {
  upserts?: Array<{ index: number; message: ChatMessage }>;
  deleteFrom?: number;
};

export type WorkspaceDiffStats = WebviewWorkspaceDiffStats;
export type ExtensionStatusEntry = WebviewExtensionStatusEntry;
export type ExtensionFooterEntry = WebviewExtensionFooterEntry;
export type ExtensionWidgetEntry = WebviewExtensionWidgetEntry;
export type StartupResourceSection = WebviewStartupResourceSection;

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
  customUiTheme: CustomUiTheme;
  extensionStatus: ExtensionStatusEntry[];
  extensionFooter?: ExtensionFooterEntry;
  extensionWidgets: ExtensionWidgetEntry[];
  startupResources: StartupResourceSection[];
  startupResourcesReloadRevision: number;
  allowRemoteImages: boolean;
  welcomeDismissed: boolean;
  promptContext: PromptContextAttachment[];
  promptImages: PromptImageAttachment[];
  composerText: string;
  composerTextRevision: number;
  composerTextMode: 'replace' | 'append';
  composerPaste?: {
    text: string;
    revision: number;
  };
  lane: Lane;
  chatFace: ChatFace;
  settingsSection: SettingsSection;
  settings: SettingsState;
  auth: AuthState;
  sessions: SessionItem[];
  sessionsRefreshing: boolean;
  sessionsError: string;
  currentSessionFile: string;
  currentSessionName: string;
  treeItems: TreeItem[];
  treeRefreshing: boolean;
  treeError: string;
  sessionLoading: boolean;
  perfEnabled: boolean;
};

export type LocalImageResolveResult = {
  type: 'resolveLocalImageResult';
  id: string;
  uri?: string;
  error?: string;
};

export type FileSuggestionsResult = {
  type: 'fileSuggestionsResult';
  id: string;
  prefix: string;
  items: FileSuggestion[];
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
