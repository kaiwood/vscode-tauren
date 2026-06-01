import * as vscode from 'vscode';
import { parseWebviewCustomUiTheme } from '../webviewProtocol/values';
import type { WebviewCustomUiTheme } from '../webviewProtocol/types';
import { settingDefinitions, type SettingValue, type TaurenSettingId } from './settingsRegistry';

export const welcomeDismissedStorageKey = 'tauren.welcomeDismissed';

const taurenSettingIds = settingDefinitions
  .filter((definition) => definition.owner === 'tauren')
  .map((definition) => definition.id as TaurenSettingId);
const taurenExtensionSettingIds = taurenSettingIds.filter((id) => id.startsWith('tauren.extensions.'));

export function getOutputColorsSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('outputColors', true);
}

export function getAnimationsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('animationsEnabled', true);
}

export function getShowWelcomeSetting(globalState?: vscode.Memento): boolean {
  if (hasConfiguredShowWelcomeSetting()) {
    return vscode.workspace.getConfiguration('tauren').get<boolean>('showWelcome', true);
  }

  return globalState?.get<boolean>(welcomeDismissedStorageKey) === true ? false : true;
}

export function hasConfiguredShowWelcomeSetting(): boolean {
  const inspected = vscode.workspace.getConfiguration('tauren').inspect<boolean>('showWelcome');

  return [
    inspected?.globalValue,
    inspected?.workspaceValue,
    inspected?.workspaceFolderValue,
    inspected?.globalLanguageValue,
    inspected?.workspaceLanguageValue,
    inspected?.workspaceFolderLanguageValue
  ].some((value) => typeof value === 'boolean');
}

export function getConfirmSessionDeletionSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('confirmSessionDeletion', true);
}

export function getUseTaurenShareViewerSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('useTaurenShareViewer', true);
}

export function getCustomUiThemeSetting(): WebviewCustomUiTheme {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('customUiTheme', 'default');
  return parseWebviewCustomUiTheme(value);
}

function getBlockHttpsImagesSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('blockHttpsImages', true);
}

export function getAllowRemoteImagesSetting(): boolean {
  return !getBlockHttpsImagesSetting();
}

export function getReadyScriptSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('readyScript', '').trim();
  return value || undefined;
}

export function getReadyScriptEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('readyScriptEnabled', true);
}

export function getRestrictFileReferencesToWorkspaceSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('restrictFileReferencesToWorkspace', true);
}

export function getRejectEditWriteOutsideWorkspaceSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('rejectEditWriteOutsideWorkspace', false);
}

export function getDebugPerformanceSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('debugPerformance', false);
}

export function affectsAnyTaurenSetting(event: vscode.ConfigurationChangeEvent): boolean {
  return taurenSettingIds.some((id) => event.affectsConfiguration(id));
}

export function affectsAnyTaurenExtensionSetting(event: vscode.ConfigurationChangeEvent): boolean {
  return taurenExtensionSettingIds.some((id) => event.affectsConfiguration(id));
}

function getExtensionAboveWidgetsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('extensions.aboveWidgetsEnabled', true);
}

function getExtensionBelowWidgetsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('extensions.belowWidgetsEnabled', true);
}

function getExtensionStatusBarEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('extensions.statusBarEnabled', true);
}

function getExtensionBackgroundColorsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('extensions.backgroundColorsEnabled', true);
}

function getExtensionMonospaceFontEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('extensions.monospaceFontEnabled', true);
}

export function getTaurenSettingValues(globalState?: vscode.Memento): Partial<Record<TaurenSettingId, SettingValue>> {
  return {
    'tauren.outputColors': getOutputColorsSetting(),
    'tauren.animationsEnabled': getAnimationsEnabledSetting(),
    'tauren.showWelcome': getShowWelcomeSetting(globalState),
    'tauren.useTaurenShareViewer': getUseTaurenShareViewerSetting(),
    'tauren.customUiTheme': getCustomUiThemeSetting(),
    'tauren.extensions.aboveWidgetsEnabled': getExtensionAboveWidgetsEnabledSetting(),
    'tauren.extensions.belowWidgetsEnabled': getExtensionBelowWidgetsEnabledSetting(),
    'tauren.extensions.statusBarEnabled': getExtensionStatusBarEnabledSetting(),
    'tauren.extensions.backgroundColorsEnabled': getExtensionBackgroundColorsEnabledSetting(),
    'tauren.extensions.monospaceFontEnabled': getExtensionMonospaceFontEnabledSetting(),
    'tauren.blockHttpsImages': getBlockHttpsImagesSetting(),
    'tauren.confirmSessionDeletion': getConfirmSessionDeletionSetting(),
    'tauren.restrictFileReferencesToWorkspace': getRestrictFileReferencesToWorkspaceSetting(),
    'tauren.rejectEditWriteOutsideWorkspace': getRejectEditWriteOutsideWorkspaceSetting(),
    'tauren.debugPerformance': getDebugPerformanceSetting(),
    'tauren.readyScript': getReadyScriptSetting() ?? '',
    'tauren.readyScriptEnabled': getReadyScriptEnabledSetting()
  };
}

export async function updateTaurenSetting(id: TaurenSettingId, value: SettingValue): Promise<void> {
  const configKey = id.slice('tauren.'.length);

  if (Array.isArray(value)) {
    throw new Error(`Unsupported Tauren setting value for ${id}.`);
  }

  await vscode.workspace.getConfiguration('tauren').update(configKey, value, vscode.ConfigurationTarget.Global);
}
