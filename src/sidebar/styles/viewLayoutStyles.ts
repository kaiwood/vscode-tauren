export const viewLayoutStyles = /* css */ `    .tau-chat-surface,
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
      transition: transform var(--tau-lane-transition-duration) var(--tau-lane-transition-easing);
      will-change: transform;
    }

    .tau-chat-surface {
      z-index: var(--tau-z-base);
      display: grid;
      overflow: hidden;
      overflow: clip;
      background: var(--vscode-sideBar-background);
      perspective: 900px;
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tau-chat-surface__face {
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

    .tau-chat-surface__main {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      overflow: hidden;
      transform: rotateY(0deg);
      opacity: 1;
      pointer-events: auto;
    }

    .tau-chat-surface__settings {
      overflow: hidden;
      transform: rotateY(-180deg);
      opacity: 0;
      pointer-events: none;
    }

    .tau-view--chat-face-settings .tau-chat-surface__main {
      transform: rotateY(180deg);
      opacity: 0;
      pointer-events: none;
    }

    .tau-view--chat-face-settings .tau-chat-surface__settings {
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
      padding: 8px var(--tau-chat-inline-padding) calc(14px + 4lh);
      overflow-x: hidden;
      overflow-y: auto;
      pointer-events: auto;
    }

    .sessions,
    .session-tree {
      z-index: var(--tau-z-raised);
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

    .tau-view--lane-chat .tau-chat-surface {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tau-view--lane-chat .sessions {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-chat .session-tree {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-sessions .tau-chat-surface {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-sessions .sessions {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }

    .tau-view--lane-sessions .session-tree {
      transform: translate3d(100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-tree .tau-chat-surface {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-tree .sessions {
      transform: translate3d(-100%, 0, 0);
      pointer-events: none;
    }

    .tau-view--lane-tree .session-tree {
      transform: translate3d(0, 0, 0);
      pointer-events: auto;
    }


    @media (prefers-reduced-motion: reduce) {
      .tau-chat-surface,
      .tau-chat-surface__face,
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
