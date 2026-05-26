import { normalizeDiffLineCount } from '../diff/lineCount';
import { isSettingId, normalizeSettingValue } from '../settings/settingsRegistry';
import { cloneWebviewExtensionRenderBlocks } from '../webviewProtocol/renderBlocks';
import {
  parseWebviewChatFace,
  parseWebviewLane,
  parseWebviewSessionItemCommand,
  parseWebviewSettingsSection,
  parseWebviewStreamingBehavior
} from '../webviewProtocol/values';
import { chatWebviewStyles } from './chatWebviewStyles';
import { createNonce } from './nonce';
import type {
  CreateWebviewHtmlOptions,
  CreateWebviewStateMessageOptions,
  WebviewDroppedPromptImage,
  WebviewMessage,
  WebviewPerfEvent,
  WebviewPerfEventName,
  WebviewScriptUris,
  WebviewStateMessage
} from '../webviewProtocol/types';

export function parseWebviewMessage(value: unknown): WebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { type: 'unknown' };
  }

  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'focusChanged':
      return typeof value.focused === 'boolean'
        ? { type: 'focusChanged', focused: value.focused }
        : { type: 'unknown' };
    case 'perfEvent': {
      const event = parseWebviewPerfEvent(value.event);
      return event ? { type: 'perfEvent', event } : { type: 'unknown' };
    }
    case 'newSession':
      return { type: 'newSession' };
    case 'showLane': {
      const lane = parseWebviewLane(value.lane, 'chat');
      return lane === value.lane
        ? { type: 'showLane', lane }
        : { type: 'unknown' };
    }
    case 'showChatFace': {
      const chatFace = parseWebviewChatFace(value.chatFace, 'main');
      return chatFace === value.chatFace
        ? { type: 'showChatFace', chatFace }
        : { type: 'unknown' };
    }
    case 'hideChatFace':
      return { type: 'hideChatFace' };
    case 'setSettingsSection': {
      const section = parseWebviewSettingsSection(value.section);
      return section
        ? { type: 'setSettingsSection', section }
        : { type: 'unknown' };
    }
    case 'updateSetting': {
      if (!isSettingId(value.settingId)) {
        return { type: 'unknown' };
      }

      const settingValue = normalizeSettingValue(value.settingId, value.value);
      return settingValue === undefined
        ? { type: 'unknown' }
        : { type: 'updateSetting', settingId: value.settingId, value: settingValue };
    }
    case 'authLogin': {
      if (typeof value.providerId !== 'string' || !value.providerId) {
        return { type: 'unknown' };
      }

      const authType = value.authType === 'oauth' || value.authType === 'api_key' ? value.authType : undefined;
      return authType
        ? { type: 'authLogin', providerId: value.providerId, authType }
        : { type: 'authLogin', providerId: value.providerId };
    }
    case 'authLogout':
      return typeof value.providerId === 'string' && value.providerId
        ? { type: 'authLogout', providerId: value.providerId }
        : { type: 'unknown' };
    case 'authRefresh':
      return { type: 'authRefresh' };
    case 'authCancel':
      return { type: 'authCancel' };
    case 'refreshSessions':
      return { type: 'refreshSessions' };
    case 'showCurrentChanges':
      return { type: 'showCurrentChanges' };
    case 'dismissWelcome':
      return { type: 'dismissWelcome' };
    case 'selectSession':
      return typeof value.sessionPath === 'string' && value.sessionPath
        ? { type: 'selectSession', sessionPath: value.sessionPath }
        : { type: 'unknown' };
    case 'deleteSession':
      return typeof value.sessionPath === 'string' && value.sessionPath
        ? { type: 'deleteSession', sessionPath: value.sessionPath }
        : { type: 'unknown' };
    case 'sessionItemCommand': {
      const command = parseWebviewSessionItemCommand(value.command);
      return typeof value.sessionPath === 'string' && value.sessionPath && command
        ? { type: 'sessionItemCommand', sessionPath: value.sessionPath, command }
        : { type: 'unknown' };
    }
    case 'setSessionItemName':
      return typeof value.sessionPath === 'string' && value.sessionPath && typeof value.name === 'string'
        ? { type: 'setSessionItemName', sessionPath: value.sessionPath, name: value.name }
        : { type: 'unknown' };
    case 'selectTreeEntry':
      return typeof value.entryId === 'string' && value.entryId
        ? {
          type: 'selectTreeEntry',
          entryId: value.entryId,
          ...(typeof value.summarize === 'boolean' ? { summarize: value.summarize } : {}),
          ...(typeof value.customInstructions === 'string' ? { customInstructions: value.customInstructions } : {})
        }
        : { type: 'unknown' };
    case 'setTreeEntryLabel':
      return typeof value.entryId === 'string' && value.entryId && typeof value.label === 'string'
        ? { type: 'setTreeEntryLabel', entryId: value.entryId, label: value.label }
        : { type: 'unknown' };
    case 'setSessionName':
      return typeof value.name === 'string'
        ? { type: 'setSessionName', name: value.name }
        : { type: 'unknown' };
    case 'refreshMetadata':
      return { type: 'refreshMetadata' };
    case 'refreshSlashCommands':
      return { type: 'refreshSlashCommands' };
    case 'requestFileSuggestions':
      return typeof value.id === 'string' && value.id && typeof value.prefix === 'string' && value.prefix.startsWith('@')
        ? { type: 'requestFileSuggestions', id: value.id, prefix: value.prefix }
        : { type: 'unknown' };
    case 'selectPromptImages':
      return { type: 'selectPromptImages' };
    case 'dropPromptImages': {
      const files = parseDroppedPromptImages(value.files);
      const uris = parseStringArray(value.uris);
      const rejections = 'rejections' in value ? parseStringArray(value.rejections) : [];

      if (!files || !uris || !rejections) {
        return { type: 'unknown' };
      }

      return rejections.length > 0
        ? { type: 'dropPromptImages', files, uris, rejections }
        : { type: 'dropPromptImages', files, uris };
    }
    case 'removePromptImage':
      return typeof value.id === 'string' && value.id
        ? { type: 'removePromptImage', id: value.id }
        : { type: 'unknown' };
    case 'removePromptContext':
      return typeof value.id === 'string' && value.id
        ? { type: 'removePromptContext', id: value.id }
        : { type: 'unknown' };
    case 'abort':
      return { type: 'abort' };
    case 'copyText':
      if (typeof value.text !== 'string' || !value.text || ('successMessage' in value && typeof value.successMessage !== 'string')) {
        return { type: 'unknown' };
      }

      return typeof value.successMessage === 'string' && value.successMessage
        ? { type: 'copyText', text: value.text, successMessage: value.successMessage }
        : { type: 'copyText', text: value.text };
    case 'openFile': {
      if (typeof value.path !== 'string' || !value.path) {
        return { type: 'unknown' };
      }

      const line = parsePositiveInteger(value.line);
      const column = parsePositiveInteger(value.column);

      if (('line' in value && line === undefined) || ('column' in value && column === undefined)) {
        return { type: 'unknown' };
      }

      return {
        type: 'openFile',
        path: value.path,
        ...(line ? { line } : {}),
        ...(column ? { column } : {})
      };
    }
    case 'highlightCode': {
      if (typeof value.id !== 'string' || !value.id
        || typeof value.code !== 'string' || !value.code
        || typeof value.language !== 'string' || !value.language
        || ('themeId' in value && typeof value.themeId !== 'string')) {
        return { type: 'unknown' };
      }

      const themeId = typeof value.themeId === 'string' && value.themeId ? value.themeId : undefined;

      return {
        type: 'highlightCode',
        id: value.id,
        code: value.code,
        language: value.language,
        ...(themeId ? { themeId } : {})
      };
    }
    case 'resolveLocalImage':
      return typeof value.id === 'string' && value.id && typeof value.src === 'string' && value.src
        ? { type: 'resolveLocalImage', id: value.id, src: value.src }
        : { type: 'unknown' };
    case 'customUiInput':
      return typeof value.id === 'string' && value.id && typeof value.data === 'string'
        ? { type: 'customUiInput', id: value.id, data: value.data }
        : { type: 'unknown' };
    case 'customUiCancel':
      return typeof value.id === 'string' && value.id
        ? { type: 'customUiCancel', id: value.id }
        : { type: 'unknown' };
    case 'customUiDimensions': {
      const columns = parsePositiveInteger(value.columns);
      const rows = parsePositiveInteger(value.rows);
      const cellWidthPx = parsePositiveNumber(value.cellWidthPx);
      const cellHeightPx = parsePositiveNumber(value.cellHeightPx);

      return typeof value.id === 'string' && value.id && columns !== undefined && rows !== undefined
        ? {
          type: 'customUiDimensions',
          id: value.id,
          columns,
          rows,
          ...(cellWidthPx !== undefined ? { cellWidthPx } : {}),
          ...(cellHeightPx !== undefined ? { cellHeightPx } : {})
        }
        : { type: 'unknown' };
    }
    case 'extensionWidgetDimensions': {
      const columns = parsePositiveInteger(value.columns);
      const rows = parsePositiveInteger(value.rows);
      const cellWidthPx = parsePositiveNumber(value.cellWidthPx);
      const cellHeightPx = parsePositiveNumber(value.cellHeightPx);

      return typeof value.key === 'string' && value.key && columns !== undefined && rows !== undefined
        ? {
          type: 'extensionWidgetDimensions',
          key: value.key,
          columns,
          rows,
          ...(cellWidthPx !== undefined ? { cellWidthPx } : {}),
          ...(cellHeightPx !== undefined ? { cellHeightPx } : {})
        }
        : { type: 'unknown' };
    }
    case 'extensionFooterDimensions': {
      const columns = parsePositiveInteger(value.columns);
      const rows = parsePositiveInteger(value.rows);
      const cellWidthPx = parsePositiveNumber(value.cellWidthPx);
      const cellHeightPx = parsePositiveNumber(value.cellHeightPx);

      return columns !== undefined && rows !== undefined
        ? {
          type: 'extensionFooterDimensions',
          columns,
          rows,
          ...(cellWidthPx !== undefined ? { cellWidthPx } : {}),
          ...(cellHeightPx !== undefined ? { cellHeightPx } : {})
        }
        : { type: 'unknown' };
    }
    case 'extensionEditorSave':
      return typeof value.id === 'string' && value.id && typeof value.text === 'string'
        ? { type: 'extensionEditorSave', id: value.id, text: value.text }
        : { type: 'unknown' };
    case 'extensionEditorCancel':
      return typeof value.id === 'string' && value.id
        ? { type: 'extensionEditorCancel', id: value.id }
        : { type: 'unknown' };
    case 'submit': {
      if (typeof value.text !== 'string') {
        return { type: 'unknown' };
      }

      const streamingBehavior = parseWebviewStreamingBehavior(value.streamingBehavior);

      if ('streamingBehavior' in value && !streamingBehavior) {
        return { type: 'unknown' };
      }

      return streamingBehavior
        ? { type: 'submit', text: value.text, streamingBehavior }
        : { type: 'submit', text: value.text };
    }
    case 'setModel':
      return typeof value.provider === 'string' && typeof value.modelId === 'string'
        ? { type: 'setModel', provider: value.provider, modelId: value.modelId }
        : { type: 'unknown' };
    case 'setThinkingLevel':
      return typeof value.level === 'string'
        ? { type: 'setThinkingLevel', level: value.level }
        : { type: 'unknown' };
    default:
      return { type: 'unknown' };
  }
}

