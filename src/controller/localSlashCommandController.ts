import type { ChatSession } from '../chat/chatSession';
import type { ExtensionUiRequestUi } from '../extensionUi/requestHandler';
import type { PiRpcClientLike } from '../rpc/clientTypes';
import type { PiSessionState, PiSessionStats } from '../rpc/types';
import { SessionMetadataState } from '../metadata/sessionMetadata';
import { isSupportedBuiltinSlashCommand } from '../commands/slashCommands';
import { getErrorMessage, isUnsupportedReloadCommandError } from './errors';
import { filterModelOptions, formatModelOptionLabel } from './modelFormatting';
import type { SessionViewController } from '../sessions/sessionViewController';
import {
  formatForkMessageLabel,
  formatForkMessages,
  formatSessionInfo,
  getSessionFile
} from '../sessions/sessionFormatting';

export type LocalSlashCommand = { name: string; args: string };

export type LocalSlashCommandControllerOptions = {
  session: ChatSession;
  sessionMetadata: SessionMetadataState;
  sessionView: SessionViewController;
  extensionUi?: ExtensionUiRequestUi;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
  writeClipboard?: (text: string) => PromiseLike<void> | Promise<void> | void;
  getClient: () => PiRpcClientLike;
  postState: () => void;
  refreshSessionMeta: (options?: { startClient?: boolean; force?: boolean }) => Promise<void>;
  refreshSlashCommands: (options?: { startClient?: boolean; force?: boolean }) => Promise<void>;
  adoptReplacedSession: (options?: { fallbackSessionFile?: string; refreshSessions?: boolean }) => Promise<void>;
  setComposerText: (text: string) => void;
  restartClientForReload: (sessionFile: string | undefined) => void;
  startNewSession: () => void;
};

export class LocalSlashCommandController {
  private compacting = false;
  private sessionNameRenameSequence = 0;

  public constructor(private readonly options: LocalSlashCommandControllerOptions) {}

  public get isCompacting(): boolean {
    return this.compacting;
  }

  public clearCompacting(): void {
    this.compacting = false;
  }

  public async handle(command: LocalSlashCommand): Promise<void> {
    if (command.name === 'tree' && !this.options.sessionView.canNavigateTree()) {
      this.options.session.addSystemMessage('/tree currently requires Tau SDK mode. Enable tau.useSdkInsteadOfRpc to navigate the live session tree.');
      this.options.postState();
      return;
    }

    if (!isSupportedBuiltinSlashCommand(command.name)) {
      this.options.session.addSystemMessage(`/${command.name} is a Pi terminal command that is not supported in the VS Code sidebar yet.`);
      this.options.postState();
      return;
    }

    try {
      switch (command.name) {
        case 'new':
          this.options.startNewSession();
          return;
        case 'model':
          await this.handleModelSlashCommand(command.args);
          return;
        case 'name':
          await this.setCurrentSessionName(command.args, { announce: true });
          return;
        case 'session':
          await this.handleSessionSlashCommand();
          return;
        case 'tree':
          this.options.sessionView.showTree();
          return;
        case 'resume':
          this.options.sessionView.showSessions();
          return;
        case 'fork':
          await this.handleForkSlashCommand();
          return;
        case 'clone':
          await this.handleCloneSlashCommand();
          return;
        case 'copy':
          await this.handleCopySlashCommand();
          return;
        case 'compact':
          await this.handleCompactSlashCommand(command.args);
          return;
        case 'reload':
          await this.handleReloadSlashCommand();
          return;
        case 'export':
          await this.handleExportSlashCommand(command.args);
          return;
        default:
          return;
      }
    } catch (error) {
      this.options.session.addErrorMessage(getErrorMessage(error));
      this.options.postState();
    }
  }

  public async setSessionNameFromWebview(name: string): Promise<void> {
    if (this.options.session.isBusy) {
      this.options.showNotification('Wait for Pi to finish before renaming the session.', 'warning');
      return;
    }

    try {
      await this.setCurrentSessionName(name, { announce: false });
    } catch (error) {
      this.options.session.addErrorMessage(getErrorMessage(error));
      this.options.postState();
    }
  }

