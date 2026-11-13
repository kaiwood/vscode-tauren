/** Transport-neutral composer completion contract. */
export type CompletionItem = {
  id: string;
  value: string;
  label: string;
  description?: string;
};

export type CompletionParams = {
  id: string;
  revision: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export type CompletionResult = {
  id: string;
  revision: number;
  items: CompletionItem[];
  capabilities: CompletionCapabilities;
};

export type CompletionApplication = {
  id: string;
  revision: number;
  itemId: string;
};

export type CompletionApplied = {
  id: string;
  revision: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export type CompletionCapabilities = {
  triggerCharacters: string[];
  generation: number;
};

export type PiAutocompleteItem = { value: string; label: string; description?: string };
export type PiAutocompleteSuggestions = { items: PiAutocompleteItem[]; prefix: string };
export type PiAutocompleteProvider = {
  triggerCharacters?: string[];
  getSuggestions(lines: string[], cursorLine: number, cursorCol: number, options: { signal: AbortSignal; force?: boolean }): Promise<PiAutocompleteSuggestions | null>;
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: PiAutocompleteItem, prefix: string): { lines: string[]; cursorLine: number; cursorCol: number };
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
};

/** Path suggestions retain directory metadata before projection to completion items. */
export type FileSuggestion = PiAutocompleteItem & { directory: boolean };

/** Compatibility aliases for the extension composer API. */
export type ComposerCompletionItem = CompletionItem;
export type ComposerCompletionResult = CompletionResult;
export type ComposerCompletionApplication = CompletionApplication;
export type ComposerCompletionApplied = CompletionApplied;
export type ComposerCompletionCapabilities = CompletionCapabilities;
export type ComposerCompletionRequest = CompletionParams;
