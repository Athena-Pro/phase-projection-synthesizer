import { Preset, SynthParams } from '../types';

/**
 * Hybrid preset bank.
 *
 * Where the original patches each demonstrate one module, every patch here deliberately
 * *crosses* subsystems — the arithmetic oscillator through the operator bands, a number
 * sequence walked by the unison expander, the canonical (LCT) and projective (CP¹) group
 * actions driven as one gesture, residue extension riding a genesis flow, and so on. They
 * are grouped in families of five below.
 *
 * Takes the neutral patch as its base so every entry reads as an explicit delta; the caller
 * passes it in, which also keeps this module free of any import cycle with `presets.ts`.
 *
 * Two rules every entry here follows, both enforced by `scripts/checkPresets.ts`:
 *   • No dead knobs. A parameter is only set when whatever gates it is open — operator
 *     focus needs a Width below its all-pass rail, `expandOrbit` needs the cyclotomic
 *     module engaged, `frftAngle` needs α Mix, a flow needs its module non-idle, and so on.
 *   • No degenerate output: finite, audible, and spectrally distinct from every other patch.
 */
export function buildHybridPresets(base: SynthParams): Preset[] {
  const p = (
    id: string,
    name: string,
    description: string,
    over: Partial<SynthParams>
  ): Preset => ({ id, name, description, params: { ...base, ...over } });

  return [
    // ── A · Arithmetic oscillator through the operator bands ────────────────────────────
    p(
      'prime-sieve-bass',
      'Prime Sieve Bass',
      "22/7 read as a curve, then sieved: harmonics sharing a factor with 210 are notched out and the whole operator window is parked in the bass, so the number is only heard through its coprime partials.",
      {
        arithMix: 0.85, arithValue: 3.142857142857143, arithBits: 28, arithDecay: 1.1,
        arithSwell: 0.95, arithMap: 2, arithWarp: 0.4, arithAngle: 1.2,
        collatzGating: 0.55, valuationBase: 13, combModulus: 210,
        operatorFocus: 0.12, operatorWidth: 2.2, bandMode: 1, focusTrack: 0.3, lowCouple: 0.5,
        harmonicsCount: 72, cutoff: 1500, resonance: 2.6,
        fxRouting: 1, parityMix: 0.3, parityDrive: 0.55, parityFormant: 0.45,
        parityVowelUp: 0.55, parityVowelDn: 0.85, parityKeyTrack: 0.4,
        attack: 0.012, decay: 0.35, sustain: 0.55, release: 0.3,
        unisonVoices: 2, detune: 6, volume: 0.68,
      }
    ),
    p(
      'hecke-glass',
      'Hecke Glass',
      'The golden ratio through an exponential map, then coupled across scales by a Hecke operator at p = 3 — the curve hears its own third harmonic layered back on itself as glass.',
      {
        arithMix: 0.7, arithValue: 1.618033988749895, arithBits: 44, arithSwell: 0.75,
        arithMap: 1, arithWarp: 0.5, arithAngle: 4.1, arithExtract: 1,
        heckeMix: 0.65, heckeWeight: 1.4, heckePrime: 3,
        operatorFocus: 0.55, operatorWidth: 3.0, thetaHeat: 0.18, thetaPhase: 0.12,
        harmonicsCount: 112, attack: 0.006, decay: 1.1, sustain: 0.25, release: 1.4,
        cutoff: 9000, resonance: 1.1,
        dopplerMix: 0.28, dopplerSize: 0.55, dopplerDecay: 0.68,
        unisonVoices: 2, detune: 4, spaceBoost: 0.2,
      }
    ),
    p(
      'dirichlet-choir',
      'Dirichlet Choir',
      "e as a Möbius-slid curve, phase-twisted by a character mod 13 and sung through both parity rails — the notches where 13 divides a harmonic become the choir's breath.",
      {
        arithMix: 0.6, arithValue: 2.718281828459045, arithBits: 32, arithSwell: 0.85,
        arithMap: 3, arithWarp: 0.45, arithAngle: 2.6,
        dirichletTwist: 0.75, dirichletOrder: 0.5, dirichletModulus: 13,
        operatorFocus: 0.35, operatorWidth: 4.0,
        parityMix: 0.5, parityFormant: 0.7, parityVowelUp: 0.25, parityVowelDn: 0.65,
        parityToneUp: 3400, parityToneDn: 900, parityReverb: 0.35,
        attack: 0.35, decay: 0.8, sustain: 0.7, release: 1.3,
        cutoff: 7000, harmonicsCount: 88, unisonVoices: 4, detune: 11, dopplerMix: 0.25,
      }
    ),
    p(
      'padic-drone',
      '3-adic Drone',
      "The curve's radius read directly as the waveform, tilted by 3-adic valuation so harmonics divisible by powers of three sink away, with the sieved remainder blooming back in over four seconds.",
      {
        arithMix: 0.9, arithValue: 3.142857142857143, arithBits: 40, arithDecay: 0.8,
        arithSwell: 1.15, arithExtract: 2,
        padicTilt: -0.6, valuationBase: 3, collatzGating: 0.3,
        extendMix: 0.6, extendTime: 3.2, extendSkew: -0.5, extendBloom: 1,
        attack: 0.8, decay: 1.5, sustain: 0.8, release: 3.2,
        cutoff: 5200, resonance: 1.6, harmonicsCount: 96,
        dopplerMix: 0.35, dopplerSize: 0.8, dopplerDecay: 0.8,
        unisonVoices: 3, detune: 8, spaceBoost: 0.25, volume: 0.6,
      }
    ),
    p(
      'circulant-comb-lead',
      'Circulant Comb Lead',
      '√2 exponentially horned, then convolved with a shifted circulant kernel and 2-adically combed — a lead whose bite comes from arithmetic notching rather than distortion.',
      {
        arithMix: 0.75, arithValue: 1.4142135623730951, arithBits: 30, arithSwell: 0.8,
        arithMap: 1, arithWarp: 0.6, arithAngle: 0.9,
        circulantOperatorStrength: 0.7, circulantKernelShift: 0.22,
        collatzGating: 0.35, operatorFocus: 0.45, operatorWidth: 2.8,
        harmonicsCount: 80, attack: 0.008, decay: 0.28, sustain: 0.62, release: 0.35,
        cutoff: 8000, resonance: 2.2,
        unisonVoices: 3, detune: 9,
        expandAmount: 0.5, expandProfile: 1, expandTheta: 0.45, volume: 0.65,
      }
    ),

    // ── B · Arithmetic oscillator split across the unison stack ─────────────────────────
    p(
      'number-choir',
      'Number Choir',
      'One number, five voices, each reading it at its own Talbot phase — identical brightness, disagreeing waveforms, so the width is timbral rather than beating.',
      {
        arithMix: 0.8, arithValue: 3.141592653589793, arithBits: 40, arithSwell: 0.8,
        arithMap: 3, arithWarp: 0.5, arithAngle: 3.1,
        unisonVoices: 5, detune: 12,
        expandAmount: 0.9, expandProfile: 2, expandTheta: 0.8, expandTilt: 0.3,
        attack: 0.5, decay: 1.2, sustain: 0.7, release: 2.0,
        cutoff: 7500, harmonicsCount: 96, dopplerMix: 0.3, spaceBoost: 0.2, volume: 0.55,
      }
    ),
    p(
      'split-orbit-ensemble',
      'Split Orbit Ensemble',
      'Every voice is frozen at a different point along the cyclotomic orbit, and neighbours in pitch are the ones furthest apart in timbre — four disagreeing anagrams of the golden curve.',
      {
        arithMix: 0.7, arithValue: 1.618033988749895, arithBits: 36, arithSwell: 0.9,
        arithMap: 2, arithWarp: 0.35,
        cyclotomicMix: 0.8, cyclotomicPower: 0.45,
        harmonicsCount: 96, unisonVoices: 4, detune: 7,
        expandAmount: 1.0, expandProfile: 1, expandOrbit: 0.85, expandTheta: 0.3,
        attack: 0.15, decay: 0.6, sustain: 0.6, release: 1.0, cutoff: 8500,
      }
    ),
    p(
      'band-split-brass',
      'Band Split Brass',
      "The comb and Hecke operators look through a narrow window, and each voice's window sits at a different octave — one gesture splits the whole operator family across the stack.",
      {
        arithMix: 0.65, arithValue: 2.718281828459045, arithBits: 26, arithSwell: 0.7,
        arithMap: 1, arithWarp: 0.45, arithAngle: 1.5,
        operatorFocus: 0.4, operatorWidth: 1.8, collatzGating: 0.4, heckeMix: 0.3,
        lowCouple: 0.3, unisonVoices: 4, detune: 10,
        expandAmount: 0.85, expandFocus: 0.8, expandTilt: 0.35,
        attack: 0.04, decay: 0.3, sustain: 0.7, release: 0.4,
        cutoff: 7000, resonance: 1.8, harmonicsCount: 80, volume: 0.62,
      }
    ),
    p(
      'tilted-stack',
      'Tilted Stack',
      'A five-voice stack spread along two axes at once: each voice gets its own spectral tilt and its own fractional-Fourier rotation, so the ensemble fans out in brightness and in dispersion together.',
      {
        arithMix: 0.7, arithValue: 1.4142135623730951, arithBits: 34, arithSwell: 0.85,
        arithExtract: 1,
        frftMix: 0.5, frftAngle: 0.55, frftSqueeze: 0.3, frftShear: -0.2,
        unisonVoices: 5, detune: 9,
        expandAmount: 0.95, expandTilt: 0.6, expandAlpha: 0.7,
        attack: 0.2, decay: 0.7, sustain: 0.65, release: 1.2,
        cutoff: 8000, harmonicsCount: 88, dopplerMix: 0.2, volume: 0.6,
      }
    ),
    p(
      'divergent-numbers',
      'Divergent Numbers',
      'Two numbers walked across the envelope, and four voices reading that walk from four different points of the permutation orbit — the sequence and the stack diverge on separate axes.',
      {
        arithMix: 0.85, arithValue: 3.141592653589793, arithValue2: 1.7320508075688772,
        arithSeqCount: 2, arithBits: 38, arithSwell: 0.8,
        arithMap: 3, arithWarp: 0.55, arithAngle: 5.0,
        cyclotomicMix: 0.5, cyclotomicPower: 0.7,
        unisonVoices: 4, detune: 8,
        expandAmount: 0.8, expandProfile: 2, expandTheta: 0.5, expandOrbit: 0.4,
        attack: 0.3, decay: 1.0, sustain: 0.6, release: 1.8,
        cutoff: 8000, harmonicsCount: 96,
      }
    ),

    // ── C · Numbers walked across the amplitude envelope ────────────────────────────────
    p(
      'rational-walk',
      'Rational Walk',
      'A third at the onset, a half by the end of the attack, two thirds through the sustain, 22/7 arrived at as the release finishes — four repeating fractions, four bit patterns, one key press.',
      {
        arithMix: 1.0, arithValue: 1 / 3, arithValue2: 0.5, arithValue3: 2 / 3,
        arithValue4: 3.142857142857143, arithSeqCount: 4,
        arithBits: 34, arithDecay: 0.95, arithSwell: 0.9,
        attack: 0.5, decay: 1.1, sustain: 0.6, release: 2.0,
        cutoff: 7000, harmonicsCount: 80, unisonVoices: 2, detune: 5, dopplerMix: 0.2,
      }
    ),
    p(
      'collatz-arc',
      'Collatz Arc',
      "The 3n+1 trajectory of 27 read as four curves — 27, 82, 41, 124 — so the note climbs and halves the way the sequence does, folded through an aerofoil map.",
      {
        arithMix: 0.95, arithValue: 27.82, arithValue2: 82.41, arithValue3: 41.124,
        arithValue4: 124.62, arithSeqCount: 4,
        arithBits: 42, arithSwell: 0.95, arithMap: 2, arithWarp: 0.45, arithAngle: 2.9,
        attack: 0.25, decay: 0.9, sustain: 0.55, release: 1.6,
        cutoff: 7800, harmonicsCount: 96, unisonVoices: 3, detune: 8,
        dopplerMix: 0.22, spaceBoost: 0.15,
      }
    ),
    p(
      'mirror-walk',
      'Mirror Walk',
      'Three digit-reversed numbers walked on a fixed clock rather than the envelope, so the timbre completes its journey in 1.4 s however long the key is held.',
      {
        arithMix: 0.9, arithValue: 1.234568, arithValue2: 8.654321, arithValue3: 5.192837,
        arithSeqCount: 3, arithSeqMode: 1, alphaEnvTime: 1.4,
        arithBits: 36, arithSwell: 0.85, arithMap: 3, arithWarp: 0.6, arithAngle: 1.0,
        attack: 0.02, decay: 0.5, sustain: 0.65, release: 0.9,
        cutoff: 8200, harmonicsCount: 88, unisonVoices: 3, detune: 7,
      }
    ),
    p(
      'binary-bloom',
      'Binary Bloom',
      'Four numbers with exactly two set bits each — 2.5, 4.25, 8.125, 16.0625 — so the curve keeps the same sparse shape while its harmonics march upward, with the sieved residue blooming underneath.',
      {
        arithMix: 1.0, arithValue: 2.5, arithValue2: 4.25, arithValue3: 8.125,
        arithValue4: 16.0625, arithSeqCount: 4,
        arithBits: 30, arithDecay: 0.7, arithSwell: 1.0,
        extendMix: 0.5, extendTime: 1.8, extendBloom: 1, extendSkew: 0.3,
        collatzGating: 0.3, operatorFocus: 0.3, operatorWidth: 3.5,
        attack: 0.6, decay: 1.3, sustain: 0.7, release: 2.4,
        cutoff: 6800, harmonicsCount: 96, unisonVoices: 3, detune: 9,
        dopplerMix: 0.3, dopplerSize: 0.65, volume: 0.6,
      }
    ),
    p(
      'primes-ascend',
      'Primes Ascend',
      'Consecutive prime pairs — 2.3, 3.5, 5.7, 7.11 — sprinted through by a short envelope, so the whole four-number walk happens inside a single pluck.',
      {
        arithMix: 1.0, arithValue: 2.3, arithValue2: 3.5, arithValue3: 5.7,
        arithValue4: 7.11, arithSeqCount: 4,
        arithBits: 32, arithSwell: 1.0, arithMap: 1, arithWarp: 0.4, arithAngle: 0.6,
        attack: 0.02, decay: 0.18, sustain: 0.3, release: 0.5,
        cutoff: 9500, resonance: 1.6, harmonicsCount: 72,
        unisonVoices: 2, detune: 6, dopplerMix: 0.25, dopplerDecay: 0.5,
      }
    ),

    // ── D · Canonical (LCT) and projective (CP¹) actions as one gesture ─────────────────
    p(
      'cayley-linked-sweep',
      'Cayley Linked Sweep',
      "The Cayley transform images the LCT's canonical element onto the harmonic disk, so one α sweep moves the time–frequency plane and the CP¹ spectrum as a single group element.",
      {
        frftMix: 0.7, frftAngle: 1.1, frftSqueeze: 0.35, frftShear: 0.25, cayleyLink: 1,
        mobiusRotate: 1.2, mobiusBoost: 0.3,
        alphaEnvDepth: 0.8, alphaEnvTime: 0.9,
        harmonicsCount: 96, attack: 0.06, decay: 0.7, sustain: 0.6, release: 1.1,
        cutoff: 8500, unisonVoices: 3, detune: 8, dopplerMix: 0.2, volume: 0.62,
      }
    ),
    p(
      'loxodromic-spiral',
      'Loxodromic Spiral',
      'A boost and a rotation together make the Möbius transform loxodromic, and the genesis envelope samples its orbit — the spectrum spirals into place over the attack rather than sliding.',
      {
        mobiusBoost: 0.55, mobiusRotate: 2.2, mobiusFlow: 1, harmonicExponent: 1.4,
        harmonicsCount: 104, attack: 0.4, decay: 1.2, sustain: 0.7, release: 2.2,
        cutoff: 7200, unisonVoices: 3, detune: 10,
        dopplerMix: 0.3, dopplerSize: 0.7, spaceBoost: 0.2, volume: 0.58,
      }
    ),
    p(
      'parabolic-cusp-pad',
      'Parabolic Cusp Pad',
      'The last SL(2,C) conjugacy class — a parabolic shear fixing infinity — combined with a sub-unit Veronese power, flattening the harmonic ratios into a soft cusped pad.',
      {
        mobiusParabolic: 0.65, mobiusTilt: 0.3, harmonicExponent: 0.6,
        extendMix: 0.4, extendTime: 2.0, extendSkew: -0.3,
        harmonicsCount: 88, attack: 0.7, decay: 1.4, sustain: 0.75, release: 2.6,
        cutoff: 6000, unisonVoices: 4, detune: 12, dopplerMix: 0.32, volume: 0.55,
      }
    ),
    p(
      'chirp-squeeze-bell',
      'Chirp Squeeze Bell',
      'A hyperbolic squeeze and a parabolic shear of the cycle, quadratically phased in the harmonic index — metallic partials from pure geometry, with no inharmonic ratios anywhere.',
      {
        frftMix: 0.8, frftAngle: 0.3, frftSqueeze: -0.7, frftShear: 0.6,
        thetaPhase: 0.35, thetaHeat: 0.08,
        harmonicsCount: 112, attack: 0.005, decay: 1.5, sustain: 0.15, release: 1.8,
        cutoff: 10000, resonance: 1.2, unisonVoices: 2, detune: 3,
        dopplerMix: 0.35, dopplerSize: 0.6, dopplerDecay: 0.7,
      }
    ),
    p(
      'veronese-power-lead',
      'Veronese Power Lead',
      'Every harmonic ratio raised to the power 2.6 — a degree-d endomorphism of CP¹ — then rotated about a horizontal axis so the extremes of the spectrum trade places.',
      {
        harmonicExponent: 2.6, mobiusTilt: 0.45, mobiusRotate: 0.8,
        harmonicsCount: 80, attack: 0.01, decay: 0.3, sustain: 0.65, release: 0.4,
        cutoff: 9000, resonance: 2.4, unisonVoices: 3, detune: 11,
        expandAmount: 0.6, expandTilt: 0.5, expandTheta: 0.35, volume: 0.63,
      }
    ),

    // ── E · Theta / Talbot crossed with the cyclotomic permutation ──────────────────────
    p(
      'talbot-revival',
      'Talbot Revival',
      'A rational quadratic phase self-images the waveform — a fractional Talbot revival — while the partials are simultaneously shuffled along a primitive-root orbit, so the revival lands on a rearranged spectrum.',
      {
        thetaPhase: 0.5, thetaHeat: 0.1, thetaFlow: 1,
        cyclotomicMix: 0.55, cyclotomicPower: 0.8,
        harmonicsCount: 96, attack: 0.3, decay: 0.9, sustain: 0.65, release: 1.5,
        cutoff: 8000, unisonVoices: 3, detune: 7, dopplerMix: 0.24,
      }
    ),
    p(
      'anagram-heat',
      'Anagram Heat',
      'The mirror action swaps every harmonic n with P−n while a heat-kernel rolloff diffuses the timbre toward a sine — the spectrum is reversed and simplified at once.',
      {
        cyclotomicMix: 0.85, cyclotomicAction: 1, cyclotomicPower: 1.0,
        thetaHeat: 0.45, thetaPhase: 0.25,
        harmonicsCount: 104, attack: 0.45, decay: 1.1, sustain: 0.7, release: 1.9,
        cutoff: 6500, unisonVoices: 4, detune: 10,
        dopplerMix: 0.3, dopplerSize: 0.7, spaceBoost: -0.2, volume: 0.58,
      }
    ),
    p(
      'galois-pluck',
      'Galois Pluck',
      'The permutation assembles itself over the note: partials slide along their orbit cycles from identity to a full spectral anagram inside a quarter-second pluck.',
      {
        cyclotomicMix: 0.9, cyclotomicPower: 0.6, cyclotomicFlow: 1,
        thetaPhase: 0.15,
        harmonicsCount: 88, attack: 0.006, decay: 0.22, sustain: 0.25, release: 0.45,
        cutoff: 9500, resonance: 2.0, unisonVoices: 2, detune: 5,
        dopplerMix: 0.28, dopplerDecay: 0.55,
      }
    ),
    p(
      'revival-drone',
      'Revival Drone',
      'A quarter-turn of quadratic phase held under a four-second residue tail — the Gauss-sum structure of the revival becomes the drone rather than an effect on top of it.',
      {
        thetaPhase: 0.25, thetaHeat: 0.06,
        extendMix: 0.55, extendTime: 4.0, extendSkew: -0.6,
        harmonicsCount: 112, attack: 1.2, decay: 1.8, sustain: 0.85, release: 3.6,
        cutoff: 5800, unisonVoices: 4, detune: 13,
        dopplerMix: 0.4, dopplerSize: 0.85, dopplerDecay: 0.82, spaceBoost: 0.3, volume: 0.52,
      }
    ),
    p(
      'braided-orbit',
      'Braided Orbit',
      'A fractional permutation power leaves the partials mid-braid — neither identity nor a full anagram — and the spectral-motion LFO drifts the whole braid slowly against a fixed theta phase.',
      {
        cyclotomicMix: 0.7, cyclotomicPower: 0.35, thetaPhase: 0.75, thetaHeat: 0.12,
        motionDepth: 0.4, motionRate: 0.35,
        harmonicsCount: 96, attack: 0.5, decay: 1.3, sustain: 0.7, release: 2.1,
        cutoff: 7400, unisonVoices: 3, detune: 9, dopplerMix: 0.26, volume: 0.58,
      }
    ),

    // ── F · Parity rails, formants and the moving-wall room ─────────────────────────────
    p(
      'vowel-rails-pad',
      'Vowel Rails Pad',
      'Peaks and troughs split onto separate rails and given different vowels — an A above, an O below — so the two halves of the waveform sing different sounds.',
      {
        parityMix: 0.75, parityBias: 0.1, parityFormant: 0.85,
        parityVowelUp: 0.0, parityVowelDn: 0.75, parityDrive: 0.35, parityReso: 0.35,
        parityReverb: 0.4, fxRouting: 1,
        attack: 0.6, decay: 1.2, sustain: 0.75, release: 2.0,
        cutoff: 5500, harmonicsCount: 72, unisonVoices: 4, detune: 11,
        dopplerMix: 0.35, dopplerSize: 0.7, volume: 0.58,
      }
    ),
    p(
      'growl-split-bass',
      'Growl Split Bass',
      'A hard bias line puts most of the cycle on the lower rail, driven and resonant, while the thin upper rail is sent to the room — bass body with an airborne edge.',
      {
        bendPosition: 0.2, bendAmount: -0.7, bend2Position: 0.65, bend2Amount: 0.6,
        modIndex: 0.9, modRatio: 1.5,
        parityMix: 0.8, parityBias: -0.45, parityDrive: 0.7, parityReso: 0.5,
        parityToneUp: 2800, parityToneDn: 520, parityReverb: 0.55, parityFormant: 0.4,
        parityVowelUp: 0.6, parityVowelDn: 0.9, parityKeyTrack: 0.5,
        fxRouting: 1, interfere: 0.35,
        attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.35,
        cutoff: 1300, resonance: 3.0, harmonicsCount: 64, unisonVoices: 1,
        dopplerMix: 0.18, dopplerSize: 0.45, dopplerDamp: 0.6, volume: 0.7,
      }
    ),
    p(
      'shimmer-travel-choir',
      'Shimmer Travel Choir',
      'Traveling walls: a fixed +7 semitone shift compounds in the feedback loop, so the upper rail spirals endlessly upward while the dry choir stays put.',
      {
        dopplerMix: 0.55, dopplerMode: 1, dopplerShift: 7, dopplerDecay: 0.78,
        dopplerSize: 0.65, dopplerDamp: 0.35,
        parityMix: 0.45, parityFormant: 0.6, parityVowelUp: 0.3, parityReverb: 0.7,
        fxRouting: 1,
        attack: 0.8, decay: 1.4, sustain: 0.8, release: 2.8,
        cutoff: 7000, harmonicsCount: 88, unisonVoices: 5, detune: 14,
        expandAmount: 0.5, expandTheta: 0.5, expandProfile: 2, volume: 0.5,
      }
    ),
    p(
      'formant-key-track-keys',
      'Formant Key Track Keys',
      'The formant bank scales with the played note, so the vowel stays in the same place relative to the pitch instead of sliding down the keyboard.',
      {
        parityMix: 0.6, parityFormant: 0.75, parityVowelUp: 0.5, parityVowelDn: 0.15,
        parityKeyTrack: 0.9, parityDrive: 0.3, parityReso: 0.3,
        heckeMix: 0.25, heckeWeight: 0.8, operatorFocus: 0.4, operatorWidth: 3.2,
        attack: 0.015, decay: 0.55, sustain: 0.45, release: 0.7,
        cutoff: 6500, harmonicsCount: 80, unisonVoices: 2, detune: 6, dopplerMix: 0.22,
      }
    ),
    p(
      'rail-reverb-swell',
      'Rail Reverb Swell',
      'Almost nothing is dry: the peaks rail is fed almost entirely into the moving-wall room, so the note arrives as its own reverberation before the fundamental catches up.',
      {
        parityMix: 0.9, parityBias: 0.25, parityReverb: 0.95, parityDrive: 0.25,
        parityToneUp: 8000, parityToneDn: 1600, fxRouting: 1,
        dopplerMix: 0.65, dopplerSize: 0.9, dopplerDecay: 0.85, dopplerSpeed: 0.55,
        dopplerRate: 0.35, dopplerDamp: 0.5,
        extendMix: 0.35, extendTime: 2.2, extendBloom: 1,
        attack: 1.4, decay: 1.6, sustain: 0.8, release: 3.4,
        cutoff: 6200, harmonicsCount: 80, unisonVoices: 3, detune: 10, volume: 0.5,
      }
    ),

    // ── G · Residue extension riding the genesis flows ──────────────────────────────────
    p(
      'bloom-genesis-pad',
      'Bloom Genesis Pad',
      'What the operators removed is absent at note-on and returns through time, while the Möbius transform simultaneously flows from identity into place — two different arrivals over one attack.',
      {
        circulantOperatorStrength: 0.55, circulantKernelShift: 0.4, collatzGating: 0.45,
        extendMix: 0.7, extendTime: 2.4, extendSkew: 0.4, extendBloom: 1,
        mobiusBoost: 0.4, mobiusRotate: 1.6, mobiusFlow: 1,
        attack: 0.9, decay: 1.5, sustain: 0.75, release: 2.6,
        cutoff: 6800, harmonicsCount: 96, unisonVoices: 4, detune: 11,
        dopplerMix: 0.3, volume: 0.55,
      }
    ),
    p(
      'decay-residue-pluck',
      'Decay Residue Pluck',
      'The removed components sound at the onset and vanish in a third of a second, with high harmonics clearing first — an arithmetic transient in front of a clean tail.',
      {
        collatzGating: 0.7, valuationBase: 7,
        extendMix: 0.85, extendTime: 0.35, extendSkew: 0.75,
        operatorFocus: 0.5, operatorWidth: 3.0,
        attack: 0.005, decay: 0.24, sustain: 0.35, release: 0.5,
        cutoff: 9200, resonance: 1.9, harmonicsCount: 80, unisonVoices: 2, detune: 5,
        dopplerMix: 0.2,
      }
    ),
    p(
      'skewed-tail-bell',
      'Skewed Tail Bell',
      'A negative residue skew inverts the usual order — the low partials of the removed layer outlast the high ones, so the bell darkens as it decays instead of thinning.',
      {
        heckeMix: 0.5, heckeWeight: 1.6, heckePrime: 5,
        extendMix: 0.65, extendTime: 2.5, extendSkew: -0.85,
        thetaPhase: 0.4, thetaHeat: 0.15,
        attack: 0.005, decay: 1.6, sustain: 0.2, release: 2.2,
        cutoff: 9500, resonance: 1.3, harmonicsCount: 112, unisonVoices: 2, detune: 4,
        dopplerMix: 0.38, dopplerSize: 0.6, dopplerDecay: 0.72,
      }
    ),
    p(
      'flow-bloom-hybrid',
      'Flow Bloom Hybrid',
      'Both Section IV flows run at once — the Talbot phase blooms in while the permutation assembles — and the residue blooms behind them, so three separate things arrive on three separate clocks.',
      {
        thetaPhase: 0.6, thetaHeat: 0.2, thetaFlow: 1,
        cyclotomicMix: 0.6, cyclotomicPower: 0.9, cyclotomicFlow: 1,
        extendMix: 0.5, extendTime: 1.6, extendBloom: 1, extendSkew: 0.25,
        attack: 0.7, decay: 1.3, sustain: 0.7, release: 2.2,
        cutoff: 7600, harmonicsCount: 104, unisonVoices: 3, detune: 9,
        dopplerMix: 0.3, spaceBoost: 0.18, volume: 0.56,
      }
    ),
    p(
      'alpha-genesis-swell',
      'Alpha Genesis Swell',
      'A full α sweep over 2.4 seconds: the cycle starts purely temporal and rotates into the frequency domain as the note swells, dispersing its partials on the way.',
      {
        frftMix: 0.85, frftAngle: 1.4, frftSqueeze: 0.45, frftShear: -0.3,
        alphaEnvDepth: 1.0, alphaEnvTime: 2.4,
        extendMix: 0.3, extendTime: 1.2,
        attack: 1.0, decay: 1.5, sustain: 0.8, release: 2.4,
        cutoff: 7000, harmonicsCount: 96, unisonVoices: 3, detune: 10,
        dopplerMix: 0.34, dopplerSize: 0.75, volume: 0.55,
      }
    ),

    // ── H · Quotient grids, interference and low coupling ───────────────────────────────
    p(
      'quotient-grid-bass',
      'Quotient Grid Bass',
      'Everything above the fourth harmonic is wrapped back onto a period-4 grid and the upper-band difference energy is folded into the low partials — a bass built entirely from re-indexed treble.',
      {
        bendPosition: 0.24, bendAmount: -0.6, bend2Position: 0.7, bend2Amount: 0.55,
        modIndex: 0.7, modRatio: 2.0,
        spectralFold: 0.8, foldPeriod: 4, lowCouple: 0.6, interfere: 0.3,
        bandMode: 1, operatorFocus: 0.15, operatorWidth: 2.0, focusTrack: 0.25,
        attack: 0.01, decay: 0.32, sustain: 0.6, release: 0.35,
        cutoff: 1500, resonance: 2.8, harmonicsCount: 64,
        fxRouting: 1, parityMix: 0.25, parityDrive: 0.5, unisonVoices: 1, volume: 0.7,
      }
    ),
    p(
      'interference-growl',
      'Interference Growl',
      'Pitch-locked second-order sum and difference products laid over an arithmetic comb — nonlinear grit that stays exactly in tune because every product lands on the harmonic grid.',
      {
        bendPosition: 0.18, bendAmount: -0.5, bend2Position: 0.62, bend2Amount: 0.7,
        modIndex: 1.4, modRatio: 3.0,
        interfere: 0.7, collatzGating: 0.4, valuationBase: 2, padicTilt: 0.35,
        operatorFocus: 0.25, operatorWidth: 2.6,
        attack: 0.008, decay: 0.28, sustain: 0.55, release: 0.4,
        cutoff: 2600, resonance: 3.2, harmonicsCount: 72,
        fxRouting: 1, parityMix: 0.35, parityDrive: 0.65, unisonVoices: 2, detune: 7,
        volume: 0.66,
      }
    ),
    p(
      'downfold-choir',
      'Downfold Choir',
      'A gentle wrap onto a twelve-harmonic grid, sung through the vowel rails — the partials above the twelfth reappear as reinforcement of the ones below rather than as brightness.',
      {
        spectralFold: 0.6, foldPeriod: 12, lowCouple: 0.25,
        parityMix: 0.55, parityFormant: 0.7, parityVowelUp: 0.35, parityVowelDn: 0.8,
        parityReverb: 0.4,
        attack: 0.55, decay: 1.1, sustain: 0.72, release: 1.8,
        cutoff: 6400, harmonicsCount: 96, unisonVoices: 4, detune: 12,
        dopplerMix: 0.3, spaceBoost: 0.15, volume: 0.56,
      }
    ),
    p(
      'low-couple-sub',
      'Low Couple Sub',
      'A one-octave window parked at the bottom of an absolute-Hz band that tracks the note halfway — the operators only ever touch the body, and everything they take is folded into harmonics 2 to 8.',
      {
        bendPosition: 0.16, bendAmount: -0.45, bend2Position: 0.58, bend2Amount: 0.4,
        lowCouple: 0.85, bandMode: 1, operatorFocus: 0.1, operatorWidth: 1.2,
        focusTrack: 0.5, circulantOperatorStrength: 0.6, circulantKernelShift: 0.1,
        collatzGating: 0.35,
        attack: 0.014, decay: 0.4, sustain: 0.7, release: 0.45,
        cutoff: 1100, resonance: 2.4, harmonicsCount: 56,
        fxRouting: 1, parityMix: 0.2, parityFormant: 0.35, parityVowelDn: 0.9,
        parityKeyTrack: 0.35, unisonVoices: 1, volume: 0.72,
      }
    ),
    p(
      'fold-comb-hybrid',
      'Fold Comb Hybrid',
      'Two different arithmetic filters stacked: a congruence sieve notches the grid, then a period-6 quotient folds what survives back down on top of itself.',
      {
        spectralFold: 0.7, foldPeriod: 6,
        collatzGating: 0.6, valuationBase: 13, combModulus: 42, padicTilt: -0.4,
        interfere: 0.25, operatorFocus: 0.3, operatorWidth: 3.4,
        attack: 0.02, decay: 0.45, sustain: 0.55, release: 0.6,
        cutoff: 4200, resonance: 2.0, harmonicsCount: 88, unisonVoices: 2, detune: 8,
        dopplerMix: 0.24, volume: 0.64,
      }
    ),

    // ── I · Motion, rooms and the sound field ───────────────────────────────────────────
    p(
      'morph-drift-pad',
      'Morph Drift Pad',
      'A slow audio-rate crossfade between the patch and a displaced copy of itself, so the spectrum breathes between two related shapes without any filter moving.',
      {
        motionDepth: 0.6, motionRate: 0.18,
        crossMix: 0.3, crossPhase: 1.1, crossShear: 1,
        attack: 0.9, decay: 1.6, sustain: 0.8, release: 2.6,
        cutoff: 6600, harmonicsCount: 96, unisonVoices: 4, detune: 12,
        dopplerMix: 0.32, dopplerSize: 0.7, spaceBoost: 0.2, volume: 0.55,
      }
    ),
    p(
      'dominance-swirl',
      'Dominance Swirl',
      'A strong ambisonic boost toward one azimuth — a Lorentz transform of the sound field — with the unison stack fanned across it so the voices move as well as change level.',
      {
        spaceBoost: 0.8, spaceAngle: 2.4, motionDepth: 0.35, motionRate: 0.6,
        harmonicExponent: 1.3,
        attack: 0.35, decay: 1.0, sustain: 0.7, release: 1.6,
        cutoff: 7800, harmonicsCount: 88, unisonVoices: 5, detune: 15,
        expandAmount: 0.55, expandTheta: 0.45, expandTilt: 0.3,
        dopplerMix: 0.28, volume: 0.54,
      }
    ),
    p(
      'travel-shimmer-lead',
      'Travel Shimmer Lead',
      'A full octave of compounding shift in the feedback path: every recirculation lands an octave up, so the lead trails an endlessly rising ghost of itself.',
      {
        dopplerMix: 0.5, dopplerMode: 1, dopplerShift: 12, dopplerDecay: 0.75,
        dopplerSize: 0.5, dopplerDamp: 0.3,
        thetaPhase: 0.3, cyclotomicMix: 0.4, cyclotomicPower: 0.85,
        attack: 0.01, decay: 0.32, sustain: 0.6, release: 0.6,
        cutoff: 9000, resonance: 2.1, harmonicsCount: 80, unisonVoices: 3, detune: 9,
        volume: 0.6,
      }
    ),
    p(
      'wall-osc-keys',
      'Wall Oscillation Keys',
      'Walls oscillating at 2.4 Hz warble the tail while the tuning stays centred — vibrato that lives in the room rather than on the oscillator.',
      {
        dopplerMix: 0.45, dopplerMode: 0, dopplerSpeed: 0.8, dopplerRate: 2.4,
        dopplerSize: 0.45, dopplerDecay: 0.55, dopplerDamp: 0.45,
        heckeMix: 0.3, heckeWeight: 1.2, operatorFocus: 0.45, operatorWidth: 3.6,
        attack: 0.012, decay: 0.6, sustain: 0.45, release: 0.8,
        cutoff: 7200, harmonicsCount: 80, unisonVoices: 2, detune: 6, volume: 0.63,
      }
    ),
    p(
      'space-rotate-drone',
      'Space Rotate Drone',
      'A negative dominance pushes the field away from the listener while an elliptic rotation of CP¹ turns the spectrum about its 0–∞ axis — a drone that recedes as it revolves.',
      {
        spaceBoost: -0.7, spaceAngle: 4.2, mobiusRotate: 3.0, mobiusBoost: -0.25,
        extendMix: 0.45, extendTime: 3.6, extendSkew: -0.4,
        motionDepth: 0.25, motionRate: 0.12,
        attack: 1.6, decay: 1.8, sustain: 0.85, release: 3.8,
        cutoff: 5000, harmonicsCount: 104, unisonVoices: 4, detune: 13,
        dopplerMix: 0.42, dopplerSize: 0.88, dopplerDecay: 0.84, volume: 0.5,
      }
    ),

    // ── J · Full-stack hybrids ──────────────────────────────────────────────────────────
    p(
      'arithmetic-cathedral',
      'Arithmetic Cathedral',
      'π walked to √2 across the envelope, sieved by a congruence comb, Talbot-phased, sung through the vowel rails and left in a very large moving room.',
      {
        arithMix: 0.8, arithValue: 3.141592653589793, arithValue2: 1.4142135623730951,
        arithSeqCount: 2, arithBits: 40, arithSwell: 0.9, arithMap: 3, arithWarp: 0.5,
        arithAngle: 2.2,
        collatzGating: 0.4, valuationBase: 13, combModulus: 105,
        thetaPhase: 0.35, thetaHeat: 0.14,
        operatorFocus: 0.35, operatorWidth: 4.2,
        parityMix: 0.5, parityFormant: 0.6, parityVowelUp: 0.2, parityVowelDn: 0.7,
        parityReverb: 0.5, fxRouting: 1,
        attack: 1.1, decay: 1.6, sustain: 0.8, release: 3.2,
        cutoff: 6400, harmonicsCount: 104, unisonVoices: 4, detune: 12,
        dopplerMix: 0.5, dopplerSize: 0.9, dopplerDecay: 0.85, spaceBoost: 0.25,
        volume: 0.5,
      }
    ),
    p(
      'machine-choir',
      'Machine Choir',
      'A four-number walk read by five voices at five Talbot phases, with the permutation assembling over the note — the number sequence and the voice stack diverge on different clocks.',
      {
        arithMix: 0.9, arithValue: 6.1134, arithValue2: 6.45361, arithValue3: 7.36288,
        arithValue4: 8.29031, arithSeqCount: 4,
        arithBits: 44, arithSwell: 0.85, arithMap: 1, arithWarp: 0.5, arithAngle: 3.9,
        arithExtract: 1,
        cyclotomicMix: 0.55, cyclotomicPower: 0.75, cyclotomicFlow: 1,
        unisonVoices: 5, detune: 11,
        expandAmount: 0.85, expandProfile: 2, expandTheta: 0.65, expandOrbit: 0.4,
        attack: 0.7, decay: 1.4, sustain: 0.72, release: 2.6,
        cutoff: 7600, harmonicsCount: 96,
        dopplerMix: 0.35, dopplerSize: 0.75, spaceBoost: 0.2, volume: 0.5,
      }
    ),
    p(
      'deep-structure-bass',
      'Deep Structure Bass',
      'Every arithmetic filter the synth has, all aimed at the bottom octave: a sieve, a p-adic tilt, a Hecke coupling and a quotient fold, with the residue arriving late underneath.',
      {
        bendPosition: 0.2, bendAmount: -0.62, bend2Position: 0.68, bend2Amount: 0.5,
        modIndex: 0.8, modRatio: 1.5,
        collatzGating: 0.5, valuationBase: 3, padicTilt: -0.45,
        heckeMix: 0.35, heckeWeight: 0.9, heckePrime: 2,
        spectralFold: 0.45, foldPeriod: 5, lowCouple: 0.55, interfere: 0.3,
        bandMode: 1, operatorFocus: 0.12, operatorWidth: 1.6, focusTrack: 0.35,
        extendMix: 0.4, extendTime: 1.4, extendBloom: 1, extendSkew: -0.3,
        attack: 0.012, decay: 0.38, sustain: 0.62, release: 0.45,
        cutoff: 1400, resonance: 2.7, harmonicsCount: 72,
        fxRouting: 1, parityMix: 0.3, parityDrive: 0.6, parityFormant: 0.4,
        parityVowelUp: 0.5, parityVowelDn: 0.85, parityKeyTrack: 0.45,
        unisonVoices: 1, volume: 0.7,
      }
    ),
    p(
      'total-projection-lead',
      'Total Projection Lead',
      'The canonical and projective actions linked by the Cayley transform, a theta phase on top, and each unison voice displaced along a different one of those axes — the whole geometry in one lead.',
      {
        frftMix: 0.6, frftAngle: 0.85, frftSqueeze: 0.4, frftShear: 0.3, cayleyLink: 1,
        mobiusRotate: 1.4, mobiusBoost: 0.35, mobiusTilt: 0.25, harmonicExponent: 1.5,
        thetaPhase: 0.45, thetaHeat: 0.1,
        unisonVoices: 4, detune: 10,
        expandAmount: 0.9, expandProfile: 1, expandTheta: 0.5, expandAlpha: 0.55,
        expandTilt: 0.4,
        attack: 0.012, decay: 0.35, sustain: 0.65, release: 0.55,
        cutoff: 9200, resonance: 2.0, harmonicsCount: 96,
        dopplerMix: 0.25, volume: 0.58,
      }
    ),
    p(
      'everything-drone',
      'Everything Drone',
      'A deliberately maximal patch, balanced rather than loud: arithmetic curve, sieve, Hecke, theta, cyclotomic, Möbius flow, residue bloom, both rails, moving walls and a boosted field.',
      {
        arithMix: 0.55, arithValue: 2.718281828459045, arithBits: 46, arithSwell: 0.95,
        arithMap: 2, arithWarp: 0.4, arithAngle: 1.7,
        crossMix: 0.25, crossPhase: 0.8, crossShear: -1,
        collatzGating: 0.3, valuationBase: 7, padicTilt: 0.25,
        dirichletTwist: 0.3, dirichletOrder: 0.35, dirichletModulus: 11,
        heckeMix: 0.3, heckeWeight: 1.1, heckePrime: 3,
        thetaPhase: 0.28, thetaHeat: 0.12,
        cyclotomicMix: 0.4, cyclotomicPower: 0.65,
        operatorFocus: 0.4, operatorWidth: 5.0,
        mobiusBoost: 0.3, mobiusRotate: 1.0, mobiusFlow: 1, harmonicExponent: 1.2,
        extendMix: 0.4, extendTime: 2.8, extendBloom: 1, extendSkew: -0.2,
        motionDepth: 0.25, motionRate: 0.14,
        parityMix: 0.4, parityFormant: 0.5, parityVowelUp: 0.4, parityVowelDn: 0.6,
        parityReverb: 0.45, fxRouting: 1,
        attack: 1.5, decay: 1.8, sustain: 0.82, release: 3.6,
        cutoff: 6000, harmonicsCount: 112, unisonVoices: 4, detune: 12,
        expandAmount: 0.6, expandProfile: 2, expandTheta: 0.5, expandTilt: 0.3,
        dopplerMix: 0.45, dopplerSize: 0.85, dopplerDecay: 0.82, spaceBoost: 0.3,
        spaceAngle: 1.2, volume: 0.46,
      }
    ),
  ];
}
