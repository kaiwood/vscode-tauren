export const baseStyles = /* css */ `    :root {
      color-scheme: light dark;
      --tau-code-foreground: var(--vscode-editor-foreground, var(--vscode-foreground));
      --tau-code-background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      --tau-code-inline-background: var(--vscode-textPreformat-background, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
      --tau-chat-inline-padding: 20px;
      --tau-composer-min-height: 84px;
      --tau-composer-bottom-margin: 1lh;
      --tau-composer-custom-ui-clearance: 8px;
      --tau-custom-ui-inline-offset: var(--tau-chat-inline-padding);
      --tau-custom-ui-bottom-offset: calc(var(--tau-composer-bottom-margin) + var(--tau-composer-min-height) + var(--tau-composer-custom-ui-clearance));
      --tau-custom-ui-viewport-bottom-reserve: 42px;
      --tau-z-base: 0;
      --tau-z-raised: 1;
      --tau-z-tooltip: 2;
      --tau-z-composer-menu: 3;
      --tau-z-floating-panel: 4;
      --tau-z-toast: 5;
      --tau-z-popover: 10;
      --tau-z-modal: 20;
      --tau-ansi-black-fallback: #000000;
      --tau-ansi-red-fallback: #cd3131;
      --tau-ansi-green-fallback: #0dbc79;
      --tau-ansi-yellow-fallback: #e5e510;
      --tau-ansi-blue-fallback: #2472c8;
      --tau-ansi-magenta-fallback: #bc3fbc;
      --tau-ansi-cyan-fallback: #11a8cd;
      --tau-ansi-white-fallback: #e5e5e5;
      --tau-ansi-bright-black-fallback: #666666;
      --tau-ansi-bright-red-fallback: #f14c4c;
      --tau-ansi-bright-green-fallback: #23d18b;
      --tau-ansi-bright-yellow-fallback: #f5f543;
      --tau-ansi-bright-blue-fallback: #3b8eea;
      --tau-ansi-bright-magenta-fallback: #d670d6;
      --tau-ansi-bright-cyan-fallback: #29b8db;
      --tau-ansi-bright-white-fallback: #e5e5e5;
    }

    * {
      box-sizing: border-box;
      max-width: 100%;
    }

    body * {
      min-width: 0;
    }

    html,
    body {
      width: 100%;
      max-width: 100%;
      height: 100%;
    }

    body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      overflow-x: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    body.vscode-light {
      --tau-ansi-yellow-fallback: #949800;
      --tau-ansi-blue-fallback: #0451a5;
      --tau-ansi-white-fallback: #555555;
      --tau-ansi-bright-yellow-fallback: #795e26;
      --tau-ansi-bright-white-fallback: #222222;
    }

    .tau-view {
      --tau-lane-transition-duration: 190ms;
      --tau-lane-transition-easing: cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
      width: 100%;
      max-width: 100%;
      height: 100vh;
      padding: 0;
      min-width: 0;
      min-height: 0;
      /* Clip lanes without making the host horizontally scrollable during scrollIntoView calls. */
      overflow: hidden;
      overflow: clip;
    }

`;
