# Pi Integration

Tauren runs Pi in-process through the bundled Pi SDK runtime.

## Why SDK instead of RPC

Tauren originally used an external `pi` process in RPC mode. The project moved to the SDK because advanced Tauren features need live access to Pi runtime state, session tree navigation, model metadata, and extension UI hooks.

See [ADR 0001](../decisions/0001-sdk-over-rpc.md) for the full decision.

## Runtime ownership

Pi owns:

- provider and model state,
- session state,
- tool execution,
- skills, prompts, themes, and extensions,
- tree navigation,
- runtime settings.

Tauren owns:

- VS Code integration,
- webview rendering,
- session switching UI,
- local slash commands,
- prompt context attachment,
- session diff tracking,
- diagnostics presentation.

## SDK bridge files

Key areas:

- `src/sdk/piSdkClient.ts`
- `src/sdk/piSdkLoader.ts`
- `src/sdk/piSdkEventMapper.ts`
- `src/sdk/extensionUiBridge.ts`
- `src/pi/eventMapper.ts`
- `src/pi/messageContent.ts`
- `src/pi/types.ts`

The bundled SDK build is produced by:

```sh
npm run compile:sdk
```

The build also generates small Node-compatible shims for Pi extension peer imports such as `@earendil-works/pi-ai` and `@earendil-works/pi-tui`. Their public export paths are discovered from the installed Pi SDK, so `npm run update:pi-sdk` validates the current peer-import surface as part of its compile step. If Pi changes an unsupported export layout, fix the generator before releasing the SDK update rather than shipping a partial runtime.

## Offline SDK integration tests

`src/test/suite/piSdkIntegration.test.ts` drives `PiSdkClient` through the real bundled SDK with a scripted in-process provider. It covers streamed turns, persisted-session reopening, real read/write/edit tools, extension input/UI notifications, and generation cancellation followed by recovery. Workspaces, settings, credentials, and sessions are isolated in temporary directories. No external model service or credentials are needed.

These tests run with `npm test`, or directly after compilation:

```sh
npm run compile
npx mocha --ui tdd --timeout 15000 out/test/suite/piSdkIntegration.test.js
```

The fixture replaces model I/O, not SDK sessions or tools. It does not cover live-provider authentication, browser layout, or the complete extension Custom UI lifecycle; those still need separate checks.

## Standalone sandbox protocol project

The private `sandbox-server/` npm project owns the SBX server's shared wire contract and standalone tests. Install its independent lockfile with `npm ci --prefix sandbox-server`, then use:

```sh
npm run compile:sandbox-server
npm run test:sandbox-server
```

See `sandbox-server/docs/protocol.md` for the method-to-SDK mapping and parity checklist. Root `compile:sdk` and `verify:pi-sdk` check SDK release-line compatibility with the standalone project. If an SDK update crosses major/minor versions, update the standalone manifest and lockfile explicitly; patch differences are permitted. Production server packaging is a later implementation step.

## Startup behavior

Tauren starts Pi in the background when the sidebar opens, the webview becomes ready, the view receives focus, or the view becomes visible. This keeps model and context metadata available before the first prompt.

The first VS Code workspace folder is used as the runtime working directory.

## Event mapping

Pi runtime events are mapped into Tauren UI actions. Important event expectations include:

- `agent_start` means the session is busy.
- `agent_end` means the session is idle.
- assistant text streams through `message_update` text deltas.

## Kward MCP discovery

When the Kward backend is selected, Tauren consumes Kward RPC `tools/list` and `mcp/status` for MCP/tool discovery. Kward owns MCP configuration and execution; Tauren only displays discovered tools and server status through Kward-only commands such as `/mcp` and `/tools`.

These commands are not exposed when Pi is the active backend.

## Extension UI bridge

Pi extensions call Pi UI APIs. Tauren maps those calls into sidebar surfaces through the extension UI bridge.

```text
Pi extension intent
→ Pi ctx/ui API
→ Tauren bridge
→ VS Code/webview surface
```

The bridge should keep Pi extensions runtime-agnostic. Avoid making plugins depend on VS Code-specific behavior.

### Composer autocomplete

Tauren supports Pi’s `ctx.ui.addAutocompleteProvider()` contract in the composer. Providers are stacked in registration order: the most recently registered factory wraps the current chain. An extension can return its own items, delegate to the current provider, and delegate `applyCompletion()` for ordinary insertion behavior.

Tauren supplies the base `@` workspace-file provider, so extensions should delegate when they do not handle the current syntax. Registered `triggerCharacters` are unioned and drive automatic composer requests at token boundaries; `shouldTriggerFileCompletion()` can suppress only automatic file completion. Provider results are applied by the extension host, allowing custom multiline text and cursor placement. TUI-only custom editor components remain unsupported.
