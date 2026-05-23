# Changelog

All notable changes to Tau will be documented in this file.

## Unreleased

- Fixed session tree/sidebar lane animation by separating the session list and session tree into left/right panes.
- Allowed Tau to start without an open workspace by using the user home directory, unless `tau.rejectEditWriteOutsideWorkspace` is enabled.
- Fixed chat autoscroll so delayed rendering does not stop output following, and preserved chat scroll when returning from session list/tree.
- Added a New session icon to the session list toolbar.
- Allowed clearing a session name from Tau's sidebar UI.
- Fixed `tau.readyScript` so it waits for Pi auto-retry and compaction work before running.
- Kept Pi custom UI scoped to its originating open session, including background sessions.
- Fixed simultaneous Pi custom UIs so a stale hide from one open session cannot hide another session's UI.
- Added a `tau.confirmSessionDeletion` setting to optionally skip session deletion confirmation.
- Allowed session renaming while Pi is working, including running open sessions.
- Fixed Tau startup so Pi waits for VS Code workspace folders before starting, cannot silently run from an unsafe root cwd, and supports optional `tau.rejectEditWriteOutsideWorkspace` edit/write mutation guarding.
- Added a `tau.customUiTheme` setting with default, modern, CRT, amber, and matrix styles for Pi custom UI terminal panels.
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
