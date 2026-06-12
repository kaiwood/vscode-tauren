import type { PiSettingId, SettingValue } from '../settings/settingsRegistry';
import type { WebviewTreeItem } from '../webviewProtocol/types';
import type {
  PiAuthActionResult,
  PiAuthProvidersResult,
  PiAvailableCommands,
  PiAvailableModels,
  PiClientOptions,
  PiCloneResult,
  PiOAuthLoginCallbacks,
  PiCompactResult,
  PiEvent,
  PiExportHtmlResult,
  PiForkMessagesResult,
  PiForkResult,
  PiImageContent,
  PiImportSessionResult,
  PiLastAssistantText,
  PiMessagesResult,
  PiModel,
  PiNavigateTreeResult,
  PiPromptStreamingBehavior,
  PiSessionState,
  PiSessionStats,
  PiStartupResources,
  PiSwitchSessionResult
} from './types';

export type PiClient = {
  onEvent(listener: (event: PiEvent) => void): () => void;
  onError(listener: (message: string) => void): () => void;
  prompt(message: string, streamingBehavior?: PiPromptStreamingBehavior, images?: PiImageContent[]): Promise<void>;
  expandPromptCommand?(command: string, args: string): Promise<string>;
  abort(): Promise<void>;
  reload(): Promise<void>;
  isRunning(): boolean;
  getState(): Promise<PiSessionState>;
  getSessionStats(): Promise<PiSessionStats>;
  getAvailableModels(): Promise<PiAvailableModels>;
  getCommands(): Promise<PiAvailableCommands>;
  getStartupResources?(): Promise<PiStartupResources>;
  getAuthProviders?(): Promise<PiAuthProvidersResult>;
  loginWithApiKey?(providerId: string, apiKey: string): Promise<PiAuthActionResult>;
  loginWithOAuth?(providerId: string, callbacks: PiOAuthLoginCallbacks): Promise<PiAuthActionResult>;
  logoutAuthProvider?(providerId: string): Promise<PiAuthActionResult>;
  setModel(provider: string, modelId: string): Promise<PiModel>;
  setThinkingLevel(level: string): Promise<void>;
  updateRuntimeSetting?(settingId: PiSettingId, value: SettingValue): Promise<{ applied: 'live' | 'reload'; message?: string }>;
  setSessionName(name: string): Promise<void>;
  compact(customInstructions?: string): Promise<PiCompactResult>;
  exportHtml(outputPath?: string): Promise<PiExportHtmlResult>;
  getLastAssistantText(): Promise<PiLastAssistantText>;
  getMessages(): Promise<PiMessagesResult>;
  switchSession(sessionPath: string): Promise<PiSwitchSessionResult>;
  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<PiImportSessionResult>;
  getSessionTree(): Promise<WebviewTreeItem[]>;
  setTreeEntryLabel(entryId: string, label: string | undefined): Promise<void>;
  navigateTree(entryId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<PiNavigateTreeResult>;
  getForkMessages(): Promise<PiForkMessagesResult>;
  fork(entryId: string): Promise<PiForkResult>;
  clone(): Promise<PiCloneResult>;
  deleteSession?(sessionPath?: string): Promise<boolean>;
  answerQuestion?(sessionId: string, questionRequestId: string, answers: unknown[]): Promise<void>;
  dispose(): void;
};

export type PiClientFactory = (options: PiClientOptions) => PiClient;
