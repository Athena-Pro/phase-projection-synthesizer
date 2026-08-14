# Phase Projection Synthesizer

An additive synthesizer built on the Web Audio API, in which timbre is made by applying
**group actions and arithmetic** to a spectrum rather than by filtering noise.

Every source is resolved into exact Fourier coefficients whenever a parameter moves, and an
AudioWorklet harmonic bank renders sample by sample from those coefficients. Because the
coefficients are recomputed on the harmonic grid of the played note, every warped timbre
stays locked to the pitch — no aliasing, no inharmonic sidebands, however violent the
transform. Coefficient updates are smoothed inside the worklet (~15 ms), so sweeps glide
instead of swapping wavetables, and harmonics above Nyquist are simply never summed.

## Run locally

Prerequisite: Node.js 20+

```sh
npm install
```

```sh
npm run dev
```

Then open <http://localhost:3000>. Play with the QWERTY row (`A`–`'`), click the on-screen
keys, run the step sequencer, or plug in a MIDI keyboard.

## Oscillators

**Bent sawtooth.** A piecewise-linear sawtooth with two independent bend points (position
and amount each), separated by a phase angle, then phase-modulated with an index and ratio.
Two single-bend variants are kept alongside the fused wave as the A and B spectra that feed
the tensor crossing layer.

**Arithmetic boundary.** A number read as a closed curve. Its binary expansion becomes the
Fourier coefficients of the curve's *log* radius — integer-part bits as cosines, fraction
bits as sines:

```
log r(θ) = Σ k^(−s) · (d_k cos kθ + e_k sin kθ)
z(θ) = r(θ)·e^(iθ)  →  w = f(z)  →  Re w / Im w / |w|  =  one cycle of audio
```

Building the log radius keeps `r` positive for any bit pattern, so every number is a
star-shaped curve. That curve is pushed through a conformal map — exponential, Joukowsky, or
a Möbius disk automorphism — and one lap of the result becomes the cycle. Because the curve
is parameterized by θ (and `r > 0`, so `arg z ≡ θ`), there is no branch cut and the cycle is
genuinely closed; only single-valued maps are offered, for the same reason. A number's first
52 binary places are all a double has, so that is the ceiling on the Bits control.

A fifth source, **Schwarz–Christoffel**, replaces that Fourier-in-log-r shape space entirely:
the same eight coefficient pairs become prevertex spacings on the unit circle and
interior-angle weights β (renormalized so Σβ = n−2). The SC map sends S¹ to a polygon
boundary whose spectrum carries the SC pole structure at the prevertices — shapes no
star-shaped Fourier curve can write. Swell softens toward a regular n-gon; Warp/Angle set
the accessory constant C.

The readout can also be a **morph** between Re and Im: either a linear **chord**
`(1−α)·Re w + α·Im w`, or a **geodesic** axis rotation
`Re·cos(απ/2) + Im·sin(απ/2)` — same endpoints, different mid-path (unit-gain at α = ½).
And the coefficients need not
come from the number at all: switch to **edit** and eight `d`/`e` pairs become continuous
values you dial by hand, reaching curves no binary expansion can write. Seeding from the
number's bits reproduces bit mode exactly, so switching modes is sound-preserving; seeding
from its decimal digits maps each onto [−1, 1] for something richer straight away.

The blend happens *before* the operator chain, so everything below applies to the arithmetic
waveform too. See `arithmeticCycle` in `src/lib/audioEngine.ts`.

## Spectral operators

### Time-domain, pre-projection

- **Zero-crossing pivot** — the cycle is cut at its zero crossings (where the state
  `[f : f′]` passes through `[0 : 1]`). *Stretch* dilates time around each crossing;
  *insert* splices sign-reflected lobes in at the crossings, re-emerging with reversed
  Fourier direction. The warped cycle is re-projected onto exact harmonics, so the transform
  changes timbre, never pitch.
