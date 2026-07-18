import {
  webviewHiddenLocalSlashCommandNames,
  webviewKwardLocalSlashCommands,
  webviewKwardMemoryCommandOptions,
  webviewLocalSlashCommands
} from '../constants';
import type { FileSuggestion, SlashCommand, WebviewState } from '../types';
import type { WebviewComposerCompletion, WebviewComposerCompletionCapabilities } from '../../webviewProtocol/types';
import { eventTargetElement } from '../dom';
import {
  acceptFileSuggestion,
  getFileSuggestionPrefixInfo,
  isFileSuggestionsResult
} from './fileSuggestions';

type PostMessage = (message: unknown) => void;
type SuggestionKind = 'slash' | 'file' | 'completion' | 'commandOption';
type CommandOptionSuggestion = { command: string; description: string; insertText?: string };
type CommandOptionProvider = { name: string; source: string; options: CommandOptionSuggestion[] };
type CommandOptionQuery = { provider: CommandOptionProvider; query: string };

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
  private commandOptionItems: CommandOptionSuggestion[] = [];
  private commandOptionQuery = '';
  private commandOptionProvider: CommandOptionProvider | undefined;
  private fileItems: FileSuggestion[] = [];
  private filePrefix = '';
  private fileRequestId = 0;
  private fileLoading = false;
  private completionItems: WebviewComposerCompletion[] = [];
  private completionRequestId = 0;
  private completionLoading = false;
  private completionText = '';
  private completionSelectionStart = 0;
  private completionSelectionEnd = 0;
  private completionRevision = 0;
  private completionCapabilities: WebviewComposerCompletionCapabilities = { triggerCharacters: [], generation: 0 };

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
    this.commandOptionItems = [];
    this.commandOptionQuery = '';
    this.commandOptionProvider = undefined;
    this.fileItems = [];
    this.filePrefix = '';
    this.fileLoading = false;
    this.completionItems = [];
    this.completionLoading = false;
    this.completionText = '';
    this.completionRevision += 1;
    this.disablePointerHover();
    this.options.slashMenuElement?.removeAttribute('open');
    this.options.slashMenuElement?.setAttribute('aria-label', 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'false');
    this.options.textarea.removeAttribute('aria-activedescendant');
  }

  public handleHostMessage(message: unknown): boolean {
    if (isComposerCompletionCapabilities(message)) {
      this.completionCapabilities = message;
      this.sync();
      return true;
    }

    if (isComposerCompletionsResult(message)) {
      if (message.id !== String(this.completionRequestId) || message.revision !== this.completionRevision || this.options.textarea.value !== this.completionText || this.options.textarea.selectionStart !== this.completionSelectionStart || this.options.textarea.selectionEnd !== this.completionSelectionEnd) {
        return true;
      }

      this.completionCapabilities = message.capabilities;
      this.completionLoading = false;
      this.completionItems = message.items;
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.completionItems.length - 1));
      this.renderCompletionMenu();
      this.openMenu();
      return true;
    }

    if (isComposerCompletionApplied(message)) {
      if (message.id !== String(this.completionRequestId) || message.revision !== this.completionRevision) {
        return true;
      }

      this.options.textarea.value = message.text;
      this.options.textarea.setSelectionRange(message.selectionStart, message.selectionEnd);
      this.close();
      this.options.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
      return true;
    }

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
    const completionPrefix = getComposerCompletionPrefix(this.options.textarea, this.completionCapabilities.triggerCharacters);
    if (completionPrefix) {
      this.syncCompletionMenu();
      return;
    }

    const filePrefix = getFileSuggestionPrefixInfo(this.options.textarea)?.prefix;
    if (filePrefix) {
      this.syncFileMenu(filePrefix);
      return;
    }

    const state = this.options.getState();
    const commandOptionQuery = this.getCommandOptionQuery();

    if (!this.shouldShowSlashMenu() && commandOptionQuery === undefined) {
      this.close();
      return;
    }

    this.options.closeModelMenu();
    this.options.cancelSessionNameEdit();

    if (commandOptionQuery !== undefined) {
      this.syncCommandOptionMenu(commandOptionQuery);
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
      this.commandOptionItems = [];
      this.commandOptionQuery = '';
      this.commandOptionProvider = undefined;
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

    if (this.kind === 'completion') {
      const item = this.completionItems[index];
      if (item) {
        this.acceptCompletion(item);
      }
      return;
    }

    if (this.kind === 'file') {
      const file = this.fileItems[index];

      if (file) {
        this.acceptFile(file);
      }

      return;
    }

    if (this.kind === 'commandOption') {
      const command = this.commandOptionItems[index];

      if (command) {
        this.acceptCommandOption(command);
      }

      return;
    }

    const command = this.slashItems[index];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private syncCompletionMenu(): void {
    if (document.activeElement !== this.options.textarea) {
      this.close();
      return;
    }

    this.options.closeModelMenu();
    this.options.cancelSessionNameEdit();
    const text = this.options.textarea.value;
    const selectionStart = this.options.textarea.selectionStart;
    const selectionEnd = this.options.textarea.selectionEnd;
    if (this.kind !== 'completion' || text !== this.completionText || selectionStart !== this.completionSelectionStart || selectionEnd !== this.completionSelectionEnd) {
      this.kind = 'completion';
      this.fileItems = [];
      this.completionItems = [];
      this.completionText = text;
      this.completionSelectionStart = selectionStart;
      this.completionSelectionEnd = selectionEnd;
      this.completionLoading = true;
      this.activeIndex = 0;
      this.completionRequestId += 1;
      this.completionRevision += 1;
      this.options.postMessage({
        type: 'requestComposerCompletions',
        id: String(this.completionRequestId),
        revision: this.completionRevision,
        text,
        selectionStart,
        selectionEnd
      });
    }
    this.renderCompletionMenu();
    this.openMenu();
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
      this.commandOptionItems = [];
      this.commandOptionQuery = '';
      this.commandOptionProvider = undefined;
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

  private getCommandOptionQuery(): CommandOptionQuery | undefined {
    const state = this.options.getState();

    if (state.busy || document.activeElement !== this.options.textarea) {
      return undefined;
    }

    const cursor = this.options.textarea.selectionStart;

    if (cursor !== this.options.textarea.selectionEnd) {
      return undefined;
    }

    const beforeCursor = this.options.textarea.value.slice(0, cursor);
    const match = beforeCursor.match(/^\/([^\s]*)(?:\s+(.*))?$/);

    if (!match) {
      return undefined;
    }

    const commandQuery = match[1].toLowerCase();

    if (!commandQuery) {
      return undefined;
    }

    const argQuery = (match[2] ?? '').toLowerCase();
    const matchingProviders = this.getCommandOptionProviders()
      .filter((provider) => provider.name.startsWith(commandQuery));

    if (matchingProviders.length !== 1) {
      return undefined;
    }

    const provider = matchingProviders[0];
    const matchingCommands = this.getAllSlashCommands()
      .filter((command) => command.name.toLowerCase().startsWith(commandQuery));

    if (matchingCommands.some((command) => command.name !== provider.name)) {
      return undefined;
    }

    return { provider, query: commandQuery === provider.name ? argQuery : '' };
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
    if (backend === 'kward') {
      commands.push(...webviewKwardLocalSlashCommands);
    }
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

  private syncCommandOptionMenu(optionQuery: CommandOptionQuery): void {
    const providerChanged = this.commandOptionProvider?.name !== optionQuery.provider.name;

    if (this.kind !== 'commandOption' || providerChanged || optionQuery.query !== this.commandOptionQuery) {
      this.kind = 'commandOption';
      this.slashItems = [];
      this.fileItems = [];
      this.fileLoading = false;
      this.commandOptionQuery = optionQuery.query;
      this.commandOptionProvider = optionQuery.provider;
      this.activeIndex = 0;
      this.disablePointerHover();
      this.options.slashMenuElement?.scrollTo({ top: 0 });
    }

    this.commandOptionItems = this.getFilteredCommandOptions(optionQuery.provider, optionQuery.query);
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.commandOptionItems.length - 1));
    this.renderCommandOptionMenu(optionQuery);
    this.openMenu();
  }

  private getFilteredCommandOptions(provider: CommandOptionProvider, query: string): CommandOptionSuggestion[] {
    const normalizedQuery = query.trim().toLowerCase();
    const scored = [];

    for (const option of provider.options) {
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

  private getCommandOptionProviders(): CommandOptionProvider[] {
    const state = this.options.getState();
    const providers: CommandOptionProvider[] = [];

    if (state.settings.values['tauren.backend'] === 'kward') {
      providers.push({ name: 'memory', source: 'memory', options: webviewKwardMemoryCommandOptions });
    }

    return providers;
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

  private renderCommandOptionMenu(optionQuery: CommandOptionQuery): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    slashMenuElement.replaceChildren();

    if (this.commandOptionItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(optionQuery.query ? `No matching ${optionQuery.provider.source} commands` : `No ${optionQuery.provider.source} commands available`));
      return;
    }

    for (let index = 0; index < this.commandOptionItems.length; index += 1) {
      slashMenuElement.append(this.createCommandOptionSuggestionItemElement(optionQuery.provider, this.commandOptionItems[index], index));
    }

    this.syncActiveDescendant();
  }

  private renderCompletionMenu(): void {
    const menu = this.options.slashMenuElement;
    if (!menu) {
      return;
    }
    menu.replaceChildren();
    if (this.completionLoading) {
      menu.append(createSlashMenuEmptyElement('Finding suggestions...'));
      return;
    }
    if (this.completionItems.length === 0) {
      menu.append(createSlashMenuEmptyElement('No matching suggestions'));
      return;
    }
    for (let index = 0; index < this.completionItems.length; index += 1) {
      const completion = this.completionItems[index];
      const item = this.createSuggestionBaseElement(index);
      const label = document.createElement('span');
      label.className = 'composer__slash-label';
      label.textContent = completion.label;
      item.append(label);
      if (completion.description) {
        const description = document.createElement('span');
        description.className = 'composer__slash-description';
        description.textContent = completion.description;
        item.append(description);
      }
      menu.append(item);
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

  private createCommandOptionSuggestionItemElement(provider: CommandOptionProvider, command: CommandOptionSuggestion, index: number): HTMLElement {
    const item = this.createSuggestionBaseElement(index);

    const label = document.createElement('span');
    label.className = 'composer__slash-label';
    label.textContent = '/' + provider.name + ' ' + command.command;
    item.append(label);

    const source = document.createElement('span');
    source.className = 'composer__slash-source';
    source.textContent = provider.source;
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
    this.options.slashMenuElement.setAttribute('aria-label', this.kind === 'completion' ? 'Suggestions' : this.kind === 'file' ? 'File suggestions' : this.kind === 'commandOption' ? 'Slash command options' : 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'true');
    this.syncActiveDescendant();
  }

  private moveSelection(delta: number): void {
    const itemCount = this.getActiveSuggestionCount();

    if (itemCount === 0) {
      return;
    }

    this.activeIndex = (this.activeIndex + delta + itemCount) % itemCount;

    if (this.kind === 'completion') {
      this.renderCompletionMenu();
    } else if (this.kind === 'file') {
      this.renderFileMenu(this.filePrefix);
    } else if (this.kind === 'commandOption' && this.commandOptionProvider) {
      this.renderCommandOptionMenu({ provider: this.commandOptionProvider, query: this.commandOptionQuery });
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
    if (this.kind === 'completion') {
      const item = this.completionItems[this.activeIndex];
      if (item) {
        this.acceptCompletion(item);
      }
      return;
    }

    if (this.kind === 'file') {
      const file = this.fileItems[this.activeIndex];

      if (file) {
        this.acceptFile(file);
      }

      return;
    }

    if (this.kind === 'commandOption') {
      const command = this.commandOptionItems[this.activeIndex];

      if (command) {
        this.acceptCommandOption(command);
      }

      return;
    }

    const command = this.slashItems[this.activeIndex];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private getActiveSuggestionCount(): number {
    return this.kind === 'completion' ? this.completionItems.length : this.kind === 'file' ? this.fileItems.length : this.kind === 'commandOption' ? this.commandOptionItems.length : this.slashItems.length;
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

  private acceptCommandOption(command: CommandOptionSuggestion): void {
    const provider = this.commandOptionProvider;

    if (!provider) {
      return;
    }

    const cursor = this.options.textarea.selectionStart;
    const after = this.options.textarea.value.slice(cursor).trimStart();
    const insertText = command.insertText ?? command.command;
    const value = '/' + provider.name + ' ' + insertText + ' ' + after;
    const nextCursor = provider.name.length + insertText.length + 3;
    this.options.textarea.value = value;
    this.options.textarea.setSelectionRange(nextCursor, nextCursor);
    this.close();
    this.options.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private acceptCompletion(item: WebviewComposerCompletion): void {
    this.options.postMessage({ type: 'applyComposerCompletion', id: String(this.completionRequestId), revision: this.completionRevision, itemId: item.id });
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

function getComposerCompletionPrefix(textarea: HTMLTextAreaElement, triggerCharacters: string[]): string | undefined {
  if (textarea.selectionStart !== textarea.selectionEnd) {
    return undefined;
  }
  const beforeCursor = textarea.value.slice(0, textarea.selectionStart);
  const triggerSet = new Set(triggerCharacters);
  for (let index = beforeCursor.length - 1; index >= 0; index -= 1) {
    const character = beforeCursor[index] ?? '';
    if (triggerSet.has(character)) {
      const beforeTrigger = beforeCursor[index - 1];
      if (index === 0 || beforeTrigger === undefined || /[\s='\"]/.test(beforeTrigger)) {
        return beforeCursor.slice(index);
      }
      return undefined;
    }
    if (/[\s]/.test(character)) {
      return undefined;
    }
  }
  return undefined;
}

function isComposerCompletionsResult(value: unknown): value is { type: 'composerCompletionsResult'; id: string; revision: number; items: WebviewComposerCompletion[]; capabilities: WebviewComposerCompletionCapabilities } {
  return isRecord(value) && value.type === 'composerCompletionsResult' && typeof value.id === 'string' && typeof value.revision === 'number' && Number.isInteger(value.revision) && isComposerCompletionCapabilities(value.capabilities) && Array.isArray(value.items) && value.items.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.value === 'string' && typeof item.label === 'string' && (item.description === undefined || typeof item.description === 'string'));
}

function isComposerCompletionCapabilities(value: unknown): value is WebviewComposerCompletionCapabilities & { type: 'composerCompletionCapabilities' } {
  return isRecord(value) && value.type === 'composerCompletionCapabilities' && typeof value.generation === 'number' && Number.isInteger(value.generation) && Array.isArray(value.triggerCharacters) && value.triggerCharacters.every((character) => typeof character === 'string' && Array.from(character).length === 1);
}

function isComposerCompletionApplied(value: unknown): value is { type: 'composerCompletionApplied'; id: string; revision: number; text: string; selectionStart: number; selectionEnd: number } {
  return isRecord(value) && value.type === 'composerCompletionApplied' && typeof value.id === 'string' && typeof value.revision === 'number' && Number.isInteger(value.revision) && typeof value.text === 'string' && typeof value.selectionStart === 'number' && typeof value.selectionEnd === 'number' && Number.isInteger(value.selectionStart) && Number.isInteger(value.selectionEnd) && value.selectionStart >= 0 && value.selectionEnd >= 0 && value.selectionStart <= value.text.length && value.selectionEnd <= value.text.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
