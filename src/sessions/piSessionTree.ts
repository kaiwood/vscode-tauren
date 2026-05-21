import { extractPiMessageText } from '../pi/messageContent';
import { parseSessionJsonlFileRecords } from '../pi/sessionJsonl';
import type { PiSessionTreeItem, RawEntry, TreeNode } from './types';
export type { PiSessionTreeItem } from './types';

export type FlattenableSessionTreeNode = {
  entry: RawEntry;
  children?: FlattenableSessionTreeNode[];
  label?: string;
};

export async function listPiSessionTree(sessionFile: string | undefined): Promise<PiSessionTreeItem[]> {
  if (!sessionFile) {
    return [];
  }

  return flattenEntries(await parseTreeEntries(sessionFile));
}

async function parseTreeEntries(sessionFile: string): Promise<RawEntry[]> {
  const entries: RawEntry[] = [];
  const labels = new Map<string, string>();

  for await (const parsed of parseSessionJsonlFileRecords(sessionFile)) {
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

function flattenEntries(entries: RawEntry[]): PiSessionTreeItem[] {
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

  const currentEntryId = entries.length > 0 ? entries[entries.length - 1].id : undefined;
  return flattenPiSessionTree(roots, currentEntryId);
}

export function flattenPiSessionTree(
  roots: FlattenableSessionTreeNode[],
  currentEntryId: string | null | undefined
): PiSessionTreeItem[] {
  const activePathIds = buildActivePathIds(roots, currentEntryId);
  const toolCallsById = buildToolCallMap(roots);
  const visibleRoots = roots.flatMap((root) => buildVisibleTree(root, currentEntryId));
  const multipleRoots = visibleRoots.length > 1;
  const result: PiSessionTreeItem[] = [];

  type Gutter = { position: number; show: boolean };

  const walk = (
    node: VisibleSessionTreeNode,
    indent: number,
    justBranched: boolean,
    showConnector: boolean,
    isLast: boolean,
    gutters: Gutter[],
    isVirtualRootChild: boolean
  ): void => {
    const entryId = node.source.entry.id ?? '';
    const formatted = formatEntry(node.source.entry, toolCallsById);
    const label = typeof node.source.label === 'string' && node.source.label.trim()
      ? node.source.label.trim()
      : getResolvedLabel(node.source.entry);
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;

    result.push({
      entryId,
      role: formatted.role,
      text: formatted.text,
      current: Boolean(currentEntryId && entryId === currentEntryId),
      depth: displayIndent,
      isLast,
      ancestorContinues: gutters.map((gutter) => gutter.show),
      activePath: activePathIds.has(entryId),
      prefix: buildTreePrefix({
        displayIndent,
        gutters,
        showConnector: showConnector && !isVirtualRootChild,
        isLast,
        foldable: node.children.length > 0
      }),
      ...(label ? { label } : {})
    });

    const children = orderActivePathFirst(node.children, activePathIds);
    const multipleChildren = children.length > 1;
    const childIndent = multipleChildren
      ? indent + 1
      : justBranched && indent > 0
      ? indent + 1
      : indent;
    const connectorDisplayed = showConnector && !isVirtualRootChild;
    const connectorPosition = Math.max(0, displayIndent - 1);
    const childGutters = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;

    children.forEach((child, index) => {
      walk(child, childIndent, multipleChildren, multipleChildren, index === children.length - 1, childGutters, false);
    });
  };

  orderActivePathFirst(visibleRoots, activePathIds).forEach((root, index, orderedRoots) => {
    walk(root, multipleRoots ? 1 : 0, multipleRoots, multipleRoots, index === orderedRoots.length - 1, [], multipleRoots);
  });

  return result;
}

type VisibleSessionTreeNode = {
  source: FlattenableSessionTreeNode;
  children: VisibleSessionTreeNode[];
};

function buildVisibleTree(
  node: FlattenableSessionTreeNode,
  currentEntryId: string | null | undefined
): VisibleSessionTreeNode[] {
  const children = (node.children ?? []).flatMap((child) => buildVisibleTree(child, currentEntryId));

  if (isHiddenTreeEntry(node.entry, currentEntryId)) {
    return children;
  }

  return [{ source: node, children }];
}

function orderActivePathFirst(
  nodes: VisibleSessionTreeNode[],
  activePathIds: Set<string>
): VisibleSessionTreeNode[] {
  return [...nodes].sort((a, b) => Number(containsActivePath(b, activePathIds)) - Number(containsActivePath(a, activePathIds)));
}

function containsActivePath(node: VisibleSessionTreeNode, activePathIds: Set<string>): boolean {
  const entryId = node.source.entry.id;
  return Boolean(entryId && activePathIds.has(entryId))
    || node.children.some((child) => containsActivePath(child, activePathIds));
}

function buildTreePrefix(options: {
  displayIndent: number;
  gutters: Array<{ position: number; show: boolean }>;
  showConnector: boolean;
  isLast: boolean;
  foldable: boolean;
}): string {
  const totalChars = options.displayIndent * 3;

  if (totalChars <= 0) {
    return '';
  }

  const connectorPosition = options.showConnector ? options.displayIndent - 1 : -1;
  let prefix = '';

  for (let index = 0; index < totalChars; index += 1) {
    const level = Math.floor(index / 3);
    const posInLevel = index % 3;
    const gutter = options.gutters.find((candidate) => candidate.position === level);

    if (gutter) {
      prefix += posInLevel === 0 && gutter.show ? '│' : ' ';
      continue;
    }

    if (options.showConnector && level === connectorPosition) {
      if (posInLevel === 0) {
        prefix += options.isLast ? '└' : '├';
      } else if (posInLevel === 1) {
        prefix += options.foldable ? '⊟' : '─';
      } else {
        prefix += ' ';
      }
      continue;
    }

    prefix += ' ';
  }

  return prefix;
}

function buildActivePathIds(
  roots: FlattenableSessionTreeNode[],
  currentEntryId: string | null | undefined
): Set<string> {
  const activePathIds = new Set<string>();

  if (!currentEntryId) {
    return activePathIds;
  }

  const entriesById = new Map<string, RawEntry>();
  const stack = [...roots];

  while (stack.length > 0) {
    const node = stack.pop();
    const id = node?.entry.id;

    if (node && id) {
      entriesById.set(id, node.entry);
      stack.push(...(node.children ?? []));
    }
  }

  let entry: RawEntry | undefined = entriesById.get(currentEntryId);

  while (entry?.id) {
    activePathIds.add(entry.id);
    const parentId = typeof entry.parentId === 'string' ? entry.parentId : undefined;
    entry = parentId ? entriesById.get(parentId) : undefined;
  }

  return activePathIds;
}

function getResolvedLabel(entry: RawEntry): string | undefined {
  const label = entry.resolvedLabel;
  return typeof label === 'string' && label.trim() ? label.trim() : undefined;
}

type ToolCallInfo = {
  name: string;
  arguments: Record<string, unknown>;
};

function buildToolCallMap(roots: FlattenableSessionTreeNode[]): Map<string, ToolCallInfo> {
  const toolCalls = new Map<string, ToolCallInfo>();
  const stack = [...roots];

  while (stack.length > 0) {
    const node = stack.pop();

    if (!node) {
      continue;
    }

    const message = isRecord(node.entry.message) ? node.entry.message : undefined;

    if (node.entry.type === 'message' && message?.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!isRecord(part) || part.type !== 'toolCall' || typeof part.id !== 'string' || typeof part.name !== 'string') {
          continue;
        }

        toolCalls.set(part.id, {
          name: part.name,
          arguments: isRecord(part.arguments) ? part.arguments : {}
        });
      }
    }

    stack.push(...(node.children ?? []));
  }

  return toolCalls;
}

