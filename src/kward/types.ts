import type { AgentAuthProvider, AgentCommand, AgentMessage, AgentNavigateTreeResult, AgentStartupResourceSection } from '../agent/types';

export type KwardSession = {
  id?: string;
  path?: string;
  persistentId?: string;
  workspaceRoot?: string;
  cwd?: string;
  name?: string | null;
  createdAt?: string;
  modifiedAt?: string;
  firstMessage?: string;
  messageCount?: number;
};

export type KwardTurn = {
  id?: string;
  sessionId?: string;
  status?: string;
};

export type KwardTurnEvent = {
  sequence?: number;
  timestamp?: string;
  sessionId?: string;
  turnId?: string;
  type?: string;
  payload?: unknown;
};

export type KwardModel = {
  provider?: string;
  id?: string;
  model?: string;
  name?: string;
  reasoning?: boolean;
  reasoningEffort?: string;
  contextWindow?: number;
  current?: boolean;
};

export type KwardRuntimeSettingResult = {
  applied?: string;
  message?: string;
};

export type KwardOAuthLoginStart = {
  providerId?: string;
  loginId?: string;
  authorizationUrl?: string;
  redirectUri?: string;
  status?: string;
  message?: string;
  error?: string;
};

export type KwardAuthProvidersResult = {
  providers?: AgentAuthProvider[];
};

export type KwardCommandsResult = {
  commands?: AgentCommand[];
};

export type KwardStartupResourcesResult = {
  sections?: AgentStartupResourceSection[];
};

export type KwardQuestionOption = {
  label: string;
  description: string;
};

export type KwardQuestion = {
  question: string;
  header: string;
  options: KwardQuestionOption[];
};

export type KwardQuestionAnswer = {
  question: string;
  answer: string;
};

export type KwardQuestionRequest = {
  sessionId: string;
  questionRequestId: string;
  questions: KwardQuestion[];
};

export type KwardTranscriptResult = {
  session?: KwardSession;
  messages?: AgentMessage[];
};

export type KwardCompactResult = {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
};

export type KwardCapabilities = Record<string, unknown>;

export type KwardToolSource = 'builtin' | 'mcp' | 'web' | 'skill' | 'ui' | 'unknown';

export type KwardToolMetadata = {
  source?: string;
  displayName?: string;
  serverName?: string;
  remoteName?: string;
};

export type KwardToolSchema = {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
  metadata?: KwardToolMetadata;
};

export type KwardToolsListResult = {
  tools?: KwardToolSchema[];
};

export type KwardToolInfo = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  source: KwardToolSource;
  displayName: string;
  serverName?: string;
  remoteName?: string;
};

export type KwardMcpServerStatus = {
  name: string;
  transport?: string;
  status: 'available' | 'unavailable' | 'unknown';
  toolCount?: number;
  error?: string;
};

export type KwardMcpStatusResult = {
  servers?: KwardMcpServerStatus[];
};

export type KwardToolInventory = {
  tools: KwardToolInfo[];
  mcpServers?: KwardMcpServerStatus[];
};

export type KwardInitializeResult = {
  protocolVersion?: number;
  serverName?: string;
  capabilities?: KwardCapabilities;
};

export type KwardTreeResult = {
  items?: unknown[];
};

export type KwardImportResult = {
  session?: KwardSession;
  cancelled?: boolean;
};

export type KwardNavigateTreeResult = AgentNavigateTreeResult & {
  session?: KwardSession;
};

export type KwardMemoryRecord = {
  id?: string;
  text?: string;
  scope?: string;
  tags?: string[];
  active?: boolean;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type KwardMemoryStatus = {
  enabled: boolean;
  autoSummary: boolean;
  paths?: {
    core?: string;
    soft?: string;
    events?: string;
  };
};

export type KwardMemoryList = {
  globalCore: KwardMemoryRecord[];
  workspaceCore: KwardMemoryRecord[];
  workspaceSoft: KwardMemoryRecord[];
};

export type KwardMemoryInspect = KwardMemoryStatus & {
  core: KwardMemoryRecord[];
  soft: KwardMemoryRecord[];
};

export type KwardMemoryWhy = {
  message?: string;
  explanation?: string;
  memories?: KwardMemoryRecord[];
};

export type KwardMemorySummarize = {
  memories: KwardMemoryRecord[];
};
