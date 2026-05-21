import { buildSessionTreePrefix, formatSessionMeta, getSessionDisplayName, shortenPath } from './sessionFormat';
import {
  getSessionItemCommandIcon,
  getSessionItemCommandLabel,
  sessionItemMenuCommands
} from './sessionItemCommands';
import type { SessionItem, SessionItemCommand, TreeItem } from '../types';

export type CreateSessionItemElementOptions = {
  session: SessionItem;
  index: number;
  selectedIndex: number;
  nameEditPath: string | undefined;
  nameEditValue: string;
  openMenuIndex: number | undefined;
  canRunSessionItemCommand: (session: SessionItem, command?: SessionItemCommand) => boolean;
  onNameInputInput: (value: string) => void;
  onNameInputBlur: () => void;
  onCommandActivate: (commandIndex: number, button: HTMLButtonElement) => void;
  onCommandHover: (button: HTMLButtonElement, hovered: boolean) => void;
};

export function createSessionItemElement(options: CreateSessionItemElementOptions): HTMLElement {
  const { session, index } = options;
  const item = document.createElement('div');
  item.id = 'session-' + index;
  item.className = 'sessions__item'
    + (index === options.selectedIndex ? ' sessions__item--active' : '')
    + (session.current ? ' sessions__item--current' : '')
    + (session.liveStatus ? ' sessions__item--' + session.liveStatus : '')
    + (session.unread ? ' sessions__item--unread' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', index === options.selectedIndex ? 'true' : 'false');
  item.setAttribute('data-index', String(index));

  const prefix = document.createElement('span');
  prefix.className = 'sessions__prefix';
  prefix.textContent = (session.liveStatus === 'running' ? '● ' : '') + buildSessionTreePrefix(session);
  item.append(prefix);

  const title = document.createElement('span');
  title.className = 'sessions__title';

  if (options.nameEditPath === session.path) {
    title.append(createSessionListNameInput(options));
  } else {
    const titleText = document.createElement('span');
    titleText.className = 'sessions__title-text';
    titleText.textContent = getSessionDisplayName(session);
    title.append(titleText);
  }

  item.append(title);

  const meta = document.createElement('span');
  meta.className = 'sessions__meta';
  meta.textContent = formatSessionMeta(session);
  item.append(meta);

  if (session.cwd) {
    const cwd = document.createElement('span');
    cwd.className = 'sessions__cwd';
    cwd.textContent = shortenPath(session.cwd);
    item.append(cwd);
  }

  item.append(createSessionItemMenuElement(options));

  return item;
}

export function createTreeItemElement(
  treeItem: TreeItem,
  index: number,
  options: { selectedIndex: number; disabled: boolean }
): HTMLElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.id = 'tree-' + index;
  const roleClass = getTreeRoleClass(treeItem.role);
  item.className = 'sessions__item sessions__tree-item sessions__tree-item--' + roleClass
    + (index === options.selectedIndex ? ' sessions__item--active' : '')
    + (treeItem.current ? ' sessions__item--current' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', index === options.selectedIndex ? 'true' : 'false');
  item.setAttribute('data-index', String(index));
  item.disabled = options.disabled;

  item.append(createTreePrefixElement(treeItem, index === options.selectedIndex));

  const title = document.createElement('span');
  title.className = 'sessions__title sessions__tree-title'
    + (treeItem.role === 'summary' ? ' sessions__tree-title--summary' : '');

  if (treeItem.label) {
    const label = document.createElement('span');
    label.className = 'sessions__tree-label';
    label.textContent = `[${treeItem.label}]`;
    title.append(label);
  }

  if (treeItem.role === 'summary') {
    const summaryBox = document.createElement('span');
    summaryBox.className = 'activity activity--message activity--info sessions__tree-summary-activity';

    const summaryHeader = document.createElement('span');
    summaryHeader.className = 'activity__summary';

    const summaryTitle = document.createElement('span');
    summaryTitle.className = 'activity__title';
    summaryTitle.textContent = 'Branch summary';
    summaryHeader.append(summaryTitle);

    const summaryText = document.createElement('span');
    summaryText.className = 'activity__body sessions__tree-summary-activity-body';
    summaryText.textContent = stripBranchSummaryPrefix(treeItem.text || '(empty)');
    summaryBox.append(summaryHeader, summaryText);
    title.append(summaryBox);
  } else if (treeItem.role === 'tool') {
    const toolText = document.createElement('span');
    toolText.className = 'sessions__title-text sessions__tree-content';
    toolText.textContent = treeItem.text || '[tool]';
    title.append(toolText);
  } else {
    const role = document.createElement('span');
    role.className = 'sessions__role sessions__tree-role';
    role.textContent = treeItem.role + ':';
    title.append(role);

    const titleText = document.createElement('span');
    titleText.className = 'sessions__title-text sessions__tree-content';
    titleText.textContent = treeItem.text || '(empty)';
    title.append(titleText);
  }

  item.append(title);

  return item;
}

function stripBranchSummaryPrefix(text: string): string {
  const prefix = 'Returned from branch.\n\n';
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function createTreePrefixElement(treeItem: TreeItem, selected: boolean): HTMLElement {
  const prefix = document.createElement('span');
  prefix.className = 'sessions__prefix sessions__tree-prefix';

  const cursor = document.createElement('span');
  cursor.className = 'sessions__tree-cursor';
  cursor.textContent = selected ? '›' : '';
  prefix.append(cursor);

  for (const chunk of getTreePrefixChunks(treeItem.prefix ?? '')) {
    const connector = document.createElement('span');
    connector.className = 'sessions__tree-connector' + getTreeConnectorClass(chunk);
    connector.textContent = getTreeConnectorText(chunk);
    prefix.append(connector);
  }

  const activePath = document.createElement('span');
  activePath.className = 'sessions__tree-active-path';
  activePath.textContent = treeItem.activePath ? '•' : '';
  prefix.append(activePath);

  return prefix;
}

function getTreePrefixChunks(prefix: string): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < prefix.length; index += 3) {
    chunks.push(prefix.slice(index, index + 3));
  }

  return chunks;
}

