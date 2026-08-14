/**
 * Preset bank validator.
 *
 * Run with:  npm run check:presets
 *
 * Every patch in `SYNTH_PRESETS` is checked for the ways a preset can be quietly broken:
 * a value outside the range its knob allows, an enum that is not one of the options its
 * SegmentGroup offers, a *dead knob* (a parameter set while whatever gates it is closed, so
 * the setting does nothing at all), a spectrum that came out silent or non-finite, a genesis
 * animation whose stages are identical, or a patch that is a near-duplicate of another.
 *
 * The dead-knob rules are the interesting half: this synth has a lot of modules that only
 * take effect when something else is engaged, and a preset that sets `operatorFocus` while
 * Width sits on its all-pass rail looks intentional in the source and does nothing in the
 * ear. Each rule below names the gate it is checking.
 */
import {
  computeFourierSeries,
  arithSequence,
  arithSequenceActive,
  divergeParams,
  unisonWeights,
  STATIC_FLOW,
  stageFlow,
  midiToFreq,
  ARITH_MAX_BITS,
} from '../src/lib/audioEngine';
import { SYNTH_PRESETS, FACTORY_BANKS } from '../src/lib/presets';
import { normalizeParams } from '../src/lib/userSlots';
import { PARAM_SPECS } from '../src/lib/paramSpecs';
import { SynthParams, Preset } from '../src/types';

type Issue = { preset: string; kind: string; detail: string };
const errors: Issue[] = [];
const warnings: Issue[] = [];
const err = (preset: string, kind: string, detail: string) => errors.push({ preset, kind, detail });
const warn = (preset: string, kind: string, detail: string) => warnings.push({ preset, kind, detail });

/** Discrete parameters and the exact set of values their toggles can produce. */
const ENUMS: Partial<Record<keyof SynthParams, number[]>> = {
  valuationBase: [2, 3, 7, 11, 13],
  dirichletModulus: [5, 7, 11, 13],
  heckePrime: [2, 3, 5, 7],
  bandMode: [0, 1],
  alphaEnvMode: [0, 1],
  extendBloom: [0, 1],
  dopplerMode: [0, 1],
  fxRouting: [0, 1],
  mobiusFlow: [0, 1],
  thetaFlow: [0, 1],
  cyclotomicFlow: [0, 1],
  cyclotomicAction: [0, 1],
  cayleyLink: [0, 1],
  expandProfile: [0, 1, 2],
  arithMap: [0, 1, 2, 3, 4],
  arithExtract: [0, 1, 2, 3],
  arithCoeffMode: [0, 1],
  arithMorphMode: [0, 1],
  subWave: [0, 1, 2],
  subOctave: [0, 1],
  arithSeqMode: [0, 1],
  regimeSource: [0, 1, 2, 3],
};

/**
 * Gate rules: [parameter that does nothing, predicate for "its gate is shut", explanation].
 * A rule only fires when the parameter is actually set away from its neutral value.
 */
