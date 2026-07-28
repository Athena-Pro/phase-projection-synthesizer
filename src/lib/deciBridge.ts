/**
 * Bridge between the deci-core base-10 Turing machine and the synth.
 *
 * Two directions, matching the two halves of the idea:
 *
 *   1. SAMPLE — the synth's live audio (the AnalyserNode magnitude spectrum) is
 *      reduced to a small Gödel-packed integer A = 2^x·3^y·5^z·7^w, where x,y,z,w
 *      are coarse spectral features (energy, brightness, high/low balance,
 *      peakiness). This is the "seed" that crosses into deci-core.
 *
 *   2. RE-PROGRAM — a deci-core program is run on that seed, and the resulting
 *      integer is read back through its Gödel registers / digit structure into a
 *      feature vector, which is mapped onto a chosen subset of SynthParams (scaled
 *      and quantized through PARAM_SPECS, exactly like a MIDI knob would be).
 *
 * The whole path is deterministic: the same audio + same program always yields the
 * same patch. Because every target lands through PARAM_SPECS' min/max/step, no
 * mapping can push a parameter out of range no matter how large A grows.
 *
 * This module is pure (no audio nodes, no React) so it can be unit-tested and driven
 * from either a one-shot "generate patch" button or a live modulation loop.
 */

import { SynthParams } from '../types';
import { PARAM_SPECS, ParamSpec } from './paramSpecs';
import { getGodelRegisters, runDeci, runDeciTrajectory } from './deci';
import { ARITH_SEQ_MAX } from './audioEngine';

/** Largest exponent used when Gödel-packing spectral features into the seed. */
const SEED_EXP_MAX = 9;

/**
 * Normalized 0..1 features read back out of a deci-core result integer. The Gödel
 * exponents and remainder capture its multiplicative structure; the digit-derived
 * fields (including the six "wheel" buckets that fold digits by position mod 6)
 * capture its decimal structure, giving enough decorrelated scalars to drive a
 * wide parameter map without everything moving in lockstep.
 */
export interface DeciFeatures {
  e2: number;
  e3: number;
  e5: number;
  e7: number;
  e11: number;
  e13: number;
  /** Co-prime remainder folded to 0..1 two ways (different moduli → decorrelated). */
  remainder: number;
  remainderHi: number;
  /** Decimal length of A, 0..1 (rough magnitude / "how far it ran"). */
  digits: number;
  /** Sum of all decimal digits, folded to 0..1. */
  digitSum: number;
  /** Last / middle decimal digit, each /9. */
  lastDigit: number;
  midDigit: number;
  /** (max digit − min digit) / 9 — spread of the decimal expansion. */
  digitSpread: number;
  /** 1 if the program HALTed, 0 if it ran out of steps or program. */
  halted: number;
  /** Six position-folded digit buckets, each 0..1. */
  w0: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
}

/** One row of the mapping: which deci feature drives which synth parameter. */
export interface DeciMapEntry {
  param: keyof SynthParams;
  feature: keyof DeciFeatures;
}

/**
 * Arithmetic map. Leans deliberately into the synth's number-theoretic controls —
 * the Gödel exponents drive the comb / p-adic / Dirichlet / Hecke / Möbius family,
 * so an arithmetic machine ends up steering the arithmetic parameters.
 */
export const DEFAULT_DECI_MAP: DeciMapEntry[] = [
  { param: 'collatzGating', feature: 'e2' },
  { param: 'combModulus', feature: 'e3' },
  { param: 'padicTilt', feature: 'remainder' },
  { param: 'dirichletOrder', feature: 'e5' },
  { param: 'dirichletTwist', feature: 'w0' },
  { param: 'heckeMix', feature: 'e7' },
  { param: 'heckeWeight', feature: 'w1' },
  { param: 'harmonicExponent', feature: 'digits' },
  { param: 'mobiusRotate', feature: 'lastDigit' },
  { param: 'mobiusBoost', feature: 'remainderHi' },
  { param: 'mobiusTilt', feature: 'w2' },
  { param: 'crossMix', feature: 'digitSpread' },
  { param: 'circulantOperatorStrength', feature: 'e11' },
  { param: 'frftMix', feature: 'e13' },
];

/** Timbre + spatial rows, appended to the arithmetic map for the "full" scope. */
export const TIMBRE_SPATIAL_MAP: DeciMapEntry[] = [
  { param: 'cutoff', feature: 'digitSum' },
  { param: 'resonance', feature: 'midDigit' },
  { param: 'frftAngle', feature: 'w3' },
  { param: 'frftSqueeze', feature: 'w4' },
  { param: 'dopplerMix', feature: 'w5' },
  { param: 'dopplerDecay', feature: 'w0' },
  { param: 'parityMix', feature: 'w1' },
  { param: 'parityDrive', feature: 'w2' },
  { param: 'spaceBoost', feature: 'remainderHi' },
  { param: 'spaceAngle', feature: 'lastDigit' },
];

