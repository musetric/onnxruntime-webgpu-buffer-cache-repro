import {
  INPUT_BYTES,
  INPUT_NAME,
  INPUT_SHAPE,
  MODEL_DATA_FILE,
  MODEL_FILE,
  MODEL_REPO,
  OUTPUT_NAME,
  OUTPUT_SHAPE,
  createInputData,
} from './model';
import { ProgressCallback, loadModelFiles } from './download';
import { GpuTrace, TraceSnapshot, installGpuTrace } from './gpuTrace';
import { RuntimeMode } from './ortRuntime';

export type ReproLog = (line: string) => void;

export type ReproResult = {
  mode: RuntimeMode;
  environment: Record<string, string>;
  run1Ms: number;
  run2Ms: number;
  trace: TraceSnapshot;
};

const now = (): number => performance.now();

let adapterPromise: Promise<GPUAdapter | null> | null = null;

const getAdapter = (): Promise<GPUAdapter | null> => {
  adapterPromise ??= navigator.gpu?.requestAdapter() ?? Promise.resolve(null);
  return adapterPromise;
};

const getEnvironment = async (): Promise<Record<string, string>> => {
  const adapter = await getAdapter();
  const adapterWithInfo = adapter as
    | (GPUAdapter & {
        info?: GPUAdapterInfo;
        requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
      })
    | null;
  const adapterInfo =
    (await adapterWithInfo?.requestAdapterInfo?.()) ?? adapterWithInfo?.info ?? null;

  return {
    browser: navigator.userAgent,
    gpuVendor: adapterInfo?.vendor || 'unknown',
    gpuArchitecture: adapterInfo?.architecture || 'unknown',
    gpuDevice: adapterInfo?.device || 'unknown',
    gpuDescription: adapterInfo?.description || 'unknown',
    model: `${MODEL_REPO}/${MODEL_FILE}`,
  };
};

const finishGpuWork = async (ortDevice: GPUDevice | undefined): Promise<void> => {
  await ortDevice?.queue.onSubmittedWorkDone().catch(() => undefined);
};

const runSession = async (
  mode: RuntimeMode,
  trace: GpuTrace,
  log: ReproLog,
  onProgress: ProgressCallback,
): Promise<{ run1Ms: number; run2Ms: number }> => {
  const ort = await mode.load();
  const adapter = await getAdapter();
  if (!adapter) {
    throw new Error('Failed to get a WebGPU adapter.');
  }

  (ort.env.webgpu as { adapter?: GPUAdapter }).adapter = adapter;
  const modelFiles = await loadModelFiles(onProgress);

  log(`Creating session: ${mode.shortTitle}`);
  onProgress({ phase: `Creating session: ${mode.shortTitle}` });
  trace.beginPhase('session create');
  const session = await ort.InferenceSession.create(modelFiles.model, {
    executionProviders: [mode.providerOptions as never],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    preferredOutputLocation: { [OUTPUT_NAME]: 'gpu-buffer' },
    externalData: [{ path: MODEL_DATA_FILE, data: modelFiles.data }],
  });
  trace.endPhase();

  const device = await ort.env.webgpu.device;
  if (!device) {
    throw new Error('ORT did not expose a WebGPU device.');
  }

  const inputData = createInputData();
  const inputBuffer = device.createBuffer({
    size: INPUT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(inputBuffer, 0, inputData);

  const inputTensor = ort.Tensor.fromGpuBuffer(inputBuffer, {
    dataType: 'float32',
    dims: [...INPUT_SHAPE],
  });

  const execute = async (phaseName: string): Promise<number> => {
    trace.beginPhase(phaseName);
    const startedAt = now();
    const outputs = await session.run({
      [INPUT_NAME]: inputTensor,
    });
    const elapsedMs = now() - startedAt;
    trace.endPhase();

    const output = outputs[OUTPUT_NAME];
    if (!output) {
      throw new Error(`Missing output tensor "${OUTPUT_NAME}".`);
    }
    if (output.location !== 'gpu-buffer') {
      throw new Error(`Expected gpu-buffer output, got "${output.location}".`);
    }
    output.dispose();

    await finishGpuWork(device);
    return elapsedMs;
  };

  log('Running inference 1/2');
  onProgress({ phase: `Running inference 1/2: ${mode.shortTitle}` });
  const run1Ms = await execute('run 1');
  log('Running inference 2/2');
  onProgress({ phase: `Running inference 2/2: ${mode.shortTitle}` });
  const run2Ms = await execute('run 2');

  inputBuffer.destroy();
  await session.release();
  await finishGpuWork(device);

  return { run1Ms, run2Ms };
};

export const runReproMode = async (
  mode: RuntimeMode,
  log: ReproLog,
  onProgress: ProgressCallback,
): Promise<ReproResult> => {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available. Use Chrome/Edge with WebGPU enabled.');
  }

  const trace = installGpuTrace();
  trace.reset();

  log(`Mode: ${mode.title}`);
  log(`Input: ${INPUT_NAME} ${JSON.stringify(INPUT_SHAPE)}`);
  log(`Output: ${OUTPUT_NAME} ${JSON.stringify(OUTPUT_SHAPE)}`);

  const environment = await getEnvironment();
  const { run1Ms, run2Ms } = await runSession(mode, trace, log, onProgress);
  const snapshot = trace.snapshot();

  return {
    mode,
    environment,
    run1Ms,
    run2Ms,
    trace: snapshot,
  };
};
