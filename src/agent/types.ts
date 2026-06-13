import type { PiEvent } from '../pi/types';

export type AgentQuestionOption = {
  label: string;
  description: string;
};

export type AgentQuestion = {
  question: string;
  header: string;
  options: AgentQuestionOption[];
};

export type AgentQuestionRequest = {
  sessionId: string;
  questionRequestId: string;
  questions: AgentQuestion[];
};

export type AgentQuestionRequestEvent = {
  type: 'question_request';
  request: AgentQuestionRequest;
};

export type AgentRuntimeEvent = PiEvent;
export type AgentEvent = AgentRuntimeEvent | AgentQuestionRequestEvent;

export type {
  AgentEndPiEvent as AgentEndEvent,
  AgentStartPiEvent as AgentStartEvent,
  AutoRetryEndPiEvent as AutoRetryEndEvent,
  AutoRetryStartPiEvent as AutoRetryStartEvent,
  CompactionEndPiEvent as CompactionEndEvent,
  CompactionStartPiEvent as CompactionStartEvent,
  ExtensionErrorPiEvent as ExtensionErrorEvent,
  KnownPiEvent as KnownAgentEvent,
  MessageEndPiEvent as MessageEndEvent,
  MessageStartPiEvent as MessageStartEvent,
  MessageUpdatePiEvent as MessageUpdateEvent,
  PiAgentMessage as AgentMessage,
  PiAuthActionResult as AgentAuthActionResult,
  PiAuthProvider as AgentAuthProvider,
  PiAuthProvidersResult as AgentAuthProvidersResult,
  PiAuthSource as AgentAuthSource,
  PiAuthType as AgentAuthType,
  PiAvailableCommands as AgentAvailableCommands,
  PiAvailableModels as AgentAvailableModels,
  PiClientOptions as AgentClientOptions,
  PiCloneResult as AgentCloneResult,
  PiCommand as AgentCommand,
  PiCompactResult as AgentCompactResult,
  PiEventBase as AgentEventBase,
  PiExportHtmlResult as AgentExportHtmlResult,
  PiForkMessage as AgentForkMessage,
  PiForkMessagesResult as AgentForkMessagesResult,
  PiForkResult as AgentForkResult,
  PiImageContent as AgentImageContent,
  PiImportSessionResult as AgentImportSessionResult,
  PiLastAssistantText as AgentLastAssistantText,
  PiMessagesResult as AgentMessagesResult,
  PiModel as AgentModel,
  PiNavigateTreeResult as AgentNavigateTreeResult,
  PiOAuthAuthInfo as AgentOAuthAuthInfo,
  PiOAuthDeviceCodeInfo as AgentOAuthDeviceCodeInfo,
  PiOAuthLoginCallbacks as AgentOAuthLoginCallbacks,
  PiOAuthPrompt as AgentOAuthPrompt,
  PiOAuthSelectPrompt as AgentOAuthSelectPrompt,
  PiPromptStreamingBehavior as AgentPromptStreamingBehavior,
  PiRenderedContent as AgentRenderedContent,
  PiSessionState as AgentSessionState,
  PiSessionStats as AgentSessionStats,
  PiStartupResourceSection as AgentStartupResourceSection,
  PiStartupResources as AgentStartupResources,
  PiSwitchSessionResult as AgentSwitchSessionResult,
  PromptHandledPiEvent as PromptHandledEvent,
  QueueUpdatePiEvent as QueueUpdateEvent,
  ToolExecutionEndPiEvent as ToolExecutionEndEvent,
  ToolExecutionStartPiEvent as ToolExecutionStartEvent,
  ToolExecutionUpdatePiEvent as ToolExecutionUpdateEvent,
  TurnEndPiEvent as TurnEndEvent,
  TurnStartPiEvent as TurnStartEvent,
  UnknownPiEvent as UnknownAgentEvent
} from '../pi/types';
