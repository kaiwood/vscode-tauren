# Feature Tour

Tauren is not only a chat panel embedded in VS Code. It is organized around traceable agent sessions: each run has history, runtime state, file changes, extension UI, and later review tools.

Use this tour if you already know VS Code and agent tools such as Pi, Codex, Claude Code, or similar systems, and want to understand what to do differently in Tauren.

## At a glance

| If you usually... | In Tauren, use... | Why it exists |
| --- | --- | --- |
| Open a new chat for every task | [Sessions](./sessions.md) | Keep prompts, tool calls, state, and changes together. |
| Scroll a long transcript | [Session Tree](./sidebar.md#main-surfaces) | Navigate runtime structure without losing the chat context. |
| Ask "where did this code come from?" | [Trace Origin](./trace-origin.md) | Connect selected code back to likely agent sessions. |
| Review only `git diff` | [Session Diffs](./session-diffs.md) | See changes attributed to a Tauren session. |
| Configure an external agent separately | [Settings](./settings.md) | Manage auth, runtime, safety, and extension UI from the sidebar. |
| Run terminal-only Pi plugins | [Pi Extensions](./pi-extensions.md) | Let Pi extension UI appear inside VS Code. |

## 1. Session-oriented workflow

A Tauren session is the unit of work. It contains the conversation, tool activity, runtime state, and file-change tracking for a task.

Use sessions when you want to:

- pause and resume work later,
- name useful investigations,
- fork from an earlier prompt,
- clone a session to try another direction,
- review what one task changed.

Typical flow:

```text
/new
/name Investigate flaky auth test
# work with Pi
/resume
```

> **Screenshot placeholder:** Session List Lane showing named sessions, one running session, and actions for rename, fork, clone, export, and trash.

Deeper docs: [Sessions](./sessions.md), [Quick Start](../getting-started/quick-start.md), [Slash Commands](../reference/slash-commands.md).

## 2. Session Tree

Long agent runs are hard to understand as a single stream. The Session Tree Lane gives a structured view of the active Pi session so you can navigate branches, tool activity, and runtime history next to the transcript.

Open it with:

```text
/tree
```

Use it when the transcript is too long to scan, when you need to jump to a specific step, or when you want to understand how the current session is structured.

> **Screenshot placeholder:** Three-lane layout with Session List Lane on the left, Chat Lane in the center, and Session Tree Lane on the right.

Deeper docs: [Tauren Sidebar](./sidebar.md), [Hotkeys](../reference/hotkeys.md), [Three-lane model decision](../decisions/0002-three-lane-model.md).

## 3. Trace Origin

Trace Origin answers the audit question: "what session likely produced this code?"

Select code in the editor, then run **Tauren: Trace Origin**. Tauren searches available session history and Git context, then points you toward likely source sessions that you can reopen and inspect.

Use it when reviewing unfamiliar agent-assisted code, debugging a later regression, or preparing a commit and wanting to confirm the original intent.

> **Screenshot placeholder:** Editor selection with a Trace Origin result linking back to a named session and its session diff.

Deeper docs: [Trace Origin](./trace-origin.md), [Session Diffs](./session-diffs.md).

## 4. Session Diffs

Git shows repository changes relative to Git history. Session Diffs show changes Tauren attributes to a specific session.

This matters when:

- multiple sessions are open,
- a background session changes files,
- you switch between tasks,
- unrelated local changes already exist.

Open **Tauren: Open Session Diff** from the Command Palette, view toolbar, or busy bar changes control. Review the session diff first, then still use Git before committing.

> **Screenshot placeholder:** VS Code diff editor opened from Tauren, with the busy bar changes control visible in the sidebar.

Deeper docs: [Session Diffs](./session-diffs.md), [Commands](../reference/commands.md).

## 5. Pi SDK runtime integration

Tauren runs against the bundled Pi SDK runtime instead of treating Pi like a detached terminal transcript. The practical result is that the sidebar can stay connected to Pi-owned state: models, sessions, tree navigation, extensions, settings, skills, prompts, and themes.

For day-to-day use, this means:

- model and provider state are shown inside Tauren,
- `/reload` can refresh runtime resources,
- Session Tree and Pi extension UI can work in the sidebar,
- settings reflect Pi's current runtime state instead of a copied config screen.

Deeper docs: [Pi Setup](../getting-started/pi-setup.md), [Pi Integration](../development/pi-integration.md), [SDK over RPC decision](../decisions/0001-sdk-over-rpc.md).

## 6. Plugin UI bridge

Pi extensions often need more than plain text: prompts, confirmations, selection lists, terminal-style panels, and keyboard-driven flows. Tauren's Plugin Bridge maps those runtime UI requests into VS Code/webview surfaces while keeping the extension portable.

Use this when a Pi plugin asks for input, opens a custom runtime surface, or displays interactive output inside the Chat Lane.

> **Screenshot placeholder:** Pi extension custom UI surface rendered in Tauren, plus a confirm/input prompt from the same session.

Deeper docs: [Pi Extensions](./pi-extensions.md), [Plugin UI Bridge decision](../decisions/0003-plugin-ui-bridge.md).

## 7. Widgets and status surfaces

Some extension output is most useful as persistent context rather than another transcript message. Tauren supports Pi extension widgets above and below the Composer, plus one-line footer/status text.

These surfaces are useful for:

- active mode indicators,
- progress or status summaries,
- quick controls from an extension,
- context that should remain visible while you type.

Control these surfaces in **Settings → Extensions**.

> **Screenshot placeholder:** Composer with an above widget, below widget, and footer/status line enabled.

Deeper docs: [Pi Extensions](./pi-extensions.md#widgets-and-status), [Settings](./settings.md), [Settings reference](../reference/settings.md#extension-surfaces).

## 8. Built-in auth and settings integration

Tauren keeps common setup tasks in the sidebar so you do not need to switch to a terminal just to authenticate or change runtime options.

Use:

```text
/login
/settings
/model
/scoped-models
```

The Settings Face groups Login, Appearance, Extensions, Runtime, Scoped Models, Safety, and Advanced controls. Pi remains the source of truth for Pi-owned runtime settings, while Tauren owns VS Code and sidebar behavior.

Deeper docs: [Settings](./settings.md), [Pi Setup](../getting-started/pi-setup.md), [Settings reference](../reference/settings.md).

## 9. Parallel sessions

Tauren supports multiple open sessions so long-running work does not have to block navigation. You can switch away from a running session, inspect another one, or start a separate task while keeping each session's transcript and change tracking separate.

Use parallel sessions when you want to:

- compare approaches,
- let a long investigation continue in the background,
- keep unrelated tasks from sharing context,
- review per-session changes before merging work together.

Open the Session List Lane with `/resume` to switch between sessions. Within one busy session, use Tauren's stop or steering/follow-up controls instead of assuming prompts are queued behind the current response.

Deeper docs: [Sessions](./sessions.md), [Tauren Sidebar](./sidebar.md), [Commands](../reference/commands.md).

## 10. Image support

When the model supports it, Tauren can attach images to the next prompt. This is useful for screenshots, UI bugs, diagrams, visual diffs, or error dialogs that are easier to show than describe.

You can paste or drop supported local raster images into the Composer. Tauren currently supports PNG, JPEG, GIF, and WebP attachments up to 10 MB. Remote HTTPS images in chat markdown are blocked by default as a safety setting, while Pi image data and workspace images can still render.

> **Screenshot placeholder:** Composer showing two attached screenshots ready to send with a prompt.

Deeper docs: [Tauren Sidebar](./sidebar.md#composer), [Adding Context](./context.md), [Settings reference](../reference/settings.md#safety).

## 11. Diagnostics and performance tooling

Agent UI problems are often runtime, provider, extension, or rendering problems. Tauren provides a diagnostics surface so you have a first place to inspect startup errors, SDK diagnostics, extension failures, missing model metadata, and optional performance events.

Run **Tauren: Show Diagnostics** from the Command Palette. If you are investigating slowdown, enable `tauren.debugPerformance`, reproduce the issue, then reopen diagnostics.

> **Screenshot placeholder:** Diagnostics view showing runtime status, recent diagnostics, and performance events.

Deeper docs: [Troubleshooting](./troubleshooting.md), [Commands](../reference/commands.md), [Settings reference](../reference/settings.md#advanced).

## Suggested first workflow

1. Start a named session for one concrete task.
2. Attach only the context needed for that task.
3. Use Session Tree if the run becomes hard to scan.
4. Review Session Diffs before editing around the result.
5. Use Trace Origin later when code history is unclear.
6. Check Diagnostics before assuming provider or extension failures are workspace bugs.
