# 0002 — Adopt a true three-lane sidebar model

## Status

Accepted

## Context

Tauren originally treated the sidebar session list and session tree as variations of the same shared pane.

This worked initially, but became increasingly fragile as:

- session tree navigation evolved
- direct transitions between list/tree were added
- animations became spatially inconsistent
- runtime/plugin surfaces expanded
- the settings surface was introduced

The UI concept had already evolved mentally into:

```text
| Session List | Chat | Session Tree |
```

But the implementation still used:

- one shared `.sessions` pane
- conditional rendering swaps
- lane state emulation

This caused:

- incorrect slide directions
- content swaps in place
- animation inconsistencies
- increasingly confusing state logic

## Decision

Tauren now models the sidebar as a true three-lane system:

```text
| Session List | Chat | Session Tree |
```

Each lane has its own independent surface and transition behavior.

### Lanes

- Session List Lane
  - left side
  - session file navigation
  - session management actions

- Chat Lane
  - center
  - transcript
  - composer
  - plugin/custom UI runtime surfaces
  - settings back-face

- Session Tree Lane
  - right side
  - Pi runtime tree navigation within a session

## Consequences

### Positive

- Correct spatial navigation semantics
- Consistent animations
- Cleaner lane ownership
- Reduced conditional rendering complexity
- Better future support for runtime/plugin surfaces
- Cleaner mental model

### Negative

- More DOM/layout surfaces
- More CSS/state coordination
- Additional navigation state complexity

## Notes

The three-lane model intentionally mirrors Tauren's workflow philosophy:

- left = session/file-level navigation
- center = active runtime/work surface
- right = runtime history/tree navigation

The Chat Lane may itself contain multiple "faces":

- main transcript face
- settings face
- future runtime/configuration surfaces

This distinction is intentional:

- lanes represent spatial navigation
- faces represent alternate views of the same working surface
