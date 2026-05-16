import type { PiRpcClient } from './client';
import type { PiRpcClientOptions } from './types';

export type PiRpcClientLike = Pick<
  PiRpcClient,
  | 'onEvent'
  | 'onError'
  | 'prompt'
  | 'abort'
  | 'reload'
  | 'isRunning'
  | 'getState'
  | 'getSessionStats'
  | 'getAvailableModels'
  | 'getCommands'
  | 'setModel'
  | 'setThinkingLevel'
  | 'setSessionName'
  | 'compact'
  | 'exportHtml'
  | 'getLastAssistantText'
  | 'getMessages'
  | 'switchSession'
  | 'navigateTree'
  | 'getForkMessages'
  | 'fork'
  | 'clone'
  | 'respondExtensionUiRequest'
  | 'dispose'
>;

export type PiRpcClientFactory = (options: PiRpcClientOptions) => PiRpcClientLike;
