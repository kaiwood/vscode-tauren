import type { AgentSessionEvent, ExtensionError } from '@earendil-works/pi-coding-agent';
import type { PiEvent } from '../pi/types';

export function mapSdkSessionEventToPiEvent(event: AgentSessionEvent): PiEvent {
  return event as unknown as PiEvent;
}

export function mapSdkExtensionErrorToPiEvent(error: ExtensionError): PiEvent {
  return {
    type: 'extension_error',
    extensionPath: error.extensionPath,
    event: error.event,
    error: error.error
  };
}
