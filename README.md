# ONNX Runtime WebGPU Buffer Cache Repro

Standalone repro for ONNX Runtime WebGPU buffer-cache VRAM overhead on the
Musetric RoFormer vocal-separation model.

The page compares two runs of the same static-shape model:

- `Official bucket`: `onnxruntime-web@1.26.0` with the default WebGPU EP storage
  buffer cache mode.
- `Patched simple`: the same `onnxruntime-web@1.26.0` browser bundle with JS
  forwarding for `storageBufferCacheMode`, then
  `storageBufferCacheMode: 'simple'`.

Both modes load `ort.webgpu.min.mjs` from `public/`: `ort-original/` is copied
unchanged from npm, and `ort-patched/` is the same file with only the option
forwarding patched in.

The model is not stored in this repository. It is downloaded from Hugging Face
after the user starts a run:

https://huggingface.co/musetric/vocal-separation-roformer-onnx

## What It Measures

The page wraps:

- `GPUDevice.prototype.createBuffer`
- `GPUBuffer.prototype.destroy`
- `GPUQueue.prototype.submit`

For each mode it reports:

- weights: bytes still resident after session create (model weights; identical
  in both modes, not affected by the cache option)
- peak live bytes visible through the WebGPU API (weights + transient buffers)
- live-buffer histogram at the peak
- new allocation bytes during session creation, run 1, and run 2
- run 1 and run 2 latency
- submit count

The model input is a deterministic random tensor with shape:

```text
stft_repr: [1, 2050, 1101, 2] float32
```

The output is requested as a GPU buffer:

```text
masks: [1, 2050, 1101, 2] float32
```

## Local Run

```bash
npm install
npm run dev
```

Open the local Vite URL in Chrome or Edge with WebGPU enabled.

The Hugging Face external data file is large, so the first session creation can
take a while. The page does not download the model until a run button is clicked.

## Build

```bash
npm run build
```

The build runs `scripts/prepare-ort-bundles.mjs`, which copies
`node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs` into two public folders:

- `public/ort-original/` unchanged
- `public/ort-patched/` with forwarding injected for:

- `storageBufferCacheMode`
- `uniformBufferCacheMode`
- `queryResolveBufferCacheMode`
- `defaultBufferCacheMode`

The generated `public/ort-original/` and `public/ort-patched/` directories are
intentionally ignored by Git.

## GitHub Pages

This repository includes `.github/workflows/pages.yml`. After pushing to
`main`, enable GitHub Pages with:

```text
Settings -> Pages -> Source: GitHub Actions
```

The Vite base path is configured for:

```text
/onnxruntime-webgpu-buffer-cache-repro/
```

## License

Code in this repository is MIT licensed. The repro model is published separately
by Musetric under MIT:

https://huggingface.co/musetric/vocal-separation-roformer-onnx
