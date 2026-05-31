import {
  getPromptImageTooLargeMessage,
  getSupportedPromptImageMimeType,
  getUnsupportedPromptImageMessage,
  maxPromptImageBytes
} from '../../prompt/imageAttachments';
import { requestCodeHighlight } from '../codeHighlighting';
import { eventTargetElement, parseCssPixelValue } from '../dom';
import { getScopedModelPickerOptions } from '../scopedModels';
import { createDiffCounter, formatDiffLineCount, normalizeDiffLineCount, updateDiffCounter } from './diffCounter';
import { appendComposerText } from './appendText';
import { ComposerPasteBuffer } from './paste';
import {
  hiddenLocalSlashCommandNames,
  localSlashCommands,
  maxTextareaHeight,
  minTextareaHeight
} from '../constants';
import type {
  ModelOption,
  FileSuggestion,
  FileSuggestionsResult,
  PromptContextAttachment,
  PromptImageAttachment,
  SlashCommand,
  WebviewState,
  WebviewStreamingBehavior
} from '../types';
import { isRecord } from '../../shared/typeGuards';

type PostMessage = (message: unknown) => void;
type ComposerDragState = 'none' | 'neutral' | 'valid' | 'invalid';

export type ComposerControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  refreshMetadata: () => void;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
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
  private slashMenuPointerHoverEnabled = false;
  private slashMenuItems: SlashCommand[] = [];
  private slashMenuQuery = '';
  private slashMenuDismissedQuery: string | undefined;
  private slashCommandsRefreshRequested = false;
  private suggestionKind: 'slash' | 'file' | undefined;
  private fileSuggestionItems: FileSuggestion[] = [];
  private fileSuggestionPrefix = '';
  private fileSuggestionRequestId = 0;
  private fileSuggestionLoading = false;
  private streamingBehavior: WebviewStreamingBehavior = 'steer';
  private busySubmitHideTimeout: ReturnType<typeof setTimeout> | undefined;
  private composerDragDepth = 0;
  private modelSelectOptionsSignature = '';
  private textareaLayoutSignature = '';
  private readonly pasteBuffer = new ComposerPasteBuffer();
  private readonly addedDiffCounter: ReturnType<typeof createDiffCounter>;
  private readonly removedDiffCounter: ReturnType<typeof createDiffCounter>;

  public constructor(private readonly options: ComposerControllerOptions) {
    this.addedDiffCounter = createDiffCounter(options.diffAddedElement, '+');
    this.removedDiffCounter = createDiffCounter(options.diffRemovedElement, '-');
  }

  public attachEventListeners(): void {
    this.options.form.addEventListener('submit', (event) => this.handleSubmit(event));
    this.options.form.addEventListener('dragenter', (event) => this.handleComposerDragEnter(event));
    this.options.form.addEventListener('dragover', (event) => this.handleComposerDragOver(event));
    this.options.form.addEventListener('dragleave', (event) => this.handleComposerDragLeave(event));
    this.options.form.addEventListener('drop', (event) => {
      void this.handleComposerDrop(event);
    });
    this.options.textarea.addEventListener('paste', (event) => {
      void this.handleComposerPaste(event);
    });
    this.options.submitButton.addEventListener('click', (event) => this.handleSubmitButtonClick(event));
    this.options.attachButton.addEventListener('click', () => {
      this.options.postMessage({ type: 'selectPromptImages' });
      this.options.focusPromptInput();
    });

    for (const button of this.options.streamingBehaviorButtonElements) {
      button.addEventListener('click', () => this.selectStreamingBehavior(button));
    }

    this.options.modelElement.addEventListener('click', () => this.toggleModelMenu());
    this.options.modelMenuElement?.addEventListener('keydown', (event) => this.handleModelMenuKeydown(event), true);
    this.options.modelSelectElement.addEventListener('change', () => this.selectModel());
    this.options.thinkingSelectElement.addEventListener('change', () => this.selectThinkingLevel());

    window.addEventListener('resize', () => this.syncPromptContextBadgeOverflow());

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

    this.options.slashMenuElement?.addEventListener('pointermove', (event) => this.handleSlashMenuPointerMove(event));

    this.options.slashMenuElement?.addEventListener('click', (event) => {
      const item = eventTargetElement(event)?.closest('.composer__slash-item');

      if (!item) {
        return;
      }

      const index = Number(item.getAttribute('data-index'));

      if (this.suggestionKind === 'file') {
        const file = this.fileSuggestionItems[index];

        if (file) {
          this.acceptFileSuggestion(file);
        }

        return;
      }

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

      const contextId = removeButton.getAttribute('data-context-id');
      const imageId = removeButton.getAttribute('data-image-id');

      if (contextId) {
        this.options.postMessage({ type: 'removePromptContext', id: contextId });
      } else if (imageId) {
        this.options.postMessage({ type: 'removePromptImage', id: imageId });
      } else {
        return;
      }

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
    this.slashMenuDismissedQuery = this.suggestionKind === 'slash' ? this.getSlashCommandQuery() : undefined;
    this.closeSlashMenu();
  }

  public closeSlashMenu(): void {
    this.slashMenuOpen = false;
    this.slashCommandsRefreshRequested = false;
    this.slashMenuItems = [];
    this.slashMenuActiveIndex = 0;
    this.slashMenuQuery = '';
    this.suggestionKind = undefined;
    this.fileSuggestionItems = [];
    this.fileSuggestionPrefix = '';
    this.fileSuggestionLoading = false;
    this.disableSlashMenuPointerHover();
    this.options.slashMenuElement?.removeAttribute('open');
    this.options.slashMenuElement?.setAttribute('aria-label', 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'false');
    this.options.textarea.removeAttribute('aria-activedescendant');
  }

  public handleHostMessage(message: unknown): boolean {
    if (!isFileSuggestionsResult(message)) {
      return false;
    }

    if (message.id !== String(this.fileSuggestionRequestId) || message.prefix !== this.fileSuggestionPrefix) {
      return true;
    }

    const activePrefix = this.getFileSuggestionPrefixInfo()?.prefix;

    if (activePrefix !== message.prefix) {
      return true;
    }

    this.fileSuggestionLoading = false;
    this.fileSuggestionItems = message.items;
    this.slashMenuActiveIndex = Math.min(this.slashMenuActiveIndex, Math.max(0, this.fileSuggestionItems.length - 1));
    this.renderFileSuggestionMenu(message.prefix);
    this.openSlashMenu();
    return true;
  }

  public closeModelMenu(): void {
    this.options.modelMenuElement?.removeAttribute('open');
    this.options.modelElement.setAttribute('aria-expanded', 'false');
  }

  public openModelPicker(): void {
    if (this.options.modelElement.disabled) {
      return;
    }

    this.openModelMenu();
    this.focusModelPickerControl(1);
  }

  public syncPromptContextBadges(): void {
    if (!this.options.contextBadgesElement) {
      return;
    }

    const attachments = this.getPromptContextAttachments();
    const images = this.getPromptImageAttachments();
    const hasAttachments = attachments.length > 0 || images.length > 0;
    this.options.form.classList.toggle('composer--has-context', hasAttachments);
    this.options.contextBadgesElement.hidden = !hasAttachments;
    this.options.contextBadgesElement.replaceChildren();

    for (const attachment of attachments) {
      const badge = document.createElement('span');
      badge.className = 'composer__context-badge';
      badge.classList.toggle('composer__context-badge--origin', attachment.source === 'origin');

      const badgeLabel = attachment.source === 'origin'
        ? attachment.label
        : 'Context: ' + attachment.label;
      badge.dataset.overflowLabel = badgeLabel;
      badge.dataset.overflowTitle = attachment.title || badgeLabel;

      const label = document.createElement('span');
      label.className = 'composer__context-label';
      label.textContent = badgeLabel;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'composer__context-remove';
      remove.setAttribute('data-context-id', attachment.id);
      remove.setAttribute('aria-label', 'Remove context ' + attachment.label);
      remove.textContent = '×';

      const tooltip = document.createElement('span');
      tooltip.className = 'composer__context-badge-tooltip';
      const tooltipCode = attachment.xml || badgeLabel;
      const tooltipPre = document.createElement('pre');
      const tooltipCodeElement = document.createElement('code');
      tooltipCodeElement.className = 'language-xml';
      tooltipCodeElement.textContent = tooltipCode;
      tooltipPre.append(tooltipCodeElement);
      tooltip.append(tooltipPre);
      requestCodeHighlight(tooltipCodeElement, tooltipCode, 'xml');

      badge.append(label, remove, tooltip);
      this.options.contextBadgesElement.append(badge);
    }

    for (const image of images) {
      const badge = document.createElement('span');
      badge.className = 'composer__context-badge composer__context-badge--image';
      badge.dataset.overflowLabel = 'Image: ' + image.label;
      badge.dataset.overflowTitle = image.title || image.label;

      const label = document.createElement('span');
      label.className = 'composer__context-label';
      label.textContent = 'Image: ' + image.label;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'composer__context-remove';
      remove.setAttribute('data-image-id', image.id);
      remove.setAttribute('aria-label', 'Remove image ' + image.label);
      remove.textContent = '×';

      const tooltip = document.createElement('span');
      tooltip.className = 'composer__context-badge-tooltip';
      const tooltipPre = document.createElement('pre');
      const tooltipCodeElement = document.createElement('code');
      tooltipCodeElement.textContent = `${image.title}\n${image.mimeType}, ${formatBytes(image.sizeBytes)}`;
      tooltipPre.append(tooltipCodeElement);
      tooltip.append(tooltipPre);

      badge.append(label, remove, tooltip);
      this.options.contextBadgesElement.append(badge);
    }

    this.syncPromptContextBadgeOverflow();
  }

  private syncPromptContextBadgeOverflow(): void {
    const container = this.options.contextBadgesElement;

    if (!container || container.hidden) {
      return;
    }

    container.querySelector<HTMLElement>('.composer__context-badge--overflow')?.remove();

    const badges = Array.from(container.querySelectorAll<HTMLElement>('.composer__context-badge'));

    for (const badge of badges) {
      badge.hidden = false;
    }

    if (badges.length === 0) {
      return;
    }

    for (const badge of getContextBadgesPastSecondRow(badges)) {
      badge.hidden = true;
    }

    let hiddenBadges = badges.filter((badge) => badge.hidden);

    if (hiddenBadges.length === 0) {
      return;
    }

    const overflowBadge = createContextOverflowBadge();
    container.append(overflowBadge);
    updateContextOverflowBadge(overflowBadge, hiddenBadges);

    while (getContextBadgeRowIndex(overflowBadge) > 1) {
      const visibleBadges = badges.filter((badge) => !badge.hidden);
      const badgeToHide = visibleBadges[visibleBadges.length - 1];

      if (!badgeToHide) {
        break;
      }

      badgeToHide.hidden = true;
      hiddenBadges = badges.filter((badge) => badge.hidden);
      updateContextOverflowBadge(overflowBadge, hiddenBadges);
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
    const modelTooltip = state.metadataRefreshing
      ? label + ' (refreshing...)'
      : state.modelOptions.length === 0 && !state.busy
      ? 'Load model settings'
      : label;
    const modelLabel = document.createElement('span');
    modelLabel.className = 'composer__model-label';
    modelLabel.textContent = label;
    const tooltip = createTooltipElement(modelTooltip);
    this.options.modelElement.replaceChildren(modelLabel, tooltip);
    this.options.modelElement.className = 'composer__model';
    this.options.modelElement.setAttribute('aria-label', modelTooltip);
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

    if (state.composerTextMode === 'append') {
      const result = appendComposerText(this.options.textarea.value, state.composerText);
      this.options.textarea.value = result.text;
      this.options.textarea.selectionStart = result.cursor;
      this.options.textarea.selectionEnd = result.cursor;
      this.revealTextareaEnd();
    } else {
      this.options.textarea.value = state.composerText;
    }

    this.pasteBuffer.clear();
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });

    if (state.composerTextMode === 'append') {
      this.revealTextareaEnd();
    }

    this.options.focusPromptInput();
  }

  private revealTextareaEnd(): void {
    const textarea = this.options.textarea;
    textarea.scrollTop = textarea.scrollHeight;
    requestAnimationFrame(() => {
      textarea.scrollTop = textarea.scrollHeight;
    });
  }

  public pasteToEditor(text: string): void {
    const textarea = this.options.textarea;
    const result = this.pasteBuffer.paste(
      textarea.value,
      text,
      textarea.selectionStart,
      textarea.selectionEnd
    );

    textarea.value = result.text;
    textarea.selectionStart = result.cursor;
    textarea.selectionEnd = result.cursor;
    this.slashMenuDismissedQuery = undefined;
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  public syncComposer(options: { preserveBottom?: boolean; forceResize?: boolean } = {}): void {
    const shouldPreserveBottom = Boolean(options.preserveBottom) && this.options.isMessagesAtBottom();
    this.syncSubmit();
    this.syncBusySubmitMode();
    this.syncTextareaHeightIfNeeded(Boolean(options.forceResize));

    if (shouldPreserveBottom) {
      this.options.scrollMessagesToBottom();
    }
  }

  public syncSlashMenu(): void {
    const filePrefix = this.getFileSuggestionPrefixInfo()?.prefix;

    if (filePrefix) {
      this.syncFileSuggestionMenu(filePrefix);
      return;
    }

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

    if (this.suggestionKind !== 'slash' || query !== this.slashMenuQuery) {
      this.suggestionKind = 'slash';
      this.fileSuggestionItems = [];
      this.fileSuggestionLoading = false;
      this.slashMenuQuery = query;
      this.slashMenuActiveIndex = 0;
      this.disableSlashMenuPointerHover();
      if (this.options.slashMenuElement) {
        this.options.slashMenuElement.scrollTop = 0;
      }
    }

    this.slashMenuItems = this.getFilteredSlashCommands(query);
    this.slashMenuActiveIndex = Math.min(this.slashMenuActiveIndex, Math.max(0, this.slashMenuItems.length - 1));
    this.renderSlashMenu(query);
    this.openSlashMenu();
  }

  public toggleStreamingBehavior(): void {
    if (!this.options.getState().busy) {
      return;
    }

    this.streamingBehavior = this.streamingBehavior === 'steer' ? 'followUp' : 'steer';
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  public handlePromptEscape(): boolean {
    if (document.activeElement !== this.options.textarea) {
      return false;
    }

    if (this.options.textarea.value.length > 0) {
      this.options.textarea.value = '';
      this.pasteBuffer.clear();
      this.slashMenuDismissedQuery = undefined;
      this.closeSlashMenu();
      this.syncComposer({ preserveBottom: true });
      return true;
    }

    const attachments = this.getPromptContextAttachments();
    const images = this.getPromptImageAttachments();

    if (attachments.length === 0 && images.length === 0) {
      return false;
    }

    for (const attachment of attachments) {
      this.options.postMessage({ type: 'removePromptContext', id: attachment.id });
    }

    for (const image of images) {
      this.options.postMessage({ type: 'removePromptImage', id: image.id });
    }

    return true;
  }

  public isStopSubmitMode(): boolean {
    return this.options.getState().busy && this.options.textarea.value.length === 0;
  }

  private handleComposerDragEnter(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.composerDragDepth += 1;
    this.syncComposerDragState(classifyComposerDragState(event.dataTransfer));
  }

  private handleComposerDragOver(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    this.syncComposerDragState(classifyComposerDragState(event.dataTransfer));
  }

  private handleComposerDragLeave(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.composerDragDepth = Math.max(0, this.composerDragDepth - 1);

    if (this.composerDragDepth === 0) {
      this.syncComposerDragState('none');
    }
  }

  private async handleComposerDrop(event: DragEvent): Promise<void> {
    if (!event.dataTransfer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.composerDragDepth = 0;
    this.syncComposerDragState('none');

    const message = await createDroppedPromptImagesMessage(event.dataTransfer);

    if (message) {
      this.options.postMessage(message);
    }

    this.options.focusPromptInput();
  }

  private async handleComposerPaste(event: ClipboardEvent): Promise<void> {
    if (!event.clipboardData) {
      return;
    }

    const files = getPastedPromptImageFiles(event.clipboardData);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rejections = getPromptImageFileRejections(files);

    if (rejections.length > 0) {
      this.options.postMessage({ type: 'dropPromptImages', files: [], uris: [], rejections });
      this.options.focusPromptInput();
      return;
    }

    const message = await createPromptImagesMessageFromFiles(files);

    if (message) {
      this.options.postMessage(message);
    }

    this.options.focusPromptInput();
  }

  private syncComposerDragState(state: ComposerDragState): void {
    this.options.form.classList.toggle('composer--drag-over', state !== 'none');
    this.options.form.classList.toggle('composer--drag-neutral', state === 'neutral');
    this.options.form.classList.toggle('composer--drag-valid', state === 'valid');
    this.options.form.classList.toggle('composer--drag-invalid', state === 'invalid');
  }

  private getPromptContextAttachments(): PromptContextAttachment[] {
    const state = this.options.getState();
    return Array.isArray(state.promptContext)
      ? state.promptContext.filter(isPromptContextAttachment)
      : [];
  }

  private getPromptImageAttachments(): PromptImageAttachment[] {
    const state = this.options.getState();
    return Array.isArray(state.promptImages)
      ? state.promptImages.filter(isPromptImageAttachment)
      : [];
  }

  private handleSubmit(event: SubmitEvent): void {
    const state = this.options.getState();
    event.preventDefault();
    const text = this.pasteBuffer.expand(this.options.textarea.value).trim();

    if (!text) {
      return;
    }

    this.closeSlashMenu();
    this.options.cancelSessionNameEdit();
    this.options.postMessage(state.busy
      ? { type: 'submit', text, streamingBehavior: this.streamingBehavior }
      : { type: 'submit', text });
    this.options.textarea.value = '';
    this.pasteBuffer.clear();
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
    setTooltipText(this.options.submitButton, label);
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

    updateDiffCounter(this.addedDiffCounter, addedLines, state.animationsEnabled);
    updateDiffCounter(this.removedDiffCounter, removedLines, state.animationsEnabled);
    const label = `Show session changes: +${formatDiffLineCount(addedLines)} | -${formatDiffLineCount(removedLines)}`;
    this.options.diffSummaryElement.setAttribute('aria-label', label);
    setTooltipText(this.options.diffSummaryElement, label);
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
    const nextOptionsSignature = getModelOptionsSignature(modelOptions);

    if (nextOptionsSignature !== this.modelSelectOptionsSignature) {
      this.modelSelectOptionsSignature = nextOptionsSignature;
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
    }

    this.options.modelSelectElement.value = selectedValue || currentValue;
    this.options.modelSelectElement.disabled = state.busy || modelOptions.length === 0;
  }

  private getDisplayModelOptions() {
    const state = this.options.getState();

    if (state.modelOptions.length > 0) {
      return getScopedModelPickerOptions(state);
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
    if (this.options.modelElement.disabled) {
      return;
    }

    const open = !this.options.modelMenuElement?.hasAttribute('open');

    if (open) {
      this.openModelMenu();
    } else {
      this.closeModelMenu();
    }
  }

  private openModelMenu(): void {
    const state = this.options.getState();

    if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
      this.options.refreshMetadata();
    }

    this.closeSlashMenu();
    this.options.cancelSessionNameEdit();
    this.options.modelMenuElement?.setAttribute('open', '');
    this.options.modelElement.setAttribute('aria-expanded', 'true');
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

  private handleModelMenuKeydown(event: KeyboardEvent): void {
    if (!this.hasModelMenuOpen()) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.focusModelPickerControl(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      this.focusModelPickerControl(event.key === 'End' ? -1 : 1, true);
    }
  }

  private focusModelPickerControl(direction: 1 | -1, edge = false): void {
    const controls = this.getEnabledModelPickerControls();

    if (controls.length === 0) {
      this.options.modelElement.focus({ preventScroll: true });
      return;
    }

    const activeIndex = controls.findIndex((control) => control === document.activeElement);
    const nextIndex = edge || activeIndex === -1
      ? direction === 1 ? 0 : controls.length - 1
      : (activeIndex + direction + controls.length) % controls.length;

    requestAnimationFrame(() => controls[nextIndex]?.focus({ preventScroll: true }));
  }

  private getEnabledModelPickerControls(): HTMLSelectElement[] {
    return [this.options.thinkingSelectElement, this.options.modelSelectElement]
      .filter((control) => !control.disabled);
  }

  private handleSlashMenuKeydown(event: KeyboardEvent): boolean {
    if (!this.slashMenuOpen) {
      if (event.key === 'Escape') {
        this.dismissSlashMenu();
      }

      return false;
    }

    this.disableSlashMenuPointerHover();

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

  private syncFileSuggestionMenu(prefix: string): void {
    if (document.activeElement !== this.options.textarea) {
      this.closeSlashMenu();
      return;
    }

    this.closeModelMenu();
    this.options.cancelSessionNameEdit();

    if (this.suggestionKind !== 'file' || prefix !== this.fileSuggestionPrefix) {
      this.suggestionKind = 'file';
      this.slashMenuItems = [];
      this.fileSuggestionItems = [];
      this.fileSuggestionPrefix = prefix;
      this.fileSuggestionLoading = true;
      this.slashMenuActiveIndex = 0;
      this.disableSlashMenuPointerHover();
      this.options.slashMenuElement?.scrollTo({ top: 0 });
      this.fileSuggestionRequestId += 1;
      this.options.postMessage({
        type: 'requestFileSuggestions',
        id: String(this.fileSuggestionRequestId),
        prefix
      });
    }

    this.renderFileSuggestionMenu(prefix);
    this.openSlashMenu();
  }

  private getFileSuggestionPrefixInfo(): { prefix: string; start: number } | undefined {
    const textarea = this.options.textarea;
    const cursor = textarea.selectionStart;

    if (cursor !== textarea.selectionEnd) {
      return undefined;
    }

    return extractAtFilePrefix(textarea.value.slice(0, cursor));
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
    const names = new Set([
      ...commands.map((command) => command.name),
      ...hiddenLocalSlashCommandNames
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

  private renderFileSuggestionMenu(prefix: string): void {
    const slashMenuElement = this.options.slashMenuElement;

    if (!slashMenuElement) {
      return;
    }

    slashMenuElement.replaceChildren();

    if (this.fileSuggestionLoading && this.fileSuggestionItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement('Finding files...'));
      return;
    }

    if (this.fileSuggestionItems.length === 0) {
      slashMenuElement.append(createSlashMenuEmptyElement(prefix.length > 1 ? 'No matching files' : 'No files available'));
      return;
    }

    for (let index = 0; index < this.fileSuggestionItems.length; index += 1) {
      slashMenuElement.append(this.createFileSuggestionItemElement(this.fileSuggestionItems[index], index));
    }

    this.syncSlashMenuActiveDescendant();
  }

  private createSuggestionBaseElement(index: number): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = 'slash-command-' + index;
    item.className = 'composer__slash-item' + (index === this.slashMenuActiveIndex ? ' composer__slash-item--active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === this.slashMenuActiveIndex ? 'true' : 'false');
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

  private openSlashMenu(): void {
    if (!this.options.slashMenuElement) {
      return;
    }

    this.slashMenuOpen = true;
    this.options.slashMenuElement.setAttribute('open', '');
    this.options.slashMenuElement.setAttribute('aria-label', this.suggestionKind === 'file' ? 'File suggestions' : 'Slash commands');
    this.options.textarea.setAttribute('aria-expanded', 'true');
    this.syncSlashMenuActiveDescendant();
  }

  private moveSlashMenuSelection(delta: number): void {
    const itemCount = this.getActiveSuggestionCount();

    if (itemCount === 0) {
      return;
    }

    this.slashMenuActiveIndex = (this.slashMenuActiveIndex + delta + itemCount) % itemCount;

    if (this.suggestionKind === 'file') {
      this.renderFileSuggestionMenu(this.fileSuggestionPrefix);
    } else {
      this.renderSlashMenu(this.getSlashCommandQuery());
    }
  }

  private enableSlashMenuPointerHover(): void {
    if (this.slashMenuPointerHoverEnabled) {
      return;
    }

    this.slashMenuPointerHoverEnabled = true;
    this.options.slashMenuElement?.classList.add('composer__slash-menu--pointer-hover');
  }

  private disableSlashMenuPointerHover(): void {
    if (!this.slashMenuPointerHoverEnabled) {
      return;
    }

    this.slashMenuPointerHoverEnabled = false;
    this.options.slashMenuElement?.classList.remove('composer__slash-menu--pointer-hover');
  }

  private handleSlashMenuPointerMove(event: PointerEvent): void {
    if (!this.slashMenuOpen) {
      return;
    }

    this.enableSlashMenuPointerHover();

    const item = eventTargetElement(event)?.closest('.composer__slash-item');

    if (!(item instanceof HTMLElement) || !this.options.slashMenuElement?.contains(item)) {
      return;
    }

    const index = Number(item.getAttribute('data-index'));

    if (!Number.isInteger(index) || index < 0 || index >= this.getActiveSuggestionCount()) {
      return;
    }

    const previousIndex = this.slashMenuActiveIndex;

    if (index === previousIndex) {
      return;
    }

    this.slashMenuActiveIndex = index;
    this.updateRenderedSlashMenuSelection(previousIndex);
  }

  private updateRenderedSlashMenuSelection(previousIndex: number): void {
    this.updateRenderedSlashMenuItemSelection(previousIndex, false);
    this.updateRenderedSlashMenuItemSelection(this.slashMenuActiveIndex, true);
    this.syncSlashMenuActiveDescendant({ reveal: false });
  }

  private updateRenderedSlashMenuItemSelection(index: number, selected: boolean): void {
    const item = document.getElementById('slash-command-' + index);

    if (!item) {
      return;
    }

    item.classList.toggle('composer__slash-item--active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  }

  private syncSlashMenuActiveDescendant(options: { reveal?: boolean } = {}): void {
    if (!this.slashMenuOpen || this.getActiveSuggestionCount() === 0) {
      this.options.textarea.removeAttribute('aria-activedescendant');
      return;
    }

    this.options.textarea.setAttribute('aria-activedescendant', 'slash-command-' + this.slashMenuActiveIndex);

    if (options.reveal !== false) {
      this.options.slashMenuElement?.querySelector('.composer__slash-item--active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private acceptActiveSuggestion(): void {
    if (this.suggestionKind === 'file') {
      const file = this.fileSuggestionItems[this.slashMenuActiveIndex];

      if (file) {
        this.acceptFileSuggestion(file);
      }

      return;
    }

    const command = this.slashMenuItems[this.slashMenuActiveIndex];

    if (command) {
      this.acceptSlashCommand(command);
    }
  }

  private getActiveSuggestionCount(): number {
    return this.suggestionKind === 'file' ? this.fileSuggestionItems.length : this.slashMenuItems.length;
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

  private acceptFileSuggestion(file: FileSuggestion): void {
    const prefixInfo = this.getFileSuggestionPrefixInfo();

    if (!prefixInfo) {
      return;
    }

    const textarea = this.options.textarea;
    const cursor = textarea.selectionStart;
    const beforePrefix = textarea.value.slice(0, prefixInfo.start);
    const afterCursor = textarea.value.slice(cursor);
    const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
    const hasTrailingQuoteInItem = file.value.endsWith('"');
    const adjustedAfterCursor = hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
    const suffix = file.directory ? '' : ' ';
    const nextValue = beforePrefix + file.value + suffix + adjustedAfterCursor;
    const cursorOffset = file.directory && hasTrailingQuoteInItem ? file.value.length - 1 : file.value.length;
    const nextCursor = beforePrefix.length + cursorOffset + suffix.length;

    textarea.value = nextValue;
    textarea.setSelectionRange(nextCursor, nextCursor);
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  private syncTextareaHeightIfNeeded(force: boolean): void {
    const nextSignature = this.getTextareaLayoutSignature();

    if (!force && nextSignature === this.textareaLayoutSignature) {
      return;
    }

    this.textareaLayoutSignature = nextSignature;
    this.syncTextareaHeight();
  }

  private syncTextareaHeight(): void {
    this.options.textarea.style.height = 'auto';

    const maxHeight = this.getMaxTextareaHeight();
    const nextHeight = Math.max(minTextareaHeight, Math.min(this.options.textarea.scrollHeight, maxHeight));
    this.options.textarea.style.height = nextHeight + 'px';
    this.options.textarea.style.overflowY = this.options.textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  private getTextareaLayoutSignature(): string {
    const state = this.options.getState();
    const promptContextSignature = state.promptContext
      .map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.xml?.length ?? 0].join('\u0000'))
      .join('\u0000');
    const promptImagesSignature = state.promptImages
      .map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.mimeType, attachment.sizeBytes].join('\u0000'))
      .join('\u0000');

    return [
      this.options.textarea.value,
      window.innerWidth,
      window.innerHeight,
      state.lane,
      state.chatFace,
      state.busy ? '1' : '0',
      state.workspaceDiffStats.addedLines,
      state.workspaceDiffStats.removedLines,
      promptContextSignature,
      promptImagesSignature
    ].join('\u0001');
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

function createTooltipElement(text: string): HTMLSpanElement {
  const tooltip = document.createElement('span');
  tooltip.className = 'tauren-icon-action-tooltip';
  tooltip.textContent = text;
  return tooltip;
}

function setTooltipText(element: HTMLElement, text: string): void {
  const tooltip = element.querySelector<HTMLElement>('.tauren-icon-action-tooltip');

  if (tooltip) {
    tooltip.textContent = text;
  }
}

function isPromptContextAttachment(value: unknown): value is PromptContextAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const attachment = value as Partial<PromptContextAttachment>;
  return typeof attachment.id === 'string'
    && typeof attachment.label === 'string'
    && typeof attachment.title === 'string'
    && (!('xml' in attachment) || typeof attachment.xml === 'string');
}

function isPromptImageAttachment(value: unknown): value is PromptImageAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const attachment = value as Partial<PromptImageAttachment>;
  return typeof attachment.id === 'string'
    && typeof attachment.label === 'string'
    && typeof attachment.title === 'string'
    && typeof attachment.mimeType === 'string'
    && typeof attachment.sizeBytes === 'number';
}

async function createDroppedPromptImagesMessage(dataTransfer: DataTransfer): Promise<unknown | undefined> {
  const files = Array.from(dataTransfer.files ?? []);
  const uris = files.length > 0 ? [] : getDroppedUriTexts(dataTransfer);

  if (files.length === 0 && uris.length === 0) {
    return undefined;
  }

  const rejections = getPromptImageFileRejections(files);

  if (rejections.length > 0) {
    return { type: 'dropPromptImages', files: [], uris: [], rejections };
  }

  return createPromptImagesMessageFromFiles(files, uris);
}

async function createPromptImagesMessageFromFiles(files: readonly File[], uris: string[] = []): Promise<unknown | undefined> {
  const droppedFiles = [];

  for (const file of files) {
    try {
      droppedFiles.push({
        label: getPromptImageFileLabel(file),
        title: getPromptImageFileLabel(file),
        mimeType: getSupportedPromptImageMimeType(getPromptImageFileLabel(file)) ?? file.type,
        sizeBytes: file.size,
        data: await readFileAsBase64(file)
      });
    } catch {
      return {
        type: 'dropPromptImages',
        files: [],
        uris: [],
        rejections: [`Cannot read attachment: ${getPromptImageFileLabel(file)}.`]
      };
    }
  }

  return { type: 'dropPromptImages', files: droppedFiles, uris };
}

function getPromptImageFileRejections(files: readonly File[]): string[] {
  const rejections: string[] = [];

  for (const file of files) {
    const label = getPromptImageFileLabel(file);

    if (!getSupportedPromptImageMimeType(label)) {
      rejections.push(getUnsupportedPromptImageMessage(label));
      continue;
    }

    if (file.size > maxPromptImageBytes) {
      rejections.push(getPromptImageTooLargeMessage(label));
    }
  }

  return rejections;
}

function getPromptImageFileLabel(file: File): string {
  return file.name || 'dropped file';
}

export function getPastedPromptImageFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? []).filter(hasClipboardFileName);

  if (files.length > 0) {
    return files;
  }

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file && hasClipboardFileName(file)));
}

function hasClipboardFileName(file: File): boolean {
  return typeof file.name === 'string' && file.name.length > 0;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      resolve(typeof reader.result === 'string' ? stripDataUrlPrefix(reader.result) : '');
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function classifyComposerDragState(dataTransfer: DataTransfer | null): ComposerDragState {
  if (!dataTransfer) {
    return 'neutral';
  }

  const files = Array.from(dataTransfer.files ?? []);

  if (files.length > 0) {
    return getPromptImageFileRejections(files).length > 0 ? 'invalid' : 'valid';
  }

  const itemStates = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map(classifyDataTransferFileItem);

  if (itemStates.includes('invalid')) {
    return 'invalid';
  }

  if (itemStates.length > 0 && itemStates.every((state) => state === 'valid')) {
    return 'valid';
  }

  return 'neutral';
}

function classifyDataTransferFileItem(item: DataTransferItem): Exclude<ComposerDragState, 'none'> {
  const file = item.getAsFile();

  if (file?.name) {
    return getPromptImageFileRejections([file]).length > 0 ? 'invalid' : 'valid';
  }

  if (item.type) {
    return isSupportedPromptImageMimeType(item.type) ? 'valid' : 'invalid';
  }

  return 'neutral';
}

function isSupportedPromptImageMimeType(value: string): boolean {
  return value === 'image/png'
    || value === 'image/jpeg'
    || value === 'image/gif'
    || value === 'image/webp';
}

function getDroppedUriTexts(dataTransfer: DataTransfer): string[] {
  const uriList = parseDroppedUriText(dataTransfer.getData('text/uri-list'));

  if (uriList.length > 0) {
    return uriList;
  }

  return parseDroppedUriText(dataTransfer.getData('text/plain'));
}

function parseDroppedUriText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter(isDroppedUriText);
}

function isDroppedUriText(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    || value.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(value)
    || value.startsWith('\\\\');
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0 B';
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  const kib = value / 1024;
  if (kib < 1024) {
    return `${Math.round(kib)} KB`;
  }

  return `${(kib / 1024).toFixed(1)} MB`;
}

function getModelOptionsSignature(modelOptions: readonly ModelOption[]): string {
  return modelOptions
    .map((model) => [model.provider, model.id, model.name, model.reasoning ? '1' : '0'].join('\u0000'))
    .join('\u0001');
}

function getContextBadgesPastSecondRow(badges: readonly HTMLElement[]): HTMLElement[] {
  const rowTops: number[] = [];
  const overflowBadges: HTMLElement[] = [];

  for (const badge of badges) {
    const rowIndex = getOrAddContextBadgeRowIndex(rowTops, badge.offsetTop);

    if (rowIndex > 1) {
      overflowBadges.push(badge);
    }
  }

  return overflowBadges;
}

function getContextBadgeRowIndex(badge: HTMLElement): number {
  const parent = badge.parentElement;

  if (!parent) {
    return 0;
  }

  const visibleBadges = Array.from(parent.querySelectorAll<HTMLElement>('.composer__context-badge'))
    .filter((candidate) => !candidate.hidden);
  const rowTops: number[] = [];

  for (const visibleBadge of visibleBadges) {
    getOrAddContextBadgeRowIndex(rowTops, visibleBadge.offsetTop);
  }

  return rowTops.findIndex((top) => Math.abs(top - badge.offsetTop) <= 2);
}

function getOrAddContextBadgeRowIndex(rowTops: number[], top: number): number {
  const existingIndex = rowTops.findIndex((rowTop) => Math.abs(rowTop - top) <= 2);

  if (existingIndex >= 0) {
    return existingIndex;
  }

  rowTops.push(top);
  return rowTops.length - 1;
}

function createContextOverflowBadge(): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'composer__context-badge composer__context-badge--overflow';

  const label = document.createElement('span');
  label.className = 'composer__context-label';

  const tooltip = document.createElement('span');
  tooltip.className = 'composer__context-badge-tooltip';
  const tooltipPre = document.createElement('pre');
  const tooltipCode = document.createElement('code');
  tooltipPre.append(tooltipCode);
  tooltip.append(tooltipPre);
  badge.append(label, tooltip);

  return badge;
}

function updateContextOverflowBadge(badge: HTMLElement, hiddenBadges: readonly HTMLElement[]): void {
  const label = badge.querySelector<HTMLElement>('.composer__context-label');
  const tooltipCode = badge.querySelector<HTMLElement>('.composer__context-badge-tooltip code');
  const attachmentLabels = hiddenBadges.map((hiddenBadge) => hiddenBadge.dataset.overflowTitle || hiddenBadge.dataset.overflowLabel || 'Attachment');
  const tooltipText = attachmentLabels.map((attachmentLabel) => '• ' + attachmentLabel).join('\n');

  if (label) {
    label.textContent = '+' + hiddenBadges.length + ' more';
  }

  if (tooltipCode) {
    tooltipCode.textContent = tooltipText;
  }

  badge.title = tooltipText;
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

const fileSuggestionDelimiters = new Set([' ', '\t', '\n', '\r', '"', "'", '=']);

export function extractAtFilePrefix(textBeforeCursor: string): { prefix: string; start: number } | undefined {
  const quotedPrefix = extractQuotedAtFilePrefix(textBeforeCursor);

  if (quotedPrefix) {
    return quotedPrefix;
  }

  const lastDelimiterIndex = findLastFileSuggestionDelimiter(textBeforeCursor);
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;

  if (textBeforeCursor[tokenStart] === '@') {
    return { prefix: textBeforeCursor.slice(tokenStart), start: tokenStart };
  }

  return undefined;
}

function extractQuotedAtFilePrefix(textBeforeCursor: string): { prefix: string; start: number } | undefined {
  let inQuotes = false;
  let quoteStart = -1;

  for (let index = 0; index < textBeforeCursor.length; index += 1) {
    if (textBeforeCursor[index] === '"') {
      inQuotes = !inQuotes;

      if (inQuotes) {
        quoteStart = index;
      }
    }
  }

  if (!inQuotes || quoteStart <= 0 || textBeforeCursor[quoteStart - 1] !== '@') {
    return undefined;
  }

  const atStart = quoteStart - 1;

  if (atStart > 0 && !fileSuggestionDelimiters.has(textBeforeCursor[atStart - 1] ?? '')) {
    return undefined;
  }

  return { prefix: textBeforeCursor.slice(atStart), start: atStart };
}

function findLastFileSuggestionDelimiter(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (fileSuggestionDelimiters.has(text[index] ?? '')) {
      return index;
    }
  }

  return -1;
}

function isFileSuggestionsResult(message: unknown): message is FileSuggestionsResult {
  if (!isRecord(message) || message.type !== 'fileSuggestionsResult') {
    return false;
  }

  return typeof message.id === 'string'
    && typeof message.prefix === 'string'
    && Array.isArray(message.items)
    && message.items.every(isFileSuggestion);
}

function isFileSuggestion(value: unknown): value is FileSuggestion {
  return isRecord(value)
    && typeof value.value === 'string'
    && typeof value.label === 'string'
    && ('description' in value ? typeof value.description === 'string' : true)
    && typeof value.directory === 'boolean';
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
