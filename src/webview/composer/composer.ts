import { createDiffCounter, formatDiffLineCount, normalizeDiffLineCount, updateDiffCounter } from '../diffCounter';
import {
  localSlashCommands,
  maxTextareaHeight,
  minTextareaHeight
} from '../constants';
import type {
  PromptContextAttachment,
  SlashCommand,
  WebviewState,
  WebviewStreamingBehavior
} from '../types';

type PostMessage = (message: unknown) => void;

export type ComposerControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  refreshMetadata: () => void;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  newSessionButton: HTMLButtonElement;
  busySubmitElement: HTMLElement | undefined;
  diffSummaryElement: HTMLElement;
  diffAddedElement: HTMLElement;
  diffRemovedElement: HTMLElement;
  streamingBehaviorButtonElements: HTMLButtonElement[];
  slashMenuElement: HTMLElement | undefined;
  contextBadgesElement: HTMLElement | undefined;
  contextElement: HTMLElement;
  contextValueElement: HTMLElement;
  contextTooltipElement: HTMLElement;
  modelElement: HTMLButtonElement;
  modelMenuElement: HTMLElement | undefined;
  modelSelectElement: HTMLSelectElement;
  thinkingSelectElement: HTMLSelectElement;
  focusPromptInput: () => void;
  cancelSessionNameEdit: () => void;
  closeSessionCommandMenu: () => void;
  isMessagesAtBottom: () => boolean;
  scrollMessagesToBottom: () => void;
};

export class ComposerController {
  private appliedComposerTextRevision = 0;
  private slashMenuOpen = false;
  private slashMenuActiveIndex = 0;
  private slashMenuItems: SlashCommand[] = [];
  private slashMenuQuery = '';
  private slashMenuDismissedQuery: string | undefined;
  private slashCommandsRefreshRequested = false;
  private streamingBehavior: WebviewStreamingBehavior = 'steer';
  private busySubmitHideTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly addedDiffCounter: ReturnType<typeof createDiffCounter>;
  private readonly removedDiffCounter: ReturnType<typeof createDiffCounter>;

  public constructor(private readonly options: ComposerControllerOptions) {
    this.addedDiffCounter = createDiffCounter(options.diffAddedElement, '+');
    this.removedDiffCounter = createDiffCounter(options.diffRemovedElement, '-');
  }

  public attachEventListeners(): void {
    this.options.form.addEventListener('submit', (event) => this.handleSubmit(event));
    this.options.submitButton.addEventListener('click', (event) => this.handleSubmitButtonClick(event));

    for (const button of this.options.streamingBehaviorButtonElements) {
      button.addEventListener('click', () => this.selectStreamingBehavior(button));
    }

    this.options.modelElement.addEventListener('click', () => this.toggleModelMenu());
    this.options.modelSelectElement.addEventListener('change', () => this.selectModel());
    this.options.thinkingSelectElement.addEventListener('change', () => this.selectThinkingLevel());

    this.options.textarea.addEventListener('keydown', (event) => {
      if (this.handleSlashMenuKeydown(event)) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.options.form.requestSubmit();
      }
    });

    this.options.textarea.addEventListener('input', () => {
      this.slashMenuDismissedQuery = undefined;
      this.syncComposer({ preserveBottom: true });
      this.syncSlashMenu();
    });

