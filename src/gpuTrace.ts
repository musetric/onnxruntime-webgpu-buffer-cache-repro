type BufferRecord = {
  generation: number;
  size: number;
  alive: boolean;
};

export type PhaseSnapshot = {
  name: string;
  allocationsBytes: number;
  allocationsCount: number;
  liveBytesAtEnd: number;
};

export type TraceSnapshot = {
  peakLiveBytes: number;
  peakLiveCount: number;
  totalAllocationsBytes: number;
  totalAllocationsCount: number;
  submitCount: number;
  peakHistogram: Array<[number, number]>;
  phases: PhaseSnapshot[];
};

const cloneHistogram = (source: Map<number, number>): Array<[number, number]> =>
  Array.from(source.entries()).sort((a, b) => b[0] - a[0]);

export class GpuTrace {
  private generation = 0;
  private currentLiveBytes = 0;
  private currentLiveCount = 0;
  private peakLiveBytes = 0;
  private peakLiveCount = 0;
  private totalAllocationsBytes = 0;
  private totalAllocationsCount = 0;
  private submitCount = 0;
  private phaseName: string | null = null;
  private phaseAllocationsBytes = 0;
  private phaseAllocationsCount = 0;
  private phases: PhaseSnapshot[] = [];
  private liveBySize = new Map<number, number>();
  private peakHistogram: Array<[number, number]> = [];
  private records = new WeakMap<GPUBuffer, BufferRecord>();

  reset(): void {
    this.generation += 1;
    this.currentLiveBytes = 0;
    this.currentLiveCount = 0;
    this.peakLiveBytes = 0;
    this.peakLiveCount = 0;
    this.totalAllocationsBytes = 0;
    this.totalAllocationsCount = 0;
    this.submitCount = 0;
    this.phaseName = null;
    this.phaseAllocationsBytes = 0;
    this.phaseAllocationsCount = 0;
    this.phases = [];
    this.liveBySize = new Map();
    this.peakHistogram = [];
  }

  beginPhase(name: string): void {
    this.endPhase();
    this.phaseName = name;
    this.phaseAllocationsBytes = 0;
    this.phaseAllocationsCount = 0;
  }

  endPhase(): void {
    if (!this.phaseName) {
      return;
    }

    this.phases.push({
      name: this.phaseName,
      allocationsBytes: this.phaseAllocationsBytes,
      allocationsCount: this.phaseAllocationsCount,
      liveBytesAtEnd: this.currentLiveBytes,
    });
    this.phaseName = null;
    this.phaseAllocationsBytes = 0;
    this.phaseAllocationsCount = 0;
  }

  recordCreate(buffer: GPUBuffer, size: number): void {
    this.records.set(buffer, {
      generation: this.generation,
      size,
      alive: true,
    });

    this.currentLiveBytes += size;
    this.currentLiveCount += 1;
    this.totalAllocationsBytes += size;
    this.totalAllocationsCount += 1;
    this.liveBySize.set(size, (this.liveBySize.get(size) ?? 0) + 1);

    if (this.phaseName) {
      this.phaseAllocationsBytes += size;
      this.phaseAllocationsCount += 1;
    }

    if (this.currentLiveBytes > this.peakLiveBytes) {
      this.peakLiveBytes = this.currentLiveBytes;
      this.peakLiveCount = this.currentLiveCount;
      this.peakHistogram = cloneHistogram(this.liveBySize);
    }
  }

  recordDestroy(buffer: GPUBuffer): void {
    const record = this.records.get(buffer);
    if (!record || !record.alive || record.generation !== this.generation) {
      return;
    }

    record.alive = false;
    this.currentLiveBytes -= record.size;
    this.currentLiveCount -= 1;

    const liveCount = this.liveBySize.get(record.size);
    if (liveCount === 1) {
      this.liveBySize.delete(record.size);
    } else if (liveCount) {
      this.liveBySize.set(record.size, liveCount - 1);
    }
  }

  recordSubmit(): void {
    this.submitCount += 1;
  }

  snapshot(): TraceSnapshot {
    this.endPhase();
    return {
      peakLiveBytes: this.peakLiveBytes,
      peakLiveCount: this.peakLiveCount,
      totalAllocationsBytes: this.totalAllocationsBytes,
      totalAllocationsCount: this.totalAllocationsCount,
      submitCount: this.submitCount,
      peakHistogram: [...this.peakHistogram],
      phases: [...this.phases],
    };
  }
}

let installedTrace: GpuTrace | null = null;

export const installGpuTrace = (): GpuTrace => {
  if (installedTrace) {
    installedTrace.reset();
    return installedTrace;
  }

  if (!('GPUDevice' in globalThis) || !('GPUBuffer' in globalThis)) {
    throw new Error('WebGPU classes are not available in this browser.');
  }

  const trace = new GpuTrace();
  const originalCreateBuffer = GPUDevice.prototype.createBuffer;
  const originalDestroy = GPUBuffer.prototype.destroy;
  const originalSubmit = GPUQueue.prototype.submit;

  GPUDevice.prototype.createBuffer = function createBufferWithTrace(
    descriptor: GPUBufferDescriptor,
  ): GPUBuffer {
    const buffer = originalCreateBuffer.call(this, descriptor);
    trace.recordCreate(buffer, Number(descriptor.size));
    return buffer;
  };

  GPUBuffer.prototype.destroy = function destroyWithTrace(): undefined {
    trace.recordDestroy(this);
    return originalDestroy.call(this);
  };

  GPUQueue.prototype.submit = function submitWithTrace(
    commandBuffers: Iterable<GPUCommandBuffer>,
  ): undefined {
    trace.recordSubmit();
    return originalSubmit.call(this, commandBuffers);
  };

  installedTrace = trace;
  return trace;
};
