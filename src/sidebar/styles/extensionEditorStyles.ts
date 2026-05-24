export const extensionEditorStyles = /* css */ `    .extension-editor {
      position: absolute;
      inset: 0;
      z-index: var(--tau-z-modal);
      display: grid;
      place-items: center;
      padding: 20px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 72%, transparent);
      backdrop-filter: blur(2px);
    }

    .extension-editor[hidden] {
      display: none;
    }

    .extension-editor__panel {
      display: grid;
      grid-template-rows: auto minmax(120px, 1fr) auto;
      gap: 10px;
      width: min(100%, 720px);
      max-height: min(76vh, 640px);
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
    }

    .extension-editor__header,
    .extension-editor__actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .extension-editor__header {
      justify-content: space-between;
    }

    .extension-editor__title {
      margin: 0;
      overflow: hidden;
      color: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .extension-editor__close {
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

    .extension-editor__close:hover,
    .extension-editor__close:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      outline: none;
    }

    .extension-editor__input {
      min-height: 120px;
      padding: 8px;
      resize: vertical;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      line-height: 1.4;
    }

    .extension-editor__input:focus {
      border-color: var(--vscode-focusBorder);
      outline: none;
    }

    .extension-editor__actions {
      justify-content: flex-end;
    }

    .extension-editor__button {
      min-height: 28px;
      padding: 4px 12px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      border: 0;
      border-radius: 6px;
      font: inherit;
      cursor: pointer;
    }

    .extension-editor__button:hover,
    .extension-editor__button:focus-visible {
      background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 16%, transparent));
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .extension-editor__save {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .extension-editor__save:hover,
    .extension-editor__save:focus-visible {
      background: var(--vscode-button-hoverBackground);
    }

`;
