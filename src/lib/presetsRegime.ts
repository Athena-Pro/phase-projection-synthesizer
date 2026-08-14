import { Preset, SynthParams } from '../types';

/**
 * Regime-split bank.
 *
 * The split is the one operator here that is not a group action — it is a non-invertible,
 * state-conditional cut of the cycle — so these patches are built to show what that buys
 * that the invertible family cannot reach, and then what it does *in combination with* the
 * invertible family, which is where it stops being a novelty.
 *
 * The first five isolate the module against a plain bent saw: the four rule-B sources, and
 * the knee opening a hard switch into a continuous morph. The rest put a regime-cut cycle
 * through the operators that follow it in the chain — a cut spectrum is still just a
 * spectrum, so the anagram, the Talbot phase, the Hecke coupling and the sieve all apply to
 * it unchanged, which is exactly the argument for doing the split before the projection.
 *
 * Same two rules as every other bank, both enforced by `scripts/checkPresets.ts`: no dead
 * knobs, and no patch indistinguishable from another.
 */
export function buildRegimePresets(base: SynthParams): Preset[] {
  const p = (
    id: string,
    name: string,
    description: string,
    over: Partial<SynthParams>
  ): Preset => ({ id, name, description, params: { ...base, ...over } });

  return [
    // ── Isolated: the module against a plain bent saw ───────────────────────────────────
    p(
      'regime-hard-cut',
      'Hard Cut',
      'The split at its plainest: a bent saw whose peaks are replaced outright by the bend-A layer a quarter cycle along, with a rail step at the crossover. Hard knee, so the cut is a genuine discontinuity — and because it happens before the projection, all of that edge energy lands on the harmonic grid instead of folding back as hash.',
      {
        bendPosition: 0.82, bendAmount: 0.95, bendAngle: 1.9, bend2Amount: 0.5,
        regimeMix: 0.9, regimeThreshold: 0.34, regimeRail: 0.32,
        regimeOffsetUp: 0.25, regimeOffsetDn: 0.5, regimeKnee: 0, regimeSource: 0,
        harmonicsCount: 96, cutoff: 7000, resonance: 1.4,
        attack: 0.006, decay: 0.28, sustain: 0.5, release: 0.3,
        unisonVoices: 2, detune: 7, volume: 0.62,
      }
    ),
    p(
      'regime-soft-knee',
      'Soft Knee',
      'The same cut with the knee wide open. The switch becomes a smoothstep crossfade over a band around the threshold, so the two rules blend instead of colliding — the top octave of hash disappears and what is left is a wave that leans into its second rule rather than snapping to it.',
      {
        bendPosition: 0.82, bendAmount: 0.95, bendAngle: 1.9, bend2Amount: 0.5,
        regimeMix: 0.9, regimeThreshold: 0.34, regimeRail: 0.32,
        regimeOffsetUp: 0.25, regimeOffsetDn: 0.5, regimeKnee: 0.75, regimeSource: 0,
        harmonicsCount: 96, cutoff: 6000, resonance: 1.2,
        attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.5,
        unisonVoices: 3, detune: 9, volume: 0.6,
      }
    ),
    p(
      'regime-self-splice',
      'Self Splice',
      'Rule B is the cycle itself, half a lap displaced, so the wave is spliced against a phase-shifted copy of its own body. This is the closest thing here to a time-domain regime oscillator swapping between two phases of one rule — and unlike one, it cannot alias.',
      {
        bendPosition: 0.68, bendAmount: 0.85, bendAngle: 2.6, bend2Amount: -0.4,
        regimeMix: 1.0, regimeThreshold: 0.28, regimeAsym: -0.1, regimeRail: -0.25,
        regimeOffsetUp: 0.5, regimeOffsetDn: 0.18, regimeKnee: 0.12, regimeSource: 3,
        harmonicsCount: 112, cutoff: 8500, resonance: 1.8,
        attack: 0.005, decay: 0.5, sustain: 0.4, release: 0.4,
        unisonVoices: 2, detune: 5, volume: 0.6,
      }
    ),
    p(
      'regime-number-above',
      'Number Above the Line',
      'A bent saw below the window and π read as a closed curve above it: the wave is an ordinary sawtooth until it exceeds the threshold, whereupon it is briefly the boundary of a number. Two entirely different shape spaces sharing one cycle, switched by amplitude.',
      {
        bendPosition: 0.75, bendAmount: 0.9, bendAngle: 1.4, bend2Amount: 0.35,
        arithMix: 0.0, arithValue: 3.141592653589793, arithBits: 32, arithSwell: 1.0,
        arithMap: 1, arithWarp: 0.45, arithAngle: 2.1, arithDecay: 1.15,
        regimeMix: 0.85, regimeThreshold: 0.3, regimeAsym: 0.12, regimeRail: 0.2,
        regimeOffsetUp: 0.1, regimeOffsetDn: 0.6, regimeKnee: 0.25, regimeSource: 2,
        harmonicsCount: 104, cutoff: 6500, resonance: 2.0,
        attack: 0.01, decay: 0.55, sustain: 0.45, release: 0.6,
        unisonVoices: 3, detune: 8, volume: 0.6,
      }
    ),
    p(
      'regime-window-walk',
      'Window Walk',
      'Offset parked well off centre, so only the deep troughs are ever caught and the wave spends most of its lap in the first rule. A narrow window low on the waveform is what turns the split from a timbre into an event — a short burst of the second rule once per cycle.',
      {
        bendPosition: 0.9, bendAmount: 1.0, bendAngle: 3.1, bend2Amount: 0.65,
        regimeMix: 0.95, regimeThreshold: 0.18, regimeAsym: -0.55, regimeRail: 0.55,
        regimeOffsetUp: 0.4, regimeOffsetDn: 0.72, regimeKnee: 0.06, regimeSource: 1,
        harmonicsCount: 88, cutoff: 4200, resonance: 3.2,
        filterEnvAmount: 1.6, filterEnvAttack: 0.008, filterEnvDecay: 0.3, filterEnvSustain: 0.2,
        subGain: 0.35, subWave: 0, subOctave: 0,
        attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.25,
        unisonVoices: 2, detune: 6, volume: 0.64,
      }
    ),

    // ── Crossed: a cut cycle through the operators downstream of it ─────────────────────
    p(
      'regime-anagram',
      'Cut and Anagram',
      'The split plants a broad edge spectrum; the cyclotomic permutation then reindexes those partials by a primitive root. The anagram preserves the amplitude multiset, so the cut decides how bright the note is and the permutation decides where that brightness sits — two knobs that do not fight.',
      {
        bendPosition: 0.78, bendAmount: 0.88, bendAngle: 2.2, bend2Amount: 0.45,
        regimeMix: 0.8, regimeThreshold: 0.32, regimeRail: 0.28,
        regimeOffsetUp: 0.3, regimeOffsetDn: 0.5, regimeKnee: 0.1, regimeSource: 0,
        cyclotomicMix: 0.7, cyclotomicPower: 0.6, cyclotomicAction: 0,
        harmonicsCount: 96, cutoff: 7500, resonance: 1.3,
        attack: 0.008, decay: 0.6, sustain: 0.35, release: 0.7,
        unisonVoices: 3, detune: 10, volume: 0.58,
      }
    ),
    p(
      'regime-talbot',
      'Cut Talbot',
      'A hard cut under a rational theta phase. The split is amplitude surgery and the Talbot phase is pure phase, so the revival structure rearranges the cut waveform without touching how bright it is — the same partials, re-imaged.',
      {
        bendPosition: 0.7, bendAmount: 0.8, bendAngle: 1.6, bend2Amount: -0.5,
        regimeMix: 0.85, regimeThreshold: 0.26, regimeAsym: 0.08, regimeRail: -0.35,
        regimeOffsetUp: 0.16, regimeOffsetDn: 0.66, regimeKnee: 0, regimeSource: 3,
        // Heat carries the bloom: the θ phase is phase-only, so a flow that moved σ alone
        // would rearrange the waveform without changing a single partial's magnitude.
        thetaPhase: 0.5, thetaHeat: 0.45, thetaFlow: 1,
        harmonicsCount: 108, cutoff: 9000, resonance: 1.1,
        attack: 0.006, decay: 0.9, sustain: 0.3, release: 1.1,
        unisonVoices: 2, detune: 4, volume: 0.58,
      }
    ),
    p(
      'regime-sieve-bass',
      'Sieved Regime Bass',
      'A low, hard-cut wave with the congruence sieve notching out every harmonic sharing a factor with 30, and the operator window parked in the bass. The split supplies far more upper partials than a saw would; the sieve then decides which of them survive.',
      {
        bendPosition: 0.88, bendAmount: 1.0, bendAngle: 2.8, bend2Amount: 0.6,
        regimeMix: 0.9, regimeThreshold: 0.24, regimeAsym: -0.18, regimeRail: 0.45,
        regimeOffsetUp: 0.35, regimeOffsetDn: 0.55, regimeKnee: 0.05, regimeSource: 1,
        collatzGating: 0.6, valuationBase: 13, combModulus: 30,
        operatorFocus: 0.15, operatorWidth: 2.5, lowCouple: 0.4,
        harmonicsCount: 80, cutoff: 1800, resonance: 2.8,
        filterEnvAmount: 1.2, filterEnvAttack: 0.006, filterEnvDecay: 0.35, filterEnvSustain: 0.25,
        subGain: 0.5, subWave: 1, subOctave: 0,
        attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.28,
        unisonVoices: 2, detune: 5, volume: 0.66,
      }
    ),
    p(
      'regime-graded-stack',
      'Graded Stack',
      'Five voices, each breaking into the second rule at a different point of the wave: the expander spreads the window offset across the stack, so instead of five detuned copies of one switch you get a chorus that crosses over one voice at a time. Dense at the top of the note, clean at the bottom.',
      {
        bendPosition: 0.76, bendAmount: 0.9, bendAngle: 2.0, bend2Amount: 0.4,
        regimeMix: 0.8, regimeThreshold: 0.3, regimeRail: 0.3,
        regimeOffsetUp: 0.22, regimeOffsetDn: 0.5, regimeKnee: 0.2, regimeSource: 0,
        unisonVoices: 5, detune: 12,
        expandAmount: 0.9, expandRegime: 0.85, expandTilt: 0.3, expandProfile: 2,
        harmonicsCount: 96, cutoff: 7000, resonance: 1.2,
        attack: 0.03, decay: 0.7, sustain: 0.55, release: 0.9,
        spaceBoost: 0.25, spaceAngle: 1.2,
        dopplerMix: 0.3, dopplerSize: 0.6, dopplerDecay: 0.65, dopplerDamp: 0.45,
        volume: 0.5,
      }
    ),
    p(
      'regime-rail-formants',
      'Rail Formants',
      'The split cuts the cycle at a window; the parity rails then split the *output* at a bias line and speak a different vowel from each half. Two thresholds at opposite ends of the signal path — one deciding how the wave is written, the other deciding how what it became is voiced.',
      {
        bendPosition: 0.72, bendAmount: 0.85, bendAngle: 2.4, bend2Amount: -0.35,
        regimeMix: 0.75, regimeThreshold: 0.36, regimeAsym: 0.15, regimeRail: -0.4,
        regimeOffsetUp: 0.45, regimeOffsetDn: 0.28, regimeKnee: 0.3, regimeSource: 2,
        arithValue: 1.618033988749895, arithBits: 40, arithSwell: 0.85, arithMap: 2,
        arithWarp: 0.35, arithAngle: 0.9,
        fxRouting: 1,
        parityMix: 0.6, parityBias: 0.15, parityDrive: 0.5, parityReso: 0.35,
        parityFormant: 0.7, parityVowelUp: 0.25, parityVowelDn: 0.8, parityKeyTrack: 0.45,
        parityToneUp: 5000, parityToneDn: 900,
        harmonicsCount: 88, cutoff: 5500, resonance: 1.6,
        attack: 0.02, decay: 0.6, sustain: 0.5, release: 0.7,
        unisonVoices: 3, detune: 9, volume: 0.56,
      }
    ),

    // ── C · The cut through the operator families the first ten leave alone ─────────────
    p(
      'regime-mobius-boost',
      'Cut on the Sphere',
      'A hard-ish cut, then the whole spectrum pushed along the hyperbolic Möbius flow and raised to a degree-1.6 Veronese power. The split decides which partials exist; the projective transform decides how they are weighted against the fundamental — a tilt applied to a spectrum that a saw could not have produced.',
      {
        bendPosition: 0.8, bendAmount: 0.92, bendAngle: 1.7, bend2Amount: 0.55,
        regimeMix: 0.85, regimeThreshold: 0.3, regimeAsym: 0.05, regimeRail: 0.25,
        regimeOffsetUp: 0.35, regimeKnee: 0.08, regimeSource: 0,
        mobiusRotate: 1.1, mobiusBoost: 0.45, harmonicExponent: 1.6,
        harmonicsCount: 104, cutoff: 9000, resonance: 1.2,
        attack: 0.006, decay: 0.4, sustain: 0.35, release: 0.45,
        unisonVoices: 2, detune: 6, volume: 0.6,
      }
    ),
    p(
      'regime-lct-fold',
      'Cut and Rotated',
      'Two pre-projection stages in series: the cycle is cut against its own value, and the result is then rotated 63° through its own time–frequency plane with a squeeze and a chirp on top. The LCT sees a waveform with a discontinuity in it and disperses that edge across the whole plane.',
      {
        bendPosition: 0.66, bendAmount: 0.78, bendAngle: 2.5, bend2Amount: -0.45,
        regimeMix: 0.8, regimeThreshold: 0.33, regimeAsym: -0.08, regimeRail: -0.3,
        regimeOffsetUp: 0.2, regimeKnee: 0.35, regimeSource: 1,
        frftMix: 0.65, frftAngle: 0.7, frftSqueeze: 0.3, frftShear: -0.2,
        harmonicsCount: 96, cutoff: 6500, resonance: 1.5,
        attack: 0.25, decay: 0.8, sustain: 0.7, release: 1.2,
        spaceBoost: 0.3, spaceAngle: 2.4,
        unisonVoices: 3, detune: 11, volume: 0.55,
      }
    ),
    p(
      'regime-pivot-stack',
      'Cut then Pivoted',
      'Both time-domain surgeries at once, and the order matters: the split runs first, so the pivot then finds its zero crossings on the *already cut* wave — including the new ones the rail step created. Time dilates around edges that did not exist a stage earlier.',
      {
        bendPosition: 0.86, bendAmount: 1.0, bendAngle: 2.9, bend2Amount: 0.5,
        regimeMix: 0.9, regimeThreshold: 0.26, regimeAsym: -0.2, regimeRail: 0.4,
        regimeOffsetUp: 0.45, regimeOffsetDn: 0.15, regimeKnee: 0, regimeSource: 3,
        zeroStretch: 0.5, zeroInsert: 0.3,
        harmonicsCount: 80, cutoff: 3200, resonance: 2.4,
        filterEnvAmount: 1.4, filterEnvAttack: 0.008, filterEnvDecay: 0.3, filterEnvSustain: 0.3,
        subGain: 0.4, subWave: 1,
        attack: 0.006, decay: 0.3, sustain: 0.55, release: 0.3,
        unisonVoices: 2, detune: 7, volume: 0.64,
      }
    ),
    p(
      'regime-hecke-chi',
      'Cut Arithmetic',
      'The number-theory operators applied to a cut spectrum: a Hecke operator at p = 5 couples the split’s partials across scales, a Dirichlet character twists their phases and notches every eleventh, and a p-adic tilt pushes the highly divisible ones down. Glassy, and thinner than its harmonic count suggests.',
      {
        bendPosition: 0.74, bendAmount: 0.86, bendAngle: 1.3, bend2Amount: 0.4,
        regimeMix: 0.75, regimeThreshold: 0.38, regimeAsym: 0.1, regimeRail: -0.28,
        regimeOffsetUp: 0.12, regimeKnee: 0.15, regimeSource: 0,
        heckeMix: 0.55, heckeWeight: 1.3, heckePrime: 5,
        dirichletTwist: 0.45, dirichletModulus: 11,
        padicTilt: -0.4,
        harmonicsCount: 112, cutoff: 8000, resonance: 1.0,
        attack: 0.005, decay: 0.45, sustain: 0.15, release: 0.5,
        unisonVoices: 2, detune: 4, volume: 0.6,
      }
    ),
    p(
      'regime-downfold',
      'Folded Cut',
      'The split throws energy well up the spectrum; the quotient downfold then wraps everything above harmonic 6 back onto a six-partial grid and lets it accumulate, with second-order interference products landing on the same grid. All of that width, collapsed into a very short period.',
      {
        bendPosition: 0.9, bendAmount: 0.98, bendAngle: 3.3, bend2Amount: 0.62,
        regimeMix: 0.95, regimeThreshold: 0.22, regimeAsym: -0.3, regimeRail: 0.5,
        regimeOffsetUp: 0.4, regimeOffsetDn: 0.6, regimeKnee: 0.04, regimeSource: 1,
        spectralFold: 0.7, foldPeriod: 6, interfere: 0.35,
        operatorFocus: 0.1, operatorWidth: 2.0, lowCouple: 0.55,
        harmonicsCount: 72, cutoff: 1600, resonance: 3.0,
        filterEnvAmount: 1.0, filterEnvAttack: 0.006, filterEnvDecay: 0.4, filterEnvSustain: 0.3,
        subGain: 0.45, subWave: 2,
        attack: 0.006, decay: 0.35, sustain: 0.5, release: 0.3,
        unisonVoices: 3, detune: 9, volume: 0.6,
      }
    ),
    p(
      'regime-circulant-blur',
      'Blurred Boundary',
      'A wide knee and a wide window, so the split is a lean rather than a cut, over e read as a Möbius-displaced curve. A circulant Gaussian kernel then smears neighbouring partials into each other inside a pitch-tracking band, and the room does the rest.',
      {
        bendPosition: 0.6, bendAmount: 0.7, bendAngle: 1.1, bend2Amount: -0.3,
        regimeMix: 0.7, regimeThreshold: 0.42, regimeAsym: 0.18, regimeRail: 0.18,
        regimeOffsetUp: 0.28, regimeKnee: 0.55, regimeSource: 2,
        arithValue: 2.718281828459045, arithBits: 36, arithSwell: 0.9, arithDecay: 1.3,
        arithMap: 3, arithWarp: 0.55, arithAngle: 3.4,
        circulantOperatorStrength: 0.6, circulantKernelShift: 0.4,
        operatorFocus: 0.5, operatorWidth: 3.5, bandMode: 1, focusTrack: 0.5,
        noiseGain: 0.12,
        harmonicsCount: 96, cutoff: 5000, resonance: 1.1,
        attack: 0.35, decay: 1.0, sustain: 0.65, release: 1.4,
        dopplerMix: 0.35, dopplerRate: 0.6, dopplerSize: 0.65, dopplerDecay: 0.7, dopplerDamp: 0.5,
        unisonVoices: 3, detune: 10, volume: 0.52,
      }
    ),

    // ── D · The cut as a voice: walks, residue, arrival, motion, space ──────────────────
    p(
      'regime-number-walk',
      'Four Numbers Above',
      'The bent saw never changes; what it is cut against does. Rule B is the arithmetic curve, and the curve walks π → φ → e → √2 across the envelope’s own sections — so the note is spliced against a different number at onset, at the end of the attack, through the sustain, and as the release finishes. The number is heard *only* through the split; it is never blended into the main cycle at all.',
      {
        bendPosition: 0.78, bendAmount: 0.9, bendAngle: 2.0, bend2Amount: 0.42,
        regimeMix: 0.9, regimeThreshold: 0.3, regimeRail: 0.3,
        regimeOffsetUp: 0.18, regimeKnee: 0.1, regimeSource: 2,
        arithValue: 3.141592653589793, arithValue2: 1.618033988749895,
        arithValue3: 2.718281828459045, arithValue4: 1.4142135623730951,
        arithSeqCount: 4, arithBits: 30, arithSwell: 0.95, arithDecay: 1.1,
        arithMap: 1, arithWarp: 0.4, arithAngle: 1.7,
        harmonicsCount: 104, cutoff: 7000, resonance: 1.4,
        attack: 0.15, decay: 0.6, sustain: 0.5, release: 1.0,
        unisonVoices: 2, detune: 6, volume: 0.58,
      }
    ),
    p(
      'regime-residue-bloom',
      'What the Cut Removed',
      'The split is the most destructive operator in the chain, so it leaves the largest residue — and this patch plays that residue back. Bloom mode starts with the cut spectrum alone and lets the removed components return over nearly two seconds, each harmonic on its own clock, so the note fills back in toward the wave it would have been.',
      {
        bendPosition: 0.71, bendAmount: 0.82, bendAngle: 2.1, bend2Amount: -0.5,
        regimeMix: 0.85, regimeThreshold: 0.28, regimeAsym: 0.06, regimeRail: -0.35,
        regimeOffsetUp: 0.5, regimeOffsetDn: 0.22, regimeKnee: 0.18, regimeSource: 0,
        extendMix: 0.6, extendTime: 1.8, extendSkew: 0.5, extendBloom: 1,
        harmonicsCount: 96, cutoff: 7500, resonance: 1.2,
        attack: 0.4, decay: 1.2, sustain: 0.6, release: 1.8,
        spaceBoost: -0.25, spaceAngle: 4.0,
        unisonVoices: 3, detune: 12, volume: 0.52,
      }
    ),
    p(
      'regime-genesis-arrival',
      'Assembling Cut',
      'A self-spliced wave that arrives rather than starts: the Möbius transform travels from the identity along its CP¹ orbit and the mirror anagram assembles from nothing, both over the note. The split is fixed throughout, so what changes is entirely what the group actions do to the cut spectrum.',
      {
        bendPosition: 0.69, bendAmount: 0.8, bendAngle: 2.7, bend2Amount: 0.48,
        regimeMix: 0.8, regimeThreshold: 0.32, regimeAsym: -0.12, regimeRail: 0.35,
        regimeOffsetUp: 0.3, regimeKnee: 0.22, regimeSource: 3,
        mobiusRotate: 0.9, mobiusBoost: -0.4, mobiusFlow: 1,
        cyclotomicMix: 0.55, cyclotomicPower: 0.8, cyclotomicAction: 1, cyclotomicFlow: 1,
        harmonicsCount: 88, cutoff: 6000, resonance: 1.6,
        attack: 0.5, decay: 1.0, sustain: 0.7, release: 1.5,
        unisonVoices: 3, detune: 9, volume: 0.54,
      }
    ),
    p(
      'regime-motion-drone',
      'Drifting Window',
      'A drone whose split will not sit still: the spectral-motion LFO morphs the live spectrum inside held notes, and the expander gives all four voices their own window offset, so each crosses into the second rule at a different amplitude and at a different moment. Nothing about the cut is the same twice.',
      {
        bendPosition: 0.83, bendAmount: 0.94, bendAngle: 3.6, bend2Amount: 0.58,
        regimeMix: 0.9, regimeThreshold: 0.25, regimeAsym: 0.22, regimeRail: 0.42,
        regimeOffsetUp: 0.6, regimeOffsetDn: 0.35, regimeKnee: 0.3, regimeSource: 1,
        motionDepth: 0.55, motionRate: 0.35,
        harmonicsCount: 112, cutoff: 5500, resonance: 1.3,
        attack: 0.6, decay: 1.5, sustain: 0.8, release: 2.0,
        unisonVoices: 4, detune: 14,
        expandAmount: 0.7, expandRegime: 0.6, expandTheta: 0.4, expandProfile: 1,
        spaceBoost: 0.35, spaceAngle: 0.8,
        volume: 0.5,
      }
    ),
    p(
      'regime-travel-shimmer',
      'Spiralling Cut',
      'The peaks rail is sent hard into a room whose walls never stop receding, so every recirculation shifts the cut wave up another seven semitones and the tail climbs away from the note forever. Pre-filter send, so a dark patch still lights the room.',
      {
        bendPosition: 0.64, bendAmount: 0.75, bendAngle: 1.5, bend2Amount: -0.38,
        regimeMix: 0.75, regimeThreshold: 0.36, regimeAsym: -0.05, regimeRail: -0.22,
        regimeOffsetUp: 0.42, regimeKnee: 0.4, regimeSource: 0,
        fxRouting: 1,
        dopplerMix: 0.55, dopplerMode: 1, dopplerShift: 7, dopplerSpeed: 0.5,
        dopplerSize: 0.7, dopplerDecay: 0.75, dopplerDamp: 0.35,
        parityMix: 0.35, parityBias: -0.2, parityDrive: 0.4, parityReso: 0.3, parityReverb: 0.5,
        harmonicsCount: 88, cutoff: 6800, resonance: 1.1,
        attack: 0.08, decay: 1.0, sustain: 0.55, release: 1.6,
        unisonVoices: 3, detune: 8, volume: 0.5,
      }
    ),
    p(
      'regime-sc-polygon',
      'Polygon Stab',
      'Rule B is a Schwarz–Christoffel polygon boundary — a shape space with poles at its prevertices that no star-shaped Fourier curve can write — spliced into a saw wherever the saw runs high. A hard knee and a two-octave filter collapse make it a stab: the polygon is only ever heard in flashes.',
      {
        bendPosition: 0.88, bendAmount: 1.0, bendAngle: 2.3, bend2Amount: 0.52,
        regimeMix: 1.0, regimeThreshold: 0.24, regimeAsym: 0.14, regimeRail: 0.45,
        regimeOffsetUp: 0.08, regimeOffsetDn: 0.72, regimeKnee: 0, regimeSource: 2,
        arithValue: 3.142857142857143, arithMap: 4, arithSwell: 0.6,
        arithWarp: 0.7, arithAngle: 5.1,
        harmonicsCount: 96, cutoff: 8500, resonance: 2.2,
        filterEnvAmount: 2.2, filterEnvAttack: 0.005, filterEnvDecay: 0.2, filterEnvSustain: 0.0,
        transientPunch: 0.25,
        attack: 0.005, decay: 0.22, sustain: 0.0, release: 0.18,
        unisonVoices: 2, detune: 5, volume: 0.66,
      }
    ),
  ];
}
