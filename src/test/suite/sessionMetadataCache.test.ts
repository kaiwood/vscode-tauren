import * as assert from 'assert';
import { readCachedSessionMeta, writeCachedSessionMeta } from '../../metadata/cache';
import type { SessionMetadataCacheStorage } from '../../metadata/types';

suite('Session metadata cache', () => {
  test('reads legacy cached model metadata', () => {
    const storage = new FakeMetadataCacheStorage({
      'tauren.cachedModelMeta': {
        label: 'cached High',
        provider: 'anthropic',
        id: 'cached',
        reasoning: true,
        thinkingLevel: 'high'
      }
    });

    assert.deepStrictEqual(readCachedSessionMeta(storage), {
      model: {
        label: 'cached High',
        provider: 'anthropic',
        id: 'cached',
        reasoning: true,
        thinkingLevel: 'high'
      }
    });
  });

  test('writes session metadata and clears legacy cache', () => {
    const storage = new FakeMetadataCacheStorage({ 'tauren.cachedModelMeta': { id: 'legacy' } });

    writeCachedSessionMeta(storage, {
      model: {
        label: 'live Medium',
        provider: 'openai',
        id: 'live',
        reasoning: true,
        thinkingLevel: 'medium'
      }
    });

    assert.deepStrictEqual(storage.get<unknown>('tauren.cachedSessionMeta'), {
      model: {
        label: 'live Medium',
        provider: 'openai',
        id: 'live',
        reasoning: true,
        thinkingLevel: 'medium'
      }
    });
    assert.strictEqual(storage.get<unknown>('tauren.cachedModelMeta'), undefined);
  });
});

class FakeMetadataCacheStorage implements SessionMetadataCacheStorage {
  private readonly data = new Map<string, unknown>();

  public constructor(initialData: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initialData)) {
      this.data.set(key, value);
    }
  }

  public get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  public update(key: string, value: unknown): PromiseLike<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }

    return Promise.resolve();
  }
}
