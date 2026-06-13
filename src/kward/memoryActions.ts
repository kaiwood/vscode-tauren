import * as vscode from 'vscode';
import { KwardClient } from './kwardClient';
import type { KwardMemoryList, KwardMemoryRecord, KwardMemoryStatus, KwardMemoryWhy } from './types';

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

export async function runKwardMemoryAction(options: MemoryActionOptions): Promise<void> {
  const client = requireKwardMemoryClient(options.client);
  const args = options.args?.trim() ?? '';

  switch (options.action) {
    case 'status':
      options.showNotification(formatMemoryStatus(await client.getMemoryStatus()), 'info');
      return;
    case 'enable':
      options.showNotification(formatMemoryStatus(await client.setMemoryEnabled(true)), 'info');
      return;
    case 'disable':
      options.showNotification(formatMemoryStatus(await client.setMemoryEnabled(false)), 'info');
      return;
    case 'auto-summary':
      await setAutoSummary(client, args, options.showNotification);
      return;
    case 'list':
      await showMemoryList(await client.listMemory({ includeInactive: args.includes('--all') }));
      return;
    case 'add':
      await addMemory(client, args, false, options.showNotification);
      return;
    case 'add-core':
      await addMemory(client, args, true, options.showNotification);
      return;
    case 'forget':
      await actOnMemoryId(client, args, 'forget', options.showNotification);
      return;
    case 'promote':
      await actOnMemoryId(client, args, 'promote', options.showNotification);
      return;
    case 'relax':
      await actOnMemoryId(client, args, 'relax', options.showNotification);
      return;
    case 'inspect': {
      const result = await client.inspectMemory();
      await showMemoryList({ globalCore: result.core, workspaceCore: [], workspaceSoft: result.soft });
      return;
    }
    case 'why':
      options.showNotification(formatMemoryWhy(await client.whyMemory()), 'info');
      return;
    case 'summarize': {
      const result = await client.summarizeMemory();
      options.showNotification(result.memories.length === 1 ? 'Learned 1 memory.' : `Learned ${result.memories.length} memories.`, 'info');
      return;
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

export async function pickAndRunKwardMemoryAction(client: unknown, action: KwardMemoryAction, showNotification: (message: string, notifyType: string) => void): Promise<void> {
  await runKwardMemoryAction({ client, action, showNotification });
}

type KwardMemoryClient = Pick<KwardClient,
  | 'getMemoryStatus'
  | 'setMemoryEnabled'
  | 'setMemoryAutoSummary'
  | 'listMemory'
  | 'addMemory'
  | 'forgetMemory'
  | 'promoteMemory'
  | 'relaxMemory'
  | 'inspectMemory'
  | 'whyMemory'
  | 'summarizeMemory'
>;

function requireKwardMemoryClient(client: unknown): KwardMemoryClient {
  if (!(client instanceof KwardClient)) {
    throw new Error('Kward memory is only available when the Kward backend is selected.');
  }

  return client;
}

async function setAutoSummary(client: KwardMemoryClient, args: string, showNotification: (message: string, notifyType: string) => void): Promise<void> {
  const normalized = args.toLowerCase();
  const enabled = normalized === 'enable' || normalized === 'on' || normalized === 'true'
    ? true
    : normalized === 'disable' || normalized === 'off' || normalized === 'false'
      ? false
      : (await client.getMemoryStatus()).autoSummary === false;
  showNotification(formatMemoryStatus(await client.setMemoryAutoSummary(enabled)), 'info');
}

async function addMemory(client: KwardMemoryClient, args: string, core: boolean, showNotification: (message: string, notifyType: string) => void): Promise<void> {
  const text = args || await vscode.window.showInputBox({
    title: core ? 'Add Kward core memory' : 'Add Kward soft memory',
    prompt: 'Memory text',
    ignoreFocusOut: true
  });

  if (!text) {
    return;
  }

  const memory = await client.addMemory(text, { core, scope: 'workspace' });
  showNotification(`Saved ${core ? 'core' : 'soft'} memory${memory.id ? ` ${memory.id}` : ''}.`, 'info');
}

async function actOnMemoryId(
  client: KwardMemoryClient,
  args: string,
  action: 'forget' | 'promote' | 'relax',
  showNotification: (message: string, notifyType: string) => void
): Promise<void> {
  const id = args || await pickMemoryId(client, action);
  if (!id) {
    return;
  }

  if (action === 'forget') {
    await client.forgetMemory(id);
    showNotification(`Forgot memory ${id}.`, 'info');
    return;
  }

  const memory = action === 'promote' ? await client.promoteMemory(id) : await client.relaxMemory(id);
  showNotification(`${action === 'promote' ? 'Promoted' : 'Relaxed'} memory ${memory.id ?? id}.`, 'info');
}

async function pickMemoryId(client: KwardMemoryClient, action: string): Promise<string | undefined> {
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

async function showMemoryList(list: KwardMemoryList): Promise<void> {
  const memories = flattenMemoryList(list);
  if (memories.length === 0) {
    void vscode.window.showInformationMessage('No Kward memories found.');
    return;
  }

  await vscode.window.showQuickPick(memories.map((memory) => ({
    label: memory.id ?? '(unknown id)',
    description: memory.scope,
    detail: memory.text
  })), {
    title: 'Kward memories',
    placeHolder: `${memories.length} memories`
  });
}

function flattenMemoryList(list: KwardMemoryList): KwardMemoryRecord[] {
  return [
    ...list.globalCore.map((memory) => ({ ...memory, scope: memory.scope ?? 'global core' })),
    ...list.workspaceCore.map((memory) => ({ ...memory, scope: memory.scope ?? 'workspace core' })),
    ...list.workspaceSoft.map((memory) => ({ ...memory, scope: memory.scope ?? 'workspace soft' }))
  ];
}

function formatMemoryStatus(status: KwardMemoryStatus): string {
  return `Kward memory ${status.enabled ? 'enabled' : 'disabled'}; auto-summary ${status.autoSummary ? 'enabled' : 'disabled'}.`;
}

function formatMemoryWhy(why: KwardMemoryWhy): string {
  return why.explanation ?? why.message ?? 'No memory retrieval explanation is available yet.';
}
