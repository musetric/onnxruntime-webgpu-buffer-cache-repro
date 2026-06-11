import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const originalDist = join(root, 'public', 'ort-original');
const patchedDist = join(root, 'public', 'ort-patched');
const sourceFile = join(packageDist, 'ort.webgpu.min.mjs');
const sourceMapFile = join(packageDist, 'ort.webgpu.min.mjs.map');
const bundleFileName = 'ort.webgpu.min.mjs';
const mapFileName = 'ort.webgpu.min.mjs.map';

const copyBundle = (targetDir) => {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourceFile, join(targetDir, bundleFileName));

  try {
    copyFileSync(sourceMapFile, join(targetDir, mapFileName));
  } catch {
    // Source maps are optional for the repro page.
  }
};

copyBundle(originalDist);
copyBundle(patchedDist);

const patchedFile = join(patchedDist, bundleFileName);
let bundle = readFileSync(patchedFile, 'utf8');

const validationModePattern =
  /([A-Za-z_$][\w$]*\.validationMode&&[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,"validationMode",[A-Za-z_$][\w$]*\.validationMode,[A-Za-z_$][\w$]*\))/;
const match = bundle.match(validationModePattern);

if (!match) {
  throw new Error('Could not find validationMode forwarding in ort.webgpu.min.mjs.');
}

const validationForwarding = match[1];
const optionObject = validationForwarding.match(/^([A-Za-z_$][\w$]*)\./)?.[1];
const appendFn = validationForwarding.match(/&&([A-Za-z_$][\w$]*)\(/)?.[1];
const epOptions = validationForwarding.match(/\(([A-Za-z_$][\w$]*),/)?.[1];
const allocs = validationForwarding.match(/,([A-Za-z_$][\w$]*)\)$/)?.[1];

if (!optionObject || !appendFn || !epOptions || !allocs) {
  throw new Error('Could not parse validationMode forwarding identifiers.');
}

const cacheModeForwarding = [
  'storageBufferCacheMode',
  'uniformBufferCacheMode',
  'queryResolveBufferCacheMode',
  'defaultBufferCacheMode',
]
  .map(
    (key) =>
      `${optionObject}.${key}&&${appendFn}(${epOptions},"${key}",${optionObject}.${key},${allocs})`,
  )
  .join(',');

bundle = bundle.replace(validationForwarding, `${validationForwarding},${cacheModeForwarding}`);
writeFileSync(patchedFile, bundle);

console.log('Prepared original ONNX Runtime WebGPU bundle:', join(originalDist, bundleFileName));
console.log('Prepared patched ONNX Runtime WebGPU bundle:', patchedFile);
