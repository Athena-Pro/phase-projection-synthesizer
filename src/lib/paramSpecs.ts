import { SynthParams } from '../types';

export interface ParamSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round((v * 180) / Math.PI)}°`;
/** Degrees for a value already expressed in cycles (0..1) rather than radians. */
const deg2 = (v: number) => `${Math.round(v * 360)}°`;
const f2 = (v: number) => v.toFixed(2);
const VOWEL_NAMES = ['A', 'E', 'I', 'O', 'U'];
const vowel = (v: number) => VOWEL_NAMES[Math.round(v * (VOWEL_NAMES.length - 1))];

/** Range, default, and display formatting for every knob-controlled parameter. */
export const PARAM_SPECS: Partial<Record<keyof SynthParams, ParamSpec>> = {
  bendPosition: { label: 'Bend A', min: 0.05, max: 0.95, step: 0.01, defaultValue: 0.9, format: pct },
  bendAmount: { label: 'Amt A', min: -1, max: 1, step: 0.02, defaultValue: 1, format: f2 },
  bend2Position: { label: 'Bend B', min: 0.05, max: 0.95, step: 0.01, defaultValue: 0.4, format: pct },
  bend2Amount: { label: 'Amt B', min: -1, max: 1, step: 0.02, defaultValue: 0, format: f2 },
  bendAngle: { label: 'Angle Φ', min: 0, max: 2 * Math.PI, step: 0.05, defaultValue: 0, format: deg },
  modIndex: { label: 'PM Index', min: 0, max: 10, step: 0.05, defaultValue: 0, format: f2 },
  modRatio: { label: 'PM Ratio', min: 0.1, max: 12, step: 0.1, defaultValue: 1, format: (v) => `${v.toFixed(2)}×` },
  arithMix: { label: 'Number', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  arithBits: { label: 'Bits', min: 1, max: 52, step: 1, defaultValue: 24, format: (v) => `${v}b` },
  arithDecay: { label: 'Falloff s', min: 0.25, max: 2, step: 0.01, defaultValue: 1, format: f2 },
  arithSwell: { label: 'Swell', min: 0, max: 1.5, step: 0.01, defaultValue: 0.7, format: f2 },
  arithSeqCount: { label: 'Sequence', min: 1, max: 4, step: 1, defaultValue: 1, format: (v) => (v <= 1 ? 'static' : `${v} pts`) },
  arithMorph: { label: 'Morph α', min: 0, max: 1, step: 0.01, defaultValue: 0.5, format: (v) => (v <= 0 ? 'Re' : v >= 1 ? 'Im' : `${Math.round(v * 100)}%`) },
  filterEnvAmount: { label: 'Env Amt', min: -4, max: 4, step: 0.05, defaultValue: 0, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}oct` },
  // Min 0, not 0.005: a drum wants the filter open on the sample it starts, and the engine
  // already floors the ramp at 1 ms (`Math.max(0.001, p.filterEnvAttack)`), so the rail was
  // keeping a reachable setting out of the UI for no gain.
  filterEnvAttack: { label: 'Env Atk', min: 0, max: 2, step: 0.005, defaultValue: 0.02, format: (v) => (v <= 0 ? 'instant' : `${v.toFixed(3)}s`) },
  filterEnvDecay: { label: 'Env Dec', min: 0.005, max: 2, step: 0.005, defaultValue: 0.35, format: (v) => `${v.toFixed(3)}s` },
  filterEnvSustain: { label: 'Env Sus', min: 0, max: 1, step: 0.01, defaultValue: 0.3, format: pct },
  subGain: { label: 'Sub', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  // Max 1, matching `subGain`: the two are siblings summed into the same voice gain, and
  // `transientNoise` on that node already reaches 1, so the old 0.5 ceiling was arbitrary —
  // it just made a noise-led patch (a snare) impossible to write.
  noiseGain: { label: 'Noise', min: 0, max: 1, step: 0.005, defaultValue: 0, format: pct },
  arithWarp: { label: 'Warp', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  arithAngle: { label: 'Warp Dir', min: 0, max: 2 * Math.PI, step: 0.05, defaultValue: 0, format: deg },
  crossMix: { label: 'Mix', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  crossPhase: { label: 'Phase', min: 0, max: 2 * Math.PI, step: 0.05, defaultValue: 0, format: deg },
  crossShear: { label: 'Shear k', min: -8, max: 8, step: 1, defaultValue: 0, format: (v) => (v > 0 ? `+${v}` : `${v}`) },
  crossConvolve: { label: 'Convolve', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  crossWedge: { label: 'Wedge', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  crossDifference: { label: 'Difference', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  mobiusRotate: { label: 'Rotate θ', min: 0, max: 2 * Math.PI, step: 0.05, defaultValue: 0, format: deg },
  mobiusBoost: { label: 'Boost', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  mobiusTilt: { label: 'Tilt φ', min: -1, max: 1, step: 0.01, defaultValue: 0, format: (v) => deg((v * Math.PI) / 2) },
  mobiusParabolic: { label: 'Cusp', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  harmonicExponent: { label: 'Power d', min: 0.25, max: 4, step: 0.01, defaultValue: 1, format: (v) => `${v.toFixed(2)}×` },
  circulantOperatorStrength: { label: 'Circulant', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  circulantKernelShift: { label: 'Kernel', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  collatzGating: { label: 'Comb', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  combModulus: { label: 'Modulus', min: 2, max: 512, step: 1, defaultValue: 30, format: (v) => `M${v}` },
  padicTilt: { label: 'p-Tilt', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  dirichletTwist: { label: 'χ Twist', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  dirichletOrder: { label: 'χ Order', min: 0, max: 1, step: 0.01, defaultValue: 0.5, format: f2 },
  heckeMix: { label: 'Tₚ Mix', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  heckeWeight: { label: 'Weight w', min: 0, max: 2, step: 0.01, defaultValue: 1, format: f2 },
  thetaPhase: { label: 'θ Phase', min: 0, max: 2, step: 0.001, defaultValue: 0, format: f2 },
  thetaHeat: { label: 'θ Heat', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  cyclotomicMix: { label: 'Anagram', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  cyclotomicPower: { label: 'Orbit t', min: 0, max: 1, step: 0.01, defaultValue: 1, format: f2 },
  operatorFocus: { label: 'Focus', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  operatorWidth: { label: 'Width', min: 0.25, max: 8, step: 0.05, defaultValue: 8, format: (v) => (v >= 7.95 ? 'all' : `${v.toFixed(2)}oct`) },
  lowCouple: { label: 'Low Couple', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  focusTrack: { label: 'Focus Track', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  spectralFold: { label: 'Downfold', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  foldPeriod: { label: 'Fold K', min: 2, max: 16, step: 1, defaultValue: 8, format: (v) => `K${v}` },
  interfere: { label: 'Interfere', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  regimeMix: { label: 'Regime', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  regimeThreshold: { label: 'Window', min: 0.05, max: 1, step: 0.01, defaultValue: 0.5, format: f2 },
  regimeAsym: { label: 'Offset', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  regimeRail: { label: 'Rail', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  regimeOffsetUp: { label: 'Skip ↑', min: 0, max: 1, step: 0.01, defaultValue: 0, format: deg2 },
  regimeOffsetDn: { label: 'Skip ↓', min: 0, max: 1, step: 0.01, defaultValue: 0.5, format: deg2 },
  regimeKnee: { label: 'Knee', min: 0, max: 1, step: 0.01, defaultValue: 0, format: (v) => (v <= 0 ? 'hard' : pct(v)) },
  zeroStretch: { label: 'Stretch', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  zeroInsert: { label: 'Insert', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  frftAngle: { label: 'α Angle', min: 0, max: 4, step: 0.005, defaultValue: 0, format: (v) => `${(v * 90).toFixed(1)}°` },
  frftSqueeze: { label: 'Squeeze', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  frftShear: { label: 'Chirp', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  frftMix: { label: 'α Mix', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  alphaEnvDepth: { label: 'α Env', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  alphaEnvTime: { label: 'α Time', min: 0.01, max: 4, step: 0.01, defaultValue: 0.3, format: (v) => `${v.toFixed(2)}s` },
  extendMix: { label: 'Extend', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  extendTime: { label: 'Ext Time', min: 0.05, max: 6, step: 0.05, defaultValue: 0.8, format: (v) => `${v.toFixed(2)}s` },
  extendSkew: { label: 'Ext Skew', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  motionRate: { label: 'Rate', min: 0.05, max: 8, step: 0.05, defaultValue: 0.5, format: (v) => `${v.toFixed(2)}Hz` },
  motionDepth: { label: 'Depth', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  harmonicsCount: { label: 'Partials', min: 4, max: 128, step: 4, defaultValue: 64, format: (v) => `${v}` },
  cutoff: { label: 'Cutoff', min: 100, max: 12000, step: 50, defaultValue: 5000, format: (v) => `${v}Hz` },
  resonance: { label: 'Reso Q', min: 0.1, max: 10, step: 0.1, defaultValue: 1.5, format: (v) => v.toFixed(1) },
  attack: { label: 'Attack', min: 0.005, max: 2, step: 0.005, defaultValue: 0.05, format: (v) => `${v.toFixed(2)}s` },
  decay: { label: 'Decay', min: 0.05, max: 2, step: 0.05, defaultValue: 0.2, format: (v) => `${v.toFixed(2)}s` },
  sustain: { label: 'Sustain', min: 0, max: 1, step: 0.05, defaultValue: 0.6, format: pct },
  release: { label: 'Release', min: 0.01, max: 4, step: 0.05, defaultValue: 0.3, format: (v) => `${v.toFixed(2)}s` },
  transientPunch: { label: 'Punch', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  transientNoise: { label: 'Snap', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  unisonVoices: { label: 'Unison', min: 1, max: 5, step: 1, defaultValue: 2, format: (v) => `${v}×` },
  detune: { label: 'Detune', min: 0, max: 35, step: 1, defaultValue: 8, format: (v) => `${v}¢` },
  expandAmount: { label: 'Diverge', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandTheta: { label: 'θ Spread', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandOrbit: { label: 'Orbit Spr', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandTilt: { label: 'Tilt Spr', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandFocus: { label: 'Band Spr', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandAlpha: { label: 'α Spread', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  expandRegime: { label: 'Regime Spr', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  spaceBoost: { label: 'Dominance', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  spaceAngle: { label: 'Space Dir', min: 0, max: 2 * Math.PI, step: 0.05, defaultValue: 0, format: deg },
  dopplerMix: { label: 'Reverb', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  dopplerSpeed: { label: 'Wall Spd', min: 0, max: 1, step: 0.01, defaultValue: 0.4, format: pct },
  dopplerRate: { label: 'Wall Rate', min: 0.05, max: 8, step: 0.05, defaultValue: 0.8, format: (v) => `${v.toFixed(2)}Hz` },
  dopplerShift: { label: 'Shift', min: -12, max: 12, step: 0.5, defaultValue: 12, format: (v) => `${v > 0 ? '+' : ''}${v}st` },
  dopplerSize: { label: 'Room', min: 0, max: 1, step: 0.01, defaultValue: 0.5, format: pct },
  dopplerDecay: { label: 'Tail', min: 0, max: 1, step: 0.01, defaultValue: 0.6, format: pct },
  dopplerDamp: { label: 'Damp', min: 0, max: 1, step: 0.01, defaultValue: 0.4, format: pct },
  fxRouting: { label: 'FX Route', min: 0, max: 1, step: 1, defaultValue: 0, format: (v) => (v >= 0.5 ? 'pre' : 'post') },
  parityMix: { label: 'Split', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  parityBias: { label: 'Bias', min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 },
  parityToneUp: { label: 'Tone ↑', min: 100, max: 12000, step: 50, defaultValue: 6000, format: (v) => `${v}Hz` },
  parityToneDn: { label: 'Tone ↓', min: 100, max: 12000, step: 50, defaultValue: 1200, format: (v) => `${v}Hz` },
  parityDrive: { label: 'Drive', min: 0, max: 1, step: 0.01, defaultValue: 0.3, format: pct },
  parityReso: { label: 'Rail Q', min: 0, max: 1, step: 0.01, defaultValue: 0.2, format: pct },
  parityReverb: { label: '↑ Reverb', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  parityFormant: { label: 'Formant', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  parityVowelUp: { label: 'Vowel ↑', min: 0, max: 1, step: 0.01, defaultValue: 0, format: vowel },
  parityVowelDn: { label: 'Vowel ↓', min: 0, max: 1, step: 0.01, defaultValue: 0.5, format: vowel },
  parityKeyTrack: { label: 'Key Track', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  volume: { label: 'Master', min: 0, max: 1, step: 0.01, defaultValue: 0.7, format: pct },
};

/** How many editable coefficient pairs the arithmetic curve exposes (harmonics k = 1..N). */
export const ARITH_COEFF_PAIRS = 8;

// The editable curve coefficients are mechanical, so their specs are generated rather than
// written out. They land in PARAM_SPECS like any other knob, which is what makes each one
// MIDI-learnable and LFO-assignable individually.
for (let k = 1; k <= ARITH_COEFF_PAIRS; k++) {
  const specs = PARAM_SPECS as Record<string, ParamSpec>;
  specs[`arithD${k}`] = { label: `d${k}`, min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 };
  specs[`arithE${k}`] = { label: `e${k}`, min: -1, max: 1, step: 0.01, defaultValue: 0, format: f2 };
}
