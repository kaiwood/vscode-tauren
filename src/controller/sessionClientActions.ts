import {
  createCancellingExtensionUi,
  ExtensionUiRequestHandler,
  type ExtensionUiRequestUi
} from '../extensionUi/requestHandler';
import type { PiRpcClientFactory, PiRpcClientLike } from '../rpc/clientTypes';
import type { PiRpcClientOptions } from '../rpc/types';
import { formatForkMessageLabel, formatForkMessages } from './sessionFormatting';

export type SessionClientActionUi = {
  extensionUi?: ExtensionUiRequestUi;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string) => void;
};

export type BackgroundSessionClientOptions = SessionClientActionUi & {
  createClient: PiRpcClientFactory;
  getCwd?: () => string | undefined;
  getPiPath?: () => string | undefined;
  onError: (message: string) => void;
};

export async function forkSessionWithClient(client: PiRpcClientLike, options: SessionClientActionUi): Promise<void> {
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

export async function cloneSessionWithClient(client: PiRpcClientLike, options: SessionClientActionUi): Promise<void> {
  const result = await client.clone();

  if (!result.cancelled) {
    options.showToast?.('Cloned session.');
  }
}

export async function compactSessionWithClient(client: PiRpcClientLike, options: SessionClientActionUi): Promise<void> {
  await client.compact(undefined);
  options.showToast?.('Compacted session.');
}

export async function exportSessionWithClient(client: PiRpcClientLike, options: SessionClientActionUi): Promise<void> {
  const result = await client.exportHtml(undefined);
  const path = typeof result.path === 'string' && result.path ? result.path : 'HTML file';
  options.showToast?.(`Exported session to ${path}.`);
}

export async function withSessionClient<T>(
  sessionPath: string,
  options: BackgroundSessionClientOptions,
  action: (client: PiRpcClientLike) => Promise<T>
): Promise<T> {
  const clientOptions: PiRpcClientOptions = { cwd: options.getCwd?.(), sessionFile: sessionPath };
  const piPath = options.getPiPath?.();

  if (piPath) {
    clientOptions.piPath = piPath;
  }

  const client = options.createClient(clientOptions);
  const extensionUiRequestHandler = new ExtensionUiRequestHandler({
    ui: options.extensionUi ?? createCancellingExtensionUi(options.showNotification),
    respond: (response) => client.respondExtensionUiRequest(response),
    onError: options.onError
  });
  const disposables = [
    { dispose: client.onEvent((event) => {
      if (event.type === 'extension_ui_request') {
        void extensionUiRequestHandler.handle(event);
      }
    }) },
    { dispose: client.onError(options.onError) }
  ];

  try {
    return await action(client);
  } finally {
    extensionUiRequestHandler.dispose();
    for (const disposable of disposables) {
      disposable.dispose();
    }
    client.dispose();
  }
}
