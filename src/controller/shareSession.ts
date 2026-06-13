import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentClient } from '../agent/clientTypes';
import { exportSessionHtml } from '../sessions/sessionClientActions';
import { getUseTaurenShareViewerSetting } from '../settings/taurenSettings';

export type SharedSessionLinks = {
  shareUrl: string;
  gistUrl: string;
};

const PI_SHARE_VIEWER_URL = 'https://pi.dev/session/';
const TAUREN_SHARE_VIEWER_URL = 'https://kaiwood.github.io/vscode-tauren/share/';

export async function shareSessionWithGh(client: AgentClient): Promise<SharedSessionLinks> {
  assertGhConfigured();

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tauren-share-'));
  const tmpFile = path.join(tmpDir, 'session.html');

  try {
    await exportSessionHtml(client, tmpFile);
    const gist = await createSecretGist(tmpFile);

    return {
      shareUrl: getShareViewerUrl(gist.gistId, { useTaurenShareViewer: getUseTaurenShareViewerSetting() }),
      gistUrl: gist.gistUrl
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export function formatShareTranscriptMessage(links: SharedSessionLinks): string {
  return [
    'Shared session.',
    '',
    `Share URL: [${links.shareUrl}](${escapeMarkdownLinkDestination(links.shareUrl)})`,
    '',
    `Gist: [${links.gistUrl}](${escapeMarkdownLinkDestination(links.gistUrl)})`
  ].join('\n');
}

export function getShareViewerUrl(gistId: string, options: { useTaurenShareViewer?: boolean } = {}): string {
  const baseUrl = process.env.PI_SHARE_VIEWER_URL
    || (options.useTaurenShareViewer === false ? PI_SHARE_VIEWER_URL : TAUREN_SHARE_VIEWER_URL);
  return `${baseUrl}#${gistId}`;
}

export function parseGistCreateOutput(output: string): { gistUrl: string; gistId: string } | undefined {
  const gistUrl = output.match(/https:\/\/gist\.github\.com\/[^\s]+/i)?.[0];

  if (!gistUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(gistUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const gistId = segments.at(-1)?.replace(/\.git$/i, '');

    if (!gistId) {
      return undefined;
    }

    return {
      gistUrl,
      gistId
    };
  } catch {
    return undefined;
  }
}

function assertGhConfigured(): void {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new Error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    throw new Error(`Failed to run GitHub CLI (gh): ${error.message}`);
  }

  if (result.status !== 0) {
    throw new Error('GitHub CLI is not configured. Run `gh auth login` first.');
  }
}

async function createSecretGist(filePath: string): Promise<{ gistUrl: string; gistId: string }> {
  const result = await runCommand('gh', ['gist', 'create', '--public=false', filePath]);

  if (result.code !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || 'Unknown error';
    throw new Error(`Failed to create gist: ${details}`);
  }

  const parsed = parseGistCreateOutput(result.stdout);

  if (!parsed) {
    throw new Error('Failed to parse gist ID from GitHub CLI output.');
  }

  return parsed;
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function escapeMarkdownLinkDestination(value: string): string {
  return value.replace(/[()\\]/g, '\\$&');
}
