import './styles.css';
import {
  formatBytes,
  formatMs,
  formatPercentDelta,
  topHistogramRows,
} from './format';
import { DownloadProgress } from './download';
import { ReproResult, runReproMode } from './repro';
import { RuntimeMode, runtimeModes } from './ortRuntime';

type AppState = {
  running: boolean;
  logs: string[];
  results: ReproResult[];
  progress: DownloadProgress | null;
  activeTab: 'log' | 'official' | 'patched';
  error: string | null;
};

const state: AppState = {
  running: false,
  logs: [],
  results: [],
  progress: null,
  activeTab: 'log',
  error: null,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app element.');
}

const appendLog = (line: string): void => {
  const timestamp = new Date().toLocaleTimeString();
  state.logs = [...state.logs, `[${timestamp}] ${line}`];
  render();
};

const updateProgress = (progress: DownloadProgress): void => {
  state.progress = progress;
  render();
};

const runModes = async (modes: RuntimeMode[]): Promise<void> => {
  if (state.running) {
    return;
  }

  state.running = true;
  state.logs = [];
  state.results = [];
  state.progress = { phase: 'Starting' };
  state.error = null;
  render();

  try {
    for (const mode of modes) {
      const result = await runReproMode(mode, appendLog, updateProgress);
      state.results = [...state.results, result];
      appendLog(`Done: ${mode.shortTitle}`);
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    state.progress = state.error ? state.progress : { phase: 'Done' };
    render();
  }
};

const renderProgress = (): string => {
  const progress = state.progress;
  if (!progress) {
    return '<div class="progress-empty">Ready</div>';
  }

  const amount =
    progress.loadedBytes !== undefined
      ? progress.totalBytes
        ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
        : formatBytes(progress.loadedBytes)
      : '';

  return `
    <div class="progress-line">
      <div>
        <strong>${progress.phase}</strong>
        ${amount ? `<span>${amount}</span>` : ''}
      </div>
    </div>
  `;
};

const getWeightsBytes = (result: ReproResult): number =>
  result.trace.phases.find((item) => item.name === 'session create')
    ?.liveBytesAtEnd ?? 0;

const renderSummaryRows = (): string => {
  const official = state.results.find((result) => result.mode.id === 'official-bucket');
  const patched = state.results.find((result) => result.mode.id === 'patched-simple');

  return state.results
    .map((result) => {
      const run1Phase = result.trace.phases.find((item) => item.name === 'run 1');
      const run2Phase = result.trace.phases.find((item) => item.name === 'run 2');
      const peakDelta =
        official && patched && result.mode.id === patched.mode.id
          ? formatPercentDelta(official.trace.peakLiveBytes, patched.trace.peakLiveBytes)
          : '';

      return `
        <tr>
          <td>${result.mode.shortTitle}</td>
          <td>${formatBytes(getWeightsBytes(result))}</td>
          <td>${formatBytes(result.trace.peakLiveBytes)} ${peakDelta ? `(${peakDelta})` : ''}</td>
          <td>${run1Phase ? formatBytes(run1Phase.allocationsBytes) : 'n/a'}</td>
          <td>${formatMs(result.run1Ms)}</td>
          <td>${run2Phase ? formatBytes(run2Phase.allocationsBytes) : 'n/a'}</td>
          <td>${formatMs(result.run2Ms)}</td>
          <td>${result.trace.submitCount}</td>
        </tr>
      `;
    })
    .join('');
};

const renderRunDetails = (result: ReproResult | undefined): string => {
  if (!result) {
    return '<p class="empty-state">No run yet.</p>';
  }

  const histogramRows = topHistogramRows(result.trace)
    .map(
      (row) => `
        <tr>
          <td>${row.size}</td>
          <td>${row.count}</td>
          <td>${row.bytes}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <table>
      <thead>
        <tr><th>Buffer size</th><th>Count</th><th>Total</th></tr>
      </thead>
      <tbody>${histogramRows}</tbody>
    </table>
  `;
};

const renderTabs = (): string => {
  const official = state.results.find((result) => result.mode.id === 'official-bucket');
  const patched = state.results.find((result) => result.mode.id === 'patched-simple');
  const content =
    state.activeTab === 'log'
      ? `<pre class="log">${state.logs.join('\n') || 'Idle.'}</pre>`
      : state.activeTab === 'official'
        ? renderRunDetails(official)
        : renderRunDetails(patched);

  return `
    <section class="section tabs-panel">
      <div class="tabs" role="tablist" aria-label="Run details">
        <button class="tab ${state.activeTab === 'log' ? 'active' : ''}" data-tab="log" role="tab" aria-selected="${state.activeTab === 'log'}">Log</button>
        <button class="tab ${state.activeTab === 'official' ? 'active' : ''}" data-tab="official" role="tab" aria-selected="${state.activeTab === 'official'}">Bucket memory</button>
        <button class="tab ${state.activeTab === 'patched' ? 'active' : ''}" data-tab="patched" role="tab" aria-selected="${state.activeTab === 'patched'}">Simple memory</button>
      </div>
      <div class="tab-content">
        ${content}
      </div>
    </section>
  `;
};

const render = (): void => {
  app.innerHTML = `
    <main>
      <header>
        <div>
          <h1>WebGPU buffer cache repro</h1>
          <p class="lead">
            Compare official ONNX Runtime WebGPU bucket cache against patched storageBufferCacheMode: simple.
            <span class="metadata-line">
              Model:
              <a href="https://huggingface.co/musetric/vocal-separation-roformer-onnx" target="_blank" rel="noreferrer">Musetric RoFormer vocal separation</a>
            </span>
            <span class="metadata-line">
              Repository:
              <a href="https://github.com/musetric/onnxruntime-webgpu-buffer-cache-repro" target="_blank" rel="noreferrer">musetric/onnxruntime-webgpu-buffer-cache-repro</a>
            </span>
            <span class="metadata-line">
              Upstream:
              <a href="https://github.com/microsoft/onnxruntime/issues/29016" target="_blank" rel="noreferrer">issue #29016</a>
              /
              <a href="https://github.com/microsoft/onnxruntime/pull/29017" target="_blank" rel="noreferrer">PR #29017</a>
            </span>
          </p>
        </div>
      </header>

      <section class="run-panel">
        <div class="actions">
          <button ${state.running ? 'disabled' : ''} data-action="run-both">Run both</button>
          <button ${state.running ? 'disabled' : ''} data-action="run-official">Run bucket</button>
          <button ${state.running ? 'disabled' : ''} data-action="run-patched">Run simple</button>
        </div>
        <div>
          ${renderProgress()}
        </div>
      </section>

      ${
        state.error
          ? `<section class="error"><h2>Error</h2><pre>${state.error}</pre></section>`
          : ''
      }

      <section class="results-section">
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Weights</th>
              <th>Peak live</th>
              <th>Run 1 allocations</th>
              <th>Run 1 latency</th>
              <th>Run 2 allocations</th>
              <th>Run 2 latency</th>
              <th>Submits</th>
            </tr>
          </thead>
          <tbody>
            ${
              state.results.length
                ? renderSummaryRows()
                : '<tr><td colspan="8">No results yet.</td></tr>'
            }
          </tbody>
        </table>
      </section>

      ${renderTabs()}
    </main>
  `;

  app.querySelector('[data-action="run-both"]')?.addEventListener('click', () => {
    void runModes(runtimeModes);
  });
  app
    .querySelector('[data-action="run-official"]')
    ?.addEventListener('click', () => {
      void runModes([runtimeModes[0]]);
    });
  app
    .querySelector('[data-action="run-patched"]')
    ?.addEventListener('click', () => {
      void runModes([runtimeModes[1]]);
    });
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab as AppState['activeTab'];
      render();
    });
  });
};

render();
