# Changelog

## [Unreleased]

### Added

- Added a `/restart` command that restarts open backend engines, reconnects persisted sessions, and refreshes session navigation.
- Added an experimental configurable Kward JSON-RPC backend for Tauren sidebar chat.

### Changed

- Changed Login settings to derive authentication providers from the Pi runtime instead of Tauren-maintained built-in provider metadata.
- Wired the experimental Kward backend to the expanded RPC parity contract for images, runtime metadata, commands, auth, fork, and session listing.
- Show Kward's active persona label on new assistant transcript messages when provided by RPC runtime state.

### Fixed

- Reduced session diff file watcher subprocess churn by ignoring generated/vendor paths and directories during live workspace tracking.
- Fixed Login settings so API-key providers are shown and filtered with Pi `/login` parity.
- Fixed session changes so command-generated files and mixed reconstructable/non-reconstructable edits are included more reliably.
- Fixed external VS Code setting changes so every Tauren-owned setting refreshes the sidebar state immediately.
- Restricted `@` file suggestions to the active workspace cwd so absolute, home, or traversal prefixes cannot browse outside it.
- Fixed Kward `ask_user_question` answer delivery and keyboard-friendly question dialog behavior.
- Fixed Kward live reasoning blocks so separated reasoning phases no longer collapse into one transcript entry.
- Fixed Kward RPC session switching to use active RPC session IDs and ignore stale old-session responses.
- Fixed Kward startup session restore so concurrent metadata/history requests share one resumed RPC session.
- Fixed empty unnamed Kward sessions so they refresh the Session List Lane when left and are not remembered for startup reconnection.
- Added Tauren bridge handling for Kward RPC footer notifications so Kward plugin footers can render in the Footer.
- Fixed Kward compaction status updates from the current `session/event` RPC notification channel.
- Routed Kward Session List deletion through the backend `sessions/delete` RPC method.

## [1.6.1] - 2026-05-31

### Fixed

- Fixed mouse wheel, trackpad, and keyboard scrolling in large virtualized Session Lists so scroll renders no longer snap back to the top.

## [1.6.0] - 2026-05-31

### New Features

- **Session navigation shortcuts** - Added Home/End navigation for Session List and Session Tree, plus parent/last-child arrow navigation in Session Tree.
- **Sidebar-scoped model picker shortcut** - Added Ctrl+Alt+. / Alt+Cmd+. for opening the model picker from the sidebar.
- **VS Code-style pane scrolling** - Added active-pane scroll bindings across Tauren lanes and settings, with Alt+PageUp/PageDown paging on Windows/Linux, Cmd+PageUp/PageDown paging on macOS, and default-style top/bottom shortcuts.
- **Tauren share viewer** - Added a Tauren docs share viewer for `/share` links, with a setting to fall back to pi.dev.
- **Tauren-styled share and export pages** - Added Tauren docs-style colors and fonts to HTML exports and shared sessions when the Tauren share/export setting is enabled.

### Added

- Documented manual use of `tauren.sidebarFocus` for custom VS Code keybindings.
- Audited command documentation against current Tauren command registrations and added missing workflow references.
- Linked the installation guide to the VS Code Marketplace page.
- Added a practical Trace Origin workflow example for reviewing suspicious generated code.
- Expanded the Pi Extensions guide with portable status and widget examples plus upstream Pi documentation links.
- Added a Feature Tour guide for new users comparing Tauren workflows to generic AI chat panels.
- Added a Security, Privacy, and Trust guide covering Tauren trust boundaries and safe defaults.

### Changed

- Changed the Tauren changelog to use Pi-style bracketed release headings and grouped release sections.
- Clarified Tauren-owned versus Pi-owned settings with a comparison table and Settings pane names.

### Fixed

- Fixed `/reload` so idle open sessions also refresh Pi extensions instead of keeping stale global extension code.

## [1.5.1] - 2026-05-31

### New Features

- **Local documentation site** - Added a styled local VitePress documentation scaffold and first-pass Tauren documentation structure.

### Fixed

- Fixed busy session-list items so their command menu still opens while blocked commands stay disabled.
- Fixed the Session List right-click menu so it only opens from right-clicks and stays closed during inline rename.

## [1.5.0] - 2026-05-31

### New Features

