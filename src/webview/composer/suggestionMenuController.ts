import {
  webviewHiddenLocalSlashCommandNames,
  webviewKwardMemoryCommandOptions,
  webviewLocalSlashCommands
} from '../constants';
import type { FileSuggestion, SlashCommand, WebviewState } from '../types';
import { eventTargetElement } from '../dom';
import {
  acceptFileSuggestion,
  getFileSuggestionPrefixInfo,
  isFileSuggestionsResult
} from './fileSuggestions';

type PostMessage = (message: unknown) => void;
type SuggestionKind = 'slash' | 'file' | 'memory';
type MemorySuggestion = { command: string; description: string; insertText?: string };

export type SuggestionMenuControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  textarea: HTMLTextAreaElement;
  slashMenuElement: HTMLElement | undefined;
  closeModelMenu: () => void;
  cancelSessionNameEdit: () => void;
  syncComposer: (options?: { preserveBottom?: boolean; forceResize?: boolean }) => void;
  focusPromptInput: () => void;
};

export class SuggestionMenuController {
  private open = false;
  private activeIndex = 0;
  private pointerHoverEnabled = false;
  private slashItems: SlashCommand[] = [];
  private slashQuery = '';
  private dismissedSlashQuery: string | undefined;
  private slashCommandsRefreshRequested = false;
  private kind: SuggestionKind | undefined;
  private memoryItems: MemorySuggestion[] = [];
  private memoryQuery = '';
  private fileItems: FileSuggestion[] = [];
  private filePrefix = '';
  private fileRequestId = 0;
  private fileLoading = false;

  public constructor(private readonly options: SuggestionMenuControllerOptions) {}

  public isOpen(): boolean {
    return this.open;
  }

  public dismiss(): void {
    this.dismissedSlashQuery = this.kind === 'slash' ? this.getSlashCommandQuery() : undefined;
    this.close();
  }

  public close(): void {
    this.open = false;
    this.slashCommandsRefreshRequested = false;
    this.slashItems = [];
    this.activeIndex = 0;
    this.slashQuery = '';
    this.kind = undefined;
    this.memoryItems = [];
    this.memoryQuery = '';
    this.fileItems = [];
    this.filePrefix = '';
    this.fileLoading = false;
    this.disablePointerHover();
    this.options.slashMenuElement?.removeAttribute('open');
    this.options.slashMenuElement?.setAttribute('aria-label', 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'false');
    this.options.textarea.removeAttribute('aria-activedescendant');
  }

