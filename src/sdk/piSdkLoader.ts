import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export type PiSdkModule = typeof import('@earendil-works/pi-coding-agent');
export type PiSdkLoader = () => Promise<PiSdkModule>;

type ESMImport = (specifier: string) => Promise<PiSdkModule>;

const importEsm = new Function('specifier', 'return import(specifier);') as ESMImport;
// The bundle lives inside the packaged runtime so Pi's getPackageDir() walk-up finds
// resources/pi-sdk-runtime/package.json without any PI_PACKAGE_DIR process-wide override.
// Do not mutate PI_PACKAGE_DIR; standalone Pi invocations retain the host override.
const bundledSdkPath = path.resolve(__dirname, '..', '..', 'resources', 'pi-sdk-runtime', 'sdk', 'piSdkBundle.mjs');
let piSdkModulePromise: Promise<PiSdkModule> | undefined;

export function loadPiSdk(): Promise<PiSdkModule> {
  piSdkModulePromise ??= importEsm(pathToFileURL(bundledSdkPath).href).catch((error) => {
    piSdkModulePromise = undefined;
    throw error;
  });
  return piSdkModulePromise;
}

export function resetPiSdkLoaderForTests(): void {
  piSdkModulePromise = undefined;
}
