import { requestCodeHighlight } from '../codeHighlighting';
import { eventTargetElement, parseCssPixelValue } from '../dom';
import { maxTextareaHeight, minTextareaHeight } from '../constants';
import { createDiffCounter, formatDiffLineCount, normalizeDiffLineCount, updateDiffCounter } from './diffCounter';
import { appendComposerText } from './appendText';
import { ComposerPasteBuffer } from './paste';
import { setTooltipText } from './tooltip';
import { ModelPickerController } from './modelPickerController';
import {
  classifyComposerDragState,
  createDroppedPromptImagesMessage,
  createPromptImagesMessageFromFiles,
  getPastedPromptImageFiles,
  getPromptImageFileRejections,
  type ComposerDragState
} from './promptImages';
import { SuggestionMenuController } from './suggestionMenuController';
import type { WebviewPerfEventName, WebviewStreamingBehavior } from '../../webviewProtocol/types';
import type {
  PromptContextAttachment,
  PromptImageAttachment,
  WebviewState
} from '../types';

type PostMessage = (message: unknown) => void;
type MeasurePerfEvent = (name: WebviewPerfEventName, measure: () => void) => void;

export type ComposerControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  refreshMetadata: () => void;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
  voiceButton: HTMLButtonElement;
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
  measurePerfEvent: MeasurePerfEvent;
};

export class ComposerController {
  private appliedComposerTextRevision = 0;
  private streamingBehavior: WebviewStreamingBehavior = 'steer';
  private busySubmitHideTimeout: ReturnType<typeof setTimeout> | undefined;
  private composerDragDepth = 0;
  private voiceStarting = false;
  private textareaLayoutSignature = '';
  private promptContextBadgesSignature = '';
  private cachedMaxTextareaHeight = maxTextareaHeight;
  private readonly pasteBuffer = new ComposerPasteBuffer();
  private readonly addedDiffCounter: ReturnType<typeof createDiffCounter>;
  private readonly removedDiffCounter: ReturnType<typeof createDiffCounter>;
  private readonly modelPicker: ModelPickerController;
  private readonly suggestionMenu: SuggestionMenuController;

  public constructor(private readonly options: ComposerControllerOptions) {
    this.addedDiffCounter = createDiffCounter(options.diffAddedElement, '+');
    this.removedDiffCounter = createDiffCounter(options.diffRemovedElement, '-');
    this.modelPicker = new ModelPickerController({
      getState: options.getState,
      postMessage: options.postMessage,
      refreshMetadata: options.refreshMetadata,
      modelElement: options.modelElement,
      modelMenuElement: options.modelMenuElement,
      modelSelectElement: options.modelSelectElement,
      thinkingSelectElement: options.thinkingSelectElement,
      closeSuggestionMenu: () => this.suggestionMenu.close(),
      cancelSessionNameEdit: options.cancelSessionNameEdit
    });
    this.suggestionMenu = new SuggestionMenuController({
      getState: options.getState,
      postMessage: options.postMessage,
      textarea: options.textarea,
      slashMenuElement: options.slashMenuElement,
      closeModelMenu: () => this.modelPicker.closeMenu(),
      cancelSessionNameEdit: options.cancelSessionNameEdit,
      syncComposer: (syncOptions) => this.syncComposer(syncOptions),
      focusPromptInput: options.focusPromptInput
    });
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
    this.options.voiceButton.addEventListener('click', () => this.handleVoiceButtonClick());
    this.options.voiceButton.addEventListener('pointerdown', (event) => this.handleVoicePointerDown(event));
    this.options.voiceButton.addEventListener('pointerup', () => this.handleVoicePointerUp());
    this.options.voiceButton.addEventListener('pointercancel', () => this.handleVoicePointerUp());
    this.options.voiceButton.addEventListener('lostpointercapture', () => this.handleVoicePointerUp());

    for (const button of this.options.streamingBehaviorButtonElements) {
      button.addEventListener('click', () => this.selectStreamingBehavior(button));
    }

    this.options.modelElement.addEventListener('click', () => this.modelPicker.toggleMenu());
    this.options.modelMenuElement?.addEventListener('keydown', (event) => this.modelPicker.handleMenuKeydown(event), true);
    this.options.modelSelectElement.addEventListener('change', () => this.modelPicker.selectModel());
    this.options.thinkingSelectElement.addEventListener('change', () => this.modelPicker.selectThinkingLevel());

    window.addEventListener('resize', () => this.syncPromptContextBadgeOverflow());

    this.options.textarea.addEventListener('keydown', (event) => {
      if (this.suggestionMenu.handleKeydown(event)) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.options.form.requestSubmit();
      }
    });

