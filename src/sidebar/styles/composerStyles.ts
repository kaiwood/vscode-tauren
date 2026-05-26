export const composerStyles = /* css */ `    .tauren-view--has-extension-status {
      --tauren-composer-status-gap: 6px;
      --tauren-composer-status-height: 28px;
      --tauren-custom-ui-bottom-offset: calc(var(--tauren-composer-bottom-margin) + var(--tauren-composer-status-height) + var(--tauren-composer-status-gap) + var(--tauren-composer-min-height) + var(--tauren-composer-custom-ui-clearance));
    }

    .composer__widget-busy-slot {
      grid-row: 3;
      grid-column: 1;
      margin: 0 var(--tauren-chat-inline-padding) 6px;
    }

    .composer__widget-busy-slot[hidden] {
      display: none;
    }

    .composer__widget-busy-slot .composer__busy-submit,
    .extension-widgets--above .composer__busy-submit {
      position: static;
      left: auto;
      right: auto;
      bottom: auto;
      margin: 0 4px;
      z-index: auto;
    }

    .extension-widgets {
      grid-column: 1;
      display: grid;
      gap: 6px;
      margin: 0 var(--tauren-chat-inline-padding);
    }

    .extension-widgets[hidden] {
      display: none;
    }

    .extension-widgets--above {
      grid-row: 4;
      margin-bottom: 6px;
    }

    .extension-widgets--below {
      grid-row: 6;
      margin-top: 6px;
      margin-bottom: var(--tauren-composer-bottom-margin);
    }

    .tauren-view--has-extension-widgets-below.tauren-view--has-extension-status .extension-widgets--below {
      margin-bottom: var(--tauren-composer-status-gap, 6px);
    }

    .extension-widget {
      min-width: 0;
      max-width: 100%;
      padding: 10px;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 14px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      box-sizing: border-box;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      line-height: 1.35;
    }

    .tauren-view--extension-ui-font .extension-widget {
      font-family: var(--vscode-font-family);
    }

    .extension-widget--ansi-background {
      box-shadow: none;
    }

    .extension-widget--placeholder > * {
      visibility: hidden;
    }

    .extension-widget__line {
      width: 100%;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      line-height: inherit;
      white-space: pre;
    }

    .extension-widget__line--ansi-background {
      background-clip: padding-box;
    }

    .extension-widget__line--ansi-image {
      display: flex;
      align-items: stretch;
      height: 1.35em;
      height: 1lh;
      min-height: 1.35em;
      min-height: 1lh;
      line-height: inherit;
    }

    .extension-widget__line--ansi-image .tauren-ansi-block-image-cell {
      display: block;
      flex: 0 0 1ch;
      width: 1ch;
      height: 1.35em;
      height: 1lh;
    }

    .extension-render-image {
      display: block;
      max-width: 100%;
      overflow: hidden;
      background: var(--vscode-terminal-background, var(--vscode-editor-background, var(--vscode-input-background)));
      font-size: 0;
      line-height: 0;
    }

    .extension-render-image__img {
      display: block;
      width: 100%;
      max-width: 100%;
      height: 100%;
      object-fit: fill;
    }

    .composer {
      position: relative;
      grid-row: 5;
      grid-column: 1;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) 36px;
      grid-template-rows: minmax(22px, auto) 36px;
      align-items: end;
      gap: 4px 8px;
      min-height: var(--tauren-composer-min-height);
      max-width: 100%;
      max-height: calc(100vh - 16px);
      margin: 0 var(--tauren-chat-inline-padding) var(--tauren-composer-bottom-margin);
      padding: 14px 9px 8px;
      overflow: visible;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 14px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      opacity: 1;
      transform: translateY(0);
      transition: opacity 140ms ease,
        transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
        min-height 180ms ease,
        max-height 180ms ease,
        margin 180ms ease,
        padding 180ms ease,
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
      will-change: opacity, transform, max-height;
    }

    .composer--drag-over {
      border-color: color-mix(in srgb, var(--vscode-focusBorder, #0078d4) 70%, transparent);
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent),
        0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder, #0078d4) 28%, transparent);
    }

    .composer--drag-neutral {
      background: color-mix(in srgb, var(--vscode-focusBorder, #0078d4) 12%, var(--vscode-input-background) 88%);
    }

    .composer--drag-valid {
      background: color-mix(in srgb, #2ea043 16%, var(--vscode-input-background) 84%);
      border-color: color-mix(in srgb, #2ea043 76%, transparent);
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent),
        0 0 0 2px color-mix(in srgb, #2ea043 28%, transparent);
    }

    .composer--drag-invalid {
      background: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 16%, var(--vscode-input-background) 84%);
      border-color: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 76%, transparent);
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent),
        0 0 0 2px color-mix(in srgb, var(--vscode-errorForeground, #f85149) 28%, transparent);
    }

    .tauren-view--has-extension-status .composer {
      margin-bottom: var(--tauren-composer-status-gap);
    }

    .tauren-view--has-extension-widgets-below .composer,
    .tauren-view--has-extension-widgets-below.tauren-view--has-extension-status .composer {
      margin-bottom: 0;
    }

    .composer--list-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(32px);
    }

    .composer--custom-hidden {
      opacity: 0.45;
      pointer-events: none;
    }

    .composer--has-context {
      grid-template-rows: auto minmax(22px, auto) 36px;
    }

    .composer-status {
      grid-row: 7;
      grid-column: 1;
      display: flex;
      align-items: center;
      min-width: 0;
      height: var(--tauren-composer-status-height, 28px);
      margin: 0 var(--tauren-chat-inline-padding) var(--tauren-composer-bottom-margin);
      padding: 0 10px;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 14px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      box-sizing: border-box;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      line-height: 1.35;
    }

    .tauren-view--extension-ui-font .composer-status {
      font-family: var(--vscode-font-family);
    }

    .composer-status[hidden] {
      display: none;
    }

    .composer-status__text {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
    }

    .composer__slash-menu {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 6px);
      z-index: var(--tauren-z-composer-menu);
      display: none;
      width: auto;
      max-height: min(272px, 45vh);
      overflow-y: auto;
      padding: 4px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-dropdown-background, var(--vscode-editorWidget-background)) 94%, var(--vscode-sideBar-background) 6%);
      border: 1px solid color-mix(in srgb, var(--vscode-dropdown-border, var(--vscode-input-border, transparent)) 78%, transparent);
      border-radius: 8px;
      box-shadow: 0 3px 12px color-mix(in srgb, #000 28%, transparent);
      font-size: 12px;
      line-height: 1.35;
    }

    .composer__slash-menu[open] {
      display: grid;
      gap: 1px;
    }

    .composer__slash-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 8px;
      width: 100%;
      min-width: 0;
      padding: 5px 8px;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 5px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .composer__slash-menu--pointer-hover .composer__slash-item:hover,
    .composer__slash-item--active {
      color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-inactiveSelectionBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
    }

    .composer__slash-label {
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .composer__slash-source {
      align-self: start;
      padding: 0 5px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      border-radius: 999px;
      font-size: 10px;
      line-height: 1.45;
      white-space: nowrap;
      opacity: 0.78;
    }

    .composer__slash-item--active .composer__slash-source,
    .composer__slash-menu--pointer-hover .composer__slash-item:hover .composer__slash-source {
      color: inherit;
      background: color-mix(in srgb, currentColor 7%, transparent);
      border-color: color-mix(in srgb, currentColor 12%, transparent);
      opacity: 0.72;
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
    .composer__slash-menu--pointer-hover .composer__slash-item:hover .composer__slash-description {
      color: inherit;
      opacity: 0.7;
    }

    .composer__slash-empty {
      padding: 7px 9px;
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
      max-height: 45px;
      padding: 0 4px 9px;
      overflow: visible;
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

    .composer__context-badge--image {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, #a371f7 28%, var(--vscode-input-background) 72%);
      border-color: color-mix(in srgb, #a371f7 62%, transparent);
    }

    .composer__context-badge--overflow {
      background: color-mix(in srgb, var(--vscode-foreground) 10%, var(--vscode-input-background) 90%);
      border-color: color-mix(in srgb, var(--vscode-foreground) 24%, transparent);
      color: var(--vscode-descriptionForeground);
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
      z-index: var(--tauren-z-floating-panel);
      width: auto;
      max-width: none;
      overflow: hidden;
      visibility: hidden;
      color: var(--tauren-code-foreground);
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
      z-index: var(--tauren-z-tooltip);
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
      gap: 2px;
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

    .composer__session-actions .composer__button svg {
      width: 18px;
      height: 18px;
    }

    .composer__attach,
    .composer__add {
      width: 34px;
      height: 34px;
    }

    .composer__button-tooltip {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      z-index: var(--tauren-z-raised);
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
      gap: 12px;
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
      z-index: var(--tauren-z-floating-panel);
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
      z-index: var(--tauren-z-tooltip);
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
