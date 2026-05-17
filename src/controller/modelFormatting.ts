import type { WebviewModelOption } from '../webviewProtocol/types';

export function filterModelOptions(modelOptions: WebviewModelOption[], query: string): WebviewModelOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return modelOptions;
  }

  return modelOptions.filter((model) => {
    const providerAndId = `${model.provider}/${model.id}`.toLowerCase();
    const id = model.id.toLowerCase();
    const name = model.name.toLowerCase();
    return providerAndId === normalizedQuery
      || id === normalizedQuery
      || name === normalizedQuery
      || providerAndId.includes(normalizedQuery)
      || id.includes(normalizedQuery)
      || name.includes(normalizedQuery);
  });
}

export function formatModelOptionLabel(model: WebviewModelOption): string {
  return model.name && model.name !== model.id
    ? `${model.name} (${model.provider}/${model.id})`
    : `${model.provider}/${model.id}`;
}
