import type { SpawnOptionsWithoutStdio } from 'child_process';

export type RpcEventBase = Record<string, unknown> & {
  type: string;
};

export type RpcResponse = RpcEventBase & {
  type: 'response';
  command?: string;
  id?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
};

export type ExtensionUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export type AgentStartRpcEvent = RpcEventBase & { type: 'agent_start' };
export type AgentEndRpcEvent = RpcEventBase & { type: 'agent_end'; messages?: unknown };
export type TurnStartRpcEvent = RpcEventBase & { type: 'turn_start' };
export type TurnEndRpcEvent = RpcEventBase & { type: 'turn_end'; toolResults?: unknown };
export type MessageStartRpcEvent = RpcEventBase & { type: 'message_start'; message?: unknown };
export type MessageEndRpcEvent = RpcEventBase & { type: 'message_end'; message?: unknown };
export type MessageUpdateRpcEvent = RpcEventBase & {
  type: 'message_update';
  assistantMessageEvent?: unknown;
};
export type ToolExecutionStartRpcEvent = RpcEventBase & {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
};
export type ToolExecutionUpdateRpcEvent = RpcEventBase & {
  type: 'tool_execution_update';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
};
export type ToolExecutionEndRpcEvent = RpcEventBase & {
  type: 'tool_execution_end';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};
export type QueueUpdateRpcEvent = RpcEventBase & { type: 'queue_update' };
export type CompactionStartRpcEvent = RpcEventBase & { type: 'compaction_start' };
export type CompactionEndRpcEvent = RpcEventBase & { type: 'compaction_end' };
export type AutoRetryStartRpcEvent = RpcEventBase & { type: 'auto_retry_start' };
export type AutoRetryEndRpcEvent = RpcEventBase & { type: 'auto_retry_end'; success?: boolean };
export type ExtensionUiRequestRpcEvent = RpcEventBase & {
  type: 'extension_ui_request';
  id?: string;
  method?: string;
  message?: string;
  notifyType?: string;
};
export type ExtensionErrorRpcEvent = RpcEventBase & {
  type: 'extension_error';
  extensionPath?: string;
  error?: string;
};

export type KnownRpcEvent =
  | AgentStartRpcEvent
  | AgentEndRpcEvent
  | TurnStartRpcEvent
  | TurnEndRpcEvent
  | MessageStartRpcEvent
  | MessageEndRpcEvent
  | MessageUpdateRpcEvent
  | ToolExecutionStartRpcEvent
  | ToolExecutionUpdateRpcEvent
  | ToolExecutionEndRpcEvent
  | QueueUpdateRpcEvent
  | CompactionStartRpcEvent
  | CompactionEndRpcEvent
  | AutoRetryStartRpcEvent
  | AutoRetryEndRpcEvent
  | ExtensionUiRequestRpcEvent
  | ExtensionErrorRpcEvent
  | RpcResponse;

export type UnknownRpcEvent = RpcEventBase;

export type RpcEvent = KnownRpcEvent | UnknownRpcEvent;

export type RpcCommand = {
  type: string;
  [key: string]: unknown;
};

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
  display?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PiMessagesResult = {
  messages?: PiAgentMessage[];
};

export type PiPromptStreamingBehavior = 'steer' | 'followUp';

export type PiRpcProcess = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

export type PiRpcSpawnFactory = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => PiRpcProcess;

export type PiRpcClientOptions = {
  cwd?: string;
  sessionFile?: string;
  piPath?: string;
  spawnFactory?: PiRpcSpawnFactory;
  commandTimeoutMs?: number;
};
