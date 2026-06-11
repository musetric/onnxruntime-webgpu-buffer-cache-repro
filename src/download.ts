import {
  MODEL_DATA_FILE,
  MODEL_DATA_URL,
  MODEL_FILE,
  MODEL_URL,
} from './model';

export type DownloadProgress = {
  phase: string;
  loadedBytes?: number;
  totalBytes?: number;
};

export type ModelFiles = {
  model: Uint8Array<ArrayBuffer>;
  data: Uint8Array<ArrayBuffer>;
};

export type ProgressCallback = (progress: DownloadProgress) => void;

const MODEL_CACHE_NAME = 'musetric-roformer-model-v1';

let cachedModelFiles: Promise<ModelFiles> | null = null;

const concatChunks = (
  chunks: Uint8Array<ArrayBuffer>[],
  totalBytes: number,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

const fetchBytes = async (
  url: string,
  label: string,
  onProgress: ProgressCallback,
): Promise<Uint8Array<ArrayBuffer>> => {
  const cache = 'caches' in globalThis ? await caches.open(MODEL_CACHE_NAME) : null;
  const cachedResponse = await cache?.match(url);
  if (cachedResponse) {
    onProgress({ phase: `Loading cached ${label}` });
    const buffer = await cachedResponse.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    onProgress({
      phase: `Loaded cached ${label}`,
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    return bytes;
  }

  onProgress({ phase: `Downloading ${label}`, loadedBytes: 0 });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${label}: ${response.status} ${response.statusText}`);
  }

  const responseForCache = response.clone();
  const totalBytesHeader = response.headers.get('content-length');
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : undefined;

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    onProgress({
      phase: `Downloaded ${label}`,
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    await cache?.put(url, responseForCache);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const preallocated = totalBytes ? new Uint8Array(totalBytes) : null;
  let loadedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (preallocated) {
      preallocated.set(value, loadedBytes);
    } else {
      const chunk = new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      );
      chunks.push(chunk);
    }
    loadedBytes += value.byteLength;
    onProgress({ phase: `Downloading ${label}`, loadedBytes, totalBytes });
  }

  onProgress({
    phase: `Downloaded ${label}`,
    loadedBytes,
    totalBytes: totalBytes ?? loadedBytes,
  });
  await cache?.put(url, responseForCache);
  if (preallocated) {
    return loadedBytes === preallocated.byteLength
      ? preallocated
      : preallocated.slice(0, loadedBytes);
  }

  return concatChunks(chunks, loadedBytes);
};

export const loadModelFiles = (
  onProgress: ProgressCallback,
): Promise<ModelFiles> => {
  if (!cachedModelFiles) {
    cachedModelFiles = (async () => {
      const model = await fetchBytes(MODEL_URL, MODEL_FILE, onProgress);
      const data = await fetchBytes(MODEL_DATA_URL, MODEL_DATA_FILE, onProgress);
      onProgress({
        phase: 'Model files ready',
        loadedBytes: model.byteLength + data.byteLength,
        totalBytes: model.byteLength + data.byteLength,
      });
      return { model, data };
    })();
  } else {
    onProgress({ phase: 'Using cached model files' });
  }

  return cachedModelFiles;
};
