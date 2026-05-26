import type { SessionDiffSnapshot } from '../diff/types';
import type { ExtensionUi } from '../extensionUi/types';
import type { TaurenChatSessionMetaSnapshot } from '../metadata/types';
import type { PiClientFactory } from '../pi/clientTypes';
import type { SettingValue, TaurenSettingId } from '../settings/settingsRegistry';
import type {
  WebviewCustomUiTheme,
  WebviewSessionItem,
  WebviewStateMessage
} from '../webviewProtocol/types';
import type { StatePublisherScheduler } from './statePublisher';

export type SessionListProgressOptions = {
  onProgress?: (sessions: WebviewSessionItem[]) => void;
};

export type TaurenChatControllerOptions = {
  createClient: PiClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
  extensionUi?: ExtensionUi;
  inputSecret?: (title: string, placeholder?: string, prompt?: string) => PromiseLike<string | undefined> | Promise<string | undefined>;
  openExternalUrl?: (url: string) => PromiseLike<boolean> | Promise<boolean>;
  getCwd?: () => string | undefined;
  getOutputColors?: () => boolean;
  getAnimationsEnabled?: () => boolean;
  getCustomUiTheme?: () => WebviewCustomUiTheme;
  getReadyScript?: () => string | undefined;
  getReadyScriptEnabled?: () => boolean;
  getRejectEditWriteOutsideWorkspace?: () => boolean;
  isActiveSession?: () => boolean;
  getTaurenSettingValues?: () => Partial<Record<TaurenSettingId, SettingValue>>;
  updateTaurenSetting?: (id: TaurenSettingId, value: SettingValue) => PromiseLike<void> | Promise<void> | void;
  runReadyScript?: (scriptPath: string, cwd: string | undefined) => void;
  stateScheduler?: StatePublisherScheduler;
  useMessagePatches?: boolean;
  initialSessionMeta?: TaurenChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: TaurenChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
  listSessions?: (
    cwd: string | undefined,
    currentSessionFile: string | undefined,
    options?: SessionListProgressOptions
  ) => Promise<WebviewSessionItem[]>;
  deleteSession?: (sessionPath: string, displayName: string) => Promise<boolean>;
  renameOpenSession?: (sessionPath: string, name: string) => Promise<boolean>;
  showSessionChanges?: (sessionPath: string, displayName: string) => Promise<void>;
  loadSessionDiffSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSessionDiffSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
};
