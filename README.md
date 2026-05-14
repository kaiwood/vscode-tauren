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

- `Tau: Focus on Tau`
- `Tau: New Session`
- `Tau: Resume Session`
- `Tau: Fork Session`
- `Tau: Clone Session`
- `Tau: Add Context`

You can also right-click in an editor and choose `Add Context`. If text is selected, Tau attaches the selection. If nothing is selected, it attaches the current file.

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

### `tau.fullRpcAgentCommunication`

Shows the full RPC conversation in the transcript. Most users should leave this off. It is mainly useful while debugging Tau or Pi RPC behavior.

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
