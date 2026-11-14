import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AutocompleteProviderFactory } from '@earendil-works/pi-coding-agent';
import { PiAutocompleteRegistry } from '@tauren/shared/completion/piAutocompleteRegistry';
import { createSdkExtensionUiContext } from '../../sdk/extensionUiBridge';

suite('Pi autocomplete registry', () => {
  test('later providers wrap earlier providers and can delegate to the base provider', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-autocomplete-'));
    await fs.writeFile(path.join(cwd, 'closed-file.ts'), '');
    const registry = new PiAutocompleteRegistry();
    const calls: string[] = [];

    registry.add(((current) => ({
      ...current,
      async getSuggestions(lines, line, col, options) {
        calls.push('first');
        return current.getSuggestions(lines, line, col, options);
      }
    })) as AutocompleteProviderFactory);
    registry.add(((current) => ({
      ...current,
      async getSuggestions(lines, line, col, options) {
        calls.push('last');
        const delegated = await current.getSuggestions(lines, line, col, options);
        return delegated ? { ...delegated, items: [{ value: '@open-file.ts', label: 'open-file.ts' }, ...delegated.items] } : delegated;
      }
    })) as AutocompleteProviderFactory);

    const result = await registry.complete({ id: 'one', revision: 1, text: '@file', selectionStart: 5, selectionEnd: 5 }, cwd, new AbortController().signal);

    assert.deepStrictEqual(calls, ['last', 'first']);
    assert.strictEqual(result.items[0]?.value, '@open-file.ts');
    assert.ok(result.items.some((item) => item.value === '@closed-file.ts'));
  });

  test('publishes a deduplicated trigger-character union and handles dynamic token triggers', async () => {
    const registry = new PiAutocompleteRegistry();
    registry.add(((current) => ({
      ...current,
      triggerCharacters: ['%', '$', '%'],
      async getSuggestions(lines, line, col, options) {
        const before = (lines[line] ?? '').slice(0, col);
        return before.startsWith('%') ? { prefix: before, items: [{ value: '%value', label: 'percent' }] } : current.getSuggestions(lines, line, col, options);
      }
    })) as AutocompleteProviderFactory);

    assert.deepStrictEqual(registry.getCapabilities().triggerCharacters, ['@', '%', '$']);
    const result = await registry.complete({ id: 'percent', revision: 2, text: '%value', selectionStart: 6, selectionEnd: 6 }, undefined, new AbortController().signal);

    assert.strictEqual(result.items[0]?.value, '%value');
  });

  test('honors file-completion suppression without suppressing a custom trigger', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-autocomplete-'));
    await fs.writeFile(path.join(cwd, 'closed-file.ts'), '');
    const registry = new PiAutocompleteRegistry();
    registry.add(((current) => ({
      ...current,
      triggerCharacters: ['%'],
      async getSuggestions(lines, line, col, options) {
        const before = (lines[line] ?? '').slice(0, col);
        return before.startsWith('%') ? { prefix: before, items: [{ value: '%custom', label: 'custom' }] } : current.getSuggestions(lines, line, col, options);
      },
      shouldTriggerFileCompletion() {
        return false;
      }
    })) as AutocompleteProviderFactory);

    const fileResult = await registry.complete({ id: 'file', revision: 1, text: '@file', selectionStart: 5, selectionEnd: 5 }, cwd, new AbortController().signal);
    const customResult = await registry.complete({ id: 'custom', revision: 2, text: '%custom', selectionStart: 7, selectionEnd: 7 }, cwd, new AbortController().signal);

    assert.deepStrictEqual(fileResult.items, []);
    assert.strictEqual(customResult.items[0]?.value, '%custom');
  });

  test('falls back to the preceding provider after a provider fault', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-autocomplete-'));
    await fs.writeFile(path.join(cwd, 'closed-file.ts'), '');
    const registry = new PiAutocompleteRegistry();
    registry.add(((current) => ({
      ...current,
      async getSuggestions() {
        throw new Error('broken provider');
      },
      applyCompletion() {
        throw new Error('broken provider');
      }
    })) as AutocompleteProviderFactory);

    const result = await registry.complete({ id: 'one', revision: 1, text: '@file', selectionStart: 5, selectionEnd: 5 }, cwd, new AbortController().signal);
    const applied = registry.apply({ id: 'one', revision: 1, itemId: result.items[0]?.id ?? '' });

    assert.ok(result.items.some((item) => item.value === '@closed-file.ts'));
    assert.deepStrictEqual(applied, { id: 'one', revision: 1, text: '@closed-file.ts ', selectionStart: 16, selectionEnd: 16 });
  });

  test('registers a Pi-style open-file provider through the SDK UI bridge', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-autocomplete-'));
    await fs.writeFile(path.join(cwd, 'closed-file.ts'), '');
    const registry = new PiAutocompleteRegistry();
    const ui = createSdkExtensionUiContext(undefined, { autocompleteRegistry: registry });
    ui.addAutocompleteProvider(((current) => ({
      ...current,
      triggerCharacters: ['@'],
      async getSuggestions(lines, line, col, options) {
        const delegated = await current.getSuggestions(lines, line, col, options);
        if (!(lines[line] ?? '').slice(0, col).startsWith('@')) {
          return delegated;
        }
        const open = { value: '@open-file.ts', label: 'open-file.ts' };
        return delegated ? { ...delegated, items: [open, ...delegated.items.filter((item) => item.value !== open.value)] } : { prefix: '@', items: [open] };
      },
      applyCompletion(lines, line, col, item, prefix) {
        return current.applyCompletion(lines, line, col, item, prefix);
      },
      shouldTriggerFileCompletion(lines, line, col) {
        return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
      }
    })) as AutocompleteProviderFactory);

    const result = await registry.complete({ id: 'fixture', revision: 1, text: '@file', selectionStart: 5, selectionEnd: 5 }, cwd, new AbortController().signal);

    assert.strictEqual(result.items[0]?.value, '@open-file.ts');
    assert.ok(result.items.some((item) => item.value === '@closed-file.ts'));
    assert.strictEqual(result.items.filter((item) => item.value === '@open-file.ts').length, 1);
  });

  test('uses the provider application result and rejects stale handles', async () => {
    const registry = new PiAutocompleteRegistry();
    registry.add(((current) => ({
      ...current,
      async getSuggestions() {
        return { prefix: '#', items: [{ value: '#one', label: 'one' }] };
      },
      applyCompletion() {
        return { lines: ['first', 'second'], cursorLine: 1, cursorCol: 3 };
      }
    })) as AutocompleteProviderFactory);

    const result = await registry.complete({ id: 'one', revision: 1, text: '#', selectionStart: 1, selectionEnd: 1 }, undefined, new AbortController().signal);
    const applied = registry.apply({ id: 'one', revision: 1, itemId: result.items[0]?.id ?? '' });

    assert.deepStrictEqual(applied, { id: 'one', revision: 1, text: 'first\nsecond', selectionStart: 9, selectionEnd: 9 });
    assert.strictEqual(registry.apply({ id: 'one', revision: 1, itemId: result.items[0]?.id ?? '' }), undefined);
  });
});
