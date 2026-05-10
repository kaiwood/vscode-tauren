export const chatWebviewScript = /* javascript */ `    const vscode = acquireVsCodeApi();
    const messagesElement = document.querySelector('.messages');
    const form = document.querySelector('.composer');
    const textarea = document.querySelector('textarea');
    const slashMenuElement = document.querySelector('.composer__slash-menu');
    const busySubmitElement = document.querySelector('.composer__busy-submit');
    const busySubmitHintElement = document.querySelector('.composer__busy-submit-hint');
    const streamingBehaviorButtonElements = Array.from(document.querySelectorAll('.composer__mode-button'));
    const newSessionButton = document.querySelector('.composer__add');
    const contextElement = document.querySelector('.composer__context');
    const contextValueElement = document.querySelector('.composer__context-value');
    const contextTooltipElement = document.querySelector('.composer__context-tooltip');
    const modelElement = document.querySelector('.composer__model');
    const modelMenuElement = document.querySelector('.composer__model-menu');
    const modelSelectElement = document.querySelector('.composer__model-select');
    const thinkingSelectElement = document.querySelector('.composer__thinking-select');
    const submitButton = document.querySelector('.composer__submit');
    const messagesBottomThreshold = 4;
    const maxTextareaHeight = 180;
    const minTextareaHeight = 22;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    let state = { messages: [], busy: false, modelLabel: '', modelProvider: '', modelId: '', modelReasoning: false, thinkingLevel: '', modelOptions: [], contextUsageLabel: '', contextUsageTitle: '', contextUsageLevel: '', metadataRefreshing: false, slashCommands: [], slashCommandsRefreshing: false };
    let slashMenuOpen = false;
    let slashMenuActiveIndex = 0;
    let slashMenuItems = [];
    let slashCommandsRefreshRequested = false;
    let streamingBehavior = 'steer';
    let busySubmitHideTimeout;
    const localSlashCommands = [
      { name: 'model', description: 'Select model', source: 'builtin' },
      { name: 'name', description: 'Set or clear session name', source: 'builtin' },
      { name: 'session', description: 'Show session info and stats', source: 'builtin' },
      { name: 'compact', description: 'Manually compact context', source: 'builtin' },
      { name: 'copy', description: 'Copy last Pi response', source: 'builtin' },
      { name: 'export', description: 'Export session to HTML', source: 'builtin' },
      { name: 'new', description: 'Start a new session', source: 'builtin' },
      { name: 'settings', description: 'Terminal-only: use VS Code settings instead', source: 'unsupported' },
      { name: 'scoped-models', description: 'Terminal-only: scoped model cycling is not supported here yet', source: 'unsupported' },
      { name: 'import', description: 'Terminal-only: session import is not supported here yet', source: 'unsupported' },
      { name: 'share', description: 'Not supported here yet', source: 'unsupported' },
      { name: 'changelog', description: 'Not supported here yet', source: 'unsupported' },
      { name: 'hotkeys', description: 'Terminal-only: use VS Code keybindings instead', source: 'unsupported' },
      { name: 'fork', description: 'Not supported here yet', source: 'unsupported' },
      { name: 'clone', description: 'Not supported here yet', source: 'unsupported' },
      { name: 'tree', description: 'Terminal-only: session tree is not supported here yet', source: 'unsupported' },
      { name: 'login', description: 'Terminal-only: run pi in a terminal to authenticate', source: 'unsupported' },
      { name: 'logout', description: 'Terminal-only: run pi in a terminal to manage auth', source: 'unsupported' },
      { name: 'resume', description: 'Terminal-only: session picker is not supported here yet', source: 'unsupported' },
      { name: 'reload', description: 'Reload keybindings, extensions, skills, prompts, and themes', source: 'builtin' },
      { name: 'quit', description: 'Not supported here', source: 'unsupported' }
    ];
    const activityExpansion = new Map();
    const markdownRenderer = window.markdownit
      ? window.markdownit({
        html: false,
        linkify: true,
        breaks: false,
        highlight: highlightCode
      })
      : undefined;

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'focusInput') {
        focusPromptInput();
        return;
      }

      if (event.data?.type !== 'state') {
        return;
      }

      state = {
        messages: Array.isArray(event.data.messages) ? event.data.messages : [],
        busy: Boolean(event.data.busy),
        modelLabel: typeof event.data.modelLabel === 'string' ? event.data.modelLabel : '',
        modelProvider: typeof event.data.modelProvider === 'string' ? event.data.modelProvider : '',
        modelId: typeof event.data.modelId === 'string' ? event.data.modelId : '',
        modelReasoning: Boolean(event.data.modelReasoning),
        thinkingLevel: typeof event.data.thinkingLevel === 'string' ? event.data.thinkingLevel : '',
        modelOptions: Array.isArray(event.data.modelOptions) ? event.data.modelOptions : [],
        contextUsageLabel: typeof event.data.contextUsageLabel === 'string' ? event.data.contextUsageLabel : '',
        contextUsageTitle: typeof event.data.contextUsageTitle === 'string' ? event.data.contextUsageTitle : '',
        contextUsageLevel: typeof event.data.contextUsageLevel === 'string' ? event.data.contextUsageLevel : '',
        metadataRefreshing: Boolean(event.data.metadataRefreshing),
        slashCommands: Array.isArray(event.data.slashCommands) ? event.data.slashCommands : [],
        slashCommandsRefreshing: Boolean(event.data.slashCommandsRefreshing)
      };
      render();
    });

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = textarea.value.trim();

      if (!text) {
        return;
      }

      closeSlashMenu();
      vscode.postMessage(state.busy
        ? { type: 'submit', text, streamingBehavior }
        : { type: 'submit', text });
      textarea.value = '';
      syncComposer({ preserveBottom: true });
      focusPromptInput();
    });

    submitButton?.addEventListener('click', (event) => {
      if (!isStopSubmitMode()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: 'abort' });
      focusPromptInput();
    });

    for (const button of streamingBehaviorButtonElements) {
      button.addEventListener('click', () => {
        const nextBehavior = button.getAttribute('data-streaming-behavior');

        if (nextBehavior === 'steer' || nextBehavior === 'followUp') {
          streamingBehavior = nextBehavior;
          syncComposer({ preserveBottom: true });
          focusPromptInput();
        }
      });
    }

    newSessionButton?.addEventListener('click', startNewSession);
    modelElement?.addEventListener('click', toggleModelMenu);
    modelSelectElement?.addEventListener('change', selectModel);
    thinkingSelectElement?.addEventListener('change', selectThinkingLevel);

    window.addEventListener('click', (event) => {
      if (modelMenuElement?.hasAttribute('open')) {
        if (!modelMenuElement.contains(event.target) && !modelElement?.contains(event.target)) {
          closeModelMenu();
        }
      }

      if (slashMenuOpen) {
        if (!slashMenuElement?.contains(event.target) && event.target !== textarea) {
          closeSlashMenu();
        }
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeSlashMenu();
        closeModelMenu();
        return;
      }

      if (!isNewSessionShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      startNewSession();
    }, true);

    textarea?.addEventListener('keydown', (event) => {
      if (handleSlashMenuKeydown(event)) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });

    textarea?.addEventListener('input', () => {
      syncComposer({ preserveBottom: true });
      syncSlashMenu();
    });

    textarea?.addEventListener('click', syncSlashMenu);
    textarea?.addEventListener('keyup', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        syncSlashMenu();
      }
    });

    slashMenuElement?.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    slashMenuElement?.addEventListener('click', (event) => {
      const item = event.target?.closest?.('.composer__slash-item');

      if (!item) {
        return;
      }

      const index = Number(item.getAttribute('data-index'));
      const command = slashMenuItems[index];

      if (command) {
        acceptSlashCommand(command);
      }
    });

    function render() {
      const shouldStickToBottom = isMessagesAtBottom();
      messagesElement.replaceChildren();

      if (state.messages.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Ask Pi about this workspace.';
        messagesElement.append(empty);
      }

      for (const message of state.messages) {
        messagesElement.append(createMessageElement(message));
      }

      if (state.busy) {
        const status = document.createElement('div');
        status.className = 'status';
        const spinner = document.createElement('span');
        spinner.className = 'status__spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = getBusyStatusText();
        status.append(spinner, text);
        messagesElement.append(status);
      }

      syncModelLabel();
      syncComposer();
      syncSlashMenu();
      if (shouldStickToBottom) {
        scrollMessagesToBottom();
      }
    }

    function createMessageElement(message) {
      const article = document.createElement('article');
      article.className = \`message message--\${message.role}\${message.error ? ' message--error' : ''}\`;

      const role = document.createElement('div');
      role.className = 'message__role';
      role.textContent = roleLabel(message.role);

      const body = document.createElement('div');
      body.className = 'message__body';

      if (message.role === 'assistant' && !message.error) {
        renderMarkdownInto(body, message.text || '');
      } else {
        body.textContent = message.text || '';
      }

      article.append(role);

      const activities = Array.isArray(message.activities) ? message.activities : [];
      const hasBody = Boolean(message.text || message.error || activities.length === 0);

      if (message.role !== 'assistant') {
        article.append(body);
        return article;
      }

      if (activities.length > 0) {
        article.append(createActivityListElement(activities));
      }

      if (hasBody) {
        if (activities.length > 0) {
          body.classList.add('message__body--after-activities');
        }

        article.append(body);
      }

      return article;
    }

    function renderMarkdownInto(element, text) {
      if (!markdownRenderer || !window.DOMPurify) {
        element.textContent = text;
        return;
      }

      element.classList.add('message__body--markdown');

      const rendered = markdownRenderer.render(text);
      element.innerHTML = window.DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true }
      });
    }

    function highlightCode(code, language) {
      if (!window.hljs || typeof language !== 'string' || language.length === 0) {
        return escapeHtml(code);
      }

      const normalizedLanguage = normalizeCodeLanguage(language);

      if (!window.hljs.getLanguage(normalizedLanguage)) {
        return escapeHtml(code);
      }

      try {
        return window.hljs.highlight(code, {
          language: normalizedLanguage,
          ignoreIllegals: true
        }).value;
      } catch {
        return escapeHtml(code);
      }
    }

    function normalizeCodeLanguage(language) {
      const normalized = language.toLowerCase().trim();
      const aliases = {
        cjs: 'javascript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        shell: 'bash',
        sh: 'bash',
        ts: 'typescript',
        tsx: 'typescript',
        yml: 'yaml'
      };

      return aliases[normalized] || normalized;
    }

    function escapeHtml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function createActivityListElement(activities) {
      const list = document.createElement('div');
      list.className = 'activity-list';

      for (const activity of activities) {
        list.append(createActivityElement(activity));
      }

      return list;
    }

    function createActivityElement(activity) {
      const details = document.createElement('details');
      details.className = \`activity activity--\${activity.kind || 'rpc'} activity--\${activity.status || 'info'}\`;

      const activityId = typeof activity.id === 'string' ? activity.id : '';
      const savedOpenState = activityExpansion.get(activityId);
      details.open = typeof savedOpenState === 'boolean'
        ? savedOpenState
        : activity.status === 'running' || shouldKeepActivityOpen(activity);

      details.addEventListener('toggle', () => {
        if (activityId) {
          activityExpansion.set(activityId, details.open);
        }
      });

      const summary = document.createElement('summary');
      summary.className = 'activity__summary';

      const title = document.createElement('span');
      title.className = 'activity__title';
      title.textContent = typeof activity.title === 'string' ? activity.title : 'Activity';

      const status = document.createElement('span');
      status.className = 'activity__status';
      status.textContent = activityStatusLabel(activity.status);

      summary.append(title, status);

      if (typeof activity.summary === 'string' && activity.summary.length > 0) {
        const description = document.createElement('span');
        description.className = 'activity__description';
        description.textContent = activity.summary;
        summary.append(description);
      }

      details.append(summary);

      if (typeof activity.body === 'string' && activity.body.length > 0) {
        const body = document.createElement(activity.code ? 'pre' : 'div');
        body.className = \`activity__body\${activity.code ? ' activity__body--code' : ' activity__body--markdown'}\`;

        if (activity.code) {
          body.textContent = activity.body;
        } else {
          renderMarkdownInto(body, activity.body);
        }

        details.append(body);
      }

      return details;
    }

    function shouldKeepActivityOpen(activity) {
      return activity.kind === 'thinking'
        && typeof activity.body === 'string'
        && activity.body.length > 0;
    }

    function roleLabel(role) {
      if (role === 'user') {
        return 'You';
      }

      if (role === 'assistant') {
        return 'Pi';
      }

      return 'System';
    }

    function syncSubmit() {
      const isStopMode = isStopSubmitMode();
      const hasInput = textarea.value.length > 0;
      const hasSendableText = textarea.value.trim().length > 0;
      const label = getSubmitLabel(isStopMode);
      submitButton.disabled = state.busy ? (hasInput && !hasSendableText) : !hasSendableText;
      submitButton.classList.toggle('composer__submit--stop', isStopMode);
      submitButton.setAttribute('aria-label', label);
      submitButton.title = label;
    }

    function getSubmitLabel(isStopMode) {
      if (isStopMode) {
        return 'Stop current response';
      }

      if (state.busy) {
        return streamingBehavior === 'followUp' ? 'Queue follow-up' : 'Steer current run';
      }

      return 'Send message';
    }

    function isStopSubmitMode() {
      return state.busy && textarea.value.length === 0;
    }

    function syncBusySubmitMode() {
      if (!busySubmitElement || !busySubmitHintElement) {
        return;
      }

      setBusySubmitVisible(state.busy);

      if (!state.busy) {
        return;
      }

      const hasSendableText = textarea.value.trim().length > 0;
      busySubmitHintElement.textContent = hasSendableText
        ? streamingBehavior === 'followUp'
          ? 'This will run after Pi finishes the current task.'
          : "This will steer the current run before Pi's next LLM call."
        : 'Type to steer Pi, or leave empty to stop.';

      for (const button of streamingBehaviorButtonElements) {
        const isActive = button.getAttribute('data-streaming-behavior') === streamingBehavior;
        button.classList.toggle('composer__mode-button--active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
    }

    function setBusySubmitVisible(visible) {
      if (!busySubmitElement) {
        return;
      }

      if (busySubmitHideTimeout) {
        clearTimeout(busySubmitHideTimeout);
        busySubmitHideTimeout = undefined;
      }

      if (visible) {
        busySubmitElement.hidden = false;
        requestAnimationFrame(() => {
          busySubmitElement.classList.add('composer__busy-submit--visible');
        });
        return;
      }

      busySubmitElement.classList.remove('composer__busy-submit--visible');
      busySubmitHideTimeout = setTimeout(() => {
        if (!state.busy) {
          busySubmitElement.hidden = true;
        }
      }, 160);
    }

    function activityStatusLabel(status) {
      if (status === 'running') {
        return 'Running';
      }

      if (status === 'completed') {
        return 'Done';
      }

      if (status === 'error') {
        return 'Error';
      }

      return 'Info';
    }

    function getBusyStatusText() {
      const activity = getLatestRunningActivity();

      if (!activity) {
        return 'Pi is working...';
      }

      const title = typeof activity.title === 'string' && activity.title
        ? activity.title
        : 'Pi is working';
      const summary = typeof activity.summary === 'string' && activity.summary
        ? ': ' + activity.summary
        : '';

      return title + summary;
    }

    function getLatestRunningActivity() {
      for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const activities = Array.isArray(state.messages[messageIndex].activities)
          ? state.messages[messageIndex].activities
          : [];

        for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
          if (activities[activityIndex]?.status === 'running') {
            return activities[activityIndex];
          }
        }
      }

      return undefined;
    }

    function syncModelLabel() {
      contextValueElement.textContent = state.contextUsageLabel;
      contextTooltipElement.textContent = state.contextUsageTitle;
      contextElement.title = state.contextUsageTitle;
      contextElement.className = 'composer__context' + (state.contextUsageLevel ? ' composer__context--' + state.contextUsageLevel : '');
      contextElement.hidden = state.contextUsageLabel.length === 0;

      const label = state.modelLabel || 'Select model';
      modelElement.textContent = label;
      modelElement.className = 'composer__model' + (state.metadataRefreshing ? ' composer__model--refreshing' : '');
      modelElement.title = state.metadataRefreshing
        ? label + ' (refreshing...)'
        : state.modelOptions.length === 0 && !state.busy
        ? 'Load model settings'
        : label;
      modelElement.disabled = state.busy;
      modelElement.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');
      modelMenuElement?.setAttribute('aria-busy', state.metadataRefreshing ? 'true' : 'false');

      syncModelSelect();
      syncThinkingSelect();
    }

    function syncModelSelect() {
      const selectedValue = modelKey(state.modelProvider, state.modelId);
      const currentValue = modelSelectElement.value;
      const modelOptions = getDisplayModelOptions();
      modelSelectElement.replaceChildren();

      for (const model of modelOptions) {
        if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') {
          continue;
        }

        const option = document.createElement('option');
        option.value = modelKey(model.provider, model.id);
        option.textContent = model.name && model.name !== model.id
          ? model.name + ' (' + model.provider + '/' + model.id + ')'
          : model.provider + '/' + model.id;
        modelSelectElement.append(option);
      }

      modelSelectElement.value = selectedValue || currentValue;
      modelSelectElement.disabled = state.busy || modelOptions.length === 0;
    }

    function getDisplayModelOptions() {
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

    function syncThinkingSelect() {
      thinkingSelectElement.value = state.thinkingLevel || 'medium';
      thinkingSelectElement.disabled = state.busy || !state.modelReasoning;
      thinkingSelectElement.title = state.modelReasoning
        ? 'Thinking mode'
        : 'The selected model does not advertise thinking support.';
    }

    function toggleModelMenu() {
      if (modelElement.disabled) {
        return;
      }

      if (state.modelOptions.length === 0 && !state.metadataRefreshing) {
        vscode.postMessage({ type: 'refreshMetadata' });
      }

      const open = !modelMenuElement.hasAttribute('open');
      modelMenuElement.toggleAttribute('open', open);
      modelElement.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeModelMenu() {
      modelMenuElement?.removeAttribute('open');
      modelElement?.setAttribute('aria-expanded', 'false');
    }

    function selectModel() {
      const [provider, modelId] = splitModelKey(modelSelectElement.value);

      if (!provider || !modelId || state.busy) {
        return;
      }

      vscode.postMessage({ type: 'setModel', provider, modelId });
    }

    function selectThinkingLevel() {
      const level = thinkingSelectElement.value;

      if (!level || state.busy || !state.modelReasoning) {
        return;
      }

      vscode.postMessage({ type: 'setThinkingLevel', level });
    }

    function handleSlashMenuKeydown(event) {
      if (!slashMenuOpen) {
        if (event.key === 'Escape') {
          closeSlashMenu();
        }

        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashMenuSelection(1);
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashMenuSelection(-1);
        return true;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        acceptActiveSlashCommand();
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey && slashMenuItems.length > 0) {
        event.preventDefault();
        acceptActiveSlashCommand();
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSlashMenu();
        return true;
      }

      return false;
    }

    function syncSlashMenu() {
      if (!shouldShowSlashMenu()) {
        closeSlashMenu();
        return;
      }

      closeModelMenu();
      if (!state.slashCommandsRefreshing && !slashCommandsRefreshRequested) {
        slashCommandsRefreshRequested = true;
        vscode.postMessage({ type: 'refreshSlashCommands' });
      }

      const query = getSlashCommandQuery();
      slashMenuItems = getFilteredSlashCommands(query);
      slashMenuActiveIndex = Math.min(slashMenuActiveIndex, Math.max(0, slashMenuItems.length - 1));
      renderSlashMenu(query);
      openSlashMenu();
    }

    function shouldShowSlashMenu() {
      if (!textarea || state.busy) {
        return false;
      }

      const cursor = textarea.selectionStart;

      if (cursor !== textarea.selectionEnd) {
        return false;
      }

      const beforeCursor = textarea.value.slice(0, cursor);
      return beforeCursor.startsWith('/')
        && !Array.from(beforeCursor).some((character) => character.trim().length === 0);
    }

    function getSlashCommandQuery() {
      return textarea.value.slice(1, textarea.selectionStart).toLowerCase();
    }

    function getFilteredSlashCommands(query) {
      const commands = getAllSlashCommands();
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

    function getAllSlashCommands() {
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

    function getSlashCommandSourceRank(source) {
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

    function renderSlashMenu(query) {
      slashMenuElement.replaceChildren();

      if (state.slashCommandsRefreshing && slashMenuItems.length === 0) {
        slashMenuElement.append(createSlashMenuEmptyElement('Loading commands...'));
        return;
      }

      if (slashMenuItems.length === 0) {
        slashMenuElement.append(createSlashMenuEmptyElement(query ? 'No matching slash commands' : 'No slash commands available'));
        return;
      }

      for (let index = 0; index < slashMenuItems.length; index += 1) {
        slashMenuElement.append(createSlashMenuItemElement(slashMenuItems[index], index));
      }

      syncSlashMenuActiveDescendant();
    }

    function createSlashMenuEmptyElement(text) {
      const empty = document.createElement('div');
      empty.className = 'composer__slash-empty';
      empty.textContent = text;
      return empty;
    }

    function createSlashMenuItemElement(command, index) {
      const item = document.createElement('button');
      item.type = 'button';
      item.id = 'slash-command-' + index;
      item.className = 'composer__slash-item' + (index === slashMenuActiveIndex ? ' composer__slash-item--active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === slashMenuActiveIndex ? 'true' : 'false');
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

    function formatSlashCommandMeta(command) {
      const source = typeof command.source === 'string' ? command.source : '';
      const location = typeof command.location === 'string' ? command.location : '';

      if (source && location) {
        return source + ' · ' + location;
      }

      return source || location;
    }

    function openSlashMenu() {
      if (!slashMenuElement) {
        return;
      }

      slashMenuOpen = true;
      slashMenuElement.setAttribute('open', '');
      textarea?.setAttribute('aria-expanded', 'true');
      syncSlashMenuActiveDescendant();
    }

    function closeSlashMenu() {
      slashMenuOpen = false;
      slashMenuItems = [];
      slashMenuActiveIndex = 0;
      slashMenuElement?.removeAttribute('open');
      textarea?.setAttribute('aria-expanded', 'false');
      textarea?.removeAttribute('aria-activedescendant');
    }

    function moveSlashMenuSelection(delta) {
      if (slashMenuItems.length === 0) {
        return;
      }

      slashMenuActiveIndex = (slashMenuActiveIndex + delta + slashMenuItems.length) % slashMenuItems.length;
      renderSlashMenu(getSlashCommandQuery());
    }

    function syncSlashMenuActiveDescendant() {
      if (!slashMenuOpen || slashMenuItems.length === 0) {
        textarea?.removeAttribute('aria-activedescendant');
        return;
      }

      textarea?.setAttribute('aria-activedescendant', 'slash-command-' + slashMenuActiveIndex);
      slashMenuElement?.querySelector('.composer__slash-item--active')?.scrollIntoView({ block: 'nearest' });
    }

    function acceptActiveSlashCommand() {
      const command = slashMenuItems[slashMenuActiveIndex];

      if (command) {
        acceptSlashCommand(command);
      }
    }

    function acceptSlashCommand(command) {
      const cursor = textarea.selectionStart;
      const after = textarea.value.slice(cursor).trimStart();
      const value = '/' + command.name + ' ' + after;
      const nextCursor = command.name.length + 2;
      textarea.value = value;
      textarea.setSelectionRange(nextCursor, nextCursor);
      closeSlashMenu();
      syncComposer({ preserveBottom: true });
      focusPromptInput();
    }

    function modelKey(provider, id) {
      return provider + '/' + id;
    }

    function splitModelKey(value) {
      const slashIndex = value.indexOf('/');

      if (slashIndex <= 0) {
        return ['', ''];
      }

      return [value.slice(0, slashIndex), value.slice(slashIndex + 1)];
    }

    function isMessagesAtBottom() {
      const distanceFromBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight;
      return distanceFromBottom <= messagesBottomThreshold;
    }

    function scrollMessagesToBottom() {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }

    function syncTextareaHeight() {
      textarea.style.height = 'auto';

      const maxHeight = getMaxTextareaHeight();
      const nextHeight = Math.max(minTextareaHeight, Math.min(textarea.scrollHeight, maxHeight));
      textarea.style.height = nextHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function getMaxTextareaHeight() {
      const reservedMessagesHeight = getReservedMessagesHeight();
      const composerChromeHeight = getComposerChromeHeight();
      const availableHeight = window.innerHeight - reservedMessagesHeight - composerChromeHeight;
      return Math.max(minTextareaHeight, Math.min(maxTextareaHeight, availableHeight));
    }

    function getReservedMessagesHeight() {
      return Math.min(72, Math.max(40, Math.floor(window.innerHeight * 0.18)));
    }

    function getComposerChromeHeight() {
      const composerStyles = getComputedStyle(form);
      const composerMarginHeight = parseCssPixelValue(composerStyles.marginTop) + parseCssPixelValue(composerStyles.marginBottom);
      const composerHeight = form.getBoundingClientRect().height + composerMarginHeight;
      const textareaHeight = textarea.getBoundingClientRect().height;
      return Math.max(0, composerHeight - textareaHeight);
    }

    function parseCssPixelValue(value) {
      return Number.parseFloat(value) || 0;
    }

    function syncComposer(options = {}) {
      const shouldPreserveBottom = Boolean(options.preserveBottom) && isMessagesAtBottom();
      syncSubmit();
      syncBusySubmitMode();
      syncTextareaHeight();

      if (shouldPreserveBottom) {
        scrollMessagesToBottom();
      }
    }

    function startNewSession() {
      vscode.postMessage({ type: 'newSession' });
      focusPromptInput();
    }

    function isNewSessionShortcut(event) {
      if (event.key.toLowerCase() !== 'n' || event.shiftKey || event.altKey) {
        return false;
      }

      if (isMac) {
        return event.metaKey && !event.ctrlKey;
      }

      return event.ctrlKey && !event.metaKey;
    }

    function focusPromptInput() {
      requestAnimationFrame(() => {
        textarea.focus({ preventScroll: true });
      });
    }

    vscode.postMessage({ type: 'ready' });
    window.addEventListener('resize', () => {
      syncComposer({ preserveBottom: true });
    });
    render();`;
