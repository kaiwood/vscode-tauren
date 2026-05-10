export const chatWebviewScript = /* javascript */ `    const vscode = acquireVsCodeApi();
    const toolbarTitleElement = document.querySelector('.pi-toolbar__title');
    const toolbarTitleTextElement = document.querySelector('.pi-toolbar__title-text');
    const sessionToggleButton = document.querySelector('.pi-toolbar__sessions');
    const sessionMenuElement = document.querySelector('.pi-toolbar__session-menu');
    const messagesElement = document.querySelector('.messages');
    const sessionsElement = document.querySelector('.sessions');
    const form = document.querySelector('.composer');
    const textarea = document.querySelector('textarea');
    const slashMenuElement = document.querySelector('.composer__slash-menu');
    const contextBadgesElement = document.querySelector('.composer__context-badges');
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
    let state = { messages: [], busy: false, modelLabel: '', modelProvider: '', modelId: '', modelReasoning: false, thinkingLevel: '', modelOptions: [], contextUsageLabel: '', contextUsageTitle: '', contextUsageLevel: '', metadataRefreshing: false, slashCommands: [], slashCommandsRefreshing: false, promptContext: [], composerText: '', composerTextRevision: 0, viewMode: 'chat', sessions: [], sessionsRefreshing: false, sessionsError: '', currentSessionFile: '' };
    let appliedComposerTextRevision = 0;
    let slashMenuOpen = false;
    let slashMenuActiveIndex = 0;
    let slashMenuItems = [];
    let slashMenuQuery = '';
    let slashMenuDismissedQuery;
    let slashCommandsRefreshRequested = false;
    let streamingBehavior = 'steer';
    let busySubmitHideTimeout;
    let sessionListSelectedIndex = 0;
    let sessionMenuOpen = false;
    let sessionMenuItems = [];
    const maxSessionMenuItems = 20;
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
      { name: 'fork', description: 'Fork from a previous user message', source: 'builtin' },
      { name: 'clone', description: 'Duplicate the current session', source: 'builtin' },
      { name: 'tree', description: 'Open session switcher', source: 'builtin' },
      { name: 'login', description: 'Terminal-only: run pi in a terminal to authenticate', source: 'unsupported' },
      { name: 'logout', description: 'Terminal-only: run pi in a terminal to manage auth', source: 'unsupported' },
      { name: 'resume', description: 'Resume a different session', source: 'builtin' },
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

      const previousViewMode = state.viewMode;
      const previousCurrentSessionFile = state.currentSessionFile;
      const previousSessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
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
        slashCommandsRefreshing: Boolean(event.data.slashCommandsRefreshing),
        promptContext: Array.isArray(event.data.promptContext) ? event.data.promptContext : [],
        composerText: typeof event.data.composerText === 'string' ? event.data.composerText : '',
        composerTextRevision: typeof event.data.composerTextRevision === 'number' ? event.data.composerTextRevision : 0,
        viewMode: event.data.viewMode === 'sessions' ? 'sessions' : 'chat',
        sessions: Array.isArray(event.data.sessions) ? event.data.sessions : [],
        sessionsRefreshing: Boolean(event.data.sessionsRefreshing),
        sessionsError: typeof event.data.sessionsError === 'string' ? event.data.sessionsError : '',
        currentSessionFile: typeof event.data.currentSessionFile === 'string' ? event.data.currentSessionFile : ''
      };
      if (
        state.viewMode === 'sessions'
        && (previousViewMode !== 'sessions'
          || previousCurrentSessionFile !== state.currentSessionFile
          || previousSessionCount === 0)
      ) {
        selectCurrentSession();
      }
      render();
      applyComposerTextFromState();
    });

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = textarea.value.trim();

      if (!text) {
        return;
      }

      closeSlashMenu();
      closeSessionMenu();
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
    sessionToggleButton?.addEventListener('click', toggleSessionView);
    toolbarTitleElement?.addEventListener('click', toggleSessionMenu);
    sessionMenuElement?.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    sessionMenuElement?.addEventListener('click', (event) => {
      const item = event.target?.closest?.('.pi-toolbar__session-item');

      if (!item) {
        return;
      }

      const index = Number(item.getAttribute('data-index'));
      const session = sessionMenuItems[index];

      if (session?.path) {
        closeSessionMenu();
        selectSessionByPath(session.path);
      }
    });
    sessionsElement?.addEventListener('keydown', handleSessionListKeydown);
    sessionsElement?.addEventListener('click', (event) => {
      const item = event.target?.closest?.('.sessions__item');

      if (!item) {
        return;
      }

      const index = Number(item.getAttribute('data-index'));
      selectSessionIndex(index);
    });
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

      if (sessionMenuOpen) {
        if (!sessionMenuElement?.contains(event.target) && !toolbarTitleElement?.contains(event.target)) {
          closeSessionMenu();
        }
      }
    });

    window.addEventListener('keydown', (event) => {
      if (state.viewMode === 'sessions' && handleSessionListKeydown(event)) {
        return;
      }

      if (event.key === 'Escape') {
        dismissSlashMenu();
        closeModelMenu();
        closeSessionMenu();
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
      slashMenuDismissedQuery = undefined;
      syncComposer({ preserveBottom: true });
      syncSlashMenu();
    });

    textarea?.addEventListener('click', syncSlashMenu);
    textarea?.addEventListener('blur', closeSlashMenu);
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

    contextBadgesElement?.addEventListener('mousedown', (event) => {
      if (event.target?.closest?.('.composer__context-remove')) {
        event.preventDefault();
      }
    });

    contextBadgesElement?.addEventListener('click', (event) => {
      const removeButton = event.target?.closest?.('.composer__context-remove');

      if (!removeButton) {
        return;
      }

      const id = removeButton.getAttribute('data-context-id');

      if (!id) {
        return;
      }

      vscode.postMessage({ type: 'removePromptContext', id });
      focusPromptInput();
    });

    function render() {
      const isSessionView = state.viewMode === 'sessions';
      const shouldStickToBottom = !isSessionView && isMessagesAtBottom();
      messagesElement.hidden = isSessionView;
      sessionsElement.hidden = !isSessionView;
      form.hidden = isSessionView;
      const toolbarTitle = isSessionView ? 'Sessions' : getCurrentSessionTitle();
      if (toolbarTitleTextElement) {
        toolbarTitleTextElement.textContent = toolbarTitle;
      }
      toolbarTitleElement.title = isSessionView ? 'Sessions' : toolbarTitle;
      toolbarTitleElement.disabled = isSessionView;
      sessionToggleButton.title = isSessionView ? 'Back to chat' : 'Show sessions';
      sessionToggleButton.setAttribute('aria-label', sessionToggleButton.title);
      sessionToggleButton.classList.toggle('pi-toolbar__sessions--back', isSessionView);
      renderSessionMenu();

      if (isSessionView) {
        renderSessions();
        closeSlashMenu();
        closeModelMenu();
        closeSessionMenu();
        requestAnimationFrame(() => sessionsElement?.focus({ preventScroll: true }));
        return;
      }

      messagesElement.replaceChildren();

      if (state.messages.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Ask Pi about this workspace.';
        messagesElement.append(empty);
      }

      let previousMessageRole;

      for (const message of state.messages) {
        const showRole = message.role !== previousMessageRole;
        messagesElement.append(createMessageElement(message, showRole));
        previousMessageRole = message.role;
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
      syncPromptContextBadges();
      syncComposer();
      syncSlashMenu();
      if (shouldStickToBottom) {
        scrollMessagesToBottom();
      }
    }

    function renderSessions() {
      sessionsElement.replaceChildren();
      sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex);

      const header = document.createElement('div');
      header.className = 'sessions__header';
      const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
      header.textContent = state.sessionsRefreshing
        ? 'Loading sessions...'
        : count === 1
        ? '1 session'
        : count + ' sessions';
      sessionsElement.append(header);

      if (state.sessionsError) {
        const error = document.createElement('div');
        error.className = 'sessions__error';
        error.textContent = state.sessionsError;
        sessionsElement.append(error);
      }

      if (state.sessionsRefreshing && count === 0) {
        sessionsElement.append(createSessionEmptyElement('Loading sessions...'));
        return;
      }

      if (count === 0) {
        sessionsElement.append(createSessionEmptyElement('No sessions found for this workspace.'));
        return;
      }

      for (let index = 0; index < state.sessions.length; index += 1) {
        sessionsElement.append(createSessionItemElement(state.sessions[index], index));
      }
    }

    function createSessionEmptyElement(text) {
      const empty = document.createElement('div');
      empty.className = 'sessions__empty';
      empty.textContent = text;
      return empty;
    }

    function createSessionItemElement(session, index) {
      const item = document.createElement('button');
      item.type = 'button';
      item.id = 'session-' + index;
      item.className = 'sessions__item'
        + (index === sessionListSelectedIndex ? ' sessions__item--active' : '')
        + (session.current ? ' sessions__item--current' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === sessionListSelectedIndex ? 'true' : 'false');
      item.setAttribute('data-index', String(index));
      item.disabled = state.busy || state.sessionsRefreshing;

      const prefix = document.createElement('span');
      prefix.className = 'sessions__prefix';
      prefix.textContent = buildSessionTreePrefix(session);
      item.append(prefix);

      const title = document.createElement('span');
      title.className = 'sessions__title';
      title.textContent = getSessionDisplayName(session);
      item.append(title);

      const meta = document.createElement('span');
      meta.className = 'sessions__meta';
      meta.textContent = formatSessionMeta(session);
      item.append(meta);

      if (session.cwd) {
        const cwd = document.createElement('span');
        cwd.className = 'sessions__cwd';
        cwd.textContent = shortenPath(session.cwd);
        item.append(cwd);
      }

      return item;
    }

    function getCurrentSessionTitle() {
      const session = getCurrentSession();

      if (session) {
        return getSessionDisplayName(session);
      }

      if (state.currentSessionFile) {
        return 'Current session';
      }

      return state.messages.length === 0 ? 'New session' : 'Current session';
    }

    function getCurrentSession() {
      if (!Array.isArray(state.sessions) || state.sessions.length === 0 || !state.currentSessionFile) {
        return undefined;
      }

      return state.sessions.find((session) => session.path === state.currentSessionFile)
        ?? state.sessions.find((session) => session.current);
    }

    function getSessionDisplayName(session) {
      const title = sanitizeSessionTitle(session?.name || session?.firstMessage || '');
      return title || '(no messages)';
    }

    function sanitizeSessionTitle(value) {
      if (typeof value !== 'string') {
        return '';
      }

      return value
        .replace(/<\\/?[A-Za-z][^>\\n]*(?:>|$)/g, '')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    function buildSessionTreePrefix(session) {
      const depth = Number(session.depth) || 0;

      if (depth <= 0) {
        return '';
      }

      const ancestors = Array.isArray(session.ancestorContinues) ? session.ancestorContinues : [];
      const parts = ancestors.map((continues) => continues ? '│  ' : '   ');
      parts.push(session.isLast ? '└─ ' : '├─ ');
      return parts.join('');
    }

    function formatSessionMeta(session) {
      const count = typeof session.messageCount === 'number' ? session.messageCount : 0;
      const age = formatRelativeTime(session.modified);
      return count + ' ' + age + (session.current ? ' · current' : '');
    }

    function formatRelativeTime(value) {
      const date = new Date(value);
      const time = date.getTime();

      if (Number.isNaN(time)) {
        return '';
      }

      const diffMs = Math.max(0, Date.now() - time);
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        return 'now';
      }

      if (diffMins < 60) {
        return diffMins + 'm';
      }

      if (diffHours < 24) {
        return diffHours + 'h';
      }

      if (diffDays < 7) {
        return diffDays + 'd';
      }

      if (diffDays < 30) {
        return Math.floor(diffDays / 7) + 'w';
      }

      if (diffDays < 365) {
        return Math.floor(diffDays / 30) + 'mo';
      }

      return Math.floor(diffDays / 365) + 'y';
    }

    function shortenPath(path) {
      if (typeof path !== 'string') {
        return '';
      }

      return path.replace(/^\\/Users\\/[^/]+/, '~');
    }

    function handleSessionListKeydown(event) {
      if (state.viewMode !== 'sessions') {
        return false;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ type: 'hideSessions' });
        focusPromptInput();
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        moveSessionSelection(1);
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        moveSessionSelection(-1);
        return true;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        selectSessionIndex(sessionListSelectedIndex);
        return true;
      }

      return false;
    }

    function moveSessionSelection(delta) {
      if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
        return;
      }

      sessionListSelectedIndex = clampSessionIndex(sessionListSelectedIndex + delta);
      renderSessions();
      document.getElementById('session-' + sessionListSelectedIndex)?.scrollIntoView({ block: 'nearest' });
    }

    function selectSessionIndex(index) {
      const session = Array.isArray(state.sessions) ? state.sessions[index] : undefined;

      if (!session?.path) {
        return;
      }

      selectSessionByPath(session.path);
    }

    function selectSessionByPath(sessionPath) {
      if (!sessionPath || state.busy || state.sessionsRefreshing) {
        return;
      }

      vscode.postMessage({ type: 'selectSession', sessionPath });
    }

    function clampSessionIndex(index) {
      const count = Array.isArray(state.sessions) ? state.sessions.length : 0;

      if (count === 0) {
        return 0;
      }

      return Math.max(0, Math.min(index, count - 1));
    }

    function selectCurrentSession() {
      const currentIndex = Array.isArray(state.sessions)
        ? state.sessions.findIndex((session) => session.current || session.path === state.currentSessionFile)
        : -1;
      sessionListSelectedIndex = currentIndex >= 0 ? currentIndex : 0;
    }

    function toggleSessionMenu(event) {
      event?.preventDefault();
      event?.stopPropagation();

      if (state.viewMode === 'sessions') {
        return;
      }

      if (sessionMenuOpen) {
        closeSessionMenu();
        return;
      }

      openSessionMenu();
    }

    function openSessionMenu() {
      if (!sessionMenuElement) {
        return;
      }

      closeSlashMenu();
      closeModelMenu();

      if (!state.sessionsRefreshing && (!Array.isArray(state.sessions) || state.sessions.length === 0)) {
        vscode.postMessage({ type: 'refreshSessions' });
      }

      sessionMenuOpen = true;
      sessionMenuElement.setAttribute('open', '');
      toolbarTitleElement?.setAttribute('aria-expanded', 'true');
      renderSessionMenu();
    }

    function closeSessionMenu() {
      sessionMenuOpen = false;
      sessionMenuItems = [];
      sessionMenuElement?.removeAttribute('open');
      toolbarTitleElement?.setAttribute('aria-expanded', 'false');
    }

    function renderSessionMenu() {
      if (!sessionMenuElement) {
        return;
      }

      sessionMenuElement.replaceChildren();

      if (!sessionMenuOpen) {
        return;
      }

      if (state.sessionsRefreshing && (!Array.isArray(state.sessions) || state.sessions.length === 0)) {
        sessionMenuElement.append(createSessionMenuEmptyElement('Loading sessions...'));
        return;
      }

      if (state.sessionsError) {
        sessionMenuElement.append(createSessionMenuEmptyElement(state.sessionsError));
        return;
      }

      sessionMenuItems = Array.isArray(state.sessions)
        ? state.sessions.slice(0, maxSessionMenuItems)
        : [];

      if (sessionMenuItems.length === 0) {
        sessionMenuElement.append(createSessionMenuEmptyElement('No sessions found for this workspace.'));
        return;
      }

      for (let index = 0; index < sessionMenuItems.length; index += 1) {
        sessionMenuElement.append(createSessionMenuItemElement(sessionMenuItems[index], index));
      }
    }

    function createSessionMenuItemElement(session, index) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pi-toolbar__session-item' + (session.current || session.path === state.currentSessionFile ? ' pi-toolbar__session-item--current' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', session.current || session.path === state.currentSessionFile ? 'true' : 'false');
      item.setAttribute('data-index', String(index));

      const title = document.createElement('span');
      title.className = 'pi-toolbar__session-title';
      title.textContent = getSessionDisplayName(session);
      item.append(title);

      const meta = document.createElement('span');
      meta.className = 'pi-toolbar__session-meta';
      meta.textContent = formatSessionMeta(session);
      item.append(meta);

      return item;
    }

    function createSessionMenuEmptyElement(text) {
      const empty = document.createElement('div');
      empty.className = 'pi-toolbar__session-empty';
      empty.textContent = text;
      return empty;
    }

    function toggleSessionView() {
      if (state.viewMode === 'sessions') {
        vscode.postMessage({ type: 'hideSessions' });
        focusPromptInput();
        return;
      }

      vscode.postMessage({ type: 'showSessions' });
    }

    function createMessageElement(message, showRole) {
      const article = document.createElement('article');
      article.className = \`message message--\${message.role}\${message.error ? ' message--error' : ''}\${message.variant === 'thinking' ? ' message--thinking' : ''}\`;

      const body = document.createElement('div');
      body.className = 'message__body';

      if (message.role === 'assistant' && !message.error && message.variant !== 'thinking') {
        renderMarkdownInto(body, message.text || '');
      } else {
        body.textContent = message.text || '';
      }

      if (showRole) {
        const role = document.createElement('div');
        role.className = 'message__role';
        role.textContent = roleLabel(message.role);
        article.append(role);
      }

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

    function syncPromptContextBadges() {
      if (!contextBadgesElement) {
        return;
      }

      const attachments = Array.isArray(state.promptContext)
        ? state.promptContext.filter(isPromptContextAttachment)
        : [];
      form?.classList.toggle('composer--has-context', attachments.length > 0);
      contextBadgesElement.hidden = attachments.length === 0;
      contextBadgesElement.replaceChildren();

      for (const attachment of attachments) {
        const badge = document.createElement('span');
        badge.className = 'composer__context-badge';
        badge.title = attachment.title || attachment.label;

        const label = document.createElement('span');
        label.className = 'composer__context-label';
        label.textContent = attachment.label;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'composer__context-remove';
        remove.setAttribute('data-context-id', attachment.id);
        remove.setAttribute('aria-label', 'Remove context ' + attachment.label);
        remove.title = 'Remove context';
        remove.textContent = '×';

        badge.append(label, remove);
        contextBadgesElement.append(badge);
      }
    }

    function isPromptContextAttachment(value) {
      return value
        && typeof value.id === 'string'
        && typeof value.label === 'string'
        && typeof value.title === 'string';
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

      closeSessionMenu();
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

      closeModelMenu();
      vscode.postMessage({ type: 'setModel', provider, modelId });
    }

    function selectThinkingLevel() {
      const level = thinkingSelectElement.value;

      if (!level || state.busy || !state.modelReasoning) {
        return;
      }

      closeModelMenu();
      vscode.postMessage({ type: 'setThinkingLevel', level });
    }

    function handleSlashMenuKeydown(event) {
      if (!slashMenuOpen) {
        if (event.key === 'Escape') {
          dismissSlashMenu();
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
        dismissSlashMenu();
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
      closeSessionMenu();
      if (
        state.slashCommands.length === 0
        && !state.slashCommandsRefreshing
        && !slashCommandsRefreshRequested
      ) {
        slashCommandsRefreshRequested = true;
        vscode.postMessage({ type: 'refreshSlashCommands' });
      }

      const query = getSlashCommandQuery();
      if (query === slashMenuDismissedQuery) {
        closeSlashMenu();
        return;
      }

      if (query !== slashMenuQuery) {
        slashMenuQuery = query;
        slashMenuActiveIndex = 0;
        if (slashMenuElement) {
          slashMenuElement.scrollTop = 0;
        }
      }

      slashMenuItems = getFilteredSlashCommands(query);
      slashMenuActiveIndex = Math.min(slashMenuActiveIndex, Math.max(0, slashMenuItems.length - 1));
      renderSlashMenu(query);
      openSlashMenu();
    }

    function shouldShowSlashMenu() {
      if (!textarea || state.busy || document.activeElement !== textarea) {
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

    function dismissSlashMenu() {
      slashMenuDismissedQuery = textarea ? getSlashCommandQuery() : undefined;
      closeSlashMenu();
    }

    function closeSlashMenu() {
      slashMenuOpen = false;
      slashCommandsRefreshRequested = false;
      slashMenuItems = [];
      slashMenuActiveIndex = 0;
      slashMenuQuery = '';
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

    function applyComposerTextFromState() {
      if (!textarea || state.composerTextRevision <= appliedComposerTextRevision) {
        return;
      }

      appliedComposerTextRevision = state.composerTextRevision;
      textarea.value = state.composerText;
      closeSlashMenu();
      syncComposer({ preserveBottom: true });
      focusPromptInput();
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
      render();
      syncComposer({ preserveBottom: true });
    });
    render();`;
