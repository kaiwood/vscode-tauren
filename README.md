# Tau

Tau is a transparent AI coding assistant for VS Code focused on session-based workflows and code traceability.

## Philosophy

Tau follows the same direction as [Pi](https://pi.dev), the backend agent engine it builds on:

- full insight into every tool call
- no hidden prompts
- no black magic

If your clanker followed Order 66 again, Tau will at least show you exactly what happened.

## Features

### Trace Origin & Session Diffs

Jump from code back to the historical agent session that created it.

Tau can reconnect:

- current code
- historical agent context
- related Git commits
- reasoning history

Even across refactors and file moves.

From there, session diffs make it easy to inspect exactly what changed during the session.

![Workflow Capture](resources/tau_capture.gif)

### What else?

Tau builds on top of Pi's existing capabilities:

- tree-based session management
- plugin ecosystem
- resumable sessions
- transparent tool execution

It also adds parallel session workflows, allowing you to switch between multiple active sessions without losing context.

## Requirements / Setup

Install Pi if you haven't already:

```sh
npm install -g @earendil-works/pi-coding-agent
```

Then set it up the same way you would for terminal use:

```sh
pi
/login
```

For more information, read the [documentation here](https://pi.dev/docs/latest).

## Using Tau

Tau is heavily keyboard-oriented.

The most important key is probably `Esc`:

- from the prompt → opens the session list
- from the session list → returns to the current session

Everything else is mostly discoverable. You'll figure out the rest anyway.

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
