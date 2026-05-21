const baseStyles = /* css */ `    :root {
      color-scheme: light dark;
      --tau-code-foreground: var(--vscode-editor-foreground, var(--vscode-foreground));
      --tau-code-background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      --tau-code-inline-background: var(--vscode-textPreformat-background, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      --tau-ansi-black-fallback: #000000;
      --tau-ansi-red-fallback: #cd3131;
      --tau-ansi-green-fallback: #0dbc79;
      --tau-ansi-yellow-fallback: #e5e510;
      --tau-ansi-blue-fallback: #2472c8;
      --tau-ansi-magenta-fallback: #bc3fbc;
      --tau-ansi-cyan-fallback: #11a8cd;
      --tau-ansi-white-fallback: #e5e5e5;
      --tau-ansi-bright-black-fallback: #666666;
      --tau-ansi-bright-red-fallback: #f14c4c;
      --tau-ansi-bright-green-fallback: #23d18b;
      --tau-ansi-bright-yellow-fallback: #f5f543;
      --tau-ansi-bright-blue-fallback: #3b8eea;
      --tau-ansi-bright-magenta-fallback: #d670d6;
      --tau-ansi-bright-cyan-fallback: #29b8db;
      --tau-ansi-bright-white-fallback: #e5e5e5;
    }

    * {
      box-sizing: border-box;
      max-width: 100%;
    }

    body * {
      min-width: 0;
    }

    html,
    body {
      width: 100%;
      max-width: 100%;
      height: 100%;
    }

    body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      overflow-x: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    body.vscode-light {
      --tau-ansi-yellow-fallback: #949800;
      --tau-ansi-blue-fallback: #0451a5;
      --tau-ansi-white-fallback: #555555;
      --tau-ansi-bright-yellow-fallback: #795e26;
      --tau-ansi-bright-white-fallback: #222222;
    }

    .pi-view {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
      width: 100%;
      max-width: 100%;
      height: 100vh;
      padding: 0;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

`;

const toolbarStyles = /* css */ `    .pi-toolbar {
      position: relative;
      grid-row: 1;
      grid-column: 1;
      display: flex;
      align-items: center;
      gap: 2px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      min-height: 34px;
      padding: 3px 12px 2px 8px;
      overflow: visible;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .pi-toolbar__sessions,
    .pi-toolbar__tree {
      position: relative;
      display: grid;
      place-items: center;
      flex: 0 0 26px;
      width: 26px;
      max-width: 26px;
      height: 26px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      overflow: visible;
    }

    .pi-toolbar__sessions:hover,
    .pi-toolbar__sessions:focus-visible,
    .pi-toolbar__tree:hover,
    .pi-toolbar__tree:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .pi-toolbar__sessions svg,
    .pi-toolbar__tree svg {
      transition: transform 120ms ease;
    }

    .pi-toolbar__title {
      position: relative;
      display: flex;
      align-items: center;
      gap: 5px;
      flex: 1 1 0;
      width: 0;
      min-width: 0;
      max-width: none;
      contain: inline-size;
      height: 26px;
      padding: 0 5px;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: transparent;
      border: 0;
      border-radius: 5px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      line-height: 26px;
      text-align: left;
      white-space: nowrap;
    }

    .pi-toolbar__title-text {
      display: block;
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pi-toolbar__timestamp {
      display: block;
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pi-toolbar__timestamp[hidden] {
      display: none;
    }

    .pi-toolbar__title-input {
      width: 100%;
      height: 24px;
      margin: 1px 0;
      padding: 0 5px;
      color: var(--vscode-input-foreground, var(--vscode-foreground));
      background: var(--vscode-input-background, transparent);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      border-radius: 4px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      line-height: 22px;
      outline: none;
    }

    .pi-toolbar__title-input[hidden] {
      display: none;
    }

    .pi-toolbar__title--editing {
      padding: 0;
      overflow: visible;
      contain: none;
    }

    .pi-toolbar__title--editing .pi-toolbar__title-text {
      display: none;
    }

    .pi-toolbar__menu-button,
    .pi-toolbar__help-button {
      position: relative;
      display: grid;
      place-items: center;
      flex: 0 0 26px;
      width: 26px;
      max-width: 26px;
      height: 26px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      overflow: visible;
    }

    .pi-toolbar__menu-button:hover:not(:disabled),
    .pi-toolbar__menu-button:focus-visible,
    .pi-toolbar__menu-button[aria-expanded="true"],
    .pi-toolbar__help-button:hover:not(:disabled),
    .pi-toolbar__help-button:focus-visible,
    .pi-toolbar__help-button[aria-expanded="true"] {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .pi-toolbar__menu-button:disabled,
    .pi-toolbar__help-button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .pi-toolbar__menu-wrap[hidden],
    .pi-toolbar__help-wrap[hidden] {
      display: none;
    }

    .pi-toolbar__menu-wrap,
    .pi-toolbar__help-wrap {
      position: relative;
      flex: 0 0 26px;
      width: 26px;
      max-width: 26px;
      height: 26px;
    }

    .pi-toolbar__menu {
      position: absolute;
      top: 30px;
      right: 0;
      z-index: 10;
      min-width: 170px;
      padding: 4px;
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 28%, transparent);
    }

    .pi-toolbar__menu[hidden] {
      display: none;
    }

    .pi-toolbar__help-popover {
      position: fixed;
      top: 36px;
      right: 10px;
      z-index: 10;
      width: min(270px, calc(100vw - 20px));
      max-width: calc(100vw - 20px);
      padding: 10px;
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 28%, transparent);
    }

    .pi-toolbar__help-popover[hidden] {
      display: none;
    }

    .pi-toolbar__help-title {
      margin: 0 0 2px;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }

    .pi-toolbar__help-note {
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.35;
    }

    .pi-toolbar__help-list {
      display: grid;
      gap: 5px;
      margin: 0;
      font-size: 12px;
      line-height: 1.35;
    }

    .pi-toolbar__help-list > div {
      display: grid;
      grid-template-columns: minmax(58px, auto) minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
    }

    .pi-toolbar__help-list dt {
      min-width: 0;
      padding: 1px 5px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
    }

    .pi-toolbar__help-list dd {
      min-width: 0;
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .pi-toolbar__menu-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      width: 100%;
      padding: 5px 8px;
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
      background: transparent;
      border: 0;
      border-radius: 4px;
      font: inherit;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }

    .pi-toolbar__menu-icon {
      flex: 0 0 auto;
      opacity: 0.78;
    }

    .pi-toolbar__menu-item:hover:not(:disabled),
    .pi-toolbar__menu-item:focus-visible,
    .pi-toolbar__menu-item--hover:not(:disabled) {
      color: var(--vscode-foreground);
      background: rgba(127, 127, 127, 0.18);
      outline: none;
    }

    .pi-toolbar__menu-item:hover:not(:disabled) .pi-toolbar__menu-icon,
    .pi-toolbar__menu-item:focus-visible .pi-toolbar__menu-icon,
    .pi-toolbar__menu-item--hover:not(:disabled) .pi-toolbar__menu-icon {
      opacity: 1;
    }

    .pi-toolbar__menu-item:disabled {
      opacity: 0.45;
      cursor: default;
    }

`;