- **Regime split** — a cut of the cycle conditioned on its own value. Where the waveform
  leaves a window `[offset − w, offset + w]`, a second cycle is spliced in at a phase offset,
  across a rail step. Rule B is whichever cycle is already on hand: either single-bend layer
  (the same A/B decomposition the tensor crossing reads), the arithmetic curve — a bent saw
  below the line and a number-as-a-curve above it — or the fused cycle itself, displaced,
  which splices the wave against its own body.

  Everything else in the operator family is a group action: invertible, and either
  amplitude- or phase-preserving. This one is neither, which is the point — it is the class
  of transformation the rest cannot express. It runs *before* the projection, so the
  discontinuity it plants is resolved onto exactly `harmonicsCount` partials of the played
  note and never folds back as aliasing, and so every operator downstream still applies to
  the result. *Knee* opens the hard switch into a smoothstep crossfade. Only the difference
  between the two rails is audible, since the projection discards DC, so it is one bipolar
  knob rather than two. See `src/lib/regimeSplit.ts`.
- **Fractional Fourier / linear canonical transform (α)** — the cycle's time–frequency plane
  is rotated by α·90° with a discrete FrFT (Ozaktas chirp-convolution with ×2 oversampling,
  the cycle bandlimited and embedded in a 2× frame so its Wigner support stays on-grid at
  every angle), composed with a metaplectic *squeeze* (hyperbolic) and *shear* (parabolic).
  α = 90° turns the waveform into its own spectrum; intermediate angles give dispersive,
  chirp-folded hybrids. See `src/lib/frft.ts`.

### Group actions on the spectrum

- **Tensor crossing** — slices of the outer product `T_{r,s} = F_A(r)·F_B(s)` of the two
  bend spectra, blendable with a phase rotation. *Shear* selects the diagonal `r = s + k`;
  *convolve* morphs toward the anti-diagonal sums `Σ_{r+s=n}` — exact spectral convolution,
  i.e. ring modulation whose sidebands land only on the harmonic grid. *Wedge* morphs toward
  the Wronskian `W = f_A·f_B′ − f_A′·f_B` (the Plücker/antisymmetric layer, which vanishes
  iff A ∝ B), and *difference* folds upper-partial separations down into low harmonics. The
  rank-1 structure of the outer product — all 2×2 minors vanishing, the Segre condition — is
  verified live under the display.
- **Möbius transform on CP¹** — each harmonic's projective coordinate `w = F(n)/F(1)` is
  pushed through `w ↦ (aw+b)/(cw+d)` with `M ∈ SL(2,C)` built from all four conjugacy
  classes: *rotate* (elliptic, about the 0–∞ axis), *boost* (hyperbolic, a spectral tilt),
  *tilt* (elliptic about a horizontal axis, mixing 0 with ∞), and *cusp* (parabolic, fixing
  ∞). A **Veronese power** `w ↦ w^d` adds a degree-d endomorphism on top.
- **Cayley link** — the LCT's canonical element `g = R(φ)·A(s)·N(c) ∈ SL(2,ℝ)` imaged onto
  the harmonic disk by the Cayley transform, `L = C·g·C⁻¹ ∈ SU(1,1)`, and composed with the
  Möbius matrix — so one gesture moves the time–frequency plane and the CP¹ spectrum as a
  single abstract group element, read in two representations at once.
- **Theta / Talbot** — a quadratic phase in the harmonic index, `e^{iπτn²}` with τ = σ + iη.
  Rational σ self-images the waveform (fractional Talbot revivals, with Gauss-sum structure);
  the imaginary part is a heat-kernel rolloff diffusing the timbre toward a sine. It is the
  Fourier dual of the LCT's time-domain chirp, and it is *phase-only*: the amplitude spectrum
  is untouched.
- **Cyclotomic permutation** — a spectral anagram reindexing partials by `n ↦ g·n (mod P)`
  with `P` the largest prime ≤ N, either by a primitive root (one long cycle, maximal
  scramble) or by −1 (mirror, swapping `n ↔ P−n`). A fractional power `Pᵗ` slides partials
  continuously along their orbit cycles — unitary at every t, so the amplitude multiset is
  preserved and only the arrangement changes.