function getTreeConnectorText(chunk: string): string {
  if (chunk.includes('├')) {
    return chunk.includes('⊟') ? '├⊟' : '├─';
  }

  if (chunk.includes('└')) {
    return chunk.includes('⊟') ? '└⊟' : '└─';
  }

  if (chunk.includes('│')) {
    return '│';
  }

  return '';
}

function getTreeConnectorClass(chunk: string): string {
  if (chunk.includes('├') || chunk.includes('└')) {
    return ' sessions__tree-connector--branch';
  }

  if (chunk.includes('│')) {
    return ' sessions__tree-connector--gutter';
  }

  return ' sessions__tree-connector--blank';
}

function getTreeRoleClass(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'entry';
}

function createSessionListNameInput(options: CreateSessionItemElementOptions): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'sessions__name-input';
  input.type = 'text';
  input.value = options.nameEditValue;
  input.placeholder = getSessionDisplayName(options.session);
  input.setAttribute('aria-label', 'Session name');
  input.addEventListener('input', () => options.onNameInputInput(input.value));
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('blur', options.onNameInputBlur);
  return input;
}

function createSessionItemMenuElement(options: CreateSessionItemElementOptions): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'sessions__menu-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sessions__menu-button';
  button.setAttribute('aria-label', 'Session commands');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', options.openMenuIndex === options.index ? 'true' : 'false');
  button.disabled = !options.canRunSessionItemCommand(options.session);
  button.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z"/></svg><span class="tau-icon-action-tooltip">Session commands</span>';
  wrap.append(button);

  const menu = document.createElement('span');
  menu.className = 'sessions__menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = options.openMenuIndex !== options.index;

  for (let commandIndex = 0; commandIndex < sessionItemMenuCommands.length; commandIndex += 1) {
    const command = sessionItemMenuCommands[commandIndex];

    menu.append(createSessionItemMenuButton(command, commandIndex, options));
  }

  wrap.append(menu);
  return wrap;
}

function createSessionItemMenuButton(
  command: SessionItemCommand,
  commandIndex: number,
  options: CreateSessionItemElementOptions
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pi-toolbar__menu-item sessions__menu-item';
  button.setAttribute('role', 'menuitem');
  button.setAttribute('data-session-command', command);
  button.setAttribute('data-session-command-index', String(commandIndex));
  button.disabled = !options.canRunSessionItemCommand(options.session, command);
  button.innerHTML = '<span class="pi-toolbar__menu-label">' + getSessionItemCommandLabel(command) + '</span>' + getSessionItemCommandIcon(command);
  button.addEventListener('pointerenter', () => options.onCommandActivate(commandIndex, button));
  button.addEventListener('pointerleave', () => options.onCommandHover(button, false));
  button.addEventListener('focus', () => options.onCommandActivate(commandIndex, button));
  button.addEventListener('blur', () => options.onCommandHover(button, false));
  return button;
}
