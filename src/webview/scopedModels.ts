import type { ModelOption, WebviewState } from './types';

export type ScopedModelSelection = {
  allEnabled: boolean;
  enabledIds: string[];
  orderedModels: ModelOption[];
};

export function getScopedModelSelection(state: WebviewState): ScopedModelSelection {
  const allIds = state.modelOptions.map(getModelFullId);
  const patterns = getScopedModelPatterns(state);
  const enabledIds = patterns === undefined
    ? allIds
    : resolveScopedModelIds(patterns, state.modelOptions);
  const allEnabled = enabledIds.length === allIds.length;
  const enabledSet = new Set(enabledIds);
  const orderedIds = allEnabled ? allIds : [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
  const modelsById = new Map(state.modelOptions.map((model) => [getModelFullId(model), model]));

  return {
    allEnabled,
    enabledIds,
    orderedModels: orderedIds.flatMap((id) => {
      const model = modelsById.get(id);
      return model ? [model] : [];
    })
  };
}

export function getScopedModelPickerOptions(state: WebviewState): ModelOption[] {
  const patterns = getScopedModelPatterns(state);
  if (patterns === undefined) {
    return state.modelOptions;
  }

  const enabledIds = resolveScopedModelIds(patterns, state.modelOptions);
  const modelsById = new Map(state.modelOptions.map((model) => [getModelFullId(model), model]));
  return enabledIds.flatMap((id) => {
    const model = modelsById.get(id);
    return model ? [model] : [];
  });
}

export function normalizeScopedModelSelection(enabledIds: string[], modelOptions: readonly ModelOption[]): string[] {
  const allIds = modelOptions.map(getModelFullId);
  return allIds.filter((id) => enabledIds.includes(id));
}

export function getModelFullId(model: ModelOption): string {
  return `${model.provider}/${model.id}`;
}

function getScopedModelPatterns(state: WebviewState): string[] | undefined {
  const value = state.settings.values.enabledModels;
  return Array.isArray(value) ? value : undefined;
}

function resolveScopedModelIds(patterns: readonly string[], modelOptions: readonly ModelOption[]): string[] {
  const ids: string[] = [];

  for (const pattern of patterns) {
    const matcher = createModelPatternMatcher(pattern);
    for (const model of modelOptions) {
      const fullId = getModelFullId(model);
      if (!ids.includes(fullId) && matcher(model, fullId)) {
        ids.push(fullId);
      }
    }
  }

  return ids;
}

function createModelPatternMatcher(pattern: string): (model: ModelOption, fullId: string) => boolean {
  const normalized = pattern.trim().toLowerCase();
  const hasGlob = /[*?[\]]/.test(normalized);
  if (!hasGlob) {
    return (model, fullId) => fullId.toLowerCase() === normalized || model.id.toLowerCase() === normalized;
  }

  const globRegex = new RegExp(`^${escapeRegex(normalized).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`, 'i');
  return (model, fullId) => globRegex.test(fullId) || globRegex.test(model.id);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
