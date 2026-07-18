#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const releaseState = {
  updatedReleaseFiles: false,
  commitSha: '',
  createdLocalTag: false,
  pushedCommit: false,
  pushedTag: false,
  releaseMayExist: false,
  createdRelease: false
};

function usage() {
  return 'Usage: npm run release -- <version>\nExample: npm run release -- 1.1.0';
}

function fail(message) {
  throw new Error(message);
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, options = {}) {
  const { capture = false, allowFailure = false } = options;
  console.log(`\n$ ${commandText(command, args)}`);
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (result.error) {
    if (allowFailure) {
      return result;
    }
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(output || `Command failed: ${commandText(command, args)}`);
  }

  return result;
}

function capture(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  return (result.stdout || '').trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getGitOutput(args, options = {}) {
  return capture('git', args, options);
}

function checkCleanWorkingTree() {
  const status = getGitOutput(['status', '--porcelain']);
  if (status) {
    fail(`Working tree must be clean before release.\n${status}`);
  }
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`Invalid version: ${version}\nExpected strict x.y.z format, for example 1.1.0.`);
  }
}

function getBranchInfo() {
  const branch = getGitOutput(['branch', '--show-current']);
  if (!branch) {
    fail('Release must be run from a named git branch, not detached HEAD.');
  }

  const upstreamResult = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    capture: true,
    allowFailure: true
  });
  if (upstreamResult.status !== 0) {
    fail(`Current branch ${branch} must track origin before release.`);
  }

  const upstream = (upstreamResult.stdout || '').trim();
  const remote = getGitOutput(['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = getGitOutput(['config', '--get', `branch.${branch}.merge`]);
  if (remote !== 'origin' || !mergeRef.startsWith('refs/heads/')) {
    fail(`Current branch must track an origin branch. Found upstream: ${upstream}`);
  }

  return {
    branch,
    upstream,
    remote,
    remoteBranch: mergeRef.slice('refs/heads/'.length)
  };
}

function checkBranchSynced(branchInfo) {
  run('git', ['fetch', 'origin', '--tags']);
  const counts = getGitOutput(['rev-list', '--left-right', '--count', `HEAD...${branchInfo.upstream}`]);
  if (counts !== '0\t0' && counts !== '0 0') {
    fail(`Local branch and ${branchInfo.upstream} must be in sync before release. Found ahead/behind counts: ${counts}`);
  }
}

function localTagExists(tag) {
  return run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    capture: true,
    allowFailure: true
  }).status === 0;
}

function remoteTagExists(tag) {
  return run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
    capture: true,
    allowFailure: true
  }).status === 0;
}

