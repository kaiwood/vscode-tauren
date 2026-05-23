export const messageStyles = /* css */ `    .message {
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
      z-index: var(--tau-z-raised);
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

    .message__images,
    .activity__images {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .tau-image {
      display: block;
      max-width: 100%;
      max-height: min(520px, 60vh);
      object-fit: contain;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-foreground) 6%);
    }

    .message__body--markdown .tau-image,
    .message__body--markdown img,
    .activity__body--markdown .tau-image,
    .activity__body--markdown img {
      max-width: 100%;
      max-height: min(520px, 60vh);
    }

    .tau-image-fallback {
      display: inline-block;
      margin: 2px 0;
      padding: 4px 6px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      border-radius: 4px;
      font-size: 12px;
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
      z-index: var(--tau-z-tooltip);
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

    .tau-toolbar__sessions .tau-icon-action-tooltip,
    .tau-toolbar__tree .tau-icon-action-tooltip,
    .sessions__menu-button .tau-icon-action-tooltip,
    .sessions__named-filter .tau-icon-action-tooltip {
      top: calc(100% + 5px);
      right: 0;
      bottom: auto;
    }

    .tau-toolbar__sessions .tau-icon-action-tooltip,
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
    .tau-toolbar__sessions:hover .tau-icon-action-tooltip,
    .tau-toolbar__sessions:focus-visible .tau-icon-action-tooltip,
    .tau-toolbar__tree:hover .tau-icon-action-tooltip,
    .tau-toolbar__tree:focus-visible .tau-icon-action-tooltip,
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
