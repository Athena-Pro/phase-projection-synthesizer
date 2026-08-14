// Most fields below have a matching entry in PARAM_SPECS and are driven by a continuous
// Knob. The discrete enums — `valuationBase`, `alphaEnvMode`, `extendBloom`,
// `dopplerMode`, `mobiusFlow`, `thetaFlow`, `cyclotomicAction`, `cyclotomicFlow`,
// `cayleyLink`, `dirichletModulus`, `heckePrime`, `expandProfile`, `arithMap`,
// `arithExtract`, `arithSeqMode`, `arithCoeffMode`, `arithMorphMode`, `subWave`, `subOctave`,
// `regimeSource`, and `bandMode`
// — are intentionally absent from
// PARAM_SPECS: they're selected via SegmentGroup toggles rather than a knob, which is why
// they lack a keyof spec. `arithValue` is absent for the same reason from the other end —
// it (and `arithValue2`..`arithValue4`) is an arbitrary number typed into a field, not a
// value swept over a range.
export interface SynthParams {
  bendPosition: number; // alpha: 0.05 to 0.95
  bendAmount: number;   // Yb: -1.0 to 1.0
  bend2Position: number; // alpha2: 0.05 to 0.95
  bend2Amount: number;   // Yb2: -1.0 to 1.0
  bendAngle: number;    // phase angle between bends in radians: 0 to 2*PI
  // ── Arithmetic boundary oscillator ─────────────────────────────────────────────────
  // A number read as a closed curve: its binary digits are Fourier coefficients of the
  // curve's log radius, the curve is pushed through a conformal map, and one lap of the
  // result is the cycle. See arithmeticCycle in audioEngine.ts.
  arithMix: number;     // 0.0 to 1.0: blend of the arithmetic cycle into the bent-saw cycle (0 = oscillator off)
  arithValue: number;   // the number itself — a text field, not a knob (any positive double; only its first 52 binary places exist)
  arithBits: number;    // 1 to 52: how many binary places drive the curve (harmonic 1..bits of the log radius)
  arithDecay: number;   // 0.25 to 2: exponent s in the k^{−s} coefficient falloff (1 = the harmonic series; higher = smoother curve)
  arithSwell: number;   // 0.0 to 1.5: depth of the radial wobble in log units — r spans [e^{−2·swell}, 1]
  arithMap: number;     // 0 = none, 1 = exp, 2 = Joukowsky, 3 = Möbius disk, 4 = Schwarz–Christoffel polygon
  arithWarp: number;    // 0.0 to 1.0: the map's parameter (exp rate / Joukowsky c / Möbius |a|)
  arithAngle: number;   // 0 to 2π: the map parameter's argument — which direction the map pulls
  arithExtract: number; // which real signal to read off the mapped curve: 0 = real, 1 = imaginary, 2 = radius
  // A note can traverse several numbers. Each one becomes a genesis stage — a coefficient
  // frame the worklet interpolates toward as the note ages — so the timbre walks from one
  // integer to the next across the amplitude envelope's own sections.
  arithSeqCount: number; // 1 to 4: how many numbers the note walks through (1 = a single static number)
  arithValue2: number;   // sequence numbers 2..4 — text fields like arithValue, unused above arithSeqCount
  arithValue3: number;
  arithValue4: number;
  arithSeqMode: number;  // 0 = envelope (stages follow attack → decay → sustain hold → release), 1 = timed (the α Time ramp)
  arithMorph: number;    // 0.0 to 1.0: readout axis when arithExtract is "morph" — blends Re↔Im (see arithMorphMode)
  arithMorphMode: number; // 0 = chord (1−α)·Re + α·Im, 1 = geodesic Re·cos(απ/2) + Im·sin(απ/2) — same endpoints, different mid-path
  // The curve's coefficients can come from the number's bits (the default) or be dialled by
  // hand. Eight pairs is where the k^{−s} falloff makes further terms marginal; bit mode
  // still reads up to 52. `Seed` in the UI writes the number's bits or digits into these.
  arithCoeffMode: number; // 0 = read the number's binary expansion, 1 = use the editable pairs below
  arithD1: number; arithD2: number; arithD3: number; arithD4: number;
  arithD5: number; arithD6: number; arithD7: number; arithD8: number;
  arithE1: number; arithE2: number; arithE3: number; arithE4: number;
  arithE5: number; arithE6: number; arithE7: number; arithE8: number;
  // ── Filter envelope ────────────────────────────────────────────────────────────────
  // The lowpass moved from the master bus into the voice so it can be swept per note.
  // Amount is in octaves around the Cutoff knob, and is bipolar so the sweep can fall.
  filterEnvAmount: number;  // -4 to 4 octaves added to the cutoff at the envelope's peak
  filterEnvAttack: number;  // 0.005 to 2 s
  filterEnvDecay: number;   // 0.005 to 2 s
  filterEnvSustain: number; // 0.0 to 1.0: fraction of the peak held while the key is down
  // ── Sub oscillator and noise ───────────────────────────────────────────────────────
  // One of each per *note*, not per unison slot, summed in before the voice filter.
  subGain: number;    // 0.0 to 1.0
  subWave: number;    // 0 = sine, 1 = square, 2 = triangle
  subOctave: number;  // 0 = one octave down, 1 = two octaves down
  noiseGain: number;  // 0.0 to 0.5: white noise through the same filter and envelope
  crossMix: number;     // 0.0 to 1.0: mixes the diagonalized Fourier cross-product
  crossPhase: number;   // 0.0 to 2*PI: phase shift of the cross layer
  crossShear: number;   // -8 to 8 (integer): selects the sheared diagonal r = s + k of the tensor product
  crossConvolve: number; // 0.0 to 1.0: morph from the sheared diagonal to the anti-diagonal sum (spectral convolution / harmonic ring-mod)
  crossWedge: number;   // 0.0 to 1.0: morph the cross layer toward the Wronskian W = f_A·f_B′ − f_A′·f_B (Plücker/antisymmetric layer; vanishes iff A ∝ B)
  crossDifference: number; // 0.0 to 1.0: morph toward signed cross-correlation, folding upper relationships into low difference harmonics
  modIndex: number;     // I: 0.0 to 10.0
  modRatio: number;     // M: 0.1 to 12.0
  harmonicsCount: number; // N: 4 to 128
  circulantKernelShift: number; // 0.0 to 1.0: space shift of circulant operator kernel
  circulantOperatorStrength: number; // 0.0 to 1.0: strength of circulant operator filtering
  collatzGating: number; // 0.0 to 1.0: amount of number-theoretic comb filtering
  valuationBase: number; // 2: 2-adic, 3: 3-adic, 7: Collatz stopping time, 11: Collatz max value, 13: congruence sieve
  combModulus: number;   // 2 to 512: modulus M for the congruence sieve (notch harmonics sharing a factor with M)
  padicTilt: number;     // -1 to 1: p-adic (Vladimirov) tilt — scale harmonic n by p^{−s·v_p(n)} using the comb basis's prime (self-similar comb)
  dirichletTwist: number; // 0.0 to 1.0: dry/wet of the Dirichlet character twist χ_k(n)·F(n) (unit-modulus phase per harmonic, notch where q | n)
  dirichletOrder: number; // 0.0 to 1.0: selects the character index k ∈ [0, q−1] — 0 = principal, 0.5 = real quadratic (Legendre) character
  dirichletModulus: number; // prime modulus q of the character group (Z/qZ)*: 5, 7, 11, or 13
  heckeMix: number;      // 0.0 to 1.0: dry/wet of the Hecke operator T_p, (T_p F)(n) = F(pn) + p^{w−1}·F(n/p) (off-diagonal scale coupling)
  heckeWeight: number;   // 0.0 to 2.0: modular weight w setting the p^{w−1} balance between the decimation (F(pn)) and dilation (F(n/p)) copies
  heckePrime: number;    // prime p of the Hecke operator: 2, 3, 5, or 7
  thetaPhase: number;   // 0 to 2 (units of the σ in e^{iπσn²}): quadratic phase in the harmonic index — the frequency-domain dual of the LCT's time-domain chirp. Rational σ = p/q self-images the waveform (fractional Talbot revivals; Gauss-sum structure). σ and σ+2 coincide (n² integer).
  thetaHeat: number;    // 0.0 to 1.0: imaginary part η of τ = σ + iη — a Gaussian spectral rolloff e^{−6η(n/N)²} (heat-kernel diffusion of the timbre toward a sine)
  thetaFlow: number;    // 0 = static, 1 = flow: the per-note genesis envelope blooms τ from 0 (identity) to the set θ Phase/Heat, so the Talbot revival arrives over the note
  cyclotomicMix: number;    // 0.0 to 1.0: dry/wet of the cyclotomic permutation — a spectral anagram reindexing harmonics by n ↦ mult·n (mod P), P = largest prime ≤ N (amplitude multiset preserved, partials shuffled)
  cyclotomicPower: number;  // 0.0 to 1.0: fractional permutation power Pᵗ — slides partials along their orbit cycles from identity (0) to the full permutation (1), phase-braiding in between (per-cycle DFT)
  cyclotomicAction: number; // 0 = spread (primitive root g: one long cycle, maximal scramble), 1 = mirror (−1 ≡ P−1: swaps each n ↔ P−n)
  cyclotomicFlow: number;   // 0 = static, 1 = flow: the per-note genesis envelope blooms the permutation power t from 0, so the anagram assembles over the note
  operatorFocus: number;    // 0.0 to 1.0: logarithmic center from harmonic 1 to N (index mode) or 80 Hz–8 kHz (Hz mode)
  operatorWidth: number;    // 0.25 to 8 octaves: common log-harmonic operator bandwidth
  lowCouple: number;        // 0.0 to 1.0: fold operated upper-band difference energy into harmonics 2..8
  bandMode: number;         // 0 = harmonic-index focus, 1 = absolute-Hz focus (pitch-aware operator bands)
  focusTrack: number;       // 0.0 to 1.0: how much the Hz focus center follows the played note (0 = fixed Hz, 1 = scales with pitch)
  spectralFold: number;     // 0.0 to 1.0: dry/wet of quotient downfold — wrap n > period into the low harmonic grid
  foldPeriod: number;       // 2 to 16: period K of the spectral quotient map n ↦ 1 + ((n−1) mod K)
  interfere: number;        // 0.0 to 1.0: dry/wet of pitch-locked 2nd-order sum/difference products (nonlinear timbre interference)
  // ── Regime split ───────────────────────────────────────────────────────────────────
  // A state-conditional cut of the cycle: where the waveform's own value leaves a window,
  // a second cycle is spliced in at a phase offset, across a rail step. Applied before the
  // projection, so the discontinuities it plants land on the harmonic grid instead of
  // aliasing. See applyRegimeSplit in regimeSplit.ts.
  regimeMix: number;       // 0.0 to 1.0: dry/wet of the split (0 = the module is off)
  regimeThreshold: number; // 0.05 to 1.0: half-width of the region-A window in cycle amplitude
  regimeAsym: number;      // -1 to 1: signed offset of the window, walking the caught region up/down the wave
  regimeRail: number;      // -1 to 1: step between rail A and rail B at the crossover (only the difference is audible — DC is discarded at projection)
  regimeOffsetUp: number;  // 0.0 to 1.0: phase offset (in cycles) of the branch taken above the window
  regimeOffsetDn: number;  // 0.0 to 1.0: phase offset (in cycles) of the branch taken below the window
  regimeKnee: number;      // 0.0 to 1.0: crossover width — 0 is a hard switch, opening it smoothsteps the rules together
  regimeSource: number;    // which cycle supplies the out-of-window rule: 0 = bend A, 1 = bend B, 2 = arithmetic curve, 3 = the fused cycle itself
  zeroStretch: number;  // 0.0 to 1.0: time dilation pivoting at zero crossings
  zeroInsert: number;   // 0.0 to 1.0: reflected lobes inserted at zero crossings
  frftAngle: number;    // 0 to 4 (units of π/2): fractional Fourier rotation of the cycle's time-frequency plane
  frftSqueeze: number;  // -1 to 1: metaplectic scaling (hyperbolic squeeze) of the time-frequency plane; s = 2^squeeze
  frftShear: number;    // -1 to 1: metaplectic chirp (parabolic shear) of the time-frequency plane
  frftMix: number;      // 0.0 to 1.0: blend of the α-transformed (LCT) cycle into the signal
  alphaEnvDepth: number; // 0.0 to 1.0: per-note envelope sweeping α from temporal (0) toward the set α Angle
  alphaEnvTime: number;  // 0.01 to 4 s: duration of the α sweep
  alphaEnvMode: number;  // 0 = rise (temporal→spectral over attack), 1 = fall (spectral→temporal)
  motionRate: number;   // 0.05 to 8.0 Hz: spectral-motion LFO rate (audio-rate morph in the worklet)
  motionDepth: number;  // 0.0 to 1.0: spectral-motion LFO depth
  mobiusRotate: number; // 0 to 2*PI: elliptic rotation of CP¹ about the 0–∞ axis, w ↦ e^{iθ}w
  mobiusBoost: number;  // -1 to 1: hyperbolic flow along the 0–∞ axis, w ↦ 4^t·w (spectral tilt)
  mobiusTilt: number;   // -1 to 1: elliptic rotation about a horizontal axis (φ = t·π/2), mixes 0 and ∞
  mobiusParabolic: number; // -1 to 1: parabolic shear w ↦ w + β fixing ∞ — the last SL(2,C) conjugacy class
  mobiusFlow: number;   // 0 = static, 1 = flow: the per-note genesis envelope sweeps the Möbius from identity to the set transform
  cayleyLink: number;   // 0 = off, 1 = link: image the LCT's canonical element onto the CP¹ spectrum via the Cayley transform (C·g·C⁻¹)
  harmonicExponent: number; // 0.25 to 4: Veronese/power map on CP¹ — raise each harmonic ratio w = F(n)/F(1) to the power d (degree-d endomorphism; 1 = identity)
  extendMix: number;    // 0.0 to 1.0: level of the operator residue (components the operators removed)
  extendTime: number;   // 0.05 to 6 s: base time constant of the residue's temporal envelope
  extendSkew: number;   // -1 to 1: spreads residue time constants across the harmonic index
  extendBloom: number;  // 0 = decay (residue present at onset, fades), 1 = bloom (residue arrives over time)
  spaceBoost: number;   // -1 to 1: ambisonic dominance λ = 4^t — a Lorentz boost of the sound field
  spaceAngle: number;   // 0 to 2π: azimuth of the dominance direction (0 = center)
  dopplerMix: number;   // 0.0 to 1.0: wet level of the moving-wall Doppler reverb
  dopplerMode: number;  // 0 = oscillate (vibrato), 1 = travel (compounding shimmer)
  dopplerSpeed: number; // 0.0 to 1.0: wall travel amplitude (Doppler shift depth, with rate)
  dopplerRate: number;  // 0.05 to 8 Hz: rate the walls oscillate toward/away (mode 0)
  dopplerShift: number; // -12 to 12 semitones: fixed per-recirculation shift (mode 1)
  dopplerSize: number;  // 0.0 to 1.0: room size — base delay lengths of the FDN
  dopplerDecay: number; // 0.0 to 1.0: feedback coefficient — reverb tail length
  dopplerDamp: number;  // 0.0 to 1.0: darkening of the feedback path (lowpass)
  fxRouting: number;    // 0 = post-filter FX send, 1 = pre-filter FX send
  parityMix: number;    // 0.0 to 1.0: wet level of the bias-parity split send
  parityBias: number;   // -1 to 1: split line between the upper and lower rails
  parityToneUp: number; // 100 to 12000 Hz: upper-rail (peaks) channel lowpass
  parityToneDn: number; // 100 to 12000 Hz: lower-rail (troughs) channel lowpass
  parityDrive: number;  // 0.0 to 1.0: tanh drive shared by both parity channels
  parityReso: number;   // 0.0 to 1.0: resonance (Q) of both rail tone filters
  parityReverb: number; // 0.0 to 1.0: amount of the upper rail (peaks) sent to the Doppler reverb
  parityFormant: number; // 0.0 to 1.0: cross-fade each rail from its tone lowpass to its vowel bank
  parityVowelUp: number; // 0.0 to 1.0: upper-rail (peaks) vowel morph A→E→I→O→U
  parityVowelDn: number; // 0.0 to 1.0: lower-rail (troughs) vowel morph A→E→I→O→U
  parityKeyTrack: number; // 0.0 to 1.0: scale formants with the active note around C3
  volume: number;       // 0.0 to 1.0
  attack: number;       // envelope attack (seconds)
  attackCurve?: number;  // 0 = linear, 1 = exponential
  decay: number;        // envelope decay (seconds)
  sustain: number;      // envelope sustain (0.0 to 1.0)
  release: number;      // envelope release (seconds)
  transientPunch?: number; // 0.0 to 1.0: initial pitch drop depth
  transientNoise?: number; // 0.0 to 1.0: initial noise burst level
  cutoff: number;       // lowpass cutoff (20Hz to 20000Hz)
  resonance: number;    // filter Q (0.1 to 10.0)
  detune: number;       // voice detune in cents
  unisonVoices: number; // 1 to 5 unison voices
  // ── Unison expander ────────────────────────────────────────────────────────────────
  // Each unison voice carries a weight w ∈ [−1, 1] from its slot in the stack; the
  // weights below scale how far that w displaces a handful of the advanced spectral
  // modules for that voice, so a stack is a chord of related timbres instead of one
  // timbre copied and detuned. All zero = the historical behavior (identical voices).
  expandAmount: number;  // 0.0 to 1.0: master divergence depth of the whole expander
  expandProfile: number; // 0 = ramp (w tracks detune/pan), 1 = pair (adjacent voices oppose), 2 = scatter (golden-ratio low-discrepancy)
  // The two periodic axes take a signed offset and wrap; the three bounded ones spread over
  // a window centered on the patch value that slides inside the rails (see spreadRange).
  expandTheta: number;   // 0.0 to 1.0: per-voice θ phase offset, ±0.5 in σ mod 2 (phase-only — identical amplitude spectrum, different waveform; the one axis audible with its own module at 0)
  expandOrbit: number;   // 0.0 to 1.0: per-voice cyclotomic orbit power, window half-width 0.5 in t (needs Anagram > 0 — each voice sits at a different point of the permutation orbit)
  expandTilt: number;    // 0.0 to 1.0: per-voice Möbius boost, window half-width 0.4 (spectral tilt — dark → bright across the stack; works standalone)
  expandFocus: number;   // 0.0 to 1.0: per-voice operator focus, window half-width 0.3 (needs Width < all — splits the whole operator family across bands)
  expandAlpha: number;   // 0.0 to 1.0: per-voice FrFT α angle offset, ±0.4 in π/2 units mod 4 (needs α Mix > 0 — a different canonical rotation per voice)
  expandRegime: number;  // 0.0 to 1.0: per-voice regime window offset, window half-width 0.5 in asym (needs Regime > 0 — each voice breaks into the second rule at a different point of the wave)
}

export type ProjectionMode = 'phasespace' | 'torus' | 'ribbon';

export interface VisualizerParams {
  projectionMode: ProjectionMode;
  showGrid: boolean;
  showPoints: boolean;
  autoRotate: boolean;
  zoom: number;
  yaw: number;
  pitch: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: SynthParams;
  /**
   * Bank this patch is filed under. Factory patches are assigned one in a single pass in
   * `presets.ts` (see BANK_BY_ID) rather than being written into each literal, and
   * `npm run check:presets` fails if any patch is missing from that map.
   */
  bank?: string;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}
