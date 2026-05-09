# AGENTS.md

## Purpose

Guide future agents working on this VS Code extension.

This project is a minimal TypeScript VS Code extension that provides a native sidebar UI for the Pi coding agent.

## Living Document

Keep this file current when durable, project-specific learnings arrive.

Update `AGENTS.md` when a new instruction would help future agents avoid repeated research, preserve working integration details, or follow an established local pattern.

Do not add transient notes, guesses, one-off debugging observations, or broad generic coding advice.

## Current Architecture

- `package.json` defines a VS Code extension with an Activity Bar view container named `Pi`.
- The extension is TypeScript, CommonJS, and compiles `src` to `out`.
- `src/extension.ts` is only the activation entrypoint and command/view registration.
- `src/piChatViewProvider.ts` owns VS Code webview/provider integration, focus handling, notifications, workspace `cwd` lookup, and Pi client lifecycle.
- `src/chatSession.ts` owns pure in-memory transcript/session state and has no VS Code or Pi process dependencies.
- `src/chatWebview.ts` owns the sidebar webview HTML, CSS, browser script, nonce generation, and webview message types.
- `src/piEventMapper.ts` owns pure Pi RPC event-to-UI action mapping helpers.
- `src/piRpcClient.ts` owns the `pi --mode rpc` subprocess, strict JSONL parsing, request/response tracking, stderr collection, and process cleanup.
- There is no bundler. Keep the implementation compatible with the current direct `tsc` build.

## Pi Integration

- Prefer `pi --mode rpc` for extension integration.
- Do not use `pi -p` / `--print` for the chat UI; it is one-shot and exits after a prompt.
- Do not use `pi --mode json` for the main chat UI; it streams events for a command-line prompt but is less suitable for a persistent IDE frontend.
- Do not add `@earendil-works/pi-coding-agent` SDK as a runtime dependency unless there is a clear reason to move away from the already configured CLI.
- Spawn Pi lazily on first submitted prompt, not when the sidebar opens.
- Use the first VS Code workspace folder as the Pi process `cwd`.
- Treat the Pi agent as the source of truth for current model/settings; after a new session or restart, re-read state from the agent instead of preserving or guessing local settings.
- Keep default Pi tool and session behavior unless the user explicitly asks for safer or ephemeral behavior.
- Stop the child process when the extension provider is disposed.

## Pi RPC Protocol Rules

- RPC mode is stdin/stdout JSONL.
- Commands go to stdin, responses and events come from stdout.
- Parse records by splitting only on LF (`\n`) and stripping a trailing CR (`\r`).
- Do not use Node `readline` for RPC output; it is not protocol-compliant for Pi RPC framing.
- Prompt commands use `{ "type": "prompt", "message": "..." }` and should include an `id` for response correlation.
- Track responses by `id`; events do not include request ids.
- Stream assistant text from `message_update` events where `assistantMessageEvent.type === "text_delta"`.
- Treat `agent_start` as busy and `agent_end` as idle.
- Surface failed command responses, parse failures, process exits, and stderr-backed startup failures in the UI.
- For unsupported `extension_ui_request` dialog methods, send `extension_ui_response` with `{ cancelled: true }` so Pi does not hang.
- Fire-and-forget `notify` requests can be shown with VS Code notifications.

## UI Guidelines

- Keep the sidebar simple, clean, and VS Code-native.
- Use VS Code theme CSS variables for colors, fonts, focus, inputs, buttons, and borders.
- Keep transcript state in memory until persistence is explicitly requested.
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
