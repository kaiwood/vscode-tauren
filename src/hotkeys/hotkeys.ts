export type HotkeyRow = {
  key: string;
  action: string;
};

type HotkeySection = {
  title: string;
  rows: HotkeyRow[];
};

export type VsCodeHotkey = HotkeyRow & {
  command: string;
};

export type TaurenHotkeysOptions = {
  vscodeHotkeys?: VsCodeHotkey[];
  vscodeNote?: string;
};

const baseSections: HotkeySection[] = [
  {
    title: 'Session List',
    rows: [
      { key: '↑ / ↓', action: 'Move through sessions' },
      { key: 'Home / End', action: 'Move to first or last visible session' },
      { key: 'Enter', action: 'Open selected session' },
      { key: 'Esc', action: 'Return to chat' },
      { key: '?', action: 'Show help' },
      { key: 'R', action: 'Rename selected session' },
      { key: 'F', action: 'Fork selected session' },
      { key: 'C', action: 'Clone selected session' },
      { key: 'Z', action: 'Compact selected session' },
      { key: 'E', action: 'Export selected session as HTML' },
      { key: 'Delete / Backspace', action: 'Move selected session to trash' },
      { key: 'Search: ↓ / Enter', action: 'Focus first visible session' },
      { key: 'Search: Esc', action: 'Clear search, or return to chat when empty' },
      { key: 'Named filter: Enter / Space', action: 'Toggle named-session filter' },
      { key: 'Menu: ↑ / ↓', action: 'Move through menu items' },
      { key: 'Menu: Enter', action: 'Run focused menu item' },
      { key: 'Menu: Esc', action: 'Close menu' }
    ]
  },
  {
    title: 'Session Tree',
    rows: [
      { key: '↑ / ↓', action: 'Move through tree items' },
      { key: 'Home / End', action: 'Move to first or last tree item' },
      { key: '← / →', action: 'Move to parent or deepest visible last child' },
      { key: 'Enter', action: 'Open selected tree item' },
      { key: 'Esc', action: 'Return to chat, or close the active tree dialog' },
      { key: 'Shift+L', action: 'Edit selected tree label' },
      { key: 'Label edit: Enter', action: 'Save label' },
      { key: 'Label edit: Esc', action: 'Cancel label edit' },
      { key: 'Summary dialog: ↑ / ↓', action: 'Move through summary choices' },
      { key: 'Summary dialog: Enter', action: 'Run selected summary choice' },
      { key: 'Summary text: Ctrl/Cmd+Enter', action: 'Run custom summary instructions' },
      { key: 'Summary dialog: Esc', action: 'Cancel summary dialog' }
    ]
  },
  {
    title: 'Chat Face',
    rows: [
      { key: 'Enter', action: 'Send composer message' },
      { key: 'Shift+Enter', action: 'Insert composer newline' },
      { key: 'Esc', action: 'Close open menus, clear composer text or attachments, otherwise open session list' },
      { key: '/', action: 'Show slash commands' },
      { key: 'Slash menu: ↑ / ↓', action: 'Move through slash commands or file suggestions' },
      { key: 'Slash menu: Tab / Enter', action: 'Accept active slash command or file suggestion' },
      { key: 'Slash menu: Esc', action: 'Dismiss slash menu' },
      { key: 'PageUp/PageDown; Cmd+PageUp/PageDown on mac; Alt+PageUp/PageDown elsewhere', action: 'Scroll active pane by page' },
      { key: 'Cmd+↑/↓ on mac; Ctrl+Home/End elsewhere', action: 'Scroll active pane to top or bottom' },
      { key: 'Ctrl/Cmd+F', action: 'Open transcript search' },
      { key: 'Search: Enter / Shift+Enter', action: 'Move to next or previous search match' },
      { key: 'Search: Esc', action: 'Close transcript search' },
      { key: 'Ctrl+O', action: 'Toggle tool output details' },
      { key: 'Model menu: ↑ / ↓', action: 'Move through model and thinking controls' },
      { key: 'Model menu: Home / End', action: 'Move to first or last model-menu control' },
      { key: 'Settings: Esc', action: 'Close settings' },
      { key: 'Settings nav: ↑ / ↓ / ← / →', action: 'Move through settings sections' },
      { key: 'Settings nav: Home / End', action: 'Move to first or last settings section' },
      { key: 'Extension editor: Esc', action: 'Cancel extension editor dialog' },
      { key: 'Custom UI: terminal keys', action: 'Forward focused terminal-style extension UI keys to Pi extensions' }
    ]
  }
];

export function formatTaurenHotkeys(options: TaurenHotkeysOptions = {}): string {
  const sections = [...baseSections];
  const vscodeRows = options.vscodeHotkeys?.map(({ key, action }) => ({ key, action })) ?? [];

  if (vscodeRows.length > 0) {
    sections.push({ title: 'VS Code Commands', rows: vscodeRows });
  }

  const lines = ['# Tauren Hotkeys', ''];

  for (const section of sections) {
    lines.push(`## ${section.title}`, '', '| Key | Function |', '| --- | --- |');

    for (const row of section.rows) {
      lines.push(`| ${escapeTableCell(row.key)} | ${escapeTableCell(row.action)} |`);
    }

    lines.push('');
  }

  if (options.vscodeNote) {
    lines.push(options.vscodeNote);
  }

  return lines.join('\n').trimEnd();
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
