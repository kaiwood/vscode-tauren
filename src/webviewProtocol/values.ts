import { settingsSections } from '../settings/settingsRegistry';
import type {
  WebviewChatFace,
  WebviewCustomUiTheme,
  WebviewLane,
  WebviewSessionItemCommand,
  WebviewSettingsSection,
  WebviewStreamingBehavior
} from './types';

const webviewStreamingBehaviors = ['steer', 'followUp'] as const satisfies readonly WebviewStreamingBehavior[];
const webviewCustomUiThemes = ['default', 'modern', 'crt', 'amber', 'matrix'] as const satisfies readonly WebviewCustomUiTheme[];
const webviewLanes = ['chat', 'sessions', 'tree'] as const satisfies readonly WebviewLane[];
const webviewChatFaces = ['main', 'settings'] as const satisfies readonly WebviewChatFace[];
const webviewSettingsSections = settingsSections.map((section) => section.id) as WebviewSettingsSection[];
export const webviewSessionItemCommands = ['rename', 'showChanges', 'fork', 'clone', 'compact', 'export', 'delete'] as const satisfies readonly WebviewSessionItemCommand[];

export function parseWebviewStreamingBehavior(value: unknown): WebviewStreamingBehavior | undefined {
  return includesValue(webviewStreamingBehaviors, value) ? value : undefined;
}

export function parseWebviewCustomUiTheme(value: unknown, fallback: WebviewCustomUiTheme = 'default'): WebviewCustomUiTheme {
  return includesValue(webviewCustomUiThemes, value) ? value : fallback;
}

export function parseWebviewLane(value: unknown, fallback: WebviewLane = 'chat'): WebviewLane {
  return includesValue(webviewLanes, value) ? value : fallback;
}

export function parseWebviewChatFace(value: unknown, fallback: WebviewChatFace = 'main'): WebviewChatFace {
  return includesValue(webviewChatFaces, value) ? value : fallback;
}

export function parseWebviewSettingsSection(value: unknown): WebviewSettingsSection | undefined;
export function parseWebviewSettingsSection(value: unknown, fallback: WebviewSettingsSection): WebviewSettingsSection;
export function parseWebviewSettingsSection(value: unknown, fallback?: WebviewSettingsSection): WebviewSettingsSection | undefined {
  return includesValue(webviewSettingsSections, value) ? value : fallback;
}

export function parseWebviewSessionItemCommand(command: unknown): WebviewSessionItemCommand | undefined {
  return includesValue(webviewSessionItemCommands, command) ? command : undefined;
}

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
