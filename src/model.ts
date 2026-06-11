export const MODEL_REPO =
  'https://huggingface.co/musetric/vocal-separation-roformer-onnx';
export const MODEL_REVISION = 'main';
export const MODEL_FILE = 'syhft_core_folded_fp16_webgpu.onnx';
export const MODEL_DATA_FILE = 'syhft_core_folded_fp16_webgpu.onnx.data';
export const MODEL_URL = `${MODEL_REPO}/resolve/${MODEL_REVISION}/${MODEL_FILE}`;
export const MODEL_DATA_URL = `${MODEL_REPO}/resolve/${MODEL_REVISION}/${MODEL_DATA_FILE}`;

export const INPUT_NAME = 'stft_repr';
export const OUTPUT_NAME = 'masks';
export const INPUT_SHAPE = [1, 2050, 1101, 2] as const;
export const OUTPUT_SHAPE = [1, 2050, 1101, 2] as const;
export const INPUT_FLOATS = 1 * 2050 * 1101 * 2;
export const INPUT_BYTES = INPUT_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const createInputData = (): Float32Array<ArrayBuffer> => {
  const data = new Float32Array(new ArrayBuffer(INPUT_BYTES));
  let seed = 0x4d555345;

  for (let index = 0; index < data.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    data[index] = (seed / 0xffffffff) * 2 - 1;
  }

  return data;
};