const GATES: {
  key: keyof SynthParams;
  neutral: (v: number) => boolean;
  shut: (p: SynthParams) => boolean;
  why: string;
}[] = [
  { key: 'operatorFocus', neutral: (v) => v === 0, shut: (p) => p.operatorWidth >= 7.95,
    why: 'Width is on its all-pass rail, so the focus window does nothing' },
  { key: 'focusTrack', neutral: (v) => v === 0, shut: (p) => p.bandMode < 0.5,
    why: 'Focus Track only applies in absolute-Hz band mode' },
  // The α-envelope *overrides* the static LCT mix per genesis stage (`stageFlow` sets
  // `frftMix: t`), so a dry `frftMix` does not make the LCT parameters dead when the
  // envelope is engaged — it makes the chirp arrive over the note instead of sitting there.
  { key: 'frftAngle', neutral: (v) => v === 0,
    shut: (p) => p.frftMix <= 0.001 && p.alphaEnvDepth <= 0.001 && p.cayleyLink !== 1,
    why: 'the LCT stage is dry, un-swept and not linked through Cayley' },
  { key: 'frftSqueeze', neutral: (v) => v === 0,
    shut: (p) => p.frftMix <= 0.001 && p.alphaEnvDepth <= 0.001 && p.cayleyLink !== 1,
    why: 'the LCT stage is dry, un-swept and not linked through Cayley' },
  { key: 'frftShear', neutral: (v) => v === 0,
    shut: (p) => p.frftMix <= 0.001 && p.alphaEnvDepth <= 0.001 && p.cayleyLink !== 1,
    why: 'the LCT stage is dry, un-swept and not linked through Cayley' },
  { key: 'alphaEnvTime', neutral: (v) => v === 0.3, shut: (p) => p.alphaEnvDepth <= 0.001 && !arithSequenceActive(p),
    why: 'nothing is being swept on the α clock' },
  { key: 'alphaEnvDepth', neutral: (v) => v === 0,
    shut: (p) => (p.frftAngle <= 0.002 || p.frftAngle >= 3.998) &&
                 Math.abs(p.frftSqueeze) <= 0.001 && Math.abs(p.frftShear) <= 0.001,
    why: 'the LCT it sweeps toward is the identity transform' },
  { key: 'cyclotomicPower', neutral: (v) => v === 1, shut: (p) => p.cyclotomicMix <= 0.001,
    why: 'the cyclotomic permutation is dry' },
  { key: 'cyclotomicAction', neutral: (v) => v === 0, shut: (p) => p.cyclotomicMix <= 0.001,
    why: 'the cyclotomic permutation is dry' },
  { key: 'cyclotomicFlow', neutral: (v) => v === 0, shut: (p) => p.cyclotomicMix <= 0.001,
    why: 'the cyclotomic permutation is dry' },
  { key: 'thetaFlow', neutral: (v) => v === 0, shut: (p) => Math.abs(p.thetaPhase) <= 1e-4 && p.thetaHeat <= 1e-4,
    why: 'theta is idle, so its flow has nothing to bloom' },
  { key: 'mobiusFlow', neutral: (v) => v === 0,
    shut: (p) => Math.abs(p.mobiusRotate) <= 0.001 && Math.abs(p.mobiusBoost) <= 0.001 &&
                 Math.abs(p.mobiusTilt) <= 0.001 && Math.abs(p.mobiusParabolic) <= 0.001,
    why: 'the Möbius transform is the identity, so its flow has nothing to travel' },
  { key: 'extendTime', neutral: (v) => v === 0.8, shut: (p) => p.extendMix <= 0.001,
    why: 'the residue is silent' },
  { key: 'extendSkew', neutral: (v) => v === 0, shut: (p) => p.extendMix <= 0.001,
    why: 'the residue is silent' },
  { key: 'extendBloom', neutral: (v) => v === 0, shut: (p) => p.extendMix <= 0.001,
    why: 'the residue is silent' },
  { key: 'motionRate', neutral: (v) => v === 0.5, shut: (p) => p.motionDepth <= 0.001,
    why: 'the spectral-motion LFO has no depth' },
  { key: 'foldPeriod', neutral: (v) => v === 8, shut: (p) => p.spectralFold <= 0.001,
    why: 'the quotient downfold is dry' },
  { key: 'combModulus', neutral: (v) => v === 30,
    shut: (p) => p.collatzGating <= 0.001 || p.valuationBase !== 13,
    why: 'the congruence sieve needs Comb engaged and the sieve basis selected' },
  { key: 'dirichletOrder', neutral: (v) => v === 0.5, shut: (p) => p.dirichletTwist <= 0.001,
    why: 'the character twist is dry' },
  { key: 'dirichletModulus', neutral: (v) => v === 7, shut: (p) => p.dirichletTwist <= 0.001,
    why: 'the character twist is dry' },
  { key: 'heckeWeight', neutral: (v) => v === 1, shut: (p) => p.heckeMix <= 0.001,
    why: 'the Hecke operator is dry' },
  { key: 'heckePrime', neutral: (v) => v === 2, shut: (p) => p.heckeMix <= 0.001,
    why: 'the Hecke operator is dry' },
  // (No rule for `padicTilt`: it applies at any valuation base — `computeFourierSeries`
  // falls back to prime 2 unless the base is 3 — so it is never actually gated.)
  { key: 'detune', neutral: (v) => v === 8, shut: (p) => p.unisonVoices <= 1,
    why: 'there is only one voice to detune' },
  { key: 'expandAmount', neutral: (v) => v === 0,
    shut: (p) => p.unisonVoices <= 1 ||
                 (p.expandTheta <= 0.001 && p.expandOrbit <= 0.001 && p.expandTilt <= 0.001 &&
                  p.expandFocus <= 0.001 && p.expandAlpha <= 0.001 && p.expandRegime <= 0.001),
    why: 'the expander needs more than one voice and at least one spread axis' },
  { key: 'expandOrbit', neutral: (v) => v === 0, shut: (p) => p.cyclotomicMix <= 0.001,
    why: 'orbit spread displaces the cyclotomic power, and that module is dry' },
  { key: 'expandFocus', neutral: (v) => v === 0, shut: (p) => p.operatorWidth >= 7.95,
    why: 'band spread displaces the operator focus, and Width is all-pass' },
  { key: 'expandAlpha', neutral: (v) => v === 0,
    shut: (p) => p.frftMix <= 0.001 && p.alphaEnvDepth <= 0.001,
    why: 'α spread displaces the LCT angle, and that stage is neither wet nor swept' },
  { key: 'expandProfile', neutral: (v) => v === 0, shut: (p) => p.expandAmount <= 0.001,
    why: 'the expander is off, so the weight profile is unused' },
  { key: 'arithBits', neutral: (v) => v === 24, shut: (p) => !arithCurveLive(p),
    why: 'the arithmetic curve is neither blended in nor read by the regime split' },
  { key: 'arithSwell', neutral: (v) => v === 0.7, shut: (p) => !arithCurveLive(p),
    why: 'the arithmetic curve is neither blended in nor read by the regime split' },
  { key: 'arithWarp', neutral: (v) => v === 0, shut: (p) => !arithCurveLive(p) || p.arithMap === 0,
    why: 'the conformal map is off (or the oscillator is), so Warp has nothing to warp' },
  { key: 'arithAngle', neutral: (v) => v === 0, shut: (p) => !arithCurveLive(p) || p.arithMap === 0,
    why: 'the conformal map is off (or the oscillator is)' },
  { key: 'arithSeqCount', neutral: (v) => v === 1, shut: (p) => !arithCurveLive(p),
    why: 'the arithmetic curve is unread, so its number walk is inaudible' },
  { key: 'arithSeqMode', neutral: (v) => v === 0, shut: (p) => !arithSequenceActive(p),
    why: 'there is no number walk to clock' },
  { key: 'arithMorph', neutral: (v) => v === 0.5,
    shut: (p) => !arithCurveLive(p) || Math.round(p.arithExtract) !== 3,
    why: 'the morph axis only applies when the readout is set to "morph"' },
  { key: 'arithMorphMode', neutral: (v) => v === 0,
    shut: (p) => !arithCurveLive(p) || Math.round(p.arithExtract) !== 3,
    why: 'the chord/geo path only applies when the readout is set to "morph"' },
  { key: 'arithCoeffMode', neutral: (v) => v === 0, shut: (p) => !arithCurveLive(p),
    why: 'the arithmetic curve is neither blended in nor read by the regime split' },
  // In edit mode the coefficients replace the number entirely, so the bit depth is unread —
  // and a number walk cannot change a curve that no longer looks at the number.
  { key: 'arithBits', neutral: (v) => v === 24,
    shut: (p) => !arithCurveLive(p) || p.arithCoeffMode >= 0.5,
    why: 'the curve is reading the editable pairs, not the binary expansion' },
  { key: 'arithSeqCount', neutral: (v) => v === 1,
    shut: (p) => !arithCurveLive(p) || p.arithCoeffMode >= 0.5,
    why: 'a number walk is inaudible while the curve reads hand-dialled coefficients' },
  // The SC path reads a fixed eight coefficient pairs as prevertices and angle weights; it
  // never touches the bit count or the k^{−s} falloff, both of which belong to the
  // Fourier-in-log-r shape space that map 4 replaces outright.
  { key: 'arithBits', neutral: (v) => v === 24, shut: (p) => Math.round(p.arithMap) === 4,
    why: 'the Schwarz–Christoffel path reads a fixed eight pairs, not the bit expansion' },
  { key: 'arithDecay', neutral: (v) => v === 1, shut: (p) => !arithCurveLive(p) || Math.round(p.arithMap) === 4,
    why: 'the curve is unread, or the SC path replaces the k^{−s} falloff it scales' },
  { key: 'filterEnvAttack', neutral: (v) => v === 0.02, shut: (p) => Math.abs(p.filterEnvAmount) <= 0.001,
    why: 'the filter envelope has no amount' },
  { key: 'filterEnvDecay', neutral: (v) => v === 0.35, shut: (p) => Math.abs(p.filterEnvAmount) <= 0.001,
    why: 'the filter envelope has no amount' },
  { key: 'filterEnvSustain', neutral: (v) => v === 0.3, shut: (p) => Math.abs(p.filterEnvAmount) <= 0.001,
    why: 'the filter envelope has no amount' },
  { key: 'subWave', neutral: (v) => v === 0, shut: (p) => p.subGain <= 0.001,
    why: 'the sub oscillator is silent' },
  { key: 'subOctave', neutral: (v) => v === 0, shut: (p) => p.subGain <= 0.001,
    why: 'the sub oscillator is silent' },
  { key: 'parityBias', neutral: (v) => v === 0, shut: (p) => p.parityMix <= 0.001,
    why: 'the parity split is dry' },
  { key: 'parityFormant', neutral: (v) => v === 0, shut: (p) => p.parityMix <= 0.001,
    why: 'the parity split is dry' },
  { key: 'parityReverb', neutral: (v) => v === 0, shut: (p) => p.parityMix <= 0.001 || p.dopplerMix <= 0.001,
    why: 'the upper rail is sent to a room that is either dry or not fed' },
  { key: 'parityKeyTrack', neutral: (v) => v === 0, shut: (p) => p.parityMix <= 0.001 || p.parityFormant <= 0.001,
    why: 'key tracking scales the formant bank, which is not engaged' },
  { key: 'parityVowelUp', neutral: (v) => v === 0, shut: (p) => p.parityMix <= 0.001 || p.parityFormant <= 0.001,
    why: 'the formant bank is not engaged' },
  { key: 'dopplerShift', neutral: (v) => v === 12, shut: (p) => p.dopplerMix <= 0.001 || p.dopplerMode !== 1,
    why: 'the fixed shift only applies to traveling walls' },
  { key: 'dopplerRate', neutral: (v) => v === 0.8, shut: (p) => p.dopplerMix <= 0.001 || p.dopplerMode !== 0,
    why: 'the wall rate only applies to oscillating walls' },
  { key: 'dopplerSize', neutral: (v) => v === 0.5, shut: (p) => p.dopplerMix <= 0.001,
    why: 'the room is dry' },
  { key: 'dopplerDecay', neutral: (v) => v === 0.6, shut: (p) => p.dopplerMix <= 0.001,
    why: 'the room is dry' },
  { key: 'spaceAngle', neutral: (v) => v === 0, shut: (p) => Math.abs(p.spaceBoost) <= 0.001,
    why: 'the dominance boost is zero, so its direction is meaningless' },
  { key: 'crossPhase', neutral: (v) => v === 0, shut: (p) => p.crossMix <= 0.001,
    why: 'the tensor crossing layer is dry' },
  { key: 'crossShear', neutral: (v) => v === 0, shut: (p) => p.crossMix <= 0.001,
    why: 'the tensor crossing layer is dry' },
  // Regime split. Every shaping knob is gated on Mix, and two are gated further: a threshold
  // the cycle never reaches means the split never fires, and the down-branch offset is unread
  // when the window's floor sits below the cycle's own floor.
  { key: 'regimeThreshold', neutral: (v) => v === 0.5, shut: (p) => p.regimeMix <= 0.001,
    why: 'the regime split is dry' },
  { key: 'regimeAsym', neutral: (v) => v === 0, shut: (p) => p.regimeMix <= 0.001,
    why: 'the regime split is dry' },
  { key: 'regimeRail', neutral: (v) => v === 0, shut: (p) => p.regimeMix <= 0.001,
    why: 'the regime split is dry' },
  { key: 'regimeKnee', neutral: (v) => v === 0, shut: (p) => p.regimeMix <= 0.001,
    why: 'the regime split is dry' },
  { key: 'regimeSource', neutral: (v) => v === 0, shut: (p) => p.regimeMix <= 0.001,
    why: 'the regime split is dry, so its rule-B source is unread' },
  // The cycle is peak-normalized to ±1, so a window wider than the wave catches nothing at
  // all: the upper edge is out of reach exactly when asym + threshold ≥ 1, and likewise below.
  { key: 'regimeMix', neutral: (v) => v === 0,
    shut: (p) => p.regimeAsym + p.regimeThreshold >= 1 && p.regimeAsym - p.regimeThreshold <= -1,
    why: 'the window is wider than the cycle, so no sample is ever outside it' },
  { key: 'regimeOffsetUp', neutral: (v) => v === 0,
    shut: (p) => p.regimeMix <= 0.001 || p.regimeAsym + p.regimeThreshold >= 1,
    why: 'the upper branch never fires — its edge is above the cycle peak' },
  { key: 'regimeOffsetDn', neutral: (v) => v === 0.5,
    shut: (p) => p.regimeMix <= 0.001 || p.regimeAsym - p.regimeThreshold <= -1,
    why: 'the lower branch never fires — its edge is below the cycle trough' },
  { key: 'expandRegime', neutral: (v) => v === 0, shut: (p) => p.regimeMix <= 0.001,
    why: 'regime spread displaces the split window, and that module is dry' },
];

