export const toolbarStyles = /* css */ `    .tau-toolbar {
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

    .tau-toolbar__sessions,
    .tau-toolbar__tree {
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

    .tau-toolbar__sessions:hover,
    .tau-toolbar__sessions:focus-visible,
    .tau-toolbar__tree:hover,
    .tau-toolbar__tree:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .tau-toolbar__sessions svg,
    .tau-toolbar__tree svg {
      transition: transform 120ms ease;
    }

    .tau-toolbar__title {
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

    .tau-toolbar__title-text {
      display: block;
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tau-toolbar__timestamp {
      display: block;
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tau-toolbar__timestamp[hidden] {
      display: none;
    }

    .tau-toolbar__title-input {
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

    .tau-toolbar__title-input[hidden] {
      display: none;
    }

    .tau-toolbar__title--editing {
      padding: 0;
      overflow: visible;
      contain: none;
    }

    .tau-toolbar__title--editing .tau-toolbar__title-text {
      display: none;
    }


    .tau-help-overlay {
      position: fixed;
      top: 38px;
      right: 10px;
      left: 10px;
      z-index: var(--tau-z-modal);
      max-height: calc(100vh - 48px);
      padding: 12px;
      overflow: auto;
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 8px;
      box-shadow: 0 8px 24px color-mix(in srgb, #000 34%, transparent);
    }

    .tau-help-overlay[hidden] {
      display: none;
    }

    .tau-help-overlay:focus,
    .tau-help-overlay:focus-visible {
      outline: 1px solid var(--vscode-focusBorder, transparent);
      outline-offset: -2px;
    }

    .tau-help-overlay__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .tau-help-overlay__eyebrow {
      margin-bottom: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .tau-help-overlay__title {
      margin: 0;
      color: var(--vscode-foreground);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
    }

    .tau-help-overlay__close {
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 18px;
      line-height: 22px;
    }

    .tau-help-overlay__close:hover,
    .tau-help-overlay__close:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
      outline: none;
    }

    .tau-help-overlay__body {
      display: grid;
      gap: 14px;
    }

    .tau-help-overlay__section-title {
      margin: 0 0 6px;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.3;
    }

    .tau-help-overlay__table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      line-height: 1.35;
    }

    .tau-help-overlay__table th,
    .tau-help-overlay__table td {
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
      border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    }

    .tau-help-overlay__table th {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .tau-help-overlay__table td:first-child {
      width: 42%;
      color: var(--vscode-foreground);
      white-space: nowrap;
    }

    .tau-help-overlay__table kbd {
      display: inline-block;
      min-width: 1.35em;
      padding: 1px 4px;
      color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
      background: var(--vscode-keybindingLabel-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      border: 1px solid var(--vscode-keybindingLabel-border, color-mix(in srgb, var(--vscode-foreground) 18%, transparent));
      border-bottom-color: var(--vscode-keybindingLabel-bottomBorder, var(--vscode-keybindingLabel-border, color-mix(in srgb, var(--vscode-foreground) 25%, transparent)));
      border-radius: 3px;
      box-shadow: inset 0 -1px 0 var(--vscode-keybindingLabel-bottomBorder, transparent);
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 11px;
      line-height: 1.3;
      text-align: center;
    }

    .tau-toolbar__help-popover {
      position: fixed;
      top: 36px;
      right: 10px;
      z-index: var(--tau-z-popover);
      width: min(270px, calc(100vw - 20px));
      max-width: calc(100vw - 20px);
      padding: 10px;
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 28%, transparent);
    }

    .tau-toolbar__help-popover[hidden] {
      display: none;
    }

    .tau-toolbar__help-title {
      margin: 0 0 2px;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }

    .tau-toolbar__help-note {
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.35;
    }

    .tau-toolbar__help-list {
      display: grid;
      gap: 5px;
      margin: 0;
      font-size: 12px;
      line-height: 1.35;
    }

    .tau-toolbar__help-list > div {
      display: grid;
      grid-template-columns: minmax(58px, auto) minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
    }

    .tau-toolbar__help-list dt {
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

    .tau-toolbar__help-list dd {
      min-width: 0;
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .tau-toolbar__menu-item {
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

    .tau-toolbar__menu-icon {
      flex: 0 0 auto;
      opacity: 0.78;
    }

    .tau-toolbar__menu-item:hover:not(:disabled),
    .tau-toolbar__menu-item:focus-visible,
    .tau-toolbar__menu-item--hover:not(:disabled) {
      color: var(--vscode-foreground);
      background: rgba(127, 127, 127, 0.18);
      outline: none;
    }

    .tau-toolbar__menu-item:hover:not(:disabled) .tau-toolbar__menu-icon,
    .tau-toolbar__menu-item:focus-visible .tau-toolbar__menu-icon,
    .tau-toolbar__menu-item--hover:not(:disabled) .tau-toolbar__menu-icon {
      opacity: 1;
    }

    .tau-toolbar__menu-item:disabled {
      opacity: 0.45;
      cursor: default;
    }

`;
