# Settings

Tauren settings combine two kinds of state: Tauren-owned UI/workflow controls and Pi-owned runtime/engine controls.

Tauren owns how the sidebar behaves in VS Code. Pi owns how the agent runtime behaves: providers, models, thinking, compaction, retry, steering, and follow-up behavior.

## Open settings

Use the gear icon in the Tauren view toolbar, run **Tauren: Toggle Settings**, or type:

```text
/settings
```

To open scoped model configuration directly:

```text
/scoped-models
```

## Settings sections

Tauren groups settings into practical sections:

- **Login:** provider authentication.
- **Appearance:** sidebar colors, animation, welcome message, and custom UI theme.
- **Extensions:** Pi extension widgets and status rendering.
- **Runtime:** Pi provider, model, thinking, compaction, retry, steering, and follow-up behavior.
- **Scoped Models:** model cycling configuration.
- **Safety:** workspace and remote-content guardrails.
- **Advanced:** diagnostics and ready-script behavior.

## Ownership at a glance

| Setting | Owner | Purpose |
| --- | --- | --- |
| [Custom UI theme](../reference/settings.md#appearance) | Tauren | Changes how Pi extension custom UI panels look in the sidebar. |
| [Animations](../reference/settings.md#appearance) | Tauren | Controls sidebar motion and transitions. |
| [Remote image blocking](../reference/settings.md#safety) | Tauren | Blocks remote HTTPS images in chat markdown by default. |
| [Output colors](../reference/settings.md#appearance) | Tauren | Enables ANSI and syntax colors in Tauren output boxes. |
| Default provider | Pi | Chooses which provider the runtime uses by default. |
| Default model | Pi | Chooses the model used for new prompts. |
| Thinking level | Pi | Controls runtime reasoning effort where supported. |
| Compaction | Pi | Controls how older context is summarized. |
| Retry behavior | Pi | Controls runtime retry handling. |
| Steering mode | Pi | Controls how input affects a running response. |
| Follow-up mode | Pi | Controls follow-up behavior after agent responses. |

Tauren-owned settings are listed in the [settings reference](../reference/settings.md). Pi-owned settings are edited through the Tauren Settings Face, usually under **Runtime** or **Scoped Models**, but Pi remains the source of truth.

## Tauren-owned settings

Tauren-owned settings affect the VS Code extension host and webview. Examples:

- `tauren.outputColors` — Appearance → Output colors
- `tauren.animationsEnabled` — Appearance → Animations
- `tauren.customUiTheme` — Appearance → Custom UI theme
- `tauren.blockHttpsImages` — Safety → Block HTTPS images
- `tauren.restrictFileReferencesToWorkspace` — Safety → Restrict file links
- `tauren.rejectEditWriteOutsideWorkspace` — Safety → Reject external edits

Most Tauren-owned UI settings apply immediately.

## Pi-owned settings

Pi-owned settings affect the runtime. Examples include provider, model, thinking level, compaction, retry, and enabled model lists.

Pi remains the source of truth for those values. Tauren may show cached metadata on first paint, then refresh after the runtime starts.

## Experimental Kward backend

Tauren defaults to the bundled Pi SDK backend. The **Runtime → Backend** setting can also select the experimental local Kward JSON-RPC backend.

When Backend is **Kward**, Tauren launches the global `kward rpc` command by default. Set **Runtime → Kward path** only when you want to use a specific Kward executable; Tauren launches that executable with `rpc` as the argument.

Kward is treated as a trusted local backend. It can read and write local files, run shell commands, update credentials, and perform other runtime actions available to Kward. Use it only with workspaces and Kward builds you trust.

Kward reports supported runtime settings through RPC capabilities. Tauren hides unsupported Pi-owned settings while Backend is Kward, so some Settings sections may show only Tauren-owned controls or a Kward empty state.

## Safety settings

Two settings are especially important:

- `tauren.restrictFileReferencesToWorkspace` — Safety → Restrict file links: only open sidebar file references that resolve inside the workspace.
- `tauren.rejectEditWriteOutsideWorkspace` — Safety → Reject external edits: reject Pi edit/write tool mutations outside the active workspace folder.

The second setting does not restrict arbitrary shell commands. Treat it as a guardrail, not a sandbox.

## Ready script

`tauren.readyScript` — Advanced → Ready script: executable script Tauren runs when the Pi engine becomes ready. Relative paths resolve from the workspace folder.

Use it for lightweight workspace preparation. Avoid long-running scripts because they can make the runtime feel stuck.
