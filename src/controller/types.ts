import type { SessionDiffSnapshot } from '../diff/types';
import type { ExtensionUi } from '../extensionUi/types';
import type { PiChatSessionMetaSnapshot } from '../metadata/types';
import type { PiClientFactory } from '../pi/clientTypes';
import type {
  WebviewSessionItem,
  WebviewStateMessage
} from '../webviewProtocol/types';
import type { StatePublisherScheduler } from './statePublisher';

export type PiChatControllerOptions = {
  createClient: PiClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
  extensionUi?: ExtensionUi;
  getCwd?: () => string | undefined;
  getOutputColors?: () => boolean;
  getAnimationsEnabled?: () => boolean;
  getReadyScript?: () => string | undefined;
  getReadyScriptEnabled?: () => boolean;
  runReadyScript?: (scriptPath: string, cwd: string | undefined) => void;
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
  listSessions?: (cwd: string | undefined, currentSessionFile: string | undefined) => Promise<WebviewSessionItem[]>;
  deleteSession?: (sessionPath: string, displayName: string) => Promise<boolean>;
  showSessionChanges?: (sessionPath: string, displayName: string) => Promise<void>;
  loadSessionDiffSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSessionDiffSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
};
