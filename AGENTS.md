# AGENTS.md

## Purpose

Guide future agents working on Tau, a minimal TypeScript VS Code extension that provides a native sidebar UI for the Pi coding agent.

## Living Document

Update this file only for durable, project-specific guidance that prevents repeated research, preserves integration details, or records established local patterns. Do not add transient notes, guesses, one-off debugging observations, or generic coding advice.

## Pi Docs Lookup

Pi docs are installed with the SDK package. Prefer local package docs before web links:

- Docs: `node_modules/@earendil-works/pi-coding-agent/docs/`
- Examples: `node_modules/@earendil-works/pi-coding-agent/examples/`
- Start with `docs/index.md`; for transport work read `docs/sdk.md`, `docs/rpc.md`, `docs/json.md`, and related cross-references.
- Topic docs include `extensions.md`, `themes.md`, `skills.md`, `prompt-templates.md`, `tui.md`, `keybindings.md`, `custom-provider.md`, `models.md`, `packages.md`, `sessions.md`, and `session-format.md`.
- Use GitHub docs only as a fallback when local docs are unavailable or stale.

## Architecture Map

- Extension shell: `package.json` defines the Tau Activity Bar view; TypeScript is CommonJS and compiles `src` to `out`; `src/extension.ts` only activates commands/views.
- Provider/controller split: `src/piChatViewProvider.ts` owns VS Code webview/provider integration, focus/visibility, notifications, workspace `cwd`, and Tau session-manager lifecycle. `src/piChatController.ts` owns Tau chat orchestration; parsing, type guards, error classification, controller option types, transcript formatting, Pi client lifecycle, local slash commands, and Pi event handling live under `src/controller/`.
- Session state: `src/chat/chatSession.ts` is pure in-memory transcript/session state with no VS Code or Pi process dependencies.
- Open sessions: `src/sessions/tauSessionManager.ts` owns the open-session switcher and coordinates multiple live `PiChatController` instances so background sessions keep running; open-session controller state types stay local there. `sessionViewController.ts`, `sessionHistoryController.ts`, `sessionClientActions.ts`, and `sessionFormatting.ts` own extension-side session UI state/actions, history adoption, background session-client actions, and formatting. `piSessionList.ts` parses persisted Pi session JSONL for the sidebar switcher; `piSessionTree.ts` parses persisted JSONL for the in-session tree view.
- Webview host: `src/sidebar/chatWebview.ts` owns extension-host sidebar HTML composition and message parsing; `chatWebviewStyles.ts` owns static sidebar CSS; `nonce.ts` owns CSP nonce generation. `src/webviewProtocol/types.ts` owns webview message/state/protocol types shared by the provider, controller, sidebar HTML helpers, and tests.
- Browser webview: browser code lives under `src/webview` and bundles to `resources/webview/chat.js`; keep generated webview assets in `resources/webview`. `main.ts` is only composition/ready entrypoint. `composer/` owns textarea sizing, submit/stop, model/thinking picker, prompt context badges, slash menu, and diff-summary controls; `composer/diffCounter.ts` owns session diff-counter formatting/animation. `messages/` owns incremental rendering, scrolling, busy status, clicks, and, via `renderMessages.ts`, `markdown.ts`, and `ansi.ts`, transcript/markdown/ANSI formatting. `sessions/` owns session list/tree UI, command menus, title/menu controls, row/menu creation, keyboard navigation, and, via `sessionFormat.ts` and `sessionItemCommands.ts`, row formatting and command metadata. `codeHighlighting.ts` owns async code-highlight requests/results for markdown fences and read-tool boxes; reuse it for future code/diff panes where practical.
- Highlighting: `src/highlighting/shikiCodeRenderer.ts` owns extension-host Shiki syntax rendering, VS Code theme/language registration resolution, fallback bundled Shiki themes/languages, and highlight-result caching.
- Prompt/metadata/ready script: `src/prompt/` owns one-shot IDE prompt context attachment types, state, normalization, labels, editor extraction, prompt formatting, and webview projection. `src/metadata/sessionMetadata.ts` owns session model/context/slash-command metadata state, refresh orchestration, formatting, and equality checks; `types.ts` and `cache.ts` own shared metadata/cache shapes and persisted cache parsing/writing, including legacy model-cache migration. `src/readyScript/` owns ready-script running, arming/queued-run transitions, and shared types.
- Pi data helpers: `src/pi/eventMapper.ts` maps Pi events to UI actions. `src/pi/messageContent.ts` extracts tolerant Pi message text. `src/pi/sessionJsonl.ts` parses tolerant Pi session JSONL for session-list, session-tree, and diff-history readers. `src/pi/types.ts` and `src/pi/clientTypes.ts` own transport-facing Pi data/client contracts used by the SDK client and tests.
- Diff lifecycle: `src/diff/sessionDiffController.ts` owns `PiChatController` session diff lifecycle: session-file binding, snapshot restore/save, refresh dedupe, and state-post callbacks. `sessionDiffTracker.ts` owns per-session changed-line baselines, net line diff stats, reconstructed per-file snapshot diffs, and recorded-edit fallback diffs for Pi edit/write tool executions; do not replace this with git diff for the sidebar counter or session changes view. `sessionDiffViewer.ts` owns the read-only virtual snapshot documents plus VS Code multi-file diff adapter; keep the adapter isolated for a future custom annotated diff UI. `sessionDiffUri.ts` owns Tau diff URI scheme/context helpers shared by the diff viewer and prompt-context extraction; `sessionDiffStorage.ts` owns VS Code storage and file-watcher helpers for session diff snapshots/stat refresh.
- Commands/UI bridge: `src/commands/slashCommands.ts` owns local slash-command metadata shared by the extension host and browser webview. `src/extensionUi/types.ts` owns the VS Code UI adapter shape passed to Pi SDK extension UI bindings.
- Pi transport: `src/sdk/piSdkClient.ts`, `src/sdk/piSdkLoader.ts`, `src/sdk/piSdkEventMapper.ts`, and `src/sdk/extensionUiBridge.ts` own the in-process bundled Pi SDK transport. Tau no longer launches `pi --mode rpc` or exposes `tau.piPath`; keep Pi client code behind the transport-neutral `PiClient` contract.
- Bundling/dependencies: `scripts/piSdkBundleEntry.ts` and `scripts/build-sdk-bundle.js` produce `out/sdk/piSdkBundle.mjs` and SDK runtime assets under `resources/pi-sdk-runtime`; `@earendil-works/pi-coding-agent` is a build-time `devDependency`, not a packaged runtime dependency. Third-party webview browser bundles are vendored in `resources/vendor`; generated first-party webview bundles live in `resources/webview`; keep browser-only libraries out of runtime `dependencies` unless extension-host code imports them. Shiki and `vscode-shiki-bridge` are runtime dependencies because highlighting runs in the extension host. `.vscodeignore` must not exclude runtime `dependencies`; VSIX installs do not have workspace `node_modules`, so let `vsce` include production dependencies such as Shiki while excluding build-time-only SDK source dependencies. Extension host compiles with `tsc`; browser code with `npm run compile:webview`; SDK transport with `npm run compile:sdk`.

