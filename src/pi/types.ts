export type PiEventBase = Record<string, unknown> & {
  type: string;
};

export type AgentStartPiEvent = PiEventBase & { type: 'agent_start' };
export type AgentEndPiEvent = PiEventBase & { type: 'agent_end'; messages?: unknown };
export type TurnStartPiEvent = PiEventBase & { type: 'turn_start' };
export type TurnEndPiEvent = PiEventBase & { type: 'turn_end'; toolResults?: unknown };
export type MessageStartPiEvent = PiEventBase & { type: 'message_start'; message?: unknown };
export type MessageEndPiEvent = PiEventBase & { type: 'message_end'; message?: unknown };
export type MessageUpdatePiEvent = PiEventBase & {
  type: 'message_update';
  assistantMessageEvent?: unknown;
};
export type ToolExecutionStartPiEvent = PiEventBase & {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
};
export type ToolExecutionUpdatePiEvent = PiEventBase & {
  type: 'tool_execution_update';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
};
export type ToolExecutionEndPiEvent = PiEventBase & {
  type: 'tool_execution_end';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
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
  content?: unknown;
  errorMessage?: string;
  summary?: string;
  tokensBefore?: number;
  display?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PiMessagesResult = {
  messages?: PiAgentMessage[];
};

export type PiPromptStreamingBehavior = 'steer' | 'followUp';

export type PiClientOptions = {
  cwd?: string;
  sessionFile?: string;
};