/** Arithmetic map plus the timbre/spatial rows. */
export const FULL_DECI_MAP: DeciMapEntry[] = [...DEFAULT_DECI_MAP, ...TIMBRE_SPATIAL_MAP];

/** Squash an unbounded prime exponent into 0..1 (saturating, e≈12 → 0.75). */
const expTo01 = (e: number): number => e / (e + 4);

/**
 * Reduce a magnitude spectrum (getByteFrequencyData, 0..255 per bin) to a Gödel-
 * packed seed integer 2^x·3^y·5^z·7^w. Each exponent 0..SEED_EXP_MAX comes from a
 * coarse spectral descriptor, so the seed is a compact fingerprint of the timbre
 * currently sounding. Silence maps to A = 1 (all exponents 0).
 */
export function spectrumToSeed(freq: Uint8Array): bigint {
  const N = freq.length;
  if (N === 0) return 1n;

  let sum = 0;
  let weighted = 0;
  let peak = 0;
  let highSum = 0;
  const half = N >> 1;
  for (let i = 0; i < N; i++) {
    const v = freq[i];
    sum += v;
    weighted += v * i;
    if (v > peak) peak = v;
    if (i >= half) highSum += v;
  }

  const energy = sum / (N * 255); // 0..1 overall loudness
  const centroid = sum > 0 ? weighted / (sum * (N - 1)) : 0; // 0..1 brightness
  const highRatio = sum > 0 ? highSum / sum : 0; // 0..1 treble share
  const peakiness = sum > 0 ? Math.min(1, peak / (sum / N) / 8) : 0; // ~0..1 tonal vs. noisy

  const primes = [2n, 3n, 5n, 7n];
  const feats = [energy, centroid, highRatio, peakiness];
  let A = 1n;
  for (let k = 0; k < primes.length; k++) {
    const e = Math.max(0, Math.min(SEED_EXP_MAX, Math.round(feats[k] * SEED_EXP_MAX)));
    A *= primes[k] ** BigInt(e);
  }
  return A;
}

/** Read a deci-core result integer into the normalized feature vector. */
export function extractFeatures(A: bigint, halted: boolean): DeciFeatures {
  const mag = A < 0n ? -A : A;
  const { exponents, remainder } = getGodelRegisters(mag);
  const s = mag.toString();

  let maxD = 0;
  let minD = 9;
  let sumD = 0;
  const wheel = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d > maxD) maxD = d;
    if (d < minD) minD = d;
    sumD += d;
    wheel[i % 6] += d;
  }
  const last = s.charCodeAt(s.length - 1) - 48;
  const mid = s.charCodeAt(s.length >> 1) - 48;

  return {
    e2: expTo01(exponents[0]),
    e3: expTo01(exponents[1]),
    e5: expTo01(exponents[2]),
    e7: expTo01(exponents[3]),
    e11: expTo01(exponents[4]),
    e13: expTo01(exponents[5]),
    remainder: Number(remainder % 997n) / 997,
    remainderHi: Number(remainder % 9973n) / 9973,
    digits: Math.min(1, s.length / 48),
    digitSum: (sumD % 100) / 100,
    lastDigit: last / 9,
    midDigit: mid / 9,
    digitSpread: (maxD - minD) / 9,
    halted: halted ? 1 : 0,
    w0: (wheel[0] % 97) / 97,
    w1: (wheel[1] % 97) / 97,
    w2: (wheel[2] % 97) / 97,
    w3: (wheel[3] % 97) / 97,
    w4: (wheel[4] % 97) / 97,
    w5: (wheel[5] % 97) / 97,
  };
}

/** Clamp an absolute value into a spec's range and quantize to its step. */
function quantizeAbs(spec: ParamSpec, value: number): number {
  const q = Math.round((value - spec.min) / spec.step) * spec.step + spec.min;
  return Number(Math.min(spec.max, Math.max(spec.min, q)).toFixed(6));
}

/**
 * Apply a deci feature vector onto a base patch through a mapping, returning a new
 * SynthParams. `depth` (0..1) blends each mapped parameter from its base value
 * toward the deci-driven target, so the effect can be dialed in continuously (0 =
 * unchanged, 1 = fully re-programmed). Unmapped parameters are copied through.
 */
