import * as vscode from 'vscode';
import { parseWebviewCustomUiTheme } from '../webviewProtocol/values';
import type { WebviewCustomUiTheme } from '../webviewProtocol/types';
import type { VoiceHandsFreeSensitivity, VoiceLanguage, VoiceModelId, VoiceTranscriptAction } from '../voice/types';
import { settingDefinitions, type SettingValue, type TaurenBackend, type TaurenSettingId } from './settingsRegistry';

export const welcomeDismissedStorageKey = 'tauren.welcomeDismissed';

const taurenSettingIds = settingDefinitions
  .filter((definition) => definition.owner === 'tauren')
  .map((definition) => definition.id as TaurenSettingId);
const taurenExtensionSettingIds = taurenSettingIds.filter((id) => id.startsWith('tauren.extensions.'));

export function getBackendSetting(): TaurenBackend {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('backend', 'pi');
  return value === 'kward' ? 'kward' : 'pi';
}

export function getKwardPathSetting(): string | undefined {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('kward.path', '').trim();
  return value || undefined;
}

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

export function getVoiceEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('tauren').get<boolean>('voice.enabled', false);
}

export function getVoiceModelSetting(): VoiceModelId {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.model', 'base.en');
  return value === 'tiny.en' || value === 'small.en' || value === 'tiny' || value === 'base' || value === 'small' ? value : 'base.en';
}

export function getVoiceInputDeviceSetting(): string {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.inputDevice', 'default').trim();
  return value || 'default';
}

export function getVoiceLanguageSetting(): VoiceLanguage {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.language', 'auto');
  return value === 'en' || value === 'de' || value === 'fr' || value === 'es' || value === 'it' || value === 'pt' || value === 'nl' || value === 'pl' || value === 'ja' || value === 'ko' || value === 'zh'
    ? value
    : 'auto';
}

export function getVoiceModeSetting(): 'pushToTalk' | 'handsFree' {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.mode', 'pushToTalk');
  return value === 'handsFree' ? 'handsFree' : 'pushToTalk';
}

export function getVoiceActivationModeSetting(): 'toggle' | 'hold' {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.activationMode', 'toggle');
  return value === 'hold' ? 'hold' : 'toggle';
}

export function getVoiceMaxRecordingSecondsSetting(): number {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.maxRecordingSeconds', '60');
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getVoiceHandsFreeSensitivitySetting(): VoiceHandsFreeSensitivity {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.handsFreeSensitivity', 'normal');
  return value === 'low' || value === 'high' ? value : 'normal';
}

export function getVoiceHandsFreeSilenceSecondsSetting(): number {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.handsFreeSilenceSeconds', '1.2');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.2;
}

export function getVoiceTranscriptActionSetting(): VoiceTranscriptAction {
  const value = vscode.workspace.getConfiguration('tauren').get<string>('voice.transcriptAction', 'insert');
  return value === 'submit' ? 'submit' : 'insert';
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
    'tauren.backend': getBackendSetting(),
    'tauren.kward.path': getKwardPathSetting() ?? '',
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
    'tauren.readyScriptEnabled': getReadyScriptEnabledSetting(),
    'tauren.voice.enabled': getVoiceEnabledSetting(),
    'tauren.voice.model': getVoiceModelSetting(),
    'tauren.voice.inputDevice': getVoiceInputDeviceSetting(),
    'tauren.voice.language': getVoiceLanguageSetting(),
    'tauren.voice.mode': getVoiceModeSetting(),
    'tauren.voice.activationMode': getVoiceActivationModeSetting(),
    'tauren.voice.maxRecordingSeconds': String(getVoiceMaxRecordingSecondsSetting()),
    'tauren.voice.handsFreeSensitivity': getVoiceHandsFreeSensitivitySetting(),
    'tauren.voice.handsFreeSilenceSeconds': String(getVoiceHandsFreeSilenceSecondsSetting()),
    'tauren.voice.transcriptAction': getVoiceTranscriptActionSetting()
  };
}

export async function updateTaurenSetting(id: TaurenSettingId, value: SettingValue): Promise<void> {
  const configKey = id.slice('tauren.'.length);

  if (Array.isArray(value)) {
    throw new Error(`Unsupported Tauren setting value for ${id}.`);
  }

  await vscode.workspace.getConfiguration('tauren').update(configKey, value, vscode.ConfigurationTarget.Global);
}
