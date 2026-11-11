# Tauren sandbox protocol v1

## Scope and dependencies

This is Tauren's private SDK-backed protocol, not Pi CLI RPC or JSON mode.

- **Host:** the Tauren adapter running in the VS Code extension host, outside the
  SBX sandbox. It owns the SSH connection and renders VS Code/webview UI.
- **Server:** the per-connection Node process inside the sandbox, running the Pi
  SDK. It owns the agent runtime, tools, sessions, and extension callbacks.

Both peers can send requests; "host" does not mean the only request initiator.

`src/protocol/contract.ts` is the source of method names and compile-time types.
`vscode-jsonrpc` is a standalone Microsoft JSON-RPC library with no VS Code API
dependency. It owns framing, JSON parsing, correlation, errors, and cancellation;
Tauren does not maintain a second JSON-RPC parser. `RequestType<P,R,E>` describes
parameters, success result, and optional error data. `NotificationType<P>` has no
response. **These are not schemas:** dispatch must validate params at runtime
before calling SDK methods. There is no dispatcher or SDK server in step 2.

Methods returning `Snapshot`/`JsonValue` carry serialized Pi-compatible DTOs (data transfer objects) as
currently consumed by `src/pi/types.ts`. They must not contain functions, class
instances, `undefined`, signals, nonfinite numbers, credentials, or cycles.
Optional values are omitted; explicit clearing uses `null` (notably tree labels).
Detailed result validation and typed narrowing belong with the method's
implementation and its real-SDK tests, not blind forwarding of arbitrary SDK objects.
Completion DTOs mirror `src/autocomplete/types.ts` without importing it.

## Framing and lifecycle

- JSON-RPC 2.0 messages use `Content-Length: <UTF-8 byte count>\r\n\r\n<body>`.
  No batches, JSONL, banners, or diagnostics on stdout. Diagnostics go to stderr
  or `server.diagnostic`; they are never parsed from stderr as protocol data.
- Both peers may issue concurrent requests; numeric and string IDs are scoped
  to the sender. Match responses by ID, never arrival order. Success uses
  `result` (including `null`); failure uses `error`, not both. Notifications have
  no ID and no response. Null response IDs are reserved for uncorrelated errors.
- First host request is `initialize` with exact `protocolVersion: 1`, explicit
  absolute workspace/session-directory paths, optional persisted session file,
  and client version. No tilde expansion, environment forwarding, or workspace
  inference occurs on the server. Reply reports protocol/server/Pi versions,
  effective paths, and supported method names as capabilities.
- Reject incompatible protocol versions before SDK construction. Other runtime
  requests before initialization fail with `NotInitialized`; repeated initialize
  fails with `AlreadyInitialized`. Method descriptors define the protocol's
  supported operations; the completed server implements the required methods
  and advertises available capabilities during initialization. Calling an
  unavailable capability must produce an error, not a successful no-op. Runtime compatibility accepts stable patch differences
  within a major/minor line; protocol version must still match exactly.
- `chat.prompt` returns after successful SDK preflight/queue acceptance, not
  after generation. Subscribe before prompting. Preserve source literal `rpc`.
  `agent.event` carries ordered Pi-compatible events, including `prompt_handled`
  and rendered tool/custom-message DTOs. `agent_settled`, not `agent_end`, means
  retries and queued automatic work have stopped. No second prompt queue.
- Cancellation uses the library's `$/cancelRequest` and `CancellationToken` in
  either direction. Dispatch must cooperate and settle once with `Cancelled`;
  cancelling an RPC is not a substitute for `chat.abort`. Abort signals the SDK's
  generation, bash, compaction, and branch-summary operations.
- Explicit `shutdown` aborts work, settles UI requests, disposes surfaces and
  SDK runtime, acknowledges, then closes output with bounded cleanup. EOF or
  disconnect rejects pending calls and requests the same cleanup without a reply.
  Step 2's connection helper disposes the RPC connection on EOF, close, or reader
  error; step 3+ must attach actual SDK cleanup to disposal. It does not kill a
  sandbox or another connection's process.
- Reconnect creates a new server/runtime and restores persisted history via
  `session.getMessages`. Never replay a prompt or continue interrupted execution.
  Event sequence numbers restart per connection and are not replay cursors.

### Library behavior and boundaries

The connection uses the library's Node stream reader/writer. Malformed headers
and malformed JSON surfaced by the reader are fatal.

When either peer receives EOF (including mid-frame), its connection is disposed
and its outstanding outgoing request promises reject immediately. For example,
if the host receives EOF from the server, it stops waiting for server responses;
it does not leave requests pending until their deadlines.

Disposing an RPC connection is not itself cancellation of work already executing
inside the other process, nor does it automatically abort local SDK operations.
The server lifecycle must connect disposal to SDK abort/dispose and pending UI
cleanup. EOF does not send `$/cancelRequest` messages over the closed pipe. The
full server cleanup is implemented in subsequent steps; the current connection
helper supplies RPC disposal and pending-request rejection only.