/**
 * Whether the arithmetic curve is actually built.
 *
 * It used to have exactly one consumer, so `arithMix > 0` was the whole gate. The regime
 * split is now a second: with rule-B source "number" the curve is computed and spliced into
 * the cycle whether or not it is blended into the main oscillator. Every arith-shaping gate
 * below reads this instead of `arithMix` so those knobs are not reported dead when it is the
 * split, not the blend, that is reading them.
 */
function arithCurveLive(p: SynthParams): boolean {
  return p.arithMix > 0.001 || (p.regimeMix > 0.001 && Math.round(p.regimeSource) === 2);
}

const REF_HZ = midiToFreq(48);

/** Second-order lowpass magnitude, so the master filter shapes the fingerprint too. */
function lowpassMag(freq: number, cutoff: number, q: number): number {
  const w = freq / Math.max(20, cutoff);
  const d = (1 - w * w) ** 2 + (w / Math.max(0.1, q)) ** 2;
  return 1 / Math.sqrt(Math.max(1e-12, d));
}

/**
 * What a patch actually sounds like, to the extent this can be computed offline.
 *
 * Comparing raw `computeFourierSeries` output alone is not enough to call two patches the
 * same: it is blind to the master filter, to the unison expander (which displaces each
 * voice separately), to a number walk (which lives in the genesis stages), and to every
 * effect downstream. So the spectrum here is averaged over the voice stack *and* the walk,
 * shaped by the filter, and paired with a vector of the non-spectral audible settings.
 */
