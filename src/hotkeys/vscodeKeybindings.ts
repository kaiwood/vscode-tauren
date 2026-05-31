import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatTaurenHotkeys, type VsCodeHotkey } from './hotkeys';
import { isNonArrayRecord as isRecord } from '../shared/typeGuards';

type PackageJson = {
  contributes?: {
    commands?: unknown;
    keybindings?: unknown;
  };
};

type ContributedCommand = {
  command: string;
  title: string;
};

type ContributedKeybinding = {
  command: string;
  key?: string;
  mac?: string;
  linux?: string;
  win?: string;
  when?: string;
};

type UserKeybinding = {
  command?: string;
  key?: string;
  when?: string;
};

const taurenSidebarFocusContext = 'tauren.sidebarFocus';

export function buildTaurenHotkeysMarkdown(extensionPath: string): string {
  const result = readVsCodeHotkeys(extensionPath);
  return formatTaurenHotkeys({
    vscodeHotkeys: result.hotkeys,
    vscodeNote: result.note
  });
}

export function readVsCodeHotkeys(extensionPath: string, userKeybindingFilePaths = getUserKeybindingFilePaths()): { hotkeys: VsCodeHotkey[]; note: string } {
  const packageJson = readPackageJson(extensionPath);
  const commands = readContributedCommands(packageJson);
  const keybindings = readContributedKeybindings(packageJson);
  const defaults = collectDefaultBindings(keybindings, process.platform);
  const userBindings = readUserKeybindings(userKeybindingFilePaths);
  const hotkeys = collectVsCodeHotkeys(commands, defaults, userBindings);
  const note = '_VS Code command keybindings are best-effort: Tauren reads its defaults and known user keybindings.json files, but VS Code profiles or extension-host state may differ._';

  return { hotkeys, note };
}

