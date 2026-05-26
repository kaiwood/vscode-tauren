export const viewLayoutStyles = /* css */ `    .tauren-chat-surface,
    .sessions,
    .session-tree {
      grid-row: 2 / 4;
      grid-column: 1;
      align-self: stretch;
      justify-self: stretch;
      width: 100%;
      height: 100%;
      max-width: 100vw;
      min-width: 0;
      min-height: 0;
      transition: transform var(--tauren-lane-transition-duration) var(--tauren-lane-transition-easing);
      will-change: transform;
    }

    .tauren-chat-surface {
      z-index: var(--tauren-z-base);
      display: grid;
      overflow: hidden;
      overflow: clip;
      background: var(--vscode-sideBar-background);
      perspective: 900px;
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tauren-chat-surface__face {
      grid-row: 1;
      grid-column: 1;
      min-width: 0;
      min-height: 0;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      transform-style: preserve-3d;
      transition: transform 165ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease;
      will-change: transform, opacity;
    }

    .tauren-view--suppress-face-transition .tauren-chat-surface__face {
      transition: none;
    }

    .tauren-chat-surface__main {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto auto auto auto auto;
      overflow: hidden;
      transform: rotateY(0deg);
      opacity: 1;
      pointer-events: auto;
    }

    .tauren-chat-surface__settings {
      overflow: hidden;
      transform: rotateY(-180deg);
      opacity: 0;
      pointer-events: none;
    }

    .tauren-view--chat-face-settings .tauren-chat-surface__main {
      transform: rotateY(180deg);
      opacity: 0;
      pointer-events: none;
    }

    .tauren-view--chat-face-settings .tauren-chat-surface__settings {
      transform: rotateY(0deg);
      opacity: 1;
      pointer-events: auto;
    }

    .messages {
      grid-row: 1;
      grid-column: 1;
      width: 100%;
      height: 100%;
      max-width: 100vw;
      min-width: 0;
      min-height: 0;
      padding: 8px var(--tauren-chat-inline-padding) calc(14px + 4lh);
      overflow-x: hidden;
      overflow-y: auto;
      pointer-events: auto;
    }

    .tauren-view--has-extension-widgets-above .messages {
      padding-bottom: calc(14px + 1lh);
    }

    .sessions,
    .session-tree {
      z-index: var(--tauren-z-raised);
      overflow-x: hidden;
      overflow-y: auto;
      padding: 6px 12px 12px 8px;
      background: var(--vscode-sideBar-background);
      outline: none;
      pointer-events: none;
    }

    .sessions {
      transform: translate3d(-100%, 0, 0);
    }

    .session-tree {
      transform: translate3d(100%, 0, 0);
    }

    .tauren-view--lane-chat .tauren-chat-surface {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tauren-view--lane-chat .sessions {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-chat .session-tree {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-sessions .tauren-chat-surface {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-sessions .sessions {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tauren-view--lane-sessions .session-tree {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-tree .tauren-chat-surface {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-tree .sessions {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tauren-view--lane-tree .session-tree {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }


    @media (prefers-reduced-motion: reduce) {
      .tauren-chat-surface,
      .tauren-chat-surface__face,
      .sessions,
      .session-tree {
        transition: none;
      }
    }

    .empty-state {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state--welcome {
      max-width: 560px;
      padding-top: 6px;
      line-height: 1.45;
    }

    .empty-state--welcome p {
      margin: 0 0 8px;
    }

    .empty-state__title {
      margin: 0 0 10px;
      color: var(--vscode-foreground);
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
    }

    .empty-state__try-label {
      margin-top: 14px;
      color: var(--vscode-foreground);
      font-weight: 600;
    }

    .empty-state__resources {
      margin: 12px 0 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      line-height: 1.55;
    }

    .empty-state__resource-row {
      overflow-wrap: anywhere;
    }

    .empty-state__resource-row + .empty-state__resource-row {
      margin-top: 12px;
    }

    .empty-state__resource-heading {
      display: block;
      color: var(--vscode-editorWarning-foreground, #c7a85a);
      font-weight: 600;
    }

    .empty-state__resource-items {
      display: block;
      margin-left: 2ch;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state__prompts {
      margin: 0;
      padding-left: 18px;
    }

    .empty-state__prompts li {
      margin: 4px 0;
    }

    .empty-state__dismiss {
      margin: 12px 0 0;
      padding: 0;
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .empty-state__dismiss:hover,
    .empty-state__dismiss:focus-visible {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      text-decoration: underline;
      outline: none;
    }

    .empty-state--loading {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

`;
