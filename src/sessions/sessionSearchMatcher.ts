export type SessionSearchToken = {
  kind: 'fuzzy' | 'phrase';
  value: string;
};

export type ParsedSessionSearchQuery = {
  mode: 'tokens' | 'regex';
  tokens: SessionSearchToken[];
  regex: RegExp | null;
  error?: string;
};

export type SessionSearchMatchResult = {
  matches: boolean;
  score: number;
};

export type SearchableSession = {
  path: string;
  name?: string;
  text: string;
  modifiedTime?: number;
};

export type FilterSessionSearchOptions = {
  namedOnly?: boolean;
};

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeSessionSearchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function hasSessionName(session: { name?: string }): boolean {
  return Boolean(session.name?.trim());
}

export function parseSessionSearchQuery(query: string): ParsedSessionSearchQuery {
  const trimmed = query.trim();

  if (!trimmed) {
    return { mode: 'tokens', tokens: [], regex: null };
  }

  if (trimmed.startsWith('re:')) {
    const pattern = trimmed.slice(3).trim();

    if (!pattern) {
      return { mode: 'regex', tokens: [], regex: null, error: 'Empty regex' };
    }

    try {
      return { mode: 'regex', tokens: [], regex: new RegExp(pattern, 'i') };
    } catch (error) {
      return {
        mode: 'regex',
        tokens: [],
        regex: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const tokens: SessionSearchToken[] = [];
  let buffer = '';
  let inQuote = false;

  const flush = (kind: SessionSearchToken['kind']): void => {
    const value = buffer.trim();
    buffer = '';

    if (value) {
      tokens.push({ kind, value });
    }
  };

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (char === '"') {
      if (inQuote) {
        flush('phrase');
        inQuote = false;
      } else {
        flush('fuzzy');
        inQuote = true;
      }
      continue;
    }

    if (!inQuote && /\s/.test(char)) {
      flush('fuzzy');
      continue;
    }

    buffer += char;
  }

  if (inQuote) {
    return {
      mode: 'tokens',
      tokens: trimmed
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((token) => ({ kind: 'fuzzy', value: token })),
      regex: null
    };
  }

  flush('fuzzy');

  return { mode: 'tokens', tokens, regex: null };
}

export function matchSessionSearchText(text: string, parsed: ParsedSessionSearchQuery): SessionSearchMatchResult {
  if (parsed.mode === 'regex') {
    if (!parsed.regex) {
      return { matches: false, score: 0 };
    }

    const index = text.search(parsed.regex);
    return index < 0
      ? { matches: false, score: 0 }
      : { matches: true, score: index * 0.1 };
  }

  if (parsed.tokens.length === 0) {
    return { matches: true, score: 0 };
  }

  let totalScore = 0;
  let normalizedText: string | undefined;

  for (const token of parsed.tokens) {
    if (token.kind === 'phrase') {
      normalizedText ??= normalizeWhitespaceLower(text);
      const phrase = normalizeWhitespaceLower(token.value);

      if (!phrase) {
        continue;
      }

      const index = normalizedText.indexOf(phrase);

      if (index < 0) {
        return { matches: false, score: 0 };
      }

      totalScore += index * 0.1;
      continue;
    }

    const fuzzy = fuzzyMatchToken(token.value, text);

    if (!fuzzy.matches) {
      return { matches: false, score: 0 };
    }

    totalScore += fuzzy.score;
  }

  return { matches: true, score: totalScore };
}

export function filterAndSortSessionSearchItems(
  sessions: readonly SearchableSession[],
  query: string,
  options: FilterSessionSearchOptions = {}
): string[] {
  const filteredByName = options.namedOnly
    ? sessions.filter((session) => hasSessionName(session))
    : [...sessions];
  const trimmed = query.trim();

  if (!trimmed) {
    return filteredByName.map((session) => session.path);
  }

  const parsed = parseSessionSearchQuery(query);

  if (parsed.error) {
    return [];
  }

  const matches: Array<{ session: SearchableSession; score: number; index: number }> = [];

  for (let index = 0; index < filteredByName.length; index += 1) {
    const session = filteredByName[index];
    const match = matchSessionSearchText(session.text, parsed);

    if (match.matches) {
      matches.push({ session, score: match.score, index });
    }
  }

  matches.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }

    const leftModified = left.session.modifiedTime ?? 0;
    const rightModified = right.session.modifiedTime ?? 0;

    if (leftModified !== rightModified) {
      return rightModified - leftModified;
    }

    return left.index - right.index;
  });

  return matches.map((match) => match.session.path);
}

function fuzzyMatchToken(token: string, text: string): SessionSearchMatchResult {
  const needle = token.trim().toLowerCase();

  if (!needle) {
    return { matches: true, score: 0 };
  }

  const haystack = text.toLowerCase();
  const exactIndex = haystack.indexOf(needle);

  if (exactIndex >= 0) {
    return { matches: true, score: exactIndex * 0.1 };
  }

  let score = 0;
  let searchFrom = 0;
  let previousIndex = -1;

  for (let index = 0; index < needle.length; index += 1) {
    const foundIndex = haystack.indexOf(needle[index], searchFrom);

    if (foundIndex < 0) {
      return { matches: false, score: 0 };
    }

    if (previousIndex >= 0) {
      const gap = foundIndex - previousIndex - 1;
      score += gap === 0 ? -2 : gap;
    }

    score += foundIndex * 0.05;
    previousIndex = foundIndex;
    searchFrom = foundIndex + 1;
  }

  return { matches: true, score };
}
