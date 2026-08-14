/**
 * Regime split — a state-conditional cut of the cycle, applied before projection.
 *
 * Every other source in this synth is an explicit function of θ: the bent saw, the
 * arithmetic boundary, the Schwarz–Christoffel polygon. Even the zero-crossing pivot is a
 * reparameterization of time rather than a change of rule. This module adds the one thing
 * that family cannot express — a waveform whose *own value* decides which rule generates it:
 *
 *     y(θ) = A(θ)                     when  θ⁻ ≤ A(θ) ≤ θ⁺
 *     y(θ) = B(θ + δ⁺) + rail         when  A(θ) > θ⁺
 *     y(θ) = B(θ + δ⁻) + rail         when  A(θ) < θ⁻
 *
 * That is deliberately *not* a group action. Every operator downstream of the projection is
 * invertible and either amplitude- or phase-preserving — Möbius on CP¹, the cyclotomic
 * permutation, the theta phase, the LCT. This one is non-invertible and piecewise, which is
 * exactly why it does not duplicate any of them.
 *
 * ## Why it runs on the cycle table
 *
 * The obvious way to build this is per audio sample, comparing the running oscillator value
 * against the threshold in real time. That is what a time-domain implementation must do, and
 * it aliases badly: the rule swap plants a step discontinuity at an arbitrary point in the
 * cycle, whose energy runs well past Nyquist and folds back down as inharmonic hash.
 *
 * Here the split is applied to the 512-point cycle table instead, before the DFT. The
 * discontinuity is still there — it is the whole point of the sound — but it is then
 * projected onto exactly `harmonicsCount` partials of the played note, and every component
 * above the harmonic ceiling is simply never summed. Same surgery, no foldover, and it stays
 * pitch-locked, for the same reason the pivot transform does.
 *
 * It also means the split composes with everything after it for free: a regime-cut cycle can
 * then be Möbius-transformed, theta-phased, cyclotomically anagrammed and Hecke-coupled.
 *
 * ## One rail knob, not two
 *
 * A time-domain implementation of this idea usually carries two DC rails, one per region.
 * Only their *difference* is audible here: the projection starts at n = 1, so a constant
 * added to the whole cycle vanishes, and adding c to both rails shifts nothing but DC. What
 * survives is the step between them at the crossover, so that step is a single bipolar knob.
 * The threshold's own offset is likewise not a third rail — see `asym` below.
 */

/** Which cycle supplies the out-of-band rule. */
export const REGIME_SOURCES = ['bendA', 'bendB', 'arith', 'shift'] as const;
export type RegimeSource = (typeof REGIME_SOURCES)[number];

export interface RegimeConfig {
  /** Half-width of the region-A window, in cycle amplitude (the cycle is normalized to ±1). */
  threshold: number;
  /** Signed offset of the whole window, so the caught region walks up and down the wave. */
  asym: number;
  /** Step between rail A and rail B at the crossover — the audible half of a dual-bias pair. */
  rail: number;
  /** Phase offset of the upper branch, in cycles. */
  offsetUp: number;
  /** Phase offset of the lower branch, in cycles. */
  offsetDn: number;
  /** Crossover width. 0 is a hard switch; opening it smoothsteps the two rules together. */
  knee: number;
  /** Dry/wet of the whole stage. */
  mix: number;
}

/** Hermite smoothstep on [0,1], the crossover shape when the knee is open. */
function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** Root mean square of a cycle, used to hold the level across the split. */
function rms(xs: ArrayLike<number>): number {
  let acc = 0;
  for (let j = 0; j < xs.length; j++) acc += xs[j] * xs[j];
  return Math.sqrt(acc / Math.max(1, xs.length));
}

/**
 * Cut `samples` against its own value, splicing in `ruleB` outside the window.
 *
 * `ruleB` is read circularly at an index offset, which is what makes the branch a genuine
 * phase offset of another cycle rather than a static level: the upper lobes of the wave are
 * replaced by a *different part* of the B waveform each time they are caught.
 *
 * The result is matched to the input's RMS before the dry/wet crossfade, so the Mix knob
 * changes character without changing loudness — the rail step in particular would otherwise
 * make the wet path far hotter than the dry one.
 */
export function applyRegimeSplit(
  samples: number[],
  ruleB: ArrayLike<number>,
  cfg: RegimeConfig
): number[] {
  const mix = Math.max(0, Math.min(1, cfg.mix));
  if (mix < 0.001) return samples;

  const K = samples.length;
  const KB = ruleB.length;
  if (KB < 2) return samples;

  const upper = cfg.asym + cfg.threshold;
  const lower = cfg.asym - cfg.threshold;
  // A knee narrower than a hair is a hard switch; the floor keeps the division finite.
  const knee = Math.max(1e-6, cfg.knee);
  const offUp = Math.round(cfg.offsetUp * KB);
  const offDn = Math.round(cfg.offsetDn * KB);

  const wet = new Array<number>(K);
  for (let j = 0; j < K; j++) {
    const a = samples[j];

    // Branch weights. With a wide knee and a narrow window both can fire at once, so they
    // are renormalized rather than clipped — the region-A weight is whatever is left over.
    let gUp = smooth01((a - upper) / knee);
    let gDn = smooth01((lower - a) / knee);
    const sum = gUp + gDn;
    if (sum > 1) {
      gUp /= sum;
      gDn /= sum;
    }
    const gA = 1 - gUp - gDn;

    const bUp = ruleB[(((j + offUp) % KB) + KB) % KB] + cfg.rail;
    const bDn = ruleB[(((j + offDn) % KB) + KB) % KB] + cfg.rail;
    wet[j] = gA * a + gUp * bUp + gDn * bDn;
  }

  // Two matches, and both are needed. Levelling the wet path against the dry one first is
  // what makes Mix a true 50/50 morph rather than a fade into whichever side the rail step
  // made louder. Levelling again *after* the crossfade is what removes the scoop in the
  // middle of the knob: the two paths are far from correlated, so at mix ≈ 0.5 they cancel
  // in places and the sum lands well under either endpoint.
  const dryRms = rms(samples);
  const wetRms = rms(wet);
  const g = wetRms > 1e-9 ? dryRms / wetRms : 1;

  const out = new Array<number>(K);
  for (let j = 0; j < K; j++) out[j] = (1 - mix) * samples[j] + mix * wet[j] * g;

  const outRms = rms(out);
  if (outRms > 1e-9 && dryRms > 1e-9) {
    const norm = dryRms / outRms;
    for (let j = 0; j < K; j++) out[j] *= norm;
  }
  return out;
}

/**
 * Per-cycle dwell statistic: the fraction of the cycle that lands outside the window.
 *
 * The display reads this to shade the caught arcs, and it is the cheap deterministic
 * stand-in for a time-domain residence-time integrator — the cycle is the note's whole
 * history, so "how long is it out of region A" is a property of the table, not of the clock.
 */
export function regimeDwell(samples: ArrayLike<number>, threshold: number, asym: number): number {
  const upper = asym + threshold;
  const lower = asym - threshold;
  let out = 0;
  for (let j = 0; j < samples.length; j++) {
    if (samples[j] > upper || samples[j] < lower) out++;
  }
  return samples.length ? out / samples.length : 0;
}
