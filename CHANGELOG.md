# Changelog

## [Unreleased]

### Changed

- Made the `/reload` progress message neutral for both Pi and Kward backends.
- Show all Pi-known models for authenticated providers in Tauren's model controls so newly bundled models appear without Tauren allowlist updates.
- Updated the bundled Pi SDK to 0.80.10 and migrated Tauren's model and authentication bridge to Pi's ModelRuntime API.

### Fixed

- Show Pi provider errors, including Codex transport failures, in the transcript.
- Bundle Pi OAuth flows so stored Codex credentials can resolve in Tauren.
- Support Pi's `max` thinking level in Tauren controls.
- Support Pi's cached WebSocket transport and default transport selection.
- Refresh Pi dynamic model catalogs in the background and update the model controls when they change.

## [1.10.0] - 2026-07-19

### Added

- Rendered Pi extension choices, confirmations, and text questions as inline sidebar prompts instead of native VS Code prompts.

### Fixed

- Restored `@` workspace file suggestions when the Kward backend is selected.
- Kept unchanged transcript nodes connected while streaming so code highlighting and rendered message content remain stable.
- Removed per-word streaming fades so new assistant text remains readable and flows naturally.
- Coalesced transcript follow scrolling and track late content resizing without pulling readers away from their position.
- Limited active assistant Markdown refreshes to 30 frames per second while preserving immediate final output.
- Restored transcript follow mode immediately after sending a prompt so the new user message remains visible above the composer.
- Restored the complete Tauren sidebar state after reopening a retained hidden view, including active extension UI.
- Kept standard Pi extension peer imports working while substantially reducing the packaged SDK dependency payload.
- Excluded development documentation and analysis caches from the VSIX.
- Excluded runtime-unneeded dependency source maps and TypeScript declarations from the VSIX.

## [1.9.1] - 2026-07-11

### Fixed

- Refreshed the Session List Lane in the background when opened so newly created sessions appear without delaying cached results.
- Made streamed agent messages become readable faster by shortening their fade-in effect.

## [1.9.0] - 2026-07-11

### Added

- Added Pi extension autocomplete providers to the composer, including stacked delegation and provider-controlled completion application.
- Added Kward-only MCP and tool discovery via `/mcp` and `/tools`, including MCP server status and MCP tool labels.

### Fixed

- Reduced repeated filesystem and diff work during workspace changes and session listing.
- Reduced repeated filesystem scanning while typing `@` file completions.
- Restored stable transcript rendering by removing browser content skipping from message elements.

## [1.8.0] - 2026-07-05

### Added

- Added local whisper.cpp voice input with downloadable Whisper models, microphone selection, push-to-talk, hold-to-talk, and explicit hands-free listening.
- Added Voice Input documentation covering setup, push-to-talk, hands-free mode, local transcription behavior, and settings.

### Changed

- Made Trace Origin use Kward session history when the Kward backend is selected.
- Updated the bundled Pi SDK to 0.80.2 and surfaced Pi's post-compaction token estimate in Tauren compaction status text.
- Kept Kward RPC integration in sync with advertised notification names and steering-applied events.

## [1.7.2] - 2026-06-26

### Fixed

- Lots of performance issues

## [1.7.1] - 2026-06-14

### Fixed

- Reduced flicker in syntax-highlighted tool boxes by preserving unchanged activity DOM during fast transcript updates.
- Fixed slash command option suggestions so command-specific options appear before typing a space, such as `/me` showing `/memory list`.

## [1.7.0] - 2026-06-14

### Added

- Added support for the Kward agent: https://github.com/kaiwood/kward
- Added a `/restart` command that restarts open backend engines, reconnects persisted sessions, and refreshes session navigation.

### Changed

- Clarified backend-neutral Runtime and Login settings copy while keeping Pi-specific extension settings explicit.
- Changed Login settings to derive authentication providers from the Pi runtime instead of Tauren-maintained built-in provider metadata.
- Update Pi-SDK to 0.79.3

### Fixed

- Fixed the Session List Lane and Session Tree Lane so background renders no longer steal focus back from the editor or terminal.
- Reduced session diff file watcher subprocess churn by ignoring generated/vendor paths and directories during live workspace tracking.
- Fixed Login settings so API-key providers are shown and filtered with Pi `/login` parity.
- Fixed session changes so command-generated files and mixed reconstructable/non-reconstructable edits are included more reliably.
- Fixed external VS Code setting changes so every Tauren-owned setting refreshes the sidebar state immediately.
- Restricted `@` file suggestions to the active workspace cwd so absolute, home, or traversal prefixes cannot browse outside it.
- Hide the Composer Footer when no extension status or footer plugin claims the Footer space.

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
