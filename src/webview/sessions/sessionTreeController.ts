import { createTreeItemElement } from './sessionElements';
import { createSessionEmptyElement, eventTargetElement } from './sessionUiHelpers';
import type { WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

type SummaryChoice = 'none' | 'summarize' | 'custom';

export type SessionTreeControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  sessionsElement: HTMLElement;
};

export class SessionTreeController {
  private selectedIndex = 0;
  private pendingSummaryEntryId: string | undefined;
  private summaryChoiceIndex = 0;
  private customSummaryMode = false;
  private customInstructions = '';
  private pendingTreeScrollIndex: number | undefined;
  private pendingTreeScrollFrame: number | undefined;

  public constructor(private readonly options: SessionTreeControllerOptions) {}

  public render(): void {
    const state = this.options.getState();
    this.options.sessionsElement.replaceChildren();
    this.selectedIndex = this.clampIndex(this.selectedIndex);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    header.textContent = state.treeRefreshing ? 'Loading session tree...' : 'Session tree';
    this.options.sessionsElement.append(header);

    if (state.treeError) {
      const error = document.createElement('div');
      error.className = 'sessions__error';
      error.textContent = state.treeError;
      this.options.sessionsElement.append(error);
    }

    if (state.treeRefreshing && count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('Loading session tree...'));
      return;
    }

    if (count === 0) {
      this.options.sessionsElement.append(createSessionEmptyElement('No persisted tree entries found for this session.'));
      return;
    }

    for (let index = 0; index < state.treeItems.length; index += 1) {
      const item = state.treeItems[index];
      this.options.sessionsElement.append(createTreeItemElement(item, index, {
        selectedIndex: this.selectedIndex,
        disabled: state.busy || state.treeRefreshing
      }));

      if (item.entryId === this.pendingSummaryEntryId) {
        this.options.sessionsElement.append(this.createSummaryDialog());
      }
    }

