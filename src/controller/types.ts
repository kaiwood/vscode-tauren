import type { SessionDiffSnapshot } from '../diff/types';
import type { ExtensionUiRequestUi } from '../extensionUi/requestHandler';
import type { PiChatSessionMetaSnapshot } from '../metadata/types';
import type { PiRpcClientFactory } from '../rpc/clientTypes';
import type {
  WebviewSessionItem,
  WebviewStateMessage,
  WebviewTreeItem
} from '../webviewProtocol/types';
import type { StatePublisherScheduler } from './statePublisher';

export type PiChatControllerOptions = {
  createClient: PiRpcClientFactory;
  postState: (message: WebviewStateMessage) => void;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
  extensionUi?: ExtensionUiRequestUi;
  getCwd?: () => string | undefined;
  getPiPath?: () => string | undefined;
  getOutputColors?: () => boolean;
  getAnimationsEnabled?: () => boolean;
  getReadyScript?: () => string | undefined;
  getReadyScriptEnabled?: () => boolean;
  supportsSessionTree?: () => boolean;
  runReadyScript?: (scriptPath: string, cwd: string | undefined) => void;
  stateScheduler?: StatePublisherScheduler;
  initialSessionMeta?: PiChatSessionMetaSnapshot;
  initialSessionFile?: string;
  onSessionMetaChange?: (metadata: PiChatSessionMetaSnapshot) => void;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
  listSessions?: (cwd: string | undefined, currentSessionFile: string | undefined) => Promise<WebviewSessionItem[]>;
  listSessionTree?: (sessionFile: string | undefined) => Promise<WebviewTreeItem[]>;
  deleteSession?: (sessionPath: string, displayName: string) => Promise<boolean>;
  showSessionChanges?: (sessionPath: string, displayName: string) => Promise<void>;
  loadSessionDiffSnapshot?: (sessionFile: string) => SessionDiffSnapshot | undefined;
  saveSessionDiffSnapshot?: (sessionFile: string, snapshot: SessionDiffSnapshot) => void;
};
