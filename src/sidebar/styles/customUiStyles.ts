export const customUiStyles = /* css */ `    .custom-ui {
      position: absolute;
      left: var(--tau-custom-ui-inline-offset);
      right: var(--tau-custom-ui-inline-offset);
      bottom: var(--tau-custom-ui-bottom-offset);
      z-index: var(--tau-z-floating-panel);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 6px;
      min-height: 96px;
      max-height: min(72vh, calc(100vh - var(--tau-custom-ui-bottom-offset) - var(--tau-custom-ui-viewport-bottom-reserve)));
      max-width: calc(100% - var(--tau-custom-ui-inline-offset) - var(--tau-custom-ui-inline-offset));
      margin: 0;
      padding: 8px 9px 9px;
      overflow: hidden;
      color: var(--vscode-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
      border-radius: 14px;
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }

    .custom-ui[hidden] {
      display: none;
    }

    .custom-ui:focus,
    .custom-ui:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .custom-ui__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.2;
    }

    .custom-ui__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .custom-ui__close {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
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

    .custom-ui__close:hover,
    .custom-ui__close:focus-visible {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      outline: none;
    }

    .custom-ui__output {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 2px 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      line-height: 1.35;
      white-space: pre;
      tab-size: 2;
    }

    .custom-ui__cursor {
      position: absolute;
      width: 1ch;
      min-width: 1ch;
      background: var(--vscode-editorCursor-foreground, var(--vscode-foreground));
      pointer-events: none;
      z-index: var(--tau-z-raised);
      animation: tau-custom-ui-cursor-blink 1s steps(1, end) infinite;
    }

    .custom-ui__cursor[hidden] {
      display: none;
    }

    @keyframes tau-custom-ui-cursor-blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }

    .custom-ui__input-capture {
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      height: 1px;
      min-width: 0;
      min-height: 0;
      margin: 0;
      padding: 0;
      opacity: 0;
      overflow: hidden;
      resize: none;
      color: transparent;
      background: transparent;
      border: 0;
      outline: 0;
      pointer-events: none;
      transform: translateZ(0);
    }

    .custom-ui__line {
      min-height: 1.35em;
      white-space: pre;
    }

    .custom-ui__line--ansi-image {
      display: flex;
      align-items: stretch;
      height: 1.35em;
      height: 1lh;
      min-height: 1.35em;
      min-height: 1lh;
      line-height: inherit;
    }

    .custom-ui__line--ansi-image .tau-ansi-block-image-cell {
      display: block;
      flex: 0 0 1ch;
      width: 1ch;
      height: 1.35em;
      height: 1lh;
    }

    body[class*="tau-custom-ui-theme-"] .custom-ui__header,
    body[class*="tau-custom-ui-theme-"] .custom-ui__output {
      position: relative;
      z-index: var(--tau-z-raised);
    }

    body.tau-custom-ui-theme-modern .custom-ui {
      color: var(--vscode-foreground);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 28%) padding-box,
        linear-gradient(180deg, #2a2d2f, #070809 64%, #000000) border-box;
      border: 4px solid transparent;
      border-radius: 18px;
      box-shadow:
        0 16px 32px rgba(0, 0, 0, 0.38),
        inset 0 1px 0 rgba(255, 255, 255, 0.18),
        inset 0 -14px 24px rgba(0, 0, 0, 0.32);
    }

    body.tau-custom-ui-theme-modern .custom-ui::before {
      content: "";
      position: absolute;
      inset: 7px;
      z-index: var(--tau-z-base);
      pointer-events: none;
      background: var(--vscode-input-background);
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      border-radius: 12px;
      box-shadow:
        inset 0 0 18px rgba(0, 0, 0, 0.36),
        0 0 0 1px rgba(255, 255, 255, 0.04);
    }

    body.tau-custom-ui-theme-modern .custom-ui__header {
      padding: 0 4px;
    }

    body.tau-custom-ui-theme-modern .custom-ui__output {
      margin: 0 2px 2px;
      padding: 8px 10px;
    }

    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden {
      opacity: 0.98;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.03) 18%, transparent 42%) padding-box,
        linear-gradient(180deg, #25282b, #090a0b 68%, #000) border-box;
      border: 3px solid transparent;
      border-radius: 18px 18px 26px 26px;
      box-shadow:
        0 18px 30px rgba(0, 0, 0, 0.34),
        inset 0 1px 0 rgba(255, 255, 255, 0.16),
        inset 0 -18px 28px rgba(0, 0, 0, 0.42);
      transform: perspective(300px) rotateX(9deg) translateY(-2px) scaleX(0.985);
      transform-origin: top center;
    }

    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden::before {
      content: "";
      position: absolute;
      inset: 13px 14px 18px;
      z-index: var(--tau-z-base);
      overflow: hidden;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.32), transparent 54%),
        repeating-linear-gradient(90deg, #f6f2e8 0 18px, transparent 18px 23px) 13px 7px / calc(100% - 26px) 10px no-repeat,
        repeating-linear-gradient(90deg, #eee9df 0 18px, transparent 18px 23px) 24px 25px / calc(100% - 48px) 10px no-repeat,
        repeating-linear-gradient(90deg, #e5ded1 0 20px, transparent 20px 25px) 42px 43px / calc(100% - 84px) 10px no-repeat,
        radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.12), transparent 68%);
      border: 1px solid rgba(255, 255, 255, 0.055);
      border-radius: 12px 12px 18px 18px;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        inset 0 -12px 18px rgba(0, 0, 0, 0.24);
      opacity: 0.76;
    }

    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden::after {
      content: "";
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 8px;
      z-index: var(--tau-z-raised);
      height: 8px;
      pointer-events: none;
      background:
        radial-gradient(circle at 10px 50%, rgba(105, 255, 160, 0.55) 0 2px, transparent 2.5px),
        radial-gradient(circle at 24px 50%, rgba(255, 214, 118, 0.36) 0 1.7px, transparent 2.3px),
        linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(0, 0, 0, 0.22));
      border-radius: 999px;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 5px 10px rgba(0, 0, 0, 0.22);
      opacity: 0.7;
    }

    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__slash-menu,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__context-badges,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__input,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__busy-submit,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__session-actions,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__info,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__model-menu,
    body.tau-custom-ui-theme-modern .composer.composer--custom-hidden .composer__submit {
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    body.tau-custom-ui-theme-crt .custom-ui,
    body.tau-custom-ui-theme-amber .custom-ui,
    body.tau-custom-ui-theme-matrix .custom-ui {
      --tau-custom-ui-screen: #061008;
      --tau-custom-ui-bezel: #101510;
      --tau-custom-ui-text: #9cff9c;
      --tau-custom-ui-dim: #64b764;
      --tau-custom-ui-accent: #c8ffc8;
      --tau-custom-ui-glow: rgba(132, 255, 132, 0.28);
      --tau-custom-ui-scanline: rgba(255, 255, 255, 0.045);
      --tau-custom-ui-vignette: rgba(0, 0, 0, 0.42);
      --vscode-terminal-ansiBlack: #031006;
      --vscode-terminal-ansiRed: #91d991;
      --vscode-terminal-ansiGreen: #8cff8c;
      --vscode-terminal-ansiYellow: #b8ffb8;
      --vscode-terminal-ansiBlue: #6bdc6b;
      --vscode-terminal-ansiMagenta: #9cff9c;
      --vscode-terminal-ansiCyan: #adffad;
      --vscode-terminal-ansiWhite: #d8ffd8;
      --vscode-terminal-ansiBrightBlack: #4f8f4f;
      --vscode-terminal-ansiBrightRed: #c8ffc8;
      --vscode-terminal-ansiBrightGreen: #b6ffb6;
      --vscode-terminal-ansiBrightYellow: #dbffdb;
      --vscode-terminal-ansiBrightBlue: #95ff95;
      --vscode-terminal-ansiBrightMagenta: #c8ffc8;
      --vscode-terminal-ansiBrightCyan: #d5ffd5;
      --vscode-terminal-ansiBrightWhite: #f0fff0;
      color: var(--tau-custom-ui-text);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--tau-custom-ui-bezel) 82%, white 10%), var(--tau-custom-ui-bezel)) padding-box,
        linear-gradient(180deg, color-mix(in srgb, var(--tau-custom-ui-accent) 38%, transparent), rgba(0, 0, 0, 0.72)) border-box;
      border: 3px solid transparent;
      border-radius: 18px;
      box-shadow:
        0 14px 34px rgba(0, 0, 0, 0.42),
        inset 0 1px 0 rgba(255, 255, 255, 0.14),
        inset 0 -16px 26px rgba(0, 0, 0, 0.34);
      text-shadow: 0 0 6px var(--tau-custom-ui-glow);
    }

    body.tau-custom-ui-theme-crt .custom-ui::before,
    body.tau-custom-ui-theme-amber .custom-ui::before,
    body.tau-custom-ui-theme-matrix .custom-ui::before,
    body.tau-custom-ui-theme-crt .custom-ui::after,
    body.tau-custom-ui-theme-amber .custom-ui::after,
    body.tau-custom-ui-theme-matrix .custom-ui::after {
      content: "";
      position: absolute;
      inset: 7px;
      pointer-events: none;
      border-radius: 12px;
    }

    body.tau-custom-ui-theme-crt .custom-ui::before,
    body.tau-custom-ui-theme-amber .custom-ui::before,
    body.tau-custom-ui-theme-matrix .custom-ui::before {
      z-index: var(--tau-z-base);
      background:
        radial-gradient(ellipse at center, transparent 0%, transparent 58%, var(--tau-custom-ui-vignette) 100%),
        var(--tau-custom-ui-screen);
      box-shadow:
        inset 0 0 22px rgba(0, 0, 0, 0.78),
        inset 0 0 4px var(--tau-custom-ui-glow),
        0 0 18px color-mix(in srgb, var(--tau-custom-ui-accent) 18%, transparent);
    }

    body.tau-custom-ui-theme-crt .custom-ui::after,
    body.tau-custom-ui-theme-amber .custom-ui::after,
    body.tau-custom-ui-theme-matrix .custom-ui::after {
      z-index: var(--tau-z-tooltip);
      background:
        repeating-linear-gradient(
          to bottom,
          var(--tau-custom-ui-scanline) 0,
          var(--tau-custom-ui-scanline) 1px,
          transparent 2px,
          transparent 4px
        );
      mix-blend-mode: screen;
      opacity: 0.65;
    }

    body.tau-custom-ui-theme-crt .custom-ui__header,
    body.tau-custom-ui-theme-amber .custom-ui__header,
    body.tau-custom-ui-theme-matrix .custom-ui__header {
      color: var(--tau-custom-ui-dim);
      padding: 0 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    body.tau-custom-ui-theme-crt .custom-ui__output,
    body.tau-custom-ui-theme-amber .custom-ui__output,
    body.tau-custom-ui-theme-matrix .custom-ui__output {
      margin: 0 2px 2px;
      padding: 8px 10px;
      color: var(--tau-custom-ui-text);
      scrollbar-color: var(--tau-custom-ui-dim) transparent;
    }

    body.tau-custom-ui-theme-crt .custom-ui__close,
    body.tau-custom-ui-theme-amber .custom-ui__close,
    body.tau-custom-ui-theme-matrix .custom-ui__close {
      color: var(--tau-custom-ui-dim);
    }

    body.tau-custom-ui-theme-crt .custom-ui__close:hover,
    body.tau-custom-ui-theme-crt .custom-ui__close:focus-visible,
    body.tau-custom-ui-theme-amber .custom-ui__close:hover,
    body.tau-custom-ui-theme-amber .custom-ui__close:focus-visible,
    body.tau-custom-ui-theme-matrix .custom-ui__close:hover,
    body.tau-custom-ui-theme-matrix .custom-ui__close:focus-visible {
      color: var(--tau-custom-ui-accent);
      background: color-mix(in srgb, var(--tau-custom-ui-accent) 12%, transparent);
    }

    body.tau-custom-ui-theme-crt .custom-ui__cursor,
    body.tau-custom-ui-theme-amber .custom-ui__cursor,
    body.tau-custom-ui-theme-matrix .custom-ui__cursor {
      background: var(--tau-custom-ui-accent);
      box-shadow: 0 0 10px var(--tau-custom-ui-glow);
    }

    body.tau-custom-ui-theme-amber .custom-ui {
      --tau-custom-ui-screen: #120b02;
      --tau-custom-ui-bezel: #16110a;
      --tau-custom-ui-text: #ffbf4d;
      --tau-custom-ui-dim: #b9822a;
      --tau-custom-ui-accent: #ffd27a;
      --tau-custom-ui-glow: rgba(255, 176, 0, 0.28);
      --tau-custom-ui-scanline: rgba(255, 190, 77, 0.06);
      --vscode-terminal-ansiBlack: #120b02;
      --vscode-terminal-ansiRed: #e0a34a;
      --vscode-terminal-ansiGreen: #ffbf4d;
      --vscode-terminal-ansiYellow: #ffd27a;
      --vscode-terminal-ansiBlue: #c98b2c;
      --vscode-terminal-ansiMagenta: #e6aa4a;
      --vscode-terminal-ansiCyan: #ffc766;
      --vscode-terminal-ansiWhite: #ffe2a3;
      --vscode-terminal-ansiBrightBlack: #8f6222;
      --vscode-terminal-ansiBrightRed: #ffd27a;
      --vscode-terminal-ansiBrightGreen: #ffd27a;
      --vscode-terminal-ansiBrightYellow: #ffe7b3;
      --vscode-terminal-ansiBrightBlue: #f0ae42;
      --vscode-terminal-ansiBrightMagenta: #ffd27a;
      --vscode-terminal-ansiBrightCyan: #ffe0a0;
      --vscode-terminal-ansiBrightWhite: #fff3d6;
    }

    body.tau-custom-ui-theme-matrix .custom-ui {
      --tau-custom-ui-screen: #020703;
      --tau-custom-ui-bezel: #07100a;
      --tau-custom-ui-text: #00ff66;
      --tau-custom-ui-dim: #00a84c;
      --tau-custom-ui-accent: #8dffb4;
      --tau-custom-ui-glow: rgba(0, 255, 102, 0.34);
      --tau-custom-ui-scanline: rgba(0, 255, 102, 0.052);
      --vscode-terminal-ansiBlack: #020703;
      --vscode-terminal-ansiRed: #00b84a;
      --vscode-terminal-ansiGreen: #00ff66;
      --vscode-terminal-ansiYellow: #74ff9d;
      --vscode-terminal-ansiBlue: #00c853;
      --vscode-terminal-ansiMagenta: #35e878;
      --vscode-terminal-ansiCyan: #8dffb4;
      --vscode-terminal-ansiWhite: #caffda;
      --vscode-terminal-ansiBrightBlack: #007c38;
      --vscode-terminal-ansiBrightRed: #54ff8a;
      --vscode-terminal-ansiBrightGreen: #83ffaa;
      --vscode-terminal-ansiBrightYellow: #b9ffd0;
      --vscode-terminal-ansiBrightBlue: #29ff75;
      --vscode-terminal-ansiBrightMagenta: #7dffa6;
      --vscode-terminal-ansiBrightCyan: #b8ffd0;
      --vscode-terminal-ansiBrightWhite: #effff3;
    }
`;
