# AGENTS.md

## Purpose

Guide future agents working on this VS Code extension.

This project is a minimal TypeScript VS Code extension that provides a native sidebar UI for the Pi coding agent.

## Living Document

Keep this file current when durable, project-specific learnings arrive.

Update `AGENTS.md` when a new instruction would help future agents avoid repeated research, preserve working integration details, or follow an established local pattern.

Do not add transient notes, guesses, one-off debugging observations, or broad generic coding advice.

## Current Architecture

- `package.json` defines a VS Code extension with an Activity Bar view container named `Tau`.
- The extension is TypeScript, CommonJS, and compiles `src` to `out`.
- `src/extension.ts` is only the activation entrypoint and command/view registration.
- `src/piChatViewProvider.ts` owns VS Code webview/provider integration, focus handling, notifications, workspace `cwd` lookup, cached selected-model metadata, and Tau session manager lifecycle.
- `src/tauSessionManager.ts` owns the open-session switcher model and coordinates multiple live `PiChatController` instances so background sessions can keep running.
- `src/chatSession.ts` owns pure in-memory transcript/session state and has no VS Code or Pi process dependencies.
- `src/chatWebview.ts` owns public sidebar webview HTML composition plus webview state/message types.
- `src/chatWebviewStyles.ts` owns the static sidebar CSS string.
- Browser-side sidebar logic lives under `src/webview` and is bundled by esbuild to `resources/webview/chat.js`; keep generated webview assets in `resources/webview`.
- `src/nonce.ts` owns nonce generation for CSP-protected inline scripts.
- `src/piEventMapper.ts` owns pure Pi RPC event-to-UI action mapping helpers.
- `src/extensionUiRequestHandler.ts` owns extension UI request routing through an injected VS Code UI adapter, safe cancellation, and stale request cleanup.
- `src/piSessionList.ts` owns extension-side discovery/parsing of persisted Pi session JSONL files for the sidebar session switcher.
- `src/slashCommands.ts` owns shared local slash command metadata used by both the extension host and browser webview.
- `src/piRpcClient.ts` owns the `pi --mode rpc` subprocess, strict JSONL parsing, request/response tracking, stderr collection, and process cleanup.
- Third-party webview browser bundles are vendored in `resources/vendor`; generated first-party webview bundles live in `resources/webview`; keep browser-only libraries out of runtime `dependencies` unless extension-host code imports them.
- The extension host still compiles with direct `tsc`; browser-side webview code is bundled separately with esbuild through `npm run compile:webview`.

## Pi Integration

- Prefer `pi --mode rpc` for extension integration.
- Do not use `pi -p` / `--print` for the chat UI; it is one-shot and exits after a prompt.
- Do not use `pi --mode json` for the main chat UI; it streams events for a command-line prompt but is less suitable for a persistent IDE frontend.
- Do not add `@earendil-works/pi-coding-agent` SDK as a runtime dependency unless there is a clear reason to move away from the already configured CLI.
- Start Pi in the background when the sidebar opens, receives webview `ready`, is focused, or becomes visible so live model/context metadata is available before first interaction.
- Use the first VS Code workspace folder as the Pi process `cwd`.
- Treat the Pi agent as the source of truth for current model/settings; cached model, model-list, and context metadata are only first-paint placeholders and must be visibly refreshing until live RPC data confirms or replaces them.
- Preserve cached model/model-list metadata across new sessions, clear session-scoped context usage, and refresh live metadata immediately after starting the new session.
- Keep default Pi tool and session behavior unless the user explicitly asks for safer or ephemeral behavior.
- Stop the child process when the extension provider is disposed.

## Pi RPC Protocol Rules

- RPC mode is stdin/stdout JSONL.
- Commands go to stdin, responses and events come from stdout.
- Parse records by splitting only on LF (`\n`) and stripping a trailing CR (`\r`).
- Do not use Node `readline` for RPC output; it is not protocol-compliant for Pi RPC framing.
- Prompt commands use `{ "type": "prompt", "message": "..." }` and should include an `id` for response correlation.
- Restore sidebar history from Pi RPC `get_messages` after reconnecting to the persisted `sessionFile`; do not treat a locally cached transcript as the session source of truth.
- Track responses by `id`; events do not include request ids.
- Stream assistant text from `message_update` events where `assistantMessageEvent.type === "text_delta"`.
- Treat `agent_start` as busy and `agent_end` as idle.
- Surface failed command responses, parse failures, process exits, and stderr-backed startup failures in the UI.
- Route `extension_ui_request` handling through `ExtensionUiRequestHandler`; `select`, `confirm`, and `input` use VS Code-native UI, while unsupported dialog methods still receive `extension_ui_response` with `{ cancelled: true }` so Pi does not hang.
- Fire-and-forget `notify` requests can be shown with VS Code notifications.

## UI Guidelines

- Keep the sidebar simple, clean, and VS Code-native.
- Use VS Code theme CSS variables for colors, fonts, focus, inputs, buttons, and borders.
- Keep transcript state in memory until persistence is explicitly requested.
- The sidebar `/resume` command opens the session switcher for switching session files. `/tree` opens a first-version in-session session tree view backed by the persisted JSONL session file and attempts navigation through Pi RPC `navigate_tree`; keep a graceful unsupported-RPC error until Pi exposes that command in released RPC builds.
- Disable submit while Pi is streaming; do not invent steering or follow-up queue behavior without a specific iteration goal.
- Avoid broad frontend rewrites. Preserve the existing webview structure unless the task requires changing it.

## Development Workflow

- Tests live in `src/test/suite` as TypeScript Mocha tests and run through `vscode-test`.
- Keep automated tests independent from the real `pi` CLI; test RPC framing and event mapping with local helpers or fixtures.
- Run `npm run compile` after TypeScript changes.
- Run `npm test` after changes to `src/chatSession.ts` or `src/piEventMapper.ts`.
- Use `git diff --check` before finishing edits.
- For UI behavior changes, manually verify in the VS Code Extension Host when practical.
- Keep changes small and scoped to the requested iteration.
- Do not touch unrelated files.

## References

- Pi RPC docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
- Pi JSON mode docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md
- Pi SDK docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
