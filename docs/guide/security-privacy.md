# Security, Privacy, and Trust

Tauren is built around transparency: you should be able to see what the agent is doing, what it changed, and which session produced the work. That visibility helps, but it is not a sandbox and it is not a substitute for judgment.

This page explains the main trust boundaries so you can use Tauren deliberately.

## The short version

- Open the workspace you actually want Tauren to work in.
- Review tool output and session diffs before you commit changes.
- Treat shell commands as powerful: workspace edit guardrails do not block arbitrary shell commands.
- Only enable Pi extensions, ready scripts, and remote content that you trust.
- Remember that prompts, attachments, and relevant file content may be sent to the configured model provider by the Pi runtime.

## What Tauren can see

Tauren runs inside VS Code and starts the Pi runtime with the first VS Code workspace folder as its working directory. From there, Pi can inspect files and run tools as part of an agent session.

Tauren can also add context you provide explicitly, such as:

- file references from the composer,
- selected editor text,
- pasted or dropped image attachments,
- prompts and slash commands you type.

Practical habit: add the smallest useful context for the task. It improves the answer and reduces unnecessary exposure.

## What may leave your machine

Tauren uses Pi as the agent engine. Pi owns provider authentication, model selection, tool execution, and runtime settings. When you send a prompt, the Pi runtime may send your prompt, selected context, attachments, and relevant tool results to the configured model provider.

Tauren does not make provider privacy promises on behalf of those services. Check the policy for the provider and model you choose, especially for private repositories, customer data, credentials, or regulated work.

Avoid pasting secrets into prompts. If a task requires credentials, prefer short-lived test credentials and remove them when done.

## Workspace guardrails

Tauren includes two important workspace safety settings:

| Setting | Default | What it does |
| --- | --- | --- |
| `tauren.restrictFileReferencesToWorkspace` | `true` | Only opens sidebar file links that resolve inside the workspace. |
| `tauren.rejectEditWriteOutsideWorkspace` | `false` | Rejects Pi edit/write tool mutations outside the active workspace folder. |

These settings are guardrails, not a full security boundary. In particular, `tauren.rejectEditWriteOutsideWorkspace` does not block shell commands. A shell command can still read or modify files using the permissions of your VS Code process.

If you need stricter isolation, use an OS-level sandbox, container, VM, or a disposable checkout.

## Tool calls and file changes

Tauren shows tool activity in the transcript so you can inspect what happened during a session. When files change, use Session Diffs to review the session-specific changes before committing.

A good review loop is:

1. Read the final answer.
2. Expand relevant tool output if something looks surprising.
3. Open the session diff.
4. Inspect the actual files.
5. Run tests or compile.
6. Check `git diff` before committing.

Session diffs answer what changed during a Tauren session. Git remains the source of truth for repository history.

## Sessions and exports

Pi owns session files and state. Tauren restores rendered history from Pi session data rather than treating the sidebar transcript as the source of truth.

Keep in mind:

- session history may contain prompts, file paths, tool output, and snippets of project content,
- HTML exports contain a readable copy of the session,
- `/share` creates a secret GitHub Gist through the `gh` CLI.

A secret Gist is unlisted, not access-controlled like a private repository. Anyone with the link can read it. Review exported or shared sessions before sending links around.

## Remote images and rendered content

By default, Tauren blocks remote HTTPS images in rendered chat markdown with `tauren.blockHttpsImages`. This helps avoid unexpected external requests from assistant-generated content.

Workspace images and Pi-provided image data can still render where supported. Only disable remote-image blocking if you trust the content and understand that viewing the transcript may contact external hosts.

## Pi extensions and custom UI

Pi extensions can add widgets, status text, dialogs, and custom terminal-style UI surfaces inside Tauren. Tauren renders those surfaces, but the extension code and behavior come from the Pi runtime environment.

Only install and enable extensions you trust. If an extension UI looks suspicious or behaves unexpectedly:

1. Disable its Tauren extension surfaces in **Settings → Extensions** if needed.
2. Run `/reload` after changing extension files or configuration.
3. Open diagnostics to inspect runtime errors.

## Ready scripts

`tauren.readyScript` runs an executable script when the Pi engine becomes ready. This is useful for lightweight workspace preparation, but it runs with your local user permissions.

Use ready scripts for small, predictable tasks. Avoid scripts that mutate broad parts of the filesystem, start long-running processes, or depend on hidden state.

## Diagnostics

Diagnostics are designed to help you understand startup, runtime, extension, and performance problems. Diagnostic output can include paths, error messages, provider/runtime details, and other troubleshooting context.

Review diagnostics before copying them into an issue or chat, especially when working in private repositories.

## Recommended defaults

For most projects, a sensible baseline is:

- keep remote HTTPS images blocked,
- keep file-reference opens restricted to the workspace,
- enable edit/write rejection outside the workspace when working in sensitive directories,
- use named sessions for auditability,
- review session diffs and Git diffs before committing,
- share exports or Gists only after checking their contents.

Tauren is meant to make agent work visible and reviewable. The safest workflow is still the human one: keep tasks scoped, watch what changes, and verify before you trust the result.