export function applyFeatures(
  base: SynthParams,
  feats: DeciFeatures,
  map: DeciMapEntry[] = FULL_DECI_MAP,
  depth = 1
): SynthParams {
  const out: SynthParams = { ...base };
  for (const { param, feature } of map) {
    const spec = PARAM_SPECS[param];
    if (!spec) continue;
    const target = spec.min + feats[feature] * (spec.max - spec.min);
    const baseVal = base[param] as number;
    const blended = baseVal + depth * (target - baseVal);
    out[param] = quantizeAbs(spec, blended) as SynthParams[typeof param];
  }
  return out;
}

// ── Number mode ─────────────────────────────────────────────────────────────────────────
//
// The primary way the deci-core drives the synth: instead of scattering the program's output
// across a dozen knobs, its integer *becomes the waveform*. The arithmetic boundary
// oscillator reads a number's binary expansion as a curve, so handing it the machine's
// accumulator makes the sampled timbre → Gödel seed → program → sound loop close on itself.
//
// With a sequence of more than one point, the note walks the machine's trajectory: it starts
// at the seed — the fingerprint of what the synth just heard — and arrives at the result.

/** A double resolves ~16 decimal digits; more than that cannot survive the conversion. */
const DECI_NUMBER_DIGITS = 16;

/**
 * Read a deci-core accumulator as a number for the arithmetic oscillator: its **digit count**
 * before the radix point, its leading **significant digits** after it.
 *
 * The value cannot be used as-is — a 300-digit accumulator is beyond a double, and a pure
 * integer has no fractional bits, so the curve would get cosine coefficients only. The
 * obvious fix, splitting the digit string down the middle, has a trap this codebase walks
 * into constantly: these programs double, triple and mirror, so accumulators very often end
 * in zeros, and "56700" split in half is 567.00 — an envelope stage with an empty fraction,
 * i.e. no sine content at all. Putting the digits *after* the point instead means they always
 * carry a rich binary expansion, while the magnitude still moves the cosine bits.
 */
export function deciNumberValue(A: bigint): number {
  const mag = A < 0n ? -A : A;
  if (mag === 0n) return 0;
  const s = mag.toString();
  const v = Number(`${s.length}.${s.slice(0, DECI_NUMBER_DIGITS)}`);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Sample the spectrum, run the program, and write the resulting integers into the arithmetic
 * oscillator's number sequence — blending `arithMix` toward fully-heard by `depth`, so the
 * Depth control reads as "how much of the number you hear". Every other parameter is left
 * exactly as the player set it; this mode re-programs the *waveform*, not the patch.
 */
export function generateNumberPatch(
  base: SynthParams,
  freq: Uint8Array,
  code: string,
  opts: { depth?: number; maxSteps?: number } = {}
): {
  params: SynthParams;
  seed: bigint;
  result: bigint;
  steps: number;
  halted: boolean;
  trajectory: bigint[];
} {
  const depth = opts.depth ?? 1;
  const seed = spectrumToSeed(freq);
  const count = Math.max(1, Math.min(ARITH_SEQ_MAX, Math.round(base.arithSeqCount)));
  const { values, steps, halted } = runDeciTrajectory(code, seed, count, opts.maxSteps ?? 5000);

  const numbers = values.map(deciNumberValue);
  const params: SynthParams = {
    ...base,
    arithMix: base.arithMix + depth * (1 - base.arithMix),
    arithValue: numbers[0],
    arithValue2: numbers[1] ?? base.arithValue2,
    arithValue3: numbers[2] ?? base.arithValue3,
    arithValue4: numbers[3] ?? base.arithValue4,
  };
  return { params, seed, result: values[values.length - 1], steps, halted, trajectory: values };
}

/**
 * End-to-end: sample the spectrum, run a deci-core program on the resulting seed,
 * and map the program's output onto a patch. Returns the new params plus the
 * intermediate deci state, so a UI can show what the machine did.
 */
export function generatePatch(
  base: SynthParams,
  freq: Uint8Array,
  code: string,
  opts: { map?: DeciMapEntry[]; depth?: number; maxSteps?: number } = {}
): {
  params: SynthParams;
  seed: bigint;
  result: bigint;
  steps: number;
  halted: boolean;
  features: DeciFeatures;
} {
  const seed = spectrumToSeed(freq);
  const { A, steps, halted } = runDeci(code, seed, opts.maxSteps ?? 5000);
  const features = extractFeatures(A, halted);
  const params = applyFeatures(base, features, opts.map, opts.depth ?? 1);
  return { params, seed, result: A, steps, halted, features };
}