### Arithmetic

- **Comb gating** — per-partial weighting by 2-adic or 3-adic valuation, Collatz stopping
  time or peak, or a congruence sieve that notches harmonics sharing a factor with a
  modulus M.
- **p-adic (Vladimirov) tilt** — scale harmonic n by `p^(−s·v_p(n))`, a self-similar comb.
- **Dirichlet character twist** — a unit-modulus phase `χ_k(n)·F(n)` from the character group
  of `(Z/qZ)*`, with notches wherever q divides n. Order 0 is principal, 0.5 the real
  quadratic (Legendre) character.
- **Hecke operator** — `(T_p F)(n) = F(pn) + p^(w−1)·F(n/p)`, an off-diagonal coupling
  between scales, with a modular weight w balancing the decimation and dilation copies.
- **Circulant filtering** — a Gaussian spectral kernel with a diagonal translation-operator
  phase rotation, swept across the harmonic index.
- **Quotient downfold and interference** — wrap `n > K` back onto a period-K harmonic grid,
  and add pitch-locked second-order sum/difference products that land only on the grid.

### Operator focus

Every operator above reads a shared logarithmic window, so the whole family can be aimed at
one region of the spectrum: a *focus* centre and a *width* in octaves, addressed either by
harmonic index or by absolute Hz (with a *focus track* control blending fixed frequencies
into pitch-scaled bands). *Low couple* folds operated upper-band difference energy back into
harmonics 2–8.

## Motion within a note

- **Genesis flows** — a per-note envelope traversing ordered coefficient frames from birth to
  settled state. The α sweep (temporal → spectral), a fractional Möbius power `Mᵗ` along its
  CP¹ orbit (loxodromic transforms spiral), the theta bloom and the cyclotomic assembly all
  ride the same seam, so any of them can arrive over the attack rather than sitting still.
- **Number walks** — up to four numbers per note, each becoming a genesis frame. In envelope
  mode the traversal is clocked by the amplitude envelope's own sections: point 1 at onset,
  point 2 by the end of attack, point 3 held through sustain, the last reached as the release
  finishes. Release early and the walk travels from wherever it had reached to the end.
- **Residue extension** — the operator chain never merely discards. The residue (pre-operator
  spectrum minus the level-matched output — exactly what the operators removed) is kept and
  extended through time, each harmonic on its own clock
  `τₙ = ExtTime·(n/12)^(1.5·ExtSkew)`, so it cascades across the spectrum. *Decay* starts on
  the raw spectrum and lets the operators arrive; *bloom* starts operated and lets the removed
  components return. The level matcher makes both endpoints equally loud by construction.
- **Spectral motion** — an audio-rate LFO in the worklet morphing the live spectrum toward a
  displaced parameter set inside held notes.

## The voice

- **Filter envelope** — the lowpass lives per voice, so its cutoff is swept per note. The
  amount is measured in **octaves** around the Cutoff knob rather than in Hz, which is what
  makes a given setting sweep the same musical distance wherever the base sits, and it is
  bipolar: the filter can open upward or close downward into the note. Ramps are exponential
  and clamped to the audible band.
- **Sub oscillator** — sine, square or triangle, one or two octaves below, one per *note*
  rather than per unison slot, summed in ahead of the filter so it shares the envelope.
- **Noise** — white noise through the same filter and amplitude envelope, so a breath or
  transient is shaped by the sweep instead of sitting on top of it.

## Voicing and space

- **Unison expander** — a unison stack used to be one spectrum copied and detuned. Each slot
  now carries a weight in [−1, 1] that displaces a few advanced modules *for that voice
  alone*: theta phase (phase-only, so identical brightness with disagreeing waveforms), the
  cyclotomic orbit position, the Möbius boost, the operator focus, the LCT angle, and the
  regime window — so a stack crosses into its second rule one voice at a time instead of
  switching in lockstep. Three weight profiles decide how the stack is spread — a ramp tracking detune and pan, alternating
  pairs, or a golden-ratio scatter uncorrelated with position.
