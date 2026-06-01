import { readFile, writeFile } from 'node:fs/promises';

export const taurenExportSkinStyleId = 'tauren-export-skin';

const taurenExportSkinCss = `
/* Tauren export skin: overrides Pi export variables without replacing Pi's renderer. */
:root {
  color-scheme: light dark;
  --line-height: 23px;
  --body-bg: #faf7ef;
  --container-bg: rgba(255, 255, 255, 0.74);
  --info-bg: #f2eee5;

  --text: #1d1712;
  --muted: #594f45;
  --dim: rgba(72, 56, 40, 0.48);
  --accent: #8a5b2f;
  --border: #ad7a43;
  --borderAccent: #8a5b2f;
  --selectedBg: rgba(173, 122, 67, 0.14);
  --hover: rgba(173, 122, 67, 0.12);

  --success: #4f7f42;
  --error: #b2483d;
  --warning: #ad7a43;

  --userMessageBg: rgba(255, 255, 255, 0.74);
  --userMessageText: #1d1712;
  --customMessageBg: rgba(173, 122, 67, 0.12);
  --customMessageText: #1d1712;
  --customMessageLabel: #8a5b2f;
  --toolPendingBg: rgba(173, 122, 67, 0.10);
  --toolSuccessBg: rgba(79, 127, 66, 0.12);
  --toolErrorBg: rgba(178, 72, 61, 0.12);
  --toolOutput: #594f45;
  --toolDiffAdded: #4f7f42;
  --toolDiffRemoved: #b2483d;
  --toolDiffContext: #594f45;

  --thinkingText: #594f45;
  --mdHeading: #8a5b2f;
  --mdLink: #8a5b2f;
  --mdCode: #8a5b2f;
  --mdCodeBlockBorder: rgba(72, 56, 40, 0.16);
  --mdQuote: #594f45;
  --mdQuoteBorder: #ad7a43;
  --mdHr: rgba(72, 56, 40, 0.16);
  --mdListBullet: #ad7a43;

  --syntaxComment: #6f7157;
  --syntaxKeyword: #8a5b2f;
  --syntaxFunction: #9d6f3b;
  --syntaxVariable: #4f6470;
  --syntaxString: #8f5f3f;
  --syntaxNumber: #6d743f;
  --syntaxType: #6b6a2f;
  --syntaxOperator: #594f45;
  --syntaxPunctuation: #594f45;
}

@media (prefers-color-scheme: dark) {
  :root {
    --body-bg: #05080b;
    --container-bg: rgba(7, 12, 16, 0.72);
    --info-bg: rgba(214, 170, 114, 0.12);

    --text: #fbf1df;
    --muted: #c5b8a6;
    --dim: rgba(244, 232, 207, 0.38);
    --accent: #d6aa72;
    --border: #d6aa72;
    --borderAccent: #f1d7ad;
    --selectedBg: rgba(214, 170, 114, 0.16);
    --hover: rgba(214, 170, 114, 0.14);

    --success: #8fbf7f;
    --error: #f08b7f;
    --warning: #d6aa72;

    --userMessageBg: rgba(10, 15, 19, 0.78);
    --userMessageText: #fbf1df;
    --customMessageBg: rgba(214, 170, 114, 0.12);
    --customMessageText: #fbf1df;
    --customMessageLabel: #f1d7ad;
    --toolPendingBg: rgba(214, 170, 114, 0.10);
    --toolSuccessBg: rgba(143, 191, 127, 0.12);
    --toolErrorBg: rgba(240, 139, 127, 0.12);
    --toolOutput: #c5b8a6;
    --toolDiffAdded: #8fbf7f;
    --toolDiffRemoved: #f08b7f;
    --toolDiffContext: #c5b8a6;

    --thinkingText: #c5b8a6;
    --mdHeading: #f1d7ad;
    --mdLink: #d6aa72;
    --mdCode: #f1d7ad;
    --mdCodeBlockBorder: rgba(244, 232, 207, 0.15);
    --mdQuote: #c5b8a6;
    --mdQuoteBorder: #d6aa72;
    --mdHr: rgba(244, 232, 207, 0.15);
    --mdListBullet: #d6aa72;

    --syntaxComment: #8a8f75;
    --syntaxKeyword: #d6aa72;
    --syntaxFunction: #f1d7ad;
    --syntaxVariable: #a8c7d8;
    --syntaxString: #e2b08b;
    --syntaxNumber: #b8c98a;
    --syntaxType: #c8c07a;
    --syntaxOperator: #c5b8a6;
    --syntaxPunctuation: #c5b8a6;
  }
}

body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  letter-spacing: -0.01em;
}

#sidebar,
.sidebar-search,
.filter-btn,
.sidebar-close,
.tree-prefix,
.tool-command,
.tool-output,
.tool-output pre,
.tool-output code,
.tool-diff,
.markdown-content pre,
.markdown-content pre code,
.markdown-content code,
.line-numbers,
.line-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.user-message,
.tool-execution,
.session-info,
.system-prompt,
.tools-section,
.skill-user-entry,
.skill-invocation {
  border: 1px solid var(--mdHr);
  border-radius: 10px;
}

.copy-link-btn,
.filter-btn,
.sidebar-search,
.sidebar-close {
  border-radius: 8px;
}

.system-prompt-preview,
.system-prompt-full,
.tool-item,
.tool-param,
.tool-param-required,
.tool-param-optional {
  font-size: 14px;
  line-height: 21px;
}

.system-prompt-note,
.tool-params-hint {
  font-size: 13px;
  line-height: 20px;
}

.ansi-rendered [style*="color:#626262"],
.ansi-rendered [style*="color: #626262"] {
  color: var(--muted) !important;
}

.ansi-rendered [style*="color:#808080"],
.ansi-rendered [style*="color: #808080"] {
  color: var(--dim) !important;
}

.ansi-rendered [style*="color:#afaf5f"],
.ansi-rendered [style*="color: #afaf5f"] {
  color: var(--accent) !important;
}

.ansi-rendered [style*="background-color:#005f00"],
.ansi-rendered [style*="background-color: #005f00"] {
  background-color: rgba(79, 127, 66, 0.18) !important;
  color: var(--text) !important;
}

@media (prefers-color-scheme: dark) {
  .ansi-rendered [style*="background-color:#005f00"],
  .ansi-rendered [style*="background-color: #005f00"] {
    background-color: rgba(143, 191, 127, 0.18) !important;
    color: var(--text) !important;
  }
}
`;

export function injectTaurenExportSkin(html: string): string {
  const style = `<style id="${taurenExportSkinStyleId}">\n${taurenExportSkinCss.trim()}\n</style>`;
  const existingStylePattern = new RegExp(`<style\\s+id=["']${taurenExportSkinStyleId}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i');

  if (existingStylePattern.test(html)) {
    return html.replace(existingStylePattern, style);
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}\n</head>`);
  }

  return `${style}\n${html}`;
}

export async function applyTaurenExportSkinToFile(filePath: string): Promise<void> {
  const html = await readFile(filePath, 'utf-8');
  const skinnedHtml = injectTaurenExportSkin(html);

  if (skinnedHtml !== html) {
    await writeFile(filePath, skinnedHtml, 'utf-8');
  }
}
