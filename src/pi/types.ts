import type { ExtensionUi } from '../extensionUi/types';

export type PiEventBase = Record<string, unknown> & {
  type: string;
};

export type AgentStartPiEvent = PiEventBase & { type: 'agent_start' };
export type AgentEndPiEvent = PiEventBase & { type: 'agent_end'; messages?: unknown; willRetry?: boolean };
export type TurnStartPiEvent = PiEventBase & { type: 'turn_start' };
export type TurnEndPiEvent = PiEventBase & { type: 'turn_end'; toolResults?: unknown };
export type MessageStartPiEvent = PiEventBase & { type: 'message_start'; message?: unknown };
export type MessageEndPiEvent = PiEventBase & { type: 'message_end'; message?: unknown };
export type MessageUpdatePiEvent = PiEventBase & {
  type: 'message_update';
  assistantMessageEvent?: unknown;
};
export type PiRenderedContent = {
  body: string;
  expandedBody?: string;
  code?: boolean;
};

export type ToolExecutionStartPiEvent = PiEventBase & {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  taurenRenderedTool?: PiRenderedContent;
};
export type ToolExecutionUpdatePiEvent = PiEventBase & {
  type: 'tool_execution_update';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  taurenRenderedTool?: PiRenderedContent;
};
export type ToolExecutionEndPiEvent = PiEventBase & {
  type: 'tool_execution_end';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  taurenRenderedTool?: PiRenderedContent;
};
export type QueueUpdatePiEvent = PiEventBase & { type: 'queue_update' };
export type CompactionStartPiEvent = PiEventBase & { type: 'compaction_start' };
export type CompactionEndPiEvent = PiEventBase & {
  type: 'compaction_end';
  result?: PiCompactResult | null;
  aborted?: boolean;
  willRetry?: boolean;
  errorMessage?: string;
};
export type AutoRetryStartPiEvent = PiEventBase & { type: 'auto_retry_start' };
export type AutoRetryEndPiEvent = PiEventBase & { type: 'auto_retry_end'; success?: boolean };
export type ExtensionErrorPiEvent = PiEventBase & {
  type: 'extension_error';
  extensionPath?: string;
  error?: string;
};
export type PromptHandledPiEvent = PiEventBase & { type: 'prompt_handled' };

export type KnownPiEvent =
  | AgentStartPiEvent
  | AgentEndPiEvent
  | TurnStartPiEvent
  | TurnEndPiEvent
  | MessageStartPiEvent
  | MessageEndPiEvent
  | MessageUpdatePiEvent
  | ToolExecutionStartPiEvent
  | ToolExecutionUpdatePiEvent
  | ToolExecutionEndPiEvent
  | QueueUpdatePiEvent
  | CompactionStartPiEvent
  | CompactionEndPiEvent
  | AutoRetryStartPiEvent
  | AutoRetryEndPiEvent
  | ExtensionErrorPiEvent
  | PromptHandledPiEvent;

export type UnknownPiEvent = PiEventBase;

export type PiEvent = KnownPiEvent | UnknownPiEvent;

export type PiModel = {
  provider?: string;
  id?: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
};

export type PiImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type PiSessionState = {
  model?: PiModel | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  steeringMode?: string;
  followUpMode?: string;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  transport?: string;
  imageAutoResize?: boolean;
  blockImages?: boolean;
  enabledModels?: string[];
  enableSkillCommands?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
};

export type PiAvailableModels = {
  models?: PiModel[];
};

export type PiCommand = {
  name?: string;
  description?: string;
  source?: string;
  sourceInfo?: unknown;
  location?: string;
  path?: string;
};

export type PiAvailableCommands = {
  commands?: PiCommand[];
};

export type PiStartupResourceSection = {
  name: string;
  items: string[];
};

export type PiStartupResources = {
  sections?: PiStartupResourceSection[];
};

export type PiAuthType = 'oauth' | 'api_key';

export type PiAuthSource = 'stored' | 'runtime' | 'environment' | 'fallback' | 'models_json_key' | 'models_json_command';

export type PiAuthProvider = {
  id: string;
  name: string;
  authType: PiAuthType;
  configured: boolean;
  source?: PiAuthSource;
  label?: string;
  storedCredentialType?: PiAuthType;
  canLogout: boolean;
  usesCallbackServer?: boolean;
};

export type PiAuthProvidersResult = {
  providers: PiAuthProvider[];
};

export type PiOAuthAuthInfo = {
  url: string;
  instructions?: string;
};

export type PiOAuthDeviceCodeInfo = {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
};

export type PiOAuthPrompt = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

export type PiOAuthSelectPrompt = {
  message: string;
  options: Array<{ id: string; label: string }>;
};

export type PiOAuthLoginCallbacks = {
  onAuth(info: PiOAuthAuthInfo): void;
  onDeviceCode(info: PiOAuthDeviceCodeInfo): void;
  onPrompt(prompt: PiOAuthPrompt): Promise<string>;
  onProgress?(message: string): void;
  onManualCodeInput?(): Promise<string>;
  onSelect(prompt: PiOAuthSelectPrompt): Promise<string | undefined>;
  signal?: AbortSignal;
};

export type PiAuthActionResult = {
  providerId: string;
  message: string;
};

export type PiSessionStats = {
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  usingSubscription?: boolean;
  autoCompactionEnabled?: boolean;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
};

export type PiCompactResult = {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
};

export type PiExportHtmlResult = {
  path?: string;
};

export type PiLastAssistantText = {
  text?: string | null;
};

export type PiSwitchSessionResult = {
  cancelled?: boolean;
};

export type PiForkMessage = {
  entryId?: string;
  text?: string;
};

export type PiForkMessagesResult = {
  messages?: PiForkMessage[];
};

export type PiForkResult = {
  text?: string;
  cancelled?: boolean;
};

export type PiCloneResult = {
  cancelled?: boolean;
};

export type PiNavigateTreeResult = {
  editorText?: string;
  cancelled?: boolean;
  aborted?: boolean;
};

export type PiAgentMessage = {
  role?: string;
  customType?: string;
  content?: unknown;
  errorMessage?: string;
  summary?: string;
  tokensBefore?: number;
  display?: unknown;
  details?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  taurenRenderedMessage?: PiRenderedContent;
};

export type PiMessagesResult = {
  messages?: PiAgentMessage[];
};

export type PiPromptStreamingBehavior = 'steer' | 'followUp';

export type PiClientOptions = {
  cwd?: string;
  sessionFile?: string;
  extensionUi?: ExtensionUi;
};