  public async setCurrentSessionName(name: string, options: { announce: boolean }): Promise<void> {
    const trimmedName = name.trim();
    const previousName = this.options.sessionView.currentSessionName;
    const renameSequence = ++this.sessionNameRenameSequence;

    this.options.sessionView.applyCurrentSessionName(trimmedName);
    this.options.postState();

    try {
      await this.options.getClient().setSessionName(trimmedName);
    } catch (error) {
      if (renameSequence === this.sessionNameRenameSequence) {
        this.options.sessionView.applyCurrentSessionName(previousName);
        this.options.postState();
      }

      throw error;
    }

    if (renameSequence !== this.sessionNameRenameSequence) {
      return;
    }

    if (options.announce) {
      this.options.session.addSystemMessage(trimmedName ? `Session name set to "${trimmedName}".` : 'Session name cleared.');
    }

    this.options.postState();
    void this.options.refreshSessionMeta({ startClient: true, force: true });

    if (this.options.sessionView.currentSessionFile || this.options.sessionView.sessionCount > 0) {
      void this.options.sessionView.refreshSessions();
    }
  }

  public async setModel(provider: string, modelId: string): Promise<void> {
    if (this.options.session.isBusy) {
      return;
    }

    try {
      await this.options.getClient().setModel(provider, modelId);
      await this.options.refreshSessionMeta({ startClient: true, force: true });
    } catch (error) {
      this.options.session.addErrorMessage(getErrorMessage(error));
      this.options.postState();
    }
  }

  public async setThinkingLevel(level: string): Promise<void> {
    if (this.options.session.isBusy) {
      return;
    }

    try {
      await this.options.getClient().setThinkingLevel(level);
      await this.options.refreshSessionMeta({ startClient: true, force: true });
    } catch (error) {
      this.options.session.addErrorMessage(getErrorMessage(error));
      this.options.postState();
    }
  }

  public async copyTextFromWebview(text: string, successMessage = 'Copied Pi response.'): Promise<void> {
    await this.copyTextToClipboard(text, successMessage, { successToast: true });
  }

  public async handleCompactSlashCommand(customInstructions: string): Promise<void> {
    this.compacting = true;
    this.options.session.setBusy(true);
    this.options.session.upsertActivity('compaction', {
      kind: 'compaction',
      title: 'Compacting context…',
      status: 'running'
    });
    this.options.postState();

    try {
      const result = await this.options.getClient().compact(customInstructions || undefined);
      const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
      this.options.session.upsertActivity('compaction', {
        kind: 'compaction',
        title: 'Compacting context…',
        status: 'completed',
        summary: 'Completed',
        ...(summary ? { body: summary } : {})
      });
      this.options.session.handleAgentEnd();
      this.compacting = false;
      this.options.postState();
      void this.options.refreshSessionMeta({ startClient: true, force: true });
    } catch (error) {
      this.options.session.upsertActivity('compaction', {
        kind: 'compaction',
        title: 'Compacting context…',
        status: 'error',
        summary: getErrorMessage(error)
      });
      this.options.session.handleAgentEnd();
      this.compacting = false;
      this.options.postState();
    }
  }

  private async handleModelSlashCommand(query: string): Promise<void> {
    if (this.options.session.isBusy) {
      return;
    }

    if (this.options.sessionMetadata.getModelOptions().length === 0) {
      await this.options.refreshSessionMeta({ startClient: true, force: true });
    }

    const matches = filterModelOptions(this.options.sessionMetadata.getModelOptions(), query);

    if (matches.length === 0) {
      this.options.session.addSystemMessage(query ? `No model matched "${query}".` : 'No models are available yet.');
      this.options.postState();
      return;
    }

    let selected = matches.length === 1 ? matches[0] : undefined;

    if (!selected) {
      const labels = matches.map(formatModelOptionLabel);
      const picked = await this.options.extensionUi?.select?.('Select Pi model', labels);

      if (!picked) {
        return;
      }

      selected = matches[labels.indexOf(picked)];
    }

    if (!selected) {
      return;
    }

    await this.setModel(selected.provider, selected.id);
  }

