import { createTreeItemElement } from './sessionElements';
import { createSessionEmptyElement } from './sessionUiHelpers';
import type { WebviewState } from '../types';

type PostMessage = (message: unknown) => void;

export type SessionTreeControllerOptions = {
  getState: () => WebviewState;
  postMessage: PostMessage;
  sessionsElement: HTMLElement;
};

export class SessionTreeController {
  private selectedIndex = 0;

  public constructor(private readonly options: SessionTreeControllerOptions) {}

  public render(): void {
    const state = this.options.getState();
    this.options.sessionsElement.replaceChildren();
    this.selectedIndex = this.clampIndex(this.selectedIndex);

    const header = document.createElement('div');
    header.className = 'sessions__header';
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;
    header.textContent = state.treeRefreshing
      ? 'Loading session tree...'
      : count === 1
      ? '1 tree entry'
      : count + ' tree entries';
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
      this.options.sessionsElement.append(createTreeItemElement(state.treeItems[index], index, {
        selectedIndex: this.selectedIndex,
        disabled: state.busy || state.treeRefreshing
      }));
    }
  }

  public selectCurrent(): void {
    const state = this.options.getState();
    const currentIndex = Array.isArray(state.treeItems)
      ? state.treeItems.findIndex((item) => item.current)
      : -1;
    this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
  }

  public moveSelection(delta: number): void {
    const state = this.options.getState();

    if (!Array.isArray(state.treeItems) || state.treeItems.length === 0) {
      return;
    }

    this.selectedIndex = this.clampIndex(this.selectedIndex + delta);
    this.render();
    document.getElementById('tree-' + this.selectedIndex)?.scrollIntoView({ block: 'nearest' });
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

    this.options.postMessage({ type: 'selectTreeEntry', entryId: treeItem.entryId });
  }

  private clampIndex(index: number): number {
    const state = this.options.getState();
    const count = Array.isArray(state.treeItems) ? state.treeItems.length : 0;

    if (count === 0) {
      return 0;
    }

    return Math.max(0, Math.min(index, count - 1));
  }
}
