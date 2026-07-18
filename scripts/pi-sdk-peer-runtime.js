const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const supportedPeerPackages = [
  'typebox',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function getPackagePath(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

function getExportTarget(exportValue, packageName, exportKey) {
  if (typeof exportValue === 'string') {
    return exportValue;
  }

  if (!exportValue || Array.isArray(exportValue)) {
    throw new Error(`Unsupported exports entry ${packageName}${exportKey}: expected a string or condition object.`);
  }

  for (const condition of ['import', 'node', 'default', 'require']) {
    if (Object.prototype.hasOwnProperty.call(exportValue, condition)) {
      return getExportTarget(exportValue[condition], packageName, exportKey);
    }
  }

  throw new Error(`Unsupported exports conditions for ${packageName}${exportKey}.`);
}

function getExportEntries(packageName, packageDir, packageJson) {
  const exportsField = packageJson.exports;
  const rawEntries = [];

  if (exportsField === undefined) {
    const entry = packageJson.module ?? packageJson.main;
    if (!entry) {
      throw new Error(`Missing main/module/exports entry for SDK extension peer ${packageName}.`);
    }
    rawEntries.push(['.', entry.startsWith('./') ? entry : `./${entry}`]);
  } else if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    rawEntries.push(['.', exportsField]);
  } else if (Object.keys(exportsField).some((key) => key.startsWith('.'))) {
    rawEntries.push(...Object.entries(exportsField));
  } else {
    rawEntries.push(['.', exportsField]);
  }

  const entries = [];
  for (const [exportKey, exportValue] of rawEntries) {
    if (typeof exportKey !== 'string' || (exportKey !== '.' && !exportKey.startsWith('./'))) {
      throw new Error(`Unsupported exports key ${packageName}${String(exportKey)}.`);
    }

    const target = getExportTarget(exportValue, packageName, exportKey);
    if (!target.startsWith('./')) {
      throw new Error(`Unsupported exports target ${packageName}${exportKey}: ${target}`);
    }

    if (exportKey.includes('*') || target.includes('*')) {
      if (!exportKey.includes('*') || !target.includes('*')) {
        throw new Error(`Mismatched wildcard export for ${packageName}${exportKey}.`);
      }
      entries.push(...expandWildcardEntry(packageName, packageDir, exportKey, target));
      continue;
    }

    const targetPath = path.join(packageDir, target);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Missing exports target for ${packageName}${exportKey}: ${target}`);
    }
    entries.push({ exportKey, target });
  }

  const seen = new Set();
  return entries
    .sort((left, right) => left.exportKey.localeCompare(right.exportKey))
    .filter((entry) => {
      if (seen.has(entry.exportKey)) {
        return false;
      }
      seen.add(entry.exportKey);
      return true;
    });
}

function expandWildcardEntry(packageName, packageDir, exportKey, target) {
  const targetPrefix = target.slice(0, target.indexOf('*'));
  const targetSuffix = target.slice(target.indexOf('*') + 1);
  const searchRoot = path.join(packageDir, targetPrefix);

  if (!fs.existsSync(searchRoot)) {
    throw new Error(`Missing wildcard exports directory for ${packageName}${exportKey}: ${targetPrefix}`);
  }

  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativeTarget = `./${toPosixPath(path.relative(packageDir, entryPath))}`;
      if (!relativeTarget.startsWith(targetPrefix) || !relativeTarget.endsWith(targetSuffix)) {
        continue;
      }

      const wildcard = relativeTarget.slice(targetPrefix.length, relativeTarget.length - targetSuffix.length);
      entries.push({
        exportKey: exportKey.replace('*', wildcard),
        target: relativeTarget
      });
    }
  };

  visit(searchRoot);
  if (entries.length === 0) {
    throw new Error(`Wildcard export ${packageName}${exportKey} did not match any files.`);
  }
  return entries;
}

function createPeerRuntimePlan(piPackageDir) {
  const sourceNodeModules = path.join(piPackageDir, 'node_modules');
  const peers = [];
  let namespaceIndex = 0;

  for (const packageName of supportedPeerPackages) {
    const packageDir = getPackagePath(sourceNodeModules, packageName);
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`Missing bundled SDK extension dependency: ${packageName}`);
    }

    const packageJson = readJson(packageJsonPath);
    const entries = getExportEntries(packageName, packageDir, packageJson).map((entry) => {
      if (entry.target.endsWith('.json')) {
        return { ...entry, kind: 'metadata' };
      }

      const specifier = entry.exportKey === '.' ? packageName : `${packageName}/${entry.exportKey.slice(2)}`;
      const namespace = `__taurenPeer${namespaceIndex++}`;
      return {
        ...entry,
        kind: 'module',
        specifier,
        namespace,
        sourcePath: path.join(packageDir, entry.target)
      };
    });

    if (!entries.some((entry) => entry.exportKey === '.')) {
      throw new Error(`Missing root export for SDK extension peer ${packageName}.`);
    }

    peers.push({
      packageName,
      version: packageJson.version,
      entries,
      hasExports: packageJson.exports !== undefined
    });
  }

  return { peers };
}

function writeBundleEntry(outputDir, plan) {
  const entryFile = path.join(outputDir, 'piSdkBundleEntry.mjs');
  const lines = ["export * from '@earendil-works/pi-coding-agent';"];

  for (const peer of plan.peers) {
    for (const entry of peer.entries) {
      if (entry.kind === 'module') {
        lines.push(`export * as ${entry.namespace} from ${JSON.stringify(entry.sourcePath)};`);
      }
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(entryFile, `${lines.join('\n')}\n`);
  return entryFile;
}

function getShimFileName(exportKey) {
  if (exportKey === '.') {
    return 'index.mjs';
  }

  const relativePath = exportKey.slice(2);
  if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe peer export path: ${exportKey}`);
  }
  return `${relativePath}.mjs`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeShimModule(filePath, bundleFile, namespace, exportNames) {
  const relativeBundlePath = toPosixPath(path.relative(path.dirname(filePath), bundleFile));
  const importPath = relativeBundlePath.startsWith('.') ? relativeBundlePath : `./${relativeBundlePath}`;
  const lines = [
    `import { ${namespace} as peer } from ${JSON.stringify(importPath)};`,
    '// Generated from the installed Pi SDK public export surface.'
  ];
  const namedExports = exportNames.filter((name) => name !== 'default');

  namedExports.forEach((name, index) => {
    const localName = `peerExport${index}`;
    lines.push(`const ${localName} = peer[${JSON.stringify(name)}];`);
    lines.push(`export { ${localName} as ${JSON.stringify(name)} };`);
  });

  if (exportNames.includes('default')) {
    lines.push('export default peer.default;');
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function writePeerRuntimeShims(outputDir, piPackageDir, plan, bundleFile) {
  const targetNodeModules = path.join(outputDir, 'node_modules');
  fs.rmSync(targetNodeModules, { recursive: true, force: true });

  const bundle = await import(pathToFileURL(bundleFile).href);
  const manifestPeers = [];

  for (const peer of plan.peers) {
    const packageDir = getPackagePath(targetNodeModules, peer.packageName);
    const exports = {};
    const manifestEntries = [];

    for (const entry of peer.entries) {
      if (entry.kind === 'metadata') {
        exports[entry.exportKey] = './package.json';
        continue;
      }

      const namespace = bundle[entry.namespace];
      if (!namespace) {
        throw new Error(`Missing bundled peer namespace ${entry.namespace} for ${entry.specifier}.`);
      }

      const fileName = getShimFileName(entry.exportKey);
      const filePath = path.join(packageDir, fileName);
      const exportNames = Object.keys(namespace).sort();
      writeShimModule(filePath, bundleFile, entry.namespace, exportNames);
      exports[entry.exportKey] = `./${toPosixPath(fileName)}`;
      manifestEntries.push({
        specifier: entry.specifier,
        namespace: entry.namespace,
        fileName: toPosixPath(fileName),
        exportNames
      });
    }

    const packageJson = {
      name: peer.packageName,
      version: peer.version,
      type: 'module',
      ...(peer.hasExports ? { exports } : { main: './index.mjs' })
    };
    writeJson(path.join(packageDir, 'package.json'), packageJson);
    manifestPeers.push({ packageName: peer.packageName, version: peer.version, entries: manifestEntries });
  }

  const piPackageJson = readJson(path.join(piPackageDir, 'package.json'));
  const manifest = {
    formatVersion: 1,
    piSdkVersion: piPackageJson.version,
    peers: manifestPeers
  };
  writeJson(path.join(outputDir, 'peer-runtime-manifest.json'), manifest);
  return manifest;
}

async function verifyPeerRuntime(outputDir) {
  const manifest = readJson(path.join(outputDir, 'peer-runtime-manifest.json'));
  const bundleFile = path.join(outputDir, 'piSdkBundle.mjs');
  const bundle = await import(pathToFileURL(bundleFile).href);
  const verificationFile = path.join(outputDir, '.verify-peer-runtime.mjs');
  const imports = manifest.peers.flatMap((peer) => peer.entries.map((entry) => entry.specifier));

  fs.writeFileSync(
    verificationFile,
    `${imports.map((specifier) => `await import(${JSON.stringify(specifier)});`).join('\n')}\n`
  );

  try {
    await import(`${pathToFileURL(verificationFile).href}?peerRuntimeVerify=${Date.now()}`);
  } finally {
    fs.rmSync(verificationFile, { force: true });
  }

  for (const peer of manifest.peers) {
    for (const entry of peer.entries) {
      const packageDir = getPackagePath(path.join(outputDir, 'node_modules'), peer.packageName);
      const moduleFile = path.join(packageDir, entry.fileName);
      const shim = await import(`${pathToFileURL(moduleFile).href}?peerRuntimeVerify=${Date.now()}`);
      const namespace = bundle[entry.namespace];
      const actualNames = Object.keys(shim).sort();

      if (JSON.stringify(actualNames) !== JSON.stringify(entry.exportNames)) {
        throw new Error(`Peer shim export mismatch for ${entry.specifier}.`);
      }

      for (const exportName of entry.exportNames) {
        if (shim[exportName] !== namespace[exportName]) {
          throw new Error(`Peer shim identity mismatch for ${entry.specifier} export ${exportName}.`);
        }
      }
    }
  }
}

module.exports = {
  createPeerRuntimePlan,
  verifyPeerRuntime,
  writeBundleEntry,
  writePeerRuntimeShims
};