function githubReleaseExists(tag) {
  const result = run('gh', ['release', 'view', tag, '--json', 'tagName'], {
    capture: true,
    allowFailure: true
  });

  if (result.status === 0) {
    return true;
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`.toLowerCase();
  if (output.includes('not found') || output.includes('could not resolve to a release')) {
    return false;
  }

  fail(output.trim() || `Unable to check GitHub release: ${tag}`);
}

function checkReleaseDoesNotExist(tag) {
  if (localTagExists(tag)) {
    fail(`Local tag already exists: ${tag}`);
  }
  if (remoteTagExists(tag)) {
    fail(`Remote tag already exists: ${tag}`);
  }
  if (githubReleaseExists(tag)) {
    fail(`GitHub release already exists: ${tag}`);
  }
}

function checkTools() {
  run('git', ['--version'], { capture: true });
  run('gh', ['--version'], { capture: true });
  run(npmCommand, ['--version'], { capture: true });
  run(npxCommand, ['--version'], { capture: true });
  run('gh', ['auth', 'status'], { capture: true });
}

function getUnreleasedSection(changelogText) {
  const headerMatch = /^## \[Unreleased\]\s*$/m.exec(changelogText);
  if (!headerMatch) {
    fail('CHANGELOG.md must contain a "## [Unreleased]" section.');
  }

  const bodyStart = headerMatch.index + headerMatch[0].length;
  const remaining = changelogText.slice(bodyStart);
  const nextHeaderMatch = /^##\s+/m.exec(remaining);
  const bodyEnd = nextHeaderMatch ? bodyStart + nextHeaderMatch.index : changelogText.length;
  const body = changelogText.slice(bodyStart, bodyEnd);

  if (!body.trim()) {
    fail('CHANGELOG.md Unreleased section must contain release notes.');
  }

  return { headerStart: headerMatch.index, bodyStart, bodyEnd, body };
}

function checkChangelogReady() {
  getUnreleasedSection(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8'));
}

function runPackagePreflight(tempDir) {
  run(npmCommand, ['run', 'compile']);
  run(npmCommand, ['run', 'verify:pi-sdk']);
  checkCleanWorkingTree();
  run(npxCommand, ['--yes', '@vscode/vsce', 'package', '--out', path.join(tempDir, 'preflight.vsix')]);
  checkCleanWorkingTree();
}

function updateVersionFiles(version) {
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = readJson(packageJsonPath);
  if (packageJson.version === version) {
    fail(`package.json already has version ${version}; choose a new release version.`);
  }
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);

  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = version;
    }
    writeJson(lockPath, lock);
  }
}

function promoteChangelog(version) {
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelogText = fs.readFileSync(changelogPath, 'utf-8');
  const section = getUnreleasedSection(changelogText);
  const date = new Date().toISOString().slice(0, 10);
  const notesBody = section.body.trim();
  const releaseHeading = `## [${version}] - ${date}`;
  const replacement = `## [Unreleased]\n\n${releaseHeading}\n\n${notesBody}\n\n`;
  const nextText = `${changelogText.slice(0, section.headerStart)}${replacement}${changelogText.slice(section.bodyEnd)}`;
  fs.writeFileSync(changelogPath, nextText);
  return `${releaseHeading}\n\n${notesBody}\n`;
}

function updateReleaseFiles(version) {
  updateVersionFiles(version);
  const releaseNotes = promoteChangelog(version);
  releaseState.updatedReleaseFiles = true;
  return releaseNotes;
}

function createPackage(version, tempDir) {
  const vsixPath = path.join(tempDir, `tauren-${version}.vsix`);
  run(npxCommand, ['--yes', '@vscode/vsce', 'package', '--out', vsixPath]);
  if (!fs.existsSync(vsixPath)) {
    fail(`Expected VSIX was not created: ${vsixPath}`);
  }
  return vsixPath;
}

function commitAndTag(tag) {
  run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
  run('git', ['commit', '-m', `Release ${tag}`]);
  releaseState.commitSha = getGitOutput(['rev-parse', 'HEAD']);

  run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
  releaseState.createdLocalTag = true;
}

function pushCommitAndTag(branchInfo, tag) {
  run('git', ['push', branchInfo.remote, `HEAD:${branchInfo.remoteBranch}`]);
  releaseState.pushedCommit = true;
  run('git', ['push', branchInfo.remote, tag]);
  releaseState.pushedTag = true;
}

function createGithubRelease(tag, releaseNotes, vsixPath, tempDir) {
  const notesPath = path.join(tempDir, `${tag}-notes.md`);
  fs.writeFileSync(notesPath, releaseNotes);
  releaseState.releaseMayExist = true;
  run('gh', ['release', 'create', tag, vsixPath, '--title', `Tauren ${tag}`, '--notes-file', notesPath]);
  releaseState.createdRelease = true;
}

function publishMarketplace() {
  run(npxCommand, ['@vscode/vsce', 'publish']);
}

function printCleanupInstructions(tag) {
  const instructions = [];

  if (releaseState.createdRelease || releaseState.releaseMayExist) {
    instructions.push(`Delete GitHub release if needed: gh release delete ${tag} --yes --cleanup-tag`);
  } else if (releaseState.pushedTag) {
    instructions.push(`Delete remote tag if needed: git push origin :refs/tags/${tag}`);
  }

  if (releaseState.createdLocalTag) {
    instructions.push(`Delete local tag if needed: git tag -d ${tag}`);
  }

  if (releaseState.pushedCommit && releaseState.commitSha) {
    instructions.push(`Revert pushed release commit if needed: git revert ${releaseState.commitSha}`);
  } else if (releaseState.commitSha) {
    instructions.push('Remove the local release commit if needed: git reset --hard HEAD~1');
  } else if (releaseState.updatedReleaseFiles) {
    instructions.push('Restore uncommitted release file changes if needed: git restore package.json package-lock.json CHANGELOG.md');
  }

  if (instructions.length > 0) {
    console.error('\nRelease was partially completed. Manual cleanup options:');
    for (const instruction of instructions) {
      console.error(`- ${instruction}`);
    }
  }
}

function main() {
  const version = process.argv[2];
  if (!version) {
    fail(usage());
  }

  validateVersion(version);
  const tag = `v${version}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tauren-release-'));

  console.log(`Preparing release ${tag}`);

  checkCleanWorkingTree();
  const branchInfo = getBranchInfo();
  checkTools();
  checkBranchSynced(branchInfo);
  checkReleaseDoesNotExist(tag);
  checkChangelogReady();
  runPackagePreflight(tempDir);

  const releaseNotes = updateReleaseFiles(version);
  const vsixPath = createPackage(version, tempDir);
  commitAndTag(tag);
  pushCommitAndTag(branchInfo, tag);
  createGithubRelease(tag, releaseNotes, vsixPath, tempDir);
  publishMarketplace();

  console.log(`\nReleased ${tag}`);
}

try {
  main();
} catch (error) {
  console.error(`\nRelease failed: ${error.message}`);
  const version = process.argv[2];
  if (version && /^\d+\.\d+\.\d+$/.test(version)) {
    printCleanupInstructions(`v${version}`);
  }
  process.exit(1);
}
