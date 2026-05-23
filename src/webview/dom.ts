export type WebviewDom = {
  viewElement: HTMLElement;
  toolbarTitleElement: HTMLElement;
  toolbarTitleTextElement: HTMLElement;
  toolbarTimestampElement: HTMLElement;
  sessionNameInputElement: HTMLInputElement;
  sessionToggleButton: HTMLButtonElement;
  treeToggleButton: HTMLButtonElement;
  helpOverlayElement: HTMLElement;
  helpCloseButton: HTMLButtonElement;
  settingsElement: HTMLElement;
  settingsBodyElement: HTMLElement;
  settingsBackButton: HTMLButtonElement;
  toastElement: HTMLElement;
  messagesElement: HTMLElement;
  sessionsElement: HTMLElement;
  sessionTreeElement: HTMLElement;
  customUiElement: HTMLElement;
  customUiOutputElement: HTMLElement;
  customUiCloseButton: HTMLButtonElement;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  slashMenuElement: HTMLElement;
  contextBadgesElement: HTMLElement;
  busySubmitElement: HTMLElement;
  diffSummaryElement: HTMLElement;
  diffAddedElement: HTMLElement;
  diffRemovedElement: HTMLElement;
  streamingBehaviorButtonElements: HTMLButtonElement[];
  newSessionButton: HTMLButtonElement;
  contextElement: HTMLElement;
  contextValueElement: HTMLElement;
  contextTooltipElement: HTMLElement;
  modelElement: HTMLButtonElement;
  modelMenuElement: HTMLElement;
  modelSelectElement: HTMLSelectElement;
  thinkingSelectElement: HTMLSelectElement;
  submitButton: HTMLButtonElement;
};

export function getWebviewDom(): WebviewDom {
  return {
    viewElement: queryRequired<HTMLElement>('.pi-view'),
    toolbarTitleElement: queryRequired<HTMLElement>('.pi-toolbar__title'),
    toolbarTitleTextElement: queryRequired<HTMLElement>('.pi-toolbar__title-text'),
    toolbarTimestampElement: queryRequired<HTMLElement>('.pi-toolbar__timestamp'),
    sessionNameInputElement: queryRequired<HTMLInputElement>('.pi-toolbar__title-input'),
    sessionToggleButton: queryRequired<HTMLButtonElement>('.pi-toolbar__sessions'),
    treeToggleButton: queryRequired<HTMLButtonElement>('.pi-toolbar__tree'),
    helpOverlayElement: queryRequired<HTMLElement>('.pi-help-overlay'),
    helpCloseButton: queryRequired<HTMLButtonElement>('.pi-help-overlay__close'),
    settingsElement: queryRequired<HTMLElement>('.settings-surface'),
    settingsBodyElement: queryRequired<HTMLElement>('.settings-surface__body'),
    settingsBackButton: queryRequired<HTMLButtonElement>('.settings-surface__back'),
    toastElement: queryRequired<HTMLElement>('.pi-toast'),
    messagesElement: queryRequired<HTMLElement>('.messages'),
    sessionsElement: queryRequired<HTMLElement>('.sessions'),
    sessionTreeElement: queryRequired<HTMLElement>('.session-tree'),
    customUiElement: queryRequired<HTMLElement>('.custom-ui'),
    customUiOutputElement: queryRequired<HTMLElement>('.custom-ui__output'),
    customUiCloseButton: queryRequired<HTMLButtonElement>('.custom-ui__close'),
    form: queryRequired<HTMLFormElement>('.composer'),
    textarea: queryRequired<HTMLTextAreaElement>('textarea'),
    slashMenuElement: queryRequired<HTMLElement>('.composer__slash-menu'),
    contextBadgesElement: queryRequired<HTMLElement>('.composer__context-badges'),
    busySubmitElement: queryRequired<HTMLElement>('.composer__busy-submit'),
    diffSummaryElement: queryRequired<HTMLElement>('.composer__diff-summary'),
    diffAddedElement: queryRequired<HTMLElement>('.composer__diff-added'),
    diffRemovedElement: queryRequired<HTMLElement>('.composer__diff-removed'),
    streamingBehaviorButtonElements: queryAll<HTMLButtonElement>('.composer__mode-button'),
    newSessionButton: queryRequired<HTMLButtonElement>('.composer__add'),
    contextElement: queryRequired<HTMLElement>('.composer__context'),
    contextValueElement: queryRequired<HTMLElement>('.composer__context-value'),
    contextTooltipElement: queryRequired<HTMLElement>('.composer__context-tooltip'),
    modelElement: queryRequired<HTMLButtonElement>('.composer__model'),
    modelMenuElement: queryRequired<HTMLElement>('.composer__model-menu'),
    modelSelectElement: queryRequired<HTMLSelectElement>('.composer__model-select'),
    thinkingSelectElement: queryRequired<HTMLSelectElement>('.composer__thinking-select'),
    submitButton: queryRequired<HTMLButtonElement>('.composer__submit')
  };
}

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required webview element: ${selector}`);
  }

  return element;
}

function queryAll<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}
