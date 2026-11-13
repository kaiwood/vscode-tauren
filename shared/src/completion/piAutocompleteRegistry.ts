import type { AutocompleteProviderFactory } from '@earendil-works/pi-coding-agent';
import { createTaurenBaseAutocompleteProvider, type PiAutocompleteItem, type PiAutocompleteProvider } from './baseProvider.js';
import type { CompletionApplication, CompletionApplied, CompletionCapabilities, CompletionParams, CompletionResult } from './types.js';

const maxTextLength = 100_000;
const maxItems = 50;
const maxItemTextLength = 4_000;
const maxAppliedLines = 10_000;
const maxAppliedTextLength = 100_000;

type ParsedRequest = { lines: string[]; cursorLine: number; cursorCol: number };
type CachedCompletion = ParsedRequest & { requestId: string; revision: number; generation: number; signal: AbortSignal; item: PiAutocompleteItem; prefix: string; provider: PiAutocompleteProvider };

/** Owns Pi-only provider composition and opaque completion handles for one SDK lifecycle. */
export class PiAutocompleteRegistry {
  private readonly factories: AutocompleteProviderFactory[] = [];
  private readonly completions = new Map<string, CachedCompletion>();
  private readonly reportedFailures = new Set<string>();
  private sequence = 0;
  private requestSequence = 0;
  private generation = 0;
  private triggerCharacters = ['@'];

  public constructor(private readonly options: { onCapabilitiesChange?: (capabilities: CompletionCapabilities) => void; onDiagnostic?: (message: string) => void } = {}) {}

  /** Register a Pi provider wrapper. */
  public add(factory: AutocompleteProviderFactory): void {
    this.factories.push(factory);
    this.refreshTriggerCharacters();
  }

  /** Begin a new SDK lifecycle, invalidating factories, handles and in-flight results. */
  public reset(): void {
    this.requestSequence += 1;
    this.factories.length = 0;
    this.completions.clear();
    this.reportedFailures.clear();
    this.generation += 1;
    this.triggerCharacters = ['@'];
    this.publishCapabilities();
  }

  /** Return a detached capability snapshot for consumers. */
  public getCapabilities(): CompletionCapabilities {
    return { triggerCharacters: this.triggerCharacters.slice(), generation: this.generation };
  }

  /** Suggest against one text revision; only the latest live request may cache handles. */
  public async complete(request: CompletionParams, cwd: string | undefined, signal: AbortSignal): Promise<CompletionResult> {
    const requestSequence = ++this.requestSequence;
    this.completions.clear();
    const parsed = parseRequest(request);
    if (!parsed || signal.aborted) {
      return this.emptyResult(request);
    }

    const provider = this.createProvider(() => cwd);
    const automaticFileCompletion = isAtFileCompletion(parsed);
    if (automaticFileCompletion && !this.shouldTriggerFileCompletion(provider, parsed)) {
      return this.emptyResult(request);
    }

    const suggestions = await this.getSuggestions(provider, parsed, signal);
    if (signal.aborted || requestSequence !== this.requestSequence || !suggestions) {
      return this.emptyResult(request);
    }

    const items = suggestions.items.slice(0, maxItems).map((item) => {
      const id = `completion-${this.generation}-${++this.sequence}`;
      this.completions.set(id, { requestId: request.id, revision: request.revision, generation: this.generation, signal, item, prefix: suggestions.prefix, provider, ...parsed });
      return { id, value: item.value, label: item.label, ...(item.description ? { description: item.description } : {}) };
    });
    return { id: request.id, revision: request.revision, items, capabilities: this.getCapabilities() };
  }

  /** Consume the cache once, validating request identity, revision and SDK generation. */
  public apply(application: CompletionApplication): CompletionApplied | undefined {
    this.requestSequence += 1;
    const cached = this.completions.get(application.itemId);
    this.completions.clear();
    if (!cached || cached.signal.aborted || cached.requestId !== application.id || cached.revision !== application.revision || cached.generation !== this.generation) {
      return undefined;
    }

    const applied = this.applyCompletion(cached.provider, cached);
    if (!applied) {
      return undefined;
    }

    const text = applied.lines.join('\n');
    const selectionStart = lineColumnToOffset(applied.lines, applied.cursorLine, applied.cursorCol);
    return { id: application.id, revision: application.revision, text, selectionStart, selectionEnd: selectionStart };
  }

  private emptyResult(request: CompletionParams): CompletionResult {
    return { id: request.id, revision: request.revision, items: [], capabilities: this.getCapabilities() };
  }

  private createProvider(cwd: string | undefined | (() => string | undefined)): PiAutocompleteProvider {
    let current = createTaurenBaseAutocompleteProvider(cwd);
    for (const factory of this.factories) {
      const previous = current;
      try {
        const candidate = factory(previous);
        if (!isProvider(candidate)) {
          this.reportFailure('factory returned an invalid autocomplete provider');
          continue;
        }
        current = createRecoverableProvider(candidate, previous, (operation) => this.reportFailure(`autocomplete provider ${operation} failed`));
      } catch {
        this.reportFailure('autocomplete provider factory failed');
      }
    }
    return current;
  }

  private async getSuggestions(provider: PiAutocompleteProvider, parsed: ParsedRequest, signal: AbortSignal): Promise<{ prefix: string; items: PiAutocompleteItem[] } | undefined> {
    try {
      const result = await provider.getSuggestions(parsed.lines, parsed.cursorLine, parsed.cursorCol, { signal });
      return !signal.aborted && isSuggestions(result) ? result : undefined;
    } catch {
      if (!signal.aborted) {
        this.reportFailure('autocomplete provider suggestions failed');
      }
      return undefined;
    }
  }

