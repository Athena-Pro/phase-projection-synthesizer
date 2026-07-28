/**
 * Doppler reverb — a room whose walls move, pitch-shifting every reflection.
 *
 * A reverb is a sum of delayed, damped, diffused reflections. The Doppler part is free:
 * a delay line whose length changes in time is a pitch shifter. Reading a buffer at
 * n − D(n), an input e^{iωn} emerges with instantaneous frequency ω·(1 − D′(n)) —
 * exactly the first-order factor for a moving mirror. Tie D to a wall moving at velocity
 * v: the round-trip path changes at 2v, so D′ = 2v/c and the tail is shifted by
 * (c−v)/(c+v).
 *
 * Two regimes, selected by `mode`:
 *   0 — Oscillate: each of four walls swings sinusoidally (D₀ + A·sin ωt), so the shift
 *       reverses each half-cycle and the tuning stays centered — a Doppler vibrato
 *       reverb, the "breathing room." Built from native DelayNodes, which interpolate
 *       their fractional read pointer and genuinely Doppler when modulated. Peak shift
 *       A·ω depends on both travel amplitude (Wall Speed) and rate (Wall Rate).
 *   1 — Travel: the walls move steadily, a *fixed* shift that, living inside the
 *       feedback loop, compounds to ρ^k after k passes — the tail spirals endlessly up
 *       or down (shimmer). Runs in the `doppler-shimmer` AudioWorklet, which is the
 *       honest home for a sustained in-loop shift. See shimmerWorklet.ts.
 *
 * Room / Tail / Damp / Reverb(mix) are shared; Wall Speed & Wall Rate drive regime 0,
 * Shift drives regime 1. The two paths run in parallel and `mode` cross-fades between
 * their return gains, so switching is click-free.
 */

export interface DopplerParams {
  mix: number; // 0..1 wet level
  mode: number; // 0 = oscillate, 1 = travel (shimmer)
  speed: number; // 0..1 wall travel amplitude → modulation depth (regime 0)
  rate: number; // Hz — wall oscillation rate (regime 0)
  shift: number; // semitones per recirculation (regime 1)
  size: number; // 0..1 room size → base delay lengths
  decay: number; // 0..1 → feedback coefficient (tail length)
  damp: number; // 0..1 → feedback lowpass darkening
}

const N = 4;
const BASE_DELAYS = [0.0371, 0.0431, 0.0533, 0.0611]; // seconds, coprime-ish
const RATE_RATIOS = [1.0, 1.13, 0.91, 1.07]; // per-line rate detune for a lush swirl

// Householder mix H = I − (2/N)·J: diagonal 1 − 2/N, off-diagonal −2/N. Orthogonal.
function householder(i: number, j: number): number {
  return (i === j ? 1 : 0) - 2 / N;
}

export class DopplerReverb {
  /** Dry signal is fed here (a send from the master chain). */
  readonly input: GainNode;
  /** Wet output — connect to the master bus. Its gain is the wet mix. */
  readonly wet: GainNode;

  private ctx: AudioContext;

  // Regime 0 (native oscillating FDN)
  private delays: DelayNode[] = [];
  private damps: BiquadFilterNode[] = [];
  private lineIn: GainNode[] = [];
  private fb: GainNode[][] = [];
  private mods: OscillatorNode[] = [];
  private modDepth: GainNode[] = [];
  private oscOut: GainNode; // regime-0 return, gated by mode

  // Regime 1 (shimmer worklet). Created only if the module is registered.
  private shimmer: AudioWorkletNode | null = null;
  private travelOut: GainNode; // regime-1 return, gated by mode

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    // --- Regime 0: native oscillating feedback delay network ---
    this.oscOut = ctx.createGain();
    this.oscOut.gain.value = 1 / N;
    this.oscOut.connect(this.wet);

    for (let k = 0; k < N; k++) {
      const lineIn = ctx.createGain();
      const delay = ctx.createDelay(1.0);
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 12000;

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = 0.8 * RATE_RATIOS[k];
      const depth = ctx.createGain();
      depth.gain.value = 0;
      mod.connect(depth);
      depth.connect(delay.delayTime); // modulate the read pointer → Doppler
      mod.start();

      this.input.connect(lineIn);
      lineIn.connect(delay);
      delay.connect(damp);
      damp.connect(this.oscOut);

      this.delays.push(delay);
      this.damps.push(damp);
      this.lineIn.push(lineIn);
      this.mods.push(mod);
      this.modDepth.push(depth);
    }
    for (let i = 0; i < N; i++) {
      const row: GainNode[] = [];
      for (let j = 0; j < N; j++) {
        const g = ctx.createGain();
        g.gain.value = 0;
        this.damps[j].connect(g);
        g.connect(this.lineIn[i]);
        row.push(g);
      }
      this.fb.push(row);
    }

    // --- Regime 1: shimmer worklet (requires the 'doppler-shimmer' module) ---
    this.travelOut = ctx.createGain();
    this.travelOut.gain.value = 0;
    this.travelOut.connect(this.wet);
    try {
      this.shimmer = new AudioWorkletNode(ctx, 'doppler-shimmer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.input.connect(this.shimmer);
      this.shimmer.connect(this.travelOut);
    } catch (_) {
      // Module not registered — regime 1 unavailable; regime 0 still works.
      this.shimmer = null;
    }
  }

  setParams(p: DopplerParams) {
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, v: number, tau = 0.03) =>
      param.setTargetAtTime(v, t, tau);

    set(this.wet.gain, p.mix, 0.02);

    // Cross-fade the two returns by mode (equal-power). oscOut carries the 1/N sum.
    const travel = this.shimmer ? p.mode : 0;
    set(this.oscOut.gain, (1 / N) * Math.cos((travel * Math.PI) / 2), 0.03);
    set(this.travelOut.gain, Math.sin((travel * Math.PI) / 2), 0.03);

    // Regime 0
    const g = p.decay * 0.86; // g < 1 keeps the orthogonal loop stable
    const sizeScale = 0.4 + p.size * 1.8;
    const depthSeconds = p.speed * 0.005; // up to 5 ms of wall travel
    const dampCutoff = 800 + (1 - p.damp) * 15000;
    for (let k = 0; k < N; k++) {
      set(this.delays[k].delayTime, BASE_DELAYS[k] * sizeScale, 0.05);
      set(this.modDepth[k].gain, depthSeconds);
      set(this.mods[k].frequency, p.rate * RATE_RATIOS[k]);
      set(this.damps[k].frequency, dampCutoff);
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        set(this.fb[i][j].gain, g * householder(i, j));
      }
    }

    // Regime 1
    if (this.shimmer) {
      this.shimmer.port.postMessage({
        type: 'params',
        shift: p.shift,
        feedback: p.decay,
        size: p.size,
        damp: p.damp,
      });
    }
  }
}
