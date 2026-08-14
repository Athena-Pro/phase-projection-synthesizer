import { SynthParams } from '../types';
import { PARAM_SPECS } from './paramSpecs';

export type LfoShape = 'sine' | 'tri' | 'sqr' | 's&h' | 'chaos' | 'step4';

/** The four values a `step4` sequence walks through, in order. */
export type StepSeq = [number, number, number, number];

export const DEFAULT_STEPS: StepSeq = [0.8, -0.4, 0.6, -0.9];

export interface LfoConfig {
  rate: number; // Hz
  depth: number; // 0..1, fraction of the target's full range (bipolar)
  shape: LfoShape;
  target: keyof SynthParams | null;
  /** 0..0.95: slew across each step edge, as a fraction of the step. Stepped shapes only. */
  lag?: number;
  /** Values for the `step4` sequence; defaults to DEFAULT_STEPS. */
  steps?: StepSeq;
}

export const DEFAULT_LFOS: LfoConfig[] = [
  { rate: 0.5, depth: 0, shape: 'sine', target: null, lag: 0, steps: DEFAULT_STEPS },
  { rate: 2.0, depth: 0, shape: 'tri', target: null, lag: 0, steps: DEFAULT_STEPS },
];

/** Deterministic pseudo-random in [0,1) for sample & hold. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Hermite smoothstep on [0,1] — the slew shape across a step edge. */
function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * How many held values each shape produces per LFO cycle. Continuous shapes are absent;
 * everything listed here is a staircase, which is what makes the lag control meaningful.
 */
const STEPS_PER_CYCLE: Partial<Record<LfoShape, number>> = {
  sqr: 2,
  's&h': 1,
  chaos: 1,
  step4: 4,
};

/**
 * Logistic map x ← rx(1−x) at r = 3.99, sampled at a step index.
 *
 * The modulator is recomputed from scratch on every UI tick rather than integrated, so a
 * value has to be a pure function of its step index — there is nowhere to keep an orbit
 * between calls. The orbit is therefore re-seeded every CHAOS_WINDOW steps and iterated
 * forward from there, which bounds the work per call and still gives genuine logistic
 * structure (the deterministic period-doubling texture) rather than the flat white
 * distribution of sample & hold.
 */
const CHAOS_WINDOW = 64;
function logistic01(index: number, seed: number): number {
  const w = Math.floor(index / CHAOS_WINDOW);
  // Seed away from the fixed points, where the map would stall.
  let x = 0.15 + 0.7 * hash01(w + seed * 1000 + 7.77);
  const iters = index - w * CHAOS_WINDOW;
  for (let i = 0; i < iters; i++) {
    x = 3.99 * x * (1 - x);
    if (!(x > 1e-6 && x < 1 - 1e-6)) x = 0.63;
  }
  return x;
}

/** The held value of a staircase shape at a given step index. */
function stepValue(shape: LfoShape, index: number, seed: number, steps: StepSeq): number {
  switch (shape) {
    case 'sqr':
      return (((index % 2) + 2) % 2) === 0 ? 1 : -1;
    case 's&h':
      return hash01(index + seed * 1000) * 2 - 1;
    case 'chaos':
      return logistic01(index, seed) * 2 - 1;
    case 'step4':
      return steps[(((index % 4) + 4) % 4)] ?? 0;
    default:
      return 0;
  }
}

/**
 * Waveform value in [-1, 1] after `cycles` LFO cycles.
 *
 * Lag is an analytic slew rather than a one-pole filter, for the same reason the chaos map
 * is windowed: there is no state to carry. Interpolating from the previous held value to the
 * current one across the first `lag` of each step is exact, reaches its target inside the
 * step, and cannot overshoot — all three of which a stateless one-pole could not manage.
 */
function lfoWave(
  shape: LfoShape,
  cycles: number,
  seed: number,
  lag: number,
  steps: StepSeq
): number {
  if (shape === 'sine') return Math.sin(2 * Math.PI * (cycles % 1));
  if (shape === 'tri') return 1 - 4 * Math.abs((((cycles % 1) + 0.25) % 1) - 0.5);

  const per = STEPS_PER_CYCLE[shape] ?? 1;
  const pos = cycles * per;
  const index = Math.floor(pos);
  const cur = stepValue(shape, index, seed, steps);

  const L = Math.max(0, Math.min(0.95, lag));
  if (L < 0.001) return cur;
  const prev = stepValue(shape, index - 1, seed, steps);
  return prev + (cur - prev) * smooth01((pos - index) / L);
}

/** True when a config actually modulates something. */
export function lfoActive(lfo: LfoConfig): boolean {
  return lfo.target !== null && lfo.depth > 0.001;
}

/**
 * Apply active LFOs on top of the base parameters. Modulation is bipolar around the
 * base value, scaled by depth × full range / 2, quantized to the parameter's step,
 * and clamped to its range. Two LFOs on the same target sum.
 */
export function applyLfos(
  base: SynthParams,
  lfos: LfoConfig[],
  nowMs: number
): SynthParams {
  let out: SynthParams | null = null;
  const t = nowMs / 1000;

  lfos.forEach((lfo, i) => {
    if (!lfoActive(lfo)) return;
    const spec = PARAM_SPECS[lfo.target!];
    if (!spec) return;

    const cycles = t * lfo.rate;
    const w = lfoWave(lfo.shape, cycles, i, lfo.lag ?? 0, lfo.steps ?? DEFAULT_STEPS);

    const src = out ?? base;
    const range = spec.max - spec.min;
    let v = (src[lfo.target!] as number) + w * lfo.depth * range * 0.5;
    v = Math.round((v - spec.min) / spec.step) * spec.step + spec.min;
    v = Math.min(spec.max, Math.max(spec.min, Number(v.toFixed(6))));

    out = { ...src, [lfo.target!]: v };
  });

  return out ?? base;
}