function readPackageJson(extensionPath: string): PackageJson {
  try {
    return JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

function readContributedCommands(packageJson: PackageJson): ContributedCommand[] {
  const commands = packageJson.contributes?.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((entry): ContributedCommand[] => {
    if (!isRecord(entry) || typeof entry.command !== 'string' || typeof entry.title !== 'string') {
      return [];
    }

    return [{ command: entry.command, title: entry.title }];
  });
}

function readContributedKeybindings(packageJson: PackageJson): ContributedKeybinding[] {
  const keybindings = packageJson.contributes?.keybindings;

  if (!Array.isArray(keybindings)) {
    return [];
  }

  return keybindings.flatMap((entry): ContributedKeybinding[] => {
    if (!isRecord(entry) || typeof entry.command !== 'string') {
      return [];
    }

    return [{
      command: entry.command,
      ...(typeof entry.key === 'string' ? { key: entry.key } : {}),
      ...(typeof entry.mac === 'string' ? { mac: entry.mac } : {}),
      ...(typeof entry.linux === 'string' ? { linux: entry.linux } : {}),
      ...(typeof entry.win === 'string' ? { win: entry.win } : {}),
      ...(typeof entry.when === 'string' ? { when: entry.when } : {})
    }];
  });
}

function collectDefaultBindings(keybindings: ContributedKeybinding[], platform: NodeJS.Platform): Map<string, string[]> {
  const bindings = new Map<string, string[]>();

  for (const binding of keybindings) {
    const key = getPlatformKey(binding, platform);

    if (!key || !isSidebarFocusBinding(binding)) {
      continue;
    }

    addBinding(bindings, binding.command, key);
  }

  return bindings;
}

function collectVsCodeHotkeys(
  commands: ContributedCommand[],
  defaultBindings: Map<string, string[]>,
  userBindings: UserKeybinding[]
): VsCodeHotkey[] {
  const commandTitles = new Map(commands.map((command) => [command.command, command.title]));
  const bindings = new Map(defaultBindings);

  for (const binding of userBindings) {
    if (typeof binding.command !== 'string' || typeof binding.key !== 'string') {
      continue;
    }

    if (binding.command.startsWith('-')) {
      const command = binding.command.slice(1);

      if (command.startsWith('tauren.') || isSidebarFocusBinding(binding)) {
        removeBinding(bindings, command, binding.key);
      }
      continue;
    }

    if (binding.command.startsWith('tauren.') || isSidebarFocusBinding(binding)) {
      addBinding(bindings, binding.command, binding.key);
    }
  }

  return [...bindings.entries()]
    .filter(([, keys]) => keys.length > 0)
    .sort(([leftCommand], [rightCommand]) => compareCommandOrder(commands, leftCommand, rightCommand))
    .map(([command, keys]) => ({
      command,
      key: keys.map(formatVsCodeKey).join(', '),
      action: `${commandTitles.get(command) ?? command} (${command})`
    }));
}

function compareCommandOrder(commands: ContributedCommand[], leftCommand: string, rightCommand: string): number {
  const leftIndex = commands.findIndex((command) => command.command === leftCommand);
  const rightIndex = commands.findIndex((command) => command.command === rightCommand);

  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }

  return leftCommand.localeCompare(rightCommand);
}

function addBinding(bindings: Map<string, string[]>, command: string, key: string): void {
  const normalizedKey = normalizeKey(key);

  if (!normalizedKey) {
    return;
  }

  const keys = bindings.get(command) ?? [];

  if (!keys.map(normalizeKey).includes(normalizedKey)) {
    bindings.set(command, [...keys, key]);
  }
}

function removeBinding(bindings: Map<string, string[]>, command: string, key: string): void {
  const normalizedKey = normalizeKey(key);
  const keys = bindings.get(command);

  if (!keys) {
    return;
  }

  bindings.set(command, keys.filter((entry) => normalizeKey(entry) !== normalizedKey));
}

function isSidebarFocusBinding(binding: { when?: string }): boolean {
  return binding.when?.split(/\s*(?:&&|\|\|)\s*/).includes(taurenSidebarFocusContext) ?? false;
}

function getPlatformKey(binding: ContributedKeybinding, platform: NodeJS.Platform): string | undefined {
  if (platform === 'darwin') {
    return binding.mac ?? binding.key;
  }

  if (platform === 'win32') {
    return binding.win ?? binding.key;
  }

  return binding.linux ?? binding.key;
}

function getUserKeybindingFilePaths(): string[] {
  const home = os.homedir();
  const roots = process.platform === 'darwin'
    ? [
      path.join(home, 'Library/Application Support/Code/User'),
      path.join(home, 'Library/Application Support/Code - Insiders/User'),
      path.join(home, 'Library/Application Support/VSCodium/User')
    ]
    : process.platform === 'win32'
      ? [
        path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'Code/User'),
        path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'Code - Insiders/User'),
        path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'VSCodium/User')
      ]
      : [
        path.join(home, '.config/Code/User'),
        path.join(home, '.config/Code - Insiders/User'),
        path.join(home, '.config/VSCodium/User')
      ];

  const files: string[] = [];

  for (const root of roots) {
    files.push(path.join(root, 'keybindings.json'));

    try {
      for (const profile of fs.readdirSync(path.join(root, 'profiles'))) {
        files.push(path.join(root, 'profiles', profile, 'keybindings.json'));
      }
    } catch {
      // Profiles are optional and vary by VS Code distribution.
    }
  }

  return files;
}

function readUserKeybindings(filePaths: string[]): UserKeybinding[] {
  return filePaths.flatMap((filePath) => readUserKeybindingFile(filePath));
}

function readUserKeybindingFile(filePath: string): UserKeybinding[] {
  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(filePath, 'utf8'))) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry): UserKeybinding[] => {
      if (!isRecord(entry) || typeof entry.command !== 'string' || typeof entry.key !== 'string') {
        return [];
      }

      return [{
        command: entry.command,
        key: entry.key,
        ...(typeof entry.when === 'string' ? { when: entry.when } : {})
      }];
    });
  } catch {
    return [];
  }
}

function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      result += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    result += char;
  }

  return result.replace(/,\s*([}\]])/g, '$1');
}

function formatVsCodeKey(key: string): string {
  return key
    .split(/\s+/)
    .filter(Boolean)
    .map((chord) => chord
      .split('+')
      .map((part) => formatKeyPart(part))
      .join('+'))
    .join(' ');
}

function formatKeyPart(part: string): string {
  const lower = part.toLowerCase();
  const labels: Record<string, string> = {
    cmd: 'Cmd',
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    option: 'Option',
    meta: 'Meta',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→'
  };

  return labels[lower] ?? (lower.length === 1 ? lower.toUpperCase() : lower[0].toUpperCase() + lower.slice(1));
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ');
}
