export const chatWebviewStyles = /* css */ `    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      height: 100%;
    }

    body {
      margin: 0;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .pi-view {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto auto;
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    .messages {
      min-height: 0;
      padding: 12px 12px calc(8px + 2lh);
      overflow-y: auto;
    }

    .empty-state {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .message {
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
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      border-radius: 3px;
    }

    .message__body--markdown pre {
      max-width: 100%;
      padding: 8px;
      overflow: auto;
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      border-radius: 6px;
      white-space: pre;
    }

    .message__body--markdown pre code {
      padding: 0;
      background: transparent;
      border-radius: 0;
    }

    .message__body--markdown .hljs-comment,
    .message__body--markdown .hljs-quote {
      color: var(--vscode-descriptionForeground);
    }

    .message__body--markdown .hljs-keyword,
    .message__body--markdown .hljs-selector-tag,
    .message__body--markdown .hljs-subst {
      color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
    }

    .message__body--markdown .hljs-literal,
    .message__body--markdown .hljs-number,
    .message__body--markdown .hljs-doctag {
      color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
    }

    .message__body--markdown .hljs-string,
    .message__body--markdown .hljs-regexp,
    .message__body--markdown .hljs-addition {
      color: var(--vscode-symbolIcon-stringForeground, #ce9178);
    }

    .message__body--markdown .hljs-title,
    .message__body--markdown .hljs-section,
    .message__body--markdown .hljs-selector-id {
      color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
    }

    .message__body--markdown .hljs-class .hljs-title,
    .message__body--markdown .hljs-type,
    .message__body--markdown .hljs-built_in {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
    }

    .message__body--markdown .hljs-attr,
    .message__body--markdown .hljs-variable,
    .message__body--markdown .hljs-template-variable,
    .message__body--markdown .hljs-attribute {
      color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
    }

    .message__body--markdown .hljs-deletion,
    .message__body--markdown .hljs-meta {
      color: var(--vscode-errorForeground, #f44747);
    }

    .message__body--markdown .hljs-emphasis {
      font-style: italic;
    }

    .message__body--markdown .hljs-strong {
      font-weight: 600;
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

    .message__body--after-activities {
      margin-top: 8px;
    }

    .message--user .message__body {
      color: var(--vscode-input-foreground);
    }

    .message--error .message__body {
      color: var(--vscode-errorForeground);
    }

    .activity-list {
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
      overflow: hidden;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .activity__status {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    .activity__description {
      grid-column: 1 / -1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.35;
    }

    .activity__body {
      max-height: 260px;
      margin: 0;
      padding: 7px 8px 8px;
      overflow: auto;
      color: var(--vscode-foreground);
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }

    .activity__body--code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }

    .activity__body--markdown {
      white-space: normal;
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

    .status__spinner {
      width: 10px;
      height: 10px;
      flex: 0 0 auto;
      border: 1.5px solid color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent);
      border-top-color: #ffffff;
      border-radius: 999px;
      animation: pi-spin 0.8s linear infinite;
    }

    @keyframes pi-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .composer {
      position: relative;
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) 36px;
      grid-template-rows: minmax(22px, auto) 36px;
      align-items: end;
      gap: 4px 8px;
      min-height: 84px;
      max-height: calc(100vh - 16px);
      margin: 0 8px 8px;
      padding: 14px 9px 8px;
      overflow: visible;
      background: #303030;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 21px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
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

    .composer__input:focus {
      outline: none;
    }

    .composer__button {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .composer__button:hover:not(:disabled) {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .composer__button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .composer__button svg {
      display: block;
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
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      padding: 0 16px 0 0;
      overflow: hidden;
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

    .composer__model--refreshing {
      padding-right: 30px;
    }

    .composer__model--refreshing::before {
      content: '';
      position: absolute;
      right: 16px;
      top: calc(50% - 4px);
      width: 8px;
      height: 8px;
      border: 1.4px solid currentColor;
      border-top-color: transparent;
      border-radius: 999px;
      opacity: 0.8;
      animation: pi-spin 0.8s linear infinite;
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
      background: var(--vscode-foreground);
    }

    .composer__submit:disabled {
      color: color-mix(in srgb, var(--vscode-input-background) 72%, var(--vscode-foreground) 28%);
      background: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 48%, transparent);
      cursor: default;
    }`;