function isHiddenTreeEntry(entry: RawEntry, currentEntryId: string | null | undefined): boolean {
  return isHiddenSettingsEntry(entry) || isHiddenAssistantToolCallEntry(entry, currentEntryId);
}

function isHiddenSettingsEntry(entry: RawEntry): boolean {
  return entry.type === 'label'
    || entry.type === 'custom'
    || entry.type === 'model_change'
    || entry.type === 'thinking_level_change'
    || entry.type === 'session_info';
}

function isHiddenAssistantToolCallEntry(entry: RawEntry, currentEntryId: string | null | undefined): boolean {
  if (currentEntryId && entry.id === currentEntryId) {
    return false;
  }

  const message = isRecord(entry.message) ? entry.message : undefined;
  return entry.type === 'message'
    && message?.role === 'assistant'
    && Array.isArray(message.content)
    && hasToolCallContent(message.content)
    && !hasTextContent(message.content);
}

function hasToolCallContent(content: unknown[]): boolean {
  return content.some((part) => isRecord(part) && part.type === 'toolCall');
}

function hasTextContent(content: unknown[]): boolean {
  return content.some((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' && part.text.trim());
}

function formatEntry(entry: RawEntry, toolCallsById: Map<string, ToolCallInfo>): { role: string; text: string } {
  if (entry.type === 'message' && isRecord(entry.message)) {
    const role = typeof entry.message.role === 'string' ? entry.message.role : 'message';

    if (role === 'toolResult') {
      return { role: 'tool', text: formatToolResult(entry.message, toolCallsById) };
    }

    return { role, text: summarizeMessage(entry.message) };
  }

  if (entry.type === 'branch_summary') {
    return { role: 'summary', text: formatBranchSummary(entry.summary) };
  }

  if (entry.type === 'compaction') {
    return { role: 'compaction', text: summarizeText(entry.summary) };
  }

  if (entry.type === 'custom_message') {
    const customType = typeof entry.customType === 'string' ? entry.customType : 'custom';
    return { role: customType, text: summarizeText(entry.content) };
  }

  return { role: entry.type ?? 'entry', text: entry.type ?? '' };
}

function formatBranchSummary(summary: unknown): string {
  const text = extractPiMessageText(summary, { separator: ' ' }).trim();
  return text ? `Returned from branch.\n\n${text}` : 'Returned from branch.';
}

function summarizeMessage(message: Record<string, unknown>): string {
  if (message.role === 'assistant' && Array.isArray(message.content)) {
    const text = extractPiMessageText(message.content, { separator: ' ' });
    return truncate(text || '(no content)');
  }

  return summarizeText(message.content);
}

function formatToolResult(message: Record<string, unknown>, toolCallsById: Map<string, ToolCallInfo>): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
  const toolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;

  if (toolCall) {
    return formatToolCall(toolCall.name, toolCall.arguments);
  }

  const toolName = typeof message.toolName === 'string' && message.toolName.trim() ? message.toolName.trim() : 'tool';
  return `[${toolName}]`;
}

function formatToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read': {
      const path = String(args.path || args.file_path || '');
      const offset = typeof args.offset === 'number' ? args.offset : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      let display = path;

      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : undefined;
        display += `:${start}${end !== undefined ? `-${end}` : ''}`;
      }

      return `[read: ${display}]`;
    }
    case 'write':
    case 'edit': {
      const path = String(args.path || args.file_path || '');
      return `[${name}: ${path}]`;
    }
    case 'bash': {
      const rawCommand = String(args.command || '');
      const command = rawCommand.replace(/[\n\t]/g, ' ').trim();
      return `[bash: ${command.length > 50 ? `${command.slice(0, 50)}...` : command}]`;
    }
    default: {
      const serialized = JSON.stringify(args);
      const argsText = serialized.length > 40 ? `${serialized.slice(0, 40)}...` : serialized;
      return `[${name}: ${argsText}]`;
    }
  }
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
