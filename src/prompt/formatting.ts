import type { PiPromptFormattingContextAttachment } from './types';

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

  const contextItems = context.flatMap((attachment) => {
    const formatted = formatPromptContextAttachment(attachment);
    return formatted ? [formatted] : [];
  });

  if (contextItems.length === 0) {
    return userText;
  }

  const traceOriginContext = formatTraceOriginContext(context);
  const contextBody = [
    ...(traceOriginContext ? [traceOriginContext] : []),
    ...contextItems
  ].join('\n\n');

  return [
    userText,
    '',
    '<ide_context source="vscode-tau">',
    'User-attached IDE context.',
    '',
    contextBody,
    '</ide_context>'
  ].join('\n');
}

function formatTraceOriginContext(context: PiPromptFormattingContextAttachment[]): string | undefined {
  const data = dedupeTraceOriginData(context
    .filter((attachment) => attachment.source === 'origin' && attachment.traceOrigin)
    .map((attachment) => attachment.traceOrigin!));

  if (data.length === 0) {
    return undefined;
  }

  const payload = data.length === 1 ? data[0] : data;

  return [
    '<trace_origin_instructions>',
    'The attached metadata links historical agent work to the current code location.',
    'Use currentRelativePath for current file reads.',
    'Use historicalPath only to understand the original session context.',
    'Avoid repository search unless direct file reads fail.',
    '</trace_origin_instructions>',
    '',
    '<trace_origin_data>',
    JSON.stringify(payload, null, 2),
    '</trace_origin_data>'
  ].join('\n');
}

function dedupeTraceOriginData(
  data: NonNullable<PiPromptFormattingContextAttachment['traceOrigin']>[]
): Array<NonNullable<PiPromptFormattingContextAttachment['traceOrigin']>> {
  const result: Array<NonNullable<PiPromptFormattingContextAttachment['traceOrigin']>> = [];
  const seen = new Set<string>();

  for (const item of data) {
    const key = JSON.stringify(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function formatPromptContextAttachment(attachment: PiPromptFormattingContextAttachment): string | undefined {
  if (attachment.kind === 'file') {
    const attributes = [
      `path="${escapeXmlAttribute(attachment.path)}"`,
      ...(attachment.note ? [`note="${escapeXmlAttribute(attachment.note)}"`] : [])
    ];
    return `<file ${attributes.join(' ')} />`;
  }

  const text = attachment.text ?? '';

  if (!text.trim()) {
    return undefined;
  }

  const attributes = [
    `path="${escapeXmlAttribute(attachment.path)}"`,
    ...(attachment.startLine ? [`start_line="${attachment.startLine}"`] : []),
    ...(attachment.endLine ? [`end_line="${attachment.endLine}"`] : []),
    ...(attachment.languageId ? [`language="${escapeXmlAttribute(attachment.languageId)}"`] : []),
    ...(attachment.note ? [`note="${escapeXmlAttribute(attachment.note)}"`] : [])
  ];
  return [
    `<selection ${attributes.join(' ')}><![CDATA[`,
    escapeCdata(text),
    ']]></selection>'
  ].join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeCdata(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
}
