import {
  hiddenLocalSlashCommandNames as sharedHiddenLocalSlashCommandNames,
  localSlashMenuCommands as sharedLocalSlashMenuCommands
} from '../commands/slashCommands';
import { kwardMemoryCommandOptions } from '../kward/memoryCommandOptions';
import type { SlashCommand } from './types';

export const webviewHiddenLocalSlashCommandNames = sharedHiddenLocalSlashCommandNames;
export const webviewLocalSlashCommands: SlashCommand[] = sharedLocalSlashMenuCommands.map((command) => ({ ...command }));
export const webviewKwardMemoryCommandOptions = kwardMemoryCommandOptions.map((option) => ({ ...option }));

export const messagesBottomThreshold = 4;
export const maxTextareaHeight = 180;
export const minTextareaHeight = 22;