- **Ambisonic dominance** — the same Lorentz/Möbius group acting on space. Sources encode
  into first-order horizontal B-format, Gerzon's dominance transform (λ = 4^t toward a
  steerable azimuth) warps the field — moving apparent directions, not just gains — and
  virtual cardioids at ±45° decode back to stereo. Energy-compensated so full boost peaks at
  +6 dB, and the whole chain collapses to one L/R gain pair per source, so it is free.

## Effects

- **Moving-wall Doppler room** — a feedback delay network whose delay lines are continuously
  re-lengthened. *Oscillate* warbles and detunes the tail with the tuning centred;
  *travel* applies a fixed per-recirculation pitch shift that compounds in the loop, spiralling
  the tail endlessly up or down.
- **Bias-parity rail split** — the waveform is split at a bias line into a peaks rail and a
  troughs rail, each with its own drive, resonant lowpass, and three-band formant bank
  cross-faded against it. The two halves can speak different vowels, the formants can track
  the played note, and the peaks rail has its own send into the room.
- **Pre/post routing** — the effect sends can be taken before or after the master filter, so
  dark patches still excite the formants and reverb.

## The deci-core arithmetic patcher

An arithmetic machine wired into the synth: the live spectrum is reduced to a Gödel-packed
integer `A = 2^x·3^y·5^z·7^w` (from energy, brightness, treble share and peakiness), a
base-10 Turing-machine program runs on that accumulator, and the result re-programs the synth.
Deterministic — the same audio and program always give the same patch.

Three modes. **Number** (the default) makes the machine's integers *become the waveform*,
written into the arithmetic oscillator's number sequence, so with a walk configured the note
starts as what the synth just heard and arrives at what the program computed. **Arith** and
**Full** are the original knob-remapping modes, scattering the result across the
number-theory parameters, or those plus timbre and space. Everything lands through the
parameter specs' ranges, so no mapping can push a control out of range.

## Presets and memory

114 factory patches in eleven banks — Classic, Number Theory, Transforms, Arithmetic,
Ensemble, Genesis, Space & Rails, Subtractive, Regimes, Full Stack, 808 — selected from the
VFD strip, where ◂ ▸ step *within* the current bank. Fifty of them deliberately cross
subsystems rather than demonstrating one module each, and the Subtractive bank shows the
voice layer working against the spectral machinery: a filter envelope over a cyclotomic
anagram is a different instrument from a filter envelope over a sawtooth.

The 22-patch Regimes bank makes the same argument for the split. Five isolate it — the four
rule-B sources, and the knee opening a hard switch into a morph. The other seventeen run a
regime-cut cycle through everything downstream of it: the anagram, the Talbot phase, the
Möbius sphere, the LCT, the arithmetic operators, the downfold, the residue extension, the
genesis flows, the expander, the rails and the room. A cut spectrum is still a spectrum, so
all of it applies unchanged — which is the whole reason the split runs before the projection.
Two are worth singling out: *Cut then Pivoted* stacks both time-domain surgeries in order, so
the pivot finds zero crossings the split created a stage earlier, and *Four Numbers Above*
hears the arithmetic curve **only** through rule B, walking π → φ → e → √2 across the
envelope while the main cycle stays a plain bent saw.

A **User** bank holds 16 memory slots persisted in `localStorage`. *Store* writes the current
sound into the first free slot and names it after its source; slots can be renamed and
cleared. Saved patches are rebuilt key-by-key on load against the current parameter schema, so
a patch stored by an older build cannot introduce a missing field, a NaN, or a stray key.

`npm run check:presets` validates the whole bank: parameter ranges, enum values, bank
coverage, finite and audible spectra, genesis stages that actually differ, onset level,
near-duplicates, and the save/load round trip. It also carries about forty **dead-knob** rules
— a parameter set while whatever gates it is closed, which looks deliberate in the source and
does nothing in the ear.

