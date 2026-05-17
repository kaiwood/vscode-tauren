import type { WebviewModelOption, WebviewSlashCommand } from '../webviewProtocol/types';

export type PiChatModelMeta = {
  label: string;
  provider: string;
  id: string;
  reasoning: boolean;
  thinkingLevel: string;
};

export type PiChatContextUsage = {
  label: string;
  title: string;
  level: string;
};

export type PiChatSessionMetaSnapshot = {
  model?: PiChatModelMeta;
  modelOptions?: WebviewModelOption[];
  contextUsage?: PiChatContextUsage;
};

export type SessionMetadataWebviewState = {
  model: {
    label: string;
    provider: string;
    id: string;
    reasoning: boolean;
    thinkingLevel: string;
    options: WebviewModelOption[];
  };
  contextUsage: PiChatContextUsage;
  metadataRefreshing: boolean;
  slashCommands: WebviewSlashCommand[];
  slashCommandsRefreshing: boolean;
};

export type SessionMetadataCacheStorage = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | void;
};