    this.options.textarea.addEventListener('click', () => this.syncSlashMenu());
    this.options.textarea.addEventListener('blur', () => this.closeSlashMenu());
    this.options.textarea.addEventListener('keyup', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        this.syncSlashMenu();
      }
    });

    this.options.slashMenuElement?.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    this.options.slashMenuElement?.addEventListener('click', (event) => {
      const item = eventTargetElement(event)?.closest('.composer__slash-item');

      if (!item) {
        return;
      }

      const index = Number(item.getAttribute('data-index'));
      const command = this.slashMenuItems[index];

      if (command) {
        this.acceptSlashCommand(command);
      }
    });

    this.options.contextBadgesElement?.addEventListener('mousedown', (event) => {
      if (eventTargetElement(event)?.closest('.composer__context-remove')) {
        event.preventDefault();
      }
    });

    this.options.contextBadgesElement?.addEventListener('click', (event) => {
      const removeButton = eventTargetElement(event)?.closest('.composer__context-remove');

      if (!removeButton) {
        return;
      }

      const id = removeButton.getAttribute('data-context-id');

      if (!id) {
        return;
      }

      this.options.postMessage({ type: 'removePromptContext', id });
      this.options.focusPromptInput();
    });
  }

  public handleWindowClick(target: Node | null): void {
    if (this.options.modelMenuElement?.hasAttribute('open')) {
      if (!this.options.modelMenuElement.contains(target) && !this.options.modelElement.contains(target)) {
        this.closeModelMenu();
      }
    }

    if (this.slashMenuOpen) {
      if (!this.options.slashMenuElement?.contains(target) && target !== this.options.textarea) {
        this.closeSlashMenu();
      }
    }
  }

  public hasSlashMenuOpen(): boolean {
    return this.slashMenuOpen;
  }

  public hasModelMenuOpen(): boolean {
    return this.options.modelMenuElement?.hasAttribute('open') ?? false;
  }

  public dismissSlashMenu(): void {
    this.slashMenuDismissedQuery = this.getSlashCommandQuery();
    this.closeSlashMenu();
  }

  public closeSlashMenu(): void {
    this.slashMenuOpen = false;
    this.slashCommandsRefreshRequested = false;
    this.slashMenuItems = [];
    this.slashMenuActiveIndex = 0;
    this.slashMenuQuery = '';
    this.options.slashMenuElement?.removeAttribute('open');
    this.options.textarea.setAttribute('aria-expanded', 'false');
    this.options.textarea.removeAttribute('aria-activedescendant');
  }

  public closeModelMenu(): void {
    this.options.modelMenuElement?.removeAttribute('open');
    this.options.modelElement.setAttribute('aria-expanded', 'false');
  }

  public syncPromptContextBadges(): void {
    if (!this.options.contextBadgesElement) {
      return;
    }

    const state = this.options.getState();
    const attachments = Array.isArray(state.promptContext)
      ? state.promptContext.filter(isPromptContextAttachment)
      : [];
    this.options.form.classList.toggle('composer--has-context', attachments.length > 0);
    this.options.contextBadgesElement.hidden = attachments.length === 0;
    this.options.contextBadgesElement.replaceChildren();

    for (const attachment of attachments) {
      const badge = document.createElement('span');
      badge.className = 'composer__context-badge';
      badge.title = attachment.title || attachment.label;

      const label = document.createElement('span');
      label.className = 'composer__context-label';
      label.textContent = attachment.label;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'composer__context-remove';
      remove.setAttribute('data-context-id', attachment.id);
      remove.setAttribute('aria-label', 'Remove context ' + attachment.label);
      remove.title = 'Remove context';
      remove.textContent = '×';

      badge.append(label, remove);
      this.options.contextBadgesElement.append(badge);
    }
  }

  public syncModelLabel(): void {
    const state = this.options.getState();
    this.options.contextValueElement.textContent = state.contextUsageLabel;
    this.options.contextTooltipElement.textContent = state.contextUsageTitle;
    this.options.contextElement.title = state.contextUsageTitle;
    this.options.contextElement.className = 'composer__context' + (state.contextUsageLevel ? ' composer__context--' + state.contextUsageLevel : '');
    this.options.contextElement.hidden = state.contextUsageLabel.length === 0;

    const label = state.modelLabel || 'Select model';
    this.options.modelElement.textContent = label;
    this.options.modelElement.className = 'composer__model';
    this.options.modelElement.title = state.metadataRefreshing
      ? label + ' (refreshing...)'
      : state.modelOptions.length === 0 && !state.busy
      ? 'Load model settings'
      : label;
    this.options.modelElement.disabled = state.busy;
    this.options.modelElement.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');
    this.options.modelMenuElement?.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');

    this.syncModelSelect();
    this.syncThinkingSelect();
  }

  public applyComposerTextFromState(): void {
    const state = this.options.getState();

    if (state.composerTextRevision <= this.appliedComposerTextRevision) {
      return;
    }

    this.appliedComposerTextRevision = state.composerTextRevision;
    this.options.textarea.value = state.composerText;
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  public syncComposer(options: { preserveBottom?: boolean } = {}): void {
    const shouldPreserveBottom = Boolean(options.preserveBottom) && this.options.isMessagesAtBottom();
    this.syncSubmit();
    this.syncBusySubmitMode();
    this.syncTextareaHeight();

    if (shouldPreserveBottom) {
      this.options.scrollMessagesToBottom();
    }
  }

  public syncSlashMenu(): void {
    const state = this.options.getState();

    if (!this.shouldShowSlashMenu()) {
      this.closeSlashMenu();
      return;
    }

    this.closeModelMenu();
    this.options.cancelSessionNameEdit();
    if (
      state.slashCommands.length === 0
      && !state.slashCommandsRefreshing
      && !this.slashCommandsRefreshRequested
    ) {
      this.slashCommandsRefreshRequested = true;
      this.options.postMessage({ type: 'refreshSlashCommands' });
    }

    const query = this.getSlashCommandQuery();
    if (query === this.slashMenuDismissedQuery) {
      this.closeSlashMenu();
      return;
    }

    if (query !== this.slashMenuQuery) {
      this.slashMenuQuery = query;
      this.slashMenuActiveIndex = 0;
      if (this.options.slashMenuElement) {
        this.options.slashMenuElement.scrollTop = 0;
      }
    }

    this.slashMenuItems = this.getFilteredSlashCommands(query);
    this.slashMenuActiveIndex = Math.min(this.slashMenuActiveIndex, Math.max(0, this.slashMenuItems.length - 1));
    this.renderSlashMenu(query);
    this.openSlashMenu();
  }

  public runSessionSlashCommand(command: 'fork' | 'clone' | 'compact' | 'reload' | 'export'): void {
    const state = this.options.getState();

    if (state.busy) {
      return;
    }

    this.closeSlashMenu();
    this.options.cancelSessionNameEdit();
    this.options.postMessage({ type: 'submit', text: '/' + command });
    this.options.focusPromptInput();
  }

  public isStopSubmitMode(): boolean {
    return this.options.getState().busy && this.options.textarea.value.length === 0;
  }

  private handleSubmit(event: SubmitEvent): void {
    const state = this.options.getState();
    event.preventDefault();
    const text = this.options.textarea.value.trim();

    if (!text) {
      return;
    }

    this.closeSlashMenu();
    this.options.cancelSessionNameEdit();
    this.options.postMessage(state.busy
      ? { type: 'submit', text, streamingBehavior: this.streamingBehavior }
      : { type: 'submit', text });
    this.options.textarea.value = '';
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private handleSubmitButtonClick(event: MouseEvent): void {
    if (!this.isStopSubmitMode()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.options.postMessage({ type: 'abort' });
    this.options.focusPromptInput();
  }

  private selectStreamingBehavior(button: HTMLButtonElement): void {
    const nextBehavior = button.getAttribute('data-streaming-behavior');

    if (nextBehavior === 'steer' || nextBehavior === 'followUp') {
      this.streamingBehavior = nextBehavior;
      this.syncComposer({ preserveBottom: true });
      this.options.focusPromptInput();
    }
  }

  private syncSubmit(): void {
    const state = this.options.getState();
    const isStopMode = this.isStopSubmitMode();
    const hasInput = this.options.textarea.value.length > 0;
    const hasSendableText = this.options.textarea.value.trim().length > 0;
    const label = this.getSubmitLabel(isStopMode);
    this.options.submitButton.disabled = state.busy ? (hasInput && !hasSendableText) : !hasSendableText;
    this.options.newSessionButton.disabled = false;
    this.options.submitButton.classList.toggle('composer__submit--stop', isStopMode);
    this.options.submitButton.setAttribute('aria-label', label);
    this.options.submitButton.title = label;
  }

  private getSubmitLabel(isStopMode: boolean): string {
    if (isStopMode) {
      return 'Stop current response';
    }

    if (this.options.getState().busy) {
      return this.streamingBehavior === 'followUp' ? 'Queue follow-up' : 'Steer current run';
    }

    return 'Send message';
  }

  private syncBusySubmitMode(): void {
    const state = this.options.getState();

    if (!this.options.busySubmitElement) {
      return;
    }

    const showDiffSummary = state.busy || this.hasWorkspaceDiffChanges();
    this.setBusySubmitVisible(showDiffSummary);
    this.syncDiffSummary();

    const streamingModesElement = this.options.streamingBehaviorButtonElements[0]?.parentElement as HTMLElement | undefined;
    if (streamingModesElement) {
      streamingModesElement.hidden = !state.busy;
    }

    if (!state.busy) {
      return;
    }

    for (const button of this.options.streamingBehaviorButtonElements) {
      const isActive = button.getAttribute('data-streaming-behavior') === this.streamingBehavior;
      button.classList.toggle('composer__mode-button--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  private syncDiffSummary(): void {
    const state = this.options.getState();
    const addedLines = normalizeDiffLineCount(state.workspaceDiffStats.addedLines);
    const removedLines = normalizeDiffLineCount(state.workspaceDiffStats.removedLines);

    updateDiffCounter(this.addedDiffCounter, addedLines);
    updateDiffCounter(this.removedDiffCounter, removedLines);
    this.options.diffSummaryElement.title = `Show session changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
  }

  private hasWorkspaceDiffChanges(): boolean {
    const state = this.options.getState();
    return state.workspaceDiffStats.addedLines > 0 || state.workspaceDiffStats.removedLines > 0;
  }

  private setBusySubmitVisible(visible: boolean): void {
    const busySubmitElement = this.options.busySubmitElement;

    if (!busySubmitElement) {
      return;
    }

    if (this.busySubmitHideTimeout) {
      clearTimeout(this.busySubmitHideTimeout);
      this.busySubmitHideTimeout = undefined;
    }

    if (visible) {
      busySubmitElement.hidden = false;
      requestAnimationFrame(() => {
        busySubmitElement.classList.add('composer__busy-submit--visible');
      });
      return;
    }

    busySubmitElement.classList.remove('composer__busy-submit--visible');
    this.busySubmitHideTimeout = setTimeout(() => {
      if (!this.options.getState().busy) {
        busySubmitElement.hidden = true;
      }
    }, 160);
  }

  private syncModelSelect(): void {
    const state = this.options.getState();
    const selectedValue = modelKey(state.modelProvider, state.modelId);
    const currentValue = this.options.modelSelectElement.value;
    const modelOptions = this.getDisplayModelOptions();
    this.options.modelSelectElement.replaceChildren();

    for (const model of modelOptions) {
      if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') {
        continue;
      }

      const option = document.createElement('option');
      option.value = modelKey(model.provider, model.id);
      option.textContent = model.name && model.name !== model.id
        ? model.name + ' (' + model.provider + '/' + model.id + ')'
        : model.provider + '/' + model.id;
      this.options.modelSelectElement.append(option);
    }

    this.options.modelSelectElement.value = selectedValue || currentValue;
    this.options.modelSelectElement.disabled = state.busy || modelOptions.length === 0;
  }

  private getDisplayModelOptions() {
    const state = this.options.getState();

    if (state.modelOptions.length > 0) {
      return state.modelOptions;
    }

    if (!state.modelProvider || !state.modelId) {
      return [];
    }

    return [{
      provider: state.modelProvider,
      id: state.modelId,
      name: state.modelLabel || state.modelId,
      reasoning: state.modelReasoning
    }];
  }

  private syncThinkingSelect(): void {
    const state = this.options.getState();
    this.options.thinkingSelectElement.value = state.thinkingLevel || 'medium';
    this.options.thinkingSelectElement.disabled = state.busy || !state.modelReasoning;
    this.options.thinkingSelectElement.title = state.modelReasoning
      ? 'Thinking mode'
      : 'The selected model does not advertise thinking support.';
  }

  private toggleModelMenu(): void {
    const state = this.options.getState();

    if (this.options.modelElement.disabled) {
      return;
    }

    if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
      this.options.refreshMetadata();
    }

    this.options.cancelSessionNameEdit();
    const open = !this.options.modelMenuElement?.hasAttribute('open');
    this.options.modelMenuElement?.toggleAttribute('open', open);
    this.options.modelElement.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private selectModel(): void {
    const state = this.options.getState();
    const [provider, modelId] = splitModelKey(this.options.modelSelectElement.value);

    if (!provider || !modelId || state.busy) {
      return;
    }

    this.closeModelMenu();
    this.options.postMessage({ type: 'setModel', provider, modelId });
  }

  private selectThinkingLevel(): void {
    const state = this.options.getState();
    const level = this.options.thinkingSelectElement.value;

    if (!level || state.busy || !state.modelReasoning) {
      return;
    }

    this.closeModelMenu();
    this.options.postMessage({ type: 'setThinkingLevel', level });
  }

  private handleSlashMenuKeydown(event: KeyboardEvent): boolean {
    if (!this.slashMenuOpen) {
      if (event.key === 'Escape') {
        this.dismissSlashMenu();
      }

      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSlashMenuSelection(1);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSlashMenuSelection(-1);
      return true;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.acceptActiveSlashCommand();
      return true;
    }

    if (event.key === 'Enter' && !event.shiftKey && this.slashMenuItems.length > 0) {
      event.preventDefault();
      this.acceptActiveSlashCommand();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissSlashMenu();
      return true;
    }

    return false;
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
    const commands = [...localSlashCommands];
    const names = new Set(commands.map((command) => command.name));

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

  private renderSlashMenu(query: string): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    const state = this.options.getState();
    slashMenuElement.replaceChildren();

    if (state.slashCommandsRefreshing && this.slashMenuItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement('Loading commands...'));
      return;
    }

    if (this.slashMenuItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(query ? 'No matching slash commands' : 'No slash commands available'));
      return;
    }

    for (let index = 0; index < this.slashMenuItems.length; index += 1) {
      slashMenuElement.append(this.createSlashMenuItemElement(this.slashMenuItems[index], index));
    }

    this.syncSlashMenuActiveDescendant();
  }

  private createSlashMenuItemElement(command: SlashCommand, index: number): HTMLElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = 'slash-command-' + index;
    item.className = 'composer__slash-item' + (index === this.slashMenuActiveIndex ? ' composer__slash-item--active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === this.slashMenuActiveIndex ? 'true' : 'false');
    item.setAttribute('data-index', String(index));

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

  private openSlashMenu(): void {
    if (!this.options.slashMenuElement) {
      return;
    }

    this.slashMenuOpen = true;
    this.options.slashMenuElement.setAttribute('open', '');
    this.options.textarea.setAttribute('aria-expanded', 'true');
    this.syncSlashMenuActiveDescendant();
  }

  private moveSlashMenuSelection(delta: number): void {
    if (this.slashMenuItems.length === 0) {
      return;
    }

    this.slashMenuActiveIndex = (this.slashMenuActiveIndex + delta + this.slashMenuItems.length) % this.slashMenuItems.length;
    this.renderSlashMenu(this.getSlashCommandQuery());
  }

  private syncSlashMenuActiveDescendant(): void {
    if (!this.slashMenuOpen || this.slashMenuItems.length === 0) {
      this.options.textarea.removeAttribute('aria-activedescendant');
      return;
    }

    this.options.textarea.setAttribute('aria-activedescendant', 'slash-command-' + this.slashMenuActiveIndex);
    this.options.slashMenuElement?.querySelector('.composer__slash-item--active')?.scrollIntoView({ block: 'nearest' });
  }

  private acceptActiveSlashCommand(): void {
    const command = this.slashMenuItems[this.slashMenuActiveIndex];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private acceptSlashCommand(command: SlashCommand): void {
    const cursor = this.options.textarea.selectionStart;
    const after = this.options.textarea.value.slice(cursor).trimStart();
    const value = '/' + command.name + ' ' + after;
    const nextCursor = command.name.length + 2;
    this.options.textarea.value = value;
    this.options.textarea.setSelectionRange(nextCursor, nextCursor);
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private syncTextareaHeight(): void {
    this.options.textarea.style.height = 'auto';

    const maxHeight = this.getMaxTextareaHeight();
    const nextHeight = Math.max(minTextareaHeight, Math.min(this.options.textarea.scrollHeight, maxHeight));
    this.options.textarea.style.height = nextHeight + 'px';
    this.options.textarea.style.overflowY = this.options.textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  private getMaxTextareaHeight(): number {
    const reservedMessagesHeight = getReservedMessagesHeight();
    const composerChromeHeight = this.getComposerChromeHeight();
    const availableHeight = window.innerHeight - reservedMessagesHeight - composerChromeHeight;
    return Math.max(minTextareaHeight, Math.min(maxTextareaHeight, availableHeight));
  }

  private getComposerChromeHeight(): number {
    const composerStyles = getComputedStyle(this.options.form);
    const composerMarginHeight = parseCssPixelValue(composerStyles.marginTop) + parseCssPixelValue(composerStyles.marginBottom);
    const composerHeight = this.options.form.getBoundingClientRect().height + composerMarginHeight;
    const textareaHeight = this.options.textarea.getBoundingClientRect().height;
    return Math.max(0, composerHeight - textareaHeight);
  }
}

function isPromptContextAttachment(value: unknown): value is PromptContextAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const attachment = value as Partial<PromptContextAttachment>;
  return typeof attachment.id === 'string'
    && typeof attachment.label === 'string'
    && typeof attachment.title === 'string';
}

function modelKey(provider: string, id: string): string {
  return provider + '/' + id;
}

function splitModelKey(value: string): [provider: string, id: string] {
  const slashIndex = value.indexOf('/');

  if (slashIndex <= 0) {
    return ['', ''];
  }

  return [value.slice(0, slashIndex), value.slice(slashIndex + 1)];
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

function getReservedMessagesHeight(): number {
  return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
}

function parseCssPixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}