- **Session sharing** - Added `/share` support for creating secret GitHub Gist session links from the sidebar.
- **Thinking block visibility setting** - Added a Pi-backed setting to hide thinking blocks in the Tauren transcript.
- **Quiet startup** - Added Pi-backed quiet startup support for blank empty transcripts in new sessions.
- **Full-content Session List search** - Added host-side full-content Session List search with progressive indexing.

### Changed

- Updated Pi SDK to 0.78.0.
- Preserved Session List search text and named-only filter when switching sessions.
- Kept the stopped session-list indicator visible for agent responses that end with a question until the user replies.

### Fixed

- Fixed `/changelog` hiding Tauren's unreleased section but still showing Pi's `[Unreleased]` heading.
- Fixed session-list status indicators so running, stopped, and error states align consistently on the right.
- Fixed the Session List to Chat Lane transition drifting diagonally.

## [1.4.0] - 2026-05-29

### New Features

- **Tauren slash-command helpers** - Added `/hotkeys`, `/settings`, `/changelog`, and `/import <path.jsonl>` support in the sidebar.
- **Scoped model cycling settings** - Added scoped model cycling configuration to Settings; `/scoped-models` now opens that Settings category.

### Added

- Added `/hotkeys` support that prints Tauren sidebar shortcuts in the transcript.
- Added `/settings` to open Tauren settings from the composer.
- Added `/changelog` support that shows the Pi changelog and released Tauren changelog in the transcript.
- Added `/import <path.jsonl>` support for importing and resuming Pi JSONL sessions.

### Changed

- Updated the Marketplace display name for better discoverability.
- Updated Pi SDK to 0.77.0.

## [1.3.0] - 2026-05-27

### New Features

- **Trace Origin progress and safety** - Added VS Code progress notification while Trace Origin is running and restricted webview file-reference opens to workspace files by default.
- **Thinking-level commands** - Added commands to raise or lower the active session thinking level.
- **Extension tool-output boxes** - Added support for extension tool-output boxes.

### Added

- Added a VS Code progress notification while Trace Origin is running.
- Added a Safety setting to allow external local file links from webview file references.
- Added support for extension tool-output boxes.
- Added commands to raise or lower the active session thinking level.

### Changed

- Preserved user-prompt line breaks in transcript bubbles.
- Restricted webview file-reference opens to workspace files by default.

### Fixed

- Fixed session-list rename prefill for unnamed sessions.
- Fixed stale Auto retry activity from keeping the busy spinner on retry text.
- Fixed terminal spinners.

## [1.2.0] - 2026-05-26

### New Features

- **Performance-focused release** - Improved startup, live output, diagnostics, metadata loading, and large Session List rendering.

### Added

- Added a smoother new-session startup: the empty transcript now appears immediately while the sidebar finishes loading its controls and cached details.
- Added opt-in structured performance diagnostics for session loading, navigation, and webview rendering.
- Added persisted, progressive session-list metadata loading for faster large session histories.
- Added virtualized session-list rendering for large visible session lists.

### Changed

- Throttled live bash output updates and suppressed background bash output bodies to reduce sidebar slowdown during noisy commands.
- Increased session-list metadata cache capacity and bounded long first-message titles.
- Optimized session-list cache misses with fast summary parsing.

## [1.1.0] - 2026-05-26

### New Features

- **Transcript search and scrolling** - Added searchable transcript UI plus top/bottom scroll commands with sidebar-scoped keyboard shortcuts.
- **Composer file suggestions** - Added `@` file suggestions to the composer.
- **Pi extension footer support** - Added support for Pi extension `ctx.ui.setFooter(factory)`.

### Added

- Added transcript top/bottom scroll commands with sidebar-scoped keyboard shortcuts.
- Added searchable transcript UI with command and keyboard shortcut support.
- Added dynamic Pi startup resource summaries to empty chat screens.
- Added support for Pi extension `ctx.ui.setFooter(factory)`.
- Added `@` file suggestions to the composer.

### Changed

- Optimized the caching and rendering strategy for the Session List to Chat Lane transition.

## [1.0.1] - 2026-05-25

### Changed

- Updated extension keywords and artwork.
- Refined Tauren naming consistency.

## [1.0.0] - 2026-05-25

### New Features

- **Initial Tauren release** - Shipped the first Tauren release.

### Changed

- Completed the Tauren rebrand across public identifiers, internals, styles, tests, and documentation.