EOF is also not a delivery acknowledgement: queued messages may never be
handled, and in-flight handlers are not promised a response. For graceful
shutdown, await the `shutdown` response before closing the pipe. Do not replay
an unanswered prompt after disconnect. Per-request/startup/shutdown deadlines
belong to the lifecycle service; recurring partial-frame timers are disabled.

The library is **not a hardened framing firewall**: it does not enforce a Tauren
frame-size limit, strict UTF-8 rejection, or exhaustive header/envelope schemas.
Do not describe the tests as proving those properties. A compromised sandbox or
extension can flood stdout; transport resource limits remain a step-9 hardening
requirement before exposure to untrusted peers. No custom parser is introduced
to duplicate library internals here.

### Test scope

The standalone tests focus on Tauren-owned behavior: protocol-version policy,
a basic bidirectional round trip through our connection helper, disposal on
reader errors, and pending-request rejection on EOF. Separate tests check SDK
version consistency. Framing, Unicode byte counting, ID correlation, and generic
cancellation are the library's responsibilities, not independently re-tested here.
Cancellation of actual SDK work and handler behavior require later server tests.

### Errors

Standard parse (`-32700`), invalid request (`-32600`), unknown method (`-32601`),
invalid params (`-32602`), and internal (`-32603`) codes come from JSON-RPC/the
library. Tauren assigns its application errors in JSON-RPC's implementation-defined
`-32000..-32099` range:

| Code | Meaning |
|---|---|
| -32001 | Protocol version mismatch; error data includes supported version |
| -32002 | Runtime not initialized (library `ServerNotInitialized`) |
| -32003 | Already initialized |
| -32004 | Credential policy rejection |
| -32005 | Cooperatively cancelled request |
| -32007 | Incompatible runtime, workspace, or session directory |
| -32008 | Capability unavailable |

Errors/diagnostics must not contain keys, OAuth tokens, environment dumps, or raw
provider credentials. Host login APIs open Docker Sandboxes credential guidance.
The server rejects login and logout/auth-store writes, even if called directly.
`auth.getProviders` returns sanitized provider readiness only, never stored auth
records, secret values, or credential source paths.

## Extension UI direction and ownership

- Server -> host requests: `ui.select`, `ui.confirm`, `ui.input`, `ui.editor`, and
  `ui.custom`. Cancellation/timeout uses normal request correlation and removes
  the host interaction. Dismissed dialogs return `null`.
- Host -> server: `ui.render`, `ui.surfaceInput`, `ui.dispose`, `ui.terminalInput`.
  Render dimensions include optional cell-pixel dimensions. Lines retain ANSI
  data for existing Tauren rendering. Surface IDs are opaque and connection-local.
- Factory callbacks, TUI/theme/keybinding facades, components, footer data
  providers, terminal handlers, and autocomplete providers remain beside the SDK.
  Never serialize executable JavaScript. Function-valued widgets/footer/custom UI
  become remotely rendered surfaces; invalidation notifications request redraw.
- For `ui.custom`, host dismissal/cancellation returns null; server-side input
  calls component callbacks and `done(T)` retains arbitrary completion values
  server-local, cancels/dismisses the outstanding host request, and resolves the
  SDK promise locally. Do not send arbitrary `T` over JSON.
- Terminal input is a request/result (consume/transform), not a fire-and-forget
  notification; preserve ordering. Subscription and tools-expanded state travel
  explicitly. Status/widget/footer/composer updates are notifications.
- Completion request/revision/generation and opaque item IDs preserve the current
  autocomplete registry semantics. Cancellation tokens never become JSON values.
### UI parity scope

The target is parity with Tauren's existing bundled Pi backend, not every API
available in Pi's terminal UI (TUI). In `src/sdk/extensionUiBridge.ts`, Tauren
currently treats custom editor components, terminal title/header setters, and
working-indicator customization as no-ops; Pi theme enumeration/resolution is
empty and Pi theme switching returns an unsupported error. These are existing
host UI limitations, not restrictions imposed by SBX or JSON-RPC.

The remote adapter should retain those documented behaviors unless a separate UI
feature adds support. This does not limit supported Custom UI Surfaces, widgets,
footers, dialogs, or VS Code theming. In particular, `setEditorComponent` is a Pi
TUI editor-replacement API, distinct from Tauren's supported Custom UI Surface.

## Method-to-SDK parity checklist

Unchecked means **declared, not implemented**. Step 2 does not claim runtime parity.
Runtime = `AgentSessionRuntime`; session = `runtime.session`; settings = its
cwd-bound `SettingsManager`. Bind/rebind events and UI after session replacement.

