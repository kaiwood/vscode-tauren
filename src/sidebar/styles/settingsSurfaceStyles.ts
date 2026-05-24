export const settingsSurfaceStyles = /* css */ `    .settings-surface {
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      outline: none;
    }

    .settings-surface[hidden] {
      display: none;
    }

    .settings-surface:focus,
    .settings-surface:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .settings-surface__chrome {
      position: absolute;
      inset: 8px;
      pointer-events: none;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
      border-radius: 16px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
      opacity: 0.9;
    }

    .settings-surface__header,
    .settings-surface__body {
      position: relative;
      z-index: var(--tau-z-raised);
    }

    .settings-surface__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
      padding: 6px 6px 0;
    }

    .settings-surface__eyebrow,
    .settings-surface__section-eyebrow {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .settings-surface__title,
    .settings-surface__section-title {
      margin: 2px 0 0;
      color: var(--vscode-foreground);
      font-size: 17px;
      font-weight: 700;
      line-height: 1.2;
    }

    .settings-surface__back {
      flex: 0 0 auto;
      height: 28px;
      padding: 0 10px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border, transparent));
      border-radius: 999px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .settings-surface__back:hover,
    .settings-surface__back:focus-visible {
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 12%, transparent));
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, transparent));
      outline: none;
    }

    .settings-surface__body {
      display: grid;
      grid-template-columns: minmax(86px, 0.32fr) minmax(0, 1fr);
      gap: 10px;
      min-width: 0;
      min-height: 0;
      padding: 0 6px 6px;
      overflow: hidden;
    }

    .settings-surface__nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 4px;
      background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
      border-radius: 12px;
      align-self: start;
    }

    .settings-surface__nav-item {
      width: 100%;
      min-width: 0;
      padding: 7px 8px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      text-align: left;
      cursor: pointer;
    }

    .settings-surface__nav-item:hover,
    .settings-surface__nav-item:focus-visible,
    .settings-surface__nav-item--active {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--vscode-focusBorder) 24%, transparent));
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
      outline: none;
    }

    .settings-surface__panel {
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 2px 2px 12px;
    }

    .settings-surface__intro {
      margin: 0 0 10px;
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
      border-radius: 12px;
    }

    .settings-surface__section-description {
      margin: 7px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }

    .settings-surface__cards {
      display: grid;
      gap: 8px;
    }

    .settings-surface__card {
      padding: 10px;
      background: var(--vscode-editorWidget-background, color-mix(in srgb, var(--vscode-foreground) 6%, transparent));
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
      border-radius: 12px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    }

    .settings-surface__card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .settings-surface__card-title {
      margin: 0;
      color: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
    }

    .settings-surface__card-status {
      flex: 0 1 auto;
      min-width: 0;
      padding: 2px 6px;
      overflow: hidden;
      color: var(--vscode-badge-foreground, var(--vscode-foreground));
      background: var(--vscode-badge-background, color-mix(in srgb, var(--vscode-focusBorder) 28%, transparent));
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .settings-surface__card--danger {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 34%, transparent);
      background: color-mix(in srgb, var(--vscode-errorForeground) 8%, var(--vscode-editorWidget-background, transparent));
    }

    .settings-surface__card--subtle {
      opacity: 0.92;
    }

    .settings-surface__card-body,
    .settings-surface__card-helper,
    .settings-surface__card-error {
      margin: 7px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }

    .settings-surface__card-helper {
      font-size: 11px;
      color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground) 12%);
    }

    .settings-surface__card-error {
      color: var(--vscode-errorForeground);
    }

    .settings-surface__card-status--pi {
      background: color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent);
    }

    .settings-surface__control {
      margin-top: 9px;
      min-width: 0;
    }

    .settings-surface__select,
    .settings-surface__text {
      width: 100%;
      min-width: 0;
      min-height: 28px;
      padding: 4px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, color-mix(in srgb, var(--vscode-foreground) 14%, transparent));
      border-radius: 7px;
      font: inherit;
      font-size: 12px;
    }

    .settings-surface__select:focus-visible,
    .settings-surface__text:focus-visible,
    .settings-surface__toggle input:focus-visible + span {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .settings-surface__toggle {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }

    .settings-surface__toggle input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .settings-surface__toggle span {
      position: relative;
      width: 34px;
      height: 18px;
      background: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      border-radius: 999px;
    }

    .settings-surface__toggle span::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      background: var(--vscode-foreground);
      border-radius: 50%;
      transition: transform 120ms ease;
    }

    .settings-surface__toggle input:checked + span {
      background: color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 80%, transparent);
    }

    .settings-surface__toggle input:checked + span::after {
      transform: translateX(16px);
    }

    .tau-animations-disabled .settings-surface__toggle span::after {
      transition: none;
    }

    .settings-surface__toggle input:disabled + span,
    .settings-surface__select:disabled,
    .settings-surface__text:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }

    .settings-surface__auth-toolbar,
    .settings-surface__auth-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .settings-surface__auth-toolbar {
      margin-top: 0;
    }

    .settings-surface__auth-group {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .settings-surface__auth-separator {
      height: 1px;
      margin: 4px 0;
      background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
    }

    .settings-surface__button {
      min-height: 26px;
      padding: 3px 9px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 7px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .settings-surface__button:hover,
    .settings-surface__button:focus-visible {
      background: var(--vscode-button-hoverBackground);
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, transparent));
      outline: none;
    }

    .settings-surface__button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .settings-surface__auth-code {
      display: inline-block;
      margin-top: 9px;
      padding: 5px 7px;
      color: var(--vscode-textCodeBlock-foreground, var(--vscode-foreground));
      background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      border-radius: 6px;
      font-size: 13px;
      letter-spacing: 0.05em;
    }

    .settings-surface__readonly-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .settings-surface__readonly-list code {
      max-width: 100%;
      padding: 2px 5px;
      overflow: hidden;
      color: var(--vscode-textCodeBlock-foreground, var(--vscode-foreground));
      background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      border-radius: 5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 270px) {
      .settings-surface__body {
        grid-template-columns: minmax(0, 1fr);
      }

      .settings-surface__nav {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

`;
