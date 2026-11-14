import { ErrorCodes, NotificationType, RequestType, ResponseError } from 'vscode-jsonrpc';

export const PROTOCOL_VERSION = 1 as const;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** JSON snapshots follow Tauren's Pi-compatible results, without SDK class instances. */
export type Snapshot = { [key: string]: JsonValue };

/** Tauren assignments in JSON-RPC's implementation-defined -32000..-32099 range.
 * Standard parse/request/method errors use the library's ErrorCodes instead.
 */
export const TaurenErrorCodes = {
  VersionMismatch: -32001,
  NotInitialized: ErrorCodes.ServerNotInitialized,
  AlreadyInitialized: -32003,
  CredentialPolicy: -32004,
  Cancelled: -32005,
  IncompatibleRuntime: -32007,
  CapabilityUnavailable: -32008
} as const;

export interface InitializeParams {
  protocolVersion: number;
  clientVersion: string;
  workspace: string;
  sessionDirectory: string;
  sessionFile?: string;
}
export interface InitializeResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  serverVersion: string;
  piVersion: string;
  workspace: string;
  sessionDirectory: string;
  capabilities: string[];
}
export interface PromptParams {
  message: string;
  streamingBehavior?: 'steer' | 'followUp';
  images?: { type: 'image'; data: string; mimeType: string }[];
}
export interface CompletionParams {
  id: string; revision: number; text: string; selectionStart: number; selectionEnd: number;
}
export interface CompletionCapabilities { triggerCharacters: string[]; generation: number }
export interface CompletionItem { id: string; value: string; label: string; description?: string }
export interface CompletionResult {
  id: string; revision: number; items: CompletionItem[]; capabilities: CompletionCapabilities;
}
export interface CompletionApplication { id: string; revision: number; itemId: string }
export interface CompletionApplied {
  id: string; revision: number; text: string; selectionStart: number; selectionEnd: number;
}
export interface ModelParams { provider: string; modelId: string }
export interface SettingParams { settingId: string; value: JsonValue }
export interface SettingResult { applied: 'live' | 'reload'; message?: string }
export interface ProviderParams { providerId: string }
export interface NameParams { name: string }
export interface CompactParams { customInstructions?: string }
export interface ExportParams { outputPath?: string }
export interface LastAssistantText { text: string | null }
export interface MessagesResult { messages: JsonValue[] }
export interface SessionPathParams { sessionPath: string }
export interface ImportParams { inputPath: string; cwdOverride?: string }
export interface EntryParams { entryId: string }
export interface LabelParams extends EntryParams { label: string | null }
export interface NavigateParams extends EntryParams { summarize?: boolean; customInstructions?: string }
export interface ListSessionsParams { workspace?: string }
export interface TraceOriginInput { kind: 'file' | 'selection'; path: string; absolutePath?: string; text?: string }
/** Omit sessionFile to scan this connection's initialized store. Legacy path/content
 * describes one input; inputs preserves file/selection precedence across sessions. */
export interface TraceOriginParams { sessionFile?: string; path?: string; content?: string; inputs?: TraceOriginInput[] }

/** Reject incompatible protocol versions before constructing an SDK runtime. */
export function assertProtocolVersion(version: number): void {
  if (version !== PROTOCOL_VERSION) {
    throw new ResponseError(TaurenErrorCodes.VersionMismatch,
      `Unsupported protocol version ${version}; expected ${PROTOCOL_VERSION}`,
      { supportedVersion: PROTOCOL_VERSION });
  }
}

/** RequestType<Params, Result, ErrorData> names a method and types its payloads.
 * `void` means no structured error data is specified. NotificationType<Params>
 * has no response. Neither declaration is JSON Schema or runtime validation;
 * future dispatchers must validate received parameters before invoking the SDK.
 */
export const Requests = {
  initialize: new RequestType<InitializeParams, InitializeResult, void>('initialize'),
  shutdown: new RequestType<null, null, void>('shutdown'),
  prompt: new RequestType<PromptParams, null, void>('chat.prompt'),
  abort: new RequestType<null, null, void>('chat.abort'),
  reload: new RequestType<null, null, void>('runtime.reload'),
  getState: new RequestType<null, Snapshot, void>('runtime.getState'),
  getSessionStats: new RequestType<null, Snapshot, void>('runtime.getSessionStats'),
  getAvailableModels: new RequestType<null, Snapshot, void>('runtime.getAvailableModels'),
  getCommands: new RequestType<null, Snapshot, void>('runtime.getCommands'),
  getStartupResources: new RequestType<null, Snapshot, void>('runtime.getStartupResources'),
  setModel: new RequestType<ModelParams, Snapshot, void>('runtime.setModel'),
  setThinkingLevel: new RequestType<{ level: string }, null, void>('runtime.setThinkingLevel'),
  updateSetting: new RequestType<SettingParams, SettingResult, void>('runtime.updateSetting'),
  getCompletions: new RequestType<CompletionParams, CompletionResult, void>('completion.get'),
  getCompletionCapabilities: new RequestType<null, CompletionCapabilities, void>('completion.getCapabilities'),
  applyCompletion: new RequestType<CompletionApplication, CompletionApplied | null, void>('completion.apply'),
  getAuthProviders: new RequestType<null, Snapshot, void>('auth.getProviders'),
  // Policy-denied methods intentionally accept no secret/token/callback payload.
  loginWithApiKey: new RequestType<ProviderParams, never, void>('auth.loginWithApiKey'),
  loginWithOAuth: new RequestType<ProviderParams, never, void>('auth.loginWithOAuth'),
  logout: new RequestType<ProviderParams, never, void>('auth.logout'),
  setSessionName: new RequestType<NameParams, null, void>('session.setName'),
  compact: new RequestType<CompactParams, Snapshot, void>('session.compact'),
  exportHtml: new RequestType<ExportParams, Snapshot, void>('session.exportHtml'),
  getLastAssistantText: new RequestType<null, LastAssistantText, void>('session.getLastAssistantText'),
  getMessages: new RequestType<null, MessagesResult, void>('session.getMessages'),
  switchSession: new RequestType<SessionPathParams, Snapshot, void>('session.switch'),
  importJsonl: new RequestType<ImportParams, Snapshot, void>('session.importJsonl'),
  getTree: new RequestType<null, Snapshot[], void>('session.getTree'),
  setTreeEntryLabel: new RequestType<LabelParams, null, void>('session.setTreeEntryLabel'),
  navigateTree: new RequestType<NavigateParams, Snapshot, void>('session.navigateTree'),
  getForkMessages: new RequestType<null, Snapshot, void>('session.getForkMessages'),
  fork: new RequestType<EntryParams, Snapshot, void>('session.fork'),
  clone: new RequestType<null, Snapshot, void>('session.clone'),
  listSessions: new RequestType<ListSessionsParams, Snapshot[], void>('sessions.list'),
  traceOrigin: new RequestType<TraceOriginParams, Snapshot | null, void>('sessions.traceOrigin')
};

