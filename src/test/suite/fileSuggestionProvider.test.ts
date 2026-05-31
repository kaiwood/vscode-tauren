import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getAtFileSuggestions } from '../../fileSuggestions/fileSuggestionProvider';

suite('@ file suggestion provider', () => {
  test('returns fuzzy file and directory suggestions', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-'));
    await fs.mkdir(path.join(cwd, 'src'));
    await fs.writeFile(path.join(cwd, 'src', 'alpha.ts'), '');
    await fs.writeFile(path.join(cwd, 'README.md'), '');

    const suggestions = await getAtFileSuggestions({ cwd, prefix: '@alp' });

    assert.ok(suggestions.some((item) => item.value === '@src/alpha.ts' && !item.directory));
  });

  test('quotes paths with spaces and keeps directories open', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-'));
    await fs.mkdir(path.join(cwd, 'two words'));
    await fs.writeFile(path.join(cwd, 'two words', 'file.txt'), '');

    const suggestions = await getAtFileSuggestions({ cwd, prefix: '@two' });
    const directory = suggestions.find((item) => item.directory && item.label === 'two words/');

    assert.ok(directory);
    assert.strictEqual(directory.value, '@"two words/"');
  });

  test('does not browse traversal paths outside cwd', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-parent-'));
    const cwd = path.join(parent, 'workspace');
    const outside = path.join(parent, 'outside');
    await fs.mkdir(cwd);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), '');

    const suggestions = await getAtFileSuggestions({ cwd, prefix: '@../outside/sec' });

    assert.deepStrictEqual(suggestions, []);
  });

  test('does not browse absolute paths outside cwd', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-parent-'));
    const cwd = path.join(parent, 'workspace');
    const outside = path.join(parent, 'outside');
    await fs.mkdir(cwd);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), '');

    const outsidePrefix = `@${toDisplayPath(outside)}/sec`;
    const suggestions = await getAtFileSuggestions({ cwd, prefix: outsidePrefix });

    assert.deepStrictEqual(suggestions, []);
  });

  test('allows absolute paths inside cwd', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-'));
    const src = path.join(cwd, 'src');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'alpha.ts'), '');

    const insidePrefix = `@${toDisplayPath(src)}/alp`;
    const suggestions = await getAtFileSuggestions({ cwd, prefix: insidePrefix });

    assert.ok(suggestions.some((item) => item.description === `${toDisplayPath(src)}/alpha.ts` && !item.directory));
  });

  test('does not browse home paths outside cwd', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tauren-file-suggestions-'));

    if (isPathInsidePath(os.homedir(), cwd)) {
      return;
    }

    const suggestions = await getAtFileSuggestions({ cwd, prefix: '@~/' });

    assert.deepStrictEqual(suggestions, []);
  });
});

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isPathInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
