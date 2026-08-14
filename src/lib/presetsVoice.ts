import { Preset, SynthParams } from '../types';

/**
 * Voice-layer preset bank.
 *
 * These demonstrate the four capabilities added after the polar-wave-synth comparison — the
 * per-voice filter envelope, the sub oscillator and noise layer, the morph readout axis, and
 * hand-dialled curve coefficients — and, more to the point, what they do *in combination with*
 * the spectral machinery that was already here. A filter envelope over a cyclotomic anagram is
 * a different instrument from a filter envelope over a sawtooth.
 *
 * The first ten file under a new **Subtractive** bank; the rest join **Arithmetic**, since
 * morph and the coefficient editor are extensions of the number-as-a-curve oscillator.
 */
export function buildVoicePresets(base: SynthParams): Preset[] {
  const p = (
    id: string,
    name: string,
    description: string,
    over: Partial<SynthParams>
  ): Preset => ({ id, name, description, params: { ...base, ...over } });

  /** Editable coefficient pairs, written positionally: d[] then e[]. */
  const coeffs = (d: number[], e: number[]): Partial<SynthParams> => {
    const out: Record<string, number> = { arithCoeffMode: 1 };
    for (let k = 1; k <= 8; k++) {
      out[`arithD${k}`] = d[k - 1] ?? 0;
      out[`arithE${k}`] = e[k - 1] ?? 0;
    }
    return out as Partial<SynthParams>;
  };

  return [
    // ── Subtractive · filter envelope, sub oscillator, noise ────────────────────────────
    p(
      'envelope-pluck',
      'Envelope Pluck',
      'The plainest demonstration of the new filter envelope: three octaves of upward sweep collapsing to nothing in a quarter second, over a bent saw with a sub underneath.',
      {
        bendPosition: 0.72, bendAmount: 0.9, bend2Position: 0.3, bend2Amount: -0.35,
        cutoff: 420, resonance: 4.5,
        filterEnvAmount: 3.2, filterEnvAttack: 0.006, filterEnvDecay: 0.24, filterEnvSustain: 0.0,
        subGain: 0.45, subWave: 0, subOctave: 0,
        attack: 0.005, decay: 0.3, sustain: 0.45, release: 0.35,
        unisonVoices: 2, detune: 6, volume: 0.66,
      }
    ),
    p(
      'acid-sieve',
      'Acid Sieve',
      'A resonant sweep on a comb-gated spectrum — the filter climbs through partials that arithmetic has already punched holes in, so the resonance finds a different note on every harmonic it passes.',
      {
        bendPosition: 0.85, bendAmount: 1.0, bend2Position: 0.4, bend2Amount: 0.2,
        collatzGating: 0.6, valuationBase: 13, combModulus: 30,
        operatorFocus: 0.3, operatorWidth: 3.5,
        cutoff: 260, resonance: 8.5,
        filterEnvAmount: 3.6, filterEnvAttack: 0.008, filterEnvDecay: 0.42, filterEnvSustain: 0.12,
        subGain: 0.3, subWave: 1,
        attack: 0.005, decay: 0.35, sustain: 0.5, release: 0.25,
        unisonVoices: 1, volume: 0.62,
      }
    ),
    p(
      'breath-attack-keys',
      'Breath Attack Keys',
      'Noise through the same envelope and filter as the tone, so the burst of air at the onset is shaped by the sweep rather than sitting on top of it.',
      {
        bendPosition: 0.5, bendAmount: 0.55, bend2Position: 0.68, bend2Amount: -0.3,
        modIndex: 0.6, modRatio: 3,
        noiseGain: 0.28, subGain: 0.2, subWave: 2,
        cutoff: 900, resonance: 3.0,
        filterEnvAmount: 2.4, filterEnvAttack: 0.005, filterEnvDecay: 0.18, filterEnvSustain: 0.25,
        attack: 0.005, decay: 0.4, sustain: 0.4, release: 0.5,
        unisonVoices: 2, detune: 5, dopplerMix: 0.22, volume: 0.6,
      }
    ),
    p(
      'closing-pad',
      'Closing Pad',
      'A downward envelope — the filter starts open and shuts two octaves as the note settles, so the pad darkens into itself instead of blooming.',
      {
        bendPosition: 0.4, bendAmount: 0.6, bend2Position: 0.75, bend2Amount: 0.5,
        cutoff: 5200, resonance: 1.4,
        filterEnvAmount: -2.2, filterEnvAttack: 0.5, filterEnvDecay: 1.6, filterEnvSustain: 0.55,
        subGain: 0.25, subWave: 0, subOctave: 1,
        attack: 0.6, decay: 1.4, sustain: 0.7, release: 2.2,
        unisonVoices: 4, detune: 12, dopplerMix: 0.3, spaceBoost: 0.2, volume: 0.55,
      }
    ),
    p(
      'sub-anchored-bass',
      'Sub Anchored Bass',
      'Two octaves of sine sub under a folded bass, with the filter envelope doing the articulation — the fundamental never moves while everything above it is swept.',
      {
        bendPosition: 0.2, bendAmount: -0.65, bend2Position: 0.66, bend2Amount: 0.55,
        modIndex: 0.8, modRatio: 1.5, harmonicsCount: 64,
        spectralFold: 0.4, foldPeriod: 5, lowCouple: 0.35,
        subGain: 0.7, subWave: 0, subOctave: 1,
        cutoff: 320, resonance: 3.6,
        filterEnvAmount: 2.6, filterEnvAttack: 0.01, filterEnvDecay: 0.3, filterEnvSustain: 0.2,
        attack: 0.008, decay: 0.3, sustain: 0.6, release: 0.3,
        fxRouting: 1, parityMix: 0.25, parityDrive: 0.5,
        unisonVoices: 1, volume: 0.68,
      }
    ),
    p(
      'noise-wash-drone',
      'Noise Wash Drone',
      'Noise held at sustain rather than used as a transient, filtered slowly downward and sent into a large moving room — the tone is almost incidental to the air.',
      {
        noiseGain: 0.4, subGain: 0.3, subWave: 2, subOctave: 1,
        bendPosition: 0.45, bendAmount: 0.35,
        thetaHeat: 0.3, thetaPhase: 0.2,
        cutoff: 2400, resonance: 2.2,
        filterEnvAmount: -1.6, filterEnvAttack: 1.4, filterEnvDecay: 1.8, filterEnvSustain: 0.4,
        attack: 1.6, decay: 2.0, sustain: 0.85, release: 3.4,
        harmonicsCount: 80, unisonVoices: 3, detune: 10,
        dopplerMix: 0.5, dopplerSize: 0.9, dopplerDecay: 0.85, volume: 0.5,
      }
    ),
    p(
      'square-sub-stab',
      'Square Sub Stab',
      'A hollow square sub an octave down doubling a short stab, with a fast resonant snap on top and the parity rails adding grit.',
      {
        bendPosition: 0.62, bendAmount: 0.85, bend2Position: 0.28, bend2Amount: -0.5,
        bendAngle: 2.1, modIndex: 1.1, modRatio: 2,
        subGain: 0.6, subWave: 1, subOctave: 0,
        cutoff: 500, resonance: 6.0,
        filterEnvAmount: 2.8, filterEnvAttack: 0.005, filterEnvDecay: 0.13, filterEnvSustain: 0.0,
        attack: 0.005, decay: 0.16, sustain: 0.25, release: 0.2,
        fxRouting: 1, parityMix: 0.4, parityDrive: 0.6, parityBias: -0.2,
        unisonVoices: 2, detune: 8, volume: 0.65,
      }
    ),
    p(
      'anagram-sweep',
      'Anagram Sweep',
      'The filter envelope climbing across a spectrum whose partials have been permuted — the sweep passes the harmonics in scrambled order, so the timbre arrives out of sequence.',
      {
        cyclotomicMix: 0.85, cyclotomicPower: 0.7, cyclotomicAction: 0,
        thetaPhase: 0.3, harmonicsCount: 96,
        cutoff: 380, resonance: 5.5,
        filterEnvAmount: 3.8, filterEnvAttack: 0.35, filterEnvDecay: 0.9, filterEnvSustain: 0.3,
        subGain: 0.25, subWave: 0,
        attack: 0.02, decay: 0.6, sustain: 0.6, release: 0.9,
        unisonVoices: 3, detune: 9, dopplerMix: 0.25, volume: 0.6,
      }
    ),
    p(
      'genesis-filter-bloom',
      'Genesis Filter Bloom',
      'Two envelopes arriving at once on different clocks: the Möbius flow rebuilds the spectrum over the attack while the filter opens three octaves underneath it.',
      {
        mobiusBoost: 0.45, mobiusRotate: 1.8, mobiusFlow: 1,
        extendMix: 0.4, extendTime: 1.6, extendBloom: 1,
        cutoff: 600, resonance: 2.8,
        filterEnvAmount: 3.0, filterEnvAttack: 0.7, filterEnvDecay: 1.2, filterEnvSustain: 0.5,
        noiseGain: 0.1,
        attack: 0.7, decay: 1.3, sustain: 0.7, release: 1.8,
        harmonicsCount: 96, unisonVoices: 4, detune: 11,
        dopplerMix: 0.32, spaceBoost: 0.2, volume: 0.55,
      }
    ),
    p(
      'full-voice-lead',
      'Full Voice Lead',
      'Everything the voice layer now offers at once — sub, noise, a resonant sweep — driving a lead whose spectrum is also being tilted per unison voice by the expander.',
      {
        bendPosition: 0.78, bendAmount: 0.95, bend2Position: 0.35, bend2Amount: -0.4,
        bendAngle: 1.2, modIndex: 1.4, modRatio: 2.5,
        subGain: 0.35, subWave: 1, noiseGain: 0.12,
        thetaPhase: 0.4, harmonicsCount: 88,
        cutoff: 700, resonance: 4.2,
        filterEnvAmount: 2.9, filterEnvAttack: 0.01, filterEnvDecay: 0.5, filterEnvSustain: 0.35,
        attack: 0.008, decay: 0.35, sustain: 0.65, release: 0.5,
        unisonVoices: 4, detune: 10,
        expandAmount: 0.7, expandProfile: 1, expandTheta: 0.5, expandTilt: 0.4,
        dopplerMix: 0.25, volume: 0.58,
      }
    ),

    // ── Arithmetic · morph readout and hand-dialled coefficients ────────────────────────
    p(
      'morph-axis-pad',
      'Morph Axis Pad',
      'The readout axis parked halfway between real and imaginary on the geodesic path — unit-gain mid-blend, a waveform neither extraction reaches on its own.',
      {
        arithMix: 0.9, arithValue: 1.618033988749895, arithBits: 40, arithSwell: 0.85,
        arithMap: 3, arithWarp: 0.5, arithAngle: 2.4,
        arithExtract: 3, arithMorph: 0.5, arithMorphMode: 1,
        cutoff: 4200, resonance: 1.6,
        filterEnvAmount: 1.8, filterEnvAttack: 0.5, filterEnvDecay: 1.2, filterEnvSustain: 0.6,
        attack: 0.5, decay: 1.2, sustain: 0.7, release: 2.0,
        harmonicsCount: 96, unisonVoices: 4, detune: 11,
        dopplerMix: 0.3, spaceBoost: 0.18, volume: 0.55,
      }
    ),
    p(
      'morph-walk',
      'Morph Walk',
      'Four numbers walked across the envelope while the readout sits at a three-quarter rotation — the same axis reading four different curves as the note ages.',
      {
        arithMix: 1.0, arithValue: 2.5, arithValue2: 4.25, arithValue3: 8.125,
        arithValue4: 16.0625, arithSeqCount: 4,
        arithBits: 32, arithSwell: 1.0, arithMap: 1, arithWarp: 0.55, arithAngle: 1.8,
        arithExtract: 3, arithMorph: 0.75,
        cutoff: 5000, resonance: 2.0,
        filterEnvAmount: 2.0, filterEnvAttack: 0.4, filterEnvDecay: 1.0, filterEnvSustain: 0.45,
        attack: 0.4, decay: 1.0, sustain: 0.65, release: 1.8,
        harmonicsCount: 88, unisonVoices: 3, detune: 8, dopplerMix: 0.25, volume: 0.58,
      }
    ),
    p(
      'hand-drawn-curve',
      'Hand Drawn Curve',
      'Coefficients dialled rather than derived: a strong fundamental, a negative third and a floating sixth in the log radius — a shape no binary expansion can write, since bits are only ever 0 or 1.',
      {
        arithMix: 1.0, arithSwell: 0.95, arithDecay: 0.9, arithMap: 0,
        ...coeffs([1.0, 0, -0.65, 0, 0.3, -0.45, 0, 0.2], [0, 0.5, 0, -0.35, 0, 0, 0.25, 0]),
        cutoff: 6500, resonance: 1.8,
        filterEnvAmount: 1.5, filterEnvAttack: 0.01, filterEnvDecay: 0.6, filterEnvSustain: 0.4,
        attack: 0.01, decay: 0.5, sustain: 0.55, release: 0.7,
        harmonicsCount: 80, unisonVoices: 2, detune: 6, volume: 0.62,
      }
    ),
    p(
      'even-only-curve',
      'Even Harmonic Curve',
      'Only even coefficients set, so the log radius repeats twice per turn and the curve closes on itself at half a lap — a doubled, hollow character from geometry rather than filtering.',
      {
        arithMix: 1.0, arithSwell: 1.1, arithDecay: 0.75, arithMap: 2, arithWarp: 0.35,
        ...coeffs([0, 0.9, 0, 0.55, 0, 0.35, 0, 0.2], [0, -0.4, 0, 0.3, 0, -0.2, 0, 0.15]),
        arithExtract: 1,
        cutoff: 7000, resonance: 2.2,
        subGain: 0.3, subWave: 0,
        attack: 0.01, decay: 0.45, sustain: 0.5, release: 0.6,
        harmonicsCount: 96, unisonVoices: 3, detune: 7, dopplerMix: 0.24, volume: 0.6,
      }
    ),
    p(
      'digit-seeded-drone',
      'Digit Seeded Drone',
      "π's decimal digits mapped onto ±1 rather than read as bits — the same number, a far richer curve, because continuous coefficients reach shapes a binary expansion cannot.",
      {
        arithMix: 1.0, arithValue: 3.141592653589793, arithSwell: 1.0, arithDecay: 1.1,
        arithMap: 3, arithWarp: 0.45, arithAngle: 3.4,
        ...coeffs([-0.33, 0.11, -0.22, 0.11, -0.11, 0.56, -0.11, 0.78],
                  [-0.11, -0.11, 0.11, 0.11, 0.33, -0.33, 0.78, -0.11]),
        extendMix: 0.45, extendTime: 2.8, extendBloom: 1,
        cutoff: 5400, resonance: 1.5,
        filterEnvAmount: -1.4, filterEnvAttack: 1.0, filterEnvDecay: 1.6, filterEnvSustain: 0.5,
        attack: 1.2, decay: 1.8, sustain: 0.8, release: 3.0,
        harmonicsCount: 104, unisonVoices: 4, detune: 12,
        dopplerMix: 0.4, dopplerSize: 0.85, spaceBoost: 0.25, volume: 0.52,
      }
    ),
    p(
      'sparse-two-tone',
      'Sparse Two Tone',
      'Two coefficients and nothing else — a single cosine and a single sine, three harmonics apart — showing how little the curve needs before the conformal map does the rest of the work.',
      {
        arithMix: 1.0, arithSwell: 1.25, arithDecay: 0.6,
        ...coeffs([0.85, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0.7, 0, 0, 0, 0]),
        arithMap: 1, arithWarp: 0.8, arithAngle: 0.7, arithExtract: 3, arithMorph: 0.35,
        cutoff: 8000, resonance: 2.6,
        filterEnvAmount: 2.2, filterEnvAttack: 0.006, filterEnvDecay: 0.28, filterEnvSustain: 0.15,
        attack: 0.005, decay: 0.26, sustain: 0.45, release: 0.4,
        harmonicsCount: 72, unisonVoices: 2, detune: 7,
        expandAmount: 0.5, expandTheta: 0.5, volume: 0.63,
      }
    ),
    p(
      'sc-hex-notch',
      'SC Hex Notch',
      'Schwarz–Christoffel hexagon: six prevertices, three sharp corners and a reflex notch — a spectrum no Fourier-in-log-r curve can reach, because the poles sit at the preimages.',
      {
        arithMix: 1.0, arithMap: 4, arithSwell: 0.15, arithWarp: 0.75, arithAngle: 0.55,
        ...coeffs(
          [0.1, 0.0, 0.25, -0.15, 0.05, -0.2, 0, 0],
          [-0.95, -0.75, 1.0, -0.45, -0.55, 0.9, 0, 0]
        ),
        arithExtract: 0,
        cutoff: 4800, resonance: 2.4,
        filterEnvAmount: 2.0, filterEnvAttack: 0.008, filterEnvDecay: 0.35, filterEnvSustain: 0.25,
        subGain: 0.35, subWave: 0, subOctave: 0,
        attack: 0.01, decay: 0.4, sustain: 0.55, release: 0.8,
        harmonicsCount: 96, unisonVoices: 2, detune: 5,
        fxRouting: 1, volume: 0.6,
      }
    ),
  ];
}