  private async handleSessionSlashCommand(): Promise<void> {
    const client = this.options.getClient();
    const [state, stats]: [PiSessionState, PiSessionStats] = await Promise.all([
      client.getState(),
      client.getSessionStats()
    ]);

    this.options.session.addSystemMessage(formatSessionInfo(state, stats));
    this.options.postState();
  }

  private async handleForkSlashCommand(): Promise<void> {
    const select = this.options.extensionUi?.select;

    if (!select) {
      this.options.session.addSystemMessage('Fork selection is not available in this environment.');
      this.options.postState();
      return;
    }

    const forkMessages = formatForkMessages((await this.options.getClient().getForkMessages()).messages);

    if (forkMessages.length === 0) {
      this.options.session.addSystemMessage('No messages to fork from.');
      this.options.postState();
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

    const result = await this.options.getClient().fork(selected.entryId);

    if (result.cancelled) {
      return;
    }

    const forkText = typeof result.text === 'string'
      ? result.text.trim()
      : selected.text;

    await this.options.adoptReplacedSession({ refreshSessions: true });
    this.options.setComposerText(forkText);
    this.options.postState();
  }

  private async handleCloneSlashCommand(): Promise<void> {
    const result = await this.options.getClient().clone();

    if (result.cancelled) {
      return;
    }

    await this.options.adoptReplacedSession({ refreshSessions: true });
    this.options.showToast?.('Cloned current session.');
  }

  private async handleCopySlashCommand(): Promise<void> {
    const result = await this.options.getClient().getLastAssistantText();
    const text = typeof result.text === 'string' ? result.text : '';

    if (!text) {
      this.options.showNotification('No assistant message to copy.', 'warning');
      return;
    }

    await this.copyTextToClipboard(text, 'Copied last Pi response.');
  }

  private async copyTextToClipboard(text: string, successMessage: string, options: { successToast?: boolean } = {}): Promise<void> {
    if (!text) {
      this.options.showNotification('No assistant message to copy.', 'warning');
      return;
    }

    if (!this.options.writeClipboard) {
      this.options.showNotification('Copy is not available in this environment.', 'warning');
      return;
    }

    await this.options.writeClipboard(text);

    if (options.successToast && this.options.showToast) {
      this.options.showToast(successMessage, 'success');
      return;
    }

    this.options.showNotification(successMessage, 'info');
  }

  private async handleExportSlashCommand(outputPath: string): Promise<void> {
    const result = await this.options.getClient().exportHtml(outputPath || undefined);
    const path = typeof result.path === 'string' && result.path ? result.path : 'HTML file';
    this.options.session.addSystemMessage(`Exported session to ${path}.`);
    this.options.postState();
  }

  private async handleReloadSlashCommand(): Promise<void> {
    this.options.session.addSystemMessage('Reloading Pi resources...');
    this.options.postState();

    let restartedClient = false;
    let restoredSession = false;
    const client = this.options.getClient();

    try {
      await client.reload();
    } catch (error) {
      if (!isUnsupportedReloadCommandError(error)) {
        throw error;
      }

      const sessionFile = getSessionFile(await client.getState());
      restartedClient = true;
      restoredSession = Boolean(sessionFile);
      this.options.restartClientForReload(sessionFile);
    }

    await Promise.all([
      this.options.refreshSessionMeta({ startClient: true, force: true }),
      this.options.refreshSlashCommands({ startClient: true, force: true })
    ]);

    this.options.session.addSystemMessage(restartedClient
      ? restoredSession
        ? 'Reloaded Tau by restarting Pi RPC. Skills, prompts, extensions, and metadata were rediscovered. Current persisted session was reconnected.'
        : 'Reloaded Tau by restarting Pi RPC. Skills, prompts, extensions, and metadata were rediscovered. No persisted session was available to reconnect.'
      : 'Reloaded keybindings, extensions, skills, prompts, and themes.');
    this.options.postState();
  }
}
