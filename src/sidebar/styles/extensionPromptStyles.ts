export const extensionPromptStyles = /* css */ `    .extension-prompt {
      margin: 16px 0 2px;
      padding: 12px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-input-background) 90%, var(--vscode-focusBorder) 10%);
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent);
      border-radius: 10px;
      box-shadow: inset 3px 0 0 color-mix(in srgb, var(--vscode-focusBorder) 78%, transparent);
    }

    .extension-prompt[hidden] {
      display: none;
    }

    .extension-prompt__header,
    .extension-prompt__actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .extension-prompt__header {
      justify-content: space-between;
    }

    .extension-prompt__heading-group {
      min-width: 0;
    }

    .extension-prompt__eyebrow {
      margin-bottom: 3px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .extension-prompt__title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .extension-prompt__close {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }

    .extension-prompt__close:hover,
    .extension-prompt__close:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      outline: none;
    }

    .extension-prompt__body {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .extension-prompt__message {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .extension-prompt__choices {
      display: grid;
      gap: 6px;
    }

    .extension-prompt__choice {
      width: 100%;
      min-height: 30px;
      padding: 6px 9px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      border: 1px solid var(--vscode-button-border, color-mix(in srgb, var(--vscode-foreground) 12%, transparent));
      border-radius: 6px;
      font: inherit;
      line-height: 1.35;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    .extension-prompt__choice:hover,
    .extension-prompt__choice:focus-visible {
      background: var(--vscode-list-hoverBackground, var(--vscode-button-secondaryHoverBackground));
      border-color: var(--vscode-focusBorder);
      outline: none;
    }

    .extension-prompt__input-form {
      display: grid;
      gap: 10px;
    }

    .extension-prompt__input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 7px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      font: inherit;
      outline: none;
    }

    .extension-prompt__input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .extension-prompt__input::placeholder {
      color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    }

    .extension-prompt__actions {
      justify-content: flex-end;
    }

    .extension-prompt__button {
      min-height: 28px;
      padding: 4px 12px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      border: 0;
      border-radius: 6px;
      font: inherit;
      cursor: pointer;
    }

    .extension-prompt__button:hover,
    .extension-prompt__button:focus-visible {
      background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 16%, transparent));
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .extension-prompt__button--primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .extension-prompt__button--primary:hover,
    .extension-prompt__button--primary:focus-visible {
      background: var(--vscode-button-hoverBackground);
    }

`;
