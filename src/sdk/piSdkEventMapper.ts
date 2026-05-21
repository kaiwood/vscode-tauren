import type { AgentSessionEvent, ExtensionError } from '@earendil-works/pi-coding-agent';
import type { RpcEvent } from '../rpc/types';

export function mapSdkSessionEventToRpcEvent(event: AgentSessionEvent): RpcEvent {
  return event as unknown as RpcEvent;
}

export function mapSdkExtensionErrorToRpcEvent(error: ExtensionError): RpcEvent {
  return {
    type: 'extension_error',
    extensionPath: error.extensionPath,
    event: error.event,
    error: error.error
  };
}
