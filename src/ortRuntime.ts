import type * as ort from 'onnxruntime-web/webgpu';

export type OrtModule = typeof ort;

export type RuntimeMode = {
  id: 'official-bucket' | 'patched-simple';
  title: string;
  shortTitle: string;
  description: string;
  providerOptions: Record<string, unknown>;
  load: () => Promise<OrtModule>;
};

const ORT_VERSION = '1.26.0';
const WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

const configureOrt = (ort: OrtModule): OrtModule => {
  ort.env.logLevel = 'error';
  ort.env.wasm.wasmPaths = WASM_PATHS;
  return ort;
};

const loadPublicOrt = async (
  directory: 'ort-original' | 'ort-patched',
  cacheKey: string,
): Promise<OrtModule> => {
  const baseUrl = import.meta.env.BASE_URL;
  const moduleUrl = `${baseUrl}${directory}/ort.webgpu.min.mjs`;
  const ortModule = (await import(
    /* @vite-ignore */ `${moduleUrl}?v=${ORT_VERSION}-${cacheKey}`
  )) as OrtModule;

  return configureOrt(ortModule);
};

export const runtimeModes: RuntimeMode[] = [
  {
    id: 'official-bucket',
    title: 'Official onnxruntime-web 1.26.0, default bucket cache',
    shortTitle: 'Official bucket',
    description:
      'Uses the original ort.webgpu.min.mjs bundle with no storageBufferCacheMode option.',
    providerOptions: { name: 'webgpu' },
    load: () => loadPublicOrt('ort-original', 'original'),
  },
  {
    id: 'patched-simple',
    title: 'Patched onnxruntime-web 1.26.0, storageBufferCacheMode simple',
    shortTitle: 'Patched simple',
    description:
      'Uses the same ort.webgpu.min.mjs bundle with JS forwarding patched in, then requests exact-size storage buffer reuse.',
    providerOptions: { name: 'webgpu', storageBufferCacheMode: 'simple' },
    load: () => loadPublicOrt('ort-patched', 'storage-cache-mode'),
  },
];
