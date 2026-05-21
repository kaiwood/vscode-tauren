export type PiSdkModule = typeof import('@earendil-works/pi-coding-agent');
export type PiSdkLoader = () => Promise<PiSdkModule>;

type ESMImport = (specifier: string) => Promise<PiSdkModule>;

const importEsm = new Function('specifier', 'return import(specifier);') as ESMImport;
let piSdkModulePromise: Promise<PiSdkModule> | undefined;

export function loadPiSdk(): Promise<PiSdkModule> {
  piSdkModulePromise ??= importEsm('@earendil-works/pi-coding-agent');
  return piSdkModulePromise;
}

export function resetPiSdkLoaderForTests(): void {
  piSdkModulePromise = undefined;
}
