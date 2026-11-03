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

export type AgentTurnSummary = {
  status?: string;
  elapsedMs?: number;
  modelRequests?: number;
  toolCalls?: number;
  usageStatus?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    estimated?: boolean;
  } | null;
};

export type AgentTurnSummaryEvent = {
  type: 'turn_summary';
  summary: AgentTurnSummary;
};

export type AgentRuntimeEvent = PiEvent;
export type AgentEvent = AgentRuntimeEvent | AgentQuestionRequestEvent | AgentTurnSummaryEvent;

export type {
  PiAgentMessage as AgentMessage,
  PiAuthProvider as AgentAuthProvider,
  PiClientOptions as AgentClientOptions,
  PiCloneResult as AgentCloneResult,
  PiCommand as AgentCommand,
  PiCompactResult as AgentCompactResult,
  PiExportHtmlResult as AgentExportHtmlResult,
  PiForkMessage as AgentForkMessage,
  PiMessagesResult as AgentMessagesResult,
  PiModel as AgentModel,
  PiNavigateTreeResult as AgentNavigateTreeResult,
  PiSessionState as AgentSessionState,
  PiSessionStats as AgentSessionStats,
  PiStartupResourceSection as AgentStartupResourceSection,
  PiStartupResources as AgentStartupResources
} from '../pi/types';
