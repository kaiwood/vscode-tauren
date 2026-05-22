import type { ExtensionUi } from '../extensionUi/types';
import type { PiClientFactory, PiClient } from '../pi/clientTypes';
import type { PiClientOptions } from '../pi/types';
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

export async function forkSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const select = options.extensionUi?.select;

  if (!select) {
    options.showNotification('Fork selection is not available in this environment.', 'warning');
    return;
  }

  const forkMessages = formatForkMessages((await client.getForkMessages()).messages);

  if (forkMessages.length === 0) {
    options.showNotification('No messages to fork from.', 'warning');
    return;
  }

  const labels = forkMessages.map((message, index) => formatForkMessageLabel(message, index));
  const picked = await select('Fork from message', labels);

  if (!picked) {
    return;
  }

  const selected = forkMessages[labels.indexOf(picked)];

  if (!selected) {
    return;
  }

  const result = await client.fork(selected.entryId);

  if (!result.cancelled) {
    options.showToast?.('Forked session.');
  }
}

export async function cloneSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await client.clone();

  if (!result.cancelled) {
    options.showToast?.('Cloned session.');
  }
}

export async function compactSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await client.compact(undefined);
  options.showToast?.(`${formatCompactionTitle(result.tokensBefore)}.`);
}

export async function exportSessionWithClient(client: PiClient, options: SessionClientActionUi): Promise<void> {
  const result = await client.exportHtml(undefined);
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
