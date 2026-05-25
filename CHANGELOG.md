# Changelog

All notable changes to Tau will be documented in this file.

## 2.0.0

- Switched from RPC protocol to fully integrated SDK

### UI/UX Improvements

- Added a right-click context menu to session list rows
- Added composer image attachments for sending local PNG, JPEG, GIF, and WebP files with the next Tau prompt.
- Added copy-and-paste image file attachments to the composer.
- Added drag-and-drop image attachments to the composer with valid, invalid, and neutral drag-over states.
- Changed the context status tooltip to show Pi-style live token, cost, subscription, context, and auto-compaction stats.
- Added a (dismissible) welcome message
- Added session tree label editing with `Shift+L`.
- General UI improvements

### Extensions

- Added support for (themeable) Custom UI / `ctx.ui.custom()`
- Added a one-line Pi extension status bar below the composer for `ctx.ui.setStatus()` updates.
- Added Pi extension multi-line editor support for `ctx.ui.editor()` in the Tau sidebar.
- Added Pi extension paste support for `ctx.ui.pasteToEditor()` with large-paste markers in the composer.
- Added Pi extension composer prefilling support for `ctx.ui.setEditorText()`.
- Added Pi extension widget support for `ctx.ui.setWidget()` above and below the composer.

- Added a `Tau: Send Selection to Composer` command for pre-filling the active composer from selected editor lines.

### Settings

- Added a new settings pane
- Added built-in Pi provider login/logout (OAuth and API keys) and wired `/login` and `/logout` to that flow.
- Added settings for Pi extension above widgets, below widgets, status bar, and widget background colors.
- Added a guardrail option to keep only allow write/edit in the workspace

## 1.1.0

- Added experimental SDK mode to make more features available
- Re-enable `/tree` command in SDK mode
- General styling improvements

## 1.0.0 - Initial release

- Initial release.