  private shouldTriggerFileCompletion(provider: PiAutocompleteProvider, parsed: ParsedRequest): boolean {
    try {
      return provider.shouldTriggerFileCompletion?.(parsed.lines, parsed.cursorLine, parsed.cursorCol) ?? true;
    } catch {
      this.reportFailure('autocomplete provider file trigger predicate failed');
      return true;
    }
  }

  private applyCompletion(provider: PiAutocompleteProvider, cached: CachedCompletion): { lines: string[]; cursorLine: number; cursorCol: number } | undefined {
    try {
      const result = provider.applyCompletion(cached.lines, cached.cursorLine, cached.cursorCol, cached.item, cached.prefix);
      return isApplied(result) ? result : undefined;
    } catch {
      this.reportFailure('autocomplete provider application failed');
      return undefined;
    }
  }

  private refreshTriggerCharacters(): void {
    const provider = this.createProvider(undefined);
    const triggers = provider.triggerCharacters?.filter(isTriggerCharacter) ?? [];
    this.triggerCharacters = Array.from(new Set(['@', ...triggers]));
    this.publishCapabilities();
  }

  private publishCapabilities(): void {
    this.options.onCapabilitiesChange?.(this.getCapabilities());
  }

  private reportFailure(message: string): void {
    if (!this.reportedFailures.has(message)) {
      this.reportedFailures.add(message);
      this.options.onDiagnostic?.(message);
    }
  }
}

function createRecoverableProvider(provider: PiAutocompleteProvider, previous: PiAutocompleteProvider, reportFailure: (operation: string) => void): PiAutocompleteProvider {
  return {
    triggerCharacters: Array.from(new Set([...(previous.triggerCharacters ?? []), ...(provider.triggerCharacters ?? []).filter(isTriggerCharacter)])),
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      try {
        const result = await provider.getSuggestions(lines, cursorLine, cursorCol, options);
        if (result === null || isSuggestions(result) || options.signal.aborted) {
          return result;
        }
        reportFailure('suggestions returned malformed data');
      } catch {
        if (options.signal.aborted) {
          return null;
        }
        reportFailure('suggestions threw');
      }
      return previous.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      try {
        const result = provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        if (isApplied(result)) {
          return result;
        }
        reportFailure('application returned malformed data');
      } catch {
        reportFailure('application threw');
      }
      return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      try {
        return provider.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? previous.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      } catch {
        reportFailure('file trigger predicate threw');
        return previous.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }
    }
  };
}

function parseRequest(request: CompletionParams): ParsedRequest | undefined {
  if (request.text.length > maxTextLength || !Number.isInteger(request.selectionStart) || !Number.isInteger(request.selectionEnd) || request.selectionStart < 0 || request.selectionStart !== request.selectionEnd || request.selectionStart > request.text.length) {
    return undefined;
  }
  const lines = request.text.split('\n');
  let offset = request.selectionStart;
  for (let cursorLine = 0; cursorLine < lines.length; cursorLine += 1) {
    const line = lines[cursorLine]!;
    if (offset <= line.length) {
      return { lines, cursorLine, cursorCol: offset };
    }
    offset -= line.length + 1;
  }
  return undefined;
}

function isAtFileCompletion(parsed: ParsedRequest): boolean {
  const before = (parsed.lines[parsed.cursorLine] ?? '').slice(0, parsed.cursorCol);
  return /(?:^|[\s='\"])@(?:"[^\"]*|[^\s='\"]*)$/.test(before);
}

function lineColumnToOffset(lines: string[], line: number, col: number): number {
  return lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0) + col;
}

function isTriggerCharacter(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length === 1 && !/\s/.test(value);
}
function isProvider(value: unknown): value is PiAutocompleteProvider {
  return typeof value === 'object' && value !== null && typeof (value as PiAutocompleteProvider).getSuggestions === 'function' && typeof (value as PiAutocompleteProvider).applyCompletion === 'function';
}
function isSuggestions(value: unknown): value is { prefix: string; items: PiAutocompleteItem[] } {
  return typeof value === 'object' && value !== null && typeof (value as { prefix?: unknown }).prefix === 'string' && (value as { prefix: string }).prefix.length <= maxItemTextLength && Array.isArray((value as { items?: unknown }).items) && (value as { items: unknown[] }).items.every(isItem);
}
function isItem(item: unknown): item is PiAutocompleteItem {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const candidate = item as { value?: unknown; label?: unknown; description?: unknown };
  return typeof candidate.value === 'string' && candidate.value.length <= maxItemTextLength
    && typeof candidate.label === 'string' && candidate.label.length <= maxItemTextLength
    && (candidate.description === undefined || (typeof candidate.description === 'string' && candidate.description.length <= maxItemTextLength));
}
function isApplied(value: unknown): value is { lines: string[]; cursorLine: number; cursorCol: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as { lines?: unknown; cursorLine?: unknown; cursorCol?: unknown };
  if (!Array.isArray(result.lines) || result.lines.length === 0 || result.lines.length > maxAppliedLines || !result.lines.every((line) => typeof line === 'string' && line.length <= maxAppliedTextLength) || result.lines.join('\n').length > maxAppliedTextLength || typeof result.cursorLine !== 'number' || typeof result.cursorCol !== 'number' || !Number.isInteger(result.cursorLine) || !Number.isInteger(result.cursorCol) || result.cursorLine < 0 || result.cursorLine >= result.lines.length || result.cursorCol < 0) {
    return false;
  }
  const line = result.lines[result.cursorLine];
  return typeof line === 'string' && result.cursorCol <= line.length;
}
