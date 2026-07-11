import * as vscode from 'vscode';
import { isAgentMemoryClient, type AgentMemoryClient, type AgentMemoryInspect, type AgentMemoryList, type AgentMemoryRecord, type AgentMemoryStatus, type AgentMemoryWhy } from '../agent/memory';

export type KwardMemoryAction =
  | 'status'
  | 'enable'
  | 'disable'
  | 'auto-summary'
  | 'list'
  | 'add'
  | 'add-core'
  | 'forget'
  | 'promote'
  | 'relax'
  | 'inspect'
  | 'why'
  | 'summarize';

type MemoryActionOptions = {
  client: unknown;
  action: KwardMemoryAction;
  args?: string;
  showNotification: (message: string, notifyType: string) => void;
};

export async function runKwardMemoryAction(options: MemoryActionOptions): Promise<string | undefined> {
  const client = requireAgentMemoryClient(options.client);
  const args = options.args?.trim() ?? '';

  switch (options.action) {
    case 'status':
      return formatMemoryStatus(await client.getMemoryStatus());
    case 'enable':
      return formatMemoryStatus(await client.setMemoryEnabled(true));
    case 'disable':
      return formatMemoryStatus(await client.setMemoryEnabled(false));
    case 'auto-summary':
      return setAutoSummary(client, args);
    case 'list':
      return formatMemoryList(await client.listMemory({ includeInactive: args.includes('--all') }));
    case 'add':
      return addMemory(client, args, false);
    case 'add-core':
      return addMemory(client, args, true);
    case 'forget':
      return actOnMemoryId(client, args, 'forget');
    case 'promote':
      return actOnMemoryId(client, args, 'promote');
    case 'relax':
      return actOnMemoryId(client, args, 'relax');
    case 'inspect':
      return formatMemoryInspect(await client.inspectMemory());
    case 'why':
      return formatMemoryWhy(await client.whyMemory());
    case 'summarize': {
      const result = await client.summarizeMemory();
      return result.memories.length === 1 ? 'Learned 1 soft memory.' : `Learned ${result.memories.length} soft memories.`;
    }
  }
}

export function parseKwardMemorySlashArgs(args: string): { action: KwardMemoryAction; args?: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { action: 'status' };
  }

  const [rawCommand = '', ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const remaining = rest.join(' ').trim();

  switch (command) {
    case 'status':
    case 'enable':
    case 'disable':
    case 'list':
    case 'forget':
    case 'promote':
    case 'relax':
    case 'inspect':
    case 'why':
    case 'summarize':
      return { action: command, args: remaining };
    case 'add':
      return { action: 'add', args: remaining };
    case 'core':
    case 'add-core':
    case 'addcore':
      return { action: 'add-core', args: remaining };
    case 'auto-summary':
    case 'autosummary':
      return { action: 'auto-summary', args: remaining };
    default:
      return { action: 'add', args: trimmed };
  }
}

function requireAgentMemoryClient(client: unknown): AgentMemoryClient {
  if (!isAgentMemoryClient(client)) {
    throw new Error('Memory is only available when the selected backend supports it.');
  }

  return client;
}

async function setAutoSummary(client: AgentMemoryClient, args: string): Promise<string> {
  const normalized = args.toLowerCase();
  const enabled = normalized === 'enable' || normalized === 'on' || normalized === 'true'
    ? true
    : normalized === 'disable' || normalized === 'off' || normalized === 'false'
      ? false
      : (await client.getMemoryStatus()).autoSummary === false;
  return formatMemoryStatus(await client.setMemoryAutoSummary(enabled));
}

async function addMemory(client: AgentMemoryClient, args: string, core: boolean): Promise<string | undefined> {
  const text = args || await vscode.window.showInputBox({
    title: core ? 'Add Kward core memory' : 'Add Kward soft memory',
    prompt: 'Memory text',
    ignoreFocusOut: true
  });

  if (!text) {
    return undefined;
  }

  const memory = await client.addMemory(text, { core, scope: 'workspace' });
  return `Added ${core ? 'core' : 'soft'} memory${memory.id ? ` ${memory.id}` : ''}.`;
}

