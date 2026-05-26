export const sessionListStyles = /* css */ `    .sessions__search {
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

    .sessions__tree-item--summary .sessions__tree-role {
      color: var(--vscode-editorWarning-foreground, var(--vscode-terminal-ansiYellow, var(--vscode-foreground)));
    }

    .sessions__tree-item--tool .sessions__tree-content,
    .sessions__tree-item--toolresult .sessions__tree-content,
    .sessions__tree-item--message .sessions__tree-content {
      color: var(--vscode-descriptionForeground);
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
      z-index: var(--tauren-z-raised);
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

    .sessions__item--loading .sessions__title,
    .sessions__item--loading .sessions__meta {
      color: var(--vscode-descriptionForeground);
    }

    .sessions__virtual-spacer {
      width: 100%;
      pointer-events: none;
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
      z-index: var(--tauren-z-modal);
      min-width: 170px;
      padding: 4px;
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 28%, transparent);
    }

    .sessions__menu--context {
      position: fixed;
      right: auto;
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