## Interface

A compact 70s-hardware faceplate. Rotary knobs drag vertically (Shift for fine control,
double-click to reset, arrow keys to nudge), and the control sections are packed under the
display mode they shape: the green-phosphor window's five modes — single-cycle scope, harmonic
spectrum, tensor-product heatmap, CP¹ Riemann spheres, and a 3D phase-space orbit — double as
the control-domain selector. An Output · FX · Master strip stays reachable from every view.

- **LINK (pitch lock)** — couples Amt B and Angle Φ along the constant-pitch curve
  `sin(Φ)·AmtB = const` (the pitch offset is `sin(Φ)·AmtB·4` semitones), so either knob
  evolves the timbre while the other compensates and the pitch stays put. The lock saturates
  at the AmtB rails and is degenerate at `sin(Φ) = 0`.
- **Two assignable LFOs** — 0.05–12 Hz, with six shapes: sine, triangle, square,
  sample-and-hold, a **logistic map** at r = 3.99 (deterministic chaos, clustered rather than
  uniform, so it lingers near the rails and darts between them), and a **four-step sequence**
  — which, because the target is whatever knob you touch, is a mini sequencer aimed anywhere
  in the patch. The four staircase shapes also carry a *lag* that slews each step edge; it is
  an analytic interpolation from the previous held value rather than a filter, so it always
  arrives inside the step and cannot overshoot. Hardware-style knob-learn: arm ASSIGN, touch
  any knob, that parameter becomes the target.
  Modulation is bipolar around the knob's base value and rides on top of it, so presets and
  knob positions are never overwritten. Both LFOs on one target sum.
- **MIDI layer** — Web MIDI with a default map for the Novation FLKey 37 (eight knobs, mod
  strip, transport, pitch bend) and MIDI-learn for anything else: touch a synth knob, move a
  hardware control, and they are bound. Preset stepping and the deci Generate trigger are
  learnable too.

## Development

| Script                   | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `npm run dev`            | Start the Vite dev server                      |
| `npm run build`          | Production build into `dist/`                  |
| `npm run preview`        | Serve the production build                     |
| `npm run lint`           | Type-check with `tsc`                          |
| `npm run check:presets`  | Validate the preset bank (see above)           |

Where things live:

| Path                          | What                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `src/lib/audioEngine.ts`      | Coefficient computation, the operator chain, voice graph     |
| `src/lib/additiveWorklet.ts`  | The realtime harmonic bank - the only hot loop         |
| `src/lib/frft.ts`             | Discrete fractional Fourier / linear canonical transform     |
| `src/lib/regimeSplit.ts`      | State-conditional cycle split, applied before projection     |
| `src/lib/dopplerReverb.ts`    | Moving-wall FDN, plus `shimmerWorklet.ts` for travel mode    |
| `src/lib/paritySplit.ts`      | Rail split, drive, tone filters and formant banks            |
| `src/lib/deci.ts`             | Base-10 Turing machine, Gödel registers                      |
| `src/lib/deciBridge.ts`       | Spectrum → seed → program → parameters or waveform           |
| `src/lib/presets.ts`          | Factory bank and bank assignment                             |
| `src/lib/presetsHybrid.ts`    | The 50 cross-subsystem patches                               |
| `src/lib/presetsVoice.ts`     | Filter-envelope, sub/noise, morph, SC, and coefficient patches |
| `src/lib/presetsRegime.ts`    | The regime-split bank, isolated and crossed                  |
| `src/lib/schwarzChristoffel.ts` | Unit-disk SC polygon boundary for the arithmetic source    |
| `src/lib/userSlots.ts`        | User memory slots and schema-tolerant loading                |
| `scripts/checkPresets.ts`     | The preset validator                                         |

The app is deliberately plugin-shaped — fixed-size editor, isolated DSP module, MIDI voice
API. See [docs/VST-PORT.md](docs/VST-PORT.md) for the concrete route to a native VST3.

## License

MIT — see [LICENSE](LICENSE).
