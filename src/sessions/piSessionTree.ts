import { readFile } from 'fs/promises';
import { extractPiMessageText } from '../piMessageContent';
import type { PiSessionTreeItem, RawEntry, TreeNode } from './types';
export type { PiSessionTreeItem } from './types';

export async function listPiSessionTree(sessionFile: string | undefined): Promise<PiSessionTreeItem[]> {
  if (!sessionFile) {
    return [];
  }

  const content = await readFile(sessionFile, 'utf8');
  return flattenTree(parseTreeEntries(content));
}

function parseTreeEntries(content: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const labels = new Map<string, string>();

  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      continue;
    }

    if (parsed.type === 'label') {
      const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : '';
      const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';

      if (targetId && label) {
        labels.set(targetId, label);
      } else if (targetId) {
        labels.delete(targetId);
      }

      continue;
    }

    if (parsed.type === 'session' || typeof parsed.id !== 'string') {
      continue;
    }

    if (parsed.type === 'model_change' || parsed.type === 'thinking_level_change') {
      continue;
    }

    entries.push(parsed as RawEntry);
  }

  return entries.map((entry) => {
    const label = labels.get(entry.id ?? '');
    return label ? { ...entry, resolvedLabel: label } : entry;
  });
}

function flattenTree(entries: RawEntry[]): PiSessionTreeItem[] {
  const nodesById = new Map<string, TreeNode>();

  for (const entry of entries) {
    if (entry.id) {
      nodesById.set(entry.id, { entry, children: [] });
    }
  }

  const roots: TreeNode[] = [];

  for (const entry of entries) {
    const node = entry.id ? nodesById.get(entry.id) : undefined;

    if (!node) {
      continue;
    }

    const parentId = typeof entry.parentId === 'string' ? entry.parentId : undefined;
    const parent = parentId ? nodesById.get(parentId) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const result: PiSessionTreeItem[] = [];
  const currentEntryId = entries.length > 0 ? entries[entries.length - 1].id : undefined;

  const walk = (node: TreeNode): void => {
    const formatted = formatEntry(node.entry);
    result.push({
      entryId: node.entry.id ?? '',
      role: formatted.role,
      text: formatted.text,
      current: Boolean(currentEntryId && node.entry.id === currentEntryId)
    });

    node.children.forEach(walk);
  };

  roots.forEach(walk);
  return result;
}

function formatEntry(entry: RawEntry): { role: string; text: string } {
  const label = typeof entry.resolvedLabel === 'string' ? `[${entry.resolvedLabel}] ` : '';

  if (entry.type === 'message' && isRecord(entry.message)) {
    const role = typeof entry.message.role === 'string' ? entry.message.role : 'message';
    return { role, text: label + summarizeMessage(entry.message) };
  }

  if (entry.type === 'branch_summary') {
    return { role: 'summary', text: label + summarizeText(entry.summary) };
  }

  if (entry.type === 'compaction') {
    return { role: 'compaction', text: label + summarizeText(entry.summary) };
  }

  if (entry.type === 'custom_message') {
    const customType = typeof entry.customType === 'string' ? entry.customType : 'custom';
    return { role: customType, text: label + summarizeText(entry.content) };
  }

  return { role: entry.type ?? 'entry', text: label + entry.type };
}

function summarizeMessage(message: Record<string, unknown>): string {
  if (message.role === 'assistant' && Array.isArray(message.content)) {
    const text = extractPiMessageText(message.content, { separator: ' ', includeToolCalls: true });
    return truncate(text || '(no text)');
  }

  return summarizeText(message.content);
}

function summarizeText(value: unknown): string {
  return truncate(extractPiMessageText(value, { separator: ' ' }));
}

function truncate(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