function fingerprint(p: SynthParams) {
  const N = p.harmonicsCount;
  const weights = unisonWeights(Math.max(1, Math.round(p.unisonVoices)), p.expandProfile);
  const seq = arithSequenceActive(p) ? arithSequence(p) : [p.arithValue];
  const mags = new Array<number>(N).fill(0);
  let finite = true;
  let samples = 0;
  for (const w of weights) {
    for (const value of seq) {
      const vp = { ...divergeParams(p, w), arithValue: value } as SynthParams;
      const c = computeFourierSeries(vp, N, STATIC_FLOW, REF_HZ);
      for (let n = 1; n <= N; n++) {
        const m = Math.hypot(c.real[n], c.imag[n]);
        if (!Number.isFinite(m)) finite = false;
        mags[n - 1] += m * lowpassMag(n * REF_HZ, p.cutoff, p.resonance);
      }
      samples++;
    }
  }
  for (let i = 0; i < mags.length; i++) mags[i] /= samples;
  const peak = Math.max(...mags);
  const energy = mags.reduce((a, b) => a + b * b, 0);
  let centroid = 0;
  if (energy > 0) {
    let w = 0;
    for (let i = 0; i < mags.length; i++) w += (i + 1) * mags[i] * mags[i];
    centroid = w / energy / N;
  }
  let odd = 0;
  let even = 0;
  for (let i = 0; i < mags.length; i++) ((i + 1) % 2 ? (odd += mags[i] * mags[i]) : (even += mags[i] * mags[i]));
  // Resample to a fixed length so patches with different harmonic counts stay comparable.
  const PROFILE = 48;
  const profile: number[] = [];
  for (let k = 0; k < PROFILE; k++) {
    const idx = Math.min(mags.length - 1, Math.floor((k * mags.length) / PROFILE));
    profile.push(peak > 0 ? mags[idx] / peak : 0);
  }
  // Everything audible that never reaches computeFourierSeries: the effects chain, the
  // amplitude envelope, the voicing and the field. Two patches with the same partials but a
  // different room and envelope are not duplicates.
  const aux = [
    p.dopplerMix, p.dopplerMode, (p.dopplerShift + 12) / 24, p.dopplerSize, p.dopplerDecay,
    p.dopplerDamp, p.dopplerSpeed, p.dopplerRate / 8,
    p.parityMix, p.parityBias, p.parityDrive, p.parityReso, p.parityReverb, p.parityFormant,
    p.parityVowelUp, p.parityVowelDn, p.parityKeyTrack, p.parityToneUp / 12000, p.parityToneDn / 12000,
    p.fxRouting, p.spaceBoost, p.spaceAngle / (2 * Math.PI), p.volume,
    p.attack / 2, p.decay / 2, p.sustain, p.release / 4,
    p.unisonVoices / 5, p.detune / 35, p.motionDepth, p.extendMix, p.extendBloom,
    p.alphaEnvDepth, p.expandAmount,
  ];
  return { finite, peak, energy, centroid, oddShare: energy > 0 ? odd / (odd + even) : 0, profile, aux };
}