    const footer = document.createElement('div');
    footer.className = 'sessions__header sessions__tree-footer';
    footer.textContent = `(${this.selectedIndex + 1}/${count})`;
    this.options.sessionsElement.append(footer);
    requestAnimationFrame(() => this.scrollSelectedIntoView());
  }

  public selectCurrent(): void {
    const state = this.options.getState();
    const items = Array.isArray(state.treeItems) ? state.treeItems : [];
    const currentIndex = items.findIndex((item) => item.current);

    if (currentIndex >= 0) {
      this.selectedIndex = currentIndex;
      return;
    }

    const activePathIndex = findLastIndex(items, (item) => Boolean(item.activePath));
    this.selectedIndex = activePathIndex >= 0 ? activePathIndex : 0;
  }

  public moveSelection(delta: number): void {
    const state = this.options.getState();

    if (!Array.isArray(state.treeItems) || state.treeItems.length === 0) {
      return;
    }

    const previousIndex = this.selectedIndex;
    const hadSummaryDialog = Boolean(this.pendingSummaryEntryId);
    const nextIndex = this.wrapIndex(this.selectedIndex + delta, state.treeItems.length);

    if (nextIndex === previousIndex && !hadSummaryDialog) {
      return;
    }

    this.closeSummaryDialog();
    this.selectedIndex = nextIndex;

    if (hadSummaryDialog) {
      this.render();
      return;
    }

    this.updateRenderedSelection(previousIndex);
    this.scheduleSelectedIntoView(nextIndex);
  }

  public selectCurrentIndex(): void {
    this.selectIndex(this.selectedIndex);
  }

  public selectIndex(index: number): void {
    const state = this.options.getState();
    const treeItem = Array.isArray(state.treeItems) ? state.treeItems[index] : undefined;

    if (!treeItem?.entryId || state.busy || state.treeRefreshing) {
      return;
    }

    this.selectedIndex = this.clampIndex(index);
    this.openSummaryDialog(treeItem.entryId);
  }

  public handleClick(target: Element | null, event: MouseEvent): boolean {
    const action = target?.closest<HTMLElement>('[data-tree-summary-action]');

    if (action) {
      event.preventDefault();
      event.stopPropagation();
      this.runSummaryAction(action.getAttribute('data-tree-summary-action'));
      return true;
    }

    const cancel = target?.closest<HTMLElement>('.sessions__tree-summary-cancel');

    if (cancel) {
      event.preventDefault();
      event.stopPropagation();
      this.closeSummaryDialog();
      this.render();
      this.options.sessionsElement.focus({ preventScroll: true });
      return true;
    }

    return false;
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.pendingSummaryEntryId) {
      return false;
    }

    const target = eventTargetElement(event);
    const customInput = target?.closest('.sessions__tree-summary-input');

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeSummaryDialog();
      this.render();
      this.options.sessionsElement.focus({ preventScroll: true });
      return true;
    }

    if (customInput instanceof HTMLTextAreaElement) {
      this.customInstructions = customInput.value;

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.navigatePending('custom');
        return true;
      }

      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.summaryChoiceIndex = this.wrapIndex(this.summaryChoiceIndex + 1, 3);
      this.customSummaryMode = false;
      this.renderAndFocusSummaryChoice();
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.summaryChoiceIndex = this.wrapIndex(this.summaryChoiceIndex - 1, 3);
      this.customSummaryMode = false;
      this.renderAndFocusSummaryChoice();
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.runSummaryAction(this.getSummaryChoice(this.summaryChoiceIndex));
      return true;
    }

    return false;
  }

  private createSummaryDialog(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'sessions__tree-summary';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Summarize branch?');

    const title = document.createElement('div');
    title.className = 'sessions__tree-summary-title';
    title.textContent = 'Summarize branch?';
    dialog.append(title);

    if (this.customSummaryMode) {
      const input = document.createElement('textarea');
      input.className = 'sessions__tree-summary-input';
      input.value = this.customInstructions;
      input.rows = 3;
      input.placeholder = 'Custom summary prompt';
      input.addEventListener('input', () => {
        this.customInstructions = input.value;
      });
      dialog.append(input);

      const actions = document.createElement('div');
      actions.className = 'sessions__tree-summary-actions';
      actions.append(
        this.createSummaryButton('custom', 'Summarize', true),
        this.createCancelLink()
      );
      dialog.append(actions);
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
      return dialog;
    }

    const choices = document.createElement('div');
    choices.className = 'sessions__tree-summary-choices';
    const options: Array<{ action: SummaryChoice; label: string }> = [
      { action: 'none', label: 'No summary' },
      { action: 'summarize', label: 'Summarize' },
      { action: 'custom', label: 'Summarize with custom prompt' }
    ];

    options.forEach((option, index) => {
      choices.append(this.createSummaryButton(option.action, option.label, index === this.summaryChoiceIndex));
    });

    dialog.append(choices, this.createCancelLink());
    requestAnimationFrame(() => {
      dialog.querySelector<HTMLButtonElement>('.sessions__tree-summary-choice--active')?.focus({ preventScroll: true });
      document.getElementById('tree-' + this.selectedIndex)?.scrollIntoView({ block: 'nearest' });
    });
    return dialog;
  }

  private createSummaryButton(action: SummaryChoice, label: string, active: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sessions__tree-summary-choice' + (active ? ' sessions__tree-summary-choice--active' : '');
    button.setAttribute('data-tree-summary-action', action);
    button.textContent = (active ? '→ ' : '  ') + label;
    return button;
  }

  private createCancelLink(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sessions__tree-summary-cancel';
    button.textContent = 'Cancel';
    return button;
  }

  private openSummaryDialog(entryId: string): void {
    this.pendingSummaryEntryId = entryId;
    this.summaryChoiceIndex = 0;
    this.customSummaryMode = false;
    this.customInstructions = '';
    this.render();
  }

  private closeSummaryDialog(): void {
    this.pendingSummaryEntryId = undefined;
    this.summaryChoiceIndex = 0;
    this.customSummaryMode = false;
    this.customInstructions = '';
  }

  private runSummaryAction(action: string | null): void {
    if (action === 'custom') {
      if (!this.customSummaryMode) {
        this.customSummaryMode = true;
        this.summaryChoiceIndex = 2;
        this.render();
        return;
      }

      this.navigatePending('custom');
      return;
    }

    if (action === 'summarize') {
      this.navigatePending('summarize');
      return;
    }

    if (action === 'none') {
      this.navigatePending('none');
    }
  }

  private navigatePending(choice: SummaryChoice): void {
    const entryId = this.pendingSummaryEntryId;

    if (!entryId) {
      return;
    }

    const customInstructions = this.customInstructions.trim();
    this.closeSummaryDialog();
    this.options.postMessage({
      type: 'selectTreeEntry',
      entryId,
      summarize: choice !== 'none',
      ...(choice === 'custom' && customInstructions ? { customInstructions } : {})
    });
  }

  private getSummaryChoice(index: number): SummaryChoice {
    return index === 1 ? 'summarize' : index === 2 ? 'custom' : 'none';
  }

  private renderAndFocusSummaryChoice(): void {
    this.render();
    requestAnimationFrame(() => {
      this.options.sessionsElement.querySelector<HTMLButtonElement>('.sessions__tree-summary-choice--active')?.focus({ preventScroll: true });
    });
  }

  private updateRenderedSelection(previousIndex: number): void {
    this.updateRenderedTreeItemSelection(previousIndex, false);
    this.updateRenderedTreeItemSelection(this.selectedIndex, true);
    this.updateRenderedFooter();
  }

  private updateRenderedTreeItemSelection(index: number, selected: boolean): void {
    const item = document.getElementById('tree-' + index);

    if (!item) {
      return;
    }

    item.classList.toggle('sessions__item--active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');

    const cursor = item.querySelector<HTMLElement>('.sessions__tree-cursor');

    if (cursor) {
      cursor.textContent = selected ? '›' : '';
    }
  }

  private updateRenderedFooter(): void {
    const state = this.options.getState();
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    const footer = this.options.sessionsElement.querySelector<HTMLElement>('.sessions__tree-footer');

    if (footer) {
      footer.textContent = `(${this.selectedIndex + 1}/${count})`;
    }
  }

  private scheduleSelectedIntoView(index: number): void {
    this.pendingTreeScrollIndex = index;

    if (this.pendingTreeScrollFrame !== undefined) {
      return;
    }

    this.pendingTreeScrollFrame = requestAnimationFrame(() => {
      const scrollIndex = this.pendingTreeScrollIndex;
      this.pendingTreeScrollIndex = undefined;
      this.pendingTreeScrollFrame = undefined;

      if (scrollIndex === undefined) {
        return;
      }

      this.scrollIndexIntoView(scrollIndex);
    });
  }

  private scrollSelectedIntoView(): void {
    this.scrollIndexIntoView(this.selectedIndex);
  }

  private scrollIndexIntoView(index: number): void {
    const item = document.getElementById('tree-' + index);

    if (!item) {
      return;
    }

    item.scrollIntoView({ block: 'nearest' });

    const footer = this.options.sessionsElement.querySelector<HTMLElement>('.sessions__tree-footer');
    const containerRect = this.options.sessionsElement.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const footerTop = footer?.getBoundingClientRect().top ?? containerRect.bottom;
    const bottomOverlap = itemRect.bottom - footerTop;

    if (bottomOverlap > 0) {
      this.options.sessionsElement.scrollTop += bottomOverlap + 6;
      return;
    }

    const topOverlap = containerRect.top - itemRect.top;

    if (topOverlap > 0) {
      this.options.sessionsElement.scrollTop -= topOverlap + 6;
    }
  }

  private clampIndex(index: number): number {
    const state = this.options.getState();
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;

    if (count === 0) {
      return 0;
    }

    return Math.max(0, Math.min(index, count - 1));
  }

  private wrapIndex(index: number, count: number): number {
    if (count <= 0) {
      return 0;
    }

    return ((index % count) + count) % count;
  }
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}
