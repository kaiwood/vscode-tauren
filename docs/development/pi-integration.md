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
