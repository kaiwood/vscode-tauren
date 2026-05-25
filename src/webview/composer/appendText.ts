export type ComposerAppendTextResult = {
  text: string;
  cursor: number;
};

export function appendComposerText(existingText: string, appendedText: string): ComposerAppendTextResult {
  if (existingText.length === 0) {
    return {
      text: appendedText,
      cursor: appendedText.length
    };
  }

  const separator = existingText.endsWith('\n') ? '' : '\n';
  const text = `${existingText}${separator}${appendedText}`;

  return {
    text,
    cursor: text.length
  };
}