const toastStyles = /* css */ `    .pi-toast {
      position: absolute;
      left: 12px;
      right: 12px;
      top: 42px;
      z-index: 5;
      justify-self: center;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      width: max-content;
      max-width: calc(100% - 24px);
      padding: 6px 10px;
      color: var(--vscode-notifications-foreground, var(--vscode-foreground));
      background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-notifications-border, var(--vscode-input-border, transparent));
      border-radius: 999px;
      box-shadow: 0 4px 16px color-mix(in srgb, #000 28%, transparent);
      font-size: 12px;
      line-height: 1.35;
      text-align: center;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: none;
    }

    .pi-toast__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }

    .pi-toast--success .pi-toast__icon {
      color: var(--vscode-testing-iconPassed, #3fb950);
    }

    .pi-toast--warning .pi-toast__icon {
      color: var(--vscode-testing-iconQueued, #d29922);
    }

    .pi-toast--error .pi-toast__icon {
      color: var(--vscode-testing-iconFailed, #f85149);
    }

    .pi-toast[hidden] {
      display: none;
    }

    .pi-toast--visible {
      opacity: 1;
      transform: translateY(0);
    }


`;

const viewLayoutStyles = /* css */ `    .messages,
    .sessions {
      grid-row: 2;
      grid-column: 1;
      align-self: stretch;
      justify-self: stretch;
      width: 100%;
      height: 100%;
      max-width: 100vw;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      transition: transform 190ms cubic-bezier(0.16, 1, 0.3, 1);
      will-change: transform;
    }

    .messages {
      padding: 8px 20px calc(14px + 4lh) 20px;
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .sessions {
      grid-row: 2 / 4;
      z-index: 1;
      padding: 6px 12px 12px 8px;
      background: var(--vscode-sideBar-background);
      outline: none;
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .pi-view--chat .messages {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .pi-view--chat.pi-view--lane-sessions .sessions {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .pi-view--chat.pi-view--lane-tree .sessions {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .pi-view--sessions .messages {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .pi-view--tree .messages {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .pi-view--sessions .sessions,
    .pi-view--tree .sessions {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .pi-view--lane-jump .sessions {
      transition: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .messages,
      .sessions {
        transition: none;
      }
    }

    .empty-state {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state--welcome {
      max-width: 560px;
      padding-top: 6px;
      line-height: 1.45;
    }

    .empty-state--welcome p {
      margin: 0 0 8px;
    }

    .empty-state__title {
      margin: 0 0 10px;
      color: var(--vscode-foreground);
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
    }

    .empty-state__try-label {
      margin-top: 14px;
      color: var(--vscode-foreground);
      font-weight: 600;
    }

    .empty-state__prompts {
      margin: 0;
      padding-left: 18px;
    }

    .empty-state__prompts li {
      margin: 4px 0;
    }

    .empty-state__dismiss {
      margin: 12px 0 0;
      padding: 0;
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .empty-state__dismiss:hover,
    .empty-state__dismiss:focus-visible {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      text-decoration: underline;
      outline: none;
    }

    .empty-state--loading {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

`;

