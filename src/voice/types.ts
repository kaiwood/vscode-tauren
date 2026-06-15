export type VoiceTranscriptAction = 'insert' | 'submit';

export type VoiceModelId = 'tiny.en' | 'base.en' | 'small.en';

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

export type VoiceRecordingStatus = 'idle' | 'recording' | 'transcribing' | 'error';

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
  models: VoiceModelOption[];
  binary: VoiceBinaryState;
  inputDevices: VoiceInputDevicesState;
  recordingStatus: VoiceRecordingStatus;
  error?: string;
};

export type VoiceModelAsset = {
  id: VoiceModelId;
  label: string;
  description: string;
  fileName: string;
  sizeBytes: number;
  url: string;
  sha1: string;
};

export type VoiceBinaryAsset = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  label: string;
  fileName: string;
  executableName: string;
  url: string;
};
