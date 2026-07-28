/**
 * AudioWorklet processor for the additive harmonic bank.
 *
 * The processor source is inlined as a string and loaded through a Blob URL so it
 * survives both the dev server and the production build without bundler-specific
 * worklet handling.
 *
 * Protocol (port messages):
 *   { type: 'frames', aR, aI, bR, bI, resR, resI, stagesR, stagesI,
 *     morphRate, morphDepth, extendMix, extendTime, extendSkew, extendBloom,
 *     alphaDepth, alphaTime, alphaMode, flowDepth, seqDepth, seqEnvelope,
 *     envAttack, envDecay, envRelease }
 *     aR/aI — coefficient frame at the current parameters (Float32Array, index 1..N)
 *     bR/bI — coefficient frame at the spectral-motion morph target
 *     resR/resI — operator residue: the components the comb/circulant/Möbius chain
 *       removed. It is extended through time per voice: each harmonic n gets its own
 *       envelope e_n(t) with time constant τ_n = extendTime·(n/12)^(1.5·extendSkew),
 *       decaying from 1 (decay mode) or rising from 0 (bloom mode) since note-on.
 *     stagesR/stagesI — ordered genesis-envelope frames (birth → settled). The voice
 *       traverses them piecewise-linearly by note age, driven by max(alphaDepth,
 *       flowDepth, seqDepth) over alphaTime (alphaMode 0 rises, 1 falls). Two frames = a
 *       linear α-sweep; more = a sampled Möbius orbit (spiral for loxodromic transforms),
 *       or one frame per number of an arithmetic sequence.
 *     seqEnvelope — when 1, the traversal clock is the amplitude envelope's own sections
 *       (envAttack/envDecay/envRelease, seconds) instead of the alphaTime ramp, so the
 *       stages land on the ADSR breakpoints. Needs the note-off signal below.
 *     morphRate (Hz) / morphDepth (0..1) — LFO crossfading frame A -> B in the node
 *   { type: 'release' } — the key came up: starts the release leg of an envelope-paced
 *     traversal. Idempotent; the amp envelope itself is scheduled on the graph, not here.
 *   { type: 'stop' } — makes process() return false so the node can be collected.
 *
 * Coefficients follow the PeriodicWave convention: x(θ) = Σ r[n]·cos(nθ) + i[n]·sin(nθ).
 * Harmonics n·f above Nyquist are skipped, and coefficient updates are smoothed with a
 * ~15 ms one-pole per block, so parameter sweeps glide instead of swapping wavetables.
 */