const sessionListStyles = /* css */ `    .sessions__search {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      align-items: center;
      padding: 4px 4px 6px;
    }

    .sessions__search-input {
      width: 100%;
      min-width: 0;
      height: 26px;
      padding: 3px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font: inherit;
      font-size: 12px;
      outline: none;
    }

    .sessions__search-input:focus {
      border-color: var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    }

    .sessions__search-input::placeholder {
      color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    }

    .sessions__named-filter {
      position: relative;
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      padding: 0;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      cursor: pointer;
      overflow: visible;
    }

    .sessions__named-filter:hover,
    .sessions__named-filter:focus-visible {
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, var(--vscode-input-border, transparent)));
      outline: none;
    }

    .sessions__named-filter--active {
      color: var(--vscode-button-foreground, var(--vscode-foreground));
      background: var(--vscode-button-background, var(--vscode-focusBorder));
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, transparent));
    }

    .sessions__named-filter--active:hover,
    .sessions__named-filter--active:focus-visible {
      color: var(--vscode-button-foreground, var(--vscode-foreground));
      background: var(--vscode-button-hoverBackground, var(--vscode-button-background, var(--vscode-focusBorder)));
    }

    .sessions__header,
    .sessions__empty,
    .sessions__error {
      padding: 6px 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .sessions__error {
      color: var(--vscode-errorForeground);
    }

    .sessions__item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 2px 8px;
      align-items: start;
      width: 100%;
      min-width: 0;
      padding: 7px 8px;
      color: var(--vscode-foreground);
      background: transparent;
      border: 0;
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }

    .sessions--pointer-hover .sessions__item:hover:not(:disabled),
    .sessions__item--active {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-foreground) 14%, transparent));
    }

    .sessions__item:disabled {
      cursor: default;
      opacity: 0.7;
    }

    .sessions__prefix {
      grid-row: 1 / 3;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre;
    }

    .sessions__title {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      font-weight: 600;
      white-space: nowrap;
    }

    .sessions__title-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sessions__role {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 500;
    }

    .sessions__tree-item {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 4px 6px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      line-height: 1.45;
    }

    .sessions__tree-prefix {
      display: inline-flex;
      grid-row: 1;
      align-items: center;
      color: var(--vscode-focusBorder);
      font-family: var(--vscode-font-family);
      white-space: nowrap;
    }

    .sessions__tree-cursor,
    .sessions__tree-active-path {
      display: inline-grid;
      place-items: center;
      width: 1.1em;
      min-width: 1.1em;
      font-weight: 600;
    }

    .sessions__tree-connector {
      display: inline-grid;
      place-items: center start;
      width: 1.55em;
      min-width: 1.55em;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family);
    }

    .sessions__tree-connector--branch {
      color: var(--vscode-descriptionForeground);
    }

    .sessions__tree-connector--gutter {
      color: color-mix(in srgb, var(--vscode-descriptionForeground) 70%, transparent);
    }

    .sessions__tree-title {
      gap: 4px;
      color: var(--vscode-foreground);
      font-weight: 400;
    }

    .sessions__tree-role {
      font-size: inherit;
      font-weight: 600;
    }

    .sessions__tree-label {
      flex: 0 0 auto;
      color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground));
    }

    .sessions__tree-item--user .sessions__tree-role {
      color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
    }

    .sessions__tree-item--assistant .sessions__tree-role {
      color: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, var(--vscode-foreground)));
    }

    .sessions__tree-item--tool .sessions__tree-content,
    .sessions__tree-item--toolresult .sessions__tree-content,
    .sessions__tree-item--message .sessions__tree-content {
      color: var(--vscode-descriptionForeground);
    }

    .sessions__tree-title--summary {
      align-items: stretch;
      overflow: visible;
      white-space: normal;
    }

    .sessions__tree-summary-activity {
      display: block;
      min-width: 0;
      max-width: 100%;
      text-align: left;
    }

    .sessions__tree-summary-activity .activity__summary,
    .sessions__tree-summary-activity .activity__body {
      display: block;
    }

    .sessions__tree-summary-activity-body {
      overflow: visible;
      text-overflow: clip;
    }

    .sessions__item--active .sessions__tree-prefix,
    .sessions__item--active .sessions__tree-label {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
    }

    .sessions__tree-summary {
      grid-template-columns: minmax(0, 1fr);
      margin: 2px 6px 6px 24px;
      padding: 8px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-foreground) 8%);
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent);
      border-radius: 6px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
    }

    .sessions__tree-summary-title {
      margin-bottom: 6px;
      font-weight: 600;
    }

    .sessions__tree-summary-choices {
      display: grid;
      gap: 2px;
    }

    .sessions__tree-summary-choice,
    .sessions__tree-summary-cancel {
      width: 100%;
      padding: 2px 4px;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 3px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .sessions__tree-summary-choice:hover,
    .sessions__tree-summary-choice:focus-visible,
    .sessions__tree-summary-choice--active {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-foreground) 14%, transparent));
      outline: none;
    }

    .sessions__tree-summary-input {
      width: 100%;
      min-width: 0;
      resize: vertical;
      margin: 2px 0 6px;
      padding: 4px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      border-radius: 4px;
      font: inherit;
      outline: none;
    }

    .sessions__tree-summary-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .sessions__tree-summary-actions .sessions__tree-summary-choice {
      width: auto;
      padding-right: 8px;
    }

    .sessions__tree-summary-cancel {
      width: auto;
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
    }

    .sessions__tree-footer {
      position: sticky;
      bottom: 0;
      z-index: 1;
      margin-top: 4px;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .sessions__name-input {
      width: 100%;
      min-width: 0;
      height: 22px;
      padding: 1px 5px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      border-radius: 3px;
      font: inherit;
      font-weight: 400;
      outline: none;
    }

    .sessions__item--current .sessions__title {
      color: var(--vscode-focusBorder);
    }

    .sessions__meta {
      grid-column: 2 / 3;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      white-space: nowrap;
    }

    .sessions__item--running .sessions__prefix {
      color: var(--vscode-testing-iconQueued, var(--vscode-progressBar-background, var(--vscode-focusBorder)));
    }

    .sessions__item--unread .sessions__title::after {
      content: ' •';
      color: var(--vscode-focusBorder);
    }

    .sessions__cwd {
      grid-column: 2 / 3;
      min-width: 0;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sessions__menu-wrap {
      position: relative;
      grid-column: 3;
      grid-row: 1 / 3;
      align-self: start;
      width: 22px;
      height: 22px;
    }

    .sessions__menu-button {
      position: relative;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      opacity: 0;
      overflow: visible;
    }

    .sessions--pointer-hover .sessions__item:hover .sessions__menu-button,
    .sessions__item--active .sessions__menu-button,
    .sessions__menu-button:focus-visible,
    .sessions__menu-button[aria-expanded="true"] {
      opacity: 0.78;
    }

    .sessions__menu-button:hover:not(:disabled),
    .sessions__menu-button:focus-visible,
    .sessions__menu-button[aria-expanded="true"] {
      background: color-mix(in srgb, currentColor 16%, transparent);
      outline: none;
      opacity: 1;
    }

    .sessions__menu-button:disabled {
      cursor: default;
      opacity: 0.35;
    }

    .sessions__menu {
      position: absolute;
      top: 26px;
      right: 0;
      z-index: 20;
      min-width: 170px;
      padding: 4px;
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 28%, transparent);
    }

    .sessions__menu[hidden] {
      display: none;
    }

    .sessions__item--active .sessions__meta,
    .sessions__item--active .sessions__cwd,
    .sessions__item--active .sessions__prefix {
      color: inherit;
      opacity: 0.78;
    }

`;

