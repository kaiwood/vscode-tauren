import { getScopedModelPickerOptions } from '../scopedModels';
import type { ModelOption, WebviewState } from '../types';
import { createTooltipElement } from './tooltip';

type PostMessage = (message: unknown) => void;

export type ModelPickerControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  refreshMetadata: () => void;
  modelElement: HTMLButtonElement;
  modelMenuElement: HTMLElement | undefined;
  modelSelectElement: HTMLSelectElement;
  thinkingSelectElement: HTMLSelectElement;
  closeSuggestionMenu: () => void;
  cancelSessionNameEdit: () => void;
};

export class ModelPickerController {
  private modelSelectOptionsSignature = '';

  public constructor(private readonly options: ModelPickerControllerOptions) {}

  public hasOpenMenu(): boolean {
    return this.options.modelMenuElement?.hasAttribute('open') ?? false;
  }

  public closeMenu(): void {
    this.options.modelMenuElement?.removeAttribute('open');
    this.options.modelElement.setAttribute('aria-expanded', 'false');
  }

  public openPicker(): void {
    if (this.options.modelElement.disabled) {
      return;
    }

    this.openMenu();
    this.focusControl(1);
  }

  public syncLabel(label: string, tooltipText: string, busy: boolean, metadataRefreshing: boolean): void {
    const modelLabel = document.createElement('span');
    modelLabel.className = 'composer__model-label';
    modelLabel.textContent = label;
    const tooltip = createTooltipElement(tooltipText);
    this.options.modelElement.replaceChildren(modelLabel, tooltip);
    this.options.modelElement.className = 'composer__model';
    this.options.modelElement.setAttribute('aria-label', tooltipText);
    this.options.modelElement.disabled = busy;
    this.options.modelElement.setAttribute('aria-busy', metadataRefreshing ? 'true' : 'false');
    this.options.modelMenuElement?.setAttribute('aria-busy', metadataRefreshing ? 'true' : 'false');

    this.syncModelSelect();
    this.syncThinkingSelect();
  }

  public toggleMenu(): void {
    if (this.options.modelElement.disabled) {
      return;
    }

    const open = !this.options.modelMenuElement?.hasAttribute('open');

    if (open) {
      this.openMenu();
    } else {
      this.closeMenu();
    }
  }

  public selectModel(): void {
    const state = this.options.getState();
    const [provider, modelId] = splitModelKey(this.options.modelSelectElement.value);

    if (!provider || !modelId || state.busy) {
      return;
    }

    this.closeMenu();
    this.options.postMessage({ type: 'setModel', provider, modelId });
  }

  public selectThinkingLevel(): void {
    const state = this.options.getState();
    const level = this.options.thinkingSelectElement.value;

    if (!level || state.busy || !state.modelReasoning) {
      return;
    }

    this.closeMenu();
    this.options.postMessage({ type: 'setThinkingLevel', level });
  }

  public handleMenuKeydown(event: KeyboardEvent): void {
    if (!this.hasOpenMenu()) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.focusControl(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      this.focusControl(event.key === 'End' ? -1 : 1, true);
    }
  }

  private openMenu(): void {
    const state = this.options.getState();

    if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
      this.options.refreshMetadata();
    }

    this.options.closeSuggestionMenu();
    this.options.cancelSessionNameEdit();
    this.options.modelMenuElement?.setAttribute('open', '');
    this.options.modelElement.setAttribute('aria-expanded', 'true');
  }

  private focusControl(direction: 1 | -1, edge = false): void {
    const controls = this.getEnabledControls();

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

  private getEnabledControls(): HTMLSelectElement[] {
    return [this.options.thinkingSelectElement, this.options.modelSelectElement]
      .filter((control) => !control.disabled);
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

  private getDisplayModelOptions(): ModelOption[] {
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
}

function getModelOptionsSignature(modelOptions: readonly ModelOption[]): string {
  return modelOptions
    .map((model) => [model.provider, model.id, model.name, model.reasoning ? '1' : '0'].join('\u0000'))
    .join('\u0001');
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
