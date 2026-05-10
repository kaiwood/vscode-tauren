#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');

const isDryRun = process.argv.includes('--dry-run');

function readProcesses() {
  if (process.platform === 'win32') {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();

    if (!output) {
      return [];
    }

    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((processInfo) => processInfo.CommandLine)
      .map((processInfo) => ({
        pid: Number(processInfo.ProcessId),
        command: processInfo.CommandLine,
      }));
  }

  const output = execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return undefined;
      }
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter(Boolean);
}

function isCodeProcess(command) {
  const lowerCommand = command.toLowerCase();
  return (
    lowerCommand.includes('visual studio code') ||
    lowerCommand.includes('code helper') ||
    lowerCommand.includes('code.exe') ||
    lowerCommand.includes('/code ')
  );
}

function isExtensionHostProcess(command) {
  const lowerCommand = command.toLowerCase();

  if (!isCodeProcess(command)) {
    return false;
  }

  // VS Code 1.118+ runs the local extension host as an Electron utility
  // NodeService process. Other NodeService processes exist, so require the
  // extension-host inspect port marker too.
  if (
    lowerCommand.includes('--type=utility') &&
    lowerCommand.includes('--utility-sub-type=node.mojom.nodeservice') &&
    lowerCommand.includes('--inspect-port=0')
  ) {
    return true;
  }

  // Older VS Code builds used a more explicit extension host entry point.
  return (
    lowerCommand.includes('extensionhostprocess') ||
    lowerCommand.includes('extensionhostagent') ||
    lowerCommand.includes('--type=extensionhost')
  );
}

const processes = readProcesses();
const extensionHosts = processes.filter((processInfo) =>
  processInfo.pid !== process.pid && isExtensionHostProcess(processInfo.command),
);

if (extensionHosts.length === 0) {
  console.warn('No running VS Code extension host process found. Open windows may still need a manual reload.');
  process.exit(0);
}

for (const extensionHost of extensionHosts) {
  const message = `${isDryRun ? 'Would restart' : 'Restarting'} VS Code extension host pid ${extensionHost.pid}`;
  console.log(message);
  if (!isDryRun) {
    process.kill(extensionHost.pid, 'SIGTERM');
  }
}