const messageStyles = /* css */ `    .message {
      margin: 0 0 14px;
    }

    .message:last-child {
      margin-bottom: 0;
    }

    .message__role {
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .message--user .message__role {
      margin-bottom: 8px;
    }

    .message__body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }

    .message__body--markdown {
      white-space: normal;
    }

    .message__body--markdown > :first-child {
      margin-top: 0;
    }

    .message__body--markdown > :last-child {
      margin-bottom: 0;
    }

    .message__body--markdown p,
    .message__body--markdown ul,
    .message__body--markdown ol,
    .message__body--markdown blockquote,
    .message__body--markdown pre,
    .message__body--markdown table {
      margin: 0 0 8px;
    }

    .message__body--markdown ul,
    .message__body--markdown ol {
      padding-left: 20px;
    }

    .message__body--markdown li + li {
      margin-top: 3px;
    }

    .message__body--markdown code {
      padding: 1px 3px;
      color: var(--tau-code-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      background: var(--tau-code-inline-background);
      border-radius: 3px;
    }

    .message__body--markdown pre {
      max-width: 100%;
      padding: 8px;
      overflow: auto;
      color: var(--tau-code-foreground);
      background: var(--tau-code-background);
      border-radius: 6px;
      white-space: pre;
    }

    .message__body--markdown pre code {
      display: block;
      padding: 0;
      background: transparent;
      border-radius: 0;
      white-space: inherit;
    }

    .tau-code-block {
      position: relative;
      margin: 0 0 8px;
    }

    .message__body--markdown > .tau-code-block:last-child {
      margin-bottom: 0;
    }

    .message__body--markdown .tau-code-block > pre {
      margin: 0;
      padding-right: 34px;
    }

    .tau-code-block__actions {
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 1;
      display: inline-flex;
      gap: 2px;
    }

    .tau-shiki-pending {
      color: var(--tau-code-foreground);
    }

    .message__body--markdown blockquote {
      padding-left: 9px;
      color: var(--vscode-descriptionForeground);
      border-left: 2px solid color-mix(in srgb, var(--vscode-foreground) 25%, transparent);
    }

    .message__body--markdown table {
      display: block;
      max-width: 100%;
      overflow: auto;
      border-collapse: collapse;
    }

    .message__body--markdown th,
    .message__body--markdown td {
      padding: 4px 6px;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
    }

    .message__body--markdown a {
      color: var(--vscode-textLink-foreground);
    }

    .message__body--markdown .tau-file-link {
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .tau-stream-word {
      display: inline-block;
      animation: tau-stream-word-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
      will-change: opacity, filter, transform;
    }

    @keyframes tau-stream-word-in {
      from {
        opacity: 0;
        filter: blur(2.5px);
        transform: translateY(2px);
      }

      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }
    }

    body.vscode-reduce-motion .tau-stream-word {
      display: inline;
      animation: none;
      will-change: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      .tau-stream-word {
        display: inline;
        animation: none;
        will-change: auto;
      }
    }

    .message__body--after-activities {
      margin-top: 8px;
    }

    .message__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 6px;
    }

    .message__copy,
    .tau-code-block__action,
    .activity__body-action {
      position: relative;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 5px;
      cursor: pointer;
      overflow: visible;
    }

    .message__copy:hover,
    .message__copy:focus-visible,
    .tau-code-block__action:hover,
    .tau-code-block__action:focus-visible,
    .activity__body-action:hover,
    .activity__body-action:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .tau-code-block__action,
    .activity__body-action {
      background: color-mix(in srgb, var(--tau-code-background, var(--vscode-editor-background)) 88%, var(--vscode-foreground) 12%);
    }

    .tau-icon-action-tooltip {
      position: absolute;
      right: 0;
      bottom: calc(100% + 5px);
      z-index: 2;
      display: none;
      width: max-content;
      max-width: min(220px, 70vw);
      padding: 4px 6px;
      color: var(--vscode-editorHoverWidget-foreground);
      background: var(--vscode-editorHoverWidget-background);
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
      font-family: var(--vscode-font-family);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.3;
      white-space: nowrap;
      pointer-events: none;
    }

    .pi-toolbar__sessions .tau-icon-action-tooltip,
    .pi-toolbar__tree .tau-icon-action-tooltip,
    .pi-toolbar__menu-button .tau-icon-action-tooltip,
    .pi-toolbar__help-button .tau-icon-action-tooltip,
    .sessions__menu-button .tau-icon-action-tooltip,
    .sessions__named-filter .tau-icon-action-tooltip {
      top: calc(100% + 5px);
      right: 0;
      bottom: auto;
    }

    .pi-toolbar__sessions .tau-icon-action-tooltip,
    .composer__diff-summary .tau-icon-action-tooltip {
      right: auto;
      left: 0;
    }

    .message__copy:hover .tau-icon-action-tooltip,
    .message__copy:focus-visible .tau-icon-action-tooltip,
    .tau-code-block__action:hover .tau-icon-action-tooltip,
    .tau-code-block__action:focus-visible .tau-icon-action-tooltip,
    .activity__body-action:hover .tau-icon-action-tooltip,
    .activity__body-action:focus-visible .tau-icon-action-tooltip,
    .pi-toolbar__sessions:hover .tau-icon-action-tooltip,
    .pi-toolbar__sessions:focus-visible .tau-icon-action-tooltip,
    .pi-toolbar__tree:hover .tau-icon-action-tooltip,
    .pi-toolbar__tree:focus-visible .tau-icon-action-tooltip,
    .pi-toolbar__menu-button[aria-expanded="false"]:hover .tau-icon-action-tooltip,
    .pi-toolbar__menu-button[aria-expanded="false"]:focus-visible .tau-icon-action-tooltip,
    .pi-toolbar__help-button[aria-expanded="false"]:hover .tau-icon-action-tooltip,
    .pi-toolbar__help-button[aria-expanded="false"]:focus-visible .tau-icon-action-tooltip,
    .composer__submit:hover:not(:disabled) .tau-icon-action-tooltip,
    .composer__submit:focus-visible:not(:disabled) .tau-icon-action-tooltip,
    .composer__diff-summary:hover .tau-icon-action-tooltip,
    .composer__diff-summary:focus-visible .tau-icon-action-tooltip,
    .composer__mode-button:hover .tau-icon-action-tooltip,
    .composer__mode-button:focus-visible .tau-icon-action-tooltip,
    .composer__model[aria-expanded="false"]:hover .tau-icon-action-tooltip,
    .composer__model[aria-expanded="false"]:focus-visible .tau-icon-action-tooltip,
    .sessions__menu-button[aria-expanded="false"]:hover .tau-icon-action-tooltip,
    .sessions__menu-button[aria-expanded="false"]:focus-visible .tau-icon-action-tooltip,
    .sessions__named-filter:hover .tau-icon-action-tooltip,
    .sessions__named-filter:focus-visible .tau-icon-action-tooltip {
      display: block;
    }

    .message--user .message__body {
      display: inline-block;
      max-width: 100%;
      padding: 7px 9px;
      color: var(--vscode-input-foreground);
      background: color-mix(in srgb, var(--vscode-input-background, var(--vscode-sideBar-background)) 88%, #000 12%);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent);
      border-radius: 10px;
    }

    .message--thinking .message__body {
      color: color-mix(in srgb, var(--vscode-descriptionForeground) 94%, #000 6%);
    }

    .message--error .message__body {
      color: var(--vscode-errorForeground);
    }

`;

