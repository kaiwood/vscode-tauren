export const activityStyles = /* css */ `    .activity-list {
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
      animation: tau-spin 0.8s linear infinite;
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
      z-index: var(--tau-z-raised);
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

    .activity__body--compaction {
      background: var(--tau-code-background);
    }

    .activity__body--compaction:not(.activity__body--expanded) {
      box-sizing: content-box;
      max-height: calc(2 * 1.4em);
    }

    .activity__body--expanded {
      box-sizing: border-box;
      max-height: min(520px, 65vh);
      overflow: auto;
    }

    .activity__body-wrap > .activity__body--markdown {
      padding-right: 36px;
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
      animation: tau-spin 0.8s linear infinite;
      will-change: transform;
    }

    @keyframes tau-spin {
      to {
        transform: rotate(360deg);
      }
    }

`;
