import type { SettingValue, PiSettingId } from '../settings/settingsRegistry';
import type { WebviewModelOption, WebviewSlashCommand, WebviewStartupResourceSection } from '../webviewProtocol/types';

export type TaurenChatModelMeta = {
  label: string;
  provider: string;
  id: string;
  reasoning: boolean;
  thinkingLevel: string;
};

export type TaurenChatContextUsage = {
  label: string;
  title: string;
  level: string;
};

export type TaurenChatSessionMetaSnapshot = {
  model?: TaurenChatModelMeta;
  modelOptions?: WebviewModelOption[];
  contextUsage?: TaurenChatContextUsage;
  activePersonaLabel?: string;
};

export type PiRuntimeSettingsMeta = Partial<Record<PiSettingId, SettingValue>>;

export type SessionMetadataWebviewState = {
  model: {
    label: string;
    provider: string;
    id: string;
    reasoning: boolean;
    thinkingLevel: string;
    options: WebviewModelOption[];
  };
  contextUsage: TaurenChatContextUsage;
  metadataRefreshing: boolean;
  slashCommands: WebviewSlashCommand[];
  slashCommandsRefreshing: boolean;
  startupResources: WebviewStartupResourceSection[];
  piSettings: PiRuntimeSettingsMeta;
  activePersonaLabel: string;
};

export type SessionMetadataCacheStorage = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | void;
};