const seenIds = new Map<string, string>();
const seenNames = new Map<string, string>();
const prints: { preset: Preset; fp: ReturnType<typeof fingerprint> }[] = [];

for (const preset of SYNTH_PRESETS) {
  const id = preset.id;
  const p = preset.params;

  if (seenIds.has(id)) err(id, 'duplicate-id', `id also used by ${seenIds.get(id)}`);
  seenIds.set(id, id);
  if (seenNames.has(preset.name)) err(id, 'duplicate-name', `name also used by ${seenNames.get(preset.name)}`);
  seenNames.set(preset.name, id);
  if (!preset.description || preset.description.length < 20) err(id, 'description', 'missing or too short');
  if (!preset.bank) err(id, 'no-bank', 'not listed in BANK_BY_ID, so it would not appear in any bank');
  else if (!(FACTORY_BANKS as readonly string[]).includes(preset.bank)) {
    err(id, 'bad-bank', `bank "${preset.bank}" is not one of ${FACTORY_BANKS.join(', ')}`);
  }

  // Ranges and enums
  for (const key of Object.keys(p) as (keyof SynthParams)[]) {
    const v = p[key] as number;
    if (!Number.isFinite(v)) { err(id, 'non-finite', `${key} = ${v}`); continue; }
    const spec = PARAM_SPECS[key];
    if (spec && (v < spec.min - 1e-9 || v > spec.max + 1e-9)) {
      err(id, 'out-of-range', `${key} = ${v}, spec allows ${spec.min}..${spec.max}`);
    }
    const allowed = ENUMS[key];
    if (allowed && !allowed.includes(v)) {
      err(id, 'bad-enum', `${key} = ${v}, toggle offers ${allowed.join('/')}`);
    }
  }
  if (p.arithMix > 0.001) {
    for (const [i, v] of arithSequence(p).entries()) {
      if (!(v >= 0) || !Number.isFinite(v)) err(id, 'bad-number', `sequence point ${i + 1} = ${v}`);
    }
    if (p.arithBits > ARITH_MAX_BITS) err(id, 'bits', `arithBits ${p.arithBits} exceeds ${ARITH_MAX_BITS}`);
  }

  // Dead knobs
  for (const g of GATES) {
    const v = p[g.key] as number;
    if (!g.neutral(v) && g.shut(p)) warn(id, 'dead-knob', `${g.key} = ${v} but ${g.why}`);
  }

  // Audio sanity
  const fp = fingerprint(p);
  if (!fp.finite) err(id, 'non-finite-spectrum', 'a partial came out NaN or Infinity');
  if (fp.peak < 1e-6) err(id, 'silent', `peak partial ${fp.peak}`);
  if (fp.energy < 1e-8) err(id, 'silent', `total energy ${fp.energy}`);
  prints.push({ preset, fp });

  // Genesis animation must actually animate
  const flows = {
    alpha: p.alphaEnvDepth > 0.001,
    mobius: p.mobiusFlow === 1,
    theta: p.thetaFlow === 1,
    cyclotomic: p.cyclotomicFlow === 1,
  };
  const seqOn = arithSequenceActive(p);
  if (Object.values(flows).some(Boolean) || seqOn) {
    const seq = arithSequence(p);
    const stageAt = (t: number) => {
      const sp = seqOn ? { ...p, arithValue: seq[Math.round(t * (seq.length - 1))] } : p;
      const c = computeFourierSeries(sp, p.harmonicsCount, stageFlow(t, flows), midiToFreq(48));
      const out: number[] = [];
      for (let n = 1; n <= p.harmonicsCount; n++) out.push(Math.hypot(c.real[n], c.imag[n]));
      const pk = Math.max(...out) || 1;
      return out.map((m) => m / pk);
    };
    const first = stageAt(0);
    const last = stageAt(1);
    let d = 0;
    for (let n = 0; n < first.length; n++) d = Math.max(d, Math.abs(first[n] - last[n]));
    if (d < 0.01) warn(id, 'static-genesis', `first and last genesis stages differ by only ${d.toFixed(4)}`);
  }

  // Level sanity: voices are peak-normalized and summed at 1/√n, so a coherent onset can
  // reach volume·√n. Flag patches that would slam the master noticeably harder than the rest.
  const onsetPeak = p.volume * Math.sqrt(Math.max(1, p.unisonVoices));
  if (onsetPeak > 1.45) warn(id, 'level', `worst-case onset peak ≈ ${onsetPeak.toFixed(2)} (volume ${p.volume} × √${p.unisonVoices})`);
}

