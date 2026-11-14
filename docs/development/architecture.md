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

## Shared Node helpers

`shared/` is a private third Node project, installed by the extension and
`sandbox-server/` as the local `@tauren/shared` dependency. It owns pure completion,
component rendering/facades, session tree/summary parsing and origin scanning.
Transport-specific UI hosts remain separate. Conditional exports provide CommonJS
for the extension and ESM for the server; each consumer builds the shared package
first. Install its independent lockfile with `npm ci --prefix shared`.

Consumers import `@tauren/shared` helper subpaths directly; only adapters with
backend-specific behavior remain local. Do not copy helpers between projects. There is no generated source staging step;
`shared/dist` is build output, and installed package artifacts must contain it.

## Sandbox UI and rendering flow

The sketch below shows the SBX UI path. The standalone server side is implemented;
the SSH transport and Tauren SBX host adapter are still planned. The existing
in-process Pi backend continues to render without crossing a sandbox boundary.

```text
                    shared/ — @tauren/shared
                 One maintained Node library, not a service
                 ┌──────────────────────────────────────┐
                 │ Component → text/image rendering     │
                 │ Tool/custom-message renderers        │
                 │ Theme, keybinding and TUI facades     │
                 │ Composer completion registry         │
                 └─────────────┬─────────────┬──────────┘
                     imported │             │ imported
                       as ESM ▼             ▼ as CommonJS
 ┌──────────────────────────────┐   ┌─────────────────────────────────┐
 │ Sandbox                      │   │ Tauren / VS Code host           │
 │                              │   │                                 │
 │ Pi SDK + Pi extensions       │   │ Existing in-process Pi backend  │
 │   │                          │   │ uses the same shared helpers    │
 │   ├─ Tool/message callbacks  │   │                                 │
 │   │    → shared renderer     │   │ SBX host adapter (planned)      │
 │   │    → transcript DTOs ────┼──►│   → transcript presentation     │
 │   │                          │   │                                 │
 │   └─ ctx.ui calls            │   │                                 │
 │        → RemoteExtensionUi ──┼──►│   → dialogs, status, Composer   │
 │        → local components   │   │   → widgets/footer/custom UI    │
 │                  ▲          │   │                │                │
 │                  │          │   │                ▼                │
 │      ui.render request ◄────┼───┤ Layout dimensions               │
 │      shared render helper   │   │                                 │
 │      text/image blocks ─────┼──►│ Webview draws the surface       │
 │                  ▲          │   │                │                │
 │      input/focus/dispose ◄───┼───┤ Keyboard and surface lifecycle  │
 │      handleInput / cleanup  │   │                                 │
 │      redraw notification ───┼──►│ Request another render          │
 └──────────────────────────────┘   └─────────────────────────────────┘
                   Boundary: framed JSON-RPC over SSH stdio (planned)
```

There are two rendering paths:

- **Transcript:** Pi tool/custom-message callbacks return components. Shared
  helpers render them beside Pi and attach `body`, optional `expandedBody`, and
  `code` presentation fields to tool/message events. Original SDK content remains
  available. Restored custom messages are rendered afresh from Pi history.
- **Interactive surfaces:** `RemoteExtensionUi` retains widget/footer/custom
  components under opaque surface IDs. The host supplies dimensions via
  `ui.render`; the server returns ANSI-styled text lines and optional text/image
  blocks. Input returns to the component; invalidation asks the host to redraw.
  A surface is not a captured Pi terminal screen or remotely executed HTML.

Dialogs use reverse requests and host responses; status, notifications and
Composer changes use UI-intent notifications. Completion factories and cached
suggestions remain beside Pi; the host exchanges text/cursor positions, suggestion
labels, opaque item IDs and applied text/cursor results.

**Never transferred:** component instances, renderer functions, closures, or
arbitrary values passed to custom UI `done(value)`. Those execute and resolve
inside the Pi process. The host owns actual VS Code/webview display and input.
`shared/` supplies code to both processes; it neither connects them nor owns UI
lifetimes. The host-specific UI hosts and `RemoteExtensionUi` therefore remain
separate implementations.

## Build outputs

- Extension host TypeScript compiles to `out/`.
- Shared Node helpers compile to `shared/dist/cjs` and `shared/dist/esm`.
- Browser webview bundle outputs to `resources/webview/chat.js`.
- The extension-host SDK runtime bundle outputs to `resources/pi-sdk-runtime/sdk/piSdkBundle.mjs` with peer shims under `resources/pi-sdk-runtime/sdk/node_modules/`; this is not the sandbox runtime.
- SBX server mixin builds to `resources/generated-sbx-kit/`, with only bundled
  server/shared/JSON-RPC code under `files/home/.tauren/server/`. Its entrypoints
  are `dist/main.js` and the installed-Pi resolver `dist/sandboxPi.js`; no second
  SDK runtime, SDK assets, Jiti, or extension peer shims are packaged there. The
  rendered default sandbox descriptor is separate at
  `resources/generated-sbx-sandbox/spec.yaml`. Production Pi kits remain v2;
  the disposable shell-test kits remain v3.
- Documentation builds to `docs/.vitepress/dist/`, which is ignored.

### Sandbox Pi ownership

The packaged resolver uses the first executable `pi` on sandbox `PATH`, follows
its symlink with `realpath`, and walks ancestors to the package named
`@earendil-works/pi-coding-agent`. It imports that installation's public root SDK
export (`exports['.'].import`, or a string root export), not the CLI or private
SDK files. An unusable first Pi fails explicitly; there is no server-owned SDK
fallback. Assets, Jiti and extension peers keep their existing package layout and
module identity unchanged.

Server metadata `sandboxPiSdkVersion` records the build compatibility baseline:
stable major/minor must match, patches may differ, and prereleases must match
exactly. The imported SDK's `VERSION` must also match its package metadata. The
handshake reports this actual loaded version, never merely the expected baseline.
Standalone development and subprocess tests still use the server's pinned SDK.
The passing extracted-VSIX gate instead provisions an independent installed Pi
tree outside the checkout, exposes its correct CLI via an isolated `PATH` symlink,
and verifies missing/incompatible Pi failures and real SDK behavior.

## Design rule

Keep ownership boundaries clear. Extension-host code should own VS Code integration, browser code should own DOM interaction, and the selected backend should remain the source of truth for agent runtime behavior.

Controller and UI code should depend on `AgentClient`/`AgentEvent` rather than concrete Pi or Kward protocol shapes. Pi and Kward protocol adapters should normalize backend-specific events before they leave the adapter.
