import type { PiAgentMessage, PiAuthProvider, PiCommand, PiStartupResourceSection } from '../pi/types';

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
  providers?: PiAuthProvider[];
};

export type KwardCommandsResult = {
  commands?: PiCommand[];
};

export type KwardStartupResourcesResult = {
  sections?: PiStartupResourceSection[];
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
  messages?: PiAgentMessage[];
};
