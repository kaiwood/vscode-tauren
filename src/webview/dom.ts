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
  extensionEditorElement: HTMLElement;
  extensionEditorTitleElement: HTMLElement;
  extensionEditorInputElement: HTMLTextAreaElement;
  extensionEditorSaveButton: HTMLButtonElement;
  extensionEditorCancelButton: HTMLButtonElement;
  extensionEditorCloseButton: HTMLButtonElement;
  widgetBusySlotElement: HTMLElement;
  extensionWidgetsAboveElement: HTMLElement;
  extensionWidgetsBelowElement: HTMLElement;
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  composerStatusElement: HTMLElement;
  composerStatusTextElement: HTMLElement;
  slashMenuElement: HTMLElement;
  contextBadgesElement: HTMLElement;
  busySubmitElement: HTMLElement;
  diffSummaryElement: HTMLElement;
  diffAddedElement: HTMLElement;
  diffRemovedElement: HTMLElement;
  streamingBehaviorButtonElements: HTMLButtonElement[];
  attachButton: HTMLButtonElement;
  voiceButton: HTMLButtonElement;
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

export function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

export function parseCssPixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

export function getWebviewDom(): WebviewDom {
  return {
    viewElement: queryRequired<HTMLElement>('.tauren-view'),
    toolbarTitleElement: queryRequired<HTMLElement>('.tauren-toolbar__title'),
    toolbarTitleTextElement: queryRequired<HTMLElement>('.tauren-toolbar__title-text'),
    toolbarTimestampElement: queryRequired<HTMLElement>('.tauren-toolbar__timestamp'),
    sessionNameInputElement: queryRequired<HTMLInputElement>('.tauren-toolbar__title-input'),
    sessionToggleButton: queryRequired<HTMLButtonElement>('.tauren-toolbar__sessions'),
    treeToggleButton: queryRequired<HTMLButtonElement>('.tauren-toolbar__tree'),
    helpOverlayElement: queryRequired<HTMLElement>('.tauren-help-overlay'),
    helpCloseButton: queryRequired<HTMLButtonElement>('.tauren-help-overlay__close'),
    settingsElement: queryRequired<HTMLElement>('.settings-surface'),
    settingsBodyElement: queryRequired<HTMLElement>('.settings-surface__body'),
    settingsBackButton: queryRequired<HTMLButtonElement>('.settings-surface__back'),
    toastElement: queryRequired<HTMLElement>('.tauren-toast'),
    messagesElement: queryRequired<HTMLElement>('.messages'),
    sessionsElement: queryRequired<HTMLElement>('.sessions'),
    sessionTreeElement: queryRequired<HTMLElement>('.session-tree'),
    customUiElement: queryRequired<HTMLElement>('.custom-ui'),
    customUiOutputElement: queryRequired<HTMLElement>('.custom-ui__output'),
    customUiCloseButton: queryRequired<HTMLButtonElement>('.custom-ui__close'),
    extensionEditorElement: queryRequired<HTMLElement>('.extension-editor'),
    extensionEditorTitleElement: queryRequired<HTMLElement>('.extension-editor__title'),
    extensionEditorInputElement: queryRequired<HTMLTextAreaElement>('.extension-editor__input'),
    extensionEditorSaveButton: queryRequired<HTMLButtonElement>('.extension-editor__save'),
    extensionEditorCancelButton: queryRequired<HTMLButtonElement>('.extension-editor__cancel'),
    extensionEditorCloseButton: queryRequired<HTMLButtonElement>('.extension-editor__close'),
    widgetBusySlotElement: queryRequired<HTMLElement>('.composer__widget-busy-slot'),
    extensionWidgetsAboveElement: queryRequired<HTMLElement>('.extension-widgets--above'),
    extensionWidgetsBelowElement: queryRequired<HTMLElement>('.extension-widgets--below'),
    form: queryRequired<HTMLFormElement>('.composer'),
    textarea: queryRequired<HTMLTextAreaElement>('.composer__input'),
    composerStatusElement: queryRequired<HTMLElement>('.composer-status'),
    composerStatusTextElement: queryRequired<HTMLElement>('.composer-status__text'),
    slashMenuElement: queryRequired<HTMLElement>('.composer__slash-menu'),
    contextBadgesElement: queryRequired<HTMLElement>('.composer__context-badges'),
    busySubmitElement: queryRequired<HTMLElement>('.composer__busy-submit'),
    diffSummaryElement: queryRequired<HTMLElement>('.composer__diff-summary'),
    diffAddedElement: queryRequired<HTMLElement>('.composer__diff-added'),
    diffRemovedElement: queryRequired<HTMLElement>('.composer__diff-removed'),
    streamingBehaviorButtonElements: queryAll<HTMLButtonElement>('.composer__mode-button'),
    attachButton: queryRequired<HTMLButtonElement>('.composer__attach'),
    voiceButton: queryRequired<HTMLButtonElement>('.composer__voice'),
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
