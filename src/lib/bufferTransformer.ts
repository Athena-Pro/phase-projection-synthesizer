/**
 * Buffer transformer — a resynthesizer that listens to the synth and sings it back, but
 * reads its analysis buffer along a **diagonal** rather than straight across.
 *
 * The reference design (an STFT resynthesizer with an oscillator bank) keeps a ring of past
 * spectral frames and, now and then, misreads one: it plays a random frame from the past
 * instead of the present. That is a single scalar of chaos. The idea here is to make that
 * misreading *structured* and *per-band*.
 *
 * The spectrum is cut into `segments` contiguous frequency bands. Band s does not read the
 * current frame — it reads the frame `s · timeSkew` frames in the past, and it is processed
 * by method number `(s · methodSkew + methodOffset) mod M`. So the output spectrum is a
 * diagonal cut through the time–frequency plane:
 *
 *        freq ↑   ┌───────────────────────────────┐
 *   band 3 ──────▶│ ▓ method 3, 3·skew frames ago │
 *   band 2 ──────▶│ ▓ method 2, 2·skew frames ago │
 *   band 1 ──────▶│ ▓ method 1, 1·skew frames ago │
 *   band 0 ──────▶│ ▓ method 0, now               │
 *                 └───────────────────────────────┘  time →
 *
 * With `timeSkew` at 0 and `methodSkew` at 0 this is an ordinary resynthesizer. Turn the time
 * skew up and the bass is the present while the treble is half a second stale — a chord
 * smeared across its own history. Turn the method skew up and each band is additionally being
 * sieved, permuted, folded or blurred by a different operator, the assignment marching
 * diagonally up the spectrum.
 *
 * This module is deliberately independent of `SynthParams`: like the deci-core patcher, it is
 * a modular attachment with its own state rather than part of a patch. It analyses the
 * master bus and sings into the monitor bus, so it never feeds back into what it is listening
 * to.
 */

export const BUFFER_METHODS = [
  'pass',
  'sieve',
  'tilt',
  'perm',
  'fold',
  'freeze',
  'blur',
  'mirror',
] as const;

export type BufferMethod = (typeof BUFFER_METHODS)[number];

/** Human-readable one-liners, used for the panel's tooltips. */
export const BUFFER_METHOD_HINTS: Record<BufferMethod, string> = {
  pass: 'Untouched — the band is resynthesized as analysed',
  sieve: 'Congruence comb: bins sharing a factor with the modulus are notched out',
  tilt: 'p-adic tilt: bins divisible by high powers of p are pushed down',
  perm: 'Cyclotomic permutation: the band’s bins are reindexed by a primitive root',
  fold: 'Quotient downfold: bins wrap onto a short periodic grid and accumulate',
  freeze: 'Holds the oldest frame in the ring — a static spectral photograph',
  blur: 'Gaussian smear across neighbouring bins, softening spectral edges',
  mirror: 'The band is reversed, so its top and bottom trade places',
};

export interface BufferParams {
  enabled: boolean;
  /** Output level of the resynthesis. */
  mix: number;
  /** Analyser window. Larger = finer frequency resolution, smeared transients. */
  fftSize: number;
  /** Analyser time smoothing, 0..0.99. */
  smoothing: number;
  /** Sine oscillators in the resynthesis bank. */
  oscCount: number;
  /** 0 = logarithmic (musical), 1 = linear (FFT aligned). */
  distribution: number;
  /** Multiplies every oscillator frequency — a spectral, not temporal, transposition. */
  pitchShift: number;
  /** How many frequency bands the spectrum is cut into. */
  segments: number;
  /** Frames of extra lag per band — the diagonal's slope through time. */
  timeSkew: number;
  /** Steps through the method list per band — the diagonal's slope through the operators. */
  methodSkew: number;
  /** Rotates the whole method assignment. */
  methodOffset: number;
  /** Probability per frame of an extra random lag, the reference design's jitter. */
  jitter: number;
  /** Modulus of the sieve method. */
  sieveModulus: number;
  /** Period of the fold method. */
  foldPeriod: number;
  /** Bin radius of the blur method. */
  blurWidth: number;
}

export const DEFAULT_BUFFER_PARAMS: BufferParams = {
  enabled: false,
  mix: 0.6,
  fftSize: 4096,
  smoothing: 0.8,
  oscCount: 128,
  distribution: 0,
  pitchShift: 1,
  segments: 6,
  timeSkew: 4,
  methodSkew: 1,
  methodOffset: 0,
  jitter: 0,
  sieveModulus: 6,
  foldPeriod: 8,
  blurWidth: 2,
};

