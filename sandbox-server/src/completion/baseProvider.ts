/** Adapted from src/autocomplete/baseProvider.ts without extension-host dependencies.
 * The base provider preserves @ path insertion, quoting and directory cursor behavior. */
import { getAtFileSuggestions } from './fileSuggestions/fileSuggestionProvider.js';

export type PiAutocompleteItem = { value: string; label: string; description?: string };
export type PiAutocompleteSuggestions = { items: PiAutocompleteItem[]; prefix: string };
export type PiAutocompleteProvider = {
  triggerCharacters?: string[];
  getSuggestions(lines: string[], cursorLine: number, cursorCol: number, options: { signal: AbortSignal; force?: boolean }): Promise<PiAutocompleteSuggestions | null>;
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: PiAutocompleteItem, prefix: string): { lines: string[]; cursorLine: number; cursorCol: number };
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
};

export function createTaurenBaseAutocompleteProvider(cwd: string | undefined | (() => string | undefined)): PiAutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      if (options.signal.aborted) {
        return null;
      }

      const prefix = getAtPrefix(lines[cursorLine] ?? '', cursorCol);
      if (!prefix) {
        return null;
      }

      const items = await getAtFileSuggestions({ cwd: typeof cwd === 'function' ? cwd() : cwd, prefix: prefix.prefix });
      return options.signal.aborted ? null : { prefix: prefix.prefix, items };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? '';
      const start = Math.max(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
      const hasTrailingQuoteInItem = item.value.endsWith('"');
      const adjustedAfterCursor = hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
      const directory = item.value.endsWith('/') || item.value.endsWith('/"');
      const suffix = directory ? '' : ' ';
      const cursorOffset = directory && hasTrailingQuoteInItem ? item.value.length - 1 : item.value.length;
      const nextLines = lines.slice();
      nextLines[cursorLine] = line.slice(0, start) + item.value + suffix + adjustedAfterCursor;
      return { lines: nextLines, cursorLine, cursorCol: start + cursorOffset + suffix.length };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return Boolean(getAtPrefix(lines[cursorLine] ?? '', cursorCol));
    }
  };
}

function getAtPrefix(line: string, cursorCol: number): { prefix: string } | undefined {
  const beforeCursor = line.slice(0, cursorCol);
  const quoted = beforeCursor.match(/(?:^|[\s='\"])@(\"[^\"]*)$/);
  if (quoted) {
    return { prefix: quoted[0]!.trimStart() };
  }

  const token = beforeCursor.match(/(?:^|[\s='\"])(@[^\s='\"]*)$/);
  return token?.[1] !== undefined ? { prefix: token[1] } : undefined;
}
