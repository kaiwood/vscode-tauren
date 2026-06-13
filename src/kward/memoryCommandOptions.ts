export type KwardMemoryCommandOption = {
  command: string;
  description: string;
  insertText?: string;
};

export const kwardMemoryCommandOptions: KwardMemoryCommandOption[] = [
  { command: 'status', description: 'Show memory and auto-summary status' },
  { command: 'enable', description: 'Enable Kward memory' },
  { command: 'disable', description: 'Disable memory prompt injection' },
  { command: 'auto-summary enable', description: 'Learn soft memories after completed turns' },
  { command: 'auto-summary disable', description: 'Disable automatic memory summarization' },
  { command: 'core <text>', description: 'Add a global core memory', insertText: 'core' },
  { command: 'add <text>', description: 'Add a workspace soft memory', insertText: 'add' },
  { command: 'list', description: 'List active memory for this workspace' },
  { command: 'list --all', description: 'List memory including inactive records' },
  { command: 'forget <id>', description: 'Forget a core or soft memory', insertText: 'forget' },
  { command: 'promote <id>', description: 'Promote soft memory or workspace core memory', insertText: 'promote' },
  { command: 'relax <id>', description: 'Relax a global core memory into this workspace', insertText: 'relax' },
  { command: 'inspect', description: 'Inspect memory status, paths, and stored records' },
  { command: 'why', description: 'Explain the latest memory retrieval' },
  { command: 'summarize', description: 'Learn soft memories from this session' }
];
