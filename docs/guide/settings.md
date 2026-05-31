# Settings

Tauren settings combine two kinds of state: Tauren-owned UI/workflow controls and Pi-owned runtime/engine controls.

Tauren owns how the sidebar behaves in VS Code. Pi owns how the agent runtime behaves: providers, models, thinking, compaction, retry, steering, and follow-up behavior.

## Open settings

Use the gear icon in the Tauren view toolbar or run:

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

- `tauren.outputColors`
- `tauren.animationsEnabled`
- `tauren.customUiTheme`
- `tauren.blockHttpsImages`
- `tauren.restrictFileReferencesToWorkspace`
- `tauren.rejectEditWriteOutsideWorkspace`

Most Tauren-owned UI settings apply immediately.

## Pi-owned settings

Pi-owned settings affect the runtime. Examples include provider, model, thinking level, compaction, retry, and enabled model lists.

Pi remains the source of truth for those values. Tauren may show cached metadata on first paint, then refresh after the runtime starts.

## Safety settings

Two settings are especially important:

- `tauren.restrictFileReferencesToWorkspace`: only open sidebar file references that resolve inside the workspace.
- `tauren.rejectEditWriteOutsideWorkspace`: reject Pi edit/write tool mutations outside the active workspace folder.

The second setting does not restrict arbitrary shell commands. Treat it as a guardrail, not a sandbox.

## Ready script

`tauren.readyScript` points to an executable script Tauren runs when the Pi engine becomes ready. Relative paths resolve from the workspace folder.

Use it for lightweight workspace preparation. Avoid long-running scripts because they can make the runtime feel stuck.
