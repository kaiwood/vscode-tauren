export const toastStyles = /* css */ `    .tau-toast {
      position: absolute;
      left: 12px;
      right: 12px;
      top: 42px;
      z-index: var(--tau-z-toast);
      justify-self: center;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      width: max-content;
      max-width: calc(100% - 24px);
      padding: 6px 10px;
      color: var(--vscode-notifications-foreground, var(--vscode-foreground));
      background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-notifications-border, var(--vscode-input-border, transparent));
      border-radius: 999px;
      box-shadow: 0 4px 16px color-mix(in srgb, #000 28%, transparent);
      font-size: 12px;
      line-height: 1.35;
      text-align: center;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: none;
    }

    .tau-toast__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }

    .tau-toast--success .tau-toast__icon {
      color: var(--vscode-testing-iconPassed, #3fb950);
    }

    .tau-toast--warning .tau-toast__icon {
      color: var(--vscode-testing-iconQueued, #d29922);
    }

    .tau-toast--error .tau-toast__icon {
      color: var(--vscode-testing-iconFailed, #f85149);
    }

    .tau-toast[hidden] {
      display: none;
    }

    .tau-toast--visible {
      opacity: 1;
      transform: translateY(0);
    }


`;
