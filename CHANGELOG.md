# Changelog

All notable changes to Tau will be documented in this file.

## Unreleased

- Added a `Tau: Send Selection to Composer` command for pre-filling the active composer from selected editor lines.
- Removed the background gradient from the Tau settings surface.
- Kept the native New Session toolbar action visible while Tau is busy so a running session can continue in the background.
- Added built-in Pi provider login/logout support in Tau Settings > Login and wired `/login` and `/logout` to that flow.
- Added the real Tau settings surface with Tau appearance/safety controls and Pi runtime/advanced controls backed by shared setting definitions.
- Aligned user-facing naming so Tau refers to the product/UI and Pi refers to the backend engine/runtime.
- Exposed the session-list `showChanges` command in the webview menu and removed the stale file-backed session tree entrypoint.
- Pruned stale webview render state during long chat sessions to reduce sidebar memory growth.
- Replaced the remote image setting with `tau.blockHttpsImages`, which defaults on and blocks HTTPS images unless disabled.
- Reduced Pi custom UI render churn by coalescing repeated updates to frame-paced rendering.
- Improved long chat performance by sending incremental message updates to the webview and pruning stale render caches.
- Fixed custom UI free-text answers so delayed prompt focus cannot steal typing from the active questionnaire.
- Fixed stale in-flight session diff refreshes so they cannot apply stats to a newly selected session.
- Added inline image rendering for Pi image content, markdown images, workspace image paths, and optionally remote HTTPS images.
- Added native Tau view toolbar session actions for renaming, compacting, exporting, and moving the current session to Trash, and removed less-used actions from that menu.
- Added a native Tau view toolbar help action with a combined chat/session shortcut table.
- Removed the chat toolbar session commands menu and the session-list New session button.
- Added a native Tau view toolbar gear for toggling the internal settings pane.
- Added the initial internal Tau settings surface shell in the sidebar with front/back navigation.
- Fixed session tree/sidebar lane animation by separating the session list and session tree into left/right panes.
- Allowed Tau to start without an open workspace by using the user home directory, unless `tau.rejectEditWriteOutsideWorkspace` is enabled.
- Fixed chat autoscroll so delayed rendering does not stop output following, and preserved chat scroll when returning from session list/tree.
- Added a New session icon to the session list toolbar.
- Allowed clearing a session name from Tau's sidebar UI.
- Fixed `tau.readyScript` so it waits for Pi engine auto-retry and compaction work before running.
- Kept Pi custom UI scoped to its originating open session, including background sessions.
- Fixed simultaneous Pi custom UIs so a stale hide from one open session cannot hide another session's UI.
- Added a `tau.confirmSessionDeletion` setting to optionally skip session deletion confirmation.
- Allowed session renaming while the Pi engine is working, including running open sessions.
- Fixed Tau startup so the Pi engine waits for VS Code workspace folders before starting, cannot silently run from an unsafe root cwd, and supports optional `tau.rejectEditWriteOutsideWorkspace` edit/write mutation guarding.
- Added a `tau.customUiTheme` setting with default, modern, CRT, amber, and matrix styles for Pi extension custom UI terminal panels.
- Refined the modern custom UI theme so the existing prompt area becomes a decorative keyboard deck while custom UI is active.
- Added a visible block cursor for Pi custom UI components that emit `CURSOR_MARKER`.
- Fixed compaction summary output so it starts collapsed, can be expanded, and scrolls when long.
- Removed the duplicate busy message below the running compaction activity box.
- Matched compaction output box background to other output boxes.
- Fixed focus returning to the prompt input after a Pi custom UI closes.
- Improved Pi custom UI keyboard handling with text capture, repeat/release events, and post-input re-rendering.
- Added first-version Pi custom UI support for extensions that call `ctx.ui.custom()`.
- Fixed handled Pi extension commands so they clear Tau's busy state after custom UI closes.
- Fixed bundled SDK peer imports so Pi packages like `@juicesharp/rpiv-ask-user-question` can load in Tau.
- Initialized the bundled Pi TUI theme so custom UI previews with markdown/code blocks can render in Tau.
- Increased custom UI's vertical budget and reported row count so preview-heavy dialogs can render more content, with scrolling as fallback.
- Added `Tau: Toggle Session List` for opening and closing the session list.
- Renamed the session tree command to `Tau: Toggle Session Tree` and made it close the tree when already open.
- Switched Tau to the bundled Pi SDK transport and removed the RPC/`piPath` configuration path.
- Added session tree label display for Pi-labeled entries.
- Added session tree label editing with `Shift+L`.
- Fixed bundled SDK extension loading for Pi packages that import Pi peer modules, including `pi-web-access`.
- Fixed slash command menu highlighting so mouse hover and keyboard selection do not conflict.

## 1.1.0

- Added experimental SDK mode to make more features available
- Re-enable `/tree` command in SDK mode
- General styling improvements

## 1.0.0 - Initial release

- Initial release.
