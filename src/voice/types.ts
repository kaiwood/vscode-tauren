export type VoiceTranscriptAction = 'insert' | 'submit';

export type VoiceMode = 'pushToTalk' | 'handsFree';

export type VoiceActivationMode = 'toggle' | 'hold';

export type VoiceHandsFreeSensitivity = 'low' | 'normal' | 'high';

export type VoiceModelId = 'tiny.en' | 'base.en' | 'small.en' | 'tiny' | 'base' | 'small';

export type VoiceLanguage = 'auto' | 'en' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'pl' | 'ja' | 'ko' | 'zh';

export type VoiceDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'failed' | 'unavailable';

export type VoiceAssetKind = 'model' | 'binary';

export type VoiceAssetDownloadState = {
  status: VoiceDownloadStatus;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
};

export type VoiceModelOption = {
  id: VoiceModelId;
  label: string;
  description: string;
  sizeBytes: number;
  downloaded: boolean;
  download: VoiceAssetDownloadState;
};

export type VoiceBinaryState = {
  status: VoiceDownloadStatus;
  label: string;
  path?: string;
  source?: 'downloaded' | 'system';
  helper?: string;
  download: VoiceAssetDownloadState;
};

export type VoiceRecordingStatus = 'idle' | 'listening' | 'recording' | 'transcribing' | 'error';

export type VoiceInputDevice = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type VoiceInputDevicesState = {
  selectedId: string;
  status: 'idle' | 'refreshing' | 'ready' | 'error';
  devices: VoiceInputDevice[];
  error?: string;
};

export type VoiceState = {
  enabled: boolean;
  selectedModelId: VoiceModelId;
  transcriptAction: VoiceTranscriptAction;
  mode: VoiceMode;
  activationMode: VoiceActivationMode;
  maxRecordingSeconds: number;
  handsFreeSensitivity: VoiceHandsFreeSensitivity;
  handsFreeSilenceSeconds: number;
  language: VoiceLanguage;
  effectiveLanguage: VoiceLanguage;
  languageForced: boolean;
  models: VoiceModelOption[];
  binary: VoiceBinaryState;
  inputDevices: VoiceInputDevicesState;
  recordingStatus: VoiceRecordingStatus;
  audioLevel: number;
  error?: string;
};

export type VoiceModelAsset = {
  id: VoiceModelId;
  label: string;
  description: string;
  fileName: string;
  sizeBytes: number;
  url: string;
  sha1?: string;
  sha256?: string;
};

export type VoiceBinaryAsset = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  label: string;
  fileName: string;
  executableName: string;
  url: string;
};
