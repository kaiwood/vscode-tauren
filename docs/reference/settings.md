# Settings

This page lists Tauren-owned VS Code settings. Pi-owned runtime settings are available inside the Tauren settings UI and are stored by Pi.

The **Settings pane** column shows where the same control appears inside Tauren: `Settings category → Human readable name`.

## Appearance

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.outputColors` | Appearance → Output colors | `true` | Enable ANSI and syntax colors in Tauren output boxes. When disabled, ANSI escape sequences are stripped. |
| `tauren.animationsEnabled` | Appearance → Animations | `true` | Enable animations in the Tauren sidebar. Reduced-motion preferences still disable motion. |
| `tauren.showWelcome` | Appearance → Welcome message | `true` | Show the Welcome to Tauren empty state for new chats. |
| `tauren.useTaurenShareViewer` | Appearance → Tauren export style | `true` | Use Tauren docs styling for HTML exports and new `/share` links. When disabled, exports keep Pi styling and `/share` uses pi.dev unless `PI_SHARE_VIEWER_URL` is set. |
| `tauren.customUiTheme` | Appearance → Custom UI theme | `default` | Visual theme for Pi extension custom UI terminal panels. Options: `default`, `modern`, `crt`, `amber`, `matrix`. |

## Extension surfaces

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.extensions.aboveWidgetsEnabled` | Extensions → Enable above widgets | `true` | Show Pi extension widgets above the composer. |
| `tauren.extensions.belowWidgetsEnabled` | Extensions → Enable below widgets | `true` | Show Pi extension widgets below the composer. |
| `tauren.extensions.statusBarEnabled` | Extensions → Enable status bar | `true` | Show one-line Pi extension status updates below the composer. |
| `tauren.extensions.backgroundColorsEnabled` | Extensions → Enable background colors | `true` | Render background colors sent by Pi extension widgets. |
| `tauren.extensions.monospaceFontEnabled` | Extensions → Use monospace font | `true` | Use the editor monospace font for Pi extension widgets and status. |

## Safety

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.blockHttpsImages` | Safety → Block HTTPS images | `true` | Block remote HTTPS images in Tauren chat markdown while still allowing Pi image data and workspace images. |
| `tauren.confirmSessionDeletion` | Safety → Confirm deletion | `true` | Ask for confirmation before moving Tauren sessions to Trash. |
| `tauren.restrictFileReferencesToWorkspace` | Safety → Restrict file links | `true` | Only open Tauren sidebar file references when they resolve inside the workspace. |
| `tauren.rejectEditWriteOutsideWorkspace` | Safety → Reject external edits | `false` | Reject Pi edit/write tool mutations outside the active workspace folder. This does not restrict shell commands. |

## Advanced

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.debugPerformance` | Advanced → Debug performance | `false` | Collect Tauren performance diagnostics in the output channel and diagnostics view. |
| `tauren.readyScript` | Advanced → Ready script | `""` | Path to an executable script to run when Pi becomes ready. Relative paths resolve from the workspace folder. |
| `tauren.readyScriptEnabled` | Advanced → Run ready script | `true` | Enable or temporarily disable the configured ready script. |

## Pi runtime settings

The Tauren settings UI also exposes Pi-owned runtime controls such as provider, model, thinking level, compaction, retry, steering, follow-up behavior, image handling, enabled models, and skill commands.

Pi remains the source of truth for those values. Tauren displays and edits them through the SDK runtime.