const activityStyles = /* css */ `    .activity-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }

    .activity {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, var(--vscode-foreground) 14%);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
      border-radius: 6px;
    }

    .activity--running {
      border-color: color-mix(in srgb, var(--vscode-progressBar-background, var(--vscode-focusBorder)) 58%, var(--vscode-foreground) 18%);
    }

    .activity--error {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 70%, transparent);
    }

    .activity__summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 8px;
      padding: 6px 8px;
      cursor: pointer;
      list-style: none;
    }

    .activity__summary::-webkit-details-marker {
      display: none;
    }

    .activity__title {
      min-width: 0;
      overflow: visible;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 600;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .activity__status {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    .activity--running .activity__status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .activity--running .activity__status::before {
      width: 9px;
      height: 9px;
      content: '';
      border: 1.4px solid color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent);
      border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      border-radius: 999px;
      animation: pi-spin 0.8s linear infinite;
    }

    .activity__description {
      grid-column: 1 / -1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.35;
    }

    .activity__body-wrap {
      position: relative;
    }

    .activity__body-actions {
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 1;
      display: inline-flex;
      gap: 2px;
    }

    .activity__body {
      max-height: none;
      margin: 0;
      padding: 7px 8px 8px;
      overflow: hidden;
      color: var(--vscode-foreground);
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }

    .activity__body--code:not(.activity__body--expanded) {
      box-sizing: content-box;
      max-height: calc(16 * 16px);
    }

    .activity__body--expanded {
      box-sizing: border-box;
      max-height: min(520px, 65vh);
      overflow: auto;
    }

    .activity__body-wrap > .activity__body--code {
      padding-right: 92px;
    }

    .activity__body-action--text {
      width: auto;
      padding: 0 6px;
      font-family: var(--vscode-font-family);
      font-size: 11px;
    }

    .activity__body--code {
      color: var(--tau-code-foreground);
      background: var(--tau-code-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      line-height: 16px;
    }

    .activity__body--markdown {
      white-space: normal;
    }

    .activity__body-toggle {
      display: block;
      width: 100%;
      margin: 0;
      padding: 5px 8px 6px;
      color: var(--vscode-textLink-foreground);
      background: var(--tau-code-background);
      border: 0;
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      line-height: 1.4;
      text-align: left;
      cursor: pointer;
      white-space: pre-wrap;
    }

    .activity__body-toggle:hover,
    .activity__body-toggle:focus-visible {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      text-decoration: underline;
      outline: none;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status[hidden] {
      display: none;
    }

    .status__spinner {
      width: 10px;
      height: 10px;
      flex: 0 0 auto;
      border: 1.5px solid color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent);
      border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      border-radius: 999px;
      animation: pi-spin 0.8s linear infinite;
      will-change: transform;
    }

    @keyframes pi-spin {
      to {
        transform: rotate(360deg);
      }
    }

`;

