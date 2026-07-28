# Phase Projection Synthesizer

An additive synthesizer built on the Web Audio API. A piecewise-linear "bent sawtooth" is
phase-modulated, then resolved into exact Fourier coefficients each time a parameter moves.
An AudioWorklet harmonic bank renders the sound sample by sample from those coefficients,
so every warped timbre stays locked to the played pitch — no aliasing, no inharmonic
sidebands. Coefficient updates are smoothed inside the worklet (~15 ms), so parameter
sweeps glide instead of swapping wavetables, and a **spectral motion** LFO morphs the
live spectrum toward a displaced parameter set inside held notes.

On top of the basic resynthesis sit the spectral and time-domain operators:

- **Zero-crossing pivot** — the single cycle is cut at its zero crossings (where the
  state [f : f′] passes through [0 : 1]). *Stretch* dilates time around each crossing;
  *insert* splices sign-reflected lobes in at the crossings, re-emerging with reversed
  Fourier direction. The warped cycle is then re-projected onto exact harmonics, so the
  transform changes timbre, never pitch.
- **Fractional Fourier rotation (α)** — the cycle's time-frequency plane is rotated by
  α·90° with a discrete FrFT (Ozaktas chirp-convolution algorithm with ×2 oversampling,
  the cycle bandlimited and embedded in a 2× frame so its Wigner support stays on-grid
  at every angle). α = 90° turns the waveform into its own spectrum; intermediate
  angles produce dispersive, chirp-folded hybrids — re-projected onto exact harmonics,
  so even the wildest rotation stays pitch-locked. See `src/lib/frft.ts`.

- **Tensor crossing** — slices of the outer product `T_{r,s} = F_A(r)·F_B(s)` of two
  bent-saw spectra, blendable into the main signal with a phase rotation. *Shear*
  selects the diagonal `r = s + k` (harmonic-shifted spectral products); *convolve*
  morphs the slice into the anti-diagonal sums `Σ_{r+s=n}` — exact spectral
  convolution, i.e. ring modulation whose sidebands land only on the harmonic grid. The
  rank-1 structure of the outer product (all 2×2 minors vanish — the Segre variety
  condition) is verified live in the invariants panel.
- **Möbius transform** — each harmonic's projective coordinate `w = F(n)/F(1)` on CP¹
  is pushed through `w ↦ (aw+b)/(cw+d)` with `M = Tilt·Boost·Rotate ∈ SL(2,C)` and
  pulled back to coefficients, with the fundamental held fixed. Rotate spins the
  Riemann sphere about the 0–∞ axis, boost tilts the spectrum dark/bright along it,
  and tilt mixes 0 with ∞ — pushing quiet harmonics into audibility.
- **Ambisonic dominance (space)** — the same Lorentz/Möbius group acting on space:
  unison sources encode into first-order horizontal B-format, Gerzon's dominance
  transform (a Lorentz boost, λ = 4^t toward a steerable azimuth) warps the sound
  field — moving apparent directions, not just gains — and virtual cardioids at ±45°
  decode back to stereo. Energy-compensated so full boost peaks at +6 dB. The linear
  chain collapses to one L/R gain pair per source, so it costs nothing and the
  *Dominance* / *Space Dir* knobs are LFO-assignable for spatial breathing.
- **Circulant operator filtering** — a Gaussian spectral kernel with a diagonal
  translation-operator phase rotation, swept across the harmonic index.
- **Arithmetic comb gating** — per-partial weighting by 2-adic / 3-adic valuation or
  Collatz trajectory statistics.
- **Residue extension (monadic operators)** — the operator chain never merely
  discards: the residue (pre-operator spectrum minus the level-matched output — the
  exact components the comb, circulant, and Möbius operators removed) is kept and
  extended through time per note. Each harmonic gets its own clock,
  τₙ = *Ext Time*·(n/12)^(1.5·*Ext Skew*), so the residue cascades across the
  spectrum. *Decay* mode starts each note on the raw spectrum and lets the
  operators' action arrive as the residue fades; *bloom* mode starts operated and
  lets the removed components return. The level matcher makes both endpoints
  equally loud by construction.

The interface is a compact 70s-hardware-style faceplate: rotary knobs (drag
vertically, Shift for fine control, double-click to reset), silkscreened sections, a
patch selector, and a green-phosphor display window with five modes — single-cycle
scope, harmonic spectrum, tensor-product heatmap, CP¹ Riemann spheres, and a 3D
phase-space orbit. A live Segre rank-1 residual reads out under the display.

Performance features:

- **LINK (pitch lock)** — couples Amt B and Angle Φ along the constant-pitch curve
  `sin(Φ)·AmtB = const` (the pitch offset is `sin(Φ)·AmtB·4` semitones), so either
  knob evolves the timbre while the other compensates and the pitch stays put. The
  lock saturates at the AmtB rails and is degenerate at `sin(Φ) = 0`.
- **Two assignable LFOs** — sine/triangle/square/sample-&-hold, 0.05–12 Hz, with
  hardware-style knob-learn: arm ASSIGN, touch any knob, that parameter becomes the
  target (arm again to clear). Modulation is bipolar around the knob's base value and
  rides on top of it — presets and knob positions are never overwritten. Both LFOs on
  one target sum.

The app is deliberately plugin-shaped (fixed-size editor, isolated DSP module, MIDI
voice API). See [docs/VST-PORT.md](docs/VST-PORT.md) for the concrete route to a
native VST3.

## Run locally

Prerequisite: Node.js 20+

```sh
npm install
npm run dev
```

Then open http://localhost:3000. Play with the QWERTY row (`A`–`'`), click the on-screen
keys, run the step sequencer, or plug in a MIDI keyboard.

## Scripts

| Script            | Purpose                       |
| ----------------- | ----------------------------- |
| `npm run dev`     | Start the Vite dev server     |
| `npm run build`   | Production build into `dist/` |
| `npm run preview` | Serve the production build    |
| `npm run lint`    | Type-check with `tsc`         |
