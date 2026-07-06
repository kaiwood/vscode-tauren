import type { PiSettingId } from '../settings/settingsRegistry';
import { isRecord } from '../shared/typeGuards';
import type { KwardCapabilities } from './types';

export class KwardCapabilityResolver {
  public constructor(private readonly capabilities: KwardCapabilities) {}

  public isGroupSupported(groupName: string): boolean {
    const group = this.getGroup(groupName);
    return group === true || (isRecord(group) && group.supported === true);
  }

  public isMethodSupported(groupName: string, method: string): boolean {
    const group = this.getGroup(groupName);
    if (!isRecord(group)) {
      return false;
    }

    const methods = group.methods;
    return group.supported !== false && Array.isArray(methods) && methods.includes(method);
  }

  public isSessionFeatureSupported(featureName: string): boolean {
    const sessions = this.getGroup('sessions');
    const feature = isRecord(sessions) ? sessions[featureName] : undefined;
    return isRecord(feature) && feature.supported === true;
  }

  public isTreeFeatureSupported(featureName: 'labels' | 'navigate' | 'summarize'): boolean {
    const sessions = this.getGroup('sessions');
    const tree = isRecord(sessions) ? sessions.tree : undefined;
    return isRecord(tree) && tree.supported === true && tree[featureName] === true;
  }

  public isRuntimeSettingSupported(settingId: PiSettingId): boolean {
    const runtimeSettings = this.getGroup('runtimeSettings');
    if (!isRecord(runtimeSettings) || runtimeSettings.supported !== true) {
      return false;
    }

    const settings = runtimeSettings.settings;
    return Array.isArray(settings) && settings.includes(settingId);
  }

  public isScopedModelsSupported(): boolean {
    const models = this.getGroup('models');
    return isRecord(models) && models.scopedModels === true;
  }

  public isBusyInputModeSupported(mode: 'steer' | 'followUp'): boolean {
    const turns = this.getGroup('turns');
    const busyInput = isRecord(turns) ? turns.busyInput : undefined;
    const value = isRecord(busyInput) ? busyInput[mode] : undefined;
    return typeof value === 'string' && value !== 'unsupported';
  }

  public isAttachmentInputSupported(): boolean {
    const attachments = this.getGroup('attachments');
    const input = isRecord(attachments) ? attachments.input : undefined;
    return isRecord(input) && input.supported === true;
  }

  public isMemorySupported(): boolean {
    return this.isGroupSupported('memory');
  }

  public isMcpDiscoverySupported(): boolean {
    const mcp = this.getGroup('mcp');
    const discovery = isRecord(mcp) ? mcp.discovery : undefined;
    return isRecord(discovery) && discovery.supported === true;
  }

  public isMcpStatusSupported(): boolean {
    const mcp = this.getGroup('mcp');
    const discovery = isRecord(mcp) ? mcp.discovery : undefined;
    const methods = isRecord(discovery) ? discovery.methods : undefined;
    return isRecord(discovery) && discovery.supported === true && Array.isArray(methods) && methods.includes('mcp/status');
  }

  public isMcpToolMetadataSupported(): boolean {
    const mcp = this.getGroup('mcp');
    const discovery = isRecord(mcp) ? mcp.discovery : undefined;
    return isRecord(discovery) && discovery.supported === true && discovery.toolMetadata === true;
  }

  public isMemoryMethodSupported(method: string): boolean {
    const memory = this.getGroup('memory');
    if (!isRecord(memory) || memory.supported !== true) {
      return false;
    }

    const methods = memory.methods;
    return !Array.isArray(methods) || methods.includes(method);
  }

  public getQuestionNotificationMethod(): string {
    const extensionUi = this.getGroup('extensionUi');
    const question = isRecord(extensionUi) ? extensionUi.question : undefined;
    return getString(isRecord(question) ? question : undefined, 'notification') ?? 'ui/question';
  }

  public getQuestionAnswerMethod(): string {
    const extensionUi = this.getGroup('extensionUi');
    const question = isRecord(extensionUi) ? extensionUi.question : undefined;
    return getString(isRecord(question) ? question : undefined, 'method') ?? 'ui/answerQuestion';
  }

  public getCompactionNotificationMethod(): string {
    const sessions = this.getGroup('sessions');
    const compact = isRecord(sessions) ? sessions.compact : undefined;
    return getString(isRecord(compact) ? compact : undefined, 'notification') ?? 'session/event';
  }

  public getTurnEventNotificationMethod(): string {
    const events = this.getGroup('events');
    return getString(isRecord(events) ? events : undefined, 'notification') ?? 'turn/event';
  }

  public getFooterNotificationMethod(): string {
    const extensionUi = this.getGroup('extensionUi');
    const footer = isRecord(extensionUi) ? extensionUi.footer : undefined;
    return getString(isRecord(footer) ? footer : undefined, 'notification') ?? 'ui/footer';
  }

  private getGroup(groupName: string): unknown {
    return this.capabilities[groupName];
  }
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}