## Pi Integration

- Tau runs Pi in-process through the bundled/tree-shaken SDK bundle.
- Do not reintroduce `pi --mode rpc`, `pi -p` / `--print`, or `pi --mode json` for the main chat UI; they are less suitable for Tau's persistent IDE frontend.
- Start Pi in the background when the sidebar opens, receives webview `ready`, is focused, or becomes visible so live model/context metadata is available before first interaction.
- Use the first VS Code workspace folder as the Pi process/runtime `cwd`.
- Treat Pi as the source of truth for current model/settings. Cached model, model-list, and context metadata are only first-paint placeholders and must visibly refresh until live data confirms or replaces them.
- Across new sessions, preserve cached model/model-list metadata, clear session-scoped context usage, and refresh live metadata immediately.
- Keep default Pi tool/session behavior unless the user explicitly asks for safer or ephemeral behavior.
- Dispose the SDK runtime when the extension provider is disposed.
- Restore sidebar history from `getMessages()` after reconnecting to the persisted `sessionFile`; do not treat locally cached transcript as the session source of truth.
- Stream assistant text from `message_update` events where `assistantMessageEvent.type === "text_delta"`.
- Treat `agent_start` as busy and `agent_end` as idle.
- Surface SDK diagnostics, startup failures, extension errors, and runtime errors in the UI.
- Keep Pi prompt input source set to the upstream literal `"rpc"` in `PiSdkClient` unless Pi exposes a better IDE/SDK source; this preserves compatibility with existing Pi extensions that branch on `event.source`.

## UI Guidelines

- Keep the sidebar simple, clean, VS Code-native, and themed with VS Code CSS variables for colors, fonts, focus, inputs, buttons, and borders.
- Code highlighting uses extension-host Shiki asynchronously; do not reintroduce highlight.js unless explicitly requested.
- Keep Shiki failure-tolerant: code must remain readable as plain text if theme/language resolution or highlighting fails.
- Preserve the bundled Shiki fallback in `src/highlighting/shikiCodeRenderer.ts`; it prevents read boxes from silently losing highlighting when VS Code theme/grammar resolution is unreliable.
- Keep transcript state in memory until persistence is explicitly requested.
- `/resume` opens the session switcher. `/tree` opens the live SDK-backed session tree.
- Disable submit while Pi is streaming; do not invent steering or follow-up queue behavior without a specific iteration goal.
- Avoid broad frontend rewrites; preserve the current webview structure unless the task requires changing it.

## Development Workflow

- For user-facing changes, add a concise `Unreleased` entry to `CHANGELOG.md`.
- Tests live in `src/test/suite` as TypeScript Mocha tests and run through `vscode-test`.
- Keep automated tests independent from the real `pi` CLI; test SDK client/event mapping with local helpers or fixtures.
- Run `npm run compile` after TypeScript changes.
- Run `npm test` after changes to `src/chat/chatSession.ts` or `src/pi/eventMapper.ts`.
- Run `git diff --check` before finishing edits.
- For UI behavior changes, manually verify in the VS Code Extension Host when practical.
- For syntax-highlighting changes, manually verify fresh and resumed read-tool boxes, markdown fenced code, theme switching, and unsupported-extension fallback.
- Keep changes small and scoped; do not touch unrelated files.

## References

- Local Pi docs: `node_modules/@earendil-works/pi-coding-agent/docs/`
- Local Pi examples: `node_modules/@earendil-works/pi-coding-agent/examples/`
- GitHub fallback: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/`
