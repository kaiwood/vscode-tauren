type LocalSlashCommand = {
  name: string;
  description: string;
  source: 'builtin' | 'unsupported';
  supported: boolean;
};

type LocalSlashCommandDefinition = LocalSlashCommand & {
  hidden?: boolean;
};

const localSlashCommandDefinitions: LocalSlashCommandDefinition[] = [
  { name: 'model', description: 'Select model', source: 'builtin', supported: true },
  { name: 'name', description: 'Set or clear session name', source: 'builtin', supported: true },
  { name: 'session', description: 'Show session info and stats', source: 'builtin', supported: true },
  { name: 'compact', description: 'Manually compact context', source: 'builtin', supported: true },
  { name: 'copy', description: 'Copy last response', source: 'builtin', supported: true },
  { name: 'export', description: 'Export session to HTML', source: 'builtin', supported: true },
  { name: 'new', description: 'Start a new session', source: 'builtin', supported: true },
  { name: 'settings', description: 'Open Tauren settings', source: 'builtin', supported: true },
  { name: 'scoped-models', description: 'Configure scoped model cycling', source: 'builtin', supported: true },
  { name: 'import', description: 'Import and resume a JSONL session', source: 'builtin', supported: true },
  { name: 'share', description: 'Share session as a secret GitHub gist', source: 'builtin', supported: true },
  { name: 'changelog', description: 'Show Pi and Tauren changelogs', source: 'builtin', supported: true },
  { name: 'hotkeys', description: 'Show Tauren keyboard shortcuts', source: 'builtin', supported: true },
  { name: 'fork', description: 'Fork from a previous user message', source: 'builtin', supported: true },
  { name: 'clone', description: 'Duplicate the current session', source: 'builtin', supported: true },
  { name: 'tree', description: 'Navigate session tree', source: 'builtin', supported: true },
  { name: 'login', description: 'Configure provider authentication', source: 'builtin', supported: true },
  { name: 'logout', description: 'Remove stored provider authentication', source: 'builtin', supported: true },
  { name: 'resume', description: 'Resume a different session', source: 'builtin', supported: true },
  { name: 'reload', description: 'Reload keybindings, extensions, skills, prompts, and themes', source: 'builtin', supported: true },
  { name: 'quit', description: 'Not supported here', source: 'unsupported', supported: false }
];

const builtinSlashCommandNames = new Set(localSlashCommandDefinitions.map((command) => command.name));
const supportedBuiltinSlashCommandNames = new Set(
  localSlashCommandDefinitions
    .filter((command) => command.supported)
    .map((command) => command.name)
);

export const localSlashCommandNames = localSlashCommandDefinitions.map((command) => command.name);
export const hiddenLocalSlashCommandNames = localSlashCommandDefinitions
  .filter((command) => command.hidden)
  .map((command) => command.name);
export const localSlashCommands = localSlashCommandDefinitions.map(({ supported: _supported, hidden: _hidden, ...command }) => command);
export const localSlashMenuCommands = localSlashCommandDefinitions
  .filter((command) => command.supported && !command.hidden)
  .map(({ supported: _supported, hidden: _hidden, ...command }) => command);

export function isBuiltinSlashCommand(name: string): boolean {
  return builtinSlashCommandNames.has(name);
}

export function isSupportedBuiltinSlashCommand(name: string): boolean {
  return supportedBuiltinSlashCommandNames.has(name);
}