const processorSource = `
class PhaseProjectionVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 220, minValue: 0, maxValue: 24000, automationRate: 'k-rate' },
      { name: 'detune', defaultValue: 0, minValue: -1200, maxValue: 1200, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.frameA = null;
    this.frameB = null;
    this.curR = null;
    this.curI = null;
    this.resR = null;
    this.resI = null;
    this.envRates = null;
    this.effR = null;
    this.effI = null;
    this.morphRate = 0;
    this.morphDepth = 0;
    this.extendMix = 0;
    this.extendBloom = 0;
    this.stagesR = null;
    this.stagesI = null;
    this.alphaDepth = 0;
    this.alphaTime = 0.3;
    this.alphaMode = 0;
    this.flowDepth = 0;
    this.seqDepth = 0;
    this.seqEnvelope = 0;
    this.envAttack = 0.05;
    this.envDecay = 0.2;
    this.envRelease = 0.3;
    this.lfoPhase = 0;
    this.phase = 0;
    this.age = 0; // samples since voice start — clock for the residue extension
    this.releasedAt = -1; // sample age at note-off, -1 while the key is held
    this.alive = true;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'frames') {
        this.frameA = { r: d.aR, i: d.aI };
        this.frameB = { r: d.bR, i: d.bI };
        this.resR = d.resR;
        this.resI = d.resI;
        this.morphRate = d.morphRate;
        this.morphDepth = d.morphDepth;
        this.extendMix = d.extendMix;
        this.extendBloom = d.extendBloom;
        this.stagesR = d.stagesR;
        this.stagesI = d.stagesI;
        this.alphaDepth = d.alphaDepth;
        this.alphaTime = d.alphaTime;
        this.alphaMode = d.alphaMode;
        this.flowDepth = d.flowDepth;
        this.seqDepth = d.seqDepth;
        this.seqEnvelope = d.seqEnvelope;
        this.envAttack = d.envAttack;
        this.envDecay = d.envDecay;
        this.envRelease = d.envRelease;
        const len = d.aR.length;
        if (!this.curR || this.curR.length !== len) {
          this.curR = new Float32Array(len);
          this.curI = new Float32Array(len);
          this.effR = new Float32Array(len);
          this.effI = new Float32Array(len);
          this.envRates = new Float64Array(len);
        }
        // Per-harmonic residue clocks: τ_n = extendTime·(n/12)^(1.5·skew)
        for (let n = 1; n < len; n++) {
          const tau = Math.min(20, Math.max(0.005,
            d.extendTime * Math.pow(n / 12, 1.5 * d.extendSkew)));
          this.envRates[n] = 1 / (tau * sampleRate);
        }
      } else if (d.type === 'release') {
        if (this.releasedAt < 0) this.releasedAt = this.age;
      } else if (d.type === 'stop') {
        this.alive = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.alive) return false;
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.frameA) {
      out.fill(0);
      return true;
    }

    const freq = parameters.frequency[0] * Math.pow(2, parameters.detune[0] / 1200);
    const inc = (2 * Math.PI * freq) / sampleRate;
    const N = this.curR.length - 1;
    const nMax = Math.min(N, Math.floor(sampleRate / 2 / Math.max(1, freq)));

    // Morph position for this block (raised-cosine LFO between frame A and B)
    const m = this.morphDepth * 0.5 * (1 - Math.cos(this.lfoPhase));
    this.lfoPhase += (2 * Math.PI * this.morphRate * out.length) / sampleRate;
    if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;

    // Per-note genesis envelope: sweep the base spectrum between the birth endpoint (a0)
    // and the settled endpoint (a1) as the note ages. Both the α-domain sweep (FrFT/LCT
    // off -> on) and the Möbius flow (identity -> set transform) ride this one morph, so
    // the gate opens for either. mode 0 rises over the attack, mode 1 falls. The
    // per-block position makes it an audio-rate morph of the spectral structure.
    const envDepth = Math.max(this.alphaDepth, this.flowDepth, this.seqDepth);
    const stagesR = this.stagesR;
    const alphaOn = envDepth > 0.001 && stagesR && stagesR.length >= 2;
    let aPos = 0;
    if (alphaOn) {
      const ageSec = this.age / sampleRate;
      if (this.seqEnvelope > 0.5) {
        // Envelope-paced traversal: the amplitude envelope's own breakpoints clock the walk.
        // Position is measured in breakpoint units — 0 at onset, 1 at the end of attack,
        // 2 at the end of decay (where it sits for as long as the key is held), 3 at the end
        // of release — then normalized, so the stage frames line up with the envelope
        // sections. Releasing early travels from wherever the walk had reached to the end.
        const A = Math.max(1e-4, this.envAttack);
        const D = Math.max(1e-4, this.envDecay);
        const R = Math.max(1e-4, this.envRelease);
        const held = (t) => (t < A ? t / A : Math.min(2, 1 + (t - A) / D));
        let u;
        if (this.releasedAt >= 0) {
          const relSec = this.releasedAt / sampleRate;
          const at = held(relSec);
          u = at + Math.min(1, Math.max(0, (ageSec - relSec) / R)) * (3 - at);
        } else {
          u = held(ageSec);
        }
        aPos = envDepth * (u / 3);
      } else {
        const rise = this.alphaTime > 1e-4 ? Math.min(1, ageSec / this.alphaTime) : 1;
        aPos = envDepth * (this.alphaMode > 0.5 ? 1 - rise : rise);
      }
    }

    // Locate the current position along the ordered genesis stages and pick the two
    // that bracket it — piecewise-linear traversal follows the sampled Möbius orbit.
    let s0R, s0I, s1R, s1I, frac = 0;
    if (alphaOn) {
      const stI = this.stagesI;
      const K = stagesR.length;
      const seg = aPos * (K - 1);
      let lo = Math.floor(seg);
      if (lo < 0) lo = 0;
      if (lo > K - 2) lo = K - 2;
      frac = seg - lo;
      s0R = stagesR[lo]; s0I = stI[lo];
      s1R = stagesR[lo + 1]; s1I = stI[lo + 1];
    }

    // Smooth current coefficients toward the morphed target
    const k = 1 - Math.exp(-out.length / (0.015 * sampleRate));
    const aR = this.frameA.r, aI = this.frameA.i;
    const bR = this.frameB.r, bI = this.frameB.i;
    const cR = this.curR, cI = this.curI;
    for (let n = 1; n <= N; n++) {
      const baseR = alphaOn ? s0R[n] + (s1R[n] - s0R[n]) * frac : aR[n];
      const baseI = alphaOn ? s0I[n] + (s1I[n] - s0I[n]) * frac : aI[n];
      cR[n] += (baseR + (bR[n] - baseR) * m - cR[n]) * k;
      cI[n] += (baseI + (bI[n] - baseI) * m - cI[n]) * k;
    }

    // Effective spectrum for this block: main + residue on its per-harmonic clock
    const eR = this.effR, eI = this.effI;
    const hasRes = this.resR && this.extendMix > 0.001;
    if (hasRes) {
      const rR = this.resR, rI = this.resI;
      const mix = this.extendMix;
      const bloom = this.extendBloom > 0.5;
      const age = this.age;
      for (let n = 1; n <= nMax; n++) {
        const d = Math.exp(-age * this.envRates[n]);
        const env = mix * (bloom ? 1 - d : d);
        eR[n] = cR[n] + rR[n] * env;
        eI[n] = cI[n] + rI[n] * env;
      }
    } else {
      for (let n = 1; n <= nMax; n++) {
        eR[n] = cR[n];
        eI[n] = cI[n];
      }
    }

    // Chebyshev-style recurrence: cos/sin(nφ) from cos/sin((n-1)φ)
    let phase = this.phase;
    for (let s = 0; s < out.length; s++) {
      const c1 = Math.cos(phase);
      const s1 = Math.sin(phase);
      let cn = c1;
      let sn = s1;
      let acc = 0;
      for (let n = 1; n <= nMax; n++) {
        acc += eR[n] * cn + eI[n] * sn;
        const cNext = cn * c1 - sn * s1;
        sn = sn * c1 + cn * s1;
        cn = cNext;
      }
      out[s] = acc;
      phase += inc;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
    this.phase = phase;
    this.age += out.length;
    return true;
  }
}
registerProcessor('phase-projection-voice', PhaseProjectionVoice);
`;

let workletUrl: string | null = null;

export function getWorkletUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(
      new Blob([processorSource], { type: 'application/javascript' })
    );
  }
  return workletUrl;
}