    this.options.textarea.addEventListener('input', () => {
      this.options.measurePerfEvent('composer.input', () => {
        this.suggestionMenu.clearDismissedSlashQuery();
        this.syncComposer({ preserveBottom: true });
        this.options.measurePerfEvent('composer.slashMenuSync', () => this.syncSlashMenu());
      });
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

    this.options.slashMenuElement?.addEventListener('pointermove', (event) => this.suggestionMenu.handlePointerMove(event));
    this.options.slashMenuElement?.addEventListener('click', (event) => this.suggestionMenu.handleClick(event));

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

    if (this.suggestionMenu.isOpen()) {
      if (!this.options.slashMenuElement?.contains(target) && target !== this.options.textarea) {
        this.closeSlashMenu();
      }
    }
  }

  public hasSlashMenuOpen(): boolean {
    return this.suggestionMenu.isOpen();
  }

  public hasModelMenuOpen(): boolean {
    return this.modelPicker.hasOpenMenu();
  }

  public dismissSlashMenu(): void {
    this.suggestionMenu.dismiss();
  }

  public closeSlashMenu(): void {
    this.suggestionMenu.close();
  }

  public handleHostMessage(message: unknown): boolean {
    return this.suggestionMenu.handleHostMessage(message);
  }

  public closeModelMenu(): void {
    this.modelPicker.closeMenu();
  }

  public openModelPicker(): void {
    this.modelPicker.openPicker();
  }

  public syncPromptContextBadges(): void {
    if (!this.options.contextBadgesElement) {
      return;
    }

    const attachments = this.getPromptContextAttachments();
    const images = this.getPromptImageAttachments();
    const nextSignature = this.getPromptContextBadgesSignature(attachments, images);

    if (nextSignature === this.promptContextBadgesSignature) {
      return;
    }

    this.promptContextBadgesSignature = nextSignature;
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
    this.modelPicker.syncLabel(label, modelTooltip, state.busy, state.metadataRefreshing);
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
    this.suggestionMenu.clearDismissedSlashQuery();
    this.closeSlashMenu();
    this.syncComposer({ preserveBottom: true });
    this.options.focusPromptInput();
  }

  public syncComposer(options: { preserveBottom?: boolean; forceResize?: boolean } = {}): void {
    this.options.measurePerfEvent('composer.sync', () => {
      let shouldPreserveBottom = false;
      if (options.preserveBottom) {
        this.options.measurePerfEvent('composer.scrollPreserve', () => {
          shouldPreserveBottom = this.options.isMessagesAtBottom();
        });
      }

      this.syncVoiceButton();
      this.syncSubmit();
      this.syncBusySubmitMode();

      let textareaHeightChanged = false;
      this.options.measurePerfEvent('composer.textareaResize', () => {
        textareaHeightChanged = this.syncTextareaHeightIfNeeded(Boolean(options.forceResize));
      });

      if (textareaHeightChanged && shouldPreserveBottom) {
        this.options.measurePerfEvent('composer.scrollPreserve', () => this.options.scrollMessagesToBottom());
      }
    });
  }

  public syncSlashMenu(): void {
    this.suggestionMenu.sync();
  }

  private handleVoiceButtonClick(): void {
    if (this.options.getState().voice?.mode === 'pushToTalk' && this.options.getState().voice?.activationMode === 'hold') {
      return;
    }

    this.toggleVoiceRecording();
  }

  private handleVoicePointerDown(event: PointerEvent): void {
    const voice = this.options.getState().voice;
    if (voice?.mode !== 'pushToTalk' || voice.activationMode !== 'hold' || event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.options.voiceButton.setPointerCapture(event.pointerId);
    this.startVoiceRecording();
  }

  private handleVoicePointerUp(): void {
    const voice = this.options.getState().voice;
    if (voice?.mode !== 'pushToTalk' || voice.activationMode !== 'hold') {
      return;
    }

    if (this.options.getState().voice?.recordingStatus === 'recording') {
      this.showVoiceFeedback('Stopping recording…');
      this.options.postMessage({ type: 'voiceStopRecording' });
    }
  }

  private toggleVoiceRecording(): void {
    const voice = this.options.getState().voice;
    const status = voice?.recordingStatus;

    if (status === 'recording' || status === 'listening') {
      this.showVoiceFeedback('Stopping recording…');
      this.options.postMessage({ type: 'voiceStopRecording' });
      return;
    }

    if (status === 'transcribing') {
      this.showVoiceFeedback('Stopping voice input…');
      this.options.postMessage({ type: 'voiceStopRecording' });
      return;
    }

    this.startVoiceRecording();
  }

  private startVoiceRecording(): void {
    const voice = this.options.getState().voice;
    const selectedModel = voice?.models.find((model) => model.id === voice.selectedModelId);
    const isReady = Boolean(voice?.enabled && voice.binary.status === 'downloaded' && selectedModel?.downloaded);

    if (!isReady) {
      this.options.postMessage({ type: 'showChatFace', chatFace: 'settings' });
      this.options.postMessage({ type: 'setSettingsSection', section: 'voice' });
      return;
    }

    this.voiceStarting = true;
    this.syncVoiceButton();
    this.showVoiceFeedback('Starting recording…');
    this.options.postMessage({ type: 'voiceStartRecording' });
  }

  private showVoiceFeedback(message: string): void {
    const tooltip = this.options.voiceButton.querySelector<HTMLElement>('.composer__button-tooltip, .tauren-icon-action-tooltip');
    if (tooltip) {
      tooltip.textContent = message;
    }
  }

  private syncVoiceButton(): void {
    const voice = this.options.getState().voice;
    const button = this.options.voiceButton;
    const tooltip = button.querySelector<HTMLElement>('.composer__button-tooltip, .tauren-icon-action-tooltip');
    const enabled = voice?.enabled === true;
    const selectedModel = voice?.models.find((model) => model.id === voice.selectedModelId);
    if (voice?.recordingStatus === 'listening' || voice?.recordingStatus === 'recording' || voice?.recordingStatus === 'transcribing' || voice?.recordingStatus === 'error') {
      this.voiceStarting = false;
    }

    const isStarting = enabled && this.voiceStarting;
    const isListening = enabled && voice?.recordingStatus === 'listening';
    const isRecording = enabled && voice?.recordingStatus === 'recording';
    const isTranscribing = voice?.recordingStatus === 'transcribing';
    const isReady = Boolean(voice && voice.binary.status === 'downloaded' && selectedModel?.downloaded);
    const audioLevel = voice?.audioLevel ?? 0;

    button.style.setProperty('--voice-level', audioLevel.toFixed(3));
    button.hidden = !enabled;
    button.style.display = enabled ? '' : 'none';
    button.classList.toggle('composer__voice--starting', isStarting);
    button.classList.toggle('composer__voice--listening', isListening);
    button.classList.toggle('composer__voice--recording', isRecording);
    button.classList.toggle('composer__voice--transcribing', isTranscribing);
    button.disabled = false;
    button.setAttribute('aria-label', isRecording || isListening || isStarting || isTranscribing ? 'Stop voice input' : 'Start voice input');

    if (tooltip) {
      tooltip.textContent = isStarting
        ? 'Starting voice input…'
        : isRecording
        ? 'Stop voice input'
        : isListening
        ? 'Listening… click to stop'
        : voice?.recordingStatus === 'error' && voice.error
        ? voice.error
        : isTranscribing
        ? 'Transcribing… click to stop'
        : isReady
        ? 'Start voice input'
        : 'Start voice input (setup required)';
    }
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
      this.suggestionMenu.clearDismissedSlashQuery();
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

  private syncTextareaHeightIfNeeded(force: boolean): boolean {
    const nextSignature = this.getTextareaLayoutSignature();

    if (force || nextSignature !== this.textareaLayoutSignature) {
      this.textareaLayoutSignature = nextSignature;
      this.cachedMaxTextareaHeight = this.getMaxTextareaHeight();
    }

    return this.syncTextareaHeight(this.cachedMaxTextareaHeight);
  }

  private syncTextareaHeight(maxHeight: number): boolean {
    const previousHeight = parseCssPixelValue(this.options.textarea.style.height);
    this.options.textarea.style.height = 'auto';

    const scrollHeight = this.options.textarea.scrollHeight;
    const nextHeight = Math.max(minTextareaHeight, Math.min(scrollHeight, maxHeight));
    this.options.textarea.style.height = nextHeight + 'px';
    this.options.textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';

    return Math.abs(previousHeight - nextHeight) > 0.5;
  }

  private getPromptContextBadgesSignature(attachments: readonly PromptContextAttachment[], images: readonly PromptImageAttachment[]): string {
    const promptContextSignature = attachments
      .map((attachment) => [attachment.id, attachment.source, attachment.label, attachment.title, attachment.xml?.length ?? 0].join('\u0000'))
      .join('\u0000');
    const promptImagesSignature = images
      .map((attachment) => [attachment.id, attachment.label, attachment.title, attachment.mimeType, attachment.sizeBytes].join('\u0000'))
      .join('\u0000');

    return [promptContextSignature, promptImagesSignature].join('\u0001');
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

function getReservedMessagesHeight(): number {
  return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
}
