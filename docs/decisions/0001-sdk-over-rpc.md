# 0001 — Move Tauren from RPC transport to bundled Pi SDK

## Status

Accepted

## Context

Tauren originally communicated with Pi through RPC mode by spawning the external `pi` binary and exchanging JSONL messages.

This approach worked well early on because it provided:

- process isolation
- compatibility with arbitrary external Pi binaries
- transport simplicity
- a clear protocol boundary

However, as Tauren evolved, several limitations became increasingly costly:

- feature lag behind the Pi SDK runtime
- difficulty supporting advanced session features
- limited access to live runtime/session state
- no reliable access to tree navigation
- awkward custom UI/runtime integration
- duplicated lifecycle handling
- additional complexity around process orchestration
- plugin/runtime features requiring deeper integration

At the same time, Pi's SDK became stable enough to expose:

- live session runtime APIs
- extension UI hooks
- tree navigation
- session switching/forking
- direct model/runtime access
- extension/plugin infrastructure

Tauren's architecture already isolated transport details behind a client abstraction (`PiClientLike` / `PiClient`), making migration feasible.

## Decision

Tauren now uses the bundled Pi SDK as its primary runtime transport.

The external RPC process path and `piPath` configuration were removed.

Tauren embeds the Pi SDK and hosts Pi sessions directly inside the VS Code extension host process.

The SDK runtime is loaded through a bundled ESM bridge to:

- reduce VSIX size
- avoid shipping the entire Pi repository/runtime tree
- preserve compatibility with VS Code's CommonJS extension host

## Consequences

### Positive

- Full access to Pi runtime/session APIs
- Session tree navigation support
- Plugin/custom UI support
- Better lifecycle integration
- Less transport glue code
- Reduced architectural duplication
- Faster feature parity with Pi
- More consistent session/runtime behavior

### Negative

- Tauren no longer supports arbitrary external `pi` binaries
- Pi runtime now shares the VS Code extension host process
- SDK upgrades require compatibility validation
- Plugin/runtime issues can affect Tauren more directly
- Bundling/runtime packaging complexity increased

## Notes

The migration intentionally preserved several compatibility semantics from the RPC era where useful, including:

- event behavior
- prompt lifecycle expectations
- extension compatibility assumptions

The SDK integration is treated as:

- Pi = engine/runtime
- Tauren = UI/workflow host

Tauren should avoid leaking VS Code-specific assumptions into Pi extensions whenever possible.
