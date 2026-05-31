# AGENTS.md

## Purpose

Guide agents working on Tauren, a TypeScript VS Code extension that provides a native sidebar UI for the Pi coding agent.

Keep this file durable and concise. Prefer links to repo docs over repeating detailed architecture that can drift.

## Required Language

Use the Tauren UI Language from `docs/development/ui-language.md`.
Do not invent new names for surfaces.

## Start Here

Before architecture or integration work, read the relevant development docs:

- Overall architecture: `docs/development/architecture.md`
- Pi integration: `docs/development/pi-integration.md`
- Webview structure: `docs/development/webview.md`
- Sessions: `docs/development/sessions.md`
- Diff lifecycle: `docs/development/diff-lifecycle.md`
- Release flow: `docs/development/release.md`

For Pi SDK docs, prefer local package docs before web links:

- Docs: `node_modules/@earendil-works/pi-coding-agent/docs/`
- Examples: `node_modules/@earendil-works/pi-coding-agent/examples/`
- Start with `docs/index.md`.
- For transport work, read `docs/sdk.md`, `docs/rpc.md`, `docs/json.md`, and related cross-references.
- Use GitHub docs only as a fallback when local docs are unavailable or stale.

## Core Constraints

- Keep changes small and scoped. Do not refactor unrelated code.
- `src/extension.ts` should stay a thin activation shell for commands/views.
- Tauren runs Pi through the bundled in-process SDK runtime. Do not reintroduce `pi --mode rpc`, `pi -p` / `--print`, or `pi --mode json` for the main chat UI.
- Keep Pi client code behind the transport-neutral `PiClient` contract.
- Pi is the source of truth for runtime state: models, settings, sessions, tools, tree navigation, extensions, skills, prompts, and themes.
- Prefer the first VS Code workspace folder as Pi runtime `cwd`. If no workspace is available, Tauren may fall back to the user home directory unless workspace mutation rejection requires a workspace.
- Preserve default Pi tool/session behavior unless the user explicitly asks for safer or ephemeral behavior.
- Keep Pi prompt input source set to the upstream literal `"rpc"` in `PiSdkClient` unless Pi exposes a better IDE/SDK source; this preserves compatibility with extensions that branch on `event.source`.
- Restore sidebar history from Pi `getMessages()` after reconnecting to a persisted `sessionFile`; do not treat locally cached transcript as the session source of truth.
- Keep Tauren's rendered transcript state in memory; persisted history comes from Pi session files.
- Running background sessions should stay alive; inactive idle sessions may be disposed by the session manager retention limits.

## UI Constraints

- Keep the sidebar simple, clean, VS Code-native, and themed with VS Code CSS variables.
- Browser webview code lives under `src/webview`; host-side HTML/CSS composition lives under `src/sidebar`.
- Generated first-party webview assets live in `resources/webview`; vendored browser-only libraries live in `resources/vendor`.
- Code highlighting uses extension-host Shiki asynchronously. Do not reintroduce highlight.js unless explicitly requested.
- Keep Shiki failure-tolerant: code must remain readable as plain text if theme/language resolution or highlighting fails.
- While Pi is busy, Tauren supports Pi steering/follow-up behavior. Do not add new prompt-queue semantics without a specific design goal.
- `/resume` opens the Session List Lane. `/tree` opens the live SDK-backed Session Tree Lane.
- Avoid broad frontend rewrites; preserve the current webview structure unless the task requires changing it.

## Diff Constraints

- `src/diff/sessionDiffTracker.ts` owns session-specific changed-line baselines, net line stats, snapshot diffs, and recorded edit/write fallbacks.
- Do not replace sidebar diff counters or Session Changes behavior with git diff.
- Keep the read-only virtual snapshot diff adapter isolated in `src/diff/sessionDiffViewer.ts`.

## Extension UI Bridge

- `src/extensionUi/` owns Tauren-side Pi extension UI hosts, widget/footer/custom UI rendering helpers, and shared adapter types.
- `src/sdk/extensionUiBridge.ts` maps Pi extension UI intent into Tauren/VS Code/webview surfaces.
- Keep Pi extensions runtime-agnostic; do not make plugins depend on VS Code-specific behavior.

## Packaging / Dependencies

- `@earendil-works/pi-coding-agent` is a build-time `devDependency`; bundled runtime assets are generated into `resources/pi-sdk-runtime` and `out/sdk/piSdkBundle.mjs`.
- Shiki and `vscode-shiki-bridge` are runtime dependencies because highlighting runs in the extension host.
- `.vscodeignore` must not exclude runtime dependencies needed by the packaged VSIX.
- Browser-only libraries should not become runtime dependencies unless extension-host code imports them.

## Development Workflow

- For user-facing changes, add a concise `Unreleased` entry to `CHANGELOG.md`.
- Tests live in `src/test/suite` and run through `vscode-test`.
- Keep automated tests independent from the real `pi` CLI; use local helpers or fixtures.
- Run `npm run compile` after TypeScript changes.
- Run `npm test` after changes to `src/chat/chatSession.ts` or `src/pi/eventMapper.ts`.
- Run `git diff --check` before finishing edits.
- For UI behavior changes, manually verify in the VS Code Extension Host when practical.
- For syntax-highlighting changes, manually verify fresh and resumed read-tool boxes, markdown fenced code, theme switching, and unsupported-extension fallback.
