import { cp, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));

/** Stage built fixture code and dereferenced runtime dependencies for a read-only
 * SBX workspace. This is test payload assembly, not production kit packaging.
 * Do not mount the checkout, host Node executable, or host node_modules symlinks.
 */
export async function stageSbxPayload(destination: string): Promise<void> {
  const server = path.join(destination, 'server');
  await mkdir(server, { recursive: true });
  await cp(path.join(project, 'dist'), path.join(server, 'dist'), { recursive: true });
  await cp(path.join(project, 'package.json'), path.join(server, 'package.json'));
  const modules = path.join(server, 'node_modules');
  await mkdir(modules, { recursive: true });
  for (const entry of await readdir(path.join(project, 'node_modules'))) {
    if (entry.startsWith('.')) continue;
    const source = path.join(project, 'node_modules', entry);
    if (entry.startsWith('@')) {
      await mkdir(path.join(modules, entry), { recursive: true });
      for (const name of await readdir(source)) await copyPackage(path.join(source, name), path.join(modules, entry, name));
    } else await copyPackage(source, path.join(modules, entry));
  }
}

/** Dereference local package links, omitting their development trees. External
 * packages retain runtime assets and nested dependencies required by the SDK.
 */
async function copyPackage(source: string, destination: string): Promise<void> {
  const resolved = await realpath(source);
  const manifest = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8')) as { name: string };
  if (manifest.name === '@tauren/shared') {
    await mkdir(destination, { recursive: true });
    await cp(path.join(resolved, 'package.json'), path.join(destination, 'package.json'));
    await cp(path.join(resolved, 'dist'), path.join(destination, 'dist'), { recursive: true });
    return;
  }
  if ((await lstat(resolved)).isDirectory()) await cp(resolved, destination, { recursive: true, dereference: true });
}