// Pairwise distinctness: a duplicate has to be close on *both* axes — same shaped spectrum
// across the whole voice stack, and the same everything-else.
for (let i = 0; i < prints.length; i++) {
  for (let j = i + 1; j < prints.length; j++) {
    const a = prints[i], b = prints[j];
    let ds = 0;
    for (let k = 0; k < a.fp.profile.length; k++) ds = Math.max(ds, Math.abs(a.fp.profile[k] - b.fp.profile[k]));
    let da = 0;
    for (let k = 0; k < a.fp.aux.length; k++) da = Math.max(da, Math.abs(a.fp.aux[k] - b.fp.aux[k]));
    if (ds < 0.02 && da < 0.05) {
      err(a.preset.id, 'near-duplicate', `indistinguishable from ${b.preset.id} (spectrum ${ds.toFixed(4)}, settings ${da.toFixed(4)})`);
    }
  }
}

// ── User-slot storage round trip ───────────────────────────────────────────────────────
// A stored patch must survive the schema growing. These are the shapes a real save file can
// actually take once `SynthParams` has gained fields since it was written.
{
  const neutral = SYNTH_PRESETS[0].params;
  const keys = Object.keys(neutral) as (keyof SynthParams)[];
  for (const preset of SYNTH_PRESETS) {
    const round = normalizeParams(JSON.parse(JSON.stringify(preset.params)), neutral);
    for (const k of keys) {
      if (round[k] !== preset.params[k]) {
        err(preset.id, 'slot-roundtrip', `${k} changed on save/load: ${preset.params[k]} -> ${round[k]}`);
      }
    }
  }
  const legacy = { ...SYNTH_PRESETS[0].params } as Record<string, unknown>;
  delete legacy.arithMix;           // saved before the arithmetic oscillator existed
  delete legacy.expandAmount;       // saved before the unison expander existed
  delete legacy.arithSeqCount;      // saved before number walks existed
  legacy.cutoff = 'not a number';   // corrupted entry
  legacy.someRemovedParam = 42;     // a field this build no longer knows
  const healed = normalizeParams(legacy, neutral);
  const missing = keys.filter((k) => typeof healed[k] !== 'number' || !Number.isFinite(healed[k]));
  if (missing.length) err('user-slots', 'slot-roundtrip', `legacy load left ${missing.join(', ')} unusable`);
  if (healed.cutoff !== neutral.cutoff) err('user-slots', 'slot-roundtrip', 'a corrupt value was not replaced by the default');
  if ('someRemovedParam' in healed) err('user-slots', 'slot-roundtrip', 'an unknown key survived the load');
  if (Object.keys(healed).length !== keys.length) err('user-slots', 'slot-roundtrip', 'key count changed');
  console.log(`user-slot round trip: ${SYNTH_PRESETS.length} patches exact, legacy/corrupt saves healed to ${keys.length} valid params`);
}

