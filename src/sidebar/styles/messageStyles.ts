export const messageStyles = /* css */ `    .tauren-transcript-search {
      z-index: var(--tauren-z-raised);
      grid-row: 1;
      grid-column: 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 6px;
      align-items: center;
      max-height: 0;
      width: 100%;
      padding: 0 var(--tauren-chat-inline-padding);
      overflow: hidden;
      box-sizing: border-box;
      background: var(--vscode-sideBar-background);
      opacity: 0;
      transform: translateY(-8px);
      transition: max-height 140ms ease, padding 140ms ease, opacity 120ms ease, transform 140ms ease;
    }

    .tauren-transcript-search--open {
      max-height: 38px;
      padding: 4px var(--tauren-chat-inline-padding) 6px;
      opacity: 1;
      transform: translateY(0);
    }

    .tauren-transcript-search__input {
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

    .tauren-transcript-search__input:focus {
      border-color: var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    }

    .tauren-transcript-search__input::placeholder {
      color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    }

    .tauren-transcript-search__count {
      min-width: 54px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-align: right;
      white-space: nowrap;
    }

    .tauren-transcript-search__actions {
      display: inline-flex;
      gap: 2px;
      align-items: center;
    }

    .tauren-transcript-search__button {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border, transparent));
      border-radius: 4px;
      cursor: pointer;
    }

    .tauren-transcript-search__button:hover:not(:disabled),
    .tauren-transcript-search__button:focus-visible {
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, var(--vscode-input-border, transparent)));
      outline: none;
    }

    .tauren-transcript-search__button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .tauren-transcript-search__button--close {
      margin-left: 6px;
    }

    .tauren-transcript-search-match {
      padding: 0 1px;
      color: inherit;
      background: var(--vscode-editor-findMatchHighlightBackground, color-mix(in srgb, var(--vscode-editorWarning-foreground, #c7a85a) 42%, transparent));
      border-radius: 2px;
    }

    .tauren-transcript-search-match--current {
      color: var(--vscode-editor-findMatchForeground, inherit);
      background: var(--vscode-editor-findMatchBackground, color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent));
      outline: 1px solid var(--vscode-focusBorder, currentColor);
    }

    .message {
      margin: 0 0 14px;
    }

    .message:last-child {
      margin-bottom: 0;
    }

    .message--collapsed-transcript {
      padding: 10px 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      text-align: center;
      background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      border-radius: 8px;
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
      color: var(--tauren-code-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      background: var(--tauren-code-inline-background);
      border-radius: 3px;
    }

    .message__body--markdown pre {
      max-width: 100%;
      padding: 8px;
      overflow: auto;
      color: var(--tauren-code-foreground);
      background: var(--tauren-code-background);
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

    .tauren-code-block {
      position: relative;
      margin: 0 0 8px;
    }

    .message__body--markdown > .tauren-code-block:last-child {
      margin-bottom: 0;
    }

    .message__body--markdown .tauren-code-block > pre {
      margin: 0;
      padding-right: 34px;
    }

    .tauren-code-block__actions {
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: var(--tauren-z-raised);
      display: inline-flex;
      gap: 2px;
    }

    .tauren-shiki-pending {
      color: var(--tauren-code-foreground);
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

    .message__body--markdown .tauren-file-link {
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .message__images,
    .activity__images {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .tauren-image {
      display: block;
      max-width: 100%;
      max-height: min(520px, 60vh);
      object-fit: contain;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-foreground) 6%);
    }

    .message__body--markdown .tauren-image,
    .message__body--markdown img,
    .activity__body--markdown .tauren-image,
    .activity__body--markdown img {
      max-width: 100%;
      max-height: min(520px, 60vh);
    }

    .tauren-image-fallback {
      display: inline-block;
      margin: 2px 0;
      padding: 4px 6px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      border-radius: 4px;
      font-size: 12px;
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
    .tauren-code-block__action,
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
    .tauren-code-block__action:hover,
    .tauren-code-block__action:focus-visible,
    .activity__body-action:hover,
    .activity__body-action:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .tauren-code-block__action,
    .activity__body-action {
      background: color-mix(in srgb, var(--tauren-code-background, var(--vscode-editor-background)) 88%, var(--vscode-foreground) 12%);
    }

    .tauren-icon-action-tooltip {
      position: absolute;
      right: 0;
      bottom: calc(100% + 5px);
      z-index: var(--tauren-z-tooltip);
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

    .tauren-toolbar__sessions .tauren-icon-action-tooltip,
    .tauren-toolbar__tree .tauren-icon-action-tooltip,
    .sessions__menu-button .tauren-icon-action-tooltip,
    .sessions__named-filter .tauren-icon-action-tooltip {
      top: calc(100% + 5px);
      right: 0;
      bottom: auto;
    }

    .tauren-toolbar__sessions .tauren-icon-action-tooltip,
    .composer__diff-summary .tauren-icon-action-tooltip {
      right: auto;
      left: 0;
    }

    .message__copy:hover .tauren-icon-action-tooltip,
    .message__copy:focus-visible .tauren-icon-action-tooltip,
    .tauren-code-block__action:hover .tauren-icon-action-tooltip,
    .tauren-code-block__action:focus-visible .tauren-icon-action-tooltip,
    .activity__body-action:hover .tauren-icon-action-tooltip,
    .activity__body-action:focus-visible .tauren-icon-action-tooltip,
    .tauren-toolbar__sessions:hover .tauren-icon-action-tooltip,
    .tauren-toolbar__sessions:focus-visible .tauren-icon-action-tooltip,
    .tauren-toolbar__tree:hover .tauren-icon-action-tooltip,
    .tauren-toolbar__tree:focus-visible .tauren-icon-action-tooltip,
    .composer__submit:hover:not(:disabled) .tauren-icon-action-tooltip,
    .composer__submit:focus-visible:not(:disabled) .tauren-icon-action-tooltip,
    .composer__voice:hover:not(:disabled) .tauren-icon-action-tooltip,
    .composer__voice:focus-visible:not(:disabled) .tauren-icon-action-tooltip,
    .composer__diff-summary:hover .tauren-icon-action-tooltip,
    .composer__diff-summary:focus-visible .tauren-icon-action-tooltip,
    .composer__mode-button:hover .tauren-icon-action-tooltip,
    .composer__mode-button:focus-visible .tauren-icon-action-tooltip,
    .composer__model[aria-expanded="false"]:hover .tauren-icon-action-tooltip,
    .composer__model[aria-expanded="false"]:focus-visible .tauren-icon-action-tooltip,
    .sessions__menu-button[aria-expanded="false"]:hover .tauren-icon-action-tooltip,
    .sessions__menu-button[aria-expanded="false"]:focus-visible .tauren-icon-action-tooltip,
    .sessions__named-filter:hover .tauren-icon-action-tooltip,
    .sessions__named-filter:focus-visible .tauren-icon-action-tooltip {
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