| Done | AgentClient / wire method | SDK mapping / obligation |
|---|---|---|
| [ ] | initialize | SettingsManager + SessionManager.create/open, createAgentSessionRuntime/services/fromServices; explicit paths |
| [ ] | onEvent / agent.event | session.subscribe, mapped extension errors, rendered messages, ordered events |
| [ ] | onError / server.diagnostic | Async errors distinct from failed requests |
| [ ] | isRunning | Host connection lifecycle, not session.isStreaming; no wire method |
| [ ] | prompt / chat.prompt | session.prompt with source rpc, streamingBehavior/images/preflight; prompt_handled |
| [ ] | abort / chat.abort | abortCompaction, abortBranchSummary, abortBash, session.abort |
| [ ] | reload / runtime.reload | session.reload, clear statuses/widgets, rebind extensions |
| [ ] | getState / runtime.getState | Session state + settings getters |
| [ ] | getSessionStats / runtime.getSessionStats | session.getSessionStats + name, auto-compaction, OAuth-use flag |
| [ ] | getAvailableModels / runtime.getAvailableModels | modelRuntime getModels/getAvailable/auth readiness; current-model inclusion and catalog refresh |
| [ ] | getCommands / runtime.getCommands | Extension commands + templates + skill commands and provenance |
| [ ] | getStartupResources / runtime.getStartupResources | Resource loader agents files, skills, extensions/errors, themes, templates |
| [ ] | setModel / runtime.setModel | Resolve selectable model then session.setModel |
| [ ] | setThinkingLevel / runtime.setThinkingLevel | session.setThinkingLevel |
| [ ] | updateRuntimeSetting / runtime.updateSetting | Session/settings setters; flush and drainErrors; live/reload distinction |
| [ ] | completion.get/getCapabilities/apply | Server-local PiAutocompleteRegistry equivalent; opaque handles and cancellation |
| [ ] | getAuthProviders / auth.getProviders | Sanitized readiness, no credential enumeration/material |
| [ ] | loginWithApiKey/loginWithOAuth/logoutAuthProvider | Intentional CredentialPolicy rejection; host documentation popup |
| [ ] | setSessionName / session.setName | session.setSessionName(trimmed name) |
| [ ] | compact / session.compact | session.compact |
| [ ] | exportHtml / session.exportHtml | session.exportToHtml; returned path is server-side |
| [ ] | getLastAssistantText / session.getLastAssistantText | session.getLastAssistantText, null when absent |
| [ ] | getMessages / session.getMessages | session.messages, enrich resumed custom renders; persisted truth |
| [ ] | switchSession / session.switch | runtime.switchSession, cancellation and rebind |
| [ ] | importFromJsonl / session.importJsonl | runtime.importFromJsonl; server-side input path |
| [ ] | getSessionTree / session.getTree | sessionManager.getTree/getLeafId, flatten DTO |
| [ ] | setTreeEntryLabel / session.setTreeEntryLabel | sessionManager.appendLabelChange, null removes label |
| [ ] | navigateTree / session.navigateTree | session.navigateTree, preserve cancelled/aborted/editor text |
| [ ] | getForkMessages / session.getForkMessages | session.getUserMessagesForForking |
| [ ] | fork / session.fork | runtime.fork, selectedText -> text |
| [ ] | clone / session.clone | runtime.fork(currentLeaf, position at), not shallow message copy |
| [ ] | dispose / shutdown | Await SDK disposal, reject interactions, bounded cleanup |
| [ ] | select/confirm/input/editor | Reverse requests into Tauren ExtensionUi |
| [ ] | custom/widget/footer | Server-local component factories, remote render/input/invalidation/disposal |
| [ ] | status/notify/composer/toolsExpanded | Bidirectional intent/state mapping |
| [ ] | terminal input | Ordered interception with consume/transform response |

Runtime setting mapping: defaultProvider -> settings; defaultModel -> setModel;
defaultThinkingLevel -> session thinking setter; hideThinkingBlock/quietStartup ->
settings; compaction/retry/steering/followUp -> session setters; transport/images/
skill commands -> settings with reload result; enabledModels -> scoped models +
settings. Persist and report errors, not only in-memory application.

### Outside AgentClient

- [ ] `sessions.list`: persisted Session List Lane discovery in the initialized
  session directory. Match current metadata/header/name/count/first-message and
  parent-tree expectations from `src/sessions/piSessionList.ts`; SDK list/listAll
  can be used only after parity is checked.
- [ ] `sessions.traceOrigin`: scans persisted edit/write records across sessions,
  matching `src/origin/sessionOriginTracer.ts`; no direct SDK trace API exists.
- [ ] Origin candidate lookup and path/cwd association must not fall back to host
  `~/.pi`. Scope discovery to the effective initialized store.
- [ ] Export skin postprocessing and artifact accessibility: current host code
  reads returned HTML locally. Remote paths require a mount or explicit transfer;
  returning a server-only path is not completed export parity.
- [ ] File reads/highlighting and session diff baselines retain their existing
  ownership. Do not replace Session Changes with git diff.

### Deliberately absent optional APIs

`expandPromptCommand`, `deleteSession`, `closeSession`, and `answerQuestion` are
optional in PiClient but are not implemented by the bundled PiSdkClient. Do not
advertise them as required Pi parity or invent success no-ops. Kward-specific MCP,
memory, and question APIs are not this protocol. Pi UI questions use reverse UI
requests. These absences are not credential-policy restrictions.
