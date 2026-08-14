/**
 * Analysis clock.
 *
 * Anything that reads an AnalyserNode has to run on the main thread, but it must not be
 * *scheduled* by the main thread's display loop. `requestAnimationFrame` stops entirely when
 * the page is hidden (measured: 0 callbacks per second), and `setInterval` is throttled to
 * roughly 1–2 per second in a background tab. Either one means a resynthesis module goes
 * silent, or stutters badly, the moment the window is minimized — while the synth it is
 * listening to keeps playing.
 *
 * So the clock comes from the audio thread instead, which is never throttled by page
 * visibility. This processor emits nothing but silence; its only job is to post a message
 * every `every` render quanta. At 128 samples per quantum and 48 kHz, `every: 4` is a tick
 * roughly every 10.7 ms — comfortably faster than the ~60 Hz the display loop used to give.
 *
 * It keeps one silent output channel because a node with no outputs cannot be connected into
 * the render graph, and a node outside the graph is never pulled.
 */
const tickerSource = `
class AnalysisTicker extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.every = Math.max(1, opts.every || 4);
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this.alive = false;
    };
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0] && outputs[0][0];
    if (out) out.fill(0);
    if (++this.count >= this.every) {
      this.count = 0;
      this.port.postMessage(0);
    }
    return true;
  }
}
registerProcessor('analysis-ticker', AnalysisTicker);
`;

let tickerUrl: string | null = null;

export function getTickerWorkletUrl(): string {
  if (!tickerUrl) {
    tickerUrl = URL.createObjectURL(new Blob([tickerSource], { type: 'application/javascript' }));
  }
  return tickerUrl;
}