const composerStyles = /* css */ `    .composer {
      position: relative;
      grid-row: 3;
      grid-column: 1;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) 36px;
      grid-template-rows: minmax(22px, auto) 36px;
      align-items: end;
      gap: 4px 8px;
      min-height: 84px;
      max-width: 100%;
      max-height: calc(100vh - 16px);
      margin: 0 20px 1lh;
      padding: 14px 9px 8px;
      overflow: visible;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 21px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      opacity: 1;
      transform: translateY(0);
      transition: opacity 140ms ease,
        transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
        min-height 180ms ease,
        max-height 180ms ease,
        margin 180ms ease,
        padding 180ms ease;
      will-change: opacity, transform, max-height;
    }

    .composer--list-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(32px);
    }

    .composer--has-context {
      grid-template-rows: auto minmax(22px, auto) 36px;
    }

    .composer__slash-menu {
      position: absolute;
      left: 9px;
      bottom: calc(100% + 6px);
      z-index: 3;
      display: none;
      width: min(360px, calc(100vw - 24px));
      max-height: min(280px, 45vh);
      overflow-y: auto;
      padding: 4px;
      color: var(--vscode-foreground);
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 8px;
      box-shadow: 0 4px 16px color-mix(in srgb, #000 38%, transparent);
      font-size: 12px;
      line-height: 1.35;
    }

    .composer__slash-menu[open] {
      display: grid;
      gap: 2px;
    }

    .composer__slash-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 8px;
      width: 100%;
      min-width: 0;
      padding: 6px 7px;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 5px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .composer__slash-item:hover,
    .composer__slash-item--active {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-foreground) 14%, transparent));
    }

    .composer__slash-label {
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__slash-source {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      white-space: nowrap;
    }

    .composer__slash-item--active .composer__slash-source,
    .composer__slash-item:hover .composer__slash-source {
      color: inherit;
      opacity: 0.78;
    }

    .composer__slash-description {
      grid-column: 1 / -1;
      min-width: 0;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__slash-item--active .composer__slash-description,
    .composer__slash-item:hover .composer__slash-description {
      color: inherit;
      opacity: 0.78;
    }

    .composer__slash-empty {
      padding: 7px 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .composer__context-badges {
      grid-column: 1 / -1;
      align-self: start;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      min-width: 0;
      padding: 0 4px 9px;
    }

    .composer__context-badges[hidden] {
      display: none;
    }

    .composer__context-badge {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      overflow: visible;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, #0969da 28%, var(--vscode-input-background) 72%);
      border: 1px solid color-mix(in srgb, #0969da 62%, transparent);
      border-radius: 999px;
      font-size: 11px;
      line-height: 1.3;
    }

    .composer__context-badge--origin {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, #2ea043 28%, var(--vscode-input-background) 72%);
      border-color: color-mix(in srgb, #2ea043 62%, transparent);
    }

    .composer__context-label {
      min-width: 0;
      overflow: hidden;
      padding: 2px 2px 2px 7px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__context-remove {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 17px;
      height: 17px;
      margin: 0 2px 0 1px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.78;
    }

    .composer__context-remove:hover,
    .composer__context-remove:focus-visible {
      background: color-mix(in srgb, currentColor 18%, transparent);
      outline: none;
      opacity: 1;
    }

    .composer__context-badge-tooltip {
      position: absolute;
      left: 9px;
      right: 9px;
      bottom: calc(100% + 8px);
      z-index: 4;
      width: auto;
      max-width: none;
      overflow: hidden;
      visibility: hidden;
      color: var(--tau-code-foreground);
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background, var(--vscode-sideBar-background)));
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
      border-radius: 6px;
      box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.4;
      opacity: 0;
      pointer-events: auto;
      transition: opacity 90ms ease 180ms, visibility 0s linear 270ms;
    }

    .composer__context-badge-tooltip pre {
      max-width: inherit;
      max-height: min(320px, 45vh);
      margin: 0;
      padding: 7px 8px 8px;
      overflow-x: hidden;
      overflow-y: auto;
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background, var(--vscode-sideBar-background)));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: inherit;
      line-height: inherit;
      overflow-wrap: anywhere;
      tab-size: 2;
      white-space: pre-wrap;
    }

    .composer__context-badge-tooltip code {
      display: block;
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background, var(--vscode-sideBar-background)));
      font-family: inherit;
      white-space: inherit;
    }

    .composer__context-badge-tooltip::after {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -8px;
      height: 8px;
      content: '';
    }

    .composer__context-badge:hover .composer__context-badge-tooltip,
    .composer__context-badge:focus-within .composer__context-badge-tooltip,
    .composer__context-badge-tooltip:hover {
      visibility: visible;
      opacity: 1;
      transition-delay: 0s;
    }

    .composer__input {
      grid-column: 1 / -1;
      align-self: start;
      width: 100%;
      height: auto;
      min-height: 22px;
      max-height: 180px;
      resize: none;
      overflow-y: hidden;
      padding: 0 6px 4px;
      color: var(--vscode-input-foreground);
      caret-color: var(--vscode-input-foreground);
      background: transparent;
      border: 0;
      font: inherit;
      line-height: 1.4;
    }

    .composer__input::placeholder {
      color: color-mix(in srgb, var(--vscode-input-background) 68%, var(--vscode-input-foreground) 32%);
      opacity: 1;
    }

    .composer__input:focus {
      outline: none;
    }

    .composer__busy-submit {
      position: absolute;
      left: 4px;
      right: 4px;
      bottom: calc(100% + 6px);
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      padding: 6px 8px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, transparent));
      border-radius: 8px;
      box-shadow: 0 4px 14px color-mix(in srgb, #000 28%, transparent);
      font-size: 11px;
      line-height: 1.25;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity 140ms ease, transform 160ms ease;
    }

    .composer__busy-submit--visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    .composer__busy-submit[hidden] {
      display: none;
    }

    .composer__diff-summary {
      position: relative;
      display: inline-flex;
      min-width: 0;
      align-items: center;
      gap: 4px;
      overflow: visible;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }

    .composer__diff-summary:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .composer__diff-summary:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .composer__diff-added,
    .composer__diff-removed {
      display: inline-flex;
      align-items: baseline;
      font-weight: 600;
    }

    .composer__diff-added {
      color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
    }

    .composer__diff-removed {
      color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
    }

    .composer__diff-sign,
    .composer__diff-digit,
    .composer__diff-separator {
      display: inline-block;
    }

    .composer__diff-digit {
      min-width: 0.62em;
      text-align: center;
      transform-origin: 50% 70%;
      backface-visibility: hidden;
    }

    .composer__diff-digit--rolling {
      animation: composer-diff-digit-roll 150ms ease-out;
    }

    @keyframes composer-diff-digit-roll {
      0% {
        opacity: 0.5;
        transform: translateY(-0.28em) rotateX(64deg);
      }

      100% {
        opacity: 1;
        transform: translateY(0) rotateX(0deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .composer__diff-digit--rolling {
        animation: none;
      }
    }

    .composer__busy-submit-modes {
      display: inline-flex;
      flex: 0 0 auto;
      gap: 2px;
      padding: 2px;
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      border-radius: 999px;
    }

    .composer__mode-button {
      position: relative;
      padding: 2px 7px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-size: 11px;
      line-height: 1.3;
      cursor: pointer;
    }

    .composer__mode-button:hover,
    .composer__mode-button:focus-visible,
    .composer__mode-button--active {
      color: var(--vscode-input-background);
      background: color-mix(in srgb, var(--vscode-foreground) 82%, transparent);
      outline: none;
    }

    .composer__session-actions {
      grid-column: 1;
      display: flex;
      align-items: center;
      gap: 1px;
      padding-bottom: 2px;
    }

    .composer__button {
      position: relative;
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .composer__button:hover:not(:disabled),
    .composer__button:focus-visible:not(:disabled) {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .composer__button:disabled {
      cursor: default;
      opacity: 0.46;
    }


    .composer__button svg {
      display: block;
    }

    .composer__add {
      width: 34px;
      height: 34px;
    }

    .composer__add svg {
      width: 28px;
      height: 28px;
    }

    .composer__button-tooltip {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      z-index: 1;
      display: none;
      width: max-content;
      max-width: min(260px, 70vw);
      padding: 7px 9px;
      color: var(--vscode-editorHoverWidget-foreground);
      background: var(--vscode-editorHoverWidget-background);
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.35;
      white-space: pre-line;
      pointer-events: none;
    }

    .composer__button:hover:not(:disabled) .composer__button-tooltip,
    .composer__button:focus-visible:not(:disabled) .composer__button-tooltip {
      display: block;
    }

    .composer__submit-play,
    .composer__submit-stop {
      transform-box: fill-box;
      transform-origin: center;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .composer__submit-stop {
      opacity: 0;
      transform: scale(0.45);
    }

    .composer__submit--stop .composer__submit-play {
      opacity: 0;
      transform: scale(0.45);
    }

    .composer__submit--stop .composer__submit-stop {
      opacity: 1;
      transform: scale(1);
    }

    .composer__info {
      grid-column: 2;
      justify-self: end;
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 14px;
      width: 100%;
      padding: 0 2px 8px 0;
      min-width: 0;
      overflow: visible;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      line-height: 1;
      white-space: nowrap;
    }

    .composer__context {
      position: relative;
      flex: 0 0 auto;
      font-size: 11px;
      font-weight: 600;
    }

    .composer__context--low {
      color: var(--vscode-testing-iconPassed, #73c991);
    }

    .composer__context--medium {
      color: var(--vscode-testing-iconQueued, #cca700);
    }

    .composer__context--high {
      color: var(--vscode-testing-iconFailed, #f14c4c);
    }

    .composer__context-tooltip {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 1;
      display: none;
      width: max-content;
      max-width: min(260px, 70vw);
      padding: 7px 9px;
      color: var(--vscode-editorHoverWidget-foreground);
      background: var(--vscode-editorHoverWidget-background);
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      box-shadow: 0 2px 8px color-mix(in srgb, #000 35%, transparent);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.35;
      white-space: pre-line;
    }

    .composer__context:hover .composer__context-tooltip,
    .composer__context:focus-within .composer__context-tooltip {
      display: block;
    }

    .composer__model {
      position: relative;
      display: flex;
      align-items: baseline;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      padding: 0 16px 0 0;
      overflow: visible;
      color: inherit;
      background: transparent;
      border: 0;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      text-align: left;
      text-overflow: ellipsis;
      cursor: pointer;
    }

    .composer__model-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__model::after {
      content: '';
      position: absolute;
      right: 2px;
      top: 50%;
      width: 6px;
      height: 6px;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: translateY(-70%) rotate(45deg);
      opacity: 0.9;
      pointer-events: none;
    }

    .composer__model:hover:not(:disabled),
    .composer__model:focus-visible {
      color: var(--vscode-foreground);
      outline: none;
    }

    .composer__model-menu {
      position: absolute;
      right: 46px;
      bottom: 44px;
      z-index: 2;
      display: none;
      width: min(320px, calc(100vw - 24px));
      padding: 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 8px;
      box-shadow: 0 4px 16px color-mix(in srgb, #000 38%, transparent);
      font-size: 12px;
      line-height: 1.35;
    }

    .composer__model-menu[open] {
      display: grid;
      gap: 8px;
    }

    .composer__field {
      display: grid;
      gap: 4px;
    }

    .composer__field label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
    }

    .composer__select {
      width: 100%;
      min-width: 0;
      padding: 4px 6px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 3px;
      font: inherit;
    }

    .composer__select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }


    .composer__submit {
      justify-self: end;
      width: 34px;
      height: 34px;
      color: var(--vscode-input-background);
      background: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 82%, transparent);
    }

    .composer__submit:hover:not(:disabled) {
      color: var(--vscode-input-background);
      background: var(--vscode-foreground);
    }

    .composer__submit:disabled {
      color: color-mix(in srgb, var(--vscode-input-background) 72%, var(--vscode-foreground) 28%);
      background: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 48%, transparent);
      cursor: default;
    }`;

