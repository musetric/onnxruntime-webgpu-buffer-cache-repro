import { TraceSnapshot } from './gpuTrace';
import { ReproResult } from './repro';

export const formatBytes = (bytes: number): string => {
  const mib = bytes / 1024 / 1024;
  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(2)} GB`;
  }

  return `${mib.toFixed(0)} MB`;
};

export const formatMs = (ms: number): string => `${ms.toFixed(0)} ms`;

export const formatPercentDelta = (before: number, after: number): string => {
  if (before === 0) {
    return 'n/a';
  }

  return `${(((after - before) / before) * 100).toFixed(1)}%`;
};

export const topHistogramRows = (
  trace: TraceSnapshot,
  limit = 12,
): Array<{ size: string; count: number; bytes: string }> =>
  trace.peakHistogram
    .slice()
    .sort((a, b) => b[0] * b[1] - a[0] * a[1])
    .slice(0, limit)
    .map(([size, count]) => ({
      size: formatBytes(size),
      count,
      bytes: formatBytes(size * count),
    }));

export const serializeResult = (result: ReproResult): string =>
  JSON.stringify(
    {
      mode: result.mode.id,
      run1Ms: Math.round(result.run1Ms),
      run2Ms: Math.round(result.run2Ms),
      trace: {
        peakLiveBytes: result.trace.peakLiveBytes,
        peakLiveCount: result.trace.peakLiveCount,
        totalAllocationsBytes: result.trace.totalAllocationsBytes,
        totalAllocationsCount: result.trace.totalAllocationsCount,
        submitCount: result.trace.submitCount,
        phases: result.trace.phases,
        peakHistogram: result.trace.peakHistogram,
      },
      environment: result.environment,
    },
    null,
    2,
  );
