# Pi Extensions

Tauren can host Pi extension UI inside the VS Code sidebar. The important part is portability: extensions target Pi APIs such as `ctx.ui.setStatus()` and `ctx.ui.setWidget()`, not Tauren APIs.

That means the same extension can run in the Pi CLI and in Tauren. Pi owns the extension runtime; Tauren decides how Pi UI intent maps into sidebar surfaces.

```text
Pi extension code
→ ctx.ui.* Pi API
→ Pi runtime
→ Pi CLI terminal UI or Tauren sidebar UI
```

## Why this is useful

A generic chat panel usually renders only messages. Pi extensions can keep small pieces of runtime state visible while you work: mode, progress, reminders, quick summaries, or task-specific context.

Tauren makes those extension surfaces available next to the Composer without requiring extension authors to write VS Code-specific code.

## Full Pi extension docs

This page focuses on how Tauren presents Pi extension UI. For extension authoring, Pi's documentation is the source of truth:

- [Pi Extensions](https://pi.dev/docs/latest/extensions) covers extension structure, commands, events, tools, settings, and the complete `ctx.ui` API.
- [Pi TUI Components](https://pi.dev/docs/latest/tui) covers custom terminal-style UI components.
- [Pi Packages](https://pi.dev/docs/latest/packages) covers packaging and sharing extensions.

If a Pi extension uses supported `ctx.ui` APIs, Tauren can bridge the UI into the sidebar without the extension importing Tauren-specific APIs.

## Hello Widget: status text

Use `ctx.ui.setStatus()` for short, persistent text. A good status is brief enough to read while you type.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function helloStatus(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("hello-widget", "Hello from a Pi extension");
  });

  pi.on("turn_end", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("hello-widget", "Ready for the next prompt");
  });
}
```

In Tauren, this appears as one-line extension status below the Composer. In the Pi CLI, the same status is rendered in Pi's terminal UI footer/status area.

Clear it with:

```ts
ctx.ui.setStatus("hello-widget", undefined);
```

## Small widget example

Use `ctx.ui.setWidget()` when the extension needs a little more room than a single status line. Keep widgets compact; they should support the workflow, not replace the transcript.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function taskWidget(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWidget("task-summary", [
      "Task helper",
      "• Keep prompts scoped",
      "• Review Session Diff before commit"
    ], { placement: "belowEditor" });
  });
}
```

In Tauren, `belowEditor` maps to a widget below the Composer. Without `placement`, Tauren shows the widget above the Composer. In the Pi CLI, the same extension renders around Pi's terminal editor using Pi's own UI layout.

Clear it with:

```ts
ctx.ui.setWidget("task-summary", undefined);
```

## How the same extension behaves

| Runtime | What the extension targets | What users see |
| --- | --- | --- |
| Pi CLI | Pi `ctx.ui` APIs | Status and widgets in the terminal UI around Pi's editor. |
| Tauren | The same Pi `ctx.ui` APIs | Status and widgets in the VS Code sidebar around the Composer. |

Extension authors should not import VS Code APIs or Tauren internals for these surfaces. If the extension describes UI intent through Pi, Tauren can bridge it.

## Widgets and status settings

Tauren exposes settings for the extension surfaces most users need:

- above-composer widgets,
- below-composer widgets,
- status/footer text,
- background colors,
- monospace font rendering.

Open **Settings → Extensions** to adjust these. See the [settings reference](../reference/settings.md#extension-surfaces) for setting names.

## Custom UI themes

The `tauren.customUiTheme` setting changes the visual style of terminal-like extension panels. Available themes are:

- Default
- Modern
- CRT
- Amber
- Matrix

The theme changes Tauren's host styling. It does not change extension logic.

## Keyboard behavior

When a custom UI surface is focused, Tauren forwards terminal-style keys to the Pi extension. This is why some extension UIs can behave more like a TUI than a normal web form.

Press `Esc` to leave or close many Tauren surfaces. Exact behavior depends on what is focused.

## Reloading extensions

After changing Pi extension files or configuration, reload runtime resources:

```text
/reload
```

This refreshes keybindings, extensions, skills, prompts, themes, and metadata where supported. If Pi cannot reload in place, Tauren may restart the runtime and reconnect the persisted session.

## Troubleshooting extension UI

If an extension UI looks wrong:

1. Check **Settings → Extensions** for disabled surfaces.
2. Enable output colors if ANSI output is hard to read.
3. Try a different custom UI theme.
4. Run `/reload` after extension changes.
5. Open diagnostics if the extension reports runtime errors.

For the broader runtime model, see [ADR 0003: Plugin UI Bridge](../decisions/0003-plugin-ui-bridge.md).
