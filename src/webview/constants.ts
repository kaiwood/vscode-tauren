import {
  hiddenLocalSlashCommandNames as sharedHiddenLocalSlashCommandNames,
  localSlashMenuCommands as sharedLocalSlashMenuCommands
} from '../commands/slashCommands';
import type { SlashCommand } from './types';

export const webviewHiddenLocalSlashCommandNames = sharedHiddenLocalSlashCommandNames;
export const webviewLocalSlashCommands: SlashCommand[] = sharedLocalSlashMenuCommands.map((command) => ({ ...command }));

export const messagesBottomThreshold = 4;
export const maxTextareaHeight = 180;
export const minTextareaHeight = 22;
