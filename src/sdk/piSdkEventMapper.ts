import type { AgentSessionEvent, ExtensionError } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '../agent/types';

export function mapSdkSessionEventToAgentEvent(event: AgentSessionEvent): AgentEvent {
  return event as unknown as AgentEvent;
}

export const mapSdkSessionEventToPiEvent = mapSdkSessionEventToAgentEvent;

export function mapSdkExtensionErrorToAgentEvent(error: ExtensionError): AgentEvent {
  return {
    type: 'extension_error',
    extensionPath: error.extensionPath,
    event: error.event,
    error: error.error
  };
}

export const mapSdkExtensionErrorToPiEvent = mapSdkExtensionErrorToAgentEvent;
