import * as vscode from 'vscode';

const maxHighlightedCodeLength = 200_000;
const maxCachedHighlights = 200;

export type ShikiHighlightResult = {
  html: string;
  language: string;
};

type DynamicImporter = <T>(specifier: string) => Promise<T>;

type ShikiHighlighter = {
  codeToHtml(code: string, options: {
    lang: string;
    theme: string;
    structure: 'inline';
    mergeSameStyleTokens: boolean;
  }): string;
  dispose?: () => void;
};

type ShikiModule = {
  createHighlighter(options: {
    themes: unknown[];
    langs: unknown[];
    warnings?: boolean;
  }): Promise<ShikiHighlighter>;
};

type BridgeLanguagesResult = {
  langs: unknown[];
  get(languageId: string): unknown | undefined;
  resolveAlias(languageId: string): string;
  resolveExtension(extension: string): string;
};

type BridgeModule = {
  getUserTheme(): Promise<[id: string, themes: unknown[]]>;
  getLanguages(languageIds?: string[]): Promise<BridgeLanguagesResult>;
};

type RendererState = {
  highlighter: ShikiHighlighter;
  themeId: string;
  languages: BridgeLanguagesResult;
};

const importEsm: DynamicImporter = <T>(specifier: string) => {
  const importer = new Function('specifier', 'return import(specifier);') as DynamicImporter;
  return importer<T>(specifier);
};

const languageAliases: Record<string, string> = {
  cjs: 'javascript',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  shell: 'shellscript',
  sh: 'shellscript',
  ts: 'typescript',
  tsx: 'typescriptreact',
  yml: 'yaml'
};

export class ShikiCodeRenderer implements vscode.Disposable {
  private statePromise: Promise<RendererState> | undefined;
  private state: RendererState | undefined;
  private readonly cache = new Map<string, ShikiHighlightResult>();

  public async highlightCode(code: string, languageHint: string): Promise<ShikiHighlightResult | undefined> {
    if (!code || code.length > maxHighlightedCodeLength) {
      return undefined;
    }

    try {
      const state = await this.getState();
      const language = this.resolveLanguage(languageHint, state.languages);

      if (!language) {
        return undefined;
      }

      const cacheKey = `${state.themeId}\0${language}\0${code}`;
      const cached = this.cache.get(cacheKey);

      if (cached) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        return cached;
      }

      const html = state.highlighter.codeToHtml(code, {
        lang: language,
        theme: state.themeId,
        structure: 'inline',
        mergeSameStyleTokens: true
      });
      const result = { html, language };
      this.remember(cacheKey, result);
      return result;
    } catch (error) {
      this.statePromise = undefined;
      console.warn(`Tau failed to highlight ${languageHint || 'code'} with Shiki.`, error);
      return undefined;
    }
  }

  public reset(): void {
    this.cache.clear();
    this.statePromise = undefined;

    if (this.state?.highlighter.dispose) {
      this.state.highlighter.dispose();
    }

    this.state = undefined;
  }

  public dispose(): void {
    this.reset();
  }

  private async getState(): Promise<RendererState> {
    if (!this.statePromise) {
      this.statePromise = this.createState();
    }

    return this.statePromise;
  }

  private async createState(): Promise<RendererState> {
    const [{ createHighlighter }, { getLanguages, getUserTheme }] = await Promise.all([
      importEsm<ShikiModule>('shiki'),
      importEsm<BridgeModule>('vscode-shiki-bridge')
    ]);
    const [[themeId, themes], languages] = await Promise.all([
      getUserTheme(),
      getLanguages()
    ]);
    const highlighter = await createHighlighter({
      themes,
      langs: languages.langs,
      warnings: false
    });

    this.state = {
      highlighter,
      themeId,
      languages
    };
    return this.state;
  }

  private resolveLanguage(languageHint: string, languages: BridgeLanguagesResult): string | undefined {
    const normalized = normalizeLanguageHint(languageHint);

    if (!normalized) {
      return undefined;
    }

    const aliased = languageAliases[normalized] ?? normalized;
    const direct = languages.get(aliased) ? aliased : undefined;

    if (direct) {
      return direct;
    }

    const resolvedAlias = languages.resolveAlias(aliased);

    if (resolvedAlias && languages.get(resolvedAlias)) {
      return resolvedAlias;
    }

    const extension = aliased.startsWith('.') ? aliased : `.${aliased}`;
    const resolvedExtension = languages.resolveExtension(extension);

    if (resolvedExtension && languages.get(resolvedExtension)) {
      return resolvedExtension;
    }

    return undefined;
  }

  private remember(cacheKey: string, result: ShikiHighlightResult): void {
    this.cache.set(cacheKey, result);

    if (this.cache.size <= maxCachedHighlights) {
      return;
    }

    const oldestKey = this.cache.keys().next().value;

    if (typeof oldestKey === 'string') {
      this.cache.delete(oldestKey);
    }
  }
}

function normalizeLanguageHint(languageHint: string): string {
  return languageHint
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^\./, '');
}