async function actOnMemoryId(
  client: AgentMemoryClient,
  args: string,
  action: 'forget' | 'promote' | 'relax'
): Promise<string | undefined> {
  const id = args || await pickMemoryId(client, action);
  if (!id) {
    return undefined;
  }

  if (action === 'forget') {
    await client.forgetMemory(id);
    return `Forgot memory ${id}.`;
  }

  const memory = action === 'promote' ? await client.promoteMemory(id) : await client.relaxMemory(id);
  return `${action === 'promote' ? 'Promoted' : 'Relaxed'} memory ${memory.id ?? id}.`;
}

async function pickMemoryId(client: AgentMemoryClient, action: string): Promise<string | undefined> {
  const memories = flattenMemoryList(await client.listMemory({ includeInactive: false }));
  const picked = await vscode.window.showQuickPick(memories.map((memory) => ({
    label: memory.id ?? '(unknown id)',
    description: memory.scope,
    detail: memory.text,
    memory
  })), {
    title: `Kward memory: ${action}`,
    placeHolder: 'Select a memory'
  });
  return picked?.memory.id;
}

function flattenMemoryList(list: AgentMemoryList): AgentMemoryRecord[] {
  return [
    ...list.globalCore.map((memory) => ({ ...memory, scope: memory.scope ?? 'global core' })),
    ...list.workspaceCore.map((memory) => ({ ...memory, scope: memory.scope ?? 'workspace core' })),
    ...list.workspaceSoft.map((memory) => ({ ...memory, scope: memory.scope ?? 'workspace soft' }))
  ];
}

function formatMemoryStatus(status: AgentMemoryStatus): string {
  return `Kward memory ${status.enabled ? 'enabled' : 'disabled'}; auto-summary ${status.autoSummary ? 'enabled' : 'disabled'}.`;
}

function formatMemoryList(list: AgentMemoryList): string {
  return [
    formatMemorySection('Global Core Memories', list.globalCore),
    formatMemorySection('Workspace Core Memories', list.workspaceCore),
    formatMemorySection('Workspace Soft Memories', list.workspaceSoft)
  ].join('\n\n');
}

function formatMemoryInspect(inspect: AgentMemoryInspect): string {
  const paths = inspect.paths
    ? [
      inspect.paths.core ? `- core: ${inspect.paths.core}` : undefined,
      inspect.paths.soft ? `- soft: ${inspect.paths.soft}` : undefined,
      inspect.paths.events ? `- events: ${inspect.paths.events}` : undefined
    ].filter(Boolean).join('\n')
    : '';

  return [
    formatMemoryStatus(inspect),
    paths ? `Paths:\n${paths}` : undefined,
    formatMemorySection('Core Memories', inspect.core),
    formatMemorySection('Soft Memories', inspect.soft)
  ].filter(Boolean).join('\n\n');
}

function formatMemorySection(title: string, records: AgentMemoryRecord[]): string {
  const lines = [`${title}:`];

  if (records.length === 0) {
    lines.push('- none');
    return lines.join('\n');
  }

  for (const record of records) {
    const id = record.id ?? '(unknown id)';
    const scope = record.scope ? ` [${record.scope}]` : '';
    const text = record.text ?? '';
    lines.push(`- ${id}${scope}${text ? ` ${text}` : ''}`);
  }

  return lines.join('\n');
}

function formatMemoryWhy(why: AgentMemoryWhy): string {
  if (why.explanation) {
    return why.explanation;
  }

  if (why.message) {
    return why.message;
  }

  if (why.memories && why.memories.length > 0) {
    return formatMemorySection('Retrieved Memories', why.memories);
  }

  return 'No memory retrieval explanation is available yet.';
}
