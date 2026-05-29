import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const changelogTitlePattern = /^#\s+Changelog\s*\n+/i;

export async function readCombinedChangelog(): Promise<string> {
  const extensionRoot = path.resolve(__dirname, '..', '..');
  const [piChangelog, taurenChangelog] = await Promise.all([
    readChangelog('Pi', [path.join(extensionRoot, 'resources', 'pi-sdk-runtime', 'CHANGELOG.md')]),
    readChangelog('Tauren', [
      path.join(extensionRoot, 'CHANGELOG.md'),
      path.join(extensionRoot, 'changelog.md')
    ])
  ]);

  return [
    '# Pi Changelog',
    normalizeChangelog(piChangelog),
    '---',
    '# Tauren Changelog',
    stripUnreleasedSection(normalizeChangelog(taurenChangelog))
  ].join('\n\n');
}

async function readChangelog(label: string, candidatePaths: string[]): Promise<string> {
  for (const candidatePath of candidatePaths) {
    try {
      return await fs.readFile(candidatePath, 'utf-8');
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  throw new Error(`${label} changelog is not available.`);
}

function normalizeChangelog(changelog: string): string {
  return changelog.trim().replace(changelogTitlePattern, '').trim();
}

function stripUnreleasedSection(changelog: string): string {
  const unreleasedMatch = /^##\s+Unreleased\s*$/im.exec(changelog);

  if (!unreleasedMatch) {
    return changelog;
  }

  const sectionStart = unreleasedMatch.index;
  const afterHeader = sectionStart + unreleasedMatch[0].length;
  const nextSectionMatch = /^##\s+/m.exec(changelog.slice(afterHeader));

  if (!nextSectionMatch) {
    return changelog.slice(0, sectionStart).trim();
  }

  return `${changelog.slice(0, sectionStart)}${changelog.slice(afterHeader + nextSectionMatch.index)}`.trim();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
