// Pure ANSI theme facade shared by transcript rendering and Custom UI hosts.
// ANSI foregrounds are retained; the transcript renderer strips backgrounds.
const colorCodes: Record<string, number> = {
  accent: 36,
  border: 90,
  borderAccent: 36,
  borderMuted: 90,
  success: 32,
  error: 31,
  warning: 33,
  muted: 90,
  dim: 90,
  text: 37,
  thinkingText: 35,
  userMessageText: 36,
  customMessageText: 37,
  customMessageLabel: 36,
  toolTitle: 36,
  toolOutput: 37,
  mdHeading: 36,
  mdLink: 34,
  mdLinkUrl: 34,
  mdCode: 33,
  mdCodeBlock: 37,
  mdCodeBlockBorder: 90,
  mdQuote: 90,
  mdQuoteBorder: 90,
  mdHr: 90,
  mdListBullet: 36,
  toolDiffAdded: 32,
  toolDiffRemoved: 31,
  toolDiffContext: 90,
  syntaxComment: 90,
  syntaxKeyword: 35,
  syntaxFunction: 36,
  syntaxVariable: 37,
  syntaxString: 32,
  syntaxNumber: 33,
  syntaxType: 36,
  syntaxOperator: 37,
  syntaxPunctuation: 37,
  thinkingOff: 90,
  thinkingMinimal: 36,
  thinkingLow: 34,
  thinkingMedium: 33,
  thinkingHigh: 31,
  thinkingXhigh: 35,
  bashMode: 32
};

const bgCodes: Record<string, number> = {
  selectedBg: 44,
  userMessageBg: 44,
  customMessageBg: 45,
  toolPendingBg: 43,
  toolSuccessBg: 42,
  toolErrorBg: 41
};

export const taurenTheme = {
  fg(color: string, text: string) {
    return wrap(colorCodes[color] ?? 37, text);
  },
  bg(color: string, text: string) {
    return wrap(bgCodes[color] ?? 44, text);
  },
  bold(text: string) {
    return wrap(1, text);
  },
  italic(text: string) {
    return wrap(3, text);
  },
  underline(text: string) {
    return wrap(4, text);
  },
  inverse(text: string) {
    return wrap(7, text);
  },
  strikethrough(text: string) {
    return wrap(9, text);
  },
  getFgAnsi(color: string) {
    return `\x1b[${colorCodes[color] ?? 37}m`;
  },
  getBgAnsi(color: string) {
    return `\x1b[${bgCodes[color] ?? 44}m`;
  },
  getColorMode() {
    return '256color';
  },
  getThinkingBorderColor(level: string) {
    return (text: string) => wrap(colorCodes[`thinking${capitalize(level)}`] ?? 36, text);
  },
  getBashModeBorderColor() {
    return (text: string) => wrap(colorCodes.bashMode ?? 32, text);
  }
};

function wrap(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}
