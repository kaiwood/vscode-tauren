# Hotkeys

Run `/hotkeys` inside Tauren to print the live shortcut list. This page documents the default interaction model.

## Custom VS Code keybindings

Tauren scopes its default VS Code keybindings with the when-clause context key `tauren.sidebarFocus`.
Use that context when adding your own Tauren sidebar shortcuts in `keybindings.json`:

```json
{
  "key": "ctrl+shift+c",
  "command": "tauren.copyLastResponse",
  "when": "tauren.sidebarFocus"
}
```

VS Code may not autocomplete `tauren.sidebarFocus` in the Keyboard Shortcuts UI or `keybindings.json`.
This is expected: Tauren sets the key dynamically at runtime with VS Code's `setContext` API, and VS Code's when-clause suggestions only include statically known context keys. The key is still valid when typed manually.

## Chat Face

| Key | Action |
| --- | --- |
| `Enter` | Send composer message. |
| `Shift+Enter` | Insert composer newline. |
| `Esc` | Close open menus, clear composer text or attachments, otherwise open the session list. |
| `/` | Show slash commands. |
| `Slash menu: ↑ / ↓` | Move through slash commands or file suggestions. |
| `Slash menu: Tab / Enter` | Accept active slash command or file suggestion. |
| `Slash menu: Esc` | Dismiss slash menu. |
| `PageUp / PageDown` | Scroll transcript by page. |
| `Ctrl+PageUp / Ctrl+PageDown` | Scroll transcript by line. |
| `Ctrl/Cmd+↑ / Ctrl/Cmd+↓` | Scroll transcript to top or bottom. |
| `Ctrl/Cmd+F` | Open transcript search. |
| `Ctrl+Alt+.` / `Alt+Cmd+.` | Open the model picker. |
| `Search: Enter / Shift+Enter` | Move to next or previous search match. |
| `Search: Esc` | Close transcript search. |
| `Ctrl+O` | Toggle tool output details. |

## Session List

| Key | Action |
| --- | --- |
| `↑ / ↓` | Move through sessions. |
| `Home / End` | Move to first or last visible session. |
| `Enter` | Open selected session. |
| `Esc` | Return to chat. |
| `?` | Show help. |
| `R` | Rename selected session. |
| `F` | Fork selected session. |
| `C` | Clone selected session. |
| `Z` | Compact selected session. |
| `E` | Export selected session as HTML. |
| `Delete / Backspace` | Move selected session to trash. |

## Session Tree

| Key | Action |
| --- | --- |
| `↑ / ↓` | Move through tree items. |
| `Home / End` | Move to first or last tree item. |
| `← / →` | Move to parent or deepest visible last child. |
| `Enter` | Open selected tree item. |
| `Esc` | Return to chat or close the active tree dialog. |
| `Shift+L` | Edit selected tree label. |
| `Label edit: Enter` | Save label. |
| `Label edit: Esc` | Cancel label edit. |

## Settings and extension UI

| Key | Action |
| --- | --- |
| `Settings: Esc` | Close settings. |
| `Settings nav: ↑ / ↓ / ← / →` | Move through settings sections. |
| `Settings nav: Home / End` | Move to first or last settings section. |
| `Custom UI: terminal keys` | Forward focused terminal-style extension UI keys to Pi extensions. |
