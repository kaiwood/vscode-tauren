#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.resolve(__dirname, '..');
const packageName = '@earendil-works/pi-coding-agent';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getCurrentVersion() {
  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    const lockedVersion = lock.packages?.[`node_modules/${packageName}`]?.version;
    if (lockedVersion) {
      return lockedVersion;
    }
  }

  const packageJson = readJson(path.join(root, 'package.json'));
  const declaredVersion = packageJson.devDependencies?.[packageName];
  if (!declaredVersion) {
    throw new Error(`Missing devDependency: ${packageName}`);
  }

  return declaredVersion.replace(/^[~^]/, '');
}

function getLatestVersion() {
  const result = childProcess.spawnSync(
    npmCommand,
    ['view', packageName, 'version', '--json'],
    { cwd: root, encoding: 'utf-8' }
  );

  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(output || `Failed to query npm for ${packageName}`);
  }

  const version = JSON.parse(result.stdout);
  if (typeof version !== 'string' || !version) {
    throw new Error(`Unexpected npm version response for ${packageName}`);
  }

  return version;
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  const yes = process.argv.includes('--yes');
  const currentVersion = getCurrentVersion();
  const latestVersion = getLatestVersion();

  if (currentVersion === latestVersion) {
    console.log(`${packageName} is current (${currentVersion}).`);
    return;
  }

  console.log(`${packageName}: ${currentVersion} -> ${latestVersion}`);

  if (!yes) {
    const approved = await askYesNo(`Update ${packageName} to ${latestVersion}?`);
    if (!approved) {
      console.log('Update cancelled.');
      return;
    }
  }

  run(npmCommand, ['install', '--save-dev', `${packageName}@${latestVersion}`]);
  run(npmCommand, ['run', 'compile']);
  run(npmCommand, ['run', 'verify:pi-sdk']);
  run('git', ['diff', '--check']);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
