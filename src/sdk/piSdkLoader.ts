import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export type PiSdkModule = typeof import('@earendil-works/pi-coding-agent');
export type PiSdkLoader = () => Promise<PiSdkModule>;

type ESMImport = (specifier: string) => Promise<PiSdkModule>;

const importEsm = new Function('specifier', 'return import(specifier);') as ESMImport;
const bundledSdkPath = path.join(__dirname, 'piSdkBundle.mjs');
const bundledSdkPackageDir = path.resolve(__dirname, '..', '..', 'resources', 'pi-sdk-runtime');
let piSdkModulePromise: Promise<PiSdkModule> | undefined;

function setBundledSdkPackageDir(): void {
  // The bundled Pi SDK resolves package assets through process.env.PI_PACKAGE_DIR.
  // This is an intentional process-wide side effect, isolated to SDK loading and
  // applied before import so Pi reads Tauren's packaged runtime assets.
  process.env.PI_PACKAGE_DIR = bundledSdkPackageDir;
}

export function loadPiSdk(): Promise<PiSdkModule> {
  setBundledSdkPackageDir();
  piSdkModulePromise ??= importEsm(pathToFileURL(bundledSdkPath).href).catch((error) => {
    piSdkModulePromise = undefined;
    throw error;
  });
  return piSdkModulePromise;
}

export function resetPiSdkLoaderForTests(): void {
  piSdkModulePromise = undefined;
}
