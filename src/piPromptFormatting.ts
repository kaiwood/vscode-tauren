export type PiPromptFormattingContextAttachment = {
  kind: 'file' | 'selection';
  path: string;
  languageId?: string;
  startLine?: number;
  endLine?: number;
  text?: string;
};

const ideContextStartMarker = '<!-- tau:ide-context:start -->';
const ideContextEndMarker = '<!-- tau:ide-context:end -->';

export function formatPromptForPi(
  userText: string,
  context: PiPromptFormattingContextAttachment[]
): string {
  return formatPromptWithIdeContext(userText, context);
}

export function formatPromptWithIdeContext(
  userText: string,
  context: PiPromptFormattingContextAttachment[]
): string {
  if (context.length === 0) {
    return userText;
  }

  const contextBody = context.flatMap((attachment) => {
    const formatted = formatPromptContextAttachment(attachment);
    return formatted ? [formatted] : [];
  }).join('\n\n');

  if (!contextBody) {
    return userText;
  }

  return [
    ideContextStartMarker,
    '<ide_context source="vscode-tau">',
    'The user explicitly attached this IDE context. Use it as relevant. File-only entries identify relevant files; inspect or read them if content is needed.',
    '',
    contextBody,
    '</ide_context>',
    ideContextEndMarker,
    '',
    userText
  ].join('\n');
}

function formatPromptContextAttachment(attachment: PiPromptFormattingContextAttachment): string | undefined {
  if (attachment.kind === 'file') {
    return `<file path="${escapeXmlAttribute(attachment.path)}" />`;
  }

  const text = attachment.text ?? '';

  if (!text.trim()) {
    return undefined;
  }

  const attributes = [
    `path="${escapeXmlAttribute(attachment.path)}"`,
    ...(attachment.startLine ? [`start_line="${attachment.startLine}"`] : []),
    ...(attachment.endLine ? [`end_line="${attachment.endLine}"`] : []),
    ...(attachment.languageId ? [`language="${escapeXmlAttribute(attachment.languageId)}"`] : [])
  ];
  const fence = getMarkdownFence(text);
  const language = sanitizeFenceLanguage(attachment.languageId);

  return [
    `<selection ${attributes.join(' ')}>`,
    `${fence}${language}`,
    text,
    fence,
    '</selection>'
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getMarkdownFence(text: string): string {
  return '`'.repeat(Math.max(3, getLongestBacktickRun(text) + 1));
}

function getLongestBacktickRun(text: string): number {
  let longest = 0;

  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }

  return longest;
}

function sanitizeFenceLanguage(languageId: string | undefined): string {
  if (!languageId || !/^[A-Za-z0-9_#+.-]+$/.test(languageId)) {
    return '';
  }

  return languageId;
}
