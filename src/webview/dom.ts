export type WebviewDom = {
  viewElement: HTMLElement;
  toolbarTitleElement: HTMLElement;
  toolbarTitleTextElement: HTMLElement;
  toolbarTimestampElement: HTMLElement;
  sessionNameInputElement: HTMLInputElement;
  sessionToggleButton: HTMLButtonElement;
  treeToggleButton: HTMLButtonElement;
  sessionMenuWrapElement: HTMLElement;
  sessionMenuButton: HTMLButtonElement;
  sessionMenuElement: HTMLElement;
  sessionMenuItemElements: HTMLButtonElement[];
  chatHelpWrapElement: HTMLElement;
  chatHelpButton: HTMLButtonElement;
  chatHelpPopoverElement: HTMLElement;
  sessionHelpWrapElement: HTMLElement;
  sessionHelpButton: HTMLButtonElement;
  sessionHelpPopoverElement: HTMLElement;
  toastElement: HTMLElement;
  messagesElement: HTMLElement;
  sessionsElement: HTMLElement;
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
    sessionMenuWrapElement: queryRequired<HTMLElement>('.pi-toolbar__menu-wrap'),
    sessionMenuButton: queryRequired<HTMLButtonElement>('.pi-toolbar__menu-button'),
    sessionMenuElement: queryRequired<HTMLElement>('.pi-toolbar__menu'),
    sessionMenuItemElements: queryAll<HTMLButtonElement>('.pi-toolbar__menu-item'),
    chatHelpWrapElement: queryRequired<HTMLElement>('.pi-toolbar__chat-help-wrap'),
    chatHelpButton: queryRequired<HTMLButtonElement>('.pi-toolbar__chat-help-button'),
    chatHelpPopoverElement: queryRequired<HTMLElement>('.pi-toolbar__chat-help-popover'),
    sessionHelpWrapElement: queryRequired<HTMLElement>('.pi-toolbar__session-help-wrap'),
    sessionHelpButton: queryRequired<HTMLButtonElement>('.pi-toolbar__session-help-button'),
    sessionHelpPopoverElement: queryRequired<HTMLElement>('.pi-toolbar__session-help-popover'),
    toastElement: queryRequired<HTMLElement>('.pi-toast'),
    messagesElement: queryRequired<HTMLElement>('.messages'),
    sessionsElement: queryRequired<HTMLElement>('.sessions'),
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
