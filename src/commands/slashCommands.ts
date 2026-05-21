export type LocalSlashCommand = {
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
  { name: 'copy', description: 'Copy last Pi response', source: 'builtin', supported: true },
  { name: 'export', description: 'Export session to HTML', source: 'builtin', supported: true },
  { name: 'new', description: 'Start a new session', source: 'builtin', supported: true },
  { name: 'settings', description: 'Terminal-only: use VS Code settings instead', source: 'unsupported', supported: false },
  { name: 'scoped-models', description: 'Terminal-only: scoped model cycling is not supported here yet', source: 'unsupported', supported: false },
  { name: 'import', description: 'Terminal-only: session import is not supported here yet', source: 'unsupported', supported: false },
  { name: 'share', description: 'Not supported here yet', source: 'unsupported', supported: false },
  { name: 'changelog', description: 'Not supported here yet', source: 'unsupported', supported: false },
  { name: 'hotkeys', description: 'Terminal-only: use VS Code keybindings instead', source: 'unsupported', supported: false },
  { name: 'fork', description: 'Fork from a previous user message', source: 'builtin', supported: true },
  { name: 'clone', description: 'Duplicate the current session', source: 'builtin', supported: true },
  { name: 'tree', description: 'Navigate session tree', source: 'builtin', supported: true },
  { name: 'login', description: 'Terminal-only: run pi in a terminal to authenticate', source: 'unsupported', supported: false },
  { name: 'logout', description: 'Terminal-only: run pi in a terminal to manage auth', source: 'unsupported', supported: false },
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