// ── Bank coverage ──────────────────────────────────────────────────────────────────────
{
  const counts = new Map<string, number>();
  for (const preset of SYNTH_PRESETS) counts.set(preset.bank ?? '(none)', (counts.get(preset.bank ?? '(none)') ?? 0) + 1);
  console.log('banks: ' + FACTORY_BANKS.map((b) => `${b} ${counts.get(b) ?? 0}`).join(' · '));
  for (const b of FACTORY_BANKS) {
    if (!counts.get(b)) err('banks', 'empty-bank', `bank "${b}" has no patches`);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────────────
const bright = prints.filter((x) => x.fp.centroid > 0.12).length;
const oddish = prints.filter((x) => x.fp.oddShare > 0.7).length;
console.log(`Checked ${SYNTH_PRESETS.length} presets.`);
console.log(`  spectral centroid: min ${Math.min(...prints.map((x) => x.fp.centroid)).toFixed(4)}, max ${Math.max(...prints.map((x) => x.fp.centroid)).toFixed(4)}, ${bright} above 0.12`);
console.log(`  odd-harmonic share: min ${Math.min(...prints.map((x) => x.fp.oddShare)).toFixed(3)}, max ${Math.max(...prints.map((x) => x.fp.oddShare)).toFixed(3)}, ${oddish} strongly odd`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  [${w.kind}] ${w.preset}: ${w.detail}`);
}
if (errors.length) {
  console.log(`\n${errors.length} ERROR(s):`);
  for (const e of errors) console.log(`  [${e.kind}] ${e.preset}: ${e.detail}`);
  process.exit(1);
}
console.log(`\nAll ${SYNTH_PRESETS.length} presets valid${warnings.length ? ` (${warnings.length} warnings)` : ''}.`);
