import type { WebviewTreeItem } from '../webviewProtocol/types';
import type {
  PiAvailableCommands,
  PiAvailableModels,
  PiClientOptions,
  PiCloneResult,
  PiCompactResult,
  PiEvent,
  PiExportHtmlResult,
  PiForkMessagesResult,
  PiForkResult,
  PiLastAssistantText,
  PiMessagesResult,
  PiModel,
  PiNavigateTreeResult,
  PiPromptStreamingBehavior,
  PiSessionState,
  PiSessionStats,
  PiSwitchSessionResult
} from './types';

export type PiClient = {
  onEvent(listener: (event: PiEvent) => void): () => void;
  onError(listener: (message: string) => void): () => void;
  prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior): Promise<void>;
  abort(): Promise<void>;
  reload(): Promise<void>;
  isRunning(): boolean;
  getState(): Promise<PiSessionState>;
  getSessionStats(): Promise<PiSessionStats>;
  getAvailableModels(): Promise<PiAvailableModels>;
  getCommands(): Promise<PiAvailableCommands>;
  setModel(provider: string, modelId: string): Promise<PiModel>;
  setThinkingLevel(level: string): Promise<void>;
  setSessionName(name: string): Promise<void>;
  compact(customInstructions?: string): Promise<PiCompactResult>;
  exportHtml(outputPath?: string): Promise<PiExportHtmlResult>;
  getLastAssistantText(): Promise<PiLastAssistantText>;
  getMessages(): Promise<PiMessagesResult>;
  switchSession(sessionPath: string): Promise<PiSwitchSessionResult>;
  getSessionTree(): Promise<WebviewTreeItem[]>;
  setTreeEntryLabel(entryId: string, label: string | undefined): Promise<void>;
  navigateTree(entryId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<PiNavigateTreeResult>;
  getForkMessages(): Promise<PiForkMessagesResult>;
  fork(entryId: string): Promise<PiForkResult>;
  clone(): Promise<PiCloneResult>;
  dispose(): void;
};

export type PiClientFactory = (options: PiClientOptions) => PiClient;
