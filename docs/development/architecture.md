# Architecture

Tauren is a VS Code extension with a native sidebar-style webview UI. It hosts the Pi coding agent through the bundled Pi SDK runtime and keeps transport details behind Tauren's own client contracts.

## High-level shape

```text
VS Code extension host
├─ Tauren provider/controller
├─ Pi SDK client bridge
├─ session, diff, metadata, prompt, and settings services
└─ webview HTML + bundled browser code
```

The extension host owns VS Code integration. The browser webview owns interaction rendering. Pi owns agent runtime behavior.

## Extension shell

`src/extension.ts` is intentionally small. It activates commands and views, then delegates real work to the provider and controller layers.

`package.json` defines:

- contributed commands,
- the Tauren Activity Bar view,
- configuration settings,
- keybindings,
- build and test scripts.

## Provider and controller

`src/taurenChatViewProvider.ts` owns VS Code webview/provider integration:

- focus and visibility,
- webview lifecycle,
- workspace `cwd`,
- notifications,
- Tauren session-manager lifecycle.

`src/taurenChatController.ts` owns chat orchestration. Supporting controller code under `src/controller/` handles parsing, type guards, error classification, transcript formatting, local slash commands, Pi lifecycle, and event handling.

## Webview

Browser code lives under `src/webview` and bundles to `resources/webview/chat.js`.

The extension host composes webview HTML in `src/sidebar/chatWebview.ts`; static sidebar CSS lives in `src/sidebar/chatWebviewStyles.ts` and `src/sidebar/styles/`.

## Sessions

Tauren keeps session state separate from VS Code and Pi process details. `src/chat/chatSession.ts` is pure in-memory transcript/session state.

Open-session coordination lives in `src/sessions/taurenSessionManager.ts`, with supporting session view, history, formatting, and client-action helpers under `src/sessions/`.

## Pi transport

Tauren uses a normalized, currently Pi-compatible `AgentClient` contract for chat orchestration. The Pi SDK adapter maps Pi runtime behavior into that contract, and the experimental Kward adapter maps Kward RPC behavior into the same contract.

Pi SDK loading, event mapping, and bridge code live under `src/sdk/` and `src/pi/`. Kward RPC transport and protocol adaptation live under `src/kward/`. Shared Tauren-facing backend types live under `src/agent/`.

Do not reintroduce `pi --mode rpc` for the main chat UI. The SDK transport is the supported Pi architecture.

## Diff lifecycle

Session diff behavior lives under `src/diff/`. Tauren tracks session-specific changes rather than using Git as the sidebar diff source.

## Build outputs

- Extension host TypeScript compiles to `out/`.
- Browser webview bundle outputs to `resources/webview/chat.js`.
- SDK runtime bundle outputs to `out/sdk/piSdkBundle.mjs` and runtime assets under `resources/pi-sdk-runtime/`.
- Documentation builds to `docs/.vitepress/dist/`, which is ignored.

## Design rule

Keep ownership boundaries clear. Extension-host code should own VS Code integration, browser code should own DOM interaction, and the selected backend should remain the source of truth for agent runtime behavior.

Controller and UI code should depend on `AgentClient`/`AgentEvent` rather than concrete Pi or Kward protocol shapes. Pi and Kward protocol adapters should normalize backend-specific events before they leave the adapter.
