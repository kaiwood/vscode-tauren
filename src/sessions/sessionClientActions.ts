import type { ExtensionUi } from '../extensionUi/types';
import type { PiClientFactory, PiClient } from '../pi/clientTypes';
import { applyTaurenExportSkinToFile } from '../export/taurenExportSkin';
import type { PiClientOptions, PiCloneResult, PiCompactResult, PiExportHtmlResult } from '../pi/types';
import { getUseTaurenShareViewerSetting } from '../settings/taurenSettings';
import { formatCompactionTitle, formatForkMessageLabel, formatForkMessages } from './sessionFormatting';

export type SessionClientActionUi = {
  extensionUi?: ExtensionUi;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
};

export type BackgroundSessionClientOptions = {
  createClient: PiClientFactory;
  getCwd?: () => string | undefined;
  onError: (message: string) => void;
};

export type ForkSessionResult =
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'cancelled' }
  | { status: 'forked'; text: string };

export async function forkSession(client: PiClient, options: { select?: ExtensionUi['select'] }): Promise<ForkSessionResult> {
  const select = options.select;

  if (!select) {
    return { status: 'unavailable' };
  }

  const forkMessages = formatForkMessages((await client.getForkMessages()).messages);

  if (forkMessages.length === 0) {
    return { status: 'empty' };
  }

  const labels = forkMessages.map((message, index) => formatForkMessageLabel(message, index));
  const picked = await select('Fork from message', labels);

  if (!picked) {
    return { status: 'cancelled' };
  }

  const selected = forkMessages[labels.indexOf(picked)];

  if (!selected) {
    return { status: 'cancelled' };
  }

  const result = await client.fork(selected.entryId);

  if (result.cancelled) {
    return { status: 'cancelled' };
  }

  return {
    status: 'forked',
    text: typeof result.text === 'string' ? result.text.trim() : selected.text
  };
}

export async function cloneSession(client: PiClient): Promise<PiCloneResult> {
  return await client.clone();
}

export async function compactSession(client: PiClient, customInstructions?: string): Promise<PiCompactResult> {
  return await client.compact(customInstructions);
}

export async function exportSessionHtml(
  client: PiClient,
  outputPath?: string,
  options: { useTaurenExportSkin?: boolean } = {}
): Promise<PiExportHtmlResult> {
  const result = await client.exportHtml(outputPath);
  const shouldApplyTaurenSkin = options.useTaurenExportSkin ?? getUseTaurenShareViewerSetting();

  if (shouldApplyTaurenSkin && typeof result.path === 'string' && result.path) {
    await applyTaurenExportSkinToFile(result.path);
  }

  return result;
}

export async function forkSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await forkSession(client, { select: options.extensionUi?.select });

  if (result.status === 'unavailable') {
    options.showNotification('Fork selection is not available in this environment.', 'warning');
    return;
  }

  if (result.status === 'empty') {
    options.showNotification('No messages to fork from.', 'warning');
    return;
  }

  if (result.status === 'forked') {
    options.showToast?.('Forked session.');
  }
}

export async function cloneSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await cloneSession(client);

  if (!result.cancelled) {
    options.showToast?.('Cloned session.');
  }
}

export async function compactSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await compactSession(client);
  options.showToast?.(`${formatCompactionTitle(result.tokensBefore)}.`);
}

export async function exportSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await exportSessionHtml(client);
  const path = typeof result.path === 'string' && result.path ? result.path : 'HTML file';
  options.showToast?.(`Exported session to ${path}.`);
}

export async function withSessionClient<T>(
  sessionPath: string,
  options: BackgroundSessionClientOptions,
  action: (client: PiClient) => Promise<T>
): Promise<T> {
  const clientOptions: PiClientOptions = { cwd: options.getCwd?.(), sessionFile: sessionPath };
  const client = options.createClient(clientOptions);
  const disposables = [
    { dispose: client.onError(options.onError) }
  ];

  try {
    return await action(client);
  } finally {
    for (const disposable of disposables) {
      disposable.dispose();
    }
    client.dispose();
  }
}