  public handleHostMessage(message: unknown): boolean {
    if (!isFileSuggestionsResult(message)) {
      return false;
    }

    if (message.id !== String(this.fileRequestId) || message.prefix !== this.filePrefix) {
      return true;
    }

    const activePrefix = getFileSuggestionPrefixInfo(this.options.textarea)?.prefix;

    if (activePrefix !== message.prefix) {
      return true;
    }

    this.fileLoading = false;
    this.fileItems = message.items;
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.fileItems.length - 1));
    this.renderFileMenu(message.prefix);
    this.openMenu();
    return true;
  }

  public sync(): void {
    const filePrefix = getFileSuggestionPrefixInfo(this.options.textarea)?.prefix;

    if (filePrefix) {
      this.syncFileMenu(filePrefix);
      return;
    }

    const state = this.options.getState();
    const memoryQuery = this.getMemoryCommandQuery();

    if (!this.shouldShowSlashMenu() && memoryQuery === undefined) {
      this.close();
      return;
    }

    this.options.closeModelMenu();
    this.options.cancelSessionNameEdit();

    if (memoryQuery !== undefined) {
      this.syncMemoryMenu(memoryQuery);
      return;
    }
    if (
      state.slashCommands.length === 0
      && !state.slashCommandsRefreshing
      && !this.slashCommandsRefreshRequested
    ) {
      this.slashCommandsRefreshRequested = true;
      this.options.postMessage({ type: 'refreshSlashCommands' });
    }

    const query = this.getSlashCommandQuery();
    if (query === this.dismissedSlashQuery) {
      this.close();
      return;
    }

    if (this.kind !== 'slash' || query !== this.slashQuery) {
      this.kind = 'slash';
      this.memoryItems = [];
      this.memoryQuery = '';
      this.fileItems = [];
      this.fileLoading = false;
      this.slashQuery = query;
      this.activeIndex = 0;
      this.disablePointerHover();
      if (this.options.slashMenuElement) {
        this.options.slashMenuElement.scrollTop = 0;
      }
    }

    this.slashItems = this.getFilteredSlashCommands(query);
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.slashItems.length - 1));
    this.renderSlashMenu(query);
    this.openMenu();
  }

  public clearDismissedSlashQuery(): void {
    this.dismissedSlashQuery = undefined;
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.open) {
      if (event.key === 'Escape') {
        this.dismiss();
      }

      return false;
    }

    this.disablePointerHover();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1);
      return true;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.acceptActiveSuggestion();
      return true;
    }

    if (event.key === 'Enter' && !event.shiftKey && this.getActiveSuggestionCount() > 0) {
      event.preventDefault();
      this.acceptActiveSuggestion();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismiss();
      return true;
    }

    return false;
  }

  public handlePointerMove(event: PointerEvent): void {
    if (!this.open) {
      return;
    }

    this.enablePointerHover();

    const item = eventTargetElement(event)?.closest('.composer__slash-item');

    if (!(item instanceof HTMLElement) || !this.options.slashMenuElement?.contains(item)) {
      return;
    }

    const index = Number(item.getAttribute('data-index'));

    if (!Number.isInteger(index) || index < 0 || index >= this.getActiveSuggestionCount()) {
      return;
    }

    const previousIndex = this.activeIndex;

    if (index === previousIndex) {
      return;
    }

    this.activeIndex = index;
    this.updateRenderedSelection(previousIndex);
  }

  public handleClick(event: MouseEvent): void {
    const item = eventTargetElement(event)?.closest('.composer__slash-item');

    if (!item) {
      return;
    }

    const index = Number(item.getAttribute('data-index'));

    if (this.kind === 'file') {
      const file = this.fileItems[index];

      if (file) {
        this.acceptFile(file);
      }

      return;
    }

    if (this.kind === 'memory') {
      const command = this.memoryItems[index];

      if (command) {
        this.acceptMemoryCommand(command);
      }

      return;
    }

    const command = this.slashItems[index];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private syncFileMenu(prefix: string): void {
    if (document.activeElement !== this.options.textarea) {
      this.close();
      return;
    }

    this.options.closeModelMenu();
    this.options.cancelSessionNameEdit();

    if (this.kind !== 'file' || prefix !== this.filePrefix) {
      this.kind = 'file';
      this.slashItems = [];
      this.memoryItems = [];
      this.memoryQuery = '';
      this.fileItems = [];
      this.filePrefix = prefix;
      this.fileLoading = true;
      this.activeIndex = 0;
      this.disablePointerHover();
      this.options.slashMenuElement?.scrollTo({ top: 0 });
      this.fileRequestId += 1;
      this.options.postMessage({
        type: 'requestFileSuggestions',
        id: String(this.fileRequestId),
        prefix
      });
    }

    this.renderFileMenu(prefix);
    this.openMenu();
  }

  private shouldShowSlashMenu(): boolean {
    const state = this.options.getState();

    if (state.busy || document.activeElement !== this.options.textarea) {
      return false;
    }

    const cursor = this.options.textarea.selectionStart;

    if (cursor !== this.options.textarea.selectionEnd) {
      return false;
    }

    const beforeCursor = this.options.textarea.value.slice(0, cursor);
    return beforeCursor.startsWith('/')
      && !Array.from(beforeCursor).some((character) => character.trim().length === 0);
  }

  private getMemoryCommandQuery(): string | undefined {
    const state = this.options.getState();

    if (state.busy || state.settings.values['tauren.backend'] !== 'kward' || document.activeElement !== this.options.textarea) {
      return undefined;
    }

    const cursor = this.options.textarea.selectionStart;

    if (cursor !== this.options.textarea.selectionEnd) {
      return undefined;
    }

    const beforeCursor = this.options.textarea.value.slice(0, cursor);
    const match = beforeCursor.match(/^\/memory(?:\s+(.*))?$/i);

    if (!match) {
      return undefined;
    }

    return (match[1] ?? '').toLowerCase();
  }

  private getSlashCommandQuery(): string {
    return this.options.textarea.value.slice(1, this.options.textarea.selectionStart).toLowerCase();
  }

  private getFilteredSlashCommands(query: string): SlashCommand[] {
    const commands = this.getAllSlashCommands();
    const scored = [];

    for (const command of commands) {
      if (!command || typeof command.name !== 'string') {
        continue;
      }

      const name = command.name.toLowerCase();
      const description = typeof command.description === 'string' ? command.description.toLowerCase() : '';
      const namePrefix = name.startsWith(query);
      const nameMatch = name.includes(query);
      const descriptionMatch = description.includes(query);

      if (!nameMatch && !descriptionMatch) {
        continue;
      }

      scored.push({
        command,
        score: namePrefix ? 0 : nameMatch ? 1 : 2
      });
    }

    return scored
      .sort((left, right) => left.score - right.score || getSlashCommandSourceRank(left.command.source) - getSlashCommandSourceRank(right.command.source) || left.command.name.localeCompare(right.command.name))
      .slice(0, 8)
      .map((item) => item.command);
  }

  private getAllSlashCommands(): SlashCommand[] {
    const state = this.options.getState();
    const backend = state.settings.values['tauren.backend'];
    const commands = webviewLocalSlashCommands.filter((command) => command.name !== 'memory' || backend === 'kward');
    const names = new Set([
      ...commands.map((command) => command.name),
      ...webviewHiddenLocalSlashCommandNames
    ]);

    if (Array.isArray(state.slashCommands)) {
      for (const command of state.slashCommands) {
        if (!command || typeof command.name !== 'string' || names.has(command.name)) {
          continue;
        }

        names.add(command.name);
        commands.push(command);
      }
    }

    return commands;
  }

  private syncMemoryMenu(query: string): void {
    if (this.kind !== 'memory' || query !== this.memoryQuery) {
      this.kind = 'memory';
      this.slashItems = [];
      this.fileItems = [];
      this.fileLoading = false;
      this.memoryQuery = query;
      this.activeIndex = 0;
      this.disablePointerHover();
      this.options.slashMenuElement?.scrollTo({ top: 0 });
    }

    this.memoryItems = this.getFilteredMemoryCommands(query);
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.memoryItems.length - 1));
    this.renderMemoryMenu(query);
    this.openMenu();
  }

  private getFilteredMemoryCommands(query: string): MemorySuggestion[] {
    const normalizedQuery = query.trim().toLowerCase();
    const scored = [];

    for (const option of webviewKwardMemoryCommandOptions) {
      const command = option.command.toLowerCase();
      const description = option.description.toLowerCase();
      const commandPrefix = command.startsWith(normalizedQuery);
      const commandMatch = command.includes(normalizedQuery);
      const descriptionMatch = description.includes(normalizedQuery);

      if (!commandMatch && !descriptionMatch) {
        continue;
      }

      scored.push({
        option,
        score: commandPrefix ? 0 : commandMatch ? 1 : 2
      });
    }

    return scored
      .sort((left, right) => left.score - right.score || left.option.command.localeCompare(right.option.command))
      .slice(0, 8)
      .map((item) => item.option);
  }

  private renderSlashMenu(query: string): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    const state = this.options.getState();
    slashMenuElement.replaceChildren();

    if (state.slashCommandsRefreshing && this.slashItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement('Loading commands...'));
      return;
    }

    if (this.slashItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(query ? 'No matching slash commands' : 'No slash commands available'));
      return;
    }

    for (let index = 0; index < this.slashItems.length; index += 1) {
      slashMenuElement.append(this.createSlashMenuItemElement(this.slashItems[index], index));
    }

    this.syncActiveDescendant();
  }

  private renderMemoryMenu(query: string): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    slashMenuElement.replaceChildren();

    if (this.memoryItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(query ? 'No matching memory commands' : 'No memory commands available'));
      return;
    }

    for (let index = 0; index < this.memoryItems.length; index += 1) {
      slashMenuElement.append(this.createMemorySuggestionItemElement(this.memoryItems[index], index));
    }

    this.syncActiveDescendant();
  }

  private renderFileMenu(prefix: string): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    slashMenuElement.replaceChildren();

    if (this.fileLoading && this.fileItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement('Finding files...'));
      return;
    }

    if (this.fileItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(prefix.length > 1 ? 'No matching files' : 'No files available'));
      return;
    }

    for (let index = 0; index < this.fileItems.length; index += 1) {
      slashMenuElement.append(this.createFileSuggestionItemElement(this.fileItems[index], index));
    }

    this.syncActiveDescendant();
  }

  private createSuggestionBaseElement(index: number): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = 'slash-command-' + index;
    item.className = 'composer__slash-item' + (index === this.activeIndex ? ' composer__slash-item--active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === this.activeIndex ? 'true' : 'false');
    item.setAttribute('data-index', String(index));
    return item;
  }

  private createFileSuggestionItemElement(file: FileSuggestion, index: number): HTMLElement {
    const item = this.createSuggestionBaseElement(index);

    const label = document.createElement('span');
    label.className = 'composer__slash-label';
    label.textContent = file.label;
    item.append(label);

    const source = document.createElement('span');
    source.className = 'composer__slash-source';
    source.textContent = file.directory ? 'dir' : 'file';
    item.append(source);

    if (file.description) {
      const description = document.createElement('span');
      description.className = 'composer__slash-description';
      description.textContent = file.description;
      item.append(description);
    }

    return item;
  }

  private createMemorySuggestionItemElement(command: MemorySuggestion, index: number): HTMLElement {
    const item = this.createSuggestionBaseElement(index);

    const label = document.createElement('span');
    label.className = 'composer__slash-label';
    label.textContent = '/memory ' + command.command;
    item.append(label);

    const source = document.createElement('span');
    source.className = 'composer__slash-source';
    source.textContent = 'memory';
    item.append(source);

    const description = document.createElement('span');
    description.className = 'composer__slash-description';
    description.textContent = command.description;
    item.append(description);

    return item;
  }

  private createSlashMenuItemElement(command: SlashCommand, index: number): HTMLElement {
    const item = this.createSuggestionBaseElement(index);

    const label = document.createElement('span');
    label.className = 'composer__slash-label';
    label.textContent = '/' + command.name;
    item.append(label);

    const meta = formatSlashCommandMeta(command);
    if (meta) {
      const source = document.createElement('span');
      source.className = 'composer__slash-source';
      source.textContent = meta;
      item.append(source);
    }

    if (command.description) {
      const description = document.createElement('span');
      description.className = 'composer__slash-description';
      description.textContent = command.description;
      item.append(description);
    }

    return item;
  }

  private openMenu(): void {
    if (!this.options.slashMenuElement) {
      return;
    }

    this.open = true;
    this.options.slashMenuElement.setAttribute('open', '');
    this.options.slashMenuElement.setAttribute('aria-label', this.kind === 'file' ? 'File suggestions' : this.kind === 'memory' ? 'Memory commands' : 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'true');
    this.syncActiveDescendant();
  }

  private moveSelection(delta: number): void {
    const itemCount = this.getActiveSuggestionCount();

    if (itemCount === 0) {
      return;
    }

    this.activeIndex = (this.activeIndex + delta + itemCount) % itemCount;

    if (this.kind === 'file') {
      this.renderFileMenu(this.filePrefix);
    } else if (this.kind === 'memory') {
      this.renderMemoryMenu(this.memoryQuery);
    } else {
      this.renderSlashMenu(this.getSlashCommandQuery());
    }
  }

  private enablePointerHover(): void {
    if (this.pointerHoverEnabled) {
      return;
    }

    this.pointerHoverEnabled = true;
    this.options.slashMenuElement?.classList.add('composer__slash-menu--pointer-hover');
  }

  private disablePointerHover(): void {
    if (!this.pointerHoverEnabled) {
      return;
    }

    this.pointerHoverEnabled = false;
    this.options.slashMenuElement?.classList.remove('composer__slash-menu--pointer-hover');
  }

  private updateRenderedSelection(previousIndex: number): void {
    this.updateRenderedItemSelection(previousIndex, false);
    this.updateRenderedItemSelection(this.activeIndex, true);
    this.syncActiveDescendant({ reveal: false });
  }

  private updateRenderedItemSelection(index: number, selected: boolean): void {
    const item = document.getElementById('slash-command-' + index);

    if (!item) {
      return;
    }

    item.classList.toggle('composer__slash-item--active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  }

  private syncActiveDescendant(options: { reveal?: boolean } = {}): void {
    if (!this.open || this.getActiveSuggestionCount() === 0) {
      this.options.textarea.removeAttribute('aria-activedescendant');
      return;
    }

    this.options.textarea.setAttribute('aria-activedescendant', 'slash-command-' + this.activeIndex);

    if (options.reveal !== false) {
      this.options.slashMenuElement?.querySelector('.composer__slash-item--active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private acceptActiveSuggestion(): void {
    if (this.kind === 'file') {
      const file = this.fileItems[this.activeIndex];

      if (file) {
        this.acceptFile(file);
      }

      return;
    }

    if (this.kind === 'memory') {
      const command = this.memoryItems[this.activeIndex];

      if (command) {
        this.acceptMemoryCommand(command);
      }

      return;
    }

    const command = this.slashItems[this.activeIndex];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private getActiveSuggestionCount(): number {
    return this.kind === 'file' ? this.fileItems.length : this.kind === 'memory' ? this.memoryItems.length : this.slashItems.length;
  }

  private acceptSlashCommand(command: SlashCommand): void {
    const cursor = this.options.textarea.selectionStart;
    const after = this.options.textarea.value.slice(cursor).trimStart();
    const value = '/' + command.name + ' ' + after;
    const nextCursor = command.name.length + 2;
    this.options.textarea.value = value;
    this.options.textarea.setSelectionRange(nextCursor, nextCursor);
    this.close();
    this.options.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private acceptMemoryCommand(command: MemorySuggestion): void {
    const cursor = this.options.textarea.selectionStart;
    const after = this.options.textarea.value.slice(cursor).trimStart();
    const insertText = command.insertText ?? command.command;
    const value = '/memory ' + insertText + ' ' + after;
    const nextCursor = insertText.length + 9;
    this.options.textarea.value = value;
    this.options.textarea.setSelectionRange(nextCursor, nextCursor);
    this.close();
    this.options.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private acceptFile(file: FileSuggestion): void {
    if (!acceptFileSuggestion(this.options.textarea, file)) {
      return;
    }

    this.close();
    this.options.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }
}

function getSlashCommandSourceRank(source: string): number {
  if (source === 'builtin') {
    return 0;
  }

  if (source === 'extension') {
    return 1;
  }

  if (source === 'prompt') {
    return 2;
  }

  if (source === 'skill') {
    return 3;
  }

  if (source === 'unsupported') {
    return 4;
  }

  return 5;
}

function createSlashMenuEmptyElement(text: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'composer__slash-empty';
  empty.textContent = text;
  return empty;
}

function formatSlashCommandMeta(command: SlashCommand): string {
  const source = typeof command.source === 'string' ? command.source : '';
  const location = typeof command.location === 'string' ? command.location : '';

  if (source && location) {
    return source + ' · ' + location;
  }

  return source || location;
}
