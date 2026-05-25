# 0003 — Introduce a plugin/custom UI bridge for Pi extensions

## Status

Accepted

## Context

Pi extensions/plugins were originally designed primarily for terminal/TUI environments.

As Tauren adopted the bundled Pi SDK runtime, Pi extensions gained access to:

- `ctx.ui.*`
- custom runtime UI flows
- interactive prompts
- terminal-style rendering
- extension-driven workflows

Tauren initially only supported:

- transcript rendering
- notifications
- simple prompts/selects

This prevented many Pi plugins from functioning correctly inside Tauren.

Examples:

- `rpiv-ask-user-question`
- `pi-btw`
- `pi-doom`

At the same time, Tauren's architecture already contained:

- runtime overlays
- keyboard-first navigation
- ANSI rendering
- session isolation
- multiple active sessions

This made a richer runtime bridge feasible.

## Decision

Tauren now hosts Pi extension UI interactions through an internal plugin/custom UI bridge.

Pi extensions remain runtime-agnostic and do not directly depend on VS Code APIs.

The architecture is:

```text
Pi extension intent
→ Pi ctx/ui API
→ Tauren bridge
→ VS Code/webview/runtime surface
```

Tauren is responsible for:

- rendering
- keyboard routing
- focus management
- runtime isolation
- overlay lifecycle
- session scoping

## Supported capabilities

Initial bridge support includes:

- notifications
- confirms
- input prompts
- selection dialogs
- custom runtime UI surfaces
- ANSI rendering
- Kitty-compatible keyboard input
- key repeat/release events
- cursor rendering

Custom runtime UIs are hosted inside Tauren runtime surfaces and remain scoped to their originating session.

## Consequences

### Positive

- Pi plugin ecosystem becomes usable inside Tauren
- Interactive runtime workflows are possible
- Multiple concurrent plugin/runtime surfaces are supported
- Tauren becomes a richer runtime host instead of only a transcript viewer
- Plugins remain portable between terminal Pi and Tauren

### Negative

- Runtime/UI lifecycle complexity increased
- Keyboard/input routing became more complex
- Custom UI rendering/performance concerns were introduced
- Plugin/runtime isolation now matters more

## Notes

Tauren intentionally treats plugin/runtime surfaces as:

- runtime work surfaces
- not generic webview applications

The current bridge remains terminal/TUI-oriented by design.

Future richer plugin rendering models may evolve from this bridge, but terminal compatibility remains the first priority because the Pi plugin ecosystem is currently optimized around TUI workflows.
