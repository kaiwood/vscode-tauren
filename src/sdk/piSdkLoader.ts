import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export type PiSdkModule = typeof import('@earendil-works/pi-coding-agent');
export type PiSdkLoader = () => Promise<PiSdkModule>;

type ESMImport = (specifier: string) => Promise<PiSdkModule>;

const importEsm = new Function('specifier', 'return import(specifier);') as ESMImport;
const bundledSdkPath = path.join(__dirname, 'piSdkBundle.mjs');
const bundledSdkPackageDir = path.resolve(__dirname, '..', '..', 'resources', 'pi-sdk-runtime');
let piSdkModulePromise: Promise<PiSdkModule> | undefined;

export function loadPiSdk(): Promise<PiSdkModule> {
  process.env.PI_PACKAGE_DIR ??= bundledSdkPackageDir;
  piSdkModulePromise ??= importEsm(pathToFileURL(bundledSdkPath).href);
  return piSdkModulePromise;
}

export function resetPiSdkLoaderForTests(): void {
  piSdkModulePromise = undefined;
}
