# Changelog

All notable changes to Tau will be documented in this file.

## Unreleased

- Added a `tau.customUiTheme` setting with default, CRT, amber, and matrix styles for Pi custom UI terminal panels.
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