const MIN_FREQ = 40;
const MAX_FREQ = 12000;
const MAX_FRAMES = 192;

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Least primitive root of a prime, for the permutation method. */
function leastPrimitiveRoot(p: number): number {
  if (p < 3) return 1;
  const factors: number[] = [];
  let m = p - 1;
  for (let d = 2; d * d <= m; d++) {
    if (m % d === 0) {
      factors.push(d);
      while (m % d === 0) m = Math.floor(m / d);
    }
  }
  if (m > 1) factors.push(m);
  for (let g = 2; g < p; g++) {
    if (factors.every((f) => modPow(g, (p - 1) / f, p) !== 1)) return g;
  }
  return 2;
}

function modPow(base: number, exp: number, mod: number): number {
  let result = 1;
  let b = base % mod;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1;
  }
  return result;
}

function largestPrimeLE(n: number): number {
  for (let c = n; c >= 2; c--) {
    let prime = true;
    for (let d = 2; d * d <= c; d++) {
      if (c % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) return c;
  }
  return 2;
}

/**
 * Apply one method to a band of a magnitude frame, writing into `out[lo..hi)`.
 *
 * Everything here works on magnitudes only — that is what an AnalyserNode gives, and it is
 * enough for the operators that matter to this module (gating, reindexing, folding,
 * smearing). Phase-sensitive operators live in the additive engine, which owns exact complex
 * coefficients; this one deliberately does not pretend to.
 */
function applyMethod(
  method: BufferMethod,
  out: Float32Array,
  src: Uint8Array,
  oldest: Uint8Array,
  lo: number,
  hi: number,
  p: BufferParams
) {
  const len = hi - lo;
  if (len <= 0) return;

  switch (method) {
    case 'sieve': {
      const m = Math.max(2, Math.round(p.sieveModulus));
      for (let i = lo; i < hi; i++) out[i] = gcd(i + 1, m) > 1 ? 0 : src[i];
      break;
    }
    case 'tilt': {
      // p-adic valuation of the bin index, base 2.
      for (let i = lo; i < hi; i++) {
        let v = 0;
        let n = i + 1;
        while (n % 2 === 0) {
          v++;
          n = Math.floor(n / 2);
        }
        out[i] = src[i] * Math.pow(2, -v * 0.75);
      }
      break;
    }
    case 'perm': {
      const P = largestPrimeLE(len);
      const g = leastPrimitiveRoot(P);
      for (let i = lo; i < hi; i++) out[i] = 0;
      for (let i = 0; i < len; i++) {
        const target = i < P ? ((i + 1) * g) % P : i;
        out[lo + (target % len)] += src[lo + i];
      }
      break;
    }
    case 'fold': {
      const K = Math.max(2, Math.round(p.foldPeriod));
      for (let i = lo; i < hi; i++) out[i] = 0;
      for (let i = 0; i < len; i++) out[lo + (i % K)] += src[lo + i];
      // Folding piles many bins onto few; scale back so the band keeps its level.
      const scale = 1 / Math.max(1, Math.ceil(len / K));
      for (let i = lo; i < lo + Math.min(K, len); i++) out[i] *= scale;
      break;
    }
    case 'freeze': {
      for (let i = lo; i < hi; i++) out[i] = oldest[i];
      break;
    }
    case 'blur': {
      const w = Math.max(1, Math.round(p.blurWidth));
      const norm = 1 / (2 * w + 1);
      for (let i = lo; i < hi; i++) {
        let acc = 0;
        for (let k = -w; k <= w; k++) {
          const j = Math.min(hi - 1, Math.max(lo, i + k));
          acc += src[j];
        }
        out[i] = acc * norm;
      }
      break;
    }
    case 'mirror': {
      for (let i = 0; i < len; i++) out[lo + i] = src[hi - 1 - i];
      break;
    }
    case 'pass':
    default: {
      for (let i = lo; i < hi; i++) out[i] = src[i];
      break;
    }
  }
}

/** Which method and how much lag a given band gets — the diagonal rule, in one place. */
export function bandAssignment(
  band: number,
  p: BufferParams
): { method: BufferMethod; lag: number } {
  const idx =
    ((Math.round(band * p.methodSkew + p.methodOffset) % BUFFER_METHODS.length) +
      BUFFER_METHODS.length) %
    BUFFER_METHODS.length;
  return {
    method: BUFFER_METHODS[idx],
    lag: Math.min(MAX_FRAMES - 1, Math.max(0, Math.round(band * p.timeSkew))),
  };
}

export class BufferTransformer {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private outGain: GainNode;
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private baseFreqs: number[] = [];

  /** Ring of past magnitude frames, newest at `writeIndex - 1`. */
  private frames: Uint8Array[] = [];
  private writeIndex = 0;
  private filled = 0;

  private latest: Uint8Array;
  private assembled: Float32Array;
  private params: BufferParams = { ...DEFAULT_BUFFER_PARAMS };
  private running = false;
  /** Audio-thread clock, so analysis keeps running while the page is hidden. */
  private ticker: AudioWorkletNode | null = null;
  private tickerSink: GainNode | null = null;
  /** Only used if the ticker worklet is unavailable; stops dead when the page hides. */
  private rafId: number | null = null;

  constructor(ctx: AudioContext, source: AudioNode, destination: AudioNode) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = this.params.fftSize;
    this.analyser.smoothingTimeConstant = this.params.smoothing;
    // Analysis only: the source feeds the analyser, and the bank sings somewhere the source
    // cannot hear, so the loop is open and there is nothing to run away.
    source.connect(this.analyser);

    this.outGain = ctx.createGain();
    this.outGain.gain.value = 0;
    this.outGain.connect(destination);

    this.latest = new Uint8Array(this.analyser.frequencyBinCount);
    this.assembled = new Float32Array(this.analyser.frequencyBinCount);
    this.allocateFrames();
  }

  private allocateFrames() {
    const bins = this.analyser.frequencyBinCount;
    this.frames = Array.from({ length: MAX_FRAMES }, () => new Uint8Array(bins));
    this.latest = new Uint8Array(bins);
    this.assembled = new Float32Array(bins);
    this.writeIndex = 0;
    this.filled = 0;
  }

  private buildBank() {
    this.teardownBank();
    const count = Math.min(512, Math.max(8, Math.round(this.params.oscCount)));
    const nyquist = this.ctx.sampleRate / 2;
    this.baseFreqs = [];
    const logMin = Math.log(MIN_FREQ);
    const logMax = Math.log(MAX_FREQ);
    for (let i = 0; i < count; i++) {
      const f = count > 1 ? i / (count - 1) : 0;
      this.baseFreqs.push(
        this.params.distribution >= 0.5
          ? MIN_FREQ + (MAX_FREQ - MIN_FREQ) * f
          : Math.exp(logMin + (logMax - logMin) * f)
      );
    }
    const t = this.ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(
        Math.min(nyquist - 1, this.baseFreqs[i] * this.params.pitchShift),
        t
      );
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.outGain);
      osc.start(t);
      this.oscs.push(osc);
      this.gains.push(gain);
    }
  }

  private teardownBank() {
    for (const osc of this.oscs) {
      try {
        osc.stop();
      } catch (_) {}
      try {
        osc.disconnect();
      } catch (_) {}
    }
    for (const g of this.gains) {
      try {
        g.disconnect();
      } catch (_) {}
    }
    this.oscs = [];
    this.gains = [];
  }

  private retuneBank() {
    const nyquist = this.ctx.sampleRate / 2;
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].frequency.setTargetAtTime(
        Math.min(nyquist - 1, this.baseFreqs[i] * this.params.pitchShift),
        t,
        0.05
      );
    }
  }

  /**
   * Assemble one output spectrum by walking the bands diagonally through the buffer, then
   * drive the oscillator bank from it. Exposed (and pure enough to test) as `assembleFrame`.
   */
  public assembleFrame(): Float32Array {
    const bins = this.analyser.frequencyBinCount;
    const p = this.params;
    const segments = Math.max(1, Math.min(32, Math.round(p.segments)));
    const oldest = this.frames[(this.writeIndex + MAX_FRAMES - Math.max(1, this.filled)) % MAX_FRAMES];

    for (let s = 0; s < segments; s++) {
      const lo = Math.floor((s * bins) / segments);
      const hi = Math.floor(((s + 1) * bins) / segments);
      const { method, lag } = bandAssignment(s, p);

      let extra = 0;
      if (p.jitter > 0 && Math.random() < p.jitter) {
        extra = Math.floor(Math.random() * Math.max(1, Math.round(p.timeSkew) + 1));
      }
      const back = Math.min(Math.max(0, this.filled - 1), lag + extra);
      const idx = (this.writeIndex - 1 - back + 2 * MAX_FRAMES) % MAX_FRAMES;
      applyMethod(method, this.assembled, this.frames[idx], oldest, lo, hi, p);
    }
    return this.assembled;
  }

  private rafTick = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.rafTick);
    this.tick();
  };

  private tick = () => {
    if (!this.running) return;
    if (this.ctx.state !== 'running' || this.oscs.length === 0) return;

    // Capture the present into the ring, then read the diagonal back out of it.
    this.analyser.getByteFrequencyData(this.latest);
    this.frames[this.writeIndex].set(this.latest);
    this.writeIndex = (this.writeIndex + 1) % MAX_FRAMES;
    this.filled = Math.min(MAX_FRAMES, this.filled + 1);

    const frame = this.assembleFrame();
    const bins = this.analyser.frequencyBinCount;
    const binWidth = this.ctx.sampleRate / 2 / bins;
    // Equal-power-ish compensation: more oscillators should not mean a louder result.
    const compensation = 2.0 / Math.sqrt(this.oscs.length);
    const t = this.ctx.currentTime;

    for (let i = 0; i < this.oscs.length; i++) {
      const bin = this.baseFreqs[i] / binWidth;
      let amp = 0;
      if (bin < bins - 1) {
        const b0 = Math.floor(bin);
        const frac = bin - b0;
        amp = frame[b0] + (frame[b0 + 1] - frame[b0]) * frac;
      }
      const norm = Math.pow(Math.max(0, amp) / 255, 2);
      this.gains[i].gain.setTargetAtTime(norm * compensation, t, 0.02);
    }
  };

  public setParams(next: BufferParams) {
    const prev = this.params;
    this.params = { ...next };

    if (next.fftSize !== prev.fftSize) {
      this.analyser.fftSize = Math.max(32, Math.min(32768, next.fftSize));
      this.allocateFrames();
    }
    if (next.smoothing !== prev.smoothing) {
      this.analyser.smoothingTimeConstant = Math.max(0, Math.min(0.99, next.smoothing));
    }
    this.outGain.gain.setTargetAtTime(
      next.enabled ? Math.max(0, Math.min(1, next.mix)) : 0,
      this.ctx.currentTime,
      0.05
    );

    if (!next.enabled) {
      this.stop();
      return;
    }
    if (
      !this.running ||
      Math.round(next.oscCount) !== Math.round(prev.oscCount) ||
      next.distribution !== prev.distribution
    ) {
      this.start();
    } else if (next.pitchShift !== prev.pitchShift) {
      this.retuneBank();
    }
  }

  public start() {
    this.buildBank();
    if (this.running) return;
    this.running = true;
    this.startClock();
  }

  /**
   * Prefer the audio-thread ticker; fall back to the display loop only if the worklet is
   * missing, in which case the module still works while the page is visible.
   */
  private startClock() {
    try {
      this.ticker = new AudioWorkletNode(this.ctx, 'analysis-ticker', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { every: 4 },
      });
      // Silent, but it has to be in the graph to be pulled.
      this.tickerSink = this.ctx.createGain();
      this.tickerSink.gain.value = 0;
      this.ticker.connect(this.tickerSink);
      this.tickerSink.connect(this.ctx.destination);
      this.ticker.port.onmessage = () => this.tick();
      return;
    } catch (_) {
      this.ticker = null;
    }
    this.rafId = requestAnimationFrame(this.rafTick);
  }

  private stopClock() {
    if (this.ticker) {
      try {
        this.ticker.port.postMessage({ type: 'stop' });
        this.ticker.disconnect();
      } catch (_) {}
      this.ticker = null;
    }
    if (this.tickerSink) {
      try {
        this.tickerSink.disconnect();
      } catch (_) {}
      this.tickerSink = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public stop() {
    this.running = false;
    this.stopClock();
    this.teardownBank();
  }

  public dispose() {
    this.stop();
    try {
      this.analyser.disconnect();
      this.outGain.disconnect();
    } catch (_) {}
  }

  /** Test seam: push a frame straight into the ring without an AudioContext running. */
  public pushFrameForTest(data: Uint8Array) {
    this.frames[this.writeIndex].set(data);
    this.writeIndex = (this.writeIndex + 1) % MAX_FRAMES;
    this.filled = Math.min(MAX_FRAMES, this.filled + 1);
  }

  public get binCount() {
    return this.analyser.frequencyBinCount;
  }
}
