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

const fallbackLanguages = [
  'bash',
  'css',
  'diff',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'python',
  'shellscript',
  'text',
  'tsx',
  'typescript',
  'yaml'
];

type BridgeLanguagesResult = {
  langs: unknown[];
  get(languageId: string): unknown | undefined;
  resolveAlias(languageId: string): string;
  resolveExtension(extension: string): string;
};

type BridgeInternalsModule = {
  ExtensionFileReader: new (vscodeApi: typeof vscode) => unknown;
  LanguageRegistrationCollectionBuilder: new (registry: BridgeLanguageRegistry, fileReader: unknown) => {
    build(languageIds: string[]): Promise<unknown[]>;
  };
  LanguageRegistry: new (extensions: readonly vscode.Extension<unknown>[]) => BridgeLanguageRegistry;
  ThemeRegistry: new (extensions: readonly vscode.Extension<unknown>[]) => BridgeThemeRegistry;
  buildThemeRegistration(contribution: unknown, registry: BridgeThemeRegistry, fileReader: unknown, uri: typeof vscode.Uri): Promise<unknown>;
};

type BridgeLanguageRegistry = {
  getLanguageIds(): string[];
  resolveAliasToLanguageId(languageId: string): string;
};

type BridgeThemeRegistry = {
  themes: Map<string, unknown>;
  resolveLabelToId(themeName: string): string;
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
  private themeIdHint: string | undefined;
  private readonly cache = new Map<string, ShikiHighlightResult>();

  public async highlightCode(code: string, languageHint: string, themeIdHint?: string): Promise<ShikiHighlightResult | undefined> {
    if (!code || code.length > maxHighlightedCodeLength) {
      return undefined;
    }

    try {
      this.setThemeIdHint(themeIdHint);
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

      const html = this.renderWithState(state, code, language);
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

  private setThemeIdHint(themeIdHint: string | undefined): void {
    const normalized = normalizeThemeIdHint(themeIdHint);

    if (normalized === this.themeIdHint) {
      return;
    }

    this.themeIdHint = normalized;
    this.reset();
  }

  private async getState(): Promise<RendererState> {
    if (!this.statePromise) {
      this.statePromise = this.createState();
    }

    return this.statePromise;
  }

  private async createState(): Promise<RendererState> {
    const shiki = await importEsm<ShikiModule>('shiki');

    try {
      const bridgeInternals = await importEsm<BridgeInternalsModule>('vscode-shiki-bridge/internals');
      const [{ themeId, themes }, languages] = await Promise.all([
        getCurrentTheme(bridgeInternals, this.themeIdHint),
        getLanguages(bridgeInternals)
      ]);
      const highlighter = await shiki.createHighlighter({
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
    } catch (error) {
      console.warn('Tau failed to initialize Shiki with the active VS Code theme. Falling back to the bundled Shiki theme.', error);
      this.state = await createFallbackState(shiki);
      return this.state;
    }
  }

  private renderWithState(state: RendererState, code: string, language: string): string {
    try {
      return normalizeInlineShikiLineBreaks(state.highlighter.codeToHtml(code, {
        lang: language,
        theme: state.themeId,
        structure: 'inline',
        mergeSameStyleTokens: true
      }));
    } catch (error) {
      console.warn(`Tau failed to highlight ${language} with Shiki.`, error);
      throw error;
    }
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

function normalizeInlineShikiLineBreaks(html: string): string {
  return html.replace(/<br\s*\/?>/g, '\n');
}

async function createFallbackState(shiki: ShikiModule): Promise<RendererState> {
  const themeId = isLightTheme() ? 'light-plus' : 'dark-plus';
  const highlighter = await shiki.createHighlighter({
    themes: [themeId],
    langs: fallbackLanguages,
    warnings: false
  });

  return {
    highlighter,
    themeId,
    languages: createFallbackLanguages()
  };
}

function createFallbackLanguages(): BridgeLanguagesResult {
  return {
    langs: fallbackLanguages,
    get(languageId) {
      return fallbackLanguages.includes(toFallbackLanguageId(languageId)) ? { name: toFallbackLanguageId(languageId) } : undefined;
    },
    resolveAlias(languageId) {
      return toFallbackLanguageId(languageId);
    },
    resolveExtension(extension) {
      return toFallbackLanguageId(extension.replace(/^\./, ''));
    }
  };
}

function toFallbackLanguageId(languageId: string): string {
  const normalized = normalizeLanguageHint(languageId);
  const fallbackAliases: Record<string, string> = {
    javascriptreact: 'jsx',
    jsx: 'jsx',
    typescriptreact: 'tsx',
    tsx: 'tsx',
    shell: 'shellscript',
    sh: 'shellscript',
    yml: 'yaml'
  };

  return fallbackAliases[normalized] ?? languageAliases[normalized] ?? normalized;
}

function isLightTheme(): boolean {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
    || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;
}

async function getCurrentTheme(bridge: BridgeInternalsModule, themeIdHint: string | undefined): Promise<{ themeId: string; themes: unknown[] }> {
  const registry = new bridge.ThemeRegistry(vscode.extensions.all);
  const fileReader = new bridge.ExtensionFileReader(vscode);
  const configuredThemeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '');
  const themeNames = [themeIdHint, configuredThemeName].filter((value): value is string => Boolean(value));

  for (const themeName of themeNames) {
    const themeId = registry.themes.has(themeName) ? themeName : registry.resolveLabelToId(themeName);
    const contribution = registry.themes.get(themeId);

    if (contribution) {
      const theme = await bridge.buildThemeRegistration(contribution, registry, fileReader, vscode.Uri);
      return { themeId, themes: [theme] };
    }
  }

  throw new Error(`No VS Code theme contribution found for ${themeIdHint || configuredThemeName || 'the active theme'}.`);
}

async function getLanguages(bridge: BridgeInternalsModule): Promise<BridgeLanguagesResult> {
  const registry = new bridge.LanguageRegistry(vscode.extensions.all);
  const fileReader = new bridge.ExtensionFileReader(vscode);
  const registeredLanguageIds = registry.getLanguageIds();
  const builder = new bridge.LanguageRegistrationCollectionBuilder(registry, fileReader);
  const langs = await builder.build(registeredLanguageIds);

  return {
    langs,
    get(languageId) {
      for (const language of langs) {
        if (!isLanguageRecord(language)) {
          continue;
        }

        if (language.name === languageId || language.aliases?.includes(languageId)) {
          return language;
        }
      }

      return undefined;
    },
    resolveAlias(languageId) {
      return registry.resolveAliasToLanguageId(languageId);
    },
    resolveExtension(extension) {
      for (const language of langs) {
        if (isLanguageRecord(language) && language.extensions?.includes(extension)) {
          return language.name;
        }
      }

      return '';
    }
  };
}

type LanguageRecord = {
  name: string;
  aliases?: string[];
  extensions?: string[];
};

function isLanguageRecord(value: unknown): value is LanguageRecord {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { name?: unknown }).name === 'string';
}

function normalizeThemeIdHint(themeIdHint: string | undefined): string | undefined {
  const normalized = themeIdHint?.trim();
  return normalized || undefined;
}

function normalizeLanguageHint(languageHint: string): string {
  return languageHint
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^\./, '');
}