const reducedMotionStyles = /* css */ `    body.vscode-reduce-motion *,
    body.vscode-reduce-motion *::before,
    body.vscode-reduce-motion *::after,
    body.tau-animations-disabled *,
    body.tau-animations-disabled *::before,
    body.tau-animations-disabled *::after {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }

    body.vscode-reduce-motion .messages,
    body.vscode-reduce-motion .sessions,
    body.vscode-reduce-motion .composer,
    body.vscode-reduce-motion .status__spinner,
    body.vscode-reduce-motion .activity--running .activity__status::before,
    body.vscode-reduce-motion .tau-stream-word,
    body.tau-animations-disabled .messages,
    body.tau-animations-disabled .sessions,
    body.tau-animations-disabled .composer,
    body.tau-animations-disabled .status__spinner,
    body.tau-animations-disabled .activity--running .activity__status::before,
    body.tau-animations-disabled .tau-stream-word {
      will-change: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }

      .messages,
      .sessions,
      .composer,
      .status__spinner,
      .activity--running .activity__status::before,
      .tau-stream-word {
        will-change: auto;
      }
    }
`;

export const chatWebviewStyles = [
  baseStyles,
  toolbarStyles,
  toastStyles,
  viewLayoutStyles,
  sessionListStyles,
  messageStyles,
  activityStyles,
  composerStyles,
  reducedMotionStyles,
].join("");