export function createWebviewStateMessage({
  state,
  model = {},
  contextUsage = {},
  metadataRefreshing = false,
  workspaceDiffStats = { addedLines: 0, removedLines: 0 },
  slashCommands = [],
  slashCommandsRefreshing = false,
  outputColors = true,
  animationsEnabled = true,
  customUiTheme = 'default',
  extensionStatus = [],
  extensionFooter,
  extensionWidgets = [],
  startupResources = [],
  startupResourcesReloadRevision = 0,
  allowRemoteImages = false,
  welcomeDismissed,
  promptContext = [],
  promptImages = [],
  composer,
  navigation,
  sessionView,
  settingsView,
  auth,
  perfEnabled = false,
  includeMessages = true,
  messagePatch
}: CreateWebviewStateMessageOptions): WebviewStateMessage {
  const message: WebviewStateMessage = {
    type: 'state',
    messages: state.messages,
    busy: state.busy,
    modelLabel: model.label ?? '',
    modelProvider: model.provider ?? '',
    modelId: model.id ?? '',
    modelReasoning: model.reasoning ?? false,
    thinkingLevel: model.thinkingLevel ?? '',
    modelOptions: model.options ?? [],
    contextUsageLabel: contextUsage.label ?? '',
    contextUsageTitle: contextUsage.title ?? '',
    contextUsageLevel: contextUsage.level ?? '',
    metadataRefreshing,
    workspaceDiffStats: {
      addedLines: normalizeDiffLineCount(workspaceDiffStats.addedLines),
      removedLines: normalizeDiffLineCount(workspaceDiffStats.removedLines)
    },
    slashCommands,
    slashCommandsRefreshing,
    outputColors,
    animationsEnabled,
    customUiTheme,
    extensionStatus: extensionStatus.map((entry) => ({ ...entry })),
    ...(extensionFooter ? { extensionFooter: { ...extensionFooter } } : {}),
    extensionWidgets: extensionWidgets.map((entry) => ({
      ...entry,
      lines: entry.lines.slice(),
      ...(entry.blocks ? { blocks: cloneWebviewExtensionRenderBlocks(entry.blocks) } : {})
    })),
    allowRemoteImages: Boolean(allowRemoteImages),
    perfEnabled: Boolean(perfEnabled)
  };

  if (startupResources.length > 0) {
    message.startupResources = cloneWebviewStartupResources(startupResources);
  }

  if (startupResourcesReloadRevision > 0) {
    message.startupResourcesReloadRevision = Math.max(0, Math.floor(startupResourcesReloadRevision));
  }

  if (!includeMessages) {
    delete (message as Partial<WebviewStateMessage>).messages;
  }

  if (messagePatch) {
    message.messagePatch = messagePatch;
  }

  if (welcomeDismissed !== undefined) {
    message.welcomeDismissed = Boolean(welcomeDismissed);
  }

  if (promptContext.length > 0) {
    message.promptContext = promptContext.map((attachment) => ({ ...attachment }));
  }

  if (promptImages.length > 0) {
    message.promptImages = promptImages.map((attachment) => ({ ...attachment }));
  }

  if (composer && typeof composer.revision === 'number' && composer.revision > 0) {
    message.composerText = composer.text ?? '';
    message.composerTextRevision = composer.revision;
    if (composer.mode === 'append') {
      message.composerTextMode = 'append';
    }
  }

  if (navigation) {
    if (navigation.lane) {
      message.lane = navigation.lane;
    }

    if (navigation.chatFace) {
      message.chatFace = navigation.chatFace;
    }
  }

  if (settingsView?.activeSection) {
    message.settingsSection = settingsView.activeSection;
  }

  if (settingsView?.settings && hasSettingsPayload(settingsView.settings)) {
    message.settings = {
      values: { ...settingsView.settings.values },
      ...(settingsView.settings.pending ? { pending: settingsView.settings.pending.slice() } : {}),
      ...(settingsView.settings.errors ? { errors: { ...settingsView.settings.errors } } : {})
    };
  }

  if (auth) {
    message.auth = {
      providers: auth.providers.map((provider) => ({ ...provider })),
      ...(auth.refreshing ? { refreshing: true } : {}),
      ...(auth.busyProviderId ? { busyProviderId: auth.busyProviderId } : {}),
      ...(auth.busyAction ? { busyAction: auth.busyAction } : {}),
      ...(auth.progress ? { progress: { ...auth.progress } } : {}),
      ...(auth.error ? { error: auth.error } : {})
    };
  }

  if (sessionView) {
    message.sessions = sessionView.sessions ?? [];
    message.sessionsRefreshing = sessionView.refreshing ?? false;
    message.sessionsError = sessionView.error ?? '';
    message.currentSessionFile = sessionView.currentSessionFile ?? '';
    message.currentSessionName = sessionView.currentSessionName ?? '';
    message.treeItems = sessionView.treeItems ?? [];
    message.treeRefreshing = sessionView.treeRefreshing ?? false;
    message.treeError = sessionView.treeError ?? '';

    if (sessionView.sessionLoading) {
      message.sessionLoading = true;
    }
  }

  return message;
}

