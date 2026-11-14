import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageName = '@earendil-works/pi-coding-agent';

/** Stable patches may differ; prerelease SDKs must match exactly. */
function compatible(actual: string, expected: string): boolean {
  const stable = /^(\d+)\.(\d+)\.(\d+)$/;
  const a = stable.exec(actual), b = stable.exec(expected);
  return a && b ? a[1] === b[1] && a[2] === b[2] : actual === expected;
}

/** Resolve the sandbox's installed Pi through its public CLI on PATH, following
 * npm's executable symlink to its owning package. Do not invoke the CLI, use the
 * host's npm configuration, or fall back to a second server-owned SDK runtime.
 */
async function installedPi(): Promise<{ directory: string; metadata: Record<string, unknown> }> {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const executable = path.resolve(directory, 'pi');
    try { await access(executable, constants.X_OK); } catch { continue; }
    let current = path.dirname(await realpath(executable));
    while (true) {
      try {
        const metadata = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')) as Record<string, unknown>;
        if (metadata.name === packageName) return { directory: current, metadata };
      } catch { /* Executable ancestors need not all contain package manifests. */ }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    // PATH's first Pi is authoritative. A wrapper/binary with no public SDK is
    // incompatible rather than permission to silently load a different install.
    throw new Error('The pi executable on PATH must belong to an installed @earendil-works/pi-coding-agent package with a public SDK export');
  }
  throw new Error('No installed Pi harness found: put its pi executable on the sandbox PATH');
}

/** Load the public SDK export from that same installation. Its assets, Jiti and
 * extension peer imports retain their original package layout and module identity.
 */
async function loadSandboxPi(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const ownPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { sandboxPiSdkVersion: string };
  const installed = await installedPi();
  const version = installed.metadata.version;
  if (typeof version !== 'string' || !compatible(version, ownPackage.sandboxPiSdkVersion)) {
    throw new Error(`Sandbox Pi SDK ${String(version)} is incompatible with server SDK ${ownPackage.sandboxPiSdkVersion}`);
  }
  const exports = installed.metadata.exports as Record<string, unknown> | undefined;
  const root = exports?.['.'];
  const entry = typeof root === 'string' ? root : root && typeof root === 'object'
    ? (root as Record<string, unknown>).import : undefined;
  if (typeof entry !== 'string' || !entry.startsWith('./')) {
    throw new Error('Installed Pi package does not expose a supported public SDK import');
  }
  const resolved = path.resolve(installed.directory, entry);
  if (!resolved.startsWith(installed.directory + path.sep)) throw new Error('Invalid installed Pi SDK export path');
  // Keep the import dynamic: packaging must not pull the installed SDK into the
  // server bundle. Console redirection in main.ts precedes this module's load.
  const sdk = await import(pathToFileURL(resolved).href) as typeof import('@earendil-works/pi-coding-agent');
  if (sdk.VERSION !== version) throw new Error('Installed Pi SDK export and package versions differ');
  return sdk;
}

// Explicit exports keep the production server's SDK dependency reviewable. This
// module replaces that import only in the packaged build, not local SDK tests.
const sdk = await loadSandboxPi();
export const { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  getAgentDir, SessionManager, SettingsManager, VERSION } = sdk;
