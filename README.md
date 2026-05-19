# Tau

Tau is a VS Code frontend extension for the [Pi coding agent](https://pi.dev).

It gives Pi a native-feeling UI inside VS Code: open the Tau icon in the Activity Bar, type a prompt, and work with the same Pi sessions, models, tools, and project context without switching back to a terminal.

Tau is not a separate agent. It starts Pi in RPC mode and talks to the Pi CLI running on your machine.

## What it does

- Adds a Tau panel to the VS Code Activity Bar.
- Streams Pi responses in the Tau chat view.
- Shows tool activity, progress, errors, and assistant output.
- Uses your first workspace folder as Pi's working directory.
- Lets you switch models and thinking level from the Tau view.
- Shows live context usage when Pi reports it.
- Supports Pi sessions: new, resume, fork, clone, compact, export, and session info.
- Lets you add the active file or selected code as prompt context from VS Code.
- Uses VS Code UI for Pi prompts such as selects, confirms, inputs, and notifications.

## Requirements

Tau needs the Pi CLI installed separately.

```sh
npm install -g @earendil-works/pi-coding-agent
```

Then set up Pi the same way you would for terminal use:

```sh
pi
/login
```

Or configure provider API keys in your shell environment. See [pi.dev](https://pi.dev) for Pi's setup instructions and supported providers.

By default Tau runs `pi`. If Pi is not on VS Code's PATH, set `tau.piPath` in VS Code settings, for example:

```json
{
  "tau.piPath": "/opt/homebrew/bin/pi"
}
```

## Using Tau

Open the Tau icon in the Activity Bar, then type normally.

Useful commands are also available from the Command Palette:

- `Tau: New Session`
- `Tau: Resume Session`
- `Tau: Fork Session`
- `Tau: Clone Session`
- `Tau: Show Session Tree`
- `Tau: Show Session Changes`
- `Tau: Compact Session`
- `Tau: Export Session as HTML`
- `Tau: Reload Pi`
- `Tau: Copy Last Response`
- `Tau: Select Model`
- `Tau: Stop Current Response`
- `Tau: Add Context`
- `Tau: Trace Origin`

You can also right-click in an editor and choose `Add Context`. If text is selected, Tau attaches the selection. If nothing is selected, it attaches the current file.

Double-click the session title in Tau's toolbar to rename the current session inline. In the session list, open a row's command menu and choose Rename session to edit that session name without switching to it.

## Keyboard navigation

Tau-specific keys inside the sidebar:

| Key                             | Where                        | Action                                              |
| ------------------------------- | ---------------------------- | --------------------------------------------------- |
| `Enter`                         | Prompt                       | Send the prompt.                                    |
| `Shift+Enter`                   | Prompt                       | Insert a newline.                                   |
| `PageUp` / `PageDown`           | Chat                         | Scroll the transcript by page.                      |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Chat                         | Scroll the transcript by line.                      |
| `Esc`                           | Prompt, with no popup open   | Open the session list.                              |
| `Esc`                           | Session list or session tree | Return to the current session and focus the prompt. |
| `ArrowUp` / `ArrowDown`         | Session list or session tree | Move the selected row.                              |
| `ArrowRight`                    | Session list                 | Open the selected session's command menu.           |
| `Enter`                         | Session list or session tree | Open the selected session or tree entry.            |
| `Delete` / `Backspace`          | Session list                 | Delete the selected session if it is deletable.     |
| `r`                             | Session list                 | Rename the selected session inline.                 |
| `f`                             | Session list                 | Fork the selected session.                          |
| `c`                             | Session list                 | Clone the selected session.                         |
| `z`                             | Session list                 | Compact the selected session.                       |
| `e`                             | Session list                 | Export the selected session as HTML.                |
| `ArrowUp` / `ArrowDown`         | Session command menu         | Move the selected menu entry.                       |
| `Enter`                         | Session command menu         | Run the selected menu entry without switching rows. |
| `Esc`                           | Session command menu         | Close the menu.                                     |
| `Enter`                         | Session-list rename editor   | Save the session name.                              |
| `Esc`                           | Session-list rename editor   | Cancel editing and keep focus in the list.          |
| `ArrowUp` / `ArrowDown`         | Slash command menu           | Move the selected command.                          |
| `Tab`                           | Slash command menu           | Insert the selected command.                        |
| `Enter`                         | Slash command menu           | Insert the selected command.                        |
| `Esc`                           | Slash command menu           | Close the menu.                                     |
| `Enter`                         | Inline session naming        | Save the session name.                              |
| `Esc`                           | Inline session naming        | Cancel editing and focus the prompt.                |

`Esc` is intentionally overloaded as Tau's back key. It first closes the most local UI you opened: slash command menu, model picker, top-bar session menu, session command menu, or inline session naming. If there is nothing local to close and the prompt is focused, `Esc` opens the session list. Press `Esc` again from the session list to return to chat, so you can toggle between writing and session navigation with one key.

Tau does not install default global keyboard shortcuts. To scope your own bindings to the sidebar, use VS Code `when` clauses such as `tau.sidebarFocus` or `tau.sidebarFocus && tau.busy`.

## Slash commands

Tau supports the Pi slash commands that make sense in the VS Code UI today:

```text
/new
/resume
/model
/name
/session
/tree
/fork
/clone
/copy
/compact
/reload
/export
```

Some Pi terminal commands are not wired into Tau yet. When that happens, Tau will tell you rather than trying to fake it.

## Settings

### `tau.piPath`

Command used to launch Pi. This can be an executable name or a full command, such as:

- `pi`
- `/opt/homebrew/bin/pi`
- `npx pi`
- `"/path with spaces/pi"`

### `tau.readyScript`

Optional path to an executable script to run when Pi becomes ready: after starting a new Pi process without resuming a session, and after each agent run completes. Relative paths resolve from the workspace folder.

### `tau.readyScriptEnabled`

Boolean toggle for `tau.readyScript`. Turn it off to temporarily disable the script without clearing the path.

## Development

```sh
npm install
npm run compile
```

Run tests with:

```sh
npm test
```

For local development in VS Code, launch the extension host from the provided VS Code launch configuration.

## License

MIT
