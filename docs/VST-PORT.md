# Porting Phase Projection to a VST3 plugin

A VST3 is a native binary loaded into a DAW process — the React/Web Audio app cannot
compile into one directly. The codebase has been shaped so the port is mechanical
rather than a rewrite. This document is the map.

## What is already plugin-shaped

- **Fixed-size faceplate.** The UI renders as a 1120 px hardware unit — exactly what a
  plugin editor window is. No responsive reflow to unpick.
- **Isolated DSP.** All synthesis math lives in `src/lib/audioEngine.ts` as pure
  functions with no DOM or Web Audio dependencies:
  - `computeFourierSeries(params)` — bent-saw evaluation, zero-crossing pivot, DFT,
    tensor crossing (shear/convolve), comb gating, circulant filter, Möbius transform.
  - `applyZeroPivotTransform`, `evaluate*BentSaw`, Collatz/p-adic helpers.
  - The realtime render loop is ~60 lines in `src/lib/additiveWorklet.ts`
    (per-sample Chebyshev recurrence over harmonic coefficients + coefficient
    smoothing + morph LFO). This is the only code that must be C++ for realtime
    safety, and it is deliberately tiny.
- **Flat parameter struct.** `SynthParams` is one flat record; `WAVE_KEYS` /
  `FRAME_KEYS` in `audioEngine.ts` already enumerate which parameters invalidate the
  coefficient frames. This maps 1:1 onto a `juce::AudioProcessorValueTreeState`.
- **MIDI-shaped voice API.** `noteOn(note, freq)` / `noteOff(note)` / `panic()` is
  exactly the shape of `handleMidiEvent` in a plugin processor.

## Recommended route: JUCE 8 + WebView editor

JUCE 8's `WebBrowserComponent` (WebView2 on Windows) lets the existing React
faceplate BE the plugin GUI unchanged. The work splits cleanly:

1. **Processor (C++)**: port `computeFourierSeries` + the worklet's render loop.
   It is arithmetic on arrays — no allocation on the audio thread if coefficient
   frames are computed on the message thread and handed over via a lock-free swap
   (frame recompute already only happens on parameter change, never per sample).
   Note the frames are owned per *unison slot*, not per patch: the Unison Expander
   computes one set per distinct divergence weight (`framesForSlot` / `divergeParams`),
   so the lock-free swap needs one slot per weight, keyed the way `expandFrames` is.
2. **Editor (WebView)**: point it at the built `dist/` bundle. Replace the
   `AudioEngine` class with a thin bridge object that forwards parameter changes to
   the APVTS and receives analyser/voice state back
   (`window.__juce__.postMessage` ↔ `WebBrowserComponent::evaluateJavascript`).
3. **Display data**: the scope/spectrum/tensor/CP¹ displays consume
   `computeFourierSeries` output, which the front end can keep computing itself from
   the same parameter values — zero bridge traffic for visuals.

Toolchain status on this machine: CMake 4.1.0 is installed; no MSVC compiler was
found on PATH. Install "Visual Studio Build Tools 2022" (Desktop C++ workload), then:

```sh
git clone --depth 1 https://github.com/juce-framework/JUCE
cmake -B build -G "Visual Studio 17 2022" -DJUCE_BUILD_EXAMPLES=OFF
cmake --build build --config Release
```

with a `CMakeLists.txt` using `juce_add_plugin(... FORMATS VST3 Standalone ...)`.

## Alternative routes

- **Cmajor** (cmajor.dev): write the DSP in the Cmajor language; the toolchain
  exports VST3/AU directly and can also run the same patch on the web. Fastest path
  to a loadable plugin; younger ecosystem, and the UI story is again a webview.
- **Web Audio Modules (WAM 2)**: package the existing worklet + UI as a WAM — loads
  today in web DAWs (Ampled, wam-examples hosts) with no native code at all. Not a
  VST, but zero porting.
- **iPlug2 with web UI**: similar shape to the JUCE route; smaller framework.

## Suggested porting order

1. `SynthParams` → APVTS parameter layout (copy ranges from the `Knob` definitions
   in `SynthControls.tsx` — they encode min/max/step/default for every parameter).
2. `computeFourierSeries` → C++ (std::array<float, 129> frames; same code shape).
3. Worklet `process()` → `processBlock()` per voice; keep the 15 ms one-pole
   coefficient smoothing and the Nyquist harmonic cap.
4. Voice manager: port `noteOn`/`noteOff`/steal logic from `AudioEngine` (the
   voice-steal map-guard fix matters — keep it).
5. WebView editor pointed at `dist/`, bridge object replacing `AudioEngine`.
