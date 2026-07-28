import { SynthParams } from '../types';
import { PARAM_SPECS } from './paramSpecs';

export type LfoShape = 'sine' | 'tri' | 'sqr' | 's&h';

export interface LfoConfig {
  rate: number; // Hz
  depth: number; // 0..1, fraction of the target's full range (bipolar)
  shape: LfoShape;
  target: keyof SynthParams | null;
}

export const DEFAULT_LFOS: LfoConfig[] = [
  { rate: 0.5, depth: 0, shape: 'sine', target: null },
  { rate: 2.0, depth: 0, shape: 'tri', target: null },
];

/** Deterministic pseudo-random in [0,1) for sample & hold. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Waveform value in [-1, 1] at phase p ∈ [0,1). cycleIndex feeds S&H. */
function lfoWave(shape: LfoShape, p: number, cycleIndex: number, seed: number): number {
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'tri':
      return 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
    case 'sqr':
      return p < 0.5 ? 1 : -1;
    case 's&h':
      return hash01(cycleIndex + seed * 1000) * 2 - 1;
  }
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
    const w = lfoWave(lfo.shape, cycles % 1, Math.floor(cycles), i);

    const src = out ?? base;
    const range = spec.max - spec.min;
    let v = (src[lfo.target!] as number) + w * lfo.depth * range * 0.5;
    v = Math.round((v - spec.min) / spec.step) * spec.step + spec.min;
    v = Math.min(spec.max, Math.max(spec.min, Number(v.toFixed(6))));

    out = { ...src, [lfo.target!]: v };
  });

  return out ?? base;
}
