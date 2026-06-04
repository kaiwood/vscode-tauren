import { isBuiltinSlashCommand } from '../commands/slashCommands';

export function parseSlashCommand(text: string): { name: string; args: string } | undefined {
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return undefined;
  }

  return { name: match[1], args: match[2]?.trim() ?? '' };
}

export function parseLocalSlashCommand(text: string): { name: string; args: string } | undefined {
  const command = parseSlashCommand(text);

  if (!command || !isBuiltinSlashCommand(command.name)) {
    return undefined;
  }

  return command;
}