export function createWebviewHtml(scriptUris: WebviewScriptUris, options: CreateWebviewHtmlOptions = {}): string {
  const nonce = createNonce();
  const cspSource = escapeHtmlAttribute(scriptUris.cspSource ?? 'vscode-resource:');
  const imageSources = options.allowRemoteImages === true
    ? `data: https: ${cspSource}`
    : `data: ${cspSource}`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Tauren</title>
  <style>
${chatWebviewStyles}
  </style>
</head>
<body${options.devRenderInstrumentation ? ' data-tauren-dev-render-instrumentation="true"' : ''}>
  <main class="tauren-view tauren-view--lane-chat">
    <header class="tauren-toolbar">
      <button class="tauren-toolbar__sessions" type="button" aria-label="Show sessions">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11.25 4.5L6.75 9L11.25 13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="tauren-icon-action-tooltip">Show sessions</span>
      </button>
      <div class="tauren-toolbar__title"><span class="tauren-toolbar__title-text">Tauren</span><span class="tauren-toolbar__timestamp" hidden></span><input class="tauren-toolbar__title-input" type="text" aria-label="Session name" spellcheck="false" hidden></div>
      <button class="tauren-toolbar__tree" type="button" aria-label="Show tree">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M6.75 4.5L11.25 9L6.75 13.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="tauren-icon-action-tooltip">Show tree</span>
      </button>
    </header>
    <div class="tauren-toast" role="status" aria-live="polite" hidden></div>
    <section class="tauren-help-overlay" role="dialog" aria-label="Tauren help" tabindex="-1" hidden>
      <header class="tauren-help-overlay__header">
        <div>
          <div class="tauren-help-overlay__eyebrow">Tauren shortcuts</div>
          <h2 class="tauren-help-overlay__title">Help</h2>
        </div>
        <button class="tauren-help-overlay__close" type="button" aria-label="Close help">×</button>
      </header>
      <div class="tauren-help-overlay__body">
        <section class="tauren-help-overlay__section" aria-labelledby="chat-help-heading">
          <h3 id="chat-help-heading" class="tauren-help-overlay__section-title">Chat View</h3>
          <table class="tauren-help-overlay__table">
            <thead><tr><th scope="col">Key</th><th scope="col">Function</th></tr></thead>
            <tbody>
              <tr><td><kbd>Enter</kbd></td><td>Send message</td></tr>
              <tr><td><kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Insert newline</td></tr>
              <tr><td><kbd>/</kbd></td><td>Show slash commands</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Open session list</td></tr>
              <tr><td><kbd>PageUp</kbd> / <kbd>PageDown</kbd></td><td>Scroll transcript</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>PageUp</kbd> / <kbd>Ctrl</kbd>+<kbd>PageDown</kbd></td><td>Scroll transcript by line</td></tr>
              <tr><td>Model button</td><td>Change model or thinking</td></tr>
              <tr><td>Changes</td><td>Show session changes</td></tr>
              <tr><td>Stop</td><td>Stop current response</td></tr>
              <tr><td>Steer</td><td>Send guidance to the running response</td></tr>
              <tr><td>Follow-up</td><td>Queue the text as the next prompt</td></tr>
            </tbody>
          </table>
        </section>
        <section class="tauren-help-overlay__section" aria-labelledby="session-help-heading">
          <h3 id="session-help-heading" class="tauren-help-overlay__section-title">Session List</h3>
          <table class="tauren-help-overlay__table">
            <thead><tr><th scope="col">Key</th><th scope="col">Function</th></tr></thead>
            <tbody>
              <tr><td><kbd>Enter</kbd></td><td>Open selected session</td></tr>
              <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
              <tr><td><kbd>R</kbd></td><td>Rename</td></tr>
              <tr><td><kbd>F</kbd></td><td>Fork</td></tr>
              <tr><td><kbd>C</kbd></td><td>Clone</td></tr>
              <tr><td><kbd>Z</kbd></td><td>Compact</td></tr>
              <tr><td><kbd>E</kbd></td><td>Export as HTML</td></tr>
              <tr><td><kbd>Del</kbd> / <kbd>Backspace</kbd></td><td>Move to trash</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Back to chat</td></tr>
            </tbody>
          </table>
        </section>
      </div>
    </section>
    <div class="tauren-chat-surface" aria-label="Tauren chat surface">
      <div class="tauren-chat-surface__face tauren-chat-surface__main">
        <section class="messages" aria-live="polite" aria-label="Tauren conversation">
${createInitialEmptyStateHtml(Boolean(options.welcomeDismissed))}
        </section>
        <section class="custom-ui" aria-label="Pi extension UI" role="dialog" tabindex="0" hidden>
          <div class="custom-ui__header">
            <span class="custom-ui__title">Extension UI</span>
            <button class="custom-ui__close" type="button" aria-label="Close extension UI">×</button>
          </div>
          <div class="custom-ui__output" aria-live="polite"></div>
        </section>
        <section class="extension-editor" aria-label="Pi extension editor" role="dialog" aria-modal="true" hidden>
          <div class="extension-editor__panel">
            <header class="extension-editor__header">
              <h2 class="extension-editor__title">Edit text</h2>
              <button class="extension-editor__close" type="button" aria-label="Cancel editor">×</button>
            </header>
            <textarea class="extension-editor__input" aria-label="Editor text" spellcheck="false"></textarea>
            <footer class="extension-editor__actions">
              <button class="extension-editor__button extension-editor__cancel" type="button">Cancel</button>
              <button class="extension-editor__button extension-editor__save" type="button">Save</button>
            </footer>
          </div>
        </section>
        <div class="composer__widget-busy-slot" hidden></div>
        <section class="extension-widgets extension-widgets--above" aria-label="Pi extension widgets above composer" hidden></section>
        <form class="composer" aria-label="Prompt input">
      <div id="slash-command-list" class="composer__slash-menu" role="listbox" aria-label="Slash commands"></div>
      <div class="composer__context-badges" aria-label="Attached context" hidden></div>
      <textarea class="composer__input" rows="1" aria-label="Message" placeholder="Write your prompt…" aria-autocomplete="list" aria-controls="slash-command-list" aria-expanded="false"></textarea>
      <div class="composer__busy-submit" hidden aria-live="polite">
        <button class="composer__diff-summary" type="button" aria-label="Show session changes">
          <span>Changes:</span>
          <span class="composer__diff-added">+0</span>
          <span aria-hidden="true">|</span>
          <span class="composer__diff-removed">-0</span>
          <span class="tauren-icon-action-tooltip">Show session changes</span>
        </button>
        <span class="composer__busy-submit-modes" role="group" aria-label="Busy submit mode">
          <button class="composer__mode-button" type="button" data-streaming-behavior="steer">Steer<span class="tauren-icon-action-tooltip">Steer current run</span></button>
          <button class="composer__mode-button" type="button" data-streaming-behavior="followUp">Follow-up<span class="tauren-icon-action-tooltip">Queue follow-up</span></button>
        </span>
      </div>
      <div class="composer__session-actions" role="group" aria-label="Session actions">
        <button class="composer__button composer__attach" type="button" aria-label="Attach image">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 19 19" fill="none">
            <path d="M9.5 4.35V14.65M4.35 9.5H14.65" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
          </svg>
          <span class="composer__button-tooltip">Attach image</span>
        </button>
        <button class="composer__button composer__add" type="button" aria-label="New session">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 19 19" fill="none">
            <path d="M4.25 5.25C4.25 4.42 4.92 3.75 5.75 3.75H11.9C12.73 3.75 13.4 4.42 13.4 5.25V9.8C13.4 10.63 12.73 11.3 11.9 11.3H8.2L5.25 14.05V11.3C4.7 11.3 4.25 10.85 4.25 10.3V5.25Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M14.6 12.25L15.12 13.38L16.22 13.9L15.12 14.42L14.6 15.55L14.08 14.42L12.98 13.9L14.08 13.38L14.6 12.25Z" fill="currentColor"/>
          </svg>
          <span class="composer__button-tooltip">New session</span>
        </button>
      </div>
      <div class="composer__info">
        <span class="composer__context"><span class="composer__context-value"></span><span class="composer__context-tooltip"></span></span>
        <button class="composer__model" type="button" aria-haspopup="true" aria-expanded="false"></button>
      </div>
      <div class="composer__model-menu" role="menu">
        <div class="composer__field">
          <label for="thinking-select">Thinking</label>
          <select id="thinking-select" class="composer__select composer__thinking-select" aria-label="Thinking mode">
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X High</option>
          </select>
        </div>
        <div class="composer__field">
          <label for="model-select">Model</label>
          <select id="model-select" class="composer__select composer__model-select" aria-label="Model"></select>
        </div>
      </div>
      <button class="composer__button composer__submit" type="submit" aria-label="Send message" disabled>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path class="composer__submit-play" d="M5.1 3.55C5.1 2.75 5.97 2.27 6.65 2.68L15.65 8.05C16.34 8.46 16.34 9.54 15.65 9.95L6.65 15.32C5.97 15.73 5.1 15.25 5.1 14.45Z" fill="currentColor"/>
          <rect class="composer__submit-stop" x="4" y="4" width="10" height="10" rx="1.5" fill="currentColor"/>
        </svg>
        <span class="tauren-icon-action-tooltip">Send message</span>
      </button>
        </form>
        <section class="extension-widgets extension-widgets--below" aria-label="Pi extension widgets below composer" hidden></section>
        <section class="composer-status" aria-label="Pi extension status" role="status" aria-live="polite" hidden>
          <span class="composer-status__text"></span>
        </section>
      </div>
      <section class="settings-surface tauren-chat-surface__face tauren-chat-surface__settings" aria-label="Tauren settings" tabindex="-1" aria-hidden="true">
        <div class="settings-surface__chrome" aria-hidden="true"></div>
        <header class="settings-surface__header">
          <div>
            <div class="settings-surface__eyebrow">Tauren settings</div>
            <h2 class="settings-surface__title">Settings</h2>
          </div>
          <button class="settings-surface__back" type="button" aria-label="Back to chat">Back</button>
        </header>
        <div class="settings-surface__body"></div>
      </section>
    </div>
    <section class="sessions" aria-label="Tauren sessions" role="listbox" tabindex="-1" aria-hidden="true"></section>
    <section class="session-tree" aria-label="Tauren session tree" role="listbox" tabindex="-1" aria-hidden="true"></section>
  </main>

  <script nonce="${nonce}" src="${scriptUris.markdownItScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.domPurifyScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUris.webviewScriptUri}"></script>
</body>
</html>`;
}

function createInitialEmptyStateHtml(welcomeDismissed: boolean): string {
  if (welcomeDismissed) {
    return '      <p class="empty-state">Ask Tauren about this workspace.</p>';
  }

  return /* html */ `      <div class="empty-state empty-state--welcome">
        <h2 class="empty-state__title">Welcome to Tauren</h2>
        <p>Ask Tauren about this workspace, review code, plan changes, or make edits.</p>
        <p>Type / for commands, or add a file/selection as context from the editor.</p>
        <p class="empty-state__try-label">Try:</p>
        <ul class="empty-state__prompts">
          <li>Explain how this workspace is structured</li>
          <li>Review the current file for bugs</li>
          <li>Plan the changes before editing</li>
          <li>Write tests for this behavior</li>
        </ul>
        <button class="empty-state__dismiss" type="button" data-dismiss-welcome>Don't show again</button>
      </div>`;
}

function cloneWebviewStartupResources(resources: NonNullable<CreateWebviewStateMessageOptions['startupResources']>): NonNullable<CreateWebviewStateMessageOptions['startupResources']> {
  return resources.map((section) => ({
    name: section.name,
    items: section.items.slice()
  }));
}

function hasSettingsPayload(settings: NonNullable<CreateWebviewStateMessageOptions['settingsView']>['settings']): boolean {
  if (!settings) {
    return false;
  }

  return Object.keys(settings.values).length > 0
    || Boolean(settings.pending?.length)
    || Boolean(settings.errors && Object.keys(settings.errors).length > 0);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseDroppedPromptImages(value: unknown): WebviewDroppedPromptImage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const files: WebviewDroppedPromptImage[] = [];

  for (const item of value) {
    if (!isRecord(item)
      || typeof item.label !== 'string' || !item.label
      || typeof item.title !== 'string'
      || typeof item.mimeType !== 'string' || !item.mimeType
      || typeof item.data !== 'string'
      || !isNonNegativeFiniteNumber(item.sizeBytes)) {
      return undefined;
    }

    files.push({
      label: item.label,
      title: item.title,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      data: item.data
    });
  }

  return files;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string' || !item) {
      return undefined;
    }

    strings.push(item);
  }

  return strings;
}

function parseWebviewPerfEvent(value: unknown): WebviewPerfEvent | undefined {
  if (!isRecord(value) || !isNonNegativeFiniteNumber(value.durationMs)) {
    return undefined;
  }

  const name = parseWebviewPerfEventName(value.name);

  if (!name) {
    return undefined;
  }

  const lane = parseWebviewLane(value.lane, 'chat');

  if (lane !== value.lane) {
    return undefined;
  }

  const event = {
    name,
    durationMs: value.durationMs,
    lane
  };

  return {
    ...event,
    ...(isNonNegativeFiniteNumber(value.messageCount) ? { messageCount: value.messageCount } : {}),
    ...(isNonNegativeFiniteNumber(value.sessionCount) ? { sessionCount: value.sessionCount } : {}),
    ...(isNonNegativeFiniteNumber(value.visibleItemCount) ? { visibleItemCount: value.visibleItemCount } : {}),
    ...(typeof value.currentSessionFile === 'string' ? { currentSessionFile: value.currentSessionFile } : {}),
    ...(typeof value.sessionLoading === 'boolean' ? { sessionLoading: value.sessionLoading } : {})
  };
}

function parseWebviewPerfEventName(value: unknown): WebviewPerfEventName | undefined {
  return value === 'transcript.render' || value === 'sessionList.render' || value === 'tree.render'
    ? value
    : undefined;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
