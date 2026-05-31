# Changelog

## Unreleased

- Docs: Expanded the Pi Extensions guide with portable status and widget examples plus upstream Pi documentation links.
- Docs: Added a Feature Tour guide for new users comparing Tauren workflows to generic AI chat panels.
- Docs: Added a Security, Privacy, and Trust guide covering Tauren trust boundaries and safe defaults.
- Fixed `/reload` so idle open sessions also refresh Pi extensions instead of keeping stale global extension code.

## 1.5.1 - 2026-05-31

- Added a styled local VitePress documentation scaffold and first-pass Tauren documentation structure.
- Fixed busy session-list items so their command menu still opens while blocked commands stay disabled.
- Fixed the Session List right-click menu so it only opens from right-clicks and stays closed during inline rename.

## 1.5.0 - 2026-05-31

- Update Pi SDK to 0.78.0
- Fixed `/changelog` hiding Tauren's unreleased section but still showing Pi's `[Unreleased]` heading.
- Added `/share` support for creating secret GitHub Gist session links from the sidebar.
- Added a Pi-backed setting to hide thinking blocks in the Tauren transcript.
- Added Pi-backed quiet startup support for blank empty transcripts in new sessions.
- Preserved Session List search text and named-only filter when switching sessions.
- Added host-side full-content Session List search with progressive indexing.
- Fixed session-list status indicators so running, stopped, and error states align consistently on the right.
- Kept the stopped session-list indicator visible for agent responses that end with a question until the user replies.
- Fixed the Session List to Chat Lane transition drifting diagonally.

## 1.4.0 - 2026-05-29

- Updated the Marketplace display name for better discoverability
- Update Pi SDK to 0.77.0
- Added `/hotkeys` support that prints Tauren sidebar shortcuts in the transcript.
- Added scoped model cycling configuration to Settings; `/scoped-models` now opens that Settings category.
- Added `/settings` to open Tauren settings from the composer.
- Added `/changelog` support that shows the Pi changelog and released Tauren changelog in the transcript.
- Added `/import <path.jsonl>` support for importing and resuming Pi JSONL sessions.

## 1.3.0 - 2026-05-27

- Preserved user-prompt line breaks in transcript bubbles.
- Fixed session-list rename prefill for unnamed sessions.
- Fixed stale Auto retry activity from keeping the busy spinner on retry text.
- Added commands to raise or lower the active session thinking level.
- Added a VS Code progress notification while Trace Origin is running.
- Restricted webview file-reference opens to workspace files by default, with a Safety setting to allow external local file links.
- Added support for extension tool-output boxes
- terminal spinners now work properly

## 1.2.0 - 2026-05-26

This release is dedicated to performance updates.

- Added a smoother new-session startup: the empty transcript now appears immediately while the sidebar finishes loading its controls and cached details.
- Throttled live bash output updates and suppressed background bash output bodies to reduce sidebar slowdown during noisy commands.
- Added opt-in structured performance diagnostics for session loading, navigation, and webview rendering.
- Increased session-list metadata cache capacity and bounded long first-message titles.
- Added persisted, progressive session-list metadata loading for faster large session histories.
- Added virtualized session-list rendering for large visible session lists.
- Optimized session-list cache misses with fast summary parsing.

## 1.1.0 - 2026-05-26

- Optimized caching and rendering strategy for the List->Chat transition
- Added transcript top/bottom scroll commands with sidebar-scoped keyboard shortcuts
- Added searchable transcript UI with command and keyboard shortcut support.
- Added dynamic Pi startup resource summaries to empty chat screens.
- Added support for Pi extension `ctx.ui.setFooter(factory)`
- Added `@` file suggestions to the composer.

## 1.0.1 - Maintenance release

- Updated extension keywords and artwork.
- Refined Tauren naming consistency.

## 1.0.0 - Initial release

- Initial Tauren release.
- Completed the Tauren rebrand across public identifiers, internals, styles, tests, and documentation.
