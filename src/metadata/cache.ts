import type {
  TauChatContextUsage,
  TauChatModelMeta,
  TauChatSessionMetaSnapshot,
  SessionMetadataCacheStorage
} from './types';

const cachedSessionMetaStorageKey = 'tauren.cachedSessionMeta';
const legacyCachedModelMetaStorageKey = 'tauren.cachedModelMeta';

export function readCachedSessionMeta(storage: SessionMetadataCacheStorage | undefined): TauChatSessionMetaSnapshot | undefined {
  const value = storage?.get<unknown>(cachedSessionMetaStorageKey);
  const snapshot = parseCachedSessionMeta(value);

  if (snapshot) {
    return snapshot;
  }

  const legacyModelMeta = parseCachedModelMeta(storage?.get<unknown>(legacyCachedModelMetaStorageKey));

  return legacyModelMeta ? { model: legacyModelMeta } : undefined;
}

export function writeCachedSessionMeta(
  storage: SessionMetadataCacheStorage | undefined,
  metadata: TauChatSessionMetaSnapshot
): void {
  if (!storage) {
    return;
  }

  const value = hasCachedSessionMeta(metadata) ? metadata : undefined;
  void storage.update(cachedSessionMetaStorageKey, value)?.then(undefined, () => undefined);
  void storage.update(legacyCachedModelMetaStorageKey, undefined)?.then(undefined, () => undefined);
}

function parseCachedSessionMeta(value: unknown): TauChatSessionMetaSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const model = parseCachedModelMeta(value.model);
  const modelOptions = parseCachedModelOptions(value.modelOptions);
  const contextUsage = parseCachedContextUsage(value.contextUsage);
  const snapshot: TauChatSessionMetaSnapshot = {};

  if (model) {
    snapshot.model = model;
  }

  if (modelOptions) {
    snapshot.modelOptions = modelOptions;
  }

  if (contextUsage) {
    snapshot.contextUsage = contextUsage;
  }

  return hasCachedSessionMeta(snapshot) ? snapshot : undefined;
}

function parseCachedModelMeta(value: unknown): TauChatModelMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = getRecordString(value, 'id');

  if (!id) {
    return undefined;
  }

  return {
    label: getRecordString(value, 'label') || id,
    provider: getRecordString(value, 'provider') ?? '',
    id,
    reasoning: value.reasoning === true,
    thinkingLevel: getRecordString(value, 'thinkingLevel') ?? ''
  };
}

function parseCachedModelOptions(value: unknown): TauChatSessionMetaSnapshot['modelOptions'] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const modelOptions = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const provider = getRecordString(item, 'provider');
    const id = getRecordString(item, 'id');

    if (!provider || !id) {
      return [];
    }

    return [{
      provider,
      id,
      name: getRecordString(item, 'name') || id,
      reasoning: item.reasoning === true
    }];
  });

  return modelOptions.length > 0 ? modelOptions : undefined;
}

function parseCachedContextUsage(value: unknown): TauChatContextUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const label = getRecordString(value, 'label');

  if (!label) {
    return undefined;
  }

  return {
    label,
    title: getRecordString(value, 'title') ?? '',
    level: getRecordString(value, 'level') ?? ''
  };
}

function hasCachedSessionMeta(snapshot: TauChatSessionMetaSnapshot): boolean {
  return Boolean(
    snapshot.model
    || (snapshot.modelOptions && snapshot.modelOptions.length > 0)
    || snapshot.contextUsage
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
