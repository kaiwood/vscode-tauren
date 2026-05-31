# Sessions

Sessions are the core Tauren workflow. A session keeps the conversation, runtime state, tool activity, and file-change history together so you can stop, resume, branch, and review work.

## Start a new session

Use **Tauren: New Session** from the title toolbar or run:

```text
/new
```

A new session starts with the current workspace as its working directory. Cached model metadata may appear immediately, then refresh once Pi is live.

## Resume a session

Open the session list with:

```text
/resume
```

or run **Tauren: Toggle Session List**.

The session list lets you move between current and previous Pi sessions. Background sessions can continue running while you work elsewhere in Tauren.

## Session list colors

Session List Lane items use your current VS Code theme colors. Treat the colors as state hints, not fixed color values:

- **Active item:** uses the VS Code list selection colors for the item you are focused on or about to open.
- **Current session:** highlights the session title with the VS Code focus color.
- **Loading metadata:** uses muted description text while Tauren is still reading session details.
- **Running indicator:** shows a small queued/yellow-style dot for a session that is still running.
- **Ready indicator:** shows a small passed/green-style dot for a background session that finished successfully.
- **Error indicator:** shows a small failed/error-style dot for a background session that ended with an error.

## Name sessions

Names make session history easier to scan. Use **Tauren: Rename Session** from the title toolbar or:

```text
/name Investigate login failure
```

Run `/name` with no text to clear the name.

## Fork a session

Forking starts from an earlier user message. This is useful when an agent took a good first step but the later direction was wrong.

Use:

```text
/fork
```

or **Tauren: Fork Session** / the session list fork action. Tauren asks which message to fork from when the runtime supports that flow.

## Clone a session

Cloning duplicates the current session so you can try a different direction without losing the existing thread.

Use **Tauren: Clone Session** or:

```text
/clone
```

## Compact a session

Compaction reduces context while preserving the important state of the conversation.

Use **Tauren: Compact Session** or:

```text
/compact
```

You can also pass custom compaction instructions:

```text
/compact Keep implementation constraints and unresolved bugs.
```

## Export and share

Export creates an HTML copy of the session. Use **Tauren: Export as HTML** or:

```text
/export
```

To choose an output path:

```text
/export /path/to/session.html
```

Sharing creates a secret GitHub Gist through the GitHub CLI and returns a viewer URL:

```text
/share
```

The `gh` CLI must be installed and authenticated for sharing. HTML exports and new share links use Tauren's docs styling by default. Turn off `tauren.useTaurenShareViewer` to keep Pi export styling and use pi.dev for `/share`, or set `PI_SHARE_VIEWER_URL` to override the viewer URL.

## Delete sessions

Use **Tauren: Move to Trash** from the session list or view toolbar. Tauren asks for confirmation by default. You can change that with `tauren.confirmSessionDeletion`.

## Practical habits

- Name sessions once they become useful.
- Start a new session for unrelated tasks.
- Use forks for alternate approaches.
- Use session diffs before committing agent changes.
- Keep prompts scoped to the current repository and task.