export interface DialogParams { title: string; timeoutMs?: number }
export interface SelectParams extends DialogParams { options: string[] }
export interface ConfirmParams extends DialogParams { message?: string }
export interface InputParams extends DialogParams { placeholder?: string }
export interface EditorParams { title: string; prefill?: string }
export interface SurfaceParams { surfaceId: string }
export interface CustomParams extends SurfaceParams { options: Snapshot }
export interface RenderParams extends SurfaceParams {
  width: number; height: number; cellWidth?: number; cellHeight?: number;
}
/** Image/text blocks preserve Tauren's component rendering without serializing components. */
export type RenderBlock = import('@tauren/shared/rendering/renderContent').ExtensionRenderContent['blocks'][number];
export interface RenderResult { lines: string[]; blocks?: RenderBlock[]; cursor?: { row: number; column: number } }
export interface SurfaceStateParams extends SurfaceParams { attached: boolean; focused: boolean }
export interface SurfaceInputParams extends SurfaceParams { input: string }
export interface TerminalInputParams { input: string }
export interface TerminalInputResult { consume: boolean; input?: string }

/** select/confirm/input/editor/custom go server -> host; render/surfaceInput/
 * dispose/terminalInput go host -> server. Components and done(T) stay server-local.
 */
export const UiRequests = {
  select: new RequestType<SelectParams, string | null, void>('ui.select'),
  confirm: new RequestType<ConfirmParams, boolean | null, void>('ui.confirm'),
  input: new RequestType<InputParams, string | null, void>('ui.input'),
  editor: new RequestType<EditorParams, string | null, void>('ui.editor'),
  custom: new RequestType<CustomParams, null, void>('ui.custom'),
  render: new RequestType<RenderParams, RenderResult, void>('ui.render'),
  setSurfaceState: new RequestType<SurfaceStateParams, null, void>('ui.setSurfaceState'),
  surfaceInput: new RequestType<SurfaceInputParams, null, void>('ui.surfaceInput'),
  dispose: new RequestType<SurfaceParams, null, void>('ui.dispose'),
  terminalInput: new RequestType<TerminalInputParams, TerminalInputResult, void>('ui.terminalInput')
};

export interface EventParams { sequence: number; event: Snapshot }
export interface DiagnosticParams { level: 'info' | 'warning' | 'error'; message: string }
export interface NotifyParams { message: string; notifyType: string }
export interface StatusParams { key: string; text: string | null }
export interface WidgetParams {
  key: string;
  placement: 'aboveEditor' | 'belowEditor';
  content: string[] | SurfaceParams | null;
}
export interface FooterParams { surfaceId: string | null }
export interface ExpandedParams { expanded: boolean }
export interface EditorTextParams { text: string }
export interface SubscriptionParams { enabled: boolean }

/** Unless noted, notifications flow server -> host. Event sequences are ordered
 * per connection, restart on reconnect, and are not replay cursors.
 */
export const Notifications = {
  event: new NotificationType<EventParams>('agent.event'),
  completionCapabilities: new NotificationType<CompletionCapabilities>('completion.capabilities'),
  diagnostic: new NotificationType<DiagnosticParams>('server.diagnostic'),
  notify: new NotificationType<NotifyParams>('ui.notify'),
  status: new NotificationType<StatusParams>('ui.status'),
  clearStatuses: new NotificationType<null>('ui.clearStatuses'),
  widget: new NotificationType<WidgetParams>('ui.widget'),
  clearWidgets: new NotificationType<null>('ui.clearWidgets'),
  footer: new NotificationType<FooterParams>('ui.footer'),
  invalidate: new NotificationType<SurfaceParams>('ui.invalidate'),
  setToolsExpanded: new NotificationType<ExpandedParams>('ui.setToolsExpanded'),
  toolsExpanded: new NotificationType<ExpandedParams>('ui.toolsExpanded'), // host -> server
  setEditorText: new NotificationType<EditorTextParams>('ui.setEditorText'),
  pasteToEditor: new NotificationType<EditorTextParams>('ui.pasteToEditor'),
  terminalInputSubscription: new NotificationType<SubscriptionParams>('ui.terminalInputSubscription')
};
